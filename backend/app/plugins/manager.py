"""
Plugin manager: discovers, loads, and calls plugin hooks.

Plugins are Python files in the `plugins/` directory at the project root.
Each file should contain at least one class that extends BasePlugin.
"""

import importlib.util
import logging
import os
import sys
from typing import Any

from app.models.schemas import SubtitleEntry
from app.plugins.base import BasePlugin

logger = logging.getLogger(__name__)


class PluginManager:
    """Manages plugin lifecycle: discovery, loading, and hook dispatch."""

    def __init__(self, plugins_dir: str):
        self.plugins_dir = plugins_dir
        self._plugins: list[BasePlugin] = []

    def discover(self) -> int:
        """
        Scan plugins_dir for Python files and load plugin classes.
        Returns number of plugins loaded.
        """
        if not os.path.isdir(self.plugins_dir):
            logger.debug(f"Plugins directory not found: {self.plugins_dir}")
            return 0

        loaded = 0
        for fname in sorted(os.listdir(self.plugins_dir)):
            if not fname.endswith(".py") or fname.startswith("_"):
                continue

            module_path = os.path.join(self.plugins_dir, fname)
            module_name = f"subtranslator_plugin_{fname[:-3]}"

            try:
                spec = importlib.util.spec_from_file_location(module_name, module_path)
                if spec is None or spec.loader is None:
                    continue
                module = importlib.util.module_from_spec(spec)
                sys.modules[module_name] = module
                spec.loader.exec_module(module)

                for attr_name in dir(module):
                    attr = getattr(module, attr_name)
                    if (
                        isinstance(attr, type)
                        and issubclass(attr, BasePlugin)
                        and attr is not BasePlugin
                    ):
                        instance = attr()
                        if instance.enabled:
                            self._plugins.append(instance)
                            logger.info(
                                f"Loaded plugin: {instance.name} v{instance.version} "
                                f"from {fname}"
                            )
                            loaded += 1

            except Exception as e:
                logger.warning(f"Failed to load plugin from {fname}: {e}")

        return loaded

    @property
    def plugins(self) -> list[BasePlugin]:
        return list(self._plugins)

    async def emit_startup(self) -> None:
        for plugin in self._plugins:
            try:
                await plugin.on_startup()
            except Exception as e:
                logger.warning(f"Plugin {plugin.name}.on_startup() failed: {e}")

    async def emit_shutdown(self) -> None:
        for plugin in self._plugins:
            try:
                await plugin.on_shutdown()
            except Exception as e:
                logger.warning(f"Plugin {plugin.name}.on_shutdown() failed: {e}")

    async def emit_file_uploaded(
        self,
        file_id: str,
        filename: str,
        entries: list[SubtitleEntry],
        metadata: dict[str, Any],
    ) -> None:
        for plugin in self._plugins:
            try:
                await plugin.on_file_uploaded(file_id, filename, entries, metadata)
            except Exception as e:
                logger.warning(f"Plugin {plugin.name}.on_file_uploaded() failed: {e}")

    async def emit_translation_start(
        self,
        file_id: str,
        entries: list[SubtitleEntry],
        metadata: dict[str, Any],
    ) -> None:
        for plugin in self._plugins:
            try:
                await plugin.on_translation_start(file_id, entries, metadata)
            except Exception as e:
                logger.warning(f"Plugin {plugin.name}.on_translation_start() failed: {e}")

    async def emit_translation_complete(
        self,
        file_id: str,
        entries: list[SubtitleEntry],
        metadata: dict[str, Any],
    ) -> None:
        for plugin in self._plugins:
            try:
                await plugin.on_translation_complete(file_id, entries, metadata)
            except Exception as e:
                logger.warning(f"Plugin {plugin.name}.on_translation_complete() failed: {e}")

    async def emit_export(
        self,
        file_id: str,
        format: str,
        output_path: str,
        entries: list[SubtitleEntry],
    ) -> None:
        for plugin in self._plugins:
            try:
                await plugin.on_export(file_id, format, output_path, entries)
            except Exception as e:
                logger.warning(f"Plugin {plugin.name}.on_export() failed: {e}")
