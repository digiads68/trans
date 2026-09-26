import aiofiles
from .base import BaseExporter, render_text
from app.models.schemas import SubtitleEntry


class VTTExporter(BaseExporter):
    """Export translated subtitles to WebVTT format."""

    def file_extension(self) -> str:
        return "vtt"

    def _normalize_timestamp(self, ts: str) -> str:
        """Normalize SRT/ASS timestamp to VTT format (HH:MM:SS.mmm)."""
        # SRT uses comma: 00:00:01,500 → VTT uses dot: 00:00:01.500
        ts = ts.replace(",", ".")
        # ASS format: H:MM:SS.cc (centiseconds) → convert to HH:MM:SS.mmm
        parts = ts.split(":")
        if len(parts) == 3:
            h, m, s = parts
            if "." in s:
                s_parts = s.split(".")
                sec = s_parts[0]
                frac = s_parts[1]
                # ASS has 2-digit centiseconds; VTT needs 3-digit milliseconds
                if len(frac) == 2:
                    frac = frac + "0"
                elif len(frac) > 3:
                    frac = frac[:3]
                ts = f"{int(h):02d}:{int(m):02d}:{int(sec):02d}.{frac}"
        return ts

    async def export(self, entries: list[SubtitleEntry], output_path: str, **options) -> str:
        lines = ["WEBVTT", ""]

        for entry in entries:
            # Optional cue identifier
            lines.append(str(entry.index))

            start = self._normalize_timestamp(entry.start_time) if entry.start_time else "00:00:00.000"
            end = self._normalize_timestamp(entry.end_time) if entry.end_time else "00:00:00.000"
            lines.append(f"{start} --> {end}")

            text = render_text(entry, options.get("untranslated", "source"), options.get("bilingual", False))
            lines.append(text)
            lines.append("")  # blank line between cues

        content = "\n".join(lines)

        async with aiofiles.open(output_path, "w", encoding="utf-8") as f:
            await f.write(content)

        return output_path
