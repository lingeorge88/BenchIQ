from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import List


@dataclass
class SearchResult:
    text: str
    source: str = ""
    page: int | None = None
    document_title: str = ""
    analyzer: str = ""
    section: str = ""
    revision: str | None = None
    score: float = 0.0


class RetrievalProvider(ABC):
    @abstractmethod
    def search(self, query: str, analyzer: str | None = None, top_k: int = 5) -> List[SearchResult]:
        ...
