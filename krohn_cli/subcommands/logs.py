"""``krohn logs`` subcommand parser."""

from __future__ import annotations

import argparse
from typing import Callable


def build_logs_parser(subparsers, *, cmd_logs: Callable) -> None:
    """Attach the ``logs`` subcommand to ``subparsers``."""
    logs_parser = subparsers.add_parser(
        "logs",
        help="View and filter KROHN log files",
        description="View, tail, and filter agent.log / errors.log / gateway.log / gui.log / desktop.log / update.log / desktop-update-handoff.log",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""\
Examples:
    krohn logs                    Show last 50 lines of agent.log
    krohn logs -f                 Follow agent.log in real time
    krohn logs errors             Show last 50 lines of errors.log
    krohn logs gateway -n 100     Show last 100 lines of gateway.log
    krohn logs gui -f             Follow gui.log in real time
    krohn logs desktop -f         Follow desktop.log (Electron app boot/backend)
    krohn logs update             Show last 50 lines of update.log (krohn update mirror)
    krohn logs handoff            Show last 50 lines of desktop-update-handoff.log
    krohn logs --level WARNING    Only show WARNING and above
    krohn logs --session abc123   Filter by session ID
    krohn logs --component tools  Only show tool-related lines
    krohn logs --since 1h         Lines from the last hour
    krohn logs --since 30m -f     Follow, starting from 30 min ago
    krohn logs list               List available log files with sizes
""")
    logs_parser.add_argument(
        "log_name",
        nargs="?",
        default="agent",
        help="Log to view: agent (default), errors, gateway, gui, desktop, update, handoff, or 'list' to show available files",
    )
    logs_parser.add_argument(
        "-n", "--lines", type=int, default=50, help="Number of lines to show (default: 50)")
    logs_parser.add_argument(
        "-f", "--follow", action="store_true", help="Follow the log in real time (like tail -f)")
    logs_parser.add_argument(
        "--level", metavar="LEVEL", help="Minimum log level to show (DEBUG, INFO, WARNING, ERROR)")
    logs_parser.add_argument(
        "--session", metavar="ID", help="Filter lines containing this session ID substring")
    logs_parser.add_argument(
        "--since", metavar="TIME", help="Show lines since TIME ago (e.g. 1h, 30m, 2d)")
    logs_parser.add_argument(
        "--component", metavar="NAME",
        help="Filter by component: gateway, agent, tools, cli, cron, gui")
    logs_parser.set_defaults(func=cmd_logs)
