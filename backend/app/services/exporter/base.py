from abc import ABC, abstractmethod
from app.models.schemas import SubtitleEntry

LANG_NAMES = {
    "vi": "Vietnamese", "en": "English", "zh": "Chinese", "zh-cn": "Chinese",
    "zh-tw": "Chinese (Traditional)", "ko": "Korean", "ja": "Japanese",
    "th": "Thai", "fr": "French", "de": "German", "es": "Spanish",
    "pt": "Portuguese", "ru": "Russian", "id": "Indonesian", "ms": "Malay",
}


def render_text(
    entry: SubtitleEntry,
    untranslated: str = "source",
    bilingual: bool = False,
) -> str:
    """Final subtitle text for export, re-applying formatting tags.

    untranslated: "source" writes the original line (with its tags) when there
    is no translation, "empty" writes nothing.
    bilingual: original line above the translation.
    """
    translated = entry.translated_text
    if not translated:
        if untranslated == "empty":
            return ""
        return entry.raw_text or f"{entry.prefix}{entry.original_text}{entry.suffix}"
    if bilingual:
        return f"{entry.prefix}{entry.original_text}\n{translated}{entry.suffix}"
    return f"{entry.prefix}{translated}{entry.suffix}"


class BaseExporter(ABC):
    """Base class for all subtitle file exporters."""

    @abstractmethod
    async def export(self, entries: list[SubtitleEntry], output_path: str, **options) -> str:
        """Export translated entries to file. Returns the output file path.

        options: untranslated ("source"|"empty"), bilingual (bool),
        target_lang (str), ass_header (str | None).
        """
        pass

    @abstractmethod
    def file_extension(self) -> str:
        pass


class ExporterFactory:
    """Factory to get the right exporter based on desired output format."""

    @staticmethod
    def get_exporter(format: str) -> BaseExporter:
        if format == "srt":
            from .srt_exporter import SRTExporter
            return SRTExporter()
        elif format in ("xlsx", "excel"):
            from .excel_exporter import ExcelExporter
            return ExcelExporter()
        elif format == "vtt":
            from .vtt_exporter import VTTExporter
            return VTTExporter()
        elif format == "premiere":
            from .premiere_exporter import PremiereExporter
            return PremiereExporter()
        elif format == "davinci":
            from .davinci_exporter import DaVinciExporter
            return DaVinciExporter()
        elif format == "ass":
            from .ass_exporter import ASSExporter
            return ASSExporter()
        else:
            raise ValueError(f"Unsupported export format: {format}")
