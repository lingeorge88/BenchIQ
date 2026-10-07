# 🧪 BenchIQ

**A multimodal, voice-enabled RAG assistant that helps medical lab professionals instantly find the right procedure, diagram, or answer across their SOPs and analyzer manuals — replacing slow keyword search and paper binders.**

> CS6180 Generative AI — Project Proposal
> Author: George Lin (`lin.geor@northeastern.edu`)
> Repository: https://github.com/lingeorge88/BenchIQ

---

## Contents

1. [🦉 What you're building](#1--what-are-you-building)
2. [🐘 Why build it](#2--why-are-you-building-it)
3. [🦫 System architecture](#3--system-architecture)
4. [🐙 Tech stack](#4--tech-stack)
5. [🐜 Evaluation](#5--evaluation)
6. [🐛 Document corpus](#6--document-corpus)
7. [🐎 Milestones & timeline](#7--milestones-and-timeline)
8. [🦅 Final deliverables](#8--final-deliverables)

---

## 1. 🦉 What are you building?

**BenchIQ** is a multimodal, voice-enabled RAG application that lets a medical lab professional ask — by text or voice — about their lab procedures and get a grounded, cited answer, including the **relevant diagrams and figures** from the source documents.

Three key features:

1. **Multimodal ingestion** — ingests text *and* figures/diagrams, links each figure to its context, and returns the relevant diagram with the answer.
2. **Voice mode** — ask by speech, hear the answer read back, for hands-busy bench work.
3. **A usable app** — streaming answers, expandable citations, inline figures, and source scoping; fast enough to answer in seconds.

Under the hood it runs as an **agentic workflow**: a tool-calling agent retrieves (and looks up figures) as needed, re-queries when results are thin, checks that its answer is grounded, and abstains when the documents don't cover the question — not a single fixed API call. A moderate **evaluation step** (treated as research) compares configurations so design choices are evidence-driven.


## 2. 🐘 Why are you building it?

Medical labs run many assays across multiple analyzers and test kits, each governed by a dense manual or SOP. Finding one answer today is slow:

- **Paper binders.** Many labs still keep SOPs and manuals on paper — locate the binder, flip to the page.
- **Keyword-only search.** Digital document-control systems match literal keywords, not meaning, so you must remember the manual's exact wording.
- **Too many near-identical files.** Large healthcare systems share document stores with tens of thousands of files and near-duplicate names; finding the right one takes time, and keyword search inside it may still miss.
- **Figures are invisible.** The diagram you need — a pipetting step, how to read a result window — can't be found by text search.

BenchIQ replaces this: **ask once or follow up questions, in plain language or by voice, and get the exact passage and diagram — cited, from across all documents at once.** It answers only from the lab's validated documents and refuses when they don't cover the question. The longer-term vision extends to other healthcare workers navigating large procedural document sets.

## 3. 🦫 System architecture

An **agentic RAG core** behind thin API layers. A tool-calling agent orchestrates each turn over pluggable retrieval, storage, and model providers, plus multimodal ingestion and a voice layer.

**Workflow**

```mermaid
flowchart LR
    Admin[👤 Lab admin] -->|uploads SOP / manual| Ingest[Ingestion pipeline]
    Ingest -->|text + figures extracted, indexed| KB[(Knowledge base)]
    Tech[🔬 Lab scientist / technician] -->|asks by text or voice| Agent[Agentic RAG core]
    KB --> Agent
    Agent -->|grounded, cited answer + diagram| Tech
```

**Architecture**

```mermaid
flowchart TB
    subgraph Clients
        CU["Chat UI<br/>text · voice · figures"]
        AU["Admin UI<br/>ingestion"]
        EV["Evaluation harness"]
    end

    CU <-->|audio| VOICE["Voice service<br/>STT / TTS"]
    CU -->|REST / SSE| CAPI[Chat API]
    AU -->|REST| AAPI[Admin API]

    CAPI --> AG
    AAPI --> AG
    EV --> AG

    subgraph CORE["Agentic RAG core"]
        AG["Tool-calling agent<br/>plan → retrieve → verify → answer / abstain"]
    end

    AG --> VS[(Vector store)]
    AG --> MD[(Metadata DB)]
    AG --> IMG[(Image / asset store)]
    AG --> LLM[LLM + VLM providers]
```

- **Agentic orchestration** — the agent (e.g., Google ADK) picks tools (KB retrieval, figure lookup, web-search fallback, clarify), can loop, verifies grounding, and answers or abstains.
- **Multimodal ingestion** — upload → validate → de-duplicate → extract text + figures → caption figures (VLM) → link figure↔text → chunk, embed, index → store images.
- **Hybrid retrieval + rerank** — dense + lexical signals with an optional reranker, fused (e.g., RRF); enriched citations (document/section, not just filename + page); linked figures returned inline. Specific choices are compared in [Evaluation](#5--evaluation).
- **Grounding & citations** — answer only from retrieved context; show only the sources the answer actually used.
- **Voice layer** — speech-to-text for questions, text-to-speech for answers, as a UI toggle.

## 4. 🐙 Tech stack

The **agentic workflow** is the committed direction; retrieval/ranking/model choices are candidates still in research (see [Evaluation](#5--evaluation)).

- **Agent:** a tool-calling framework, e.g., Google **ADK**.
- **LLM / VLM:** e.g., Gemini (via Vertex AI) or another hosted LLM; a vision model for figure captioning.
- **Retrieval (in research):** embeddings (Gemini or open-source) + a vector store (managed, e.g., Firestore, or self-hosted, e.g., Qdrant/pgvector) + a lexical signal (BM25) + an optional reranker, fused by a method like RRF.
- **Voice:** Google Cloud **Speech-to-Text** + **Text-to-Speech**.
- **App:** Python/FastAPI (SSE streaming) backend; React UI; a database for sessions/rate limiting (e.g., Firestore); optional web-search fallback (Tavily / Google grounding).
- **Deployment:** Docker on GCP Cloud Run.

## 5. 🐜 Evaluation

Evaluation is a **research step**, still being scoped — it compares the candidate configurations above and picks the shipping one from evidence rather than intuition. It follows the standard **"RAG Triad"** (retrieval relevance, faithfulness, answer relevance) with **LLM-as-judge** scoring, plus citation accuracy and correct abstention, over a small golden Q/A set.

Experiments under consideration: which retrieval/ranking configuration wins, what the lexical signal adds (hybrid vs. dense-only), and how quality holds up as the corpus grows (**1 → 5 → 10 documents**, a distractor-robustness check). The harness and results are committed under `eval/`.

## 6. 🐛 Document corpus

Small and curated (5–10 documents to start), chosen to be legally safe and realistic:

- **Real analyzer manual excerpts** — where license permits.
- **Public kit inserts / IFUs** — e.g., mononucleosis rapid tests, hCG urine/serum pregnancy tests; rich in result-interpretation figures, ideal for multimodal testing.
- **Synthetic SOPs** — representative lab procedures (QC, specimen handling, result interpretation, maintenance) mirroring real SOP structure without proprietary content.

The corpus is committed (or scripted to fetch) with provenance noted, so the document-scaling evaluation is reproducible.

## 7. 🐎 Milestones and timeline

Aligned to the course schedule (Week 8 / 11 / 14). *Exact dates to be confirmed against the syllabus.*

| Milestone | Target | Scope |
|---|---|---|
| **M1 — Ingestion + retrieval** | **Week 8** | Multimodal ingestion (text + figures, figure↔text linking, captioning); hybrid retrieval returning cited answers with inline diagrams; initial corpus ingested; basic Cloud Run build. |
| **M2 — Voice + app + eval harness** | **Week 11** | Voice mode (STT in, TTS out); polished chat UI (streaming, citations, inline figures, source scoping); golden set authored and eval harness running with first results. |
| **M3 — Scaling eval + polish** | **Week 14** | Document-scaling and hybrid-vs-dense experiments; light multimodal eval; UI polish and visible abstention; final report, demo, docs. |

## 8. 🦅 Final deliverables

The graded artifact is **a working prototype web app plus committed evaluation results**, presented in class.

- **Deployed web app** (Cloud Run) — voice-enabled chat UI + admin ingestion UI running the multimodal agentic workflow.
- **Multimodal ingestion pipeline** — real manuals/kit inserts → indexed knowledge base where figures are retrievable and returned.
- **Voice mode** — ask by speech, hear the answer read back.
- **Evaluation results in `eval/`** — golden set, harness, and a short report (retrieval, faithfulness, citation accuracy, hybrid-vs-dense, document-scaling).
- **Reproducible repo + live demo** — containerized and documented; an end-to-end demo on presentation day (ingest a manual → ask by voice → cited answer with the right diagram).

