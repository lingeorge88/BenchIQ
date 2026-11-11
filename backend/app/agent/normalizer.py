import re

ANALYZER_ALIASES = {
    "AU5812": ["au5812", "au 5812", "5812", "5800", "au-5812", "au 5800", "au5800"],
    "AU680": ["au680", "au 680", "680", "au-680"],
    "DXI800": ["dxi800", "dxi 800", "dxi", "dxi-800", "unicel dxi", "unicel dxi 800", "access dxi", "access dxi 800"],
}

_LOOKUP = {}
for canonical, aliases in ANALYZER_ALIASES.items():
    _LOOKUP[canonical.lower()] = canonical
    for alias in aliases:
        _LOOKUP[alias.lower()] = canonical


def normalize_analyzer(text: str) -> str | None:
    cleaned = re.sub(r"[^\w\s]", " ", text.lower()).strip()
    cleaned = re.sub(r"\s+", " ", cleaned)

    if cleaned in _LOOKUP:
        return _LOOKUP[cleaned]

    for alias, canonical in sorted(_LOOKUP.items(), key=lambda x: -len(x[0])):
        if alias in cleaned:
            return canonical

    return None
