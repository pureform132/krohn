#!/usr/bin/env python3
"""KROHN rebrand pass.

Renames Hermes -> KROHN across the source tree with protections:
  * Hermes 2/3/4/5 model names stay (they are model IDs, not the product).
  * URLs that mention hermes stay intact (upstream docs/attribution links).
  * plugin-catalog/, website/, contributors/, .github/, LICENSE are not touched.
  * binary files are skipped.

Usage:  python rebrand.py [--dry-run]
"""
from __future__ import annotations

import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
DRY = "--dry-run" in sys.argv

SKIP_DIRS = {
    ".git", "node_modules", ".venv", "venv", "__pycache__", "dist", "build",
    ".next", "coverage", ".turbo", ".pnpm-store", ".mypy_cache", ".ruff_cache",
    "plugin-catalog", "website", "contributors", ".github",
}
SKIP_FILES = {"LICENSE", "rebrand.py", "NOTICE.md"}

TEXT_EXT = {
    ".py", ".pyi", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json",
    ".json5", ".md", ".mdx", ".yml", ".yaml", ".toml", ".cfg", ".ini", ".txt",
    ".sh", ".bash", ".zsh", ".fish", ".ps1", ".psm1", ".bat", ".cmd", ".html",
    ".css", ".scss", ".sass", ".less", ".svg", ".xml", ".plist", ".nix",
    ".lock", ".example", ".env", ".gitignore", ".gitattributes", ".npmrc",
    ".nvmrc", ".python-version", ".dockerignore", ".prettierignore",
    ".prettierrc", ".editorconfig", ".hadolint.yaml", ".coderabbit.yaml",
}
TEXT_NAMES = {
    "Dockerfile", "Makefile", "Justfile", "justfile", "Procfile", "activate",
    "hermes", "krohn", "CODEOWNERS",
}

MODEL_RE = re.compile(r"(?i)\b(nous[- ]?hermes|hermes[- ]?[2345](?:\.\d+)?)(?![0-9])")
URL_RE = re.compile(r"(?i)(?:https?://|git@)[^\s\"'<>()\[\]{},;]+")

PROTECT = []


def protect(text: str) -> str:
    def keep(m: re.Match[str]) -> str:
        PROTECT.append(m.group(0))
        return f"\x00P{len(PROTECT) - 1}\x00"

    text = MODEL_RE.sub(keep, text)
    text = URL_RE.sub(lambda m: keep(m) if "hermes" in m.group(0).lower() else m.group(0), text)
    return text


def restore(text: str) -> str:
    def put(m: re.Match[str]) -> str:
        return PROTECT[int(m.group(1))]

    return re.sub(r"\x00P(\d+)\x00", put, text)


REPLACEMENTS = [
    ("Hermes Agent", "KROHN"),
    ("Hermes agent", "KROHN"),
    ("hermes-agent", "krohn"),
    ("hermes_agent", "krohn_agent"),
    ("HermesAgent", "KROHNAgent"),
    ("com.nousresearch.hermes", "com.krohn.agent"),
    ("NousResearch.Hermes", "Krohn"),
    ("Hermes", "KROHN"),
    ("hermes", "krohn"),
    ("HERMES", "KROHN"),
]


def rebrand_text(text: str) -> str:
    text = protect(text)
    for old, new in REPLACEMENTS:
        text = text.replace(old, new)
    return restore(text)


def is_text_file(path: str) -> bool:
    name = os.path.basename(path)
    ext = os.path.splitext(name)[1].lower()
    if name in TEXT_NAMES or name.startswith(".env") or name.startswith("."):
        if ext == "" or ext in TEXT_EXT or name in TEXT_NAMES:
            return True
    return ext in TEXT_EXT


def main() -> None:
    changed = 0
    renamed = 0
    scanned = 0

    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in filenames:
            if name in SKIP_FILES:
                continue
            path = os.path.join(dirpath, name)
            if os.path.islink(path) or not os.path.isfile(path):
                continue
            if not is_text_file(path):
                continue
            try:
                with open(path, "rb") as fh:
                    raw = fh.read()
            except OSError:
                continue
            if b"\x00" in raw:
                continue
            try:
                text = raw.decode("utf-8")
            except UnicodeDecodeError:
                continue
            scanned += 1
            new = rebrand_text(text)
            if new != text:
                changed += 1
                if not DRY:
                    with open(path, "w", encoding="utf-8", newline="") as fh:
                        fh.write(new)

    # Rename files and directories, deepest first.
    for dirpath, dirnames, filenames in os.walk(ROOT, topdown=False):
        rel = os.path.relpath(dirpath, ROOT)
        if any(part in SKIP_DIRS for part in rel.split(os.sep)):
            continue
        for name in filenames + dirnames:
            if name in SKIP_FILES:
                continue
            if "hermes" not in name.lower() and "Hermes" not in name:
                continue
            new_name = rebrand_text(name)
            if new_name == name:
                continue
            src = os.path.join(dirpath, name)
            dst = os.path.join(dirpath, new_name)
            if os.path.exists(dst):
                print(f"SKIP collision: {src} -> {dst}")
                continue
            renamed += 1
            if not DRY:
                os.rename(src, dst)

    print(f"scanned={scanned} text_changed={changed} renamed={renamed} dry_run={DRY}")
    print(f"protected_tokens={len(PROTECT)}")


if __name__ == "__main__":
    main()
