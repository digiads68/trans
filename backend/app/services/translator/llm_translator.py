import asyncio
import json
import logging
import re
from typing import Callable, Optional

import openai
from openai import AsyncOpenAI

from app.config import settings
from app.models.schemas import SubtitleEntry, TranslationMode
from .base import BaseTranslator, TranslationCancelled, TranslationFailed
from app.services.cache import get_cached, set_cached

logger = logging.getLogger(__name__)

LANG_MAP = {
    "vi": "Vietnamese", "en": "English", "zh": "Chinese",
    "zh-cn": "Chinese", "zh-tw": "Chinese (Traditional)",
    "ko": "Korean", "ja": "Japanese",
    "th": "Thai", "fr": "French", "de": "German", "es": "Spanish",
    "pt": "Portuguese", "ru": "Russian", "ar": "Arabic",
    "id": "Indonesian", "ms": "Malay",
}

# Retry policy for transient API errors
MAX_RETRIES = 3
RETRY_BASE_DELAY = 1.0  # 1s, 2s, 4s

# Errors that are permanent — retrying cannot help, fail the job immediately
PERMANENT_ERRORS = (
    openai.AuthenticationError,
    openai.PermissionDeniedError,
    openai.NotFoundError,
    openai.BadRequestError,
)

# Errors worth retrying with backoff
TRANSIENT_ERRORS = (
    openai.RateLimitError,
    openai.APITimeoutError,
    openai.InternalServerError,
    openai.APIConnectionError,
)


class LLMTranslator(BaseTranslator):
    """Translator using OpenAI-compatible API (cliproxyapi)."""

    def __init__(
        self,
        model: str = "gpt-4o-mini",
        api_base: Optional[str] = None,
        api_key: Optional[str] = None,
    ):
        self.model = model
        self.client = AsyncOpenAI(
            base_url=api_base or settings.CLIPROXY_API_BASE,
            api_key=api_key or settings.CLIPROXY_API_KEY,
            max_retries=0,  # we handle retries ourselves with backoff
        )
        self.batch_size = settings.BATCH_SIZE
        self.max_concurrent = settings.MAX_CONCURRENT_REQUESTS

    @property
    def provider_name(self) -> str:
        return f"LLM ({self.model})"

    def _cache_context(
        self,
        mode: TranslationMode,
        custom_prompt: Optional[str],
        glossary: Optional[dict[str, str]],
    ) -> str:
        """Cache namespace so different providers/models/prompts don't collide."""
        import hashlib
        glossary_part = json.dumps(glossary, sort_keys=True, ensure_ascii=False) if glossary else ""
        prompt_part = custom_prompt or ""
        extra = hashlib.sha256(f"{glossary_part}|{prompt_part}".encode()).hexdigest()[:12]
        mode_val = mode.value if hasattr(mode, "value") else str(mode)
        return f"llm|{self.model}|{mode_val}|{extra}"

    def _build_system_prompt(
        self,
        source_lang: str,
        target_lang: str,
        mode: TranslationMode,
        custom_prompt: Optional[str] = None,
        glossary: Optional[dict[str, str]] = None,
    ) -> str:
        source = LANG_MAP.get(source_lang, source_lang)
        target = LANG_MAP.get(target_lang, target_lang)

        base_prompt = (
            f"You are an expert subtitle translator for films and TV series. "
            f"Translate from {source} to {target}. "
            f"Rules:\n"
            f"- Keep translations natural and conversational\n"
            f"- Preserve the tone and emotion of the original\n"
            f"- Keep translations concise (suitable for subtitles)\n"
            f"- Do NOT add explanations, only provide the translation\n"
            f"- Preserve any speaker labels or formatting markers\n"
        )

        if mode == TranslationMode.CONTEXT_AWARE:
            base_prompt += (
                f"- Consider the context of surrounding subtitles for coherent translation\n"
                f"- Maintain consistent character names, pronouns and terminology across all lines\n"
            )

        if glossary:
            glossary_text = "\n".join(f"  {k} → {v}" for k, v in glossary.items())
            base_prompt += (
                f"\nGlossary — you MUST use exactly these translations for these terms, "
                f"including character names:\n{glossary_text}\n"
            )

        if custom_prompt:
            base_prompt += f"\nFilm context and style instructions: {custom_prompt}\n"

        base_prompt += (
            "\nYou will receive subtitle lines in JSON format: [{\"i\": index, \"t\": text}, ...]\n"
            "Respond with a JSON array of translated texts using the SAME integer indices: "
            "[{\"i\": index, \"t\": translated_text}, ...]\n"
            "Every input index MUST appear exactly once in your output.\n"
            "IMPORTANT: Return ONLY the JSON array, no other text."
        )

        return base_prompt

    async def _chat(self, messages: list[dict], max_tokens: Optional[int] = None) -> str:
        """One chat call with retry/backoff on transient errors.

        Permanent errors (auth, bad model, ...) raise immediately.
        Transient errors are retried MAX_RETRIES times, then re-raised.
        """
        last_exc: Optional[Exception] = None
        for attempt in range(MAX_RETRIES + 1):
            try:
                response = await self.client.chat.completions.create(
                    model=self.model,
                    messages=messages,
                    temperature=0.3,
                    **({"max_tokens": max_tokens} if max_tokens else {}),
                )
                content = response.choices[0].message.content
                if content is None:
                    raise ValueError("Empty response from model")
                return content.strip()
            except PERMANENT_ERRORS:
                raise
            except TRANSIENT_ERRORS as e:
                last_exc = e
                if attempt < MAX_RETRIES:
                    delay = RETRY_BASE_DELAY * (2 ** attempt)
                    logger.warning(f"Transient API error (attempt {attempt + 1}): {e}; retrying in {delay}s")
                    await asyncio.sleep(delay)
            except ValueError as e:
                last_exc = e
                if attempt < MAX_RETRIES:
                    await asyncio.sleep(RETRY_BASE_DELAY)
        raise last_exc

    async def translate_text(
        self,
        text: str,
        source_lang: str,
        target_lang: str,
        custom_prompt: Optional[str] = None,
        glossary: Optional[dict[str, str]] = None,
    ) -> str:
        """Translate a single text using LLM, preserving glossary/context if given."""
        source = LANG_MAP.get(source_lang, source_lang)
        target = LANG_MAP.get(target_lang, target_lang)

        system = f"Translate from {source} to {target}. Return ONLY the translation, nothing else."
        if glossary:
            glossary_text = "\n".join(f"  {k} → {v}" for k, v in glossary.items())
            system += f"\nYou MUST use these exact translations:\n{glossary_text}"
        if custom_prompt:
            system += f"\nContext: {custom_prompt}"

        return await self._chat([
            {"role": "system", "content": system},
            {"role": "user", "content": text},
        ])

    async def refine_text(
        self,
        original: str,
        rough_translation: str,
        source_lang: str,
        target_lang: str,
        custom_prompt: Optional[str] = None,
        glossary: Optional[dict[str, str]] = None,
    ) -> str:
        """Refine a rough translation using LLM with a dedicated refine prompt."""
        source = LANG_MAP.get(source_lang, source_lang)
        target = LANG_MAP.get(target_lang, target_lang)

        system = (
            f"You are a subtitle translation editor. Improve machine translations from {source} to {target}. "
            f"Make them sound natural while preserving meaning. Keep it concise for subtitles. "
            f"Return ONLY the improved translation, nothing else."
        )
        if glossary:
            glossary_text = "\n".join(f"  {k} → {v}" for k, v in glossary.items())
            system += f"\nYou MUST keep these exact translations:\n{glossary_text}"
        if custom_prompt:
            system += f"\nFilm context: {custom_prompt}"

        return await self._chat([
            {"role": "system", "content": system},
            {"role": "user", "content": f"Original: {original}\nMachine translation: {rough_translation}"},
        ])

    async def refine_batch(
        self,
        pairs: list[tuple[int, str, str]],  # (index, original, rough)
        source_lang: str,
        target_lang: str,
        custom_prompt: Optional[str] = None,
        glossary: Optional[dict[str, str]] = None,
    ) -> dict[int, str]:
        """Refine a batch of rough translations in ONE LLM call.

        Returns {index: refined_text}. Missing indices mean the model skipped
        them — caller should keep the rough translation for those.
        """
        source = LANG_MAP.get(source_lang, source_lang)
        target = LANG_MAP.get(target_lang, target_lang)

        system = (
            f"You are a subtitle translation editor. You receive machine translations "
            f"from {source} to {target} and improve them: natural phrasing, correct pronouns, "
            f"consistent character names, concise subtitle style.\n"
        )
        if glossary:
            glossary_text = "\n".join(f"  {k} → {v}" for k, v in glossary.items())
            system += f"You MUST keep these exact translations:\n{glossary_text}\n"
        if custom_prompt:
            system += f"Film context: {custom_prompt}\n"
        system += (
            "Input JSON: [{\"i\": index, \"o\": original, \"m\": machine_translation}, ...]\n"
            "Output JSON with the SAME integer indices: [{\"i\": index, \"t\": improved_translation}, ...]\n"
            "Return ONLY the JSON array."
        )

        payload = [{"i": i, "o": orig, "m": rough} for i, orig, rough in pairs]
        result_text = await self._chat(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
            ],
            max_tokens=8000,
        )
        result_data = self._extract_json_array(result_text)
        return self._coerce_translation_map(result_data)

    def _extract_json_array(self, text: str) -> list[dict]:
        """Robustly extract JSON array from LLM response."""
        # Try direct parse first
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass

        # Try extracting from markdown code block
        md_match = re.search(r"```(?:json)?\s*\n?(.*?)```", text, re.DOTALL)
        if md_match:
            try:
                return json.loads(md_match.group(1).strip())
            except json.JSONDecodeError:
                pass

        # Try finding JSON array in text
        arr_match = re.search(r"\[.*\]", text, re.DOTALL)
        if arr_match:
            try:
                return json.loads(arr_match.group(0))
            except json.JSONDecodeError:
                pass

        raise json.JSONDecodeError("No valid JSON array found", text, 0)

    @staticmethod
    def _coerce_translation_map(result_data: list) -> dict[int, str]:
        """Build {int_index: text} tolerating string indices and junk items."""
        out: dict[int, str] = {}
        for item in result_data:
            if not isinstance(item, dict):
                continue
            try:
                idx = int(item.get("i"))
                text = item.get("t")
            except (TypeError, ValueError):
                continue
            if isinstance(text, str) and text:
                out[idx] = text
        return out

    async def _request_chunk_translations(
        self,
        to_translate: list[SubtitleEntry],
        messages_base: list[dict],
    ) -> dict[int, str]:
        """Send one chunk to the LLM, return coerced {index: translation}."""
        input_data = [{"i": e.index, "t": e.original_text} for e in to_translate]
        messages = messages_base + [
            {"role": "user", "content": json.dumps(input_data, ensure_ascii=False)}
        ]
        result_text = await self._chat(messages, max_tokens=8000)
        result_data = self._extract_json_array(result_text)
        return self._coerce_translation_map(result_data)

    async def _translate_chunk(
        self,
        entries: list[SubtitleEntry],
        system_prompt: str,
        source_lang: str,
        target_lang: str,
        cache_ctx: str,
        context_entries: Optional[list[SubtitleEntry]] = None,
        custom_prompt: Optional[str] = None,
        glossary: Optional[dict[str, str]] = None,
    ) -> None:
        """Translate a chunk of entries in place, using cache where possible.

        Raises on permanent API errors (propagated to fail the job cleanly).
        Entries that fail transiently after retries keep translated_text=None.
        """
        # Check cache first; only send uncached entries to LLM
        uncached: list[SubtitleEntry] = []
        for entry in entries:
            cached = await get_cached(source_lang, target_lang, entry.original_text, context=cache_ctx)
            if cached is not None:
                entry.translated_text = cached
            else:
                uncached.append(entry)

        if not uncached:
            return

        messages_base = [{"role": "system", "content": system_prompt}]

        # Neighboring-lines context for coherent translation
        if context_entries:
            context_text = "\n".join(
                f"[{e.index}] {e.original_text}" + (f" → {e.translated_text}" if e.translated_text else "")
                for e in context_entries
            )
            messages_base.append({
                "role": "user",
                "content": f"Surrounding subtitle lines for context (do NOT translate these):\n{context_text}",
            })
            messages_base.append({
                "role": "assistant",
                "content": "Understood. I'll use them for context and consistency only.",
            })

        try:
            translation_map = await self._request_chunk_translations(uncached, messages_base)
        except PERMANENT_ERRORS:
            raise  # fail the whole job with a clean classified message
        except TRANSIENT_ERRORS as e:
            logger.error(f"Chunk failed after retries: {e}")
            return  # entries stay untranslated; counted as failed by caller
        except (json.JSONDecodeError, ValueError) as e:
            logger.warning(f"Unparseable LLM response, will retry missing lines: {e}")
            translation_map = {}

        # Apply what we got
        missing: list[SubtitleEntry] = []
        for entry in uncached:
            text = translation_map.get(entry.index)
            if text:
                entry.translated_text = text
                await set_cached(source_lang, target_lang, entry.original_text, text, context=cache_ctx)
            else:
                missing.append(entry)

        # Retry the missing subset once as a smaller batch
        if missing:
            logger.info(f"Retrying {len(missing)} lines missing from LLM response")
            try:
                retry_map = await self._request_chunk_translations(missing, messages_base)
            except PERMANENT_ERRORS:
                raise
            except Exception as e:
                logger.warning(f"Missing-subset retry failed: {e}")
                retry_map = {}

            still_missing: list[SubtitleEntry] = []
            for entry in missing:
                text = retry_map.get(entry.index)
                if text:
                    entry.translated_text = text
                    await set_cached(source_lang, target_lang, entry.original_text, text, context=cache_ctx)
                else:
                    still_missing.append(entry)

            # Last resort: per-line translation KEEPING glossary and film context
            for entry in still_missing:
                try:
                    entry.translated_text = await self.translate_text(
                        entry.original_text, source_lang, target_lang,
                        custom_prompt=custom_prompt, glossary=glossary,
                    )
                    await set_cached(
                        source_lang, target_lang, entry.original_text,
                        entry.translated_text, context=cache_ctx,
                    )
                except PERMANENT_ERRORS:
                    raise
                except Exception as e:
                    logger.error(f"Per-line fallback failed for entry {entry.index}: {e}")
                    # leave translated_text=None → counted as failed

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
        """Translate all entries in batches with concurrency control."""
        system_prompt = self._build_system_prompt(
            source_lang, target_lang, mode, custom_prompt, glossary
        )
        cache_ctx = self._cache_context(mode, custom_prompt, glossary)

        # Split into chunks
        chunks = [entries[i:i + self.batch_size] for i in range(0, len(entries), self.batch_size)]

        semaphore = asyncio.Semaphore(self.max_concurrent)
        completed = 0
        total = len(entries)

        def _context_for(chunk_idx: int) -> Optional[list[SubtitleEntry]]:
            if mode != TranslationMode.CONTEXT_AWARE:
                return None
            # 3 lines before and 2 after the chunk for coherent translation
            start = chunk_idx * self.batch_size
            end = min(start + self.batch_size, total)
            before = entries[max(0, start - 3):start]
            after = entries[end:min(end + 2, total)]
            return (before + after) or None

        async def process_chunk(chunk_idx: int, chunk: list[SubtitleEntry]):
            nonlocal completed
            async with semaphore:
                if should_cancel and should_cancel():
                    raise TranslationCancelled()

                await self._translate_chunk(
                    chunk, system_prompt, source_lang, target_lang, cache_ctx,
                    context_entries=_context_for(chunk_idx),
                    custom_prompt=custom_prompt,
                    glossary=glossary,
                )
                completed += len(chunk)

                if on_progress:
                    last_text = chunk[-1].original_text[:50] if chunk else ""
                    await on_progress(min(completed, total), total, last_text)

        # Process chunks concurrently (sequential for context-aware mode).
        # TaskGroup cancels sibling chunks when one raises (auth error, cancel).
        if mode == TranslationMode.CONTEXT_AWARE:
            for idx, chunk in enumerate(chunks):
                await process_chunk(idx, chunk)
        else:
            try:
                async with asyncio.TaskGroup() as tg:
                    for idx, chunk in enumerate(chunks):
                        tg.create_task(process_chunk(idx, chunk))
            except BaseExceptionGroup as eg:
                raise eg.exceptions[0]

        return entries
