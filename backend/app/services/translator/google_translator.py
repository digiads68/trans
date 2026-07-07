import asyncio
import logging
import re
from typing import Optional

from deep_translator import GoogleTranslator as DeepGoogleTranslator

from app.models.schemas import SubtitleEntry, TranslationMode
from .base import BaseTranslator, TranslationCancelled, TranslationFailed
from app.services.cache import get_cached, set_cached

logger = logging.getLogger(__name__)

# Map langdetect codes to Google Translate codes
GOOGLE_LANG_MAP = {
    "zh-cn": "zh-CN",
    "zh-tw": "zh-TW",
    "zh": "zh-CN",
    "ko": "ko",
    "ja": "ja",
    "en": "en",
    "vi": "vi",
    "th": "th",
    "fr": "fr",
    "de": "de",
    "es": "es",
    "pt": "pt",
    "ru": "ru",
}

TRANSLATE_TIMEOUT = 30  # seconds per request
MAX_RETRIES = 2

# Lines are joined into one request with this sentinel to cut request volume
# ~50x (avoids Google rate-blocking mid-film). Google preserves line structure
# well; if the split count mismatches we fall back to per-line for that group.
GROUP_SEPARATOR = "\n@@@\n"
SPLIT_PATTERN = re.compile(r"\s*\n?\s*@+\s*\n?\s*")
MAX_GROUP_CHARS = 3500
MAX_GROUP_LINES = 25


class GoogleTranslator(BaseTranslator):
    """Translator using Google Translate via deep-translator."""

    def __init__(self):
        self.cache_ctx = "google"

    @property
    def provider_name(self) -> str:
        return "Google Translate"

    def _map_lang(self, lang: str) -> str:
        if lang == "auto":
            return "auto"
        return GOOGLE_LANG_MAP.get(lang, lang)

    async def _translate_raw(self, text: str, source_lang: str, target_lang: str) -> str:
        """One Google request with timeout + retry on transient failures."""
        src = self._map_lang(source_lang)
        tgt = self._map_lang(target_lang)

        def _translate():
            translator = DeepGoogleTranslator(source=src, target=tgt)
            return translator.translate(text)

        last_exc: Optional[Exception] = None
        for attempt in range(MAX_RETRIES + 1):
            try:
                result = await asyncio.wait_for(
                    asyncio.to_thread(_translate),
                    timeout=TRANSLATE_TIMEOUT,
                )
                return result or text
            except (asyncio.TimeoutError, Exception) as e:
                last_exc = e
                if attempt < MAX_RETRIES:
                    await asyncio.sleep(1.0 * (attempt + 1))
        raise last_exc

    async def translate_text(self, text: str, source_lang: str, target_lang: str) -> str:
        """Translate a single text using Google Translate."""
        return await self._translate_raw(text, source_lang, target_lang)

    def _apply_glossary(self, text: str, glossary: dict[str, str]) -> str:
        """Apply glossary replacements to translated text."""
        for original_term, translated_term in glossary.items():
            pattern = re.compile(re.escape(original_term), re.IGNORECASE)
            text = pattern.sub(translated_term, text)
        return text

    def _make_groups(self, entries: list[SubtitleEntry]) -> list[list[SubtitleEntry]]:
        """Group entries so each group fits in one Google request."""
        groups: list[list[SubtitleEntry]] = []
        current: list[SubtitleEntry] = []
        current_chars = 0
        for entry in entries:
            length = len(entry.original_text) + len(GROUP_SEPARATOR)
            if current and (current_chars + length > MAX_GROUP_CHARS or len(current) >= MAX_GROUP_LINES):
                groups.append(current)
                current = []
                current_chars = 0
            current.append(entry)
            current_chars += length
        if current:
            groups.append(current)
        return groups

    async def _translate_group(
        self,
        group: list[SubtitleEntry],
        source_lang: str,
        target_lang: str,
    ) -> dict[int, str]:
        """Translate a group of lines in one request. Returns {index: translation}.

        Falls back to per-line translation when the joined result doesn't split
        back into the same number of lines.
        """
        # Single line: no joining needed
        if len(group) == 1:
            entry = group[0]
            translated = await self._translate_raw(entry.original_text, source_lang, target_lang)
            return {entry.index: translated}

        # Newlines inside a subtitle line would break the split — flatten them
        joined = GROUP_SEPARATOR.join(e.original_text.replace("\n", " ") for e in group)
        translated_joined = await self._translate_raw(joined, source_lang, target_lang)
        parts = [p.strip() for p in SPLIT_PATTERN.split(translated_joined)]
        parts = [p for p in parts if p]

        if len(parts) == len(group):
            return {e.index: p for e, p in zip(group, parts)}

        # Split mismatch — per-line fallback for this group
        logger.info(
            f"Google group split mismatch ({len(parts)} != {len(group)}), "
            f"falling back to per-line"
        )
        result: dict[int, str] = {}
        for entry in group:
            try:
                result[entry.index] = await self._translate_raw(
                    entry.original_text, source_lang, target_lang
                )
            except Exception as e:
                logger.error(f"Google per-line failed for entry {entry.index}: {e}")
        return result

    async def translate_batch(
        self,
        entries: list[SubtitleEntry],
        source_lang: str,
        target_lang: str,
        mode: TranslationMode = TranslationMode.STANDARD,
        on_progress=None,
        custom_prompt: Optional[str] = None,
        glossary: Optional[dict[str, str]] = None,
        should_cancel=None,
    ) -> list[SubtitleEntry]:
        """Translate all entries using Google Translate with grouped requests."""
        total = len(entries)
        completed = 0

        # Serve cache hits first
        uncached: list[SubtitleEntry] = []
        for entry in entries:
            cached = await get_cached(
                source_lang, target_lang, entry.original_text, context=self.cache_ctx
            )
            if cached is not None:
                entry.translated_text = (
                    self._apply_glossary(cached, glossary) if glossary else cached
                )
                completed += 1
            else:
                uncached.append(entry)

        if on_progress and completed:
            await on_progress(completed, total, "")

        consecutive_failures = 0
        for group in self._make_groups(uncached):
            if should_cancel and should_cancel():
                raise TranslationCancelled()

            try:
                translations = await self._translate_group(group, source_lang, target_lang)
                consecutive_failures = 0
            except Exception as e:
                logger.error(f"Google group translation failed: {e}")
                translations = {}
                consecutive_failures += 1
                if consecutive_failures >= 3:
                    raise TranslationFailed(
                        "Google Translate liên tục thất bại — có thể bị chặn tạm thời. "
                        "Đợi vài phút rồi thử lại, hoặc chuyển sang AI (LLM).",
                        original=e,
                    )

            for entry in group:
                translated = translations.get(entry.index)
                if translated:
                    await set_cached(
                        source_lang, target_lang, entry.original_text,
                        translated, context=self.cache_ctx,
                    )
                    if glossary:
                        translated = self._apply_glossary(translated, glossary)
                    entry.translated_text = translated
                # else: leave None → counted as failed by the job runner
                completed += 1

            if on_progress:
                last_text = group[-1].original_text[:50]
                await on_progress(min(completed, total), total, last_text)

            # Gentle pacing between grouped requests
            await asyncio.sleep(0.3)

        return entries
