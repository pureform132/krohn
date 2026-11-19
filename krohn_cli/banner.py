"""Welcome banner, ASCII art, skills summary, and update check for the CLI."""
import json
import logging
import os
import re
import shutil
import sys
import threading
from pathlib import Path
from krohn_cli import source_check
# Historical updater import (tests/compat/old_updater_surface.json). In-tree callers use the owner.
from krohn_cli.source_check import _github_compare_behind
from krohn_constants import get_krohn_home
from typing import TYPE_CHECKING, Any, Dict, List, Optional
from krohn_cli._startup_fast import project_root_str

# rich and prompt_toolkit are imported lazily: this module sits on the TUI gateway's critical
# startup path purely for the lightweight update-check helpers, and eager rich/prompt_toolkit
# imports cost ~50ms before ``gateway.ready`` could fire.
if TYPE_CHECKING:
    from rich.console import Console

logger = logging.getLogger(__name__)

# ANSI building blocks for conversation display (``_DIM``/``_RST`` are imported by callbacks.py).
_DIM = "\033[2m"
_RST = "\033[0m"


def _check_via_pypi() -> Optional[int]:
    # Shim to stop the old updater doing work until relaunch. no registry query.
    return None


def check_via_pypi() -> Optional[int]:
    # Shim to stop the old updater doing work until relaunch. status is unknown.
    return None


def _quiet(fn, default=None):
    """``fn()``, or ``default`` on any exception — for best-effort display inputs."""
    try:
        return fn()
    except Exception:
        return default


def cprint(text: str):
    """Print ANSI-colored text through prompt_toolkit's renderer."""
    from prompt_toolkit import print_formatted_text as _pt_print
    from prompt_toolkit.formatted_text import ANSI as _PT_ANSI
    # prompt_toolkit needs a real console: on Windows a redirected/absent stdout raises
    # NoConsoleScreenBufferError, and display helpers must never crash the caller over that.
    if _quiet(lambda: _pt_print(_PT_ANSI(text)) or True) is None:
        print(text)


def _active_skin():
    """The active skin object (raises when the skin engine is unavailable)."""
    from krohn_cli.skin_engine import get_active_skin
    return get_active_skin()


def _skin_color(key: str, fallback: str) -> str:
    """Get a color from the active skin, or return fallback."""
    return _quiet(lambda: _active_skin().get_color(key, fallback), fallback)


# === ASCII Art & Branding ===

from krohn_cli import __release_date__ as RELEASE_DATE
from krohn_cli.version_info import get_version_info

KROHN_AGENT_LOGO = """[bold #E0503E]██╗  ██╗██████╗  ██████╗ ██╗  ██╗███╗   ██╗[/]
[bold #E0503E]██║ ██╔╝██╔══██╗██╔═══██╗██║  ██║████╗  ██║[/]
[bold #E0503E]█████╔╝ ██████╔╝██║   ██║███████║██╔██╗ ██║[/]
[#C8392B]██╔═██╗ ██╔══██╗██║   ██║██╔══██║██║╚██╗██║[/]
[#C8392B]██║  ██╗██║  ██║╚██████╔╝██║  ██║██║ ╚████║[/]
[#C8392B]╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═══╝[/]"""

KROHN_CADUCEUS = """        [rgb(115,121,145)]▄[/][rgb(101,101,122)]▄[/][rgb(114,117,139)]▄[/][rgb(145,151,176)]▄[/][rgb(132,137,160)]▄[/]        
     [rgb(114,105,123)]▄[/][rgb(127,106,123) on rgb(163,113,131)]▄[/][rgb(124,97,116) on rgb(177,156,179)]▄[/][rgb(111,109,132) on rgb(168,138,158)]▄[/][rgb(153,163,188) on rgb(130,135,158)]▄[/][rgb(117,119,141) on rgb(120,126,148)]▄[/][rgb(152,159,183) on rgb(121,124,147)]▄[/][rgb(170,178,205) on rgb(148,154,177)]▄[/][rgb(133,141,165) on rgb(126,135,158)]▄[/][rgb(155,137,158) on rgb(174,163,188)]▄[/][rgb(199,143,162)]▄[/]     
  [rgb(128,134,155)]▄[/][rgb(124,124,144)]▄[/][rgb(143,101,117) on rgb(103,102,121)]▄[/][rgb(120,110,131) on rgb(145,107,125)]▄[/][rgb(125,135,157) on rgb(141,131,152)]▄[/][rgb(183,142,161) on rgb(133,119,139)]▄[/][rgb(165,145,166) on rgb(128,117,137)]▄[/][rgb(152,111,130) on rgb(153,138,160)]▄[/][rgb(118,118,140) on rgb(140,126,148)]▄[/][rgb(115,118,141) on rgb(129,139,162)]▄[/][rgb(129,133,157) on rgb(137,142,165)]▄[/][rgb(115,117,139) on rgb(132,134,157)]▄[/][rgb(165,133,154) on rgb(160,130,150)]▄[/][rgb(189,155,174) on rgb(147,117,136)]▄[/][rgb(153,147,166) on rgb(138,143,165)]▄[/][rgb(113,118,138) on rgb(110,113,133)]▄[/][rgb(130,135,156)]▄[/]  
  [rgb(120,124,145) on rgb(108,111,132)]▄[/][rgb(131,134,155) on rgb(146,153,178)]▄[/][rgb(87,98,117) on rgb(125,131,154)]▄[/][rgb(144,105,124) on rgb(124,108,129)]▄[/][rgb(141,105,125) on rgb(99,84,103)]▄[/][rgb(94,98,118) on rgb(105,112,133)]▄[/][rgb(100,106,128) on rgb(100,90,108)]▄[/][rgb(105,87,107) on rgb(105,68,79)]▄[/][rgb(111,87,104) on rgb(142,76,84)]▄[/][rgb(120,127,149)]▀[/][rgb(132,142,165)]▀[/][rgb(124,117,138) on rgb(142,84,96)]▄[/][rgb(111,92,112) on rgb(112,85,99)]▄[/][rgb(99,103,125) on rgb(100,96,116)]▄[/][rgb(105,107,129) on rgb(108,112,133)]▄[/][rgb(112,114,135) on rgb(143,148,168)]▄[/][rgb(127,132,154) on rgb(153,162,184)]▄[/]  
  [rgb(96,96,117) on rgb(97,99,118)]▄[/][rgb(138,144,168) on rgb(122,125,147)]▄[/][rgb(124,130,153) on rgb(114,119,141)]▄[/][rgb(111,100,121) on rgb(103,90,110)]▄[/][rgb(91,88,107) on rgb(143,95,111)]▄[/][rgb(93,111,132) on rgb(116,104,124)]▄[/][rgb(167,83,93) on rgb(146,80,90)]▄[/][rgb(216,99,104) on rgb(255,133,128)]▄[/][rgb(154,80,90) on rgb(255,120,119)]▄[/][rgb(131,77,86) on rgb(147,79,89)]▄[/][rgb(133,77,85) on rgb(139,77,87)]▄[/][rgb(156,79,89) on rgb(255,117,118)]▄[/][rgb(212,96,102) on rgb(255,128,123)]▄[/][rgb(147,87,101) on rgb(128,81,95)]▄[/][rgb(89,104,126) on rgb(116,101,121)]▄[/][rgb(125,125,145) on rgb(101,95,114)]▄[/][rgb(151,160,182) on rgb(141,148,170)]▄[/]  
   [rgb(108,112,131) on rgb(94,94,109)]▄[/][rgb(114,117,140) on rgb(111,118,139)]▄[/][rgb(90,81,100) on rgb(131,108,128)]▄[/][rgb(104,95,115) on rgb(136,94,112)]▄[/][rgb(121,105,124) on rgb(97,108,129)]▄[/][rgb(147,77,88)]▀[/][rgb(169,81,92) on rgb(145,79,86)]▄[/][rgb(141,81,91) on rgb(205,90,97)]▄[/][rgb(121,78,88) on rgb(236,98,101)]▄[/][rgb(118,78,88) on rgb(242,100,102)]▄[/][rgb(135,80,90) on rgb(214,93,99)]▄[/][rgb(169,80,90) on rgb(141,75,82)]▄[/][rgb(130,83,97) on rgb(97,87,103)]▄[/][rgb(109,105,126) on rgb(137,99,117)]▄[/][rgb(103,97,115) on rgb(126,121,140)]▄[/][rgb(135,141,163) on rgb(138,147,169)]▄[/]  
     [rgb(117,133,155)]▀[/][rgb(140,103,121) on rgb(98,100,120)]▄[/][rgb(132,102,122) on rgb(139,83,101)]▄[/][rgb(95,99,120) on rgb(122,101,121)]▄[/][rgb(104,79,92) on rgb(98,108,131)]▄[/][rgb(133,82,93) on rgb(100,104,125)]▄[/][rgb(120,92,107) on rgb(121,127,151)]▄[/][rgb(119,93,108) on rgb(134,141,167)]▄[/][rgb(132,82,95) on rgb(118,131,154)]▄[/][rgb(100,87,103) on rgb(112,104,128)]▄[/][rgb(124,101,123) on rgb(146,94,111)]▄[/][rgb(151,87,103)]▀[/]    
      [rgb(105,109,129) on rgb(118,120,143)]▄[/][rgb(117,125,148) on rgb(135,141,165)]▄[/][rgb(133,99,114) on rgb(113,113,133)]▄[/][rgb(103,90,109) on rgb(153,123,142)]▄[/][rgb(82,97,115) on rgb(167,124,140)]▄[/][rgb(85,96,115) on rgb(168,120,137)]▄[/][rgb(91,102,122) on rgb(188,123,139)]▄[/][rgb(118,117,137) on rgb(146,116,135)]▄[/][rgb(122,128,151) on rgb(126,123,144)]▄[/]      
     [rgb(167,112,129)]▄[/][rgb(146,111,128) on rgb(149,139,162)]▄[/][rgb(130,101,119) on rgb(117,106,126)]▄[/][rgb(104,88,106) on rgb(157,96,113)]▄[/][rgb(113,111,132) on rgb(143,97,114)]▄[/][rgb(165,125,145) on rgb(88,96,117)]▄[/][rgb(178,127,147) on rgb(108,124,147)]▄[/][rgb(176,127,147) on rgb(114,118,140)]▄[/][rgb(138,106,124) on rgb(158,96,112)]▄[/][rgb(140,107,125) on rgb(117,112,132)]▄[/][rgb(166,124,143)]▄[/]     
     [rgb(141,107,127)]▀[/][rgb(123,121,146) on rgb(103,111,133)]▄[/][rgb(107,99,119)]▀[/][rgb(105,99,118) on rgb(139,101,117)]▄[/][rgb(125,113,131) on rgb(111,118,139)]▄[/][rgb(116,111,133) on rgb(116,121,143)]▄[/][rgb(130,136,161) on rgb(115,118,139)]▄[/][rgb(127,118,140) on rgb(105,111,132)]▄[/][rgb(127,108,127) on rgb(151,107,126)]▄[/][rgb(98,105,125)]▀[/][rgb(135,122,141)]▀[/]     
        [rgb(103,103,122)]▀[/][rgb(116,118,138)]▀[/] [rgb(87,89,105)]▀[/][rgb(113,116,136)]▀[/]        """

# === Skills scanning ===

# Per-process caches: ``None`` until computed, then a 1-tuple ``(value,)`` so a computed ``None``
# is distinguishable from "not yet computed". Reset by assigning ``None`` (tests, ``krohn skills``).
_available_skills_cache: Optional[tuple] = None
_git_banner_state_cache: Optional[tuple] = None
_latest_release_cache: Optional[tuple] = None

_UNCACHED = object()  # compute() result that must not be memoized


def _memo(cache_name: str, compute):
    """Return the cached value under module global ``cache_name``, computing (and storing) it once.

    Not consulted under a routed profile (KROHN_HOME override): every memo here is derived from the
    launch home (its skills tree, its checkout), and the TUI gateway calls these per profile."""
    from krohn_constants import get_krohn_home_override
    if get_krohn_home_override() is not None:
        return compute()
    cached = globals()[cache_name]
    if cached is not None:
        return cached[0]
    value = compute()
    if value is not _UNCACHED:
        globals()[cache_name] = (value,)
    return value


def get_available_skills() -> dict[str, list[str]]:
    """Return skills grouped by category, filtered by platform and disabled state.

    Cached per-process (the skills-tree walk costs ~100ms and feeds only the startup banner);
    ``prefetch_banner_data()`` pays it off-thread. A failed scan yields ``{}`` and is not cached.
    """
    def _scan():
        from tools.skills_tool import find_all_skills
        return find_all_skills()  # already filtered

    def _compute():
        all_skills = _quiet(_scan)
        if all_skills is None:
            return _UNCACHED
        skills_by_category: dict[str, list[str]] = {}
        for skill in all_skills:
            skills_by_category.setdefault(skill.get("category") or "general", []).append(skill["name"])
        return skills_by_category
    result = _memo("_available_skills_cache", _compute)
    return {} if result is _UNCACHED else result


def _resolve_repo_dir() -> Optional[Path]:
    """The active KROHN git checkout, or None if this isn't a git install.

    Prefers the running code's location: ``$KROHN_HOME/krohn/`` may be a stale copy
    carried over by ``--clone-all``.
    """
    repo_dir = Path(project_root_str())
    if not (repo_dir / ".git").exists():
        repo_dir = get_krohn_home() / "krohn"
    return repo_dir if (repo_dir / ".git").exists() else None


def get_git_banner_state(repo_dir: Optional[Path] = None) -> Optional[dict]:
    """Return upstream/local git hashes for the startup banner.

    Cached per-process (default ``repo_dir`` only): 2-3 git subprocesses (~100ms) whose result
    cannot change under a running CLI. The cache lets ``prefetch_banner_data()`` pay it off-thread.
    """
    if repo_dir is not None:
        return _compute_git_banner_state(repo_dir)
    return _memo("_git_banner_state_cache", _compute_git_banner_state)


def _baked_banner_state() -> Optional[dict]:
    """Banner state from the baked build SHA (Docker image path), or None."""
    def _baked():
        from krohn_cli.version_info import get_code_identity
        return get_code_identity().get("short_sha")
    baked = _quiet(_baked)
    return {"upstream": baked, "local": baked, "ahead": 0} if baked else None


def _compute_git_banner_state(repo_dir: Optional[Path] = None) -> Optional[dict]:
    repo_dir = repo_dir or _resolve_repo_dir()
    if repo_dir is None:
        return _baked_banner_state()
    upstream, local = (source_check._git_stdout(["rev-parse", "--short=8", rev], cwd=repo_dir) for rev in ("origin/main", "HEAD"))
    if not upstream or not local:
        # Live-git lookup failed (e.g. shallow clone without origin/main).
        return _baked_banner_state()
    ahead = source_check._git_count(["rev-list", "--count", "origin/main..HEAD"], cwd=repo_dir) or 0
    return {"upstream": upstream, "local": local, "ahead": max(ahead, 0)}


_RELEASE_URL_BASE = "https://github.com/pureform132/krohn/releases/tag"


def get_latest_release_tag(repo_dir: Optional[Path] = None) -> Optional[tuple]:
    """Return ``(tag, release_url)`` for the latest local git tag, or None (a miss is cached too).

    Release URL always points at the canonical NousResearch/krohn repo (forks get no link).
    """
    def _compute():
        rd = repo_dir or _resolve_repo_dir()
        tag = source_check._git_stdout(["describe", "--tags", "--abbrev=0"], cwd=rd, timeout=3) if rd else None
        return (tag, f"{_RELEASE_URL_BASE}/{tag}") if tag else None
    return _memo("_latest_release_cache", _compute)


def format_banner_version_label() -> str:
    """Return the version label shown in the startup banner title."""
    from krohn_cli.config import get_project_root
    from krohn_cli.steward import read_install_stamp
    from krohn_cli.update_channel import is_canary_tag

    stamp = read_install_stamp(get_project_root())
    if stamp.get("distribution") == "desktop-app":
        label = f"KROHN v{get_version_info().derived_version}"
        if stamp.get("source") == "commit-build":
            return f"{label} · commit-build · {str(stamp.get('commit') or '')[:12]}"
        if stamp.get("tag"):
            channel = "canary" if is_canary_tag(stamp["tag"]) else "stable"
            return f"{label} · {channel}"
        if stamp.get("payload") == "bootstrap":
            # The old installer shell's CLI backend: the shell never updates
            # itself (`self`), the managed checkout under it does. Name the
            # shell so it doesn't read as a plain packaged build.
            return f"{label} · installer"
        return label

    base = f"KROHN v{get_version_info().derived_version} ({RELEASE_DATE})"
    from krohn_cli.config import load_config
    from krohn_cli.update_channel import resolve_update_channel

    channel = resolve_update_channel(_quiet(load_config), get_project_root())
    if channel != "main":
        head = source_check._git_stdout(["rev-parse", "HEAD"], cwd=get_project_root())
        return f"{base} · {channel}" + (f" · local {head[:12]}" if head else "")
    state = get_git_banner_state()
    if not state:
        return base
    upstream, local = state["upstream"], state["local"]
    ahead = int(state.get("ahead") or 0)
    return base


# === Non-blocking update check ===

_update_result: Optional[int] = None
_update_check_done = threading.Event()


def _daemon(name: Optional[str], target) -> None:
    """Start a daemon thread running ``target`` with any exception swallowed."""
    threading.Thread(target=lambda: _quiet(target), name=name, daemon=True).start()


def _skip_background_prefetch() -> bool:
    """True when the banner's background prefetch threads must not start.

    Under pytest the prefetch daemon threads shell out to git (``rev-parse``,
    ``remote get-url``, the banner's git state) at an arbitrary point after
    import, and any test that patches the process-wide ``subprocess`` singleton
    (``patch("subprocess.run")`` / ``patch("subprocess.Popen")``) can record
    that stray spawn in place of the call it meant to pin.  Importing
    ``tui_gateway.server`` starts this prefetch, which is what flaked
    tests/tui_gateway/test_bot_relay_methods.py.
    Nothing under pytest needs a live update check; tests that exercise the
    prefetch itself monkeypatch this predicate to False.

    ``PYTEST_CURRENT_TEST`` is only set while a test runs, not during
    collection-time imports, hence the ``sys.modules`` check as well.
    """
    return "PYTEST_CURRENT_TEST" in os.environ or "pytest" in sys.modules


def prefetch_update_check():
    """Kick off update check in a background daemon thread.

    No-op under pytest — see ``_skip_background_prefetch``.
    """
    if _skip_background_prefetch():
        _update_check_done.set()
        return

    def _run():
        global _update_result
        _update_result = source_check.check_for_updates(passive=True).get("behind")
        _update_check_done.set()
    _daemon(None, _run)


_banner_data_prefetch_started = False


def prefetch_banner_data():
    """Warm the banner's subprocess/I/O-heavy inputs in a daemon thread.

    Git state (~130ms) and the skills index (~110ms) are cached per-process by their own modules,
    so warming them while the main thread pays the CPU-bound imports overlaps GIL-releasing I/O
    with import work. Idempotent; failures don't matter because the banner recomputes anything missing.
    """
    global _banner_data_prefetch_started
    if _banner_data_prefetch_started:
        return
    if _skip_background_prefetch():
        # Same stray-git-spawn cross-talk class as prefetch_update_check:
        # get_git_banner_state() shells out via the shared subprocess
        # singleton from a daemon thread, poisoning process-wide subprocess
        # mocks in unrelated tests.
        _banner_data_prefetch_started = True
        return
    _banner_data_prefetch_started = True
    _daemon("banner-data-prefetch", lambda: [_quiet(warm) for warm in (
        get_git_banner_state, get_latest_release_tag, get_available_skills)])


def get_update_result(timeout: float = 0.5) -> Optional[int]:
    """Get result of prefetched check. Returns None if not ready."""
    _update_check_done.wait(timeout=timeout)
    return _update_result


def _format_update_notice(behind: int) -> str:
    """Render the update warning line for a non-zero ``behind`` result."""
    from krohn_cli.config import get_managed_update_command, recommended_update_command
    if behind > 0:
        return (
            f"[bold yellow]⚠ {behind} {_plural(behind, 'commit')} behind[/]"
            f"[dim yellow] — run [bold]{recommended_update_command()}[/bold] to update[/]")
    # UPDATE_AVAILABLE_NO_COUNT (nix): an update exists but we don't know by how much, nor how
    # the user installed (nix run, profile, system flake, home-manager).
    managed_cmd = get_managed_update_command()
    suffix = f"[dim yellow] — run [bold]{managed_cmd}[/bold][/]" if managed_cmd else ""
    return f"[bold yellow]⚠ update available[/]{suffix}"


_deferred_update_notice_started = False


def _render_markup_to_ansi(markup: str) -> str:
    """Rich markup → ANSI string, for output that must go through prompt_toolkit's renderer.

    Under ``patch_stdout`` (the interactive CLI), a plain ``Console.print`` writes ESC bytes into
    the StdoutProxy, which sanitizes them into visible ``?[1;33m…`` artifacts (#83969).
    """
    from io import StringIO
    from rich.console import Console as _Console
    buf = StringIO()
    _Console(file=buf, force_terminal=True, color_system="truecolor", highlight=False).print(markup)
    return buf.getvalue().rstrip("\n")


def _defer_update_notice(max_wait: float = 30.0) -> None:
    """Print the update warning once the prefetched check completes (at most once per process).

    Used when the banner rendered before the update prefetch finished so startup never blocks on
    git/network. The notice lands after prompt_toolkit owns the terminal, so it is routed through
    ``cprint`` (prompt_toolkit's renderer prints above a running application from any thread).
    """
    global _deferred_update_notice_started
    if _deferred_update_notice_started:
        return
    _deferred_update_notice_started = True

    def _wait_and_print() -> None:
        if _update_check_done.wait(timeout=max_wait) and _update_result:
            cprint(_render_markup_to_ansi(_format_update_notice(_update_result)))
    _daemon("update-notice", _wait_and_print)  # never break the session over an update notice


# === Welcome banner ===

def _plural(n: int, word: str) -> str:
    return word if n == 1 else f"{word}s"


def _format_context_length(tokens: int) -> str:
    """Format a token count for display (e.g. 128000 → '128K', 1048576 → '1M')."""
    for unit, div in (("M", 1_000_000), ("K", 1_000)):
        if tokens >= div:
            val = tokens / div
            rounded = round(val)
            return f"{rounded}{unit}" if abs(val - rounded) < 0.05 else f"{val:.1f}{unit}"
    return str(tokens)


def _display_toolset_name(toolset_name: str) -> str:
    """Normalize internal/legacy toolset identifiers for banner display."""
    return toolset_name.removesuffix("_tools") if toolset_name else "unknown"


def _short_label(name: str) -> str:
    """Truncate a model/preset slug to fit the banner's left column."""
    return name[:25] + "..." if len(name) > 28 else name


# === Banner snapshot — warm-launch fast path ===
# The tool panel needs the full tool registry (~0.5-0.9s cold, the largest chunk of time-to-
# banner). The list is a pure function of (config.yaml, .env, code checkout, enabled toolsets),
# so the rendered inputs are snapshotted to disk and replayed when the fingerprint matches. The
# agent's REAL tool list is still computed fresh at first message; the snapshot only feeds the
# cosmetic panel, and a background refresh (cli.show_banner) re-verifies it right after render.

_BANNER_SNAPSHOT_VERSION = 1


def _banner_snapshot_path() -> Path:
    return get_krohn_home() / "cache" / "banner_snapshot.json"


def banner_snapshot_fingerprint() -> Optional[str]:
    """Fingerprint the inputs the banner tool panel depends on."""
    import hashlib
    def _inputs():
        from krohn_cli.config import get_config_path
        return (get_config_path(), get_krohn_home() / ".env")
    paths = _quiet(_inputs)
    if paths is None:
        return None
    parts = [f"v{_BANNER_SNAPSHOT_VERSION}"]
    for p in paths:
        st = _quiet(p.stat)
        parts.append(f"{p.name}:{st.st_mtime_ns}:{st.st_size}" if st else f"{p.name}:absent")
    # Code checkout: commit when known, otherwise its derived version.
    version_info = get_version_info()
    parts.append(version_info.commit or version_info.derived_version)
    state = get_git_banner_state()
    if state:
        parts.append(str(state.get("local", "")))
    return hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()


def load_banner_snapshot(enabled_toolsets: list[str] | None = None) -> Optional[dict[str, Any]]:
    """Return the stored banner snapshot when its fingerprint is current."""
    blob = _quiet(lambda: json.loads(_banner_snapshot_path().read_text(encoding="utf-8-sig")))
    if not isinstance(blob, dict):
        return None
    fp = banner_snapshot_fingerprint()
    if (not fp or blob.get("fingerprint") != fp
            or blob.get("enabled_toolsets") != sorted(enabled_toolsets or [])
            or not isinstance(blob.get("tools"), list)
            or not all(isinstance(blob.get(k), dict)
                       for k in ("toolset_map", "availability", "skills_by_category"))):
        return None
    return blob


def save_banner_snapshot(tools: list[dict], enabled_toolsets: list[str], availability: dict[str, Any],
                         toolset_map: dict[str, str]) -> None:
    """Persist the banner tool panel inputs for next launch (best-effort)."""
    fp = banner_snapshot_fingerprint()
    if not fp:
        return
    payload = {
        "fingerprint": fp,
        "enabled_toolsets": sorted(enabled_toolsets or []),
        "tools": [{"function": {"name": t["function"]["name"]}}
                  for t in tools if isinstance(t, dict) and t.get("function", {}).get("name")],
        "toolset_map": toolset_map,
        "availability": {
            "unavailable_toolsets": availability.get("unavailable_toolsets", []),
            **{k: list(availability.get(k, [])) for k in ("lazy_tools", "disabled_tools")}},
        "skills_by_category": get_available_skills(),
    }

    def _write():
        from utils import atomic_json_write
        atomic_json_write(_banner_snapshot_path(), payload, indent=None, mode=0o600)
    _quiet(_write)


def compute_toolset_availability(enabled_toolsets: list[str] | None = None) -> dict[str, Any]:
    """Compute ``{"unavailable_toolsets", "lazy_tools", "disabled_tools"}`` for the banner.

    Split out so the result can be snapshotted and replayed without importing ``model_tools``.
    """
    from model_tools import check_tool_availability, TOOLSET_REQUIREMENTS
    enabled_toolsets = enabled_toolsets or []
    _, unavailable_toolsets = check_tool_availability(quiet=True)
    # The availability check walks the GLOBAL registry, so it includes toolsets outside this
    # agent's platform set (e.g. `discord` on a CLI session) which must never surface in
    # "Available Tools". Restrict to enabled toolsets; an enabled toolset with unmet deps
    # legitimately shows as disabled/lazy below.
    _enabled_ts = {str(t) for t in enabled_toolsets}
    if _enabled_ts:
        unavailable_toolsets = [
            item for item in unavailable_toolsets if str(item.get("id", item.get("name", ""))) in _enabled_ts]
    # Toolsets with a check_fn are lazy-initialized (e.g. honcho): unavailable at banner time
    # because the check hasn't run yet, but not misconfigured.
    lazy_tools, disabled_tools = set(), set()
    for item in unavailable_toolsets:
        is_lazy = TOOLSET_REQUIREMENTS.get(item.get("name", ""), {}).get("check_fn")
        (lazy_tools if is_lazy else disabled_tools).update(item.get("tools", []))
    return {"unavailable_toolsets": unavailable_toolsets, "lazy_tools": sorted(lazy_tools),
            "disabled_tools": sorted(disabled_tools)}


def _mcp_server_line(srv: dict, *, dim: str, text: str) -> str:
    """One banner line for an MCP server status entry."""
    name, transport = srv["name"], srv["transport"]
    if srv["connected"]:
        return f"[dim {dim}]{name}[/] [{text}]({transport})[/] [dim {dim}]—[/] [{text}]{srv['tools']} tool(s)[/]"
    # Needs srv['tools'], so it cannot live in the suffix dict below. A registered but unspawned
    # server has callable tools; falling through to the red "failed" line misreports a working setup.
    if srv.get("status") == "lazy":
        return (f"[dim {dim}]{name}[/] [{text}]({transport})[/] [dim {dim}]—[/] "
                f"[{text}]{srv['tools']} tool(s)[/] [dim {dim}](lazy, starts on first use)[/]")
    status = "disabled" if srv.get("disabled") else srv.get("status")
    suffix = {"disabled": f"[dim {dim}]— disabled[/]", "connecting": "[yellow]— connecting[/]",
              "configured": f"[dim {dim}]— configured[/]"}.get(status)
    if suffix is not None:
        return f"[dim {dim}]{name}[/] [dim]({transport})[/] {suffix}"
    return _mcp_failed_line(name, transport, srv.get("error"))


def _mcp_failed_line(name: str, transport: str, error: Optional[str]) -> str:
    """Failed MCP connect: the short reason (already humanised by ``_format_connect_error``) and the
    exact next command, so 'failed' is never the whole story."""
    from rich.markup import escape
    reason = escape(" ".join(str(error or "").split())[:120]) or "no details recorded"
    next_cmd = (f"krohn mcp login {name}" if re.search(r"\b401\b|unauthori[sz]ed", reason, re.IGNORECASE)
                else f"krohn mcp test {name}")
    return (f"[red]{name}[/] [dim]({transport})[/] [red]— could not connect:[/] {reason} "
            f"[dim]— run `{next_cmd}`[/]")


def _truncate_tool_names(tool_names: list[str]) -> list[Optional[str]]:
    """Cut a toolset's tool list to ~42 columns; ``None`` marks the elided tail."""
    if len(", ".join(tool_names)) <= 45:
        return list(tool_names)
    short_names: list[Optional[str]] = []
    length = 0
    for name in tool_names:
        if length + len(name) + 2 > 42:
            short_names.append(None)
            break
        short_names.append(name)
        length += len(name) + 2
    return short_names


def _pack_skill_names(skill_names: list[str], avail: int) -> str:
    """Join skill names into ``avail`` columns, ending with ``+N more`` when they don't all fit."""
    parts: list[str] = []
    length = 0
    for i, name in enumerate(skill_names):
        needed = (2 if parts else 0) + len(name)
        after = len(skill_names) - (i + 1)  # indicator size IF we add this skill then stop
        ind_len = len(f", +{after} more") if after > 0 else 0
        if parts and length + needed + ind_len > avail:
            parts.append(f"+{len(skill_names) - len(parts)} more")
            break
        parts.append(name)
        length += needed
    return ", ".join(parts)


def _moa_aggregator_label(preset_name: str) -> str:
    """Short aggregator-model label for a MoA preset ("" when the preset has none)."""
    from krohn_cli.config import load_config
    from krohn_cli.moa_config import normalize_moa_config
    preset = normalize_moa_config(load_config().get("moa") or {}).get("presets", {}).get(preset_name)
    model = str(((preset or {}).get("aggregator") or {}).get("model") or "")
    return model.split("/")[-1]


def _mcp_configured() -> bool:
    """Cheap probe: does config.yaml or the persisted plugin key cache name any MCP server?

    The full ``get_mcp_status()`` path resolves portable plugin MCP servers, which JOINS the in-flight
    background plugin discovery (~100ms on the startup path), so skip it when nothing is configured.
    When either probe can't tell, take the full path.
    """
    def _native():
        from krohn_cli.config import load_config
        return bool((load_config() or {}).get("mcp_servers"))

    def _portable():
        from krohn_cli.plugins import get_portable_mcp_server_names_nowait
        return bool(get_portable_mcp_server_names_nowait())
    return _quiet(_native, True) or _quiet(_portable, True)


def _probe_mcp_status() -> list:
    from tools.mcp_tool_discovery import get_mcp_status
    return get_mcp_status()


def _codex_runtime_active() -> bool:
    """True when the codex_app_server runtime is active (tool counts then live inside codex)."""
    from krohn_cli.codex_runtime_switch import get_current_runtime
    from krohn_cli.config import load_config
    return get_current_runtime(load_config()) == "codex_app_server"


def _active_profile_name() -> Optional[str]:
    from krohn_cli.profiles import get_active_profile_name
    return get_active_profile_name()


def _banner_left_lines(model: str, cwd: str, session_id, context_length, provider, *, accent: str, dim: str,
                       context_pinned: bool = False, context_marker: str = "") -> list:
    """Model / cwd / session lines under the hero art. ``context_pinned`` marks a
    ``model.context_length`` pin so the user can tell it apart from provider metadata (#66168);
    ``context_marker`` (``"pinned"`` / ``"fallback"``, agent.context_pin) also marks a defaulted window."""
    def _dim_sep(label: str) -> str:
        return f" [dim {dim}]·[/] [dim {dim}]{label}[/]"
    lines = []
    marker = context_marker or ("pinned" if context_pinned else "")
    pin = f" ({marker})" if marker else ""
    ctx_str = _dim_sep(f"{_format_context_length(context_length)} context{pin}") if context_length else ""
    nous_str = _dim_sep("Cesar D. Ciprian")
    if (provider or "").strip().lower() == "moa":
        # MoA virtual provider: ``model`` is a preset name; show it with its aggregator.
        agg_label = _quiet(lambda: _moa_aggregator_label(model), "")
        agg_str = _dim_sep(f"agg {agg_label}") if agg_label else ""
        lines.append(f"[{accent}]MoA: {_short_label(model)}[/]{agg_str}{ctx_str}{nous_str}")
    elif not (model or "").strip() or (model or "").strip().lower() == "unknown":
        # Unconfigured install: the clearest place to say what is wrong and how to fix it.
        lines.append(f"[bold red]no model configured[/] [dim {dim}]— run /model or krohn setup[/]")
    else:
        model_short = model.split("/")[-1].removesuffix(".gguf")
        lines.append(f"[{accent}]{_short_label(model_short)}[/]{ctx_str}{nous_str}")
    if os.getenv("KROHN_YOLO_MODE"):
        lines.append(f"[bold red]⚠ YOLO mode[/] [dim {dim}]— all approval prompts bypassed[/]")
    lines.append(f"[dim {dim}]{cwd}[/]")
    if session_id:
        lines.append(f"[dim {_skin_color('session_border', '#4A4036')}]Session: {session_id}[/]")
    return lines


def _banner_tool_lines(
    tools: list, unavailable_toolsets: list, get_toolset_for_tool, *,
    lazy_tools: set, disabled_tools: set, accent: str, dim: str, text: str) -> list:
    """"Available Tools" section: up to 8 toolsets, each truncated to ~42 columns."""
    lines = [f"[bold {accent}]Available Tools[/]"]
    toolsets_dict: dict[str, list] = {}
    for tool in tools:
        tool_name = tool["function"]["name"]
        toolset = _display_toolset_name(get_toolset_for_tool(tool_name) or "other")
        toolsets_dict.setdefault(toolset, []).append(tool_name)
    for item in unavailable_toolsets:
        names = toolsets_dict.setdefault(_display_toolset_name(item.get("id", item.get("name", "unknown"))), [])
        for tool_name in item.get("tools", []):
            if tool_name not in names:
                names.append(tool_name)

    def _color_tool(name: Optional[str]) -> str:
        if name is None:  # truncation marker
            return "[dim]...[/]"
        color = "red" if name in disabled_tools else "yellow" if name in lazy_tools else text
        return f"[{color}]{name}[/]"
    sorted_toolsets = sorted(toolsets_dict.keys())
    for toolset in sorted_toolsets[:8]:
        tool_names = _truncate_tool_names(sorted(toolsets_dict[toolset]))
        lines.append(f"[dim {dim}]{toolset}:[/] {', '.join(_color_tool(n) for n in tool_names)}")
    if len(sorted_toolsets) > 8:
        lines.append(f"[dim {dim}](and {len(sorted_toolsets) - 8} more toolsets...)[/]")
    return lines


def _banner_skill_lines(skills_by_category: dict[str, list[str]], skills_enabled: bool, *, dim: str, text: str) -> list:
    """"Available Skills" body, sized to ~60% of the terminal width (the right grid column)."""
    if not skills_enabled:
        return [f"[dim {dim}]Skills toolset disabled[/]"]
    if not skills_by_category:
        return [f"[dim {dim}]No skills installed[/]"]
    right_col_width = max(int(shutil.get_terminal_size().columns * 0.6) - 10, 30)
    lines = []
    for category in sorted(skills_by_category.keys()):
        # Account for the "category: " prefix.
        skills_str = _pack_skill_names(sorted(skills_by_category[category]), max(right_col_width - len(category) - 2, 20))
        lines.append(f"[dim {dim}]{category}:[/] [{text}]{skills_str}[/]")
    return lines


def build_welcome_banner(
    console: "Console", model: str, cwd: str, tools: list[dict] | None = None, enabled_toolsets: list[str] | None = None,
    session_id: str | None = None, get_toolset_for_tool=None, context_length: int | None = None, provider: str | None = None,
    availability: dict[str, Any] | None = None, skills_by_category: dict[str, list[str]] | None = None,
    context_pinned: bool = False, context_marker: str = "",
):
    """Build and print a welcome banner with caduceus on left and info on right.

    When ``provider == "moa"``, ``model`` is a MoA preset name and the aggregator is rendered.
    Passing a precomputed ``availability`` together with ``get_toolset_for_tool`` avoids any
    ``model_tools`` import (banner snapshot replay).
    """
    from rich.panel import Panel
    from rich.table import Table
    if get_toolset_for_tool is None:
        from model_tools import get_toolset_for_tool
    tools = tools or []
    enabled_toolsets = enabled_toolsets or []
    if availability is None:
        availability = compute_toolset_availability(enabled_toolsets)
    _enabled_ts = {str(t) for t in enabled_toolsets}
    # Resolve skin colors once for the entire banner
    accent = _skin_color("banner_accent", "#E0503E")
    dim = _skin_color("banner_dim", "#8A6A2E")
    text = _skin_color("banner_text", "#F2EAD9")
    # Use skin's custom caduceus art if provided
    _bskin = _quiet(_active_skin)
    left_lines = ["", getattr(_bskin, "banner_hero", None) or KROHN_CADUCEUS, ""]
    left_lines += _banner_left_lines(model, cwd, session_id, context_length, provider, accent=accent, dim=dim,
                                     context_pinned=context_pinned, context_marker=context_marker)
    right_lines = _banner_tool_lines(
        tools, availability.get("unavailable_toolsets", []), get_toolset_for_tool,
        lazy_tools=set(availability.get("lazy_tools", [])), disabled_tools=set(availability.get("disabled_tools", [])),
        accent=accent, dim=dim, text=text)
    # MCP Servers section (only if configured) — see ``_mcp_configured`` for why the cheap probe.
    mcp_status = _quiet(_probe_mcp_status, []) if _mcp_configured() else []
    if mcp_status:
        right_lines += ["", f"[bold {accent}]MCP Servers[/]"]
        right_lines.extend(_mcp_server_line(srv, dim=dim, text=text) for srv in mcp_status)
    right_lines += ["", f"[bold {accent}]Available Skills[/]"]
    # The skills catalog is only reachable when the `skills` toolset is enabled (skill_view /
    # skill_manage). When disabled (Blank Slate) the agent cannot load any skill, so advertising
    # the on-disk catalog would be misleading — reflect the real state.
    _skills_enabled = (not _enabled_ts) or ("skills" in _enabled_ts)
    if not _skills_enabled:
        skills_by_category = {}
    elif skills_by_category is None:
        skills_by_category = get_available_skills()
    total_skills = sum(len(s) for s in skills_by_category.values())
    right_lines += _banner_skill_lines(skills_by_category, _skills_enabled, dim=dim, text=text)
    right_lines.append("")
    mcp_connected = sum(1 for s in mcp_status if s["connected"])
    summary_parts = [f"{len(tools)} tools", f"{total_skills} skills"]
    if mcp_connected:
        summary_parts.append(f"{mcp_connected} MCP servers")
    summary_parts.append("/help for commands")
    # Flag the codex_app_server runtime so users understand why tool counts may not match what's
    # reachable (codex builds its own tool list inside the spawned subprocess).
    if _quiet(_codex_runtime_active, False):
        right_lines.append(f"[bold {accent}]Runtime:[/] [{text}]codex app-server[/] "
                           f"[dim {dim}](terminal/file ops/MCP run inside codex)[/]")
    # Show active profile name when not 'default'. Never break the banner over a profiles.py bug.
    _profile_name = _quiet(_active_profile_name)
    if _profile_name and _profile_name != "default":
        right_lines.append(f"[bold {accent}]Profile:[/] [{text}]{_profile_name}[/]")
    right_lines.append(f"[dim {dim}]{' · '.join(summary_parts)}[/]")
    # Update check — NEVER block the banner on it: the prefetch does git/network work that rarely
    # finishes before render, so a blocking wait adds its full timeout to every startup. If not
    # ready, a daemon thread prints the same notice above the prompt when it lands.
    def _update_line():
        behind = get_update_result(timeout=0.05)
        if behind is None and not _update_check_done.is_set():
            _defer_update_notice()
        elif behind is not None and behind != 0:
            right_lines.append(_format_update_notice(behind))
    _quiet(_update_line)  # Never break the banner over an update check
    layout_table = Table.grid(padding=(0, 2))
    layout_table.add_column("left", justify="left")
    layout_table.add_column("right", justify="left")
    layout_table.add_row("\n".join(left_lines), "\n".join(right_lines))
    version_label = format_banner_version_label()
    release_info = get_latest_release_tag()
    if release_info:
        version_label = f"[link={release_info[1]}]{version_label}[/link]"
    outer_panel = Panel(
        layout_table, title=f"[bold {_skin_color('banner_title', '#E0503E')}]{version_label}[/]",
        border_style=_skin_color("banner_border", "#C8392B"), padding=(0, 2))
    console.print()
    if shutil.get_terminal_size().columns >= 95:
        console.print(getattr(_bskin, "banner_logo", None) or KROHN_AGENT_LOGO)
        console.print()
    console.print(outer_panel)
