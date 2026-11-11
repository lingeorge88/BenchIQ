from google.cloud import firestore
from google.cloud import discoveryengine_v1 as discoveryengine
from google.cloud.firestore_v1.vector import Vector
from google.cloud.firestore_v1.base_vector_query import DistanceMeasure
from google import genai
from google.genai.types import EmbedContentConfig
from langchain_community.retrievers import BM25Retriever
from langchain.schema import Document
from app.retrieval.interface import RetrievalProvider, SearchResult
from app import config
from typing import List
import hashlib
import json
import logging
import pickle
import os

logger = logging.getLogger("medical_chat")

_DEFAULT_CACHE = os.path.join(os.path.dirname(__file__), "..", "..", "bm25_cache.pkl")
_TMP_CACHE = "/tmp/bm25_cache.pkl"

if os.path.exists(_DEFAULT_CACHE):
    BM25_CACHE_PATH = _DEFAULT_CACHE
elif config.ENVIRONMENT == "production":
    BM25_CACHE_PATH = _TMP_CACHE
else:
    BM25_CACHE_PATH = _DEFAULT_CACHE

_genai_client = None
_rank_client = None
_bm25_retriever = None


def _get_genai_client():
    global _genai_client
    if _genai_client is None:
        _genai_client = genai.Client(
            vertexai=True,
            project=config.GOOGLE_CLOUD_PROJECT,
            location=config.GOOGLE_CLOUD_LOCATION,
        )
    return _genai_client


def _get_firestore_client():
    return firestore.Client(
        project=config.GOOGLE_CLOUD_PROJECT,
        database="(default)",
    )


def _get_rank_client():
    global _rank_client
    if _rank_client is None:
        _rank_client = discoveryengine.RankServiceClient()
    return _rank_client


def embed_texts(texts: List[str]) -> List[List[float]]:
    client = _get_genai_client()
    all_embeddings = []
    batch_size = 50
    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        response = client.models.embed_content(
            model=config.EMBEDDING_MODEL,
            contents=batch,
            config=EmbedContentConfig(output_dimensionality=config.EMBEDDING_DIMENSION),
        )
        all_embeddings.extend([e.values for e in response.embeddings])
    return all_embeddings


def embed_query(text: str) -> List[float]:
    return embed_texts([text])[0]


def similarity_search(query_embedding: List[float], k: int = 20) -> List[Document]:
    db = _get_firestore_client()
    collection = db.collection(config.FIRESTORE_CHUNKS_COLLECTION)

    results = collection.find_nearest(
        vector_field="embedding",
        query_vector=Vector(query_embedding),
        distance_measure=DistanceMeasure.COSINE,
        limit=k,
    )

    docs = []
    for doc in results.stream(timeout=config.RETRIEVAL_TIMEOUT):
        data = doc.to_dict()
        docs.append(
            Document(
                page_content=data["text"],
                metadata={
                    "source": data.get("source"),
                    "page": data.get("page"),
                },
            )
        )
    return docs


def load_all_documents() -> List[Document]:
    db = _get_firestore_client()
    collection = db.collection(config.FIRESTORE_CHUNKS_COLLECTION)
    docs = []
    for doc in collection.stream():
        data = doc.to_dict()
        docs.append(
            Document(
                page_content=data["text"],
                metadata={
                    "source": data.get("source"),
                    "page": data.get("page"),
                },
            )
        )
    return docs


def save_bm25_cache(chunks: List[Document]):
    data = [{"text": c.page_content, "source": c.metadata.get("source"), "page": c.metadata.get("page")} for c in chunks]
    with open(BM25_CACHE_PATH, "wb") as f:
        pickle.dump(data, f)
    print(f"BM25 cache saved ({len(data)} chunks) to {BM25_CACHE_PATH}")


def _get_bm25():
    global _bm25_retriever
    if _bm25_retriever is None:
        if os.path.exists(BM25_CACHE_PATH):
            import time
            t = time.time()
            with open(BM25_CACHE_PATH, "rb") as f:
                data = pickle.load(f)
            chunks = [Document(page_content=d["text"], metadata={"source": d["source"], "page": d["page"]}) for d in data]
            _bm25_retriever = BM25Retriever.from_documents(chunks, k=20)
            print(f"BM25 loaded from cache ({len(chunks)} chunks) in {time.time()-t:.2f}s")
        else:
            chunks = load_all_documents()
            _bm25_retriever = BM25Retriever.from_documents(chunks, k=20)
            print(f"BM25 built from Firestore ({len(chunks)} chunks) — run ingestion to create cache")
    return _bm25_retriever


def _vertex_rerank(query: str, docs: List[Document], top_n: int = 5) -> List[tuple[float, Document]]:
    client = _get_rank_client()

    records = []
    for i, doc in enumerate(docs):
        records.append(
            discoveryengine.RankingRecord(
                id=str(i),
                content=doc.page_content[:512],
            )
        )

    request = discoveryengine.RankRequest(
        ranking_config=f"projects/{config.GOOGLE_CLOUD_PROJECT}/locations/global/rankingConfigs/default_ranking_config",
        model="semantic-ranker-512@latest",
        query=query,
        records=records,
        top_n=top_n,
    )

    response = client.rank(request=request, timeout=config.RETRIEVAL_TIMEOUT)

    scored = []
    for r in response.records:
        idx = int(r.id)
        scored.append((r.score, docs[idx]))

    return scored


def ingest_documents(chunks: List[Document]) -> int:
    db = _get_firestore_client()
    collection = db.collection(config.FIRESTORE_CHUNKS_COLLECTION)
    batch_size = 50
    ingested = 0

    for i in range(0, len(chunks), batch_size):
        batch = chunks[i : i + batch_size]
        texts = [chunk.page_content for chunk in batch]
        vectors = embed_texts(texts)

        fb_batch = db.batch()
        for chunk, vector in zip(batch, vectors):
            content_hash = hashlib.md5(chunk.page_content.encode()).hexdigest()
            doc_ref = collection.document(content_hash)
            fb_batch.set(doc_ref, {
                "text": chunk.page_content,
                "embedding": Vector(vector),
                "source": chunk.metadata.get("source"),
                "page": chunk.metadata.get("page"),
            })
        fb_batch.commit()

        ingested += len(batch)
        print(f"  [{ingested}/{len(chunks)}] chunks ingested")

    return ingested


def clear_collection():
    db = _get_firestore_client()
    collection = db.collection(config.FIRESTORE_CHUNKS_COLLECTION)
    deleted = 0
    for doc in collection.stream():
        doc.reference.delete()
        deleted += 1
    return deleted


ANALYZER_SOURCE_MAP = {
    "AU5812": "5812IFU",
    "AU680": "AU680-IFU",
    "DXI800": "DXI800IFU",
}


def _filter_by_analyzer(docs: List[Document], analyzer: str) -> List[Document]:
    source_pattern = ANALYZER_SOURCE_MAP.get(analyzer)
    if not source_pattern:
        return docs
    filtered = [d for d in docs if source_pattern in (d.metadata.get("source") or "")]
    return filtered if filtered else docs


class LegacyRetriever(RetrievalProvider):
    def search(self, query: str, analyzer: str | None = None, top_k: int = 5) -> List[SearchResult]:
        import time as _time
        t0 = _time.time()

        query_embedding = embed_query(query)
        embed_ms = round((_time.time() - t0) * 1000)

        t1 = _time.time()
        dense_docs = similarity_search(query_embedding, k=20)
        firestore_ms = round((_time.time() - t1) * 1000)

        try:
            bm25_docs = _get_bm25().invoke(query)
        except Exception:
            bm25_docs = []

        seen = set()
        merged = []
        for doc in dense_docs + bm25_docs:
            key = doc.page_content[:100]
            if key not in seen:
                seen.add(key)
                merged.append(doc)

        if analyzer:
            merged = _filter_by_analyzer(merged, analyzer)

        if not merged:
            return []

        t2 = _time.time()
        scored = _vertex_rerank(query, merged, top_n=top_k)
        rerank_ms = round((_time.time() - t2) * 1000)

        logger.info(json.dumps({
            "stage": "retrieval",
            "analyzer": analyzer,
            "dense_count": len(dense_docs),
            "bm25_count": len(bm25_docs),
            "merged_count": len(merged),
            "reranked_count": len(scored),
            "embed_ms": embed_ms,
            "firestore_ms": firestore_ms,
            "rerank_ms": rerank_ms,
            "total_ms": round((_time.time() - t0) * 1000),
        }))

        results = []
        for score, doc in scored:
            results.append(SearchResult(
                text=doc.page_content,
                source=doc.metadata.get("source", ""),
                page=doc.metadata.get("page"),
                score=float(score),
            ))
        return results
