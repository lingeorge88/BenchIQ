# GCP-Native Analyzer Knowledge Assistant
## Comprehensive Design Document and Phased Implementation Plan

## 1. Purpose

This document defines the phased evolution of the current analyzer IFU RAG assistant into a production-style, GCP-native AI application.

The project should primarily demonstrate:

- cloud-native software engineering
- managed GCP service integration
- backend/API design
- agent orchestration
- serverless deployment
- observability
- latency optimization
- secure secret/IAM handling
- persistent conversations
- rate limiting
- citation-grounded retrieval
- multimodal input

The project should **not** become an ML research project or accumulate unnecessary frameworks.

---

# 2. Current System

## 2.1 Current ingestion pipeline

```text
PDFs (data/)
  ↓
PyPDFLoader
  ↓
RecursiveCharacterTextSplitter
  - chunk size: 1500 chars
  - overlap: 200 chars
  ↓
Gemini Embedding 001
  - 2048 dimensions
  ↓
Firestore vector store
```

Current corpus:

```text
3 analyzer IFUs
- AU5812
- AU680
- DxI 800

~1,485 chunks
```

Current metadata:

```text
text
embedding
source
page
```

Current deduplication:

```text
MD5(content) → Firestore document ID
```

## 2.2 Current retrieval pipeline

```text
Query
  ↓
Gemini Embedding 001
  ↓
┌──────────────────────┐
│ Firestore vector top20│
└───────────┬──────────┘
            │
            │      BM25 top20
            │          │
            └────┬─────┘
                 ↓
          merge + dedupe
                 ↓
     BGE reranker v2-m3
        ~2.27 GB model
                 ↓
              top 5
                 ↓
              Agent
```

Known weaknesses:

- BM25 index rebuilt on first request
- BM25 state lost on restart
- large BGE model increases image size and cold-start risk
- local reranking benefits from MPS but Cloud Run will not
- no formal retrieval evaluation
- no persistent conversation history
- limited frontend visibility into agent/tool execution
- no backend quota enforcement

## 2.3 Current agent layer

```text
Google ADK LlmAgent
Gemini 2.5 Flash

Tools:
├─ search_knowledge_base
├─ web_search (Tavily)
└─ ask_clarification
```

Current behavior:

- single-agent routing
- sequential tool use
- in-memory ADK sessions
- web fallback possible
- SSE streaming of final output

## 2.4 Current serving layer

```text
React UI
  ↓
FastAPI
  ↓
/chat/stream
  ↓
SSE
  ↓
ADK Runner
```

Target production runtime:

```text
Cloud Run
```

---

# 3. Design Principles

## 3.1 Prefer managed GCP services where they remove real operational burden

Use managed services when they materially improve:

- latency
- deployment simplicity
- reliability
- security
- observability

Avoid managed services that exist only to add architecture complexity.

## 3.2 Keep the agent interface stable

The agent should call a stable application interface such as:

```python
search_knowledge_base(
    query: str,
    analyzer: str | None = None
) -> SearchResult
```

The agent should not care whether the implementation uses:

```text
legacy Firestore/BM25/BGE
```

or:

```text
Agent Retrieval
```

## 3.3 Deterministic software should handle deterministic work

Examples:

```text
AU 5812 → AU5812
DxI → DXI800
```

should be normalized by code rather than by an additional LLM call.

Do not introduce unnecessary classifier agents.

## 3.4 User-facing observability is not chain-of-thought

The UI may show:

```text
Understanding request…
Searching analyzer documentation…
Found relevant sources…
Checking current web sources…
Generating grounded response…
```

Do not expose:

- private model reasoning
- hidden chain-of-thought
- raw model prompts
- internal secrets
- raw tool payloads

## 3.5 Optimize for a small project budget

Target incremental spend:

```text
~$5–10/month
```

Avoid:

- GPUs
- always-on VMs
- Kubernetes
- Redis unless later justified
- Cloud Armor for the current phase
- expensive managed clusters

---

# 4. Target Architecture

## 4.1 V2 target

```text
                    USER
                      │
                      ▼
                   React
                      │
          request quota + UI state
                      │
                      ▼
                 Cloud Run
              FastAPI + ADK
                      │
              backend rate limit
                      │
                      ▼
                 ADK Agent
            ┌─────────┼─────────┐
            │         │         │
            ▼         ▼         ▼
        Convers.   Internal   External
        response      KB       search
            │         │         │
            │         ▼         ▼
            │    Agent Retrieval Tavily
            │         │
            │    hybrid retrieval
            │         ↓
            │        RRF
            │         ↓
            │    VertexRanker
            │
            └─────────┴─────────┐
                                ▼
                         Gemini 2.5 Flash
                                │
                            SSE stream
                                │
                                ▼
                              React
```

Persistent conversation state:

```text
Agent Platform Sessions
```

Supporting GCP services:

```text
Cloud Run
Vertex AI / Gemini
Agent Retrieval
Agent Platform Sessions
Artifact Registry
Secret Manager
IAM
Cloud Logging
Firestore (rate limits / lightweight app data if needed)
```

## 4.2 V3 target additions

```text
Google Search grounding
Cloud Speech-to-Text
optional Cloud Text-to-Speech
```

Final input paths:

```text
Keyboard ───────────────┐
                        ├─→ existing chat pipeline
Microphone → STT ───────┘
```

---

# 5. Updated Retrieval and Reranking Design

## 5.1 Legacy path

Current:

```text
Firestore semantic search
+
BM25 lexical search
+
manual merge
+
BGE reranker
```

This implementation should remain temporarily available for comparison and rollback.

## 5.2 Managed V2 production path

Target:

```text
Agent Retrieval
├─ semantic retrieval
├─ lexical retrieval
├─ RRF fusion
└─ VertexRanker semantic reranking
```

Conceptual replacement:

```text
Firestore vectors        → managed semantic retrieval
BM25                     → managed lexical retrieval
custom merge             → RRF
BGE cross-encoder        → VertexRanker
```

Expected benefits:

- remove local 2.27 GB reranker
- remove BM25 rebuild lifecycle
- reduce Cloud Run container size
- improve cold-start behavior
- reduce application-level retrieval maintenance
- keep retrieval fully within the GCP ecosystem

---

# 6. Document Metadata Design

During migration, enrich every chunk.

Required fields:

```text
document_id
document_title
manufacturer
analyzer
document_type
section
subsection
page
revision
source
chunk_text
```

Optional later:

```text
effective_date
language
model_family
manual_type
```

Canonical analyzer examples:

```text
AU5812
AU680
DXI800
```

Alias normalization:

```text
5812
AU 5812
AU5812
→ AU5812

AU 680
AU680
→ AU680

DXI
DxI 800
DXI800
→ DXI800
```

When an analyzer is explicitly identified, use it as a retrieval filter.

When no analyzer is confidently identified, do not force a filter.

---

# 7. Citation Design

Every retrieved result must include enough provenance for the final answer to cite the original document.

Example:

```python
{
    "text": "...",
    "document_id": "au5812_ifu",
    "title": "AU5812 Instructions for Use",
    "manufacturer": "Beckman Coulter",
    "analyzer": "AU5812",
    "section": "Weekly Maintenance",
    "page": 241,
    "revision": "..."
}
```

Expected displayed citation:

```text
AU5812 Instructions for Use
Section: Weekly Maintenance
Page: 241
Revision: X
```

Gemini should never infer missing citation metadata.

---

# 8. Routing and Tool Selection

## 8.1 Do not search the KB for casual messages

Examples:

```text
hello
hi
thanks
what can you do?
who are you?
help
good morning
```

Desired routing:

```text
User message
├─ greeting / casual → Gemini only
├─ capability question → Gemini only
├─ analyzer / IFU question → internal KB
├─ current external question → web search
├─ internal-vs-external comparison → both
└─ genuinely ambiguous request → clarification
```

Avoid a separate LLM classification call unless required.

Use:

- good ADK tool descriptions
- good agent instructions
- deterministic fast paths for trivial messages

## 8.2 Do not treat sequential routing as a problem yet

Do not automatically parallelize:

```text
internal KB + web
```

for every query.

Use both only when the task benefits from both.

Reasons:

- lower cost
- lower latency
- cleaner provenance
- fewer irrelevant sources
- simpler debugging

---

# 9. Persistent Conversation Design

## 9.1 V2: Agent Platform Sessions

Replace:

```text
InMemorySessionService
```

with:

```text
Agent Platform Sessions
```

Use Sessions for:

- persistent chat history
- resume previous conversation
- serverless instance independence
- chat sidebar later
- session-level state

Example:

```text
Browser session_id=abc
     ↓
Cloud Run instance A
     ↓
Agent Platform Session abc

instance A terminates

Browser session_id=abc
     ↓
Cloud Run instance B
     ↓
same Agent Platform Session abc
```

## 9.2 Do not add Memory Bank yet

Memory Bank is for durable cross-session facts such as:

```text
"user primarily works with AU5812"
```

That is not required for the main IFU use case.

V2 requirement:

```text
Persistent conversations: YES
Cross-chat personalization: NO
```

Memory Bank may be evaluated later if a real use case emerges.

---

# 10. Rate Limiting and Abuse Protection

Cloud Armor is explicitly out of scope for now.

Protection should exist at both UX and backend layers.

## 10.1 User-facing daily quota

Example UI:

```text
7 / 10 requests remaining
```

or:

```text
Requests
7 / 10
Resets in 8h 23m
```

The backend is authoritative.

Example API response:

```json
{
  "limit": 10,
  "used": 3,
  "remaining": 7,
  "reset_at": "..."
}
```

Do not rely on localStorage as the enforcement mechanism.

## 10.2 Backend daily quota

Initial rule:

```text
10 requests / 24 hours / client
```

Store quota state in Firestore.

Suggested fields:

```text
client_id
window_start
request_count
updated_at
```

Use an atomic Firestore transaction or atomic increment.

## 10.3 Burst limit

Suggested initial policy:

```text
3 requests / minute / client
```

## 10.4 Concurrency control

Suggested initial policy:

```text
1 active generation / session
```

Prevent duplicate requests caused by:

- double clicking
- repeated submit
- scripted spam
- accidental rapid retries

## 10.5 Rate-limit response

Return:

```http
429 Too Many Requests
```

Example:

```json
{
  "error": "rate_limit_exceeded",
  "remaining": 0,
  "reset_at": "..."
}
```

The frontend should display the reset time clearly.

---

# 11. User-Facing Agent Observability

The frontend should show safe execution status.

Examples:

```text
Understanding your request…
Searching analyzer documentation…
Found 5 relevant passages…
Checking current web sources…
Generating grounded response…
```

## 11.1 SSE event model

Extend the existing SSE protocol.

Example events:

```json
{
  "type": "status",
  "stage": "routing",
  "message": "Understanding your request…"
}
```

```json
{
  "type": "tool_start",
  "tool": "search_knowledge_base",
  "message": "Searching analyzer documentation…"
}
```

```json
{
  "type": "tool_result",
  "tool": "search_knowledge_base",
  "result_count": 5
}
```

```json
{
  "type": "tool_start",
  "tool": "google_search",
  "message": "Checking current web sources…"
}
```

```json
{
  "type": "generation_start",
  "message": "Generating grounded response…"
}
```

```json
{
  "type": "token",
  "text": "According to..."
}
```

```json
{
  "type": "done"
}
```

## 11.2 UI rules

For:

```text
hello
```

show no KB search activity.

For:

```text
How do I clean the AU5812 probe?
```

show:

```text
Searching analyzer documentation…
Found relevant sources…
Generating response…
```

For:

```text
Compare our IFU with current manufacturer guidance.
```

show:

```text
Searching analyzer documentation…
Checking current web sources…
Generating response…
```

## 11.3 Tool summary

Optionally show after completion:

```text
Tools used
• Internal Knowledge Search
• Google Search
```

Do not show:

- hidden reasoning
- prompts
- raw arguments
- internal confidence heuristics
- secrets

---

# 12. Operator Observability

Use the same execution lifecycle for backend logging.

Required structured fields:

```text
request_id
session_id
route
kb_used
web_used
clarification_used
analyzer
retrieval_result_count
routing_ms
retrieval_ms
web_search_ms
gemini_ttft_ms
generation_ms
total_ms
status_code
error_type
```

Example:

```text
request_id=abc123
session_id=s1
kb_used=true
web_used=false
analyzer=AU5812
retrieval_ms=92
gemini_ttft_ms=580
total_ms=1390
```

---

# 13. Required Security and Operations Baseline

These are required for the deployed version.

## 13.1 Dedicated service account

Cloud Run should use a dedicated service account.

Grant only the permissions required for:

```text
Vertex AI / Gemini
Agent Retrieval
Agent Platform Sessions
logging
Secret Manager access if needed
```

Do not use broad Owner or Editor permissions.

## 13.2 Secret Manager

Store external API secrets such as:

```text
TAVILY_API_KEY
```

in Secret Manager.

Never put secrets in:

```text
frontend code
Docker image
Git repository
committed .env
```

## 13.3 Environment configuration

Keep runtime configuration outside application code.

Examples:

```text
GCP_PROJECT_ID
GCP_REGION
GEMINI_MODEL
RETRIEVAL_PROVIDER
DAILY_REQUEST_LIMIT
BURST_REQUEST_LIMIT
LOG_LEVEL
ENVIRONMENT
```

## 13.4 Request timeouts

Apply explicit timeouts to:

```text
Agent Retrieval
Gemini
Tavily / Google Search path
Speech services later
```

No external call should hang indefinitely.

## 13.5 Controlled errors

Examples:

```text
retrieval unavailable
→ controlled KB unavailable response

external search unavailable
→ continue with internal data if possible

Gemini unavailable
→ controlled API error

rate limit exceeded
→ 429
```

## 13.6 Structured Cloud Logging

Structured logs and request IDs are required.

Avoid logging sensitive raw content unnecessarily.

## 13.7 Health endpoint

Required:

```text
GET /health
```

It should verify the process is alive.

Do not make expensive LLM/retrieval calls from `/health`.

## 13.8 Artifact Registry

Production Docker images should be stored/versioned in Artifact Registry.

Example tags:

```text
v2.0.0
latest
git SHA
```

---

# 14. Recommended Later Operational Polish

Not required for the first successful deployment:

```text
GitHub Actions CI/CD
/ready readiness endpoint
retry/backoff
Cloud Monitoring dashboard
alerts
deeper tracing
```

These should follow only after the core system works.

---

# 15. V3 Google Search Grounding

Tavily remains the V2 external web search implementation.

In V3, evaluate replacing Tavily with:

```text
Google Search grounding
```

Target architecture:

```text
ADK Agent
├─ Internal Knowledge
│    └─ Agent Retrieval
└─ External Current Information
     └─ Google Search grounding
```

Expected advantages:

- tighter Gemini integration
- native grounding metadata
- stronger GCP-native architecture
- fewer third-party dependencies

Do not remove Tavily until the Google path is tested.

Suggested config:

```text
WEB_SEARCH_PROVIDER=tavily|google
```

Evaluate:

```text
search quality
citation quality
latency
cost
failure behavior
```

---

# 16. V3 Voice Input

Voice should be another input method, not another agent.

## 16.1 Architecture

```text
Keyboard ───────────────────┐
                            ├→ normal chat pipeline
Microphone → Speech-to-Text ┘
```

## 16.2 Initial UX

Use push-to-talk:

```text
click record
→ speak
→ stop
→ transcribe
→ show transcript
→ allow edit
→ submit
```

Do not auto-submit initially.

## 16.3 Google Cloud Speech-to-Text

Speech output should become:

```python
transcript: str
```

Then reuse:

```text
existing /chat/stream
ADK agent
Agent Retrieval
Google/Tavily web search
Gemini
```

No voice-specific agent is needed.

## 16.4 Domain terminology testing

Test terms such as:

```text
AU5812
AU680
DxI 800
ISE
cuvette
photocal
sample probe
reagent probe
quality control
calibration
```

If recognition is weak, evaluate speech phrase hints/adaptation.

## 16.5 Audio retention

Default:

```text
record
→ transcribe
→ discard temporary audio
```

Do not persist recordings without a concrete requirement.

## 16.6 Optional TTS

After voice input is stable, optionally add:

```text
Read answer
```

using Google Cloud Text-to-Speech.

Keep citations visible even when the answer is spoken.

---

# 17. Evaluation Strategy

Do not introduce a heavy evaluation framework initially.

Create a lightweight test dataset of approximately:

```text
30–50 queries
```

## 17.1 Query categories

Include:

```text
direct IFU lookup
paraphrased lookup
maintenance
troubleshooting
exact analyzer terminology
ambiguous analyzer query
cross-analyzer confusion
unsupported query
greeting
capability question
current external information
internal-vs-external comparison
```

## 17.2 Example test

```json
{
  "question": "How do I perform weekly maintenance on the AU5812?",
  "expected_analyzer": "AU5812",
  "expected_document": "au5812_ifu",
  "expected_section": "Weekly Maintenance",
  "should_call_kb": true,
  "should_call_web": false
}
```

Greeting:

```json
{
  "question": "hello",
  "should_call_kb": false,
  "should_call_web": false
}
```

External:

```json
{
  "question": "What is the latest manufacturer guidance for this analyzer?",
  "should_call_web": true
}
```

## 17.3 Retrieval metrics

Track:

```text
correct document in top 5
correct analyzer in top 5
correct section/page in top 5
Recall@5
MRR
source accuracy
citation accuracy
```

## 17.4 Routing metrics

Track:

```text
KB routing accuracy
web-search routing accuracy
clarification frequency
unnecessary tool invocation rate
```

## 17.5 Latency metrics

Track:

```text
routing latency
retrieval latency
web-search latency
Gemini TTFT
generation latency
total response latency
cold-start latency
warm-request latency
```

## 17.6 Rate-limit tests

Test:

```text
request 1–10 accepted
request 11 rejected with 429
quota count updates correctly
quota resets correctly
burst limit triggers
concurrent duplicate generation rejected
UI matches backend remaining count
```

## 17.7 Session tests

Test:

```text
create conversation
send several messages
restart/replace Cloud Run instance
resume same session
conversation context remains available
```

## 17.8 Observability tests

Test:

```text
hello
→ no KB status

IFU question
→ tool_start KB
→ tool_result
→ generation_start
→ token stream
→ done

external comparison
→ KB status
→ web-search status
→ generation
```

---

# 18. Phased Implementation Plan

# Phase 0 — Baseline and Freeze

## Goal

Create a stable baseline before changing retrieval.

## Tasks

- document current architecture
- preserve current working branch/tag
- add retrieval-provider interface
- add feature flag for legacy retrieval
- add basic timing logs if not already present
- record current Docker/dependency size if available
- create first 20–30 evaluation queries

## Acceptance criteria

- existing app still works unchanged
- evaluation runner can execute against current system
- baseline latency numbers are captured
- legacy retrieval can be selected by configuration

---

# Phase 1 — Routing and Metadata

## Goal

Improve routing correctness and document provenance before managed retrieval migration.

## Tasks

- add deterministic analyzer alias normalization
- enrich ingestion metadata
- add citation structure
- improve ADK tool descriptions
- add no-KB routing for greetings/capability questions
- add routing tests

## Acceptance criteria

```text
hello → no KB
what can you do? → no KB
AU5812 maintenance question → KB
external-current question → web search
```

Citations contain:

```text
document
section
page
revision when available
```

---

# Phase 2 — Agent Retrieval Migration

## Goal

Replace the operationally heavy custom search stack.

## Tasks

- implement Agent Retrieval provider
- ingest/index analyzer documents
- configure semantic + lexical retrieval
- enable RRF fusion
- enable VertexRanker
- preserve same SearchResult interface
- keep legacy retriever behind flag
- run evaluation against both systems

## Acceptance criteria

- production provider can be switched by configuration
- managed retrieval meets acceptable source accuracy
- BGE is no longer required for managed path
- BM25 is no longer required for managed path
- managed retrieval latency is recorded
- citations survive retrieval migration

## Rollback

Set:

```text
RETRIEVAL_PROVIDER=legacy
```

---

# Phase 3 — Persistent Sessions

## Goal

Make conversation state serverless-safe.

## Tasks

- replace in-memory session service
- integrate Agent Platform Sessions
- preserve browser/session IDs
- add resume-conversation behavior
- add session failure handling

## Acceptance criteria

- Cloud Run instance replacement does not destroy chat history
- same session ID resumes previous context
- separate sessions remain isolated
- invalid session IDs fail safely

---

# Phase 4 — Rate Limiting

## Goal

Protect model/retrieval APIs from spam and keep cost predictable.

## Tasks

- add Firestore quota records
- add atomic daily counter
- add daily limit (initially 10/24h)
- add burst limit (initially 3/min)
- add one-active-generation/session rule
- add 429 response contract
- add quota endpoint or quota data in chat response
- show remaining requests in React

## Acceptance criteria

```text
quota state shown correctly
requests 1–10 accepted
11th denied
burst abuse denied
double-submit protected
UI count matches backend
```

---

# Phase 5 — User and Operator Observability

## Goal

Make agent execution visible and debuggable.

## Tasks

- define SSE event schema
- emit routing status
- emit tool start/result events
- emit generation start
- preserve token streaming
- add request IDs
- add structured Cloud Logging
- add latency timings
- add tool-usage logging

## Acceptance criteria

User sees:

```text
Searching analyzer documentation…
Checking current web sources…
Generating grounded response…
```

when applicable.

Backend logs include:

```text
request_id
tool usage
retrieval_ms
gemini_ttft_ms
total_ms
errors
```

No private model reasoning is exposed.

---

# Phase 6 — Cloud Run Production Deployment

## Goal

Deploy the managed architecture using a minimal production security baseline.

## Tasks

- create production Dockerfile
- remove BGE dependencies from managed production image
- push image to Artifact Registry
- create dedicated service account
- apply least-privilege IAM
- configure Secret Manager
- configure environment variables
- add `/health`
- add request timeouts
- add controlled errors
- deploy to Cloud Run
- verify SSE
- benchmark cold and warm requests

## Acceptance criteria

- app runs on Cloud Run
- Agent Retrieval works from Cloud Run
- Sessions work
- secrets are not in source/image/frontend
- service account is not Owner/Editor
- `/health` succeeds
- timeouts work
- structured logs appear
- cold/warm latency measured

---

# Phase 7 — Corpus Expansion and Regression Testing

## Goal

Make retrieval more realistic.

## Tasks

Expand from:

```text
3 IFUs
```

to approximately:

```text
8–15 analyzer manuals
```

Add evaluation cases for:

- similar analyzer names
- overlapping maintenance terminology
- troubleshooting questions
- exact error terminology
- wrong-analyzer distractors

## Acceptance criteria

- regression suite still passes
- routing remains correct
- retrieval source accuracy remains acceptable
- latency remains within target range

---

# Phase 8 — V3 Google Search Grounding

## Goal

Evaluate an all-GCP external grounding path.

## Tasks

- implement Google Search grounding provider
- preserve Tavily provider
- add `WEB_SEARCH_PROVIDER`
- test current-information questions
- compare citations
- compare latency
- compare cost
- compare quality
- switch default only if clearly beneficial

## Acceptance criteria

- both providers can be selected
- Google-grounded answers include usable source provenance
- internal-only questions do not trigger web search
- comparison questions can use internal + external evidence
- migration does not break existing citations

---

# Phase 9 — V3 Voice Input

## Goal

Add voice as a second input method using GCP Speech-to-Text.

## Tasks

- add microphone UI
- implement push-to-talk
- send audio for transcription
- populate existing text field
- allow transcript editing
- reuse same chat endpoint
- test domain terminology
- add speech latency logs
- discard temporary audio
- optionally evaluate phrase hints

## Acceptance criteria

- typed input is unchanged
- microphone path works
- transcript can be edited
- "hello" voice input still skips KB
- analyzer voice query triggers correct retrieval
- no empty transcript is sent
- temporary audio is not retained

---

# Phase 10 — Optional Final Polish

Only after all prior phases are stable.

Possible additions:

```text
GitHub Actions CI/CD
readiness endpoint
retry/backoff
Cloud Monitoring dashboard
Text-to-Speech
chat-history sidebar
Memory Bank experiment
```

Do not add them simply to increase architecture complexity.

---

# 19. Suggested Repository Structure

```text
backend/
├─ app/
│  ├─ api/
│  │  ├─ chat.py
│  │  ├─ health.py
│  │  └─ quota.py
│  ├─ agent/
│  │  ├─ agent.py
│  │  ├─ instructions.py
│  │  └─ events.py
│  ├─ retrieval/
│  │  ├─ interface.py
│  │  ├─ models.py
│  │  ├─ legacy_retriever.py
│  │  └─ agent_retrieval.py
│  ├─ search/
│  │  ├─ interface.py
│  │  ├─ tavily_search.py
│  │  └─ google_grounded_search.py
│  ├─ sessions/
│  │  └─ session_service.py
│  ├─ rate_limit/
│  │  ├─ service.py
│  │  └─ models.py
│  ├─ observability/
│  │  ├─ logging.py
│  │  └─ timing.py
│  ├─ speech/
│  │  └─ speech_to_text.py
│  └─ config.py
├─ tests/
│  ├─ evaluation/
│  │  ├─ dataset.json
│  │  └─ runner.py
│  ├─ test_routing.py
│  ├─ test_rate_limits.py
│  ├─ test_sessions.py
│  └─ test_retrieval.py
└─ Dockerfile

frontend/
├─ src/
│  ├─ components/
│  │  ├─ ChatInput
│  │  ├─ AgentStatus
│  │  ├─ UsageCounter
│  │  └─ CitationList
│  └─ ...
```

Exact structure may be adapted to the existing repository.

Do not refactor solely to match this example.

---

# 20. Definition of Done

The project should be considered complete when the following core path works:

```text
User
  ↓
text or voice
  ↓
backend quota enforcement
  ↓
ADK routing
  ├─ conversational → Gemini only
  ├─ internal IFU → Agent Retrieval
  └─ current web → Google grounding/Tavily
  ↓
Gemini grounded response
  ↓
SSE status + token stream
  ↓
citations
  ↓
persistent Agent Platform Session
```

Required production characteristics:

- managed retrieval and reranking
- no local BGE dependency in production
- no BM25 startup rebuild in production
- persistent chat sessions
- backend daily/burst rate limiting
- visible quota counter
- user-facing tool/status observability
- structured backend logging
- request IDs
- least-privilege service account
- Secret Manager
- Artifact Registry
- request timeouts
- `/health`
- Cloud Run deployment
- lightweight evaluation suite
- measured cold/warm latency
- citation-grounded answers

---

# 21. Explicitly Out of Scope

Do not add at this stage:

```text
Cloud Armor
Kubernetes / GKE
GPU infrastructure
Redis
multi-agent supervisor architecture
parallel fan-out on every query
RAGAS/DeepEval unless later justified
Memory Bank by default
always-on Cloud Run minimum instances without measurement
```

These can be reconsidered only when a measured product need appears.

---

# 22. Final Project Story

The intended engineering progression is:

```text
V1 — Retrieval mechanics
Firestore vectors
+ BM25
+ BGE reranker
+ Gemini

        ↓

V2 — GCP-native production-style AI application
Agent Retrieval
+ RRF
+ VertexRanker
+ Google ADK
+ Gemini
+ Agent Platform Sessions
+ Cloud Run
+ IAM
+ Secret Manager
+ Artifact Registry
+ rate limiting
+ SSE observability
+ evaluation

        ↓

V3 — GCP-native multimodal and web-grounded experience
Google Search grounding
+ Speech-to-Text
+ optional Text-to-Speech
```

The strongest portfolio narrative is:

> Built a custom hybrid RAG pipeline to understand retrieval mechanics, then migrated the application to a managed GCP-native retrieval and agent architecture to improve serverless latency, persistence, observability, deployment simplicity, and operational reliability.

The final system should remain a **cloud/software engineering project that applies AI services**, rather than an ML research project.

---

# 23. Implementation Status (as of 2026-08-31)

## Current Architecture

```text
React UI (dark/light mode, SSE streaming, agent status, quota display)
  ↓
FastAPI on localhost (Cloud Run deployment pending)
  ↓
ADK LlmAgent (Gemini 2.5 Flash)
  ├─ search_knowledge_base
  │    ├─ analyzer alias normalization (deterministic)
  │    ├─ Firestore vector search (gemini-embedding-001, 2048d)
  │    ├─ BM25 hybrid search (cached via pickle)
  │    ├─ analyzer-based document filtering
  │    └─ Vertex AI Ranking API (semantic-ranker-512@latest)
  ├─ web_search (Tavily Python SDK)
  └─ ask_clarification
  ↓
Firestore: vectors + sessions + rate limits
```

## Repository Structure

```text
backend/
  app/
    config.py                    ✅ centralized env config
    main.py                      ✅ FastAPI app + lifespan
    api/
      chat.py                    ✅ /get, /chat/stream, /sessions, /quota
      health.py                  ✅ /health
    agent/
      agent.py                   ✅ LlmAgent + 3 tools
      instructions.py            ✅ agent system prompt
      normalizer.py              ✅ analyzer alias normalization
    retrieval/
      interface.py               ✅ SearchResult + RetrievalProvider ABC
      legacy_retriever.py        ✅ Firestore + BM25 + Vertex Ranker
      managed_retriever.py       ❌ not implemented (stub for Agent Retrieval)
    search/
      interface.py               ✅ WebResult + WebSearchProvider ABC
      tavily_search.py           ✅ Tavily implementation
      google_grounded_search.py  ❌ not implemented
    sessions/
      service.py                 ✅ session factory
      firestore_session_service.py ✅ custom Firestore sessions
    rate_limit/
      service.py                 ✅ Firestore-backed daily/burst/concurrent
      models.py                  ✅ QuotaState + QuotaResponse
    observability/
      events.py                  ✅ SSE event protocol (all types)
      logging.py                 ⚠️ partial (RequestContext exists, per-stage timings not wired)
  scripts/
    ingest.py                    ✅ PDF ingestion + BM25 cache
  tests/                         ❌ not created
  Dockerfile                     ⚠️ functional but missing non-root user, .dockerignore

frontend/
  src/components/
    ChatContainer.js             ✅ SSE events, dark/light mode, sidebar, quota
    ChatMessage.js               ✅ markdown rendering, tool usage chips
    MessageList.js               ✅ scrollable list + agent status
    MessageInput.js              ✅ styled input
    AgentStatus.js               ✅ tool execution indicators
    Sidebar.js                   ✅ chat history drawer
```

## Phase Completion

| Phase | Goal | Status | Notes |
|---|---|---|---|
| 0 | Baseline + repo restructure | ✅ DONE | Modular backend/, retrieval interface, feature flag |
| 1 | Routing + metadata + citations | ⚠️ PARTIAL | Normalizer ✅, greeting routing ✅, enriched metadata ❌, routing tests ❌ |
| 2 | Retrieval optimization | ⚠️ PARTIAL | BGE→Vertex Ranker ✅, BM25 cache ✅, Agent Retrieval migration ❌ (too expensive, deferred) |
| 3 | Persistent sessions | ✅ DONE | Custom Firestore sessions (not managed Agent Platform Sessions) |
| 4 | Rate limiting | ✅ DONE | Daily 10/24h, burst 3/min, concurrent 1/session, Firestore-backed |
| 5 | Observability | ⚠️ PARTIAL | SSE events ✅, user-facing status ✅, operator logging skeletal ❌ |
| 6 | Cloud Run deployment | ❌ NOT DONE | Dockerfile exists, /health exists; missing: Secret Manager, service account, .dockerignore, non-root user, request timeouts, deploy |
| 7 | Corpus expansion | ❌ NOT DONE | |
| 8 | Google Search grounding | ❌ NOT DONE | |
| 9 | Voice input | ❌ NOT DONE | |
| 10 | Final polish | ⚠️ PARTIAL | Chat sidebar ✅, dark/light mode ✅; CI/CD ❌, monitoring ❌ |

## Key Deviations from Original Design

### Agent Retrieval (RAG Engine) deferred

Research found:
- Spanner mode: ~$65/month (over budget)
- Serverless mode: us-central1 only (not available in us-west1)

Decision: keep Firestore + BM25 + Vertex Ranker. Retrieval provider interface allows swap when serverless reaches us-west1. Feature flag `RETRIEVAL_PROVIDER=legacy|managed` is in config.

### Sessions: custom Firestore, not Agent Platform Sessions

Custom `FirestoreSessionService` works and is free. Agent Platform Sessions require a deployed Reasoning Engine resource. Current approach is simpler and meets all requirements.

### Reranking: Vertex Ranking API, not local BGE

BGE cross-encoder (2.27GB) replaced with Vertex AI Ranking API. This removes the largest container dependency and eliminates cold-start model download. Cost: ~$3/month at 100 queries/day.

### Tavily: Python SDK, not MCP

MCP integration had registration issues with ADK 2.8.0. Direct Tavily Python SDK is simpler and more reliable.

## Remaining Work (Priority Order)

### High — Required for deployment

1. **Cloud Run deployment** (Phase 6)
   - Create dedicated service account with least-privilege IAM
   - Store TAVILY_API_KEY in Secret Manager
   - Add .dockerignore
   - Add non-root user to Dockerfile
   - Add request timeouts on Vertex AI, Tavily, Firestore calls
   - Deploy and verify SSE streaming works on Cloud Run
   - Measure cold/warm latency

2. **Operator logging** (Phase 5 completion)
   - Wire per-stage timing into RequestContext (routing_ms, retrieval_ms, gemini_ttft_ms)
   - Add structured log fields (kb_used, web_used, analyzer, status_code)
   - Verify Cloud Logging receives structured JSON

### Medium — Improves quality

3. **Enriched metadata** (Phase 1 completion)
   - Parse PDF section headers during ingestion
   - Store document_title, section, revision in Firestore chunks
   - Populate SearchResult fields beyond source/page
   - Display richer citations in responses

4. **Evaluation suite** (Phase 0/7)
   - Create 30-50 test queries with expected routing and retrieval behavior
   - Measure retrieval accuracy (correct document in top 5)
   - Measure routing accuracy (KB vs web vs clarification)

5. **Controlled error handling** (Phase 6)
   - Graceful fallback when Firestore/Vertex AI/Tavily unavailable
   - User-friendly error messages instead of raw exceptions

### Low — Future enhancements

6. **Google Search grounding** (Phase 8) — evaluate replacing Tavily
7. **Voice input** (Phase 9) — Cloud Speech-to-Text
8. **CI/CD** (Phase 10) — GitHub Actions
9. **Corpus expansion** (Phase 7) — add more analyzer manuals

## Cost (Current)

| Service | Monthly Cost |
|---|---|
| Firestore (vectors + sessions + rate limits) | $0 (free tier) |
| Gemini 2.5 Flash | ~$1-5 |
| Vertex AI Embedding | ~$0.01 |
| Vertex AI Ranking API | ~$1-3 |
| Cloud Run | $0 (free tier, once deployed) |
| Tavily | $0 (free tier) |
| **Total** | **~$2-8/month** |
