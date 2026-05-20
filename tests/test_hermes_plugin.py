from __future__ import annotations

import argparse
import importlib.util
from pathlib import Path

from hermes_pet import cli


def _args(home: Path, *, replace: bool = False, dry_run: bool = False) -> argparse.Namespace:
    return argparse.Namespace(home=str(home), replace=replace, dry_run=dry_run)


def test_hermes_plugin_install_and_status(tmp_path: Path) -> None:
    home = tmp_path / "hermes"

    assert cli._cmd_hermes_plugin_status(_args(home)) == 1
    assert cli._cmd_hermes_plugin_install(_args(home)) == 0

    target = home / "plugins" / "hermes-pet"
    assert (target / "__init__.py").is_file()
    assert (target / "plugin.yaml").is_file()
    assert cli._cmd_hermes_plugin_status(_args(home)) == 0


def test_hermes_plugin_install_requires_replace_for_drift(tmp_path: Path) -> None:
    home = tmp_path / "hermes"
    target = home / "plugins" / "hermes-pet"
    target.mkdir(parents=True)
    (target / "__init__.py").write_text("# local edit\n", encoding="utf-8")
    (target / "plugin.yaml").write_text("name: hermes-pet\n", encoding="utf-8")

    try:
        cli._cmd_hermes_plugin_install(_args(home))
    except cli.PetCLIError as exc:
        assert "--replace" in str(exc)
    else:  # pragma: no cover - explicit assertion path
        raise AssertionError("drifted plugin install should require --replace")

    assert cli._cmd_hermes_plugin_install(_args(home, replace=True)) == 0
    assert "pre_approval_request" in (target / "plugin.yaml").read_text(encoding="utf-8")


def test_hermes_plugin_export_writes_standalone_plugin(tmp_path: Path) -> None:
    target = tmp_path / "exported-hermes-pet"
    args = argparse.Namespace(output=str(target), replace=False, dry_run=False)

    assert cli._cmd_hermes_plugin_export(args) == 0

    assert (target / "__init__.py").is_file()
    assert (target / "plugin.yaml").is_file()
    assert "def register" in (target / "__init__.py").read_text(encoding="utf-8")
    assert "pre_approval_request" in (target / "plugin.yaml").read_text(encoding="utf-8")


def test_hermes_plugin_export_requires_replace_for_existing_target(tmp_path: Path) -> None:
    target = tmp_path / "exported-hermes-pet"
    target.mkdir()
    args = argparse.Namespace(output=str(target), replace=False, dry_run=False)

    try:
        cli._cmd_hermes_plugin_export(args)
    except cli.PetCLIError as exc:
        assert "--replace" in str(exc)
    else:  # pragma: no cover - explicit assertion path
        raise AssertionError("existing export target should require --replace")

    args.replace = True
    assert cli._cmd_hermes_plugin_export(args) == 0
    assert (target / "__init__.py").is_file()


def test_packaged_hermes_plugin_maps_approval_outcomes(tmp_path: Path) -> None:
    home = tmp_path / "hermes"
    cli._cmd_hermes_plugin_install(_args(home))
    plugin_path = home / "plugins" / "hermes-pet" / "__init__.py"

    spec = importlib.util.spec_from_file_location("hermes_pet_plugin_test", plugin_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    sent = []
    module._send_ws = lambda event: sent.append(event) or True

    module._on_pre_approval_request(
        command="rm -rf /tmp/example",
        description="Dangerous delete",
        session_key="session-1",
    )
    module._on_post_approval_response(choice="once", session_key="session-1")
    module._on_post_approval_response(choice="deny", session_key="session-1")
    module._on_post_approval_response(choice="timeout", session_key="session-1")

    assert sent[0]["type"] == "task_blocked"
    assert sent[0]["blocker_type"] == "approval"
    assert sent[1]["type"] == "task_resumed"
    assert sent[2]["type"] == "task_failed"
    assert sent[2]["outcome_summary"] == "Approval denied"
    assert sent[3]["type"] == "task_failed"
    assert sent[3]["outcome_summary"] == "Approval timed out"


def test_packaged_hermes_plugin_defaults_to_localhost_outside_wsl(tmp_path: Path, monkeypatch) -> None:
    home = tmp_path / "hermes"
    cli._cmd_hermes_plugin_install(_args(home))
    plugin_path = home / "plugins" / "hermes-pet" / "__init__.py"

    spec = importlib.util.spec_from_file_location("hermes_pet_plugin_test_localhost", plugin_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    monkeypatch.delenv("HERMES_PET_WS_URL", raising=False)
    monkeypatch.delenv("HERMES_PET_BRIDGE_URL", raising=False)
    monkeypatch.delenv("HERMES_PET_HOST", raising=False)
    monkeypatch.delenv("WSL_DISTRO_NAME", raising=False)

    def fake_open(*args, **kwargs):
        raise FileNotFoundError

    monkeypatch.setattr(module, "open", fake_open, raising=False)

    assert module._bridge_url() == "ws://127.0.0.1:17473"


def test_packaged_hermes_plugin_defaults_to_windows_host_in_wsl(tmp_path: Path, monkeypatch) -> None:
    home = tmp_path / "hermes"
    cli._cmd_hermes_plugin_install(_args(home))
    plugin_path = home / "plugins" / "hermes-pet" / "__init__.py"

    spec = importlib.util.spec_from_file_location("hermes_pet_plugin_test_wsl", plugin_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    monkeypatch.delenv("HERMES_PET_WS_URL", raising=False)
    monkeypatch.delenv("HERMES_PET_BRIDGE_URL", raising=False)
    monkeypatch.delenv("HERMES_PET_HOST", raising=False)
    monkeypatch.setenv("WSL_DISTRO_NAME", "Ubuntu")

    assert module._bridge_url() == "ws://172.27.128.1:17473"
