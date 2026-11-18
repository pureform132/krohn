"""A dashboard-spawned ``krohn -p <other> ...`` child keeps the launch environment's
launch-only keys (#135200). The named-profile scrub drops every key the root/home ``.env``
names, but a launch-only key is never loaded from ``.env``: the value in ``os.environ`` is the
administrator's, so a planted ``KROHN_MANAGED_DIR=`` line must not remove it from the child.
"""

from __future__ import annotations

from pathlib import Path

import pytest


@pytest.mark.parametrize("planted_name", ["KROHN_MANAGED_DIR", "krohn_managed_dir"])
def test_planted_dotenv_line_does_not_strip_launch_managed_dir(tmp_path, monkeypatch, planted_name):
    root = tmp_path / "krohn"
    (root / "profiles" / "other").mkdir(parents=True)
    (root / "profiles" / "other" / "config.yaml").write_text("{}\n")
    (root / ".env").write_text(f"{planted_name}={tmp_path}/planted\nFOO_RESIDUE=1\n", encoding="utf-8")
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("KROHN_HOME", str(root))
    monkeypatch.setenv("KROHN_MANAGED_DIR", "/etc/org-policy")
    monkeypatch.setenv("FOO_RESIDUE", "1")
    import krohn_constants
    monkeypatch.setattr(krohn_constants, "_default_krohn_root_memo", None)

    from krohn_cli.web_server_gateway import _profile_action_environment

    env = _profile_action_environment(["-p", "other", "gateway", "status"])
    assert env["KROHN_HOME"] == str(root / "profiles" / "other")
    assert env.get("KROHN_MANAGED_DIR") == "/etc/org-policy"
    assert "FOO_RESIDUE" not in env  # ordinary launch .env residue is still dropped
