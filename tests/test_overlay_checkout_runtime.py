import json
import re
from pathlib import Path


def test_checkout_runtime_windows_overlay_runs_a_direct_ws_server() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    overlay_dir = repo_root / "src/hermes_pet/overlay"
    main = (overlay_dir / "src/main.windows.js").read_text(encoding="utf-8")
    launcher = (overlay_dir / "scripts/launch-windows-overlay.ps1").read_text(
        encoding="utf-8"
    )
    renderer_html = (overlay_dir / "src/renderer.html").read_text(encoding="utf-8")
    renderer_css = (overlay_dir / "src/renderer.css").read_text(encoding="utf-8")
    narrative = (overlay_dir / "src/companion-narrative.js").read_text(
        encoding="utf-8"
    )
    renderer = (overlay_dir / "src/renderer.js").read_text(encoding="utf-8")
    companion_lines = (overlay_dir / "src/companion-lines.js").read_text(
        encoding="utf-8"
    )

    assert narrative
    assert '<script src="./companion-narrative.js"></script>' in renderer_html
    assert "companion-panel-section companion-panel-now" in renderer
    assert 'data-action="details-toggle"' in renderer
    assert "companion-panel-details' + (panel.details_open ? '' : ' hidden')" in renderer
    assert "panel-details-toggle" in renderer
    assert "'Task: ' + semanticFocus" not in renderer
    assert "totalRecent + ' recent'" in renderer
    assert "eventSummaryEl.classList.toggle('hidden', totalRecent <= 0)" in renderer
    assert "Hermes Pets · ' + compactStatus" in renderer
    assert '<div id="current-status" class="current-status hidden">Idle</div>' in renderer_html
    assert "summary.workflow + ' flow'" not in renderer
    assert '<div id="event-summary" class="event-summary hidden"></div>' in renderer_html
    assert "Profile</span>" not in renderer
    assert "Pack</span>" not in renderer
    assert "Details: " in companion_lines
    assert "new WebSocket.Server({" in main
    assert "process.env.HERMES_PET_BIND_HOST || '0.0.0.0'" in main
    assert "const serverPort = Number(process.env.HERMES_PET_PORT || 17473);" in main
    assert "tuiClient = ws;" in main
    assert "win.webContents.send('pet-event', msg);" in main
    assert "wsClient = new WebSocket(url);" not in main
    assert '$env:HERMES_PET_BIND_HOST = $BridgeHost' in launcher
    assert '$env:HERMES_PET_WS_URL = "ws://${BridgeHost}:${Port}"' not in launcher
    assert 'Overlay WS endpoint: ws://$($env:HERMES_PET_BIND_HOST):$Port' in launcher
    assert "-WindowStyle Hidden" in launcher


def test_windows_overlay_periodically_reasserts_topmost_level() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    main = (repo_root / "src/hermes_pet/overlay/src/main.windows.js").read_text(encoding="utf-8")

    assert "const TOPMOST_REASSERT_INTERVAL_MS = 10000;" in main
    assert "let topmostReassertTimer = null;" in main
    assert "function startTopmostReassertLoop()" in main
    assert "setInterval(() => reassertOverlayOnTop('topmost-watchdog', { quiet: true })" in main
    assert "startTopmostReassertLoop();" in main
    assert "if (topmostReassertTimer) clearInterval(topmostReassertTimer);" in main


def test_checkout_runtime_bundles_celestia_sprite_frames() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    overlay_dir = repo_root / "src/hermes_pet/overlay"
    manifest = json.loads((overlay_dir / "assets/manifest.json").read_text(encoding="utf-8"))
    states = manifest["species"]["celestia"]["states"]

    assert states["idle"]["frames"] == [f"idle_{index:02d}.png" for index in range(7)]
    assert states["running"]["frames"] == [f"running_{index:02d}.png" for index in range(7)]
    assert "idle_00.svg" not in states["idle"]["frames"]

    for state_name, state in states.items():
        asset_dir = state.get("assetDir", state_name)
        for frame in state["frames"]:
            assert (overlay_dir / "assets/sprites/celestia" / asset_dir / frame).is_file()


def test_macos_overlay_defaults_to_transparent_window() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    main = (repo_root / "src/hermes_pet/overlay/src/main.js").read_text(encoding="utf-8")
    renderer_css = (repo_root / "src/hermes_pet/overlay/src/renderer.css").read_text(encoding="utf-8")
    renderer = (repo_root / "src/hermes_pet/overlay/src/renderer.js").read_text(encoding="utf-8")

    assert "const MAC_WINDOW_SIZE = { width: 280, height: 1020 };" in main
    assert "...(IS_MAC ? MAC_WINDOW_SIZE : WINDOW_SIZE)" in main
    assert "if (IS_MAC) classes.push('mac-overlay');" in main
    assert "sanitizeSpriteRect(rect, bounds.width, bounds.height)" in main
    assert "process.env.HERMES_PET_MAC_STANDARD_WINDOW === '1'" in main
    assert "process.env.HERMES_PET_MAC_TRANSPARENT" not in main
    assert "transparent: !standardWindow" in main
    assert "frame: standardWindow" in main
    assert "backgroundColor: standardWindow ? '#111827' : '#00000000'" in main
    assert "body.mac-overlay #pet-sprite" in renderer_css
    assert "width: 130px;" in renderer_css
    assert "height: 130px;" in renderer_css
    assert "body.overlay-mode #pet-sprite.sprite-asset-loaded" in renderer_css
    assert "spriteEl.classList.add('sprite-asset-loaded')" in renderer


def test_macos_overlay_periodically_reasserts_topmost_level() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    main = (repo_root / "src/hermes_pet/overlay/src/main.js").read_text(encoding="utf-8")

    assert "const DEFAULT_ALWAYS_ON_TOP_LEVEL = 'screen-saver';" in main
    assert "const TOPMOST_REASSERT_INTERVAL_MS = 10000;" in main
    assert "let topmostReassertTimer = null;" in main
    assert "function startTopmostReassertLoop()" in main
    assert "setInterval(() => reassertOverlayOnTop('topmost-watchdog', { quiet: true })" in main
    assert "startTopmostReassertLoop();" in main
    assert "if (topmostReassertTimer) clearInterval(topmostReassertTimer);" in main


def test_overlay_entrypoints_share_renderer_ipc_contract() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    overlay_dir = repo_root / "src/hermes_pet/overlay/src"
    preload = (overlay_dir / "preload.js").read_text(encoding="utf-8")
    mac_main = (overlay_dir / "main.js").read_text(encoding="utf-8")
    windows_main = (overlay_dir / "main.windows.js").read_text(encoding="utf-8")

    channels = sorted(set(re.findall(r"ipcRenderer\.(?:send|sendSync|invoke)\('([^']+)'", preload)))
    assert channels
    for channel in channels:
        handler = f"ipcMain.on('{channel}'"
        invoke_handler = f"ipcMain.handle('{channel}'"
        assert handler in mac_main or invoke_handler in mac_main, f"mac main missing {channel}"
        assert handler in windows_main or invoke_handler in windows_main, f"windows main missing {channel}"


def test_macos_overlay_uses_sprite_scoped_mouse_passthrough() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    main = (repo_root / "src/hermes_pet/overlay/src/main.js").read_text(encoding="utf-8")

    assert "let mousePassthrough = null;" in main
    assert "let mousePassthroughTimer = null;" in main
    assert "let trayVisible = false;" in main
    assert "function cursorHitsSprite()" in main
    assert "function startMousePassthroughLoop()" in main
    assert "win.setIgnoreMouseEvents(ignore, ignore ? { forward: true } : undefined)" in main
    assert "startMousePassthroughLoop();" in main
    assert "if (mousePassthroughTimer) clearInterval(mousePassthroughTimer);" in main
    assert "ipcMain.on('event-tray-visibility', (_, visible) => {" in main
