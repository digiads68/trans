import aiofiles
from .base import BaseExporter, render_text
from app.models.schemas import SubtitleEntry


class ASSExporter(BaseExporter):
    """
    Export translated subtitles to ASS (Advanced SubStation Alpha) format.
    Generates a minimal ASS file compatible with most video players.
    """

    def file_extension(self) -> str:
        return "ass"

    def _normalize_timestamp(self, ts: str) -> str:
        """
        Convert to ASS timestamp format: H:MM:SS.cc (centiseconds).
        Input may be SRT (HH:MM:SS,mmm) or VTT (HH:MM:SS.mmm).
        """
        ts = ts.replace(",", ".")
        parts = ts.split(":")
        if len(parts) == 3:
            h, m, rest = parts
            if "." in rest:
                sec, frac = rest.split(".", 1)
                # Convert milliseconds to centiseconds (truncate 3rd digit)
                cs = frac[:2] if len(frac) >= 2 else frac.ljust(2, "0")
                return f"{int(h)}:{int(m):02d}:{int(sec):02d}.{cs}"
            else:
                return f"{int(h)}:{int(m):02d}:{int(rest):02d}.00"
        return ts

    DEFAULT_HEADER = (
        "[Script Info]\n"
        "ScriptType: v4.00+\n"
        "PlayResX: 1920\n"
        "PlayResY: 1080\n"
        "WrapStyle: 0\n"
        "\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, "
        "OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, "
        "ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
        "Alignment, MarginL, MarginR, MarginV, Encoding\n"
        "Style: Default,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,"
        "0,0,0,0,100,100,0,0,1,2,1,2,10,10,30,1\n"
        "\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )
    DEFAULT_COLS = ["layer", "start", "end", "style", "name", "marginl", "marginr", "marginv", "effect", "text"]
    DEFAULT_FIELDS = {"layer": "0", "style": "Default", "name": "", "marginl": "0",
                      "marginr": "0", "marginv": "0", "effect": ""}

    async def export(self, entries: list[SubtitleEntry], output_path: str, **options) -> str:
        # Reuse the source file's header (styles, resolution, fonts) when we have it
        header = options.get("ass_header") or self.DEFAULT_HEADER
        cols = self.DEFAULT_COLS
        for line in header.splitlines():
            if line.strip().lower().startswith("format:") and "text" in line.lower():
                cols = [c.strip().lower() for c in line.strip()[7:].split(",")]

        lines = [header if header.endswith("\n") else header + "\n"]
        for entry in entries:
            text = render_text(entry, options.get("untranslated", "source"), options.get("bilingual", False))
            text = text.replace("\n", "\\N")
            fields = {**self.DEFAULT_FIELDS, **(entry.ass_fields or {})}
            fields["start"] = self._normalize_timestamp(entry.start_time) if entry.start_time else "0:00:00.00"
            fields["end"] = self._normalize_timestamp(entry.end_time) if entry.end_time else "0:00:00.00"
            fields["text"] = text
            lines.append("Dialogue: " + ",".join(fields.get(c, "") for c in cols) + "\n")

        async with aiofiles.open(output_path, "w", encoding="utf-8-sig") as f:
            await f.write("".join(lines))

        return output_path
