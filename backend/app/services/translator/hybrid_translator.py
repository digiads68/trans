import logging
from typing import Callable, Optional

from app.models.schemas import SubtitleEntry, TranslationMode
from .base import BaseTranslator

logger = logging.getLogger(__name__)


class HybridTranslator(BaseTranslator):
    """
    Hybrid translator that combines two translation providers.

    Modes:
    1. Primary + Fallback: Use primary, fall back to secondary on error
    2. Refine: Use primary (e.g. Google) for rough translation, then refiner (e.g. LLM)
       to polish and improve the translation quality
    """

    def __init__(
        self,
        primary: BaseTranslator,
        refiner: BaseTranslator,
        use_refine: bool = False,
    ):
        self.primary = primary
        self.refiner = refiner
        self.use_refine = use_refine

    @property
    def provider_name(self) -> str:
        if self.use_refine:
            return f"Hybrid (Refine: {self.primary.provider_name} → {self.refiner.provider_name})"
        return f"Hybrid ({self.primary.provider_name} + {self.refiner.provider_name})"

    async def translate_text(self, text: str, source_lang: str, target_lang: str) -> str:
        """Translate text with hybrid approach."""
        try:
            result = await self.primary.translate_text(text, source_lang, target_lang)
            if self.use_refine and result:
                result = await self._refine_single(text, result, source_lang, target_lang)
            return result
        except Exception as e:
            logger.warning(f"Primary translator failed, using fallback: {e}")
            return await self.refiner.translate_text(text, source_lang, target_lang)

    async def _refine_single(
        self, original: str, rough_translation: str, source_lang: str, target_lang: str
    ) -> str:
        """Use the refiner to improve a rough translation."""
        from .llm_translator import LLMTranslator

        if isinstance(self.refiner, LLMTranslator):
            try:
                return await self.refiner.refine_text(
                    original, rough_translation, source_lang, target_lang
                )
            except Exception as e:
                logger.warning(f"Refine failed, using rough translation: {e}")
                return rough_translation
        return rough_translation

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
        """Translate batch with hybrid approach."""
        total = len(entries)

        # Step 1: Primary translation
        logger.info(f"Hybrid step 1: Translating with {self.primary.provider_name}")

        async def primary_progress(completed, tot, text):
            if on_progress:
                if self.use_refine:
                    # Primary phase = first half of progress
                    await on_progress(completed * total // (2 * tot) if tot > 0 else 0, total, f"[Primary] {text}")
                else:
                    await on_progress(completed, total, text)

        try:
            entries = await self.primary.translate_batch(
                entries, source_lang, target_lang, mode,
                on_progress=primary_progress,
                custom_prompt=custom_prompt,
                glossary=glossary,
            )
        except Exception as e:
            logger.warning(f"Primary batch failed, using fallback: {e}")
            entries = await self.refiner.translate_batch(
                entries, source_lang, target_lang, mode,
                on_progress=on_progress,
                custom_prompt=custom_prompt,
                glossary=glossary,
            )
            return entries

        # Step 2: Refine if enabled
        if self.use_refine:
            logger.info(f"Hybrid step 2: Refining with {self.refiner.provider_name}")
            from .llm_translator import LLMTranslator

            if isinstance(self.refiner, LLMTranslator):
                half = total // 2
                for idx, entry in enumerate(entries):
                    if entry.translated_text and not entry.translated_text.startswith("[Translation error"):
                        try:
                            refined = await self.refiner.refine_text(
                                entry.original_text,
                                entry.translated_text,
                                source_lang,
                                target_lang,
                            )
                            entry.translated_text = refined
                        except Exception as e:
                            logger.warning(f"Refine failed for entry {entry.index}: {e}")

                    if on_progress:
                        # Refine phase = second half, capped at total
                        await on_progress(min(half + idx + 1, total), total, f"[Refine] {entry.original_text[:50]}")

        return entries
