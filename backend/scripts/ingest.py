"""Document ingestion script. Run from the backend/ directory:
    python -m scripts.ingest
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
from langchain_community.document_loaders import PyPDFLoader, DirectoryLoader
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain.schema import Document
from app.retrieval.legacy_retriever import ingest_documents, clear_collection, save_bm25_cache
from typing import List

load_dotenv()

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data")


def load_pdfs(data_dir: str) -> List[Document]:
    loader = DirectoryLoader(data_dir, glob="*.pdf", loader_cls=PyPDFLoader)
    return loader.load()


def filter_metadata(docs: List[Document]) -> List[Document]:
    return [
        Document(
            page_content=doc.page_content,
            metadata={
                "source": doc.metadata.get("source"),
                "page": doc.metadata.get("page"),
            },
        )
        for doc in docs
    ]


def split_documents(docs: List[Document]) -> List[Document]:
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=1500,
        chunk_overlap=200,
        separators=["\n\n", "\n", ". ", " ", ""],
    )
    return splitter.split_documents(docs)


def main():
    print(f"Loading PDFs from {DATA_DIR}...")
    raw_docs = load_pdfs(DATA_DIR)
    filtered = filter_metadata(raw_docs)
    chunks = split_documents(filtered)

    print(f"Loaded {len(raw_docs)} pages, split into {len(chunks)} chunks")

    for chunk in chunks[:3]:
        print(f"  Chunk ({len(chunk.page_content)} chars): {chunk.page_content[:80]}...")
        print(f"  Metadata: {chunk.metadata}")

    print("Clearing existing documents...")
    deleted = clear_collection()
    print(f"  Deleted {deleted} existing documents")

    print(f"Ingesting {len(chunks)} chunks into Firestore...")
    ingested = ingest_documents(chunks)

    print("Saving BM25 cache...")
    save_bm25_cache(chunks)

    print(f"Done. {ingested} chunks ingested.")


if __name__ == "__main__":
    main()
