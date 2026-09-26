"""Separate subtitle formatting tags from translatable text.

Translators must only see clean text, but position/italic tags have to survive
into the exported file. Tags that wrap the whole line (leading `{\\an8}`,
`<i>…</i>`, `{\\i1}…{\\i0}`) are moved to prefix/suffix and re-applied on
export. Tags in the middle of a line can't be mapped onto a translation, so
they are dropped from the clean text (the original stays in raw_text).
"""

import re

_LEADING_ASS = re.compile(r"^(\{[^}]*\})+")
_TRAILING_ASS = re.compile(r"(\{[^}]*\})+$")
_HTML_WRAP = re.compile(r"^(<(\w+)(?:\s[^>]*)?>)(.*)(</\2>)$", re.DOTALL | re.IGNORECASE)
_ANY_TAG = re.compile(r"\{[^}]*\}|</?\w+(?:[\s.][^>]*)?>")


def split_tags(text: str) -> tuple[str, str, str]:
    """Return (clean, prefix, suffix) such that prefix + clean + suffix ≈ text."""
    body = text.strip()
    prefix = ""
    suffix = ""

    while True:
        changed = False
        m = _LEADING_ASS.match(body)
        if m:
            prefix += m.group(0)
            body = body[m.end():]
            changed = True
        m = _TRAILING_ASS.search(body)
        if m and m.start() > 0:
            suffix = m.group(0) + suffix
            body = body[:m.start()]
            changed = True
        m = _HTML_WRAP.match(body)
        # "<i>A</i> B <i>C</i>" also matches the regex; only a true wrapper has
        # no closing tag of the same name inside it
        if m and f"</{m.group(2).lower()}" not in m.group(3).lower():
            prefix += m.group(1)
            suffix = m.group(4) + suffix
            body = m.group(3)
            changed = True
        if not changed:
            break

    clean = _ANY_TAG.sub("", body).strip()
    return clean, prefix, suffix


def has_inline_tags(text: str) -> bool:
    clean, prefix, suffix = split_tags(text)
    body = text.strip()
    if prefix and body.startswith(prefix):
        body = body[len(prefix):]
    if suffix and body.endswith(suffix):
        body = body[: -len(suffix)]
    return bool(_ANY_TAG.search(body))
