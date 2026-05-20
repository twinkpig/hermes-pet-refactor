# Hermes Pets Current State

Snapshot date: 2026-05-20

## Version Markers

- Python package version: `1.0.0` in `pyproject.toml`.
- Current milestone: `1.0.0` formal release line.
- The old `bridge` name still appears in Python modules, CLI flags, dashboard
  labels, and diagnostics. In the current WSL/Windows path, the Electron overlay
  owns the WebSocket server and the CLI/TUI send events to that endpoint.

## What Works

- Python CLI is installable as `hermes-pet`; `hermes-pet-bridge` remains as a
  compatibility entry point.
- Pet state persists under `~/.hermes_pet` by default.
- `hermes-pet launch` starts the Windows Electron overlay through PowerShell.
- The Windows overlay exposes the live WebSocket endpoint on port `17473`; TUI
  and CLI events send directly to that endpoint.
- `hermes-pet launch --replace` stops existing Windows overlay process trees
  before starting a fresh overlay.
- Overlay movement, saved position, visible sprite bounds, non-sprite
  click-through, reconnect behavior, and panel anchoring are in place.
- Hermes lifecycle events can drive `running`, `thinking`, `waiting`, `review`,
  and `idle` visual states.
- Running bubbles are persistent enough for long work and use dedicated
  work-state copy instead of tool payloads.
- Thinking, waiting, review, and blocked states keep persistent bubbles so the
  operator can tell whether Hermes is still thinking or needs action.
- `session_thread` memory groups fragmented Hermes events into one user-facing
  session thread.
- Panel `Now`, `Need`, `Timeline`, `Today`, and collapsed `Details` prefer the
  session thread over raw event fragments.
- Routine progress churn is suppressed; key boundaries such as start, blocked,
  resumed, completed, and failed remain visible.
- Diagnostic/test phrases and JSON/tool payloads are filtered from bubbles,
  session memory, and narrative copy.
- Ambient events can be emitted with `hermes-pet emit`.
- Local commands can be wrapped with `wrap` or `run`.
- Wrapped-job history records success/failure, duration, exit code, redacted
  command, and short summaries.
- `hermes-pet retry` reruns the latest safe failed wrapped command.
- `hermes-pet message` emits external message notifications with source,
  sender, urgency, and optional open-command metadata.
- Quiet, silent, mute, active, profile, and companion preference controls exist.
- Named notification profiles exist for normal, focus, pairing, demo, and silent
  workflows.
- `hermes-pet dashboard` serves a localhost-only, token-protected dashboard on
  port `17474` by default.
- Dashboard APIs expose state snapshots, notification prefs, custom pet
  management, voice preview controls, achievements, and a test overlay event.
- Voice preview is opt-in only, off by default, adapter-command based, and
  bounded by an event allowlist.
- Foundational achievements persist in `achievements.json` and unlock
  idempotently for custom pets, jobs, retryable failures, and level milestones.
- `hermes-pet brief` summarizes recent jobs and events.
- `hermes-pet state export` produces compact redacted diagnostics, and
  `hermes-pet state cleanup` supports bounded local maintenance.
- Renderer smoke coverage checks startup, reconnect, event reactions, custom pet
  loading, and fallback behavior without launching Electron.
- Live overlay verification is documented separately because renderer/package
  smokes do not prove WSL-to-Windows launch, visible animation, panel behavior,
  attention-state behavior, or real endpoint reachability in Electron.
- Animated custom pets can be validated, imported into
  `~/.hermes_pet/custom-pets`, selected, listed, and removed with
  `hermes-pet custom-pet ...`.
- The selected custom pet payload is sent to the overlay, and the renderer can
  load custom package frames from the local custom pet path.
- `hermes-pet doctor` checks CLI, transport reachability, overlay files, Windows
  overlay status, state, prefs, and job history.
- `hermes-pet doctor --strict` returns non-zero when any doctor check warns.
- Bash helpers and smoke scripts are available for daily operation.
- WSL2/Windows with Windows interop is the supported full-overlay platform;
  native Linux, macOS, and native Windows remain investigation targets.

## Key Commands

```bash
pip install -e .
uv tool install --editable /home/tony/projects/hermes-pet
hermes-pet
hermes-pet status
hermes-pet custom-pet list
hermes-pet custom-pet validate <path>
hermes-pet custom-pet import <path> --name <name>
hermes-pet custom-pet use <name>
hermes-pet custom-pet current
hermes-pet launch
hermes-pet launch --replace
hermes-pet overlay-status
hermes-pet emit bubble "Starting work"
hermes-pet semantic task_started --title "Refactor companion runtime" --task-id demo
hermes-pet semantic task_blocked --title "Refactor companion runtime" --needs-user --next-action "Approve shell command" --task-id demo
hermes-pet semantic task_resumed --title "Refactor companion runtime" --task-id demo
hermes-pet semantic task_completed --title "Refactor companion runtime" --summary "Runtime updated" --task-id demo
hermes-pet wrap --name "API tests" -- pytest
hermes-pet run -- npm test
hermes-pet jobs
hermes-pet jobs --failed --last
hermes-pet retry
hermes-pet message --source telegram --sender "Ada" "Can you review this?"
hermes-pet quiet
hermes-pet quiet --silent
hermes-pet quiet --off
hermes-pet mute 30m
hermes-pet profile focus
hermes-pet prefs
hermes-pet dashboard --no-open
hermes-pet voice status
hermes-pet voice test "Hermes Pets voice preview test."
hermes-pet state export --since 24h
hermes-pet state cleanup --dry-run
hermes-pet brief --since 24h
hermes-pet brief --emit
hermes-pet doctor
hermes-pet doctor --strict
node scripts/smoke-renderer.js
scripts/smoke-hermes-pet.sh --temp-state
scripts/smoke-github-install.sh
```

Optional shell helpers:

```bash
source /home/tony/projects/hermes-pet/shell-helpers/hermes-pet.bash
hp
hpl
hps
hpjobs
hpfail
hpwrap "Job name" -- command arg...
hpbrief
```

## Important Files

- `README.md`: full daily-use and recovery documentation.
- `OPERATOR_GUIDE.md`: short operator guide.
- `pyproject.toml`: Python package metadata and CLI entry points.
- `src/hermes_pet/cli.py`: CLI commands, launch, doctor, jobs, retry, prefs,
  semantic events, and companion event sending.
- `src/hermes_pet/bridge.py`: compatibility transport helper and legacy
  WebSocket bridge server.
- `src/hermes_pet/memory.py`: companion memory, narrative derivation, and
  `session_thread` logic.
- `src/hermes_pet/event_log.py`: local event history and safe event payloads.
- `src/hermes_pet/dashboard.py`: localhost dashboard server and API handlers.
- `src/hermes_pet/dashboard/`: packaged static dashboard UI.
- `src/hermes_pet/voice.py`: opt-in voice preview preferences and adapter
  execution.
- `src/hermes_pet/achievements.py`: foundational achievement definitions and
  state.
- `src/hermes_pet/custom_pets.py`: custom pet validation, import, selection, and
  overlay payload helpers.
- `src/hermes_pet/events.py`: normalized local event schema.
- `src/hermes_pet/jobs.py`: job history, redaction, retry safety.
- `src/hermes_pet/prefs.py`: quiet/mute preference storage.
- `src/hermes_pet/overlay/src/main.windows.js`: Windows overlay entry point and direct WS
  server.
- `src/hermes_pet/overlay/src/renderer.js`: sprite rendering, panel rendering, event reactions,
  and bubble policy.
- `src/hermes_pet/overlay/src/companion-narrative.js`: runtime narrative derivation.
- `src/hermes_pet/overlay/src/companion-lines.js`: companion line selection and filtering.
- `src/hermes_pet/overlay/src/companion-rules.js`: route and speech policy runtime.
- `src/hermes_pet/overlay/src/companion-packs.js`: companion profile-pack runtime.
- `src/hermes_pet/overlay/src/preload.js`: safe renderer API exposure.
- `src/hermes_pet/overlay/scripts/launch-windows-overlay.ps1`: Windows single-instance launcher.

## Known Limitations

- The full overlay path is supported on WSL2/Windows with Windows interop.
- Native Linux, macOS, and native Windows are not supported full-overlay
  platforms yet.
- Overlay resources live in `src/hermes_pet/overlay/`.
- Some CLI/dashboard labels still say `bridge` even when they are checking the
  Electron overlay WebSocket endpoint.
- Custom pet startup can still be confused by persisted built-in species during
  overlay bootstrap; selected custom pet state must win over the default species
  in a follow-up fix.
- Custom pet `idle` is required; missing optional states rely on renderer
  fallback behavior.
- Custom pet selection is local state only and does not add the pet to built-in
  gacha species metadata.
- Backups must copy `${HERMES_PET_HOME:-~/.hermes_pet}` directly; state export
  is redacted diagnostics and is not restorable backup data.
- `doctor` returns success even with warnings by default, so read the warning
  lines for daily use; use `doctor --strict` for CI-style failure on warnings.
- `retry` only targets the latest failed job and refuses redacted sensitive
  commands.
- The smoke script intentionally creates one successful job and one expected
  failed job in the active state directory; use `--temp-state` to isolate that
  history.
- `emit`, `message`, and `brief --emit` require the overlay endpoint to be
  reachable.
- The dashboard is localhost-only and token-protected. It is not a hosted or
  remote UI.
- Voice mode is preview plumbing only; no provider selection or always-on
  personality mode is included.
- Achievements are a compact state foundation only; no rich celebration system
  is included.

## Next Recommended Improvements

- Fix custom-pet startup precedence so selected visual packages do not boot as
  `cat`.
- Rename user-facing `bridge` diagnostics to `overlay endpoint` where doing so
  does not break compatibility.
- Add external pack manifests and cleaner runtime configuration.
- Add deeper live overlay checks for drag ergonomics, always-on-top behavior,
  multi-monitor/DPI setups, and custom-pet startup.
- Add richer custom pet preview controls such as playback speed and side-by-side
  state comparison.
- Add an automated backup helper around `${HERMES_PET_HOME:-~/.hermes_pet}` once
  the manual copy/restore workflow has enough field use.
