"""Resolve KROHN_HOME for standalone skill scripts.

Skill scripts may run outside the KROHN process (system Python, nix env,
CI) where ``krohn_constants`` is not importable.  This module provides the
same ``get_krohn_home()`` contract without requiring it on ``sys.path``.

When ``krohn_constants`` IS available it is used directly so profile
resolution and any future enhancements are picked up automatically.
"""

from __future__ import annotations

import os
from pathlib import Path

try:
    from krohn_constants import get_krohn_home
except (ModuleNotFoundError, ImportError):

    def get_krohn_home() -> Path:
        """Return the KROHN home directory (default: ``~/.krohn``)."""
        val = os.environ.get("KROHN_HOME", "").strip()
        return Path(val) if val else Path.home() / ".krohn"
