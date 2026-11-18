"""Resolve KROHN_HOME for standalone skill scripts.

Skill scripts may run outside the KROHN process (e.g. system Python,
nix env, CI) where ``krohn_constants`` is not importable.  This module
provides the same ``get_krohn_home()`` and ``display_krohn_home()``
contracts as ``krohn_constants`` without requiring it on ``sys.path``.

When ``krohn_constants`` IS available it is used directly so that any
future enhancements (profile resolution, Docker detection, etc.) are
picked up automatically.  The fallback path replicates the core logic
from ``krohn_constants.py`` using only the stdlib.

All scripts under ``google-workspace/scripts/`` should import from here
instead of duplicating the ``KROHN_HOME = Path(os.getenv(...))`` pattern.
"""

from __future__ import annotations

import os
from pathlib import Path

try:
    from krohn_constants import display_krohn_home
    from krohn_constants import get_krohn_home
except (ModuleNotFoundError, ImportError):

    def get_krohn_home() -> Path:
        """Return the KROHN home directory (default: ~/.krohn).

        Mirrors ``krohn_constants.get_krohn_home()``."""
        val = os.environ.get("KROHN_HOME", "").strip()
        return Path(val) if val else Path.home() / ".krohn"

    def display_krohn_home() -> str:
        """Return a user-friendly ``~/``-shortened display string.

        Mirrors ``krohn_constants.display_krohn_home()``."""
        home = get_krohn_home()
        try:
            return "~/" + home.relative_to(Path.home()).as_posix()
        except ValueError:
            return str(home)
