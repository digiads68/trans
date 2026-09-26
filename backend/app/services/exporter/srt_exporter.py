import aiofiles
from .base import BaseExporter, render_text
from app.models.schemas import SubtitleEntry


class SRTExporter(BaseExporter):
    """Export translated subtitles to SRT format."""

    def file_extension(self) -> str:
        return "srt"

    async def export(self, entries: list[SubtitleEntry], output_path: str, **options) -> str:
        lines = []
        for entry in entries:
            lines.append(str(entry.index))
            if entry.start_time and entry.end_time:
                lines.append(f"{entry.start_time} --> {entry.end_time}")
            text = render_text(entry, options.get("untranslated", "source"), options.get("bilingual", False))
            lines.append(text)
            lines.append("")  # blank line between entries

        content = "\n".join(lines)

        async with aiofiles.open(output_path, "w", encoding="utf-8") as f:
            await f.write(content)

        return output_path
