"""Meganote routes: the local-first notes app MEGANOTE, embedded in the KROHN web UI.

The whole Meganote workspace is a single JSON document at ``meganote.json`` in the
KROHN home directory. The embedded app (served at ``/meganote/``) syncs to it over
these routes; the agent reads and writes the same file with its normal file tools
(see ``skills/meganote`` for the format and the safe read-modify-write flow).
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request

from krohn_cli.web_deps import late
from krohn_constants import get_krohn_home

router = APIRouter()

_require_token = late("_require_token")


def _store_path() -> Path:
    return Path(get_krohn_home()) / "meganote.json"


def _validate_workspace(doc: Any) -> dict:
    if not isinstance(doc, dict):
        raise HTTPException(status_code=400, detail="meganote.json must be a JSON object")
    if doc.get("version") != 2:
        raise HTTPException(status_code=400, detail="meganote.json: version must be 2")
    notebooks = doc.get("notebooks")
    if not isinstance(notebooks, list):
        raise HTTPException(status_code=400, detail="meganote.json: notebooks must be a list")
    if not isinstance(doc.get("currentId"), str):
        raise HTTPException(status_code=400, detail="meganote.json: currentId must be a string")
    for nb in notebooks:
        if not isinstance(nb, dict) or not isinstance(nb.get("pages"), list):
            raise HTTPException(status_code=400, detail="meganote.json: each notebook needs a pages list")
    return doc


def _mtime(path: Path) -> float | None:
    try:
        return path.stat().st_mtime if path.is_file() else None
    except OSError:
        return None


@router.get("/api/meganote")
async def get_meganote(request: Request, meta: int = Query(0)):
    """Whole-workspace snapshot (or, with ``?meta=1``, just the mtime for cheap polls)."""
    _require_token(request)
    path = _store_path()
    mtime = _mtime(path)
    if meta:
        return {"ok": True, "exists": mtime is not None, "mtime": mtime}
    if mtime is None:
        return {"ok": True, "exists": False, "mtime": None, "data": None}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        # Surface corruption instead of serving half a workspace; the UI falls back to its local copy.
        raise HTTPException(status_code=500, detail=f"meganote.json is not valid JSON: {exc}") from exc
    return {"ok": True, "exists": True, "mtime": mtime, "data": data}


@router.put("/api/meganote")
async def put_meganote(request: Request):
    """Replace the whole-workspace snapshot (atomic write; the UI is the sole frequent writer)."""
    _require_token(request)
    try:
        doc = await request.json()
    except (json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"invalid JSON body: {exc}") from exc
    doc = _validate_workspace(doc)
    path = _store_path()
    tmp = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    try:
        tmp.write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, path)
    except OSError as exc:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass
        raise HTTPException(status_code=500, detail=f"could not write meganote.json: {exc}") from exc
    return {"ok": True, "mtime": _mtime(path), "path": str(path)}
