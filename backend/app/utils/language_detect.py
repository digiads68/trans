from langdetect import detect, LangDetectException

# Map langdetect codes to human-readable names
LANG_NAMES = {
    "zh-cn": "Chinese (Simplified)",
    "zh-tw": "Chinese (Traditional)",
    "en": "English",
    "ko": "Korean",
    "ja": "Japanese",
    "th": "Thai",
    "vi": "Vietnamese",
    "fr": "French",
    "de": "German",
    "es": "Spanish",
    "pt": "Portuguese",
    "ru": "Russian",
    "ar": "Arabic",
    "hi": "Hindi",
    "id": "Indonesian",
    "ms": "Malay",
}

# Map for translation APIs
LANG_CODE_MAP = {
    "zh-cn": "zh",
    "zh-tw": "zh-TW",
    "ko": "ko",
    "ja": "ja",
    "en": "en",
    "th": "th",
    "vi": "vi",
    "fr": "fr",
    "de": "de",
    "es": "es",
}


def _detect_cjk_script(text: str) -> str | None:
    """Identify CJK language by counting dominant Unicode script blocks.

    Returns 'ko', 'ja', 'zh-cn', or None if no strong CJK signal.
    Checked before langdetect because short CJK texts confuse that library.
    """
    hangul = 0
    hiragana_katakana = 0
    cjk_unified = 0

    for ch in text:
        cp = ord(ch)
        if 0xAC00 <= cp <= 0xD7A3 or 0x1100 <= cp <= 0x11FF or 0x3130 <= cp <= 0x318F:
            hangul += 1
        elif 0x3040 <= cp <= 0x309F or 0x30A0 <= cp <= 0x30FF:
            hiragana_katakana += 1
        elif 0x4E00 <= cp <= 0x9FFF or 0x3400 <= cp <= 0x4DBF or 0xF900 <= cp <= 0xFAFF:
            cjk_unified += 1

    total_cjk = hangul + hiragana_katakana + cjk_unified
    if total_cjk < 3:
        return None  # not enough CJK content to decide

    if hangul > cjk_unified and hangul > hiragana_katakana:
        return "ko"
    if hiragana_katakana > hangul:
        return "ja"
    if cjk_unified > 0:
        # Could be Chinese or Japanese kanji-only; if no kana, assume Chinese
        return "zh-cn"
    return None


def detect_language(text: str) -> str | None:
    """Detect the language of the given text.

    Uses script-based detection first for CJK languages (more reliable for
    short texts), then falls back to langdetect for everything else.
    """
    cjk = _detect_cjk_script(text)
    if cjk:
        return cjk
    try:
        lang = detect(text)
        # langdetect sometimes returns 'zh-cn'/'zh-tw' which is fine; keep them
        return lang
    except LangDetectException:
        return None


def detect_language_from_entries(texts: list[str]) -> str | None:
    """Detect language from a list of subtitle texts by sampling evenly."""
    if not texts:
        return None
    # Sample evenly from beginning, middle, and end for better accuracy
    n = len(texts)
    if n <= 15:
        sample = texts
    else:
        indices = (
            list(range(0, 5))  # first 5
            + [n // 4, n // 3, n // 2, n * 2 // 3, n * 3 // 4]  # spread through middle
            + list(range(max(n - 5, 5), n))  # last 5
        )
        sample = [texts[i] for i in sorted(set(indices)) if i < n]
    combined = " ".join(sample)
    return detect_language(combined)


def get_lang_name(code: str) -> str:
    """Get human-readable language name from code."""
    return LANG_NAMES.get(code, code)
