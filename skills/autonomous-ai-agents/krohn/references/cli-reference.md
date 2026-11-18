# KROHN CLI Reference

Live sources when anything looks stale: `krohn --help`, `krohn <command> --help`,
https://hermes-agent.nousresearch.com/docs/reference/cli-commands

### Global Flags

```
krohn [flags] [command]        (no subcommand = interactive chat)

  --version, -V             Show version
  -z, --oneshot PROMPT      One-shot: print ONLY the final response (for scripts/pipes)
  -m MODEL  --provider P    Model/provider override for this invocation
  -t, --toolsets LIST       Comma-separated toolsets for this invocation
  --resume, -r SESSION      Resume session by ID or title
  --continue, -c [NAME]     Resume by name, or most recent session
  --worktree, -w            Isolated git worktree mode (parallel agents)
  --skills, -s SKILL        Preload skills (comma-separate or repeat)
  --profile, -p NAME        Use a named profile
  --yolo                    Skip dangerous command approval
  --tui / --cli             Force the Ink TUI / classic REPL
  --ignore-rules            Skip AGENTS.md/SOUL.md/memory/skill injection
  --safe-mode               Disable ALL customizations (troubleshooting)
  --pass-session-id         Include session ID in system prompt
```

### Chat

```
krohn chat [flags]
  -q, --query TEXT          Single query, non-interactive
  --image PATH              Attach a local image to a single query
  -Q, --quiet               Suppress banner, spinner, tool previews
  --checkpoints             Enable filesystem checkpoints (/rollback)
  --max-turns N             Cap tool-calling iterations
  --source TAG              Session source tag (default: cli)
```
(plus the global flags above)

### Configuration

```
krohn setup [section]      Wizard (model|tts|terminal|gateway|tools|agent)
krohn model                Interactive model/provider picker
krohn fallback [add|remove|list]  Fallback provider chain
krohn config [show|edit|get|set|unset|path|env-path|check|migrate]
krohn login / logout       OAuth sign-in / clear stored auth
krohn doctor [--fix]       Check dependencies and config
krohn status [--full]      Component summary (--full: every section)
```

### Tools & Skills

```
krohn tools [list|enable NAME|disable NAME]   Per-platform toolsets (curses UI with no args)

krohn skills list|browse|search QUERY|inspect ID
krohn skills install ID    Hub identifier OR a direct https://…/SKILL.md URL
krohn skills config        Enable/disable skills per platform
krohn skills check|update|uninstall|publish PATH
krohn skills tap add REPO  Add a GitHub repo as a skill source
krohn bundles              Skill bundles (one /<name> alias loads several skills)
```

### MCP Servers

```
krohn mcp add NAME (--url or --command) | remove | list | test NAME
krohn mcp catalog | install NAME     Curated catalog install
krohn mcp configure NAME             Toggle tool selection
krohn mcp-serve                      Run KROHN as an MCP server (mcp-serve plugin)
```
Details (transport, tool discovery, catalog): `references/native-mcp.md`.

### Gateway (Messaging Platforms)

```
krohn gateway run|install|start|stop|restart|status|setup
```

20+ platforms: Telegram, Discord, Slack, WhatsApp (Baileys + Business Cloud API), iMessage (Photon — `krohn photon setup`), Signal, Email, SMS, Matrix, Mattermost, Teams, LINE, SimpleX, ntfy, Google Chat, Home Assistant, DingTalk, Feishu, WeCom, Weixin, API Server, Webhooks. Open WebUI connects via the API Server adapter. Most adapters ship under `plugins/platforms/`.
Docs: https://hermes-agent.nousresearch.com/docs/user-guide/messaging/

### Sessions

```
krohn sessions list|browse|rename ID TITLE|delete ID|export OUT|prune|stats
```

### Cron / Webhooks

```
krohn cron list|create SCHED|edit ID|pause|resume|run ID|remove|status
    Schedules: '30m', 'every 2h', '0 9 * * *', ISO timestamp
krohn webhook subscribe NAME|list|remove NAME|test NAME
```
Webhook payloads/routes: `references/webhooks.md`.

### Profiles

```
krohn profile list|create NAME (--clone|--clone-all|--clone-from)|use|show|delete
krohn profile rename A B | alias NAME | export NAME | import FILE
krohn profile migrate-identity A B   Retry a completed rename's session/routing identity migration
```

### Credentials & Pools

```
krohn auth                 Interactive credential manager
krohn auth add [PROVIDER]  Add OAuth or API-key credential (nous, openai-codex, qwen-oauth, …)
krohn auth list|remove P IDX|reset PROVIDER|status
```
Multiple credentials per provider form a pool that rotates automatically and skips exhausted keys.

### Other

```
krohn desktop / gui        Native desktop app
krohn dashboard            Web admin panel + embedded chat (--stop / --status)
krohn proxy                OpenAI-compatible local proxy backed by an OAuth provider
krohn portal               Quick setup / sign in via Nous Portal
krohn kanban <verb>        Multi-agent work-queue board
krohn project              Named multi-folder workspaces (see references/projects-and-folders.md)
krohn skin list|use|set    Switch/tweak skins (see references/themes.md)
krohn pets <verb>          Pet mascots (see references/petdex.md)
krohn memory setup|status|off|reset   Memory provider
krohn secrets bitwarden|onepassword   External secret stores
krohn moa                  Mixture-of-Agents slots
krohn hooks / security / backup / import / checkpoints / console
krohn logs [-f] [errors]   View agent/error logs
krohn send                 One-off message through a gateway platform
krohn pairing / plugins / insights / journey / computer-use
krohn acp                  ACP server (IDE integration)
krohn completion bash|zsh|fish
krohn update / uninstall
```

Plugin- and provider-supplied subcommands (e.g. `krohn photon setup`) only appear once their plugin is installed/active. Importing from OpenClaw, Claude Code, Codex CLI or Cursor (`krohn import-agent <agent>`, plus the older `krohn claw migrate|cleanup`) comes from the `agent-importers` plugin; a fresh `krohn setup` that finds one of those agents offers to install it.

### Where to Find Things

| Looking for... | Location |
|---|---|
| Config options | `krohn config edit` · [Configuration docs](https://hermes-agent.nousresearch.com/docs/user-guide/configuration) |
| Tools / toolsets | `krohn tools list` · [Tools reference](https://hermes-agent.nousresearch.com/docs/reference/tools-reference) |
| Skills catalog | `krohn skills browse` · [Skills catalog](https://hermes-agent.nousresearch.com/docs/reference/skills-catalog) |
| Provider setup | `krohn model` · [Providers guide](https://hermes-agent.nousresearch.com/docs/integrations/providers) |
| Env variables | `krohn config env-path` · [Env vars reference](https://hermes-agent.nousresearch.com/docs/reference/environment-variables) |
| Gateway logs | `~/.krohn/logs/gateway.log` (or `krohn logs`) |
| Sessions | `krohn sessions browse` (reads state.db) |
