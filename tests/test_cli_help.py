import argparse
import subprocess

from hermes_pet import cli
from hermes_pet.custom_pets import import_package, set_current_custom_pet, current_custom_pet
from hermes_pet.engine import Pet, save_pet
from hermes_pet.prefs import save_prefs


def test_top_level_help_groups_current_advanced_and_legacy_commands() -> None:
    help_text = cli._build_parser().format_help()

    assert "Command groups:" in help_text
    assert "Primary: launch status doctor close run jobs retry brief custom-pet" in help_text
    assert "Advanced: semantic emit message voice wrap" in help_text
    assert "Legacy:  hatch rename feed pet play species delete custom profile" in help_text
    assert "Start the Electron overlay and overlay WS endpoint." in help_text
    assert "semantic" in help_text
    assert "[advanced] Emit a semantic task event to the live" in help_text
    assert "[legacy] Gacha a new built-in pet (re-roll)." in help_text
    assert "animated custom-pet packages" in help_text


def test_overlay_status_uses_configured_overlay_endpoint_label(monkeypatch, capsys) -> None:
    calls = {}

    class BridgeModule:
        PET_BRIDGE_DEFAULT_PORT = 17473

        @staticmethod
        def is_bridge_available(*, port, host):
            calls["port"] = port
            calls["host"] = host
            return True

    monkeypatch.setenv("HERMES_PET_HOST", "172.27.128.1")
    monkeypatch.setattr(cli.importlib, "import_module", lambda name: BridgeModule)
    monkeypatch.setattr(
        cli,
        "_run_overlay_launcher",
        lambda *, port, mode: subprocess.CompletedProcess(
            args=["overlay-status"],
            returncode=0,
            stdout="Overlay processes: none\n",
            stderr="",
        ),
    )

    assert cli._cmd_overlay_status(object()) == 0

    output = capsys.readouterr().out
    assert calls == {"port": 17473, "host": "172.27.128.1"}
    assert "Overlay WS endpoint: available at ws://172.27.128.1:17473" in output
    assert "Overlay processes: none" in output


def test_overlay_launcher_uses_powershell_file_invocation(monkeypatch, tmp_path) -> None:
    script = tmp_path / "overlay" / "scripts" / "launch-windows-overlay.ps1"
    script.parent.mkdir(parents=True)
    script.write_text("param()\n", encoding="utf-8")
    calls = []

    def fake_run(cmd, **kwargs):
        calls.append((cmd, kwargs))
        return subprocess.CompletedProcess(args=cmd, returncode=0, stdout="", stderr="")

    monkeypatch.setattr(cli, "_is_wsl", lambda: True)
    monkeypatch.setattr(cli, "_powershell_launcher", lambda: "powershell.exe")
    monkeypatch.setattr(cli, "_overlay_launcher_script", lambda: script)
    monkeypatch.setattr(cli, "_overlay_dir", lambda: tmp_path / "overlay")
    monkeypatch.setattr(cli, "_wsl_to_windows_path", lambda path: f"WIN:{path}")
    monkeypatch.setattr(cli.subprocess, "run", fake_run)

    assert cli._run_overlay_launcher(port=17473, mode="status").returncode == 0
    assert cli._run_overlay_launcher(port=17473, mode="stop").returncode == 0

    status_cmd = calls[0][0]
    stop_cmd = calls[1][0]
    assert "-File" in status_cmd
    assert "-Command" not in status_cmd
    assert f"WIN:{script}" in status_cmd
    assert f"WIN:{tmp_path / 'overlay'}" in status_cmd
    assert status_cmd[-1] == "-Status"
    assert stop_cmd[-1] == "-Stop"


def test_macos_overlay_status_uses_native_process_lookup(monkeypatch) -> None:
    monkeypatch.setattr(cli, "_is_macos", lambda: True)
    monkeypatch.setattr(cli, "_native_overlay_process_ids", lambda: [123, 456])
    monkeypatch.setattr(cli, "_bridge_process_ids", lambda port: [789])

    result = cli._run_overlay_launcher(port=17473, mode="status")

    assert result.returncode == 0
    assert "Overlay processes: 2" in result.stdout
    assert "pid 123: macOS Electron overlay" in result.stdout
    assert "Bridge processes: 1 (789)" in result.stdout


def test_macos_launch_starts_bridge_and_electron(monkeypatch, tmp_path, capsys) -> None:
    calls = {}
    overlay = tmp_path / "overlay"
    main_js = overlay / "src" / "main.js"
    electron = overlay / "node_modules" / ".bin" / "electron"
    main_js.parent.mkdir(parents=True)
    electron.parent.mkdir(parents=True)
    main_js.write_text("// main\n", encoding="utf-8")
    electron.write_text("#!/bin/sh\n", encoding="utf-8")

    class BridgeModule:
        PET_BRIDGE_DEFAULT_PORT = 17473

        @staticmethod
        def is_bridge_available(*, port, host):
            calls["available"] = (port, host)
            return bool(calls.get("bridge_started"))

    class Proc:
        pid = 321

    def fake_popen(cmd, **kwargs):
        calls["popen"] = (cmd, kwargs)
        return Proc()

    monkeypatch.setenv("HERMES_PET_HOME", str(tmp_path / "state"))
    monkeypatch.delenv("HERMES_PET_HOST", raising=False)
    monkeypatch.delenv("HERMES_PET_WS_URL", raising=False)
    monkeypatch.setattr(cli.importlib, "import_module", lambda name: BridgeModule)
    monkeypatch.setattr(cli, "_resolve_bridge_port", lambda bridge_mod: 17473)
    monkeypatch.setattr(cli, "_overlay_dir", lambda: overlay)
    monkeypatch.setattr(cli, "_ensure_native_overlay_dependencies", lambda overlay_dir: electron)
    monkeypatch.setattr(cli, "_start_bridge_process", lambda *, port, host: calls.setdefault("bridge_started", (port, host)))
    monkeypatch.setattr(cli, "_wait_for_bridge", lambda bridge_mod, port, host, timeout_s=5.0: True)
    monkeypatch.setattr(cli, "_notify_current_pet_state", lambda **kwargs: True)
    monkeypatch.setattr(cli, "_ensure_hermes_plugin_current", lambda: calls.setdefault("plugin_synced", True))
    monkeypatch.setattr(cli.subprocess, "Popen", fake_popen)

    assert cli._launch_native_overlay(argparse.Namespace(replace=False), platform_label="macOS") == 0

    output = capsys.readouterr().out
    assert calls["plugin_synced"] is True
    assert calls["bridge_started"] == (17473, "127.0.0.1")
    assert calls["popen"][0] == [str(electron), str(main_js)]
    assert calls["popen"][1]["env"]["HERMES_PET_SPECIES"] == "celestia"
    assert calls["popen"][1]["env"]["HERMES_PET_WS_URL"] == "ws://127.0.0.1:17473"
    assert "Hermes macOS pet overlay started (pid 321)" in output


def test_macos_launch_respects_explicit_host_override(monkeypatch, tmp_path) -> None:
    calls = {}
    overlay = tmp_path / "overlay"
    main_js = overlay / "src" / "main.js"
    electron = overlay / "node_modules" / ".bin" / "electron"
    main_js.parent.mkdir(parents=True)
    electron.parent.mkdir(parents=True)
    main_js.write_text("// main\n", encoding="utf-8")
    electron.write_text("#!/bin/sh\n", encoding="utf-8")

    class BridgeModule:
        PET_BRIDGE_DEFAULT_PORT = 17473

        @staticmethod
        def is_bridge_available(*, port, host):
            return True

    class Proc:
        pid = 321

    def fake_popen(cmd, **kwargs):
        calls["popen"] = (cmd, kwargs)
        return Proc()

    monkeypatch.setenv("HERMES_PET_HOME", str(tmp_path / "state"))
    monkeypatch.setenv("HERMES_PET_HOST", "127.0.0.2")
    monkeypatch.setattr(cli.importlib, "import_module", lambda name: BridgeModule)
    monkeypatch.setattr(cli, "_resolve_bridge_port", lambda bridge_mod: 17473)
    monkeypatch.setattr(cli, "_overlay_dir", lambda: overlay)
    monkeypatch.setattr(cli, "_ensure_native_overlay_dependencies", lambda overlay_dir: electron)
    monkeypatch.setattr(cli, "_notify_current_pet_state", lambda **kwargs: True)
    monkeypatch.setattr(cli, "_ensure_hermes_plugin_current", lambda: calls.setdefault("plugin_synced", True))
    monkeypatch.setattr(cli.subprocess, "Popen", fake_popen)

    assert cli._launch_native_overlay(argparse.Namespace(replace=False), platform_label="macOS") == 0

    assert calls["plugin_synced"] is True
    assert calls["popen"][1]["env"]["HERMES_PET_HOST"] == "127.0.0.2"
    assert calls["popen"][1]["env"]["HERMES_PET_WS_URL"] == "ws://127.0.0.2:17473"


def test_wsl_launch_syncs_hermes_plugin(monkeypatch, tmp_path) -> None:
    calls = {}
    overlay = tmp_path / "overlay"
    script = overlay / "scripts" / "launch-windows-overlay.ps1"
    script.parent.mkdir(parents=True)
    script.write_text("param()\n", encoding="utf-8")

    def fake_run(cmd, **kwargs):
        calls["run"] = (cmd, kwargs)
        return subprocess.CompletedProcess(args=cmd, returncode=0, stdout="ok\n", stderr="")

    monkeypatch.setenv("HERMES_PET_HOME", str(tmp_path / "state"))
    monkeypatch.setattr(cli, "_is_macos", lambda: False)
    monkeypatch.setattr(cli, "_is_wsl", lambda: True)
    monkeypatch.setattr(cli, "_source_overlay_dir", lambda: overlay)
    monkeypatch.setattr(cli, "_wsl_to_windows_path", lambda path: f"WIN:{path}")
    monkeypatch.setattr(cli.shutil, "which", lambda name: "powershell.exe" if name == "powershell.exe" else None)
    monkeypatch.setattr(cli, "_ensure_hermes_plugin_current", lambda: calls.setdefault("plugin_synced", True))
    monkeypatch.setattr(cli.subprocess, "run", fake_run)

    assert cli._launch_bridge_and_overlay(argparse.Namespace(replace=False)) == 0

    assert calls["plugin_synced"] is True
    assert calls["run"][0][0] == "powershell.exe"


def test_status_reports_companion_runtime_before_legacy_pet(monkeypatch, tmp_path, capsys) -> None:
    class BridgeModule:
        PET_BRIDGE_DEFAULT_PORT = 17473

        @staticmethod
        def is_bridge_available(*, port, host):
            return True

    pet = Pet.hatch("", force_seed=1)
    save_pet(pet, state_dir=tmp_path)
    save_prefs({"notification_profile": "focus", "quiet_mode": "important"}, tmp_path)
    (tmp_path / "pet-memory.json").write_text(
        """
{
  "session_thread": {
    "thread_id": "thread-1",
    "title": "Fix CLI status",
    "status": "active",
    "need": "run tests"
  },
  "today": {
    "session_count": 2,
    "tasks_started": 3,
    "tasks_completed": 1,
    "approval_waits": 1,
    "review_waits": 0
  },
  "narrative": {
    "thread_line": "I am tracking the CLI cleanup."
  }
}
""",
        encoding="utf-8",
    )

    monkeypatch.setenv("HERMES_PET_HOST", "172.27.128.1")
    monkeypatch.setattr(cli, "_state_dir", lambda: tmp_path)
    monkeypatch.setattr(cli.importlib, "import_module", lambda name: BridgeModule)
    monkeypatch.setattr(cli, "_hermes_plugin_install_state", lambda target, source=None: "current")
    monkeypatch.setattr(cli, "_hermes_plugin_target", lambda args: tmp_path / "hermes" / "plugins" / "hermes-pet")
    monkeypatch.setattr(
        cli,
        "custom_pet_event_payload",
        lambda base_dir: {
            "name": "celestia-princess",
            "manifest": {"states": {"idle": {}, "running": {}, "review": {}}},
        },
    )

    assert cli._cmd_status(object()) == 0

    output = capsys.readouterr().out
    assert "Hermes Pets status" in output
    assert "overlay_ws             available ws://172.27.128.1:17473" in output
    assert "hermes_plugin          current" in output
    assert "custom_pet             celestia-princess" in output
    assert "custom_pet_states      idle, review, running" in output
    assert "prefs                  profile=focus quiet=important" in output
    assert "session                active: Fix CLI status" in output
    assert "need                   run tests" in output
    assert "today                  sessions=2 started=3 completed=1 approval_waits=1 review_waits=0" in output
    assert "Legacy pet" in output
    assert f"pet.json               {pet.name} the {pet.species} Lv.{pet.level}" in output
    assert "interactions           0" in output


def test_hatch_preserves_custom_pet_selection_by_default(monkeypatch, tmp_path, capsys) -> None:
    monkeypatch.setattr(cli, "_state_dir", lambda: tmp_path)
    import_package("docs/fixtures/custom-pets/minimal-spark", name="audit-spark", base_dir=tmp_path)
    set_current_custom_pet("audit-spark", base_dir=tmp_path)

    assert cli._cmd_hatch(argparse.Namespace(clear_custom=False)) == 0

    output = capsys.readouterr().out
    assert current_custom_pet(tmp_path)["name"] == "audit-spark"
    assert "Custom pet selection preserved" in output


def test_hatch_clear_custom_explicitly_clears_selection(monkeypatch, tmp_path, capsys) -> None:
    monkeypatch.setattr(cli, "_state_dir", lambda: tmp_path)
    monkeypatch.setattr(cli, "_notify_custom_pet_changed", lambda payload: True)
    import_package("docs/fixtures/custom-pets/minimal-spark", name="audit-spark", base_dir=tmp_path)
    set_current_custom_pet("audit-spark", base_dir=tmp_path)

    assert cli._cmd_hatch(argparse.Namespace(clear_custom=True)) == 0

    output = capsys.readouterr().out
    assert current_custom_pet(tmp_path) is None
    assert "Custom pet selection cleared." in output


def test_custom_png_command_warns_that_it_is_legacy(monkeypatch, tmp_path, capsys) -> None:
    monkeypatch.setattr(cli, "_state_dir", lambda: tmp_path)
    source = "docs/fixtures/custom-pets/minimal-spark/sprites/idle/idle_00.png"

    assert cli._cmd_custom(argparse.Namespace(path=source)) == 0

    output = capsys.readouterr().out
    assert "'hermes-pet custom' is legacy" in output
    assert "custom-pet import" in output
    assert (tmp_path / "custom.png").is_file()
