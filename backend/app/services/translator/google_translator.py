import asyncio
import logging
from typing import Callable, Optional

from deep_translator import GoogleTranslator as DeepGoogleTranslator

from app.models.schemas import SubtitleEntry, TranslationMode
from .base import BaseTranslator

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


class GoogleTranslator(BaseTranslator):
    """Translator using Google Translate via deep-translator."""

    def __init__(self):
        self.batch_size = 10  # Google has lower limits

    @property
    def provider_name(self) -> str:
        return "Google Translate"

    def _map_lang(self, lang: str) -> str:
        return GOOGLE_LANG_MAP.get(lang, lang)

    async def translate_text(self, text: str, source_lang: str, target_lang: str) -> str:
        """Translate a single text using Google Translate."""
        src = self._map_lang(source_lang) if source_lang != "auto" else "auto"
        tgt = self._map_lang(target_lang)

        def _translate():
            translator = DeepGoogleTranslator(source=src, target=tgt)
            return translator.translate(text)

        result = await asyncio.to_thread(_translate)
        return result or text

    async def translate_batch(
        self,
        entries: list[SubtitleEntry],
        source_lang: str,
        target_lang: str,
        mode: TranslationMode = TranslationMode.STANDARD,
        on_progress: Optional[Callable[[int, int, str], None]] = None,
        custom_prompt: Optional[str] = None,
        glossary: Optional[dict[str, str]] = None,
    ) -> list[SubtitleEntry]:
        """Translate all entries using Google Translate."""
        src = self._map_lang(source_lang) if source_lang != "auto" else "auto"
        tgt = self._map_lang(target_lang)
        total = len(entries)

        for idx, entry in enumerate(entries):
            try:
                translated = await self.translate_text(entry.original_text, src, tgt)

                # Apply glossary post-processing if provided
                if glossary and translated:
                    for original_term, translated_term in glossary.items():
                        translated = translated.replace(original_term, translated_term)

                entry.translated_text = translated

            except Exception as e:
                logger.error(f"Google Translate failed for entry {entry.index}: {e}")
                entry.translated_text = f"[Translation error]"

            if on_progress:
                on_progress(idx + 1, total, entry.original_text[:50])

            # Small delay to avoid rate limiting
            if (idx + 1) % self.batch_size == 0:
                await asyncio.sleep(0.5)

        return entries
