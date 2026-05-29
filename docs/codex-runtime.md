# Codex CLI / SDK runtime integration

This platform supports four Codex dispatch modes:

| Mode | Behavior |
|---|---|
| `mock` | Writes a handoff Markdown file and records Trace/events. Safe default. |
| `http` | Sends the Codex task to a configured HTTP endpoint. |
| `cli` | Runs local `codex exec` in the configured workspace. Disabled by default. |
| `sdk` | Uses the optional Python Codex SDK (`codex_app_server`) to start a local Codex thread. Disabled by default. |

## Recommended default
Keep `DAP_CODEX_MODE=mock` until the engineering environment has approval, sandboxing, logging, and credential handling configured.

## CLI mode
Example configuration:

```bash
DAP_CODEX_MODE=cli
DAP_CODEX_CLI_ENABLED=true
DAP_CODEX_CLI_COMMAND=codex
DAP_CODEX_CLI_SANDBOX=workspace-write
DAP_CODEX_CLI_APPROVAL_POLICY=never
DAP_CODEX_WORKSPACE_ROOT=/path/to/data-agent-platform
```

The platform executes a non-interactive CLI command using the generated task handoff file. The command is intentionally gated by platform approval.

## SDK mode
Example configuration:

```bash
DAP_CODEX_MODE=sdk
DAP_CODEX_SDK_ENABLED=true
DAP_CODEX_SDK_MODEL=gpt-5.4
DAP_CODEX_SDK_PYTHON_MODULE=codex_app_server
```

The Python SDK is optional and must be installed separately from the open-source Codex repository. If the SDK module is absent, the platform falls back to a safe handoff response.

## Diagnostics
Use:

```text
GET /api/codex/diagnostics
```

The UI page **Codex 运行台** surfaces CLI path/version, SDK module presence, handoff directory, default mode, and HTTP endpoint state.
