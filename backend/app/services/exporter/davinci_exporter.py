import aiofiles
from .base import BaseExporter
from app.models.schemas import SubtitleEntry


class DaVinciExporter(BaseExporter):
    """
    Export translated subtitles to SRT format optimized for DaVinci Resolve.
    DaVinci Resolve requires standard SRT with UTF-8 encoding without BOM
    and uses comma as decimal separator for milliseconds.
    """

    def file_extension(self) -> str:
        return "srt"

    def _normalize_srt_timestamp(self, ts: str) -> str:
        """
        Ensure timestamp is in SRT format: HH:MM:SS,mmm
        Handles VTT (dot separator) and ASS (H:MM:SS.cc centiseconds) input.
        """
        # Replace dot with comma for SRT format
        ts = ts.replace(".", ",")
        # ASS centisecond format H:MM:SS,cc → add trailing zero for milliseconds
        parts = ts.split(":")
        if len(parts) == 3:
            h, m, rest = parts
            if "," in rest:
                sec, frac = rest.split(",", 1)
                if len(frac) == 2:
                    frac += "0"  # centiseconds → milliseconds
                elif len(frac) > 3:
                    frac = frac[:3]
                ts = f"{int(h):02d}:{int(m):02d}:{int(sec):02d},{frac}"
            else:
                ts = f"{int(h):02d}:{int(m):02d}:{int(rest):02d},000"
        return ts

    async def export(self, entries: list[SubtitleEntry], output_path: str) -> str:
        lines = []
        for entry in entries:
            lines.append(str(entry.index))

            if entry.start_time and entry.end_time:
                start = self._normalize_srt_timestamp(entry.start_time)
                end = self._normalize_srt_timestamp(entry.end_time)
                lines.append(f"{start} --> {end}")

            text = entry.translated_text or entry.original_text
            lines.append(text)
            lines.append("")  # blank line between entries

        content = "\n".join(lines)

        # DaVinci Resolve requires UTF-8 without BOM
        async with aiofiles.open(output_path, "w", encoding="utf-8") as f:
            await f.write(content)

        return output_path
