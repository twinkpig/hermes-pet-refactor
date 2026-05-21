# Hermes Pet Embed Contract

## Purpose

Hermes should embed Hermes Pets by sending lifecycle events to one local
WebSocket endpoint. Hermes should not need to know how the overlay window is
launched on Windows, WSL, or macOS.

## Install Plugin

```bash
PYTHONPATH=src python3 -m hermes_pet.cli launch --replace
```

`launch` installs or updates the managed plugin before starting the overlay. The
installed plugin lives under:

```text
~/.hermes/plugins/hermes-pet
```

For manual repair without starting the overlay:

```bash
PYTHONPATH=src python3 -m hermes_pet.cli hermes-plugin install --replace
```

## Export Standalone Plugin

For a Hermes repository patch or a manual plugin handoff, export the plugin files
without installing them into the current user profile:

```bash
PYTHONPATH=src python3 -m hermes_pet.cli hermes-plugin export --output ./dist/hermes-pet-plugin --replace
```

The exported folder is self-contained:

```text
__init__.py
plugin.yaml
```

This is the preferred handoff format when Hermes wants to vendor the integration
directly. The managed install command and export command use the same
repo-bundled plugin template, so they stay in sync.

## Endpoint Resolution

The plugin resolves the endpoint in this order:

1. `HERMES_PET_WS_URL`
2. `HERMES_PET_BRIDGE_URL`
3. `HERMES_PET_HOST` + `HERMES_PET_PORT`
4. platform default

Platform defaults:

| Runtime | Default |
| --- | --- |
| macOS native | `ws://127.0.0.1:17473` |
| Linux native | `ws://127.0.0.1:17473` |
| WSL driving Windows overlay | `ws://172.27.128.1:17473` |

## Minimal Hermes-Side Logic

Hermes only needs to emit existing event types:

| Hermes moment | Pet event |
| --- | --- |
| model starts working | `task_started` or `task_progress` |
| model is thinking | `task_thinking` |
| tool call starts | `task_started` or `task_progress` |
| user approval needed | `task_blocked` with `blocker_type=approval` |
| user input needed | `task_blocked` with `blocker_type=input` |
| approval accepted | `task_resumed` |
| final answer complete | `task_completed` |
| task fails | `task_failed` |

## Manual Endpoint Test

Start the overlay:

```bash
PYTHONPATH=src python3 -m hermes_pet.cli launch --replace
```

Send lifecycle smoke events:

```bash
PYTHONPATH=src python3 -m hermes_pet.cli semantic task_started --title "Smoke test" --summary "帮紧你, 帮紧你!!!"
PYTHONPATH=src python3 -m hermes_pet.cli semantic task_blocked --title "Smoke test" --blocker-type approval --blocker-detail "等你一句就继续"
PYTHONPATH=src python3 -m hermes_pet.cli semantic task_blocked --title "Smoke test" --blocker-type review --blocker-detail "要你睇一眼"
PYTHONPATH=src python3 -m hermes_pet.cli semantic task_completed --title "Smoke test" --summary "今日先到呢度"
```

If manual emit works but Hermes TUI does not, the overlay endpoint is healthy
and the issue is in Hermes lifecycle event emission or plugin loading.

## macOS Notes

On macOS, `PYTHONPATH=src python3 -m hermes_pet.cli launch --replace` starts a
local Python WebSocket endpoint and launches the Electron overlay with:

```text
HERMES_PET_WS_URL=ws://127.0.0.1:17473
```

If Hermes runs in the same macOS user session, no extra host setting should be
needed.

## WSL/Windows Notes

On WSL driving the Windows overlay, the Windows Electron process listens on the
Windows host side. The Hermes plugin defaults to:

```text
ws://172.27.128.1:17473
```

Override with `HERMES_PET_WS_URL` if the WSL host address changes.
