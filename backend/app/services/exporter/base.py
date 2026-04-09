from abc import ABC, abstractmethod
from app.models.schemas import SubtitleEntry


class BaseExporter(ABC):
    """Base class for all subtitle file exporters."""

    @abstractmethod
    async def export(self, entries: list[SubtitleEntry], output_path: str) -> str:
        """Export translated entries to file. Returns the output file path."""
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
        else:
            raise ValueError(f"Unsupported export format: {format}")
