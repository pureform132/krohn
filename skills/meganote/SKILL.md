---
name: meganote
description: Read, search, create and edit notes in MEGANOTE — the notes app built into KROHN (local-first, Spanish-first, Notion-inspired). The agent's total access to the user's notes goes through one JSON file.
version: 1.0.0
author: Cesar David Ciprian, KROHN
license: MIT
platforms: [windows, linux, macos]
metadata:
  krohn:
    tags: [Notes, Meganote, Productivity]
    related_skills: [obsidian]
---

# MEGANOTE — las notas del sistema

KROHN ships MEGANOTE as a default, first-class part of the product: a local-first, Spanish-first, Notion-inspired notes app embedded in the web UI (rail icon **Meganote**). The agent is expected to have total access to it: read, search, create, edit. All of it goes through one file.

## Where the data lives

The ENTIRE workspace is a single JSON document: **`meganote.json` in the KROHN home directory** (the same folder as `config.yaml`; on Windows `%LOCALAPPDATA%\krohn\meganote.json`). Resolve it with `read_file` on that concrete path — do not hand-type `~` or `$VAR`.

The file does not exist until either the user opens the notes view once (the app syncs on boot) or you create it. Treat a missing file as "empty workspace" and initialize it in the format below if the user asks for notes before any exists.

The embedded app syncs to this same file: reads are always safe; your writes appear in the UI within ~12s (the app polls the file mtime) or instantly on the next open.

## Format (version 2) — preserve it exactly

```json
{
  "version": 2,
  "currentId": "<current notebook id>",
  "notebooks": [
    {
      "id": "<notebook id>",
      "name": "Personal",
      "icon": "leaf",
      "created": 1730000000000,
      "pages": [
        {
          "id": "<page id>",
          "parentId": null,
          "title": "Título",
          "icon": "",
          "kind": "page",
          "favorite": false,
          "trashed": false,
          "created": 1730000000000,
          "updated": 1730000000000,
          "blocks": [
            { "id": "<block id>", "type": "text", "text": "plano", "html": "html en línea <b>negritas</b>", "level": 0 }
          ]
        }
      ]
    }
  ]
}
```

- `text` is the plain-text content; `html` keeps inline formatting. Keep both consistent.
- Block types include: `text`, `h1`, `h2`, `h3`, `bulleted`, `numbered`, `todo` (plus `checked`), `toggle` (plus `open`), `quote`, `code` (plus `lang`), `callout`, `divider`, `table`, `columns`, `database`, `image`, `subpage`, `pageLink`.
- When editing a page, set its `updated` to the current epoch milliseconds. Keep `version: 2`, keep ids stable, never drop notebooks/pages the user owns — merge, don't replace.

## Reading

`read_file` the file (it can be large; use offset/limit only after you know its size, or read it fully the first time). Answer from the structure: notebook names, page titles, block contents. For "search my notes about X", scan titles + block text yourself.

## Writing

1. `read_file` the whole file first — every time.
2. Modify the parsed structure; if the task spans many blocks, work in memory, not by patching JSON text.
3. Write the COMPLETE document back with `write_file` — never a partial file, never `"..."` elisions.
4. The file must remain valid JSON with `version: 2` and those three top-level keys. If you cannot guarantee that, show the user the proposed changes instead of writing.
5. After writing, tell the user the notes view will refresh on its own (or on next open). If you made many/destructive edits, ask them to close the notes tab first — the app pushes its in-memory state back every few seconds while dirty, which could overwrite yours. Prefer editing right after the app has just synced (no local changes pending).

## Housekeeping

- Deleting = set `"trashed": true` on the page, never rm the JSON file.
- New ids: any unique string (the app uses base36 timestamp + random). Use `Date.now().toString(36)` + random suffixes.
- Do not create stray top-level keys; the app validates on load and may fall back to its last good local state (hiding your edit) if the file is malformed.
