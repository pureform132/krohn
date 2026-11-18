"""Login shells in the image keep KROHN' own dirs on PATH.

Debian's ``/etc/profile`` resets PATH for every login shell, so without
``/etc/profile.d/krohn.sh`` a ``bash -l`` (``docker exec <c> bash -l``, ssh, the
terminal tool's background ``bash -lic``) lost ``/opt/krohn/bin`` and bare
``krohn`` exited 127 (#56634).
"""
from __future__ import annotations

import subprocess


def test_login_shell_resolves_krohn_to_the_image_shim(built_image: str) -> None:
    r = subprocess.run(
        ["docker", "run", "--rm", "-u", "krohn", "--entrypoint", "bash", built_image,
         "-lc", 'echo "krohn=$(command -v krohn)"; echo "path=$PATH"'],
        capture_output=True, text=True, timeout=60, check=False,
    )
    assert r.returncode == 0, r.stderr
    lines = dict(line.split("=", 1) for line in r.stdout.splitlines() if "=" in line)
    assert lines["krohn"] == "/opt/krohn/bin/krohn"
    entries = lines["path"].split(":")
    assert entries.index("/opt/krohn/bin") < entries.index("/opt/krohn/.venv/bin")
    assert entries.count("/opt/krohn/bin") == 1
