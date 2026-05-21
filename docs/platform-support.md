# Hermes Pets Platform Support Matrix

Platform support is based on verified release-readiness evidence, not assumed
portability. WSL/Windows is the supported platform for the full Hermes Pets
experience. macOS now has an experimental native overlay path that still needs
real-machine verification before it is promoted to full support. Native Linux
remains an investigation target until launch, overlay, and verification paths are
proven end to end.

## Support Levels

- Supported: documented install path, CLI behavior, overlay launch through the Electron built-in WebSocket server, packaged overlay assets, and smoke/live verification have passing evidence.
- Investigated: part of the stack is expected to run or has been inspected, but
  full overlay behavior is not proven.
- Unsupported: known launch requirements are missing or unimplemented.

## Current Matrix

| Platform | Runtime mode | CLI and state | Overlay WS Server | Overlay launch | Live verifier | Status |
| --- | --- | --- | --- | --- | --- | --- |
| WSL2 on Windows 10/11 with Windows interop | Git checkout run with `PYTHONPATH=src python -m hermes_pet.cli`; package overlay and managed Hermes plugin are the source of truth | Supported | Supported: Electron built-in WS Server at `0.0.0.0:17473`, TUI plugin connects to `ws://172.27.128.1:17473` | Supported through `powershell.exe` and `src/hermes_pet/overlay/scripts/launch-windows-overlay.ps1` | Supported with `scripts/verify-live-overlay.sh` when Windows interop is available | Full supported platform |
| Native Windows PowerShell or cmd.exe | Not the primary path | Investigated only | Investigated only | Unsupported by the Python launcher because the current flow expects the CLI to run from WSL and call Windows interop tools | Not covered | Unsupported for Phase 5 |
| Native Linux desktop | Local Python install is expected to cover CLI-only commands | Investigated only | Likely runnable for local CLI/bridge checks | Unsupported: no native Linux Electron launcher, process matching, or desktop verification contract is implemented | Skips outside WSL | CLI-only investigation target |
| macOS | Git checkout run with `PYTHONPATH=src python3 -m hermes_pet.cli`; package overlay and managed Hermes plugin are the source of truth | Experimental | Experimental: local Python bridge at `127.0.0.1:17473`, TUI plugin and Electron overlay connect to `ws://127.0.0.1:17473` | Experimental through native Electron `src/hermes_pet/overlay/src/main.js`; `overlay-status` and `close` use native process discovery | Manual smoke testing | Experimental overlay support |

## Behavior Boundaries

CLI-only commands include `status`, `hatch`, `prefs`, `jobs`, `brief`,
`custom-pet validate`, `custom-pet preview`, and local state export/cleanup.
These commands may work anywhere Python 3.10+ and the runtime dependencies are
available, but Phase 5 does not claim native Linux or macOS support for them
without dedicated checkout/runtime rehearsal evidence.

Full WSL/Windows overlay behavior means all of the following pass together:

- `hermes-pet launch` starts the Electron overlay (which includes a built-in WebSocket server; no Python bridge process is used).
- `hermes-pet launch` installs or updates `~/.hermes/plugins/hermes-pet`.
- The Windows Electron overlay opens from WSL through PowerShell.
- Hermes TUI events reach the overlay through the managed `hermes-pet` plugin.
- `hermes-pet overlay-status`, `hermes-pet close`, and `hermes-pet close --bridge`
  can find and control the overlay process.
- Renderer events, custom-pet fallback, reconnect, and attention/tray state are
  verified by `scripts/verify-live-overlay.sh`.

Experimental macOS overlay behavior means all of the following must pass on a
real Mac before promotion:

- `hermes-pet launch --replace` starts the local bridge and Electron overlay.
- `hermes-pet launch --replace` installs or updates `~/.hermes/plugins/hermes-pet`.
- The companion is visible on the primary display.
- `hermes-pet semantic task_started`, `task_blocked`, and `task_completed`
  drive visible state.
- Hermes TUI lifecycle events drive the same state transitions without manual
  emit fallback.
- Click-through, drag, right-click panel, `overlay-status`, and `close --bridge`
  behave as documented by the current smoke scripts.

## Known Platform Blockers

- Native Linux needs an Electron launcher, process discovery/close behavior, and
  a live overlay verifier that proves visible desktop behavior.
- macOS still needs real-machine verification of Electron window behavior,
  click-through, drag, panel alignment, and Hermes TUI lifecycle events.
- Native Windows needs a first-class Python execution path outside WSL before it
  can share the supported install story.
- PyPI, pipx, and desktop installers are not part of the current supported
  deployment path. The maintained operator path is a git checkout plus direct
  module execution.
