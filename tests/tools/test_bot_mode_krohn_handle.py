"""@krohn is the default profile's handle only while no real profile is named 'krohn'.

A pre-reservation ``profiles/krohn`` keeps the handle: a local ``message_agent`` to @krohn
reaches it, and the roster shows exactly one @krohn (the default answers to @default).
"""

import json

import pytest

from tests.tools.test_bot_mode_dm import _canonical_target, _capture_spawn, _FakeAgent, _managed_home
from tools import bot_mode_dm, bot_mode_probe, bot_relay


@pytest.fixture(autouse=True)
def _fresh_probe_cache():
    bot_mode_probe._reset_cache_for_tests()
    yield
    bot_mode_probe._reset_cache_for_tests()


@pytest.mark.parametrize("real_krohn", [False, True])
def test_local_krohn_dm_lands_once_in_the_profile_that_owns_the_handle(tmp_path, monkeypatch, real_krohn):
    _capture_spawn(monkeypatch)
    monkeypatch.setattr(bot_relay, "_krohn_cli", lambda: "krohn")
    monkeypatch.setattr(bot_mode_dm, "_dm_dir", lambda: tmp_path)
    root = _managed_home(tmp_path, teammates=("researcher", "krohn") if real_krohn else ("researcher",))
    owner = root / "profiles" / "krohn" if real_krohn else root
    authority = _canonical_target(monkeypatch, root, root / "profiles" / "krohn")

    ack = json.loads(bot_mode_dm.message_agent_tool(
        target="@krohn", message="ping", agent=_FakeAgent(root / "profiles" / "researcher")))

    assert ack["status"] == "queued" and ack["to"] == "@krohn"
    assert [home for home, _params in authority.calls] == [owner.resolve()]


@pytest.mark.parametrize("real_krohn", [False, True])
def test_roster_shows_one_krohn_handle(tmp_path, real_krohn):
    root = _managed_home(tmp_path, teammates=("researcher", "krohn") if real_krohn else ("researcher",))

    teammates = bot_mode_probe.get_bot_mode_protocol_section(root / "profiles" / "researcher").split("Your teammates")[1]
    assert teammates.count("`@krohn`") == 1
    assert ("`@default`" in teammates) is real_krohn
    you = bot_mode_probe.get_bot_mode_protocol_section(root).split("Your teammates")[0]
    assert ("You are `@default`" if real_krohn else "You are `@krohn`") in you


def test_remote_default_is_never_offered_as_a_bare_form_a_local_profile_answers_to(tmp_path, monkeypatch):
    """A remote default beside a real remote 'krohn' profile is published as handle 'default'.
    Local resolution accepts the folder id 'default' (this install's own default), so the roster a
    named local bot sees must not offer bare @default for the remote row: the DM it invites was
    admitted locally instead of relayed. Collision forms come from the install root, not the
    sender's own profile home."""
    _capture_spawn(monkeypatch)
    monkeypatch.setattr(bot_relay, "_krohn_cli", lambda: "krohn")
    monkeypatch.setattr(bot_mode_dm, "_dm_dir", lambda: tmp_path)
    root = _managed_home(tmp_path, teammates=("researcher",))
    sender = root / "profiles" / "researcher"
    authority = _canonical_target(monkeypatch, root)
    bot_relay.write_remote_roster(sender, [
        {"profile": "default", "handle": "default", "title": "Remote Main", "connection_id": "box", "connection_label": "Box"},
        {"profile": "krohn", "handle": "krohn", "connection_id": "box", "connection_label": "Box"},
    ])

    remote = bot_mode_probe.get_bot_mode_protocol_section(sender).split("OTHER connected machines")[1]
    offered = next(line for line in remote.splitlines() if "Remote Main" in line).split("`")[1].removeprefix("@")
    ack = json.loads(bot_mode_dm.message_agent_tool(target=offered, message="ping", agent=_FakeAgent(sender)))

    assert offered != "default" and ack["status"] == "queued", (offered, ack)
    assert authority.calls == []
    assert [(e["target_connection"], e["target_profile"]) for e in bot_relay.claim_pending_envelopes(sender)] == [("box", "default")]
