from google.adk.agents import LlmAgent
from app.retrieval.legacy_retriever import LegacyRetriever
from app.search.tavily_search import TavilySearch
from app.agent.instructions import AGENT_INSTRUCTION
from app.agent.normalizer import normalize_analyzer
from app import config
import logging

logger = logging.getLogger("medical_chat")

_retriever = LegacyRetriever()
_web_search = TavilySearch()


def search_knowledge_base(query: str) -> str:
    """Search the medical analyzer IFU documentation knowledge base.

    Use this tool when the user asks about specific medical laboratory analyzers,
    their procedures, specifications, maintenance, calibration, reagents, or
    troubleshooting. This searches the embedded IFU (Instructions for Use)
    documents for the AU5812, AU680, and DXI800 analyzers.

    Args:
        query: The search query about medical lab analyzer documentation.

    Returns:
        Relevant passages from the IFU documentation, or a message indicating
        no results were found (in which case you should use web_search).
    """
    try:
        analyzer = normalize_analyzer(query)
        results = _retriever.search(query, analyzer=analyzer, top_k=5)
    except Exception as e:
        logger.error(f"Knowledge base search failed: {type(e).__name__}: {e}")
        return (
            "The knowledge base is temporarily unavailable. "
            "You should use web_search to find the answer from the web instead."
        )

    if not results:
        return (
            "NO RESULTS FOUND in the knowledge base for this query. "
            "You MUST now use web_search to find the answer from the web."
        )

    formatted = []
    for r in results:
        citation_parts = []
        if r.document_title:
            citation_parts.append(r.document_title)
        elif r.source:
            citation_parts.append(r.source)
        if r.section:
            citation_parts.append(f"Section: {r.section}")
        if r.page is not None:
            citation_parts.append(f"Page: {r.page}")
        citation = ", ".join(citation_parts) if citation_parts else "Unknown source"
        formatted.append(f"[{citation}]\n{r.text}")

    output = "\n\n---\n\n".join(formatted)

    if results[0].score < 0.1:
        output += (
            "\n\n⚠️ LOW RELEVANCE: These results may not answer the query well. "
            "Consider using web_search to supplement with web results."
        )

    return output


def web_search(query: str) -> str:
    """Search the internet for information not found in the knowledge base.

    Use this tool when:
    - The knowledge base returned no results or low relevance results
    - The user asks about topics outside the IFU documentation
    - The user asks about FDA regulations, industry guidelines, best practices
    - The user asks about equipment comparisons or alternatives
    - You need current/recent information

    Args:
        query: The search query to find information on the web.

    Returns:
        Relevant information from web sources with URLs.
    """
    try:
        results = _web_search.search(query, max_results=5)
    except Exception as e:
        logger.error(f"Web search failed: {type(e).__name__}: {e}")
        return (
            "Web search is temporarily unavailable. "
            "Please answer based on knowledge base results if available, "
            "or let the user know that external sources could not be reached."
        )

    if not results:
        return "No web results found for this query."

    formatted = []
    for r in results:
        formatted.append(f"[{r.title}]({r.url})\n{r.content}")

    return "\n\n---\n\n".join(formatted)


def ask_clarification(question: str) -> str:
    """Ask the user a clarifying question when their query is too vague or ambiguous.

    Use this tool ONLY when the user's question is genuinely unclear, too broad,
    or could refer to multiple analyzers or procedures and you cannot determine
    what they need.

    Args:
        question: The clarifying question to ask the user.

    Returns:
        A signal that clarification is needed.
    """
    return f"I need a bit more information to help you: {question}"


root_agent = LlmAgent(
    model=config.GEMINI_MODEL,
    name="medical_assistant",
    description="Medical laboratory analyzer specialist with access to IFU documentation and web search.",
    instruction=AGENT_INSTRUCTION,
    tools=[search_knowledge_base, web_search, ask_clarification],
)
