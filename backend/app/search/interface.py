from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import List


@dataclass
class WebResult:
    title: str
    url: str
    content: str


class WebSearchProvider(ABC):
    @abstractmethod
    def search(self, query: str, max_results: int = 5) -> List[WebResult]:
        ...
