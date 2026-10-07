# BenchIQ

**A multimodal, voice-enabled RAG assistant that helps medical lab professionals instantly find the right procedure, diagram, or answer across their SOPs and analyzer manuals — replacing slow, keyword-only document-control systems and physical paper copies.**

> CS6180 Generative AI — Project Proposal
> Author: George Lin (`lin.geor@northeastern.edu`)
> Repository: https://github.com/lingeorge88/BenchIQ

---

## 1. What are you building?

**BenchIQ** will be a retrieval-augmented generation (RAG) appplication / system that lets a medical lab professional ask a natural-language (typed *or spoken*) question about their **lab procedures**, and get back a grounded, cited answer that includes the **relevant diagrams and figures** (where necessary) from the source documents.

It is built around three things:

1. **A robust multimodal ingestion pipeline.** Lab documents are full of diagrams, workflow charts, result-interpretation images, and labeled photos — the parts technicians most need. BenchIQ ingests **both the text and the images/diagrams** of a document, links figures to their surrounding context, and **returns the relevant diagram alongside the answer**.
2. **A voice mode.** A hands-busy lab professional can **ask by voice** (speech-to-text) and have the assistant **read the answer back** (text-to-speech), so they don't have to stop what they're doing to type or read a screen.
3. **A fleshed-out, easy-to-use application.** A polished, fast interface built for the bench: streaming answers, expandable inline citations, inline figure display, and document/source scoping — designed so a non-technical lab user can get an answer in seconds.

Under the hood, BenchIQ runs as an **agentic workflow**: instead of a single retrieve-then-answer API call per question, a tool-calling agent reasons in steps — retrieving (and looking up figures) as needed, re-querying when the first results are thin, checking that its answer is grounded, and deciding when to abstain.

A **moderate evaluation step** backs this up, treated as a small research effort — comparing retrieval/ranking options, verifying citations, scoring faithfulness, and running a document-scaling experiment — so the design choices are driven by measured results.

The name is deliberate: BenchIQ is "IQ at the bench" (an assistant for the lab bench) and a **benchmark** for how good a domain RAG system actually is.

## 2. Why are you building it?

Medical labs run dozens of assays across multiple analyzers and test kits, each governed by a dense manual and a controlled SOP with many detailed steps. When a technician needs to perform a quick lookup, the answer is buried in a document binder or a vendor portal.

The tools medical labs use today to manage these documents are **outdated and slow**:

- **Still often on paper.** Many labs continue to rely on **paper copies** of SOPs and manuals in binders at the bench, so finding an answer means physically locating the right binder and flipping through it.
- **Keyword-only search.** Where documents are digital, traditional document-control systems still perform keyword searches rather than natural language querying, so an answer requires remembering and looking up the right keyword(s).
- **Too many near-identical files.** A document-control system holds hundreds of files, and **many share nearly identical names** (versions, revisions, instrument variants). Finding and clicking the *right* document takes noticeable time in a large healthcare system, where different departments share a centralized document control system with tens of thousands of documents, and keyword searches does not guarantee returning the information of interest.
- **No understanding of figures.** The diagram a technician needs — the one that shows a pipetting step or how to read a result window — is invisible to text search entirely.

BenchIQ replaces this with a single workflow: **ask once, in plain language or by voice, and get the exact passage and the exact diagram, cited, from across all the documents at once.** It answers **only from the lab's own validated documents, cites every claim, returns the relevant figure, and refuses when the documents don't cover the question.** The longer-term vision extends the same idea beyond the lab to other healthcare workers who navigate large procedural document sets.

## 3. System architecture

An **agentic RAG core** behind thin API layers. Rather than one fixed retrieve-then-generate call per question, a tool-calling agent orchestrates the workflow — it decides when to retrieve, can retrieve more than once, pulls figures, verifies grounding, and chooses to answer or abstain — over pluggable retrieval, storage, and LLM providers, plus multimodal ingestion and a voice layer.

```
┌──────────────────────────┐   ┌──────────────┐     ┌──────────────────────┐
│  Chat UI                 │   │  Admin UI    │     │  Evaluation Harness  │
│  (text + voice mode,     │   │  (ingestion) │     │  (CLI + report)      │
│   inline figures)        │   │              │     │                      │
└──────┬───────────────────┘   └──────┬───────┘     └──────────┬───────────┘
       │ REST/SSE                      │ REST                   │
   ┌───▼──────┐  ┌──────────┐    ┌─────▼──────┐                 │
   │ Voice svc│  │ Chat API │    │ Admin API  │                 │
   │ STT/TTS  │  └────┬─────┘    └─────┬──────┘                 │
   └──────────┘       │                │                        │
                      └───────┬────────┘                        │
                              ▼                                  │
                 ┌────────────────────────────┐                 │
                 │   Agentic RAG core          │◄────────────────┘
                 │  • plans + calls tools      │
                 │  • hybrid text retrieval    │
                 │  • figure/diagram retrieval │
                 │  • grounding + citations    │
                 │  • answer or abstain        │
                 └──────┬──────────┬───────────┘
                        │          │
             ┌──────────▼┐  ┌──────▼──────┐  ┌─────────────┐  ┌────────────┐
             │ Vector    │  │ Metadata DB │  │ Image/asset │  │ LLM + VLM  │
             │ store     │  │             │  │ store       │  │ providers  │
             └───────────┘  └─────────────┘  └─────────────┘  └────────────┘
```

**Agentic orchestration.** A tool-calling agent (built with an agent framework such as Google ADK) drives each turn: it chooses among tools — knowledge-base retrieval, figure/diagram lookup, a web-search fallback, and a clarify step — can call them more than once, verifies grounding, and decides whether to answer or abstain.

**Multimodal ingestion.** Admin-driven: upload → validate → de-duplicate → extract **text per page** *and* **embedded figures/diagrams** → generate a short vision-language description for each figure so it is text-searchable → **link each figure to its surrounding text chunk** → chunk, embed, and index → store the image asset for later display. De-duplication (content hashing) and per-document enable/disable/delete keep the library clean despite the "many similar filenames" problem.

**Hybrid retrieval + rerank.** Dense semantic vectors **plus** a lexical signal, so exact matches (assay names, catalog numbers, error codes) and semantic matches both surface. Several options are on the table and will be compared as part of the evaluation research (Section 6) — for embeddings (e.g., a Gemini embedding model or an open-source model), for the vector store (e.g., a managed vector search or a self-hosted store), for the lexical signal (e.g., BM25), and for an optional reranker (e.g., a hosted ranking API or a cross-encoder) — with results fused by a method such as Reciprocal Rank Fusion. Citations are enriched with document/section metadata rather than just filename + page. When a retrieved chunk has linked figures, those figures are returned with the answer and rendered inline.

**Grounding & citations.** The system prompt enforces *answer only from the supplied context, admit when the documents don't cover it, and cite every claim inline*. A citation-normalization step keeps only the sources the answer actually used and renumbers them in first-use order, so the UI never shows a citation the model didn't rely on.

**Voice layer.** A voice service wraps **speech-to-text** for spoken questions and **text-to-speech** for spoken answers, exposed in the UI as a voice-mode toggle.

## 4. Planned tech stack

The **agentic workflow** is the committed direction. The specific retrieval, ranking, and model choices are candidate options — the evaluation step (Section 6) is still in research before settling on the best method that aligns with the project timeline and deliverables.

- **Agent / orchestration (direction):** a tool-calling agent framework — e.g., Google **ADK** (Agent Development Kit) — so retrieval, figure lookup, web fallback, and grounding checks are tools invoked over multiple steps rather than one fixed call per question.
- **LLM (options):** a capable instruction-following model, e.g., Gemini (via Vertex AI) or another hosted LLM; plus a vision-language model (e.g., Gemini vision) for figure captioning.
- **Embeddings (options):** e.g., a Gemini embedding model or an open-source embedding model.
- **Vector store (options):** e.g., a managed vector search (such as Firestore vector search) or a self-hosted store (such as Qdrant / pgvector).
- **Lexical + rerank (still in research, not finalized):** a lexical signal such as BM25, and an optional reranker (e.g., a hosted ranking API or a cross-encoder), fused by a method like Reciprocal Rank Fusion.
- **APIs:** Python, FastAPI with SSE streaming.
- **Multimodal:** PDF text + image/figure extraction; a vision-language model to caption/describe figures for text-searchability; linked figure↔text metadata; an image/asset store for returning diagrams.
- **Voice:** Google Cloud **Speech-to-Text** (spoken questions) and Google Cloud **Text-to-Speech** (spoken answers), keeping the voice layer on GCP alongside the deployment.
- **Web fallback (optional):** a web-search tool, e.g., Tavily or Google Search grounding.
- **State:** a database for sessions and rate limiting (e.g., Firestore).
- **UI:** React chat (voice mode + inline figure rendering) + an admin ingestion interface.
- **Evaluation (still in research, not finalized):** RAGAS / DeepEval-style LLM-as-judge for faithfulness & relevance; standard IR metrics for retrieval.
- **Deployment:** Docker, GCP Cloud Run.

## 5. Final deliverables

At the end of the project I expect to have:

- **A deployed, working web application** (Cloud Run) with a polished, voice-enabled chat UI and an admin ingestion UI.
- **A multimodal ingestion pipeline** that takes real lab analyzer manuals/kit inserts to an indexed knowledge base where **figures are retrievable and returned**.
- **A voice mode** — ask by speech, and hear the answer read back.
- **A moderate evaluation study** (the research step) — a golden Q/A set, a scoring harness for retrieval + faithfulness + citation accuracy, and a **document-scaling experiment**, with a short written results report comparing the candidate configurations.
- **A reproducible repo**: containerized, documented, with the eval harness runnable via a single command.
- **A live demo** :on presentation day, show an end-to-end workflow of: ingest a manual → ask by voice → hear a cited answer with the right diagram shown.

## 6. Evaluation (a research step)

Evaluation is a **research step** — still being scoped — that compares the candidate configurations from Section 4 and selects the shipping one from evidence rather than intuition. It follows the standard **"RAG Triad"** (retrieval relevance, faithfulness, answer relevance) with **LLM-as-judge** scoring, plus citation accuracy and correct abstention, over a small golden Q/A set.

Experiments under consideration include which retrieval/ranking configuration wins, what the lexical signal adds (hybrid vs. dense-only), and how quality holds up as the corpus grows (**1 → 5 → 10 documents**, a distractor-robustness check). The harness and results are committed under `eval/`.

## 7. Document corpus

Small and curated (5–10 documents to start), chosen to be legally safe and realistic:

- **Real analyzer manual excerpts** — e.g., Beckman Coulter Instructions-For-Use manuals such as the AU5812, AU680, and DxI 800, where license/availability permits.
- **Publicly available kit inserts / IFUs** — e.g., infectious-mononucleosis rapid test kits, hCG urine & serum pregnancy tests, and similar manual rapid tests whose instructions-for-use are published by manufacturers (these are rich in **diagrams and result-interpretation figures**, ideal for multimodal testing).
- **Synthetic SOPs** authored for representative lab tests (QC, specimen handling, result interpretation, maintenance) that mirror real SOP structure without reproducing proprietary content.

The corpus will be committed (or scripted to fetch) with provenance noted, so the document-scaling evaluation is reproducible.

## 8. Milestones & timeline

Aligned to the course schedule (Week 8 / Week 11 / Week 14). *Exact calendar dates to be confirmed against the syllabus.*

| Milestone | Target | Scope |
|---|---|---|
| **M1 — Multimodal ingestion + retrieval** | **Week 8** | Ingestion pipeline extracting text **and figures**, with figure↔text linking and figure captioning; hybrid retrieval returning cited answers **with inline diagrams**; initial corpus (kit inserts + synthetic SOPs) ingested; basic deployed build on Cloud Run. |
| **M2 — Voice mode + usable app + eval harness** | **Week 11** | Voice mode (speech-to-text questions + text-to-speech answers); fleshed-out, easy-to-use chat UI (streaming, expandable citations, inline figures, source scoping); golden dataset authored and the evaluation harness (retrieval metrics, faithfulness, citation accuracy) running with first results. |
| **M3 — Scaling eval + polish + report** | **Week 14** | Document-scaling experiment (quality vs. corpus size 1→5→10) and hybrid-vs-dense comparison; light multimodal retrieval eval; UI/UX polish and abstention surfaced in the interface; final report, demo, and documentation. |

Stretch (time permitting): OCR for scanned manuals, async/bulk ingestion, and authentication on the admin API.

## 9. Final deliverable

The project culminates in **a working prototype web application** that demonstrates the full BenchIQ workflow end to end — ingest a medical-lab document, ask a question by text or voice, and receive a grounded, cited answer with the relevant diagram shown inline — **together with evaluation results committed to the repository**.

Concretely, the final submission is:

- **A working prototype web application** (deployed, with an admin ingestion UI and a voice-enabled chat UI) that runs the multimodal RAG workflow.
- **Evaluation results in the repository** — the golden dataset, the harness, and the results report (retrieval metrics, faithfulness, citation accuracy, hybrid-vs-dense, and the document-scaling experiment) checked in under `eval/` for review.
- **Documentation and a demo** supporting the in-class presentation: the README, setup instructions, and a short walkthrough of the app and the evaluation findings.

This combination — a usable prototype backed by committed, reproducible evaluation results — is what gets presented.


