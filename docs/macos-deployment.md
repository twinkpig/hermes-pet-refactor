# macOS Deployment Guide

## Status

macOS support is verified on real Mac hardware. The supported path is a Python
install from the GitHub repository plus the packaged Electron overlay and
managed Hermes plugin.

The expected runtime is:

```text
Hermes TUI -> Hermes plugin -> ws://127.0.0.1:17473 -> Hermes Pets endpoint -> Electron overlay
```

## Prerequisites

- macOS with Python 3.10+
- Node.js and npm available on `PATH`
- Hermes TUI installed in the same user session

## Checkout And Run

```bash
git clone git@github.com:twinkpig/hermes-pet-refactor.git
cd hermes-pet-refactor
export PYTHONPATH=src
```

Then run commands directly from the checkout:

```bash
python3 -m hermes_pet.cli doctor
python3 -m hermes_pet.cli launch --replace
```

If you want a shell alias, point `hermes-pet` at the checkout instead of
introducing a second install path.

```bash
alias hermes-pet='PYTHONPATH=/path/to/hermes-pet/src python3 -m hermes_pet.cli'
```

Do not set `HERMES_PET_FORCE_PACKAGED_OVERLAY` for this flow. The checkout is
the single source of truth, and the overlay should load from `./overlay`.

If Electron dependencies are missing, install them once in the overlay folder:

```bash
cd overlay
npm install --omit=dev
cd ..
```

## Hermes Plugin

`launch` installs or updates the managed plugin in the active Hermes home before
starting the overlay:

```bash
python3 -m hermes_pet.cli launch --replace
```

Default target:

```text
~/.hermes/plugins/hermes-pet
```

Restart Hermes TUI after `launch` reports that the plugin was installed or
updated.

For manual repair without starting the overlay, run:

```bash
python3 -m hermes_pet.cli hermes-plugin install --replace
```

If Hermes uses a custom home:

```bash
python3 -m hermes_pet.cli hermes-plugin install --home /path/to/hermes-home --replace
```

## Standalone Plugin Export

If the Hermes main repository wants to vendor the plugin code directly, export
the two-file standalone plugin folder:

```bash
python3 -m hermes_pet.cli hermes-plugin export --output ./dist/hermes-pet-plugin --replace
```

The exported folder contains:

```text
__init__.py
plugin.yaml
```

This folder can be copied into a Hermes plugin path or committed into a Hermes
repository integration branch.

## Verify Endpoint

```bash
python3 -m hermes_pet.cli doctor
python3 -m hermes_pet.cli overlay-status
```

Manual lifecycle smoke test:

```bash
python3 -m hermes_pet.cli semantic task_started --title "Mac smoke test" --summary "帮紧你, 帮紧你!!!"
sleep 2
python3 -m hermes_pet.cli semantic task_blocked --title "Mac smoke test" --blocker-type approval --blocker-detail "等你一句就继续"
sleep 2
python3 -m hermes_pet.cli semantic task_completed --title "Mac smoke test" --summary "今日先到呢度"
```

If this works, the pet endpoint is healthy.

## Verify Hermes TUI

Start a fresh Hermes TUI after plugin install. Trigger a task that uses tools
and asks for approval.

Expected state flow:

- thinking: Hermes is reasoning before tool execution
- running: Hermes is executing or actively working
- waiting/review: user input or approval is needed
- running: approval accepted and work resumes
- idle: final response completed

If manual smoke works but Hermes TUI does not, check:

- `python3 -m hermes_pet.cli hermes-plugin status`
- the Hermes home path used by the TUI
- whether Hermes loaded `~/.hermes/plugins/hermes-pet/plugin.yaml`
- `HERMES_PET_WS_URL`, `HERMES_PET_HOST`, and `HERMES_PET_PORT`

## Stop

```bash
python3 -m hermes_pet.cli close --bridge
```

Expected:

- Electron overlay exits
- local Python WebSocket endpoint exits

## Supported Behavior Checklist

The verified macOS path covers:

- overlay appears on the primary display
- non-sprite area is click-through
- left-drag does not force idle
- right-click panel opens and stays aligned
- `overlay-status` finds the Electron process
- `close --bridge` stops overlay and the local endpoint
- Hermes TUI emits lifecycle events without manual `semantic` fallback
