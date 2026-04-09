import asyncio
import json
import logging
from typing import Callable, Optional

from openai import AsyncOpenAI

from app.config import settings
from app.models.schemas import SubtitleEntry, TranslationMode
from .base import BaseTranslator

logger = logging.getLogger(__name__)


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
        lang_map = {
            "vi": "Vietnamese", "en": "English", "zh": "Chinese",
            "zh-cn": "Chinese", "ko": "Korean", "ja": "Japanese",
            "th": "Thai", "fr": "French", "de": "German", "es": "Spanish",
        }
        source = lang_map.get(source_lang, source_lang)
        target = lang_map.get(target_lang, target_lang)

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
        lang_map = {
            "vi": "Vietnamese", "en": "English", "zh": "Chinese",
            "ko": "Korean", "ja": "Japanese",
        }
        source = lang_map.get(source_lang, source_lang)
        target = lang_map.get(target_lang, target_lang)

        response = await self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": f"Translate from {source} to {target}. Return ONLY the translation."},
                {"role": "user", "content": text},
            ],
            temperature=0.3,
        )
        return response.choices[0].message.content.strip()

    async def _translate_chunk(
        self,
        entries: list[SubtitleEntry],
        system_prompt: str,
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
            # Clean up potential markdown formatting
            if result_text.startswith("```"):
                result_text = result_text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()

            result_data = json.loads(result_text)

            # Map translations back
            translation_map = {item["i"]: item["t"] for item in result_data}
            for entry in entries:
                if entry.index in translation_map:
                    entry.translated_text = translation_map[entry.index]

        except (json.JSONDecodeError, KeyError) as e:
            logger.warning(f"Failed to parse LLM response, falling back to line-by-line: {e}")
            # Fallback: translate one by one
            for entry in entries:
                try:
                    entry.translated_text = await self.translate_text(
                        entry.original_text, "auto", "vi"
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
        on_progress: Optional[Callable[[int, int, str], None]] = None,
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

                result = await self._translate_chunk(chunk, system_prompt, context)
                completed += len(chunk)

                if on_progress:
                    last_text = chunk[-1].original_text[:50] if chunk else ""
                    on_progress(completed, total, last_text)

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
