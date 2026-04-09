import asyncio
import json
import logging
import re
from typing import Callable, Optional

from openai import AsyncOpenAI

from app.config import settings
from app.models.schemas import SubtitleEntry, TranslationMode
from .base import BaseTranslator

logger = logging.getLogger(__name__)

LANG_MAP = {
    "vi": "Vietnamese", "en": "English", "zh": "Chinese",
    "zh-cn": "Chinese", "zh-tw": "Chinese (Traditional)",
    "ko": "Korean", "ja": "Japanese",
    "th": "Thai", "fr": "French", "de": "German", "es": "Spanish",
    "pt": "Portuguese", "ru": "Russian", "ar": "Arabic",
    "id": "Indonesian", "ms": "Malay",
}


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
        )
        self.batch_size = settings.BATCH_SIZE
        self.max_concurrent = settings.MAX_CONCURRENT_REQUESTS

    @property
    def provider_name(self) -> str:
        return f"LLM ({self.model})"

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
            f"You are an expert subtitle translator. "
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
                f"- Maintain consistent character names and terminology\n"
            )

        if glossary:
            glossary_text = "\n".join(f"  {k} → {v}" for k, v in glossary.items())
            base_prompt += f"\nGlossary (always use these translations):\n{glossary_text}\n"

        if custom_prompt:
            base_prompt += f"\nAdditional instructions: {custom_prompt}\n"

        base_prompt += (
            "\nYou will receive subtitle lines in JSON format: [{\"i\": index, \"t\": text}, ...]\n"
            "Respond with a JSON array of translated texts in the same order: "
            "[{\"i\": index, \"t\": translated_text}, ...]\n"
            "IMPORTANT: Return ONLY the JSON array, no other text."
        )

        return base_prompt

    async def translate_text(self, text: str, source_lang: str, target_lang: str) -> str:
        """Translate a single text using LLM."""
        source = LANG_MAP.get(source_lang, source_lang)
        target = LANG_MAP.get(target_lang, target_lang)

        response = await self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": f"Translate from {source} to {target}. Return ONLY the translation."},
                {"role": "user", "content": text},
            ],
            temperature=0.3,
        )
        return response.choices[0].message.content.strip()

    async def refine_text(self, original: str, rough_translation: str, source_lang: str, target_lang: str) -> str:
        """Refine a rough translation using LLM with a dedicated refine prompt."""
        source = LANG_MAP.get(source_lang, source_lang)
        target = LANG_MAP.get(target_lang, target_lang)

        response = await self.client.chat.completions.create(
            model=self.model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        f"You are a translation editor. Improve machine translations from {source} to {target}. "
                        f"Make them sound natural while preserving meaning. Keep it concise for subtitles. "
                        f"Return ONLY the improved translation, nothing else."
                    ),
                },
                {
                    "role": "user",
                    "content": f"Original: {original}\nMachine translation: {rough_translation}",
                },
            ],
            temperature=0.3,
        )
        return response.choices[0].message.content.strip()

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

    async def _translate_chunk(
        self,
        entries: list[SubtitleEntry],
        system_prompt: str,
        source_lang: str,
        target_lang: str,
        context_before: Optional[list[SubtitleEntry]] = None,
    ) -> list[SubtitleEntry]:
        """Translate a chunk of entries."""
        # Build input JSON
        input_data = [{"i": e.index, "t": e.original_text} for e in entries]

        messages = [{"role": "system", "content": system_prompt}]

        # Add context for context-aware mode
        if context_before:
            context_text = "\n".join(
                f"[{e.index}] {e.original_text} → {e.translated_text}"
                for e in context_before if e.translated_text
            )
            messages.append({
                "role": "user",
                "content": f"Previous translations for context:\n{context_text}",
            })
            messages.append({
                "role": "assistant",
                "content": "Understood. I'll maintain consistency with the previous translations.",
            })

        messages.append({"role": "user", "content": json.dumps(input_data, ensure_ascii=False)})

        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=0.3,
                max_tokens=4096,
            )

            result_text = response.choices[0].message.content.strip()
            result_data = self._extract_json_array(result_text)

            # Map translations back
            translation_map = {item["i"]: item["t"] for item in result_data}
            for entry in entries:
                if entry.index in translation_map:
                    entry.translated_text = translation_map[entry.index]

        except (json.JSONDecodeError, KeyError) as e:
            logger.warning(f"Failed to parse LLM response, falling back to line-by-line: {e}")
            # Fallback: translate one by one with correct languages
            for entry in entries:
                try:
                    entry.translated_text = await self.translate_text(
                        entry.original_text, source_lang, target_lang
                    )
                except Exception as inner_e:
                    logger.error(f"Failed to translate entry {entry.index}: {inner_e}")
                    entry.translated_text = f"[Translation error: {entry.index}]"
        except Exception as e:
            logger.error(f"Translation chunk failed: {e}")
            for entry in entries:
                entry.translated_text = f"[Translation error]"

        return entries

    async def translate_batch(
        self,
        entries: list[SubtitleEntry],
        source_lang: str,
        target_lang: str,
        mode: TranslationMode = TranslationMode.STANDARD,
        on_progress=None,
        custom_prompt: Optional[str] = None,
        glossary: Optional[dict[str, str]] = None,
    ) -> list[SubtitleEntry]:
        """Translate all entries in batches with concurrency control."""
        system_prompt = self._build_system_prompt(
            source_lang, target_lang, mode, custom_prompt, glossary
        )

        # Split into chunks
        chunks = [entries[i:i + self.batch_size] for i in range(0, len(entries), self.batch_size)]

        semaphore = asyncio.Semaphore(self.max_concurrent)
        completed = 0
        total = len(entries)

        async def process_chunk(chunk_idx: int, chunk: list[SubtitleEntry]):
            nonlocal completed
            async with semaphore:
                context = None
                if mode == TranslationMode.CONTEXT_AWARE and chunk_idx > 0:
                    # Get last few entries from previous chunk as context
                    prev_start = max(0, (chunk_idx * self.batch_size) - 3)
                    prev_end = chunk_idx * self.batch_size
                    context = entries[prev_start:prev_end]

                result = await self._translate_chunk(
                    chunk, system_prompt, source_lang, target_lang, context
                )
                completed += len(chunk)

                if on_progress:
                    last_text = chunk[-1].original_text[:50] if chunk else ""
                    await on_progress(completed, total, last_text)

                return result

        # Process chunks concurrently
        if mode == TranslationMode.CONTEXT_AWARE:
            # Context-aware needs sequential processing
            for idx, chunk in enumerate(chunks):
                await process_chunk(idx, chunk)
        else:
            tasks = [process_chunk(idx, chunk) for idx, chunk in enumerate(chunks)]
            await asyncio.gather(*tasks)

        return entries
