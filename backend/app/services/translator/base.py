from abc import ABC, abstractmethod
from typing import Awaitable, Callable, Optional, Union
from app.models.schemas import SubtitleEntry, TranslationProvider, TranslationMode

# Progress callback: (completed, total, current_text) -> None or Awaitable[None]
ProgressCallback = Optional[Callable[[int, int, str], Union[None, Awaitable[None]]]]

# Cancellation check: returns True when the job should stop
CancelCheck = Optional[Callable[[], bool]]


class TranslationCancelled(Exception):
    """Raised by translators when a cancellation is requested mid-batch."""


class TranslationFailed(Exception):
    """Raised when translation cannot proceed (auth error, unreachable API, ...).

    `user_message` carries a clean, user-facing (Vietnamese) explanation.
    """

    def __init__(self, user_message: str, original: Optional[Exception] = None):
        super().__init__(user_message)
        self.user_message = user_message
        self.original = original


class BaseTranslator(ABC):
    """Base class for all translation providers."""

    @abstractmethod
    async def translate_batch(
        self,
        entries: list[SubtitleEntry],
        source_lang: str,
        target_lang: str,
        mode: TranslationMode = TranslationMode.STANDARD,
        on_progress: ProgressCallback = None,
        custom_prompt: Optional[str] = None,
        glossary: Optional[dict[str, str]] = None,
        should_cancel: CancelCheck = None,
        full_entries: Optional[list[SubtitleEntry]] = None,
    ) -> list[SubtitleEntry]:
        """Translate a batch of subtitle entries.

        Entries that could not be translated keep translated_text=None so the
        caller can count failures. Raises TranslationCancelled when
        should_cancel() returns True, and TranslationFailed on permanent errors.
        """
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
            primary_provider = hybrid_primary or TranslationProvider.GOOGLE
            fallback_provider = hybrid_fallback or TranslationProvider.LLM

            # Refine only works with an LLM refiner. If the user enabled refine
            # but picked providers in the "wrong" order (LLM primary + Google
            # fallback), swap so the refiner is always the LLM — otherwise the
            # refine step would be silently skipped.
            if hybrid_refine and fallback_provider != TranslationProvider.LLM:
                if primary_provider == TranslationProvider.LLM:
                    primary_provider, fallback_provider = fallback_provider, primary_provider
                else:
                    fallback_provider = TranslationProvider.LLM

            primary = TranslatorFactory.create(
                primary_provider,
                model=model,
                api_base=api_base,
                api_key=api_key,
            )
            fallback = TranslatorFactory.create(
                fallback_provider,
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
