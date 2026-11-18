"""The MCP handshake names krohn and its release, not the SDK default ("mcp"/"0.1.0")."""

import pytest


def test_session_kwargs_carry_krohn_client_identity():
    from tools.mcp_tool import MCPServerTask, _ensure_mcp_sdk
    if not _ensure_mcp_sdk():
        pytest.skip("mcp SDK not installed")
    from krohn_cli.version_info import get_version_info

    kwargs = MCPServerTask("identity_test")._session_kwargs()
    assert kwargs["client_info"].name == "krohn"
    assert kwargs["client_info"].version == get_version_info().base_version
