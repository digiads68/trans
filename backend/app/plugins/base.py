"""
Base plugin interface for SubTranslator extensibility.

Plugins can hook into translation lifecycle events to integrate with
video editing software, post-process translations, trigger notifications, etc.

To create a plugin:
1. Create a Python file in the plugins/ directory at the project root
2. Define a class that extends BasePlugin
3. Implement the hook methods you need (all are optional with default no-ops)
4. The plugin is auto-discovered and loaded at startup

Example plugin file (plugins/my_plugin.py):

    from app.plugins.base import BasePlugin
    from app.models.schemas import SubtitleEntry

    class MyPlugin(BasePlugin):
        name = "my_plugin"
        version = "1.0.0"
        description = "My custom plugin"

        async def on_translation_complete(self, file_id, entries, metadata):
            print(f"Translation done: {len(entries)} entries")
"""

from abc import ABC
from typing import Any
from app.models.schemas import SubtitleEntry


class BasePlugin(ABC):
    """
    Base class for SubTranslator plugins.
    All methods have default no-op implementations — only override what you need.
    """

    name: str = "unnamed_plugin"
    version: str = "0.1.0"
    description: str = ""
    enabled: bool = True

    async def on_startup(self) -> None:
        """Called when the application starts."""
        pass

    async def on_shutdown(self) -> None:
        """Called when the application shuts down."""
        pass

    async def on_file_uploaded(
        self,
        file_id: str,
        filename: str,
        entries: list[SubtitleEntry],
        metadata: dict[str, Any],
    ) -> None:
        """
        Called after a subtitle file has been parsed and stored.
        :param file_id: Unique identifier for the uploaded file
        :param filename: Original filename
        :param entries: Parsed subtitle entries
        :param metadata: Additional metadata (detected_lang, entry_count, etc.)
        """
        pass

    async def on_translation_start(
        self,
        file_id: str,
        entries: list[SubtitleEntry],
        metadata: dict[str, Any],
    ) -> None:
        """
        Called just before translation begins.
        :param metadata: Includes source_lang, target_lang, provider, mode
        """
        pass

    async def on_translation_complete(
        self,
        file_id: str,
        entries: list[SubtitleEntry],
        metadata: dict[str, Any],
    ) -> None:
        """
        Called after all entries have been translated.
        :param metadata: Includes source_lang, target_lang, provider, mode, duration_seconds
        """
        pass

    async def on_export(
        self,
        file_id: str,
        format: str,
        output_path: str,
        entries: list[SubtitleEntry],
    ) -> None:
        """
        Called after a translated file has been exported.
        :param format: Export format (srt, xlsx, vtt, premiere, davinci)
        :param output_path: Path to the exported file
        """
        pass

    def get_timeline_data(
        self,
        entries: list[SubtitleEntry],
    ) -> list[dict[str, Any]]:
        """
        Optional: Return timeline data for video editor integration.
        Implement this to provide timeline markers, cue points, etc.
        Returns a list of dicts with at minimum: {"time": float, "label": str}
        """
        return []
