from langdetect import detect, detect_langs, LangDetectException

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


def detect_language(text: str) -> str | None:
    """Detect the language of the given text."""
    try:
        lang = detect(text)
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
