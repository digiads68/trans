"""
Pytest configuration and shared fixtures.
Sets up environment before importing app modules.
"""

import os
import tempfile
import pytest


def pytest_configure(config):
    """Set environment variables before any app module is imported."""
    os.environ.setdefault("CLIPROXY_API_KEY", "test-key")
    os.environ.setdefault("CLIPROXY_API_BASE", "http://localhost:11434/v1")
    os.environ.setdefault("DEBUG", "false")

    # Use temp dirs for uploads/outputs during tests
    _tmp = tempfile.mkdtemp()
    os.environ.setdefault("UPLOAD_DIR", os.path.join(_tmp, "uploads"))
    os.environ.setdefault("OUTPUT_DIR", os.path.join(_tmp, "outputs"))
    os.makedirs(os.environ["UPLOAD_DIR"], exist_ok=True)
    os.makedirs(os.environ["OUTPUT_DIR"], exist_ok=True)
