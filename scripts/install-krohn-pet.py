#!/usr/bin/env python3
"""Install the KROHN chibi pet locally into the current KROHN_HOME.

Copies packaging/pets/krohn-chibi/{pet.json,spritesheet.png} into
<KROHN_HOME>/pets/krohn-chibi/ and writes a pet.json so the desktop
and CLI can discover and render it.

Does NOT overwrite config.yaml. To activate:
    krohn config set display.pet.slug krohn-chibi

Usage:
    python scripts/install-krohn-pet.py [KROHN_HOME]

Defaults to %KROHN_HOME% if set, else a throwaway temp dir with a note.
"""
from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "packaging" / "pets" / "krohn-chibi"

home_arg = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("KROHN_HOME")
if not home_arg:
    home_arg = os.path.expandvars(r"%LOCALAPPDATA%\krohn\krohn_home") if os.name == "nt" else os.path.expanduser("~/.krohn")
home = Path(home_arg)
pets = home / "pets"
pets.mkdir(parents=True, exist_ok=True)

dst = pets / SRC.name
if dst.exists():
    print(f"already installed: {dst}")
    sys.exit(0)

shutil.copytree(SRC, dst)
shutil.rmtree(dst / "_frames", ignore_errors=True)
print(f"installed {SRC.name} -> {dst}")
print("activate with: krohn config set display.pet.slug krohn-chibi")
