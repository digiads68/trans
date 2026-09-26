import re
import aiofiles
from .base import BaseExporter, render_text
from app.models.schemas import SubtitleEntry


class PremiereExporter(BaseExporter):
    """
    Export translated subtitles to Premiere Pro XML subtitle format.
    Compatible with Adobe Premiere Pro's import via markers or subtitle tracks.
    """

    def file_extension(self) -> str:
        return "xml"

    def _srt_to_ticks(self, ts: str) -> int:
        """
        Convert SRT/VTT timestamp to Adobe Premiere ticks.
        Adobe Premiere uses 254016000000 ticks per second (internal time base).
        """
        # Normalize comma to dot (SRT uses comma)
        ts = ts.replace(",", ".")
        # Handle ASS centisecond format H:MM:SS.cc → add trailing zero
        parts = ts.split(":")
        if len(parts) == 3:
            h, m, rest = parts
            if "." in rest:
                sec, frac = rest.split(".", 1)
                if len(frac) == 2:
                    frac += "0"  # centiseconds to milliseconds
                total_ms = (int(h) * 3600 + int(m) * 60 + int(sec)) * 1000 + int(frac[:3])
            else:
                total_ms = (int(h) * 3600 + int(m) * 60 + int(rest)) * 1000
        elif len(parts) == 2:
            m, rest = parts
            if "." in rest:
                sec, frac = rest.split(".", 1)
                total_ms = (int(m) * 60 + int(sec)) * 1000 + int(frac[:3])
            else:
                total_ms = (int(m) * 60 + int(rest)) * 1000
        else:
            total_ms = 0

        ticks_per_ms = 254016000  # 254016000000 / 1000
        return total_ms * ticks_per_ms

    def _escape_xml(self, text: str) -> str:
        text = text.replace("&", "&amp;")
        text = text.replace("<", "&lt;")
        text = text.replace(">", "&gt;")
        text = text.replace('"', "&quot;")
        return text

    async def export(self, entries: list[SubtitleEntry], output_path: str, **options) -> str:
        subtitle_elements = []

        for entry in entries:
            text = render_text(entry, options.get("untranslated", "source"), options.get("bilingual", False))
            text_escaped = self._escape_xml(text)
            # Convert newlines to <br/> in XML
            text_escaped = text_escaped.replace("\n", "&#13;")

            start_ticks = self._srt_to_ticks(entry.start_time) if entry.start_time else 0
            end_ticks = self._srt_to_ticks(entry.end_time) if entry.end_time else 0

            subtitle_elements.append(
                f'    <subtitle>\n'
                f'      <start>{start_ticks}</start>\n'
                f'      <end>{end_ticks}</end>\n'
                f'      <text>{text_escaped}</text>\n'
                f'    </subtitle>'
            )

        xml_content = (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<xmeml version="4">\n'
            '  <sequence>\n'
            '    <name>Subtitles</name>\n'
            '    <subtitleList>\n'
            + "\n".join(subtitle_elements) + "\n"
            '    </subtitleList>\n'
            '  </sequence>\n'
            '</xmeml>\n'
        )

        async with aiofiles.open(output_path, "w", encoding="utf-8") as f:
            await f.write(xml_content)

        return output_path
