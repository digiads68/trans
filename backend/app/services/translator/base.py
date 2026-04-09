from abc import ABC, abstractmethod
from typing import AsyncGenerator, Callable, Optional
from app.models.schemas import SubtitleEntry, TranslationProvider, TranslationMode


class BaseTranslator(ABC):
    """Base class for all translation providers."""

    @abstractmethod
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
        """Translate a batch of subtitle entries."""
        pass

    @abstractmethod
    async def translate_text(self, text: str, source_lang: str, target_lang: str) -> str:
        """Translate a single text string."""
        pass

    @property
    @abstractmethod
    def provider_name(self) -> str:
        pass


class TranslatorFactory:
    """Factory to create translator instances based on provider type."""

    @staticmethod
    def create(
        provider: TranslationProvider,
        model: Optional[str] = None,
        api_base: Optional[str] = None,
        api_key: Optional[str] = None,
        hybrid_primary: Optional[TranslationProvider] = None,
        hybrid_fallback: Optional[TranslationProvider] = None,
        hybrid_refine: bool = False,
    ) -> BaseTranslator:
        if provider == TranslationProvider.LLM:
            from .llm_translator import LLMTranslator
            return LLMTranslator(
                model=model or "gpt-4o-mini",
                api_base=api_base,
                api_key=api_key,
            )
        elif provider == TranslationProvider.GOOGLE:
            from .google_translator import GoogleTranslator
            return GoogleTranslator()
        elif provider == TranslationProvider.HYBRID:
            from .hybrid_translator import HybridTranslator
            primary = TranslatorFactory.create(
                hybrid_primary or TranslationProvider.GOOGLE,
                model=model,
                api_base=api_base,
                api_key=api_key,
            )
            fallback = TranslatorFactory.create(
                hybrid_fallback or TranslationProvider.LLM,
                model=model,
                api_base=api_base,
                api_key=api_key,
            )
            return HybridTranslator(
                primary=primary,
                refiner=fallback,
                use_refine=hybrid_refine,
            )
        else:
            raise ValueError(f"Unknown provider: {provider}")
