from __future__ import annotations

import importlib
from datetime import datetime, timezone, timedelta
from pathlib import Path

from hermes_pet import cli
from hermes_pet.event_log import load_events
from hermes_pet.memory import (
    derive_insight,
    derive_narrative,
    derive_task_context,
    derive_expression,
    derive_phase,
    today_key,
    load_memory,
    memory_path,
    rotate_memory_day,
    update_memory_for_event,
)


def _cst(year: int, month: int, day: int, hour: int, minute: int = 0) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=timezone(timedelta(hours=8)))


def test_update_memory_for_event_tracks_core_counters(tmp_path: Path) -> None:
    started = update_memory_for_event({"type": "job_started"}, base_dir=tmp_path, now=_cst(2026, 5, 15, 23, 10))
    assert started["companion_preferences"]["preset"] == "balanced_partner"
    assert started["companion_preferences"]["profile_pack"] == "auto"
    assert started["active_days"] == 1
    assert started["night_sessions"] == 1
    assert started["today"]["tasks_started"] == 1
    assert started["work_style_bias"]["late_night_builder"] == 1

    blocked = update_memory_for_event({"type": "review"}, base_dir=tmp_path, now=_cst(2026, 5, 15, 23, 12))
    assert blocked["approval_wait_count"] == 1
    assert blocked["today"]["approval_waits"] == 1
    assert blocked["today"]["review_waits"] == 1
    assert blocked["work_style_bias"]["approval_magnet"] == 1

    failed = update_memory_for_event({"type": "job_failed"}, base_dir=tmp_path, now=_cst(2026, 5, 15, 23, 14))
    assert failed["consecutive_failures"] == 1
    assert failed["recent_failures"][0]["kind"] == "job_failed"
    assert failed["work_style_bias"]["trial_and_error"] == 1

    finished = update_memory_for_event({"type": "job_finished"}, base_dir=tmp_path, now=_cst(2026, 5, 15, 23, 16))
    assert finished["today"]["tasks_completed"] == 1
    assert finished["consecutive_failures"] == 0
    assert finished["work_style_bias"]["steady_worker"] == 1


def test_update_memory_for_event_rotates_day_but_preserves_long_lived_fields(tmp_path: Path) -> None:
    update_memory_for_event({"type": "job_started"}, base_dir=tmp_path, now=_cst(2026, 5, 15, 21, 0))
    next_day = update_memory_for_event({"type": "job_started"}, base_dir=tmp_path, now=_cst(2026, 5, 16, 9, 0))

    assert next_day["today"]["date"] == "2026-05-16"
    assert next_day["today"]["tasks_started"] == 1
    assert next_day["active_days"] == 2
    assert next_day["recent_days"][-1]["date"] == "2026-05-15"
    assert next_day["recent_days"][-1]["tasks_started"] == 1
    assert next_day["companion_preferences"]["focus_mode"] == "balanced"


def test_today_key_uses_configured_timezone(monkeypatch) -> None:
    utc_now = datetime(2026, 5, 16, 16, 30, tzinfo=timezone.utc)
    monkeypatch.setenv("HERMES_PET_TIMEZONE", "Asia/Shanghai")
    assert today_key(utc_now) == "2026-05-17"

    monkeypatch.setenv("HERMES_PET_TIMEZONE", "UTC")
    assert today_key(utc_now) == "2026-05-16"


def test_rotate_memory_day_archives_recent_activity_days(tmp_path: Path) -> None:
    day_one = update_memory_for_event({"type": "job_started"}, base_dir=tmp_path, now=_cst(2026, 5, 13, 10, 0))
    day_one = update_memory_for_event({"type": "job_finished"}, base_dir=tmp_path, now=_cst(2026, 5, 13, 10, 5))
    day_two = rotate_memory_day(day_one, now=_cst(2026, 5, 14, 9, 0))

    assert day_two["today"]["date"] == "2026-05-14"
    assert day_two["today"]["tasks_started"] == 0
    assert len(day_two["recent_days"]) == 1
    assert day_two["recent_days"][0]["date"] == "2026-05-13"
    assert day_two["recent_days"][0]["tasks_completed"] == 1


def test_derive_expression_marks_night_approval_push(tmp_path: Path) -> None:
    update_memory_for_event({"type": "job_started"}, base_dir=tmp_path, now=_cst(2026, 5, 13, 23, 0))
    update_memory_for_event({"type": "review"}, base_dir=tmp_path, now=_cst(2026, 5, 13, 23, 5))
    update_memory_for_event({"type": "job_finished"}, base_dir=tmp_path, now=_cst(2026, 5, 13, 23, 10))
    update_memory_for_event({"type": "job_started"}, base_dir=tmp_path, now=_cst(2026, 5, 14, 23, 0))
    update_memory_for_event({"type": "review"}, base_dir=tmp_path, now=_cst(2026, 5, 14, 23, 5))
    update_memory_for_event({"type": "review"}, base_dir=tmp_path, now=_cst(2026, 5, 14, 23, 8))
    snapshot = update_memory_for_event({"type": "job_finished"}, base_dir=tmp_path, now=_cst(2026, 5, 14, 23, 10))

    expression = derive_expression(snapshot)
    assert expression["summary_key"] == "night_approval_push"
    assert expression["tone"] == "caring"
    assert expression["night_streak"] >= 2
    assert expression["approval_heavy"] is True


def test_derive_expression_marks_failure_recovery(tmp_path: Path) -> None:
    update_memory_for_event({"type": "job_started"}, base_dir=tmp_path, now=_cst(2026, 5, 15, 14, 0))
    update_memory_for_event({"type": "job_failed"}, base_dir=tmp_path, now=_cst(2026, 5, 15, 14, 5))
    snapshot = update_memory_for_event({"type": "job_failed"}, base_dir=tmp_path, now=_cst(2026, 5, 15, 14, 10))

    expression = derive_expression(snapshot)
    assert expression["summary_key"] == "failure_recovery"
    assert expression["tone"] == "reassuring"
    assert expression["failure_heavy"] is True


def test_derive_phase_marks_blocked_guard(tmp_path: Path) -> None:
    update_memory_for_event({"type": "job_started"}, base_dir=tmp_path, now=_cst(2026, 5, 16, 10, 0))
    snapshot = update_memory_for_event({"type": "review"}, base_dir=tmp_path, now=_cst(2026, 5, 16, 10, 3))

    phase = derive_phase(snapshot, now=_cst(2026, 5, 16, 10, 5))
    assert phase["session_phase"] == "blocked"
    assert phase["rhythm"] == "approval_fragmented"
    assert phase["stance"] == "guard"
    assert phase["noise_budget"] == "medium"


def test_derive_phase_marks_deep_work_quiet(tmp_path: Path) -> None:
    update_memory_for_event({"type": "job_started"}, base_dir=tmp_path, now=_cst(2026, 5, 16, 9, 0))
    update_memory_for_event({"type": "job_started"}, base_dir=tmp_path, now=_cst(2026, 5, 16, 9, 10))
    snapshot = update_memory_for_event({"type": "job_started"}, base_dir=tmp_path, now=_cst(2026, 5, 16, 9, 25))

    phase = derive_phase(snapshot, now=_cst(2026, 5, 16, 9, 40))
    assert phase["session_phase"] == "deep_work"
    assert phase["stance"] == "quiet"
    assert phase["noise_budget"] == "low"


def test_derive_phase_marks_trial_loop_soothe(tmp_path: Path) -> None:
    update_memory_for_event({"type": "job_started"}, base_dir=tmp_path, now=_cst(2026, 5, 16, 14, 0))
    update_memory_for_event({"type": "job_failed"}, base_dir=tmp_path, now=_cst(2026, 5, 16, 14, 5))
    snapshot = update_memory_for_event({"type": "job_failed"}, base_dir=tmp_path, now=_cst(2026, 5, 16, 14, 10))

    phase = derive_phase(snapshot, now=_cst(2026, 5, 16, 14, 12))
    assert phase["rhythm"] == "trial_loop"
    assert phase["stance"] == "soothe"
    assert phase["noise_budget"] == "low"


def test_send_pet_event_attaches_python_memory_snapshot(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("HERMES_PET_HOME", str(tmp_path))
    monkeypatch.setattr(cli, "run_voice_for_event", lambda *args, **kwargs: {"ok": True, "skipped": True})

    sent: list[dict[str, object]] = []

    class FakeBridge:
        DEFAULT_PORT = 17473

        @staticmethod
        def send_event_to_bridge(event, port=None, host=None, bridge_url=None):
            sent.append(event)
            return True

    real_import = importlib.import_module

    def fake_import(name: str):
        if name == "hermes_pet.bridge":
            return FakeBridge
        return real_import(name)

    monkeypatch.setattr(cli.importlib, "import_module", fake_import)

    ok, event = cli._send_pet_event("job_started", "Build started", required=False)

    assert ok is True
    assert "companion_memory" in event
    assert event["companion_memory"]["companion_preferences"]["preset"] == "balanced_partner"
    assert event["companion_memory"]["task_context"]["category"] == "general"
    assert event["companion_memory"]["today"]["tasks_started"] == 1
    assert sent[0]["companion_memory"]["today"]["tasks_started"] == 1

    stored = load_events(tmp_path)
    assert stored[0]["type"] == "job_started"
    assert "companion_memory" not in stored[0]
    assert memory_path(tmp_path).is_file()
    assert load_memory(tmp_path)["today"]["tasks_started"] == 1


def test_load_memory_preserves_companion_preferences(tmp_path: Path) -> None:
    from hermes_pet.memory import save_memory

    memory = update_memory_for_event({"type": "job_started"}, base_dir=tmp_path, now=_cst(2026, 5, 16, 12, 0))
    memory["companion_preferences"] = {
        "preset": "quiet_operator",
        "profile_pack": "cat_operator",
        "proactivity": "low",
        "tone_balance": "balanced",
        "focus_mode": "work",
        "verbosity": "low",
    }
    save_memory(memory, tmp_path, _cst(2026, 5, 16, 12, 5))

    loaded = load_memory(tmp_path, _cst(2026, 5, 16, 12, 6))
    assert loaded["companion_preferences"]["preset"] == "quiet_operator"
    assert loaded["companion_preferences"]["profile_pack"] == "cat_operator"
    assert loaded["companion_preferences"]["proactivity"] == "low"
    assert loaded["companion_preferences"]["focus_mode"] == "work"


def test_derive_task_context_marks_coding_from_command_family(tmp_path: Path) -> None:
    snapshot = update_memory_for_event(
        {"type": "job_started", "command": ["pytest", "-q"], "project_id": "demo"},
        base_dir=tmp_path,
        now=_cst(2026, 5, 16, 13, 0),
    )
    context = derive_task_context(snapshot)
    assert context["category"] == "coding"
    assert context["confidence"] == "high"
    assert context["command_family"] == "pytest"
    assert context["signals"]["coding"] is True


def test_derive_task_context_marks_review_and_approval(tmp_path: Path) -> None:
    review_snapshot = update_memory_for_event({"type": "review"}, base_dir=tmp_path, now=_cst(2026, 5, 16, 13, 5))
    review_context = derive_task_context(review_snapshot)
    assert review_context["category"] == "review"
    assert review_context["signals"]["review"] is True

    waiting_snapshot = update_memory_for_event({"type": "waiting"}, base_dir=tmp_path, now=_cst(2026, 5, 16, 13, 8))
    waiting_context = derive_task_context(waiting_snapshot)
    assert waiting_context["category"] == "approval_heavy"
    assert waiting_context["signals"]["approval"] is True


def test_derive_task_context_marks_browser_and_shell(tmp_path: Path) -> None:
    browser_snapshot = update_memory_for_event(
        {"type": "message_received", "source": "browser", "action_url": "https://example.com"},
        base_dir=tmp_path,
        now=_cst(2026, 5, 16, 14, 0),
    )
    browser_context = derive_task_context(browser_snapshot)
    assert browser_context["category"] == "browser_heavy"
    assert browser_context["signals"]["browser"] is True

    shell_snapshot = update_memory_for_event(
        {"type": "job_started", "command": ["ffmpeg", "-i", "in.mp4", "out.mp4"]},
        base_dir=tmp_path,
        now=_cst(2026, 5, 16, 14, 5),
    )
    shell_context = derive_task_context(shell_snapshot)
    assert shell_context["category"] == "shell_heavy"
    assert shell_context["signals"]["shell"] is True


def test_update_memory_for_semantic_task_events_tracks_focus_and_need(tmp_path: Path) -> None:
    started = update_memory_for_event(
        {
            "type": "task_started",
            "task_title": "Refactor companion runtime",
            "task_kind": "coding",
            "task_step": "Extract runtime adapter",
            "task_summary": "Moving panel model into runtime",
            "task_next": "Wire renderer fallback",
            "tools_used": ["apply_patch", "pytest"],
            "changed_files": ["overlay/src/renderer.js"],
        },
        base_dir=tmp_path,
        now=_cst(2026, 5, 18, 10, 0),
    )
    semantic = started["semantic_task"]
    assert semantic["title"] == "Refactor companion runtime"
    assert semantic["intent"] == "Refactor companion runtime"
    assert semantic["status"] == "active"
    assert semantic["active"] is True
    assert semantic["next_action"] == "Wire renderer fallback"
    assert semantic["tools_used"] == ["apply_patch", "pytest"]
    assert started["narrative"]["focus_line"].startswith("Refactor companion runtime")

    blocked = update_memory_for_event(
        {
            "type": "task_blocked",
            "task_title": "Refactor companion runtime",
            "blocker_type": "approval",
            "blocker_detail": "Need confirmation on panel wording",
            "needs_user": True,
            "task_next": "Confirm labels",
        },
        base_dir=tmp_path,
        now=_cst(2026, 5, 18, 10, 5),
    )
    blocked_task = blocked["semantic_task"]
    assert blocked_task["status"] == "blocked"
    assert blocked_task["needs_user"] is True
    assert blocked_task["blocker_type"] == "approval"
    assert blocked["narrative"]["need_line"] == "Confirm labels"

    still_blocked = update_memory_for_event(
        {
            "type": "task_progress",
            "task_title": "Refactor companion runtime",
            "task_summary": "Late progress event after prompt",
        },
        base_dir=tmp_path,
        now=_cst(2026, 5, 18, 10, 6),
    )
    assert still_blocked["semantic_task"]["status"] == "blocked"
    assert still_blocked["semantic_task"]["needs_user"] is True
    assert still_blocked["semantic_task"]["blocker_type"] == "approval"
    assert still_blocked["semantic_task"]["intent"] == "Refactor companion runtime"

    finished = update_memory_for_event(
        {
            "type": "task_completed",
            "task_title": "Refactor companion runtime",
            "outcome_summary": "Runtime adapter merged",
        },
        base_dir=tmp_path,
        now=_cst(2026, 5, 18, 10, 20),
    )
    assert finished["semantic_task"]["status"] == "completed"
    assert finished["semantic_task"]["active"] is False


def test_derive_narrative_adds_thread_day_risk_and_next_lines(tmp_path: Path) -> None:
    update_memory_for_event(
        {
            "type": "task_started",
            "task_title": "Jupyter login flow",
            "task_kind": "browser_heavy",
            "task_step": "Open notebook URL",
            "task_next": "Check login state",
        },
        base_dir=tmp_path,
        now=_cst(2026, 5, 18, 10, 0),
    )
    snapshot = update_memory_for_event(
        {
            "type": "task_blocked",
            "task_title": "Jupyter login flow",
            "blocker_type": "approval",
            "blocker_detail": "Jupyter password",
            "task_next": "Enter password",
            "needs_user": True,
        },
        base_dir=tmp_path,
        now=_cst(2026, 5, 18, 10, 5),
    )

    narrative = derive_narrative(snapshot)

    assert narrative["thread_line"].startswith("等你处理：Jupyter login flow")
    assert narrative["day_line"].startswith("今日主线：")
    assert narrative["next_line"] == "下一步需要你处理：Enter password"
    assert "risk_line" in narrative
    assert "recent_lines" in narrative


def test_semantic_events_append_narrative_recent_lines(tmp_path: Path) -> None:
    update_memory_for_event(
        {
            "type": "task_started",
            "task_title": "Jupyter login flow",
            "task_kind": "browser_heavy",
        },
        base_dir=tmp_path,
        now=_cst(2026, 5, 18, 13, 0),
    )
    update_memory_for_event(
        {
            "type": "task_blocked",
            "task_title": "Jupyter login flow",
            "task_next": "Enter password",
            "needs_user": True,
        },
        base_dir=tmp_path,
        now=_cst(2026, 5, 18, 13, 1),
    )
    snapshot = update_memory_for_event(
        {
            "type": "task_completed",
            "task_title": "Jupyter login flow",
            "task_summary": "Notebook opened",
        },
        base_dir=tmp_path,
        now=_cst(2026, 5, 18, 13, 5),
    )

    lines = [item["line"] for item in snapshot["narrative"]["recent_lines"]]

    assert lines[0] == "收住：Notebook opened"
    assert "卡住：Enter password" in lines
    assert "开咗头：Jupyter login flow" in lines


def test_task_progress_with_user_need_becomes_blocked(tmp_path: Path) -> None:
    update_memory_for_event(
        {
            "type": "task_started",
            "task_title": "Open Jupyter",
            "task_kind": "browser_heavy",
        },
        base_dir=tmp_path,
        now=_cst(2026, 5, 18, 11, 0),
    )

    blocked = update_memory_for_event(
        {
            "type": "task_progress",
            "task_title": "Open Jupyter",
            "task_summary": "Login page needs a password",
            "task_next": "Enter password",
            "needs_user": True,
        },
        base_dir=tmp_path,
        now=_cst(2026, 5, 18, 11, 1),
    )

    semantic = blocked["semantic_task"]
    assert semantic["status"] == "blocked"
    assert semantic["active"] is True
    assert semantic["needs_user"] is True
    assert semantic["blocker_type"] == "clarify"
    assert blocked["narrative"]["need_line"] == "Enter password"


def test_task_progress_with_blocked_json_summary_becomes_review_blocked(tmp_path: Path) -> None:
    update_memory_for_event(
        {
            "type": "task_started",
            "task_id": "shell-approval",
            "task_title": "Run shell step",
            "task_kind": "shell_heavy",
        },
        base_dir=tmp_path,
        now=_cst(2026, 5, 18, 12, 0),
    )

    blocked = update_memory_for_event(
        {
            "type": "task_progress",
            "task_id": "shell-approval",
            "task_title": "Run shell step",
            "task_summary": '{"output":"","exit_code":-1,"error":"BLOCKED: Command denied by user. Do NOT retry this command.","status":"blocked"}',
        },
        base_dir=tmp_path,
        now=_cst(2026, 5, 18, 12, 1),
    )

    semantic = blocked["semantic_task"]
    assert semantic["status"] == "blocked"
    assert semantic["needs_user"] is True
    assert semantic["blocker_type"] == "approval"
    assert "BLOCKED" in semantic["blocker_detail"]
    assert blocked["today"]["approval_waits"] == 1
    assert blocked["today"]["review_waits"] == 1


def test_task_progress_with_approved_history_summary_stays_active(tmp_path: Path) -> None:
    update_memory_for_event(
        {
            "type": "task_started",
            "task_id": "approved-shell",
            "task_title": "Run shell step",
            "task_kind": "shell_heavy",
        },
        base_dir=tmp_path,
        now=_cst(2026, 5, 18, 12, 10),
    )

    progressed = update_memory_for_event(
        {
            "type": "task_progress",
            "task_id": "approved-shell",
            "task_title": "Run shell step",
            "task_summary": '{"output":"","exit_code":0,"error":null,"approval":"Command required approval (Security scan) and was approved by the user."}',
        },
        base_dir=tmp_path,
        now=_cst(2026, 5, 18, 12, 11),
    )

    assert progressed["semantic_task"]["status"] == "active"
    assert progressed["semantic_task"]["needs_user"] is False
    assert progressed["today"]["approval_waits"] == 0


def test_new_task_clears_stale_blocker_need(tmp_path: Path) -> None:
    update_memory_for_event(
        {
            "type": "task_blocked",
            "task_id": "old-review",
            "task_title": "Old review",
            "blocker_type": "approval",
            "task_next": "Review the changed files",
            "needs_user": True,
        },
        base_dir=tmp_path,
        now=_cst(2026, 5, 18, 12, 20),
    )

    started = update_memory_for_event(
        {
            "type": "task_started",
            "task_id": "fresh-task",
            "task_title": "Fresh task",
            "task_kind": "coding",
        },
        base_dir=tmp_path,
        now=_cst(2026, 5, 18, 12, 21),
    )

    semantic = started["semantic_task"]
    assert semantic["status"] == "active"
    assert semantic["needs_user"] is False
    assert semantic["blocker_type"] == ""
    assert semantic["next_action"] == ""


def test_session_thread_groups_progress_without_timeline_churn(tmp_path: Path) -> None:
    started = update_memory_for_event(
        {
            "type": "task_started",
            "task_id": "runtime-thread",
            "task_title": "Refactor companion runtime",
            "task_kind": "coding",
        },
        base_dir=tmp_path,
        now=_cst(2026, 5, 19, 10, 0),
    )
    thread = started["session_thread"]

    assert thread["status"] == "active"
    assert thread["title"] == "Refactor companion runtime"
    assert thread["event_count"] == 1
    assert thread["timeline"][-1]["kind"] == "started"

    progressed = update_memory_for_event(
        {
            "type": "task_progress",
            "task_id": "runtime-thread",
            "task_title": "Refactor companion runtime",
            "task_summary": "Wire session adapter",
        },
        base_dir=tmp_path,
        now=_cst(2026, 5, 19, 10, 5),
    )
    progressed_thread = progressed["session_thread"]

    assert progressed_thread["thread_id"] == thread["thread_id"]
    assert progressed_thread["status"] == "active"
    assert progressed_thread["summary"] == "Wire session adapter"
    assert progressed_thread["event_count"] == 2
    assert [item["kind"] for item in progressed_thread["timeline"]] == ["started"]


def test_session_thread_tracks_block_resume_and_completion(tmp_path: Path) -> None:
    started = update_memory_for_event(
        {
            "type": "task_started",
            "task_id": "approval-thread",
            "task_title": "Review panel copy",
            "task_kind": "review",
        },
        base_dir=tmp_path,
        now=_cst(2026, 5, 19, 11, 0),
    )
    thread_id = started["session_thread"]["thread_id"]

    blocked = update_memory_for_event(
        {
            "type": "task_blocked",
            "task_id": "approval-thread",
            "task_title": "Review panel copy",
            "blocker_type": "approval",
            "task_next": "Confirm the shorter copy",
            "needs_user": True,
        },
        base_dir=tmp_path,
        now=_cst(2026, 5, 19, 11, 3),
    )
    blocked_thread = blocked["session_thread"]

    assert blocked_thread["thread_id"] == thread_id
    assert blocked_thread["status"] == "blocked"
    assert blocked_thread["need"] == "Confirm the shorter copy"
    assert blocked_thread["blocker_type"] == "approval"
    assert blocked_thread["timeline"][-1]["kind"] == "blocked"

    resumed = update_memory_for_event(
        {
            "type": "task_resumed",
            "task_id": "approval-thread",
            "task_title": "Review panel copy",
        },
        base_dir=tmp_path,
        now=_cst(2026, 5, 19, 11, 6),
    )
    resumed_thread = resumed["session_thread"]

    assert resumed_thread["thread_id"] == thread_id
    assert resumed_thread["status"] == "active"
    assert resumed_thread["need"] == ""
    assert resumed_thread["timeline"][-1]["kind"] == "resumed"

    finished = update_memory_for_event(
        {
            "type": "task_completed",
            "task_id": "approval-thread",
            "task_title": "Review panel copy",
            "outcome_summary": "Panel copy shortened",
        },
        base_dir=tmp_path,
        now=_cst(2026, 5, 19, 11, 12),
    )
    finished_thread = finished["session_thread"]

    assert finished_thread["thread_id"] == thread_id
    assert finished_thread["status"] == "completed"
    assert finished_thread["completed_at"] is not None
    assert finished_thread["wrap_line"] == "这轮收住：Panel copy shortened"
    assert finished_thread["timeline"][-1]["kind"] == "completed"


def test_session_thread_starts_new_thread_after_completion_or_stale_gap(tmp_path: Path) -> None:
    update_memory_for_event(
        {
            "type": "task_started",
            "task_id": "first-thread",
            "task_title": "First task",
        },
        base_dir=tmp_path,
        now=_cst(2026, 5, 19, 12, 0),
    )
    completed = update_memory_for_event(
        {
            "type": "task_completed",
            "task_id": "first-thread",
            "task_title": "First task",
            "outcome_summary": "First task done",
        },
        base_dir=tmp_path,
        now=_cst(2026, 5, 19, 12, 5),
    )
    first_thread_id = completed["session_thread"]["thread_id"]

    second = update_memory_for_event(
        {
            "type": "task_started",
            "task_id": "second-thread",
            "task_title": "Second task",
        },
        base_dir=tmp_path,
        now=_cst(2026, 5, 19, 12, 6),
    )

    assert second["session_thread"]["thread_id"] != first_thread_id
    assert second["session_thread"]["title"] == "Second task"
    assert second["session_thread"]["event_count"] == 1

    stale = update_memory_for_event(
        {
            "type": "task_progress",
            "task_id": "stale-thread",
            "task_title": "Stale task",
            "task_summary": "Progress after a long gap",
        },
        base_dir=tmp_path,
        now=_cst(2026, 5, 19, 12, 37),
    )

    assert stale["session_thread"]["thread_id"] != second["session_thread"]["thread_id"]
    assert stale["session_thread"]["title"] == "Stale task"
    assert stale["session_thread"]["event_count"] == 1


def test_session_thread_distinguishes_thinking_waiting_from_user_need(tmp_path: Path) -> None:
    started = update_memory_for_event(
        {
            "type": "task_started",
            "task_id": "thinking-thread",
            "task_title": "Debug runtime hook",
        },
        base_dir=tmp_path,
        now=_cst(2026, 5, 19, 13, 0),
    )
    thread_id = started["session_thread"]["thread_id"]

    thinking = update_memory_for_event(
        {
            "type": "waiting",
            "task_id": "thinking-thread",
            "text": "Thinking through the next step",
        },
        base_dir=tmp_path,
        now=_cst(2026, 5, 19, 13, 1),
    )

    assert thinking["session_thread"]["thread_id"] == thread_id
    assert thinking["session_thread"]["status"] == "thinking"
    assert thinking["session_thread"]["need"] == ""
    assert thinking["session_thread"]["timeline"][-1]["kind"] == "thinking"

    blocked = update_memory_for_event(
        {
            "type": "waiting",
            "task_id": "thinking-thread",
            "task_next": "Approve shell command",
            "needs_user": True,
        },
        base_dir=tmp_path,
        now=_cst(2026, 5, 19, 13, 2),
    )

    assert blocked["session_thread"]["thread_id"] == thread_id
    assert blocked["session_thread"]["status"] == "blocked"
    assert blocked["session_thread"]["need"] == "Approve shell command"
    assert blocked["session_thread"]["timeline"][-1]["kind"] == "blocked"


def test_session_thread_filters_manual_diagnostic_titles(tmp_path: Path) -> None:
    started = update_memory_for_event(
        {"type": "task_started", "text": "Bubble visible check"},
        base_dir=tmp_path,
        now=_cst(2026, 5, 19, 13, 10),
    )

    assert started["session_thread"]["title"] == "这轮任务"
    assert "Bubble visible check" not in started["session_thread"]["timeline"][-1]["line"]
    assert started["semantic_task"]["summary"] == ""
    assert "Bubble visible check" not in started["narrative"]["thread_line"]


def test_session_thread_filters_json_payload_titles(tmp_path: Path) -> None:
    payload = '{"success": true, "name": "task-dispatch", "description": "raw tool payload"}'

    resumed = update_memory_for_event(
        {"type": "task_resumed", "text": payload, "task_summary": payload},
        base_dir=tmp_path,
        now=_cst(2026, 5, 19, 13, 12),
    )

    assert resumed["session_thread"]["title"] == "这轮任务"
    assert "task-dispatch" not in resumed["session_thread"]["title"]
    assert "{" not in resumed["narrative"]["thread_line"]
    assert "task-dispatch" not in resumed["narrative"]["thread_line"]


def test_session_thread_scrubs_previous_diagnostic_history(tmp_path: Path) -> None:
    update_memory_for_event(
        {"type": "task_started", "text": "Bubble visible check"},
        base_dir=tmp_path,
        now=_cst(2026, 5, 19, 13, 14),
    )
    resumed = update_memory_for_event(
        {"type": "task_resumed", "task_title": "Refactor companion runtime"},
        base_dir=tmp_path,
        now=_cst(2026, 5, 19, 13, 15),
    )

    assert all("{" not in item["line"] for item in resumed["session_thread"]["timeline"])
    assert all("Bubble visible check" not in item["line"] for item in resumed["session_thread"]["timeline"])
    assert all("{" not in item["line"] for item in resumed["narrative"]["recent_lines"])


def test_send_semantic_pet_event_attaches_semantic_snapshot(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("HERMES_PET_HOME", str(tmp_path))
    monkeypatch.setattr(cli, "run_voice_for_event", lambda *args, **kwargs: {"ok": True, "skipped": True})

    sent: list[dict[str, object]] = []

    class FakeBridge:
        DEFAULT_PORT = 17473

        @staticmethod
        def send_event_to_bridge(event, port=None, host=None, bridge_url=None):
            sent.append(event)
            return True

    real_import = importlib.import_module

    def fake_import(name: str):
        if name == "hermes_pet.bridge":
            return FakeBridge
        return real_import(name)

    monkeypatch.setattr(cli.importlib, "import_module", fake_import)

    ok, event = cli._send_pet_event(
        "task_started",
        "Moving panel model into runtime",
        required=False,
        task_title="Refactor companion runtime",
        task_kind="coding",
        task_step="Extract panel adapter",
        task_next="Verify renderer fallback",
        changed_files=["overlay/src/renderer.js"],
    )

    assert ok is True
    assert event["companion_memory"]["semantic_task"]["title"] == "Refactor companion runtime"
    assert event["companion_memory"]["semantic_task"]["kind"] == "coding"
    assert event["companion_memory"]["semantic_task"]["status"] == "active"
    assert sent[0]["companion_memory"]["narrative"]["focus_line"].startswith("Refactor companion runtime")


def test_derive_insight_marks_night_load_and_sleep_debt(tmp_path: Path) -> None:
    for offset, day in enumerate(range(10, 16), start=0):
        update_memory_for_event({"type": "job_started"}, base_dir=tmp_path, now=_cst(2026, 5, day, 23, 0))
        snapshot = update_memory_for_event({"type": "job_finished"}, base_dir=tmp_path, now=_cst(2026, 5, day, 23, 10))
        if offset == 5:
            insight = derive_insight(snapshot)

    assert insight["trend_key"] == "night_load"
    assert insight["risk_key"] == "sleep_debt"
    assert insight["pattern_key"] == "night_push"
    assert insight["night_days_14d"] >= 6


def test_derive_insight_marks_approval_drag_and_approval_bound(tmp_path: Path) -> None:
    for day in range(10, 14):
        update_memory_for_event({"type": "job_started"}, base_dir=tmp_path, now=_cst(2026, 5, day, 10, 0))
        update_memory_for_event({"type": "review"}, base_dir=tmp_path, now=_cst(2026, 5, day, 10, 5))
        snapshot = update_memory_for_event({"type": "waiting"}, base_dir=tmp_path, now=_cst(2026, 5, day, 10, 8))

    insight = derive_insight(snapshot)
    assert insight["trend_key"] == "approval_drag"
    assert insight["risk_key"] == "approval_drag"
    assert insight["pattern_key"] == "approval_bound"
    assert insight["approval_waits_7d"] >= 8


def test_derive_insight_marks_steady_gain_and_cadence(tmp_path: Path) -> None:
    for day in range(10, 16):
        update_memory_for_event({"type": "job_started"}, base_dir=tmp_path, now=_cst(2026, 5, day, 14, 0))
        snapshot = update_memory_for_event({"type": "job_finished"}, base_dir=tmp_path, now=_cst(2026, 5, day, 14, 15))

    insight = derive_insight(snapshot)
    assert insight["trend_key"] == "steady_gain"
    assert insight["risk_key"] == "none"
    assert insight["pattern_key"] == "steady_cadence"
    assert insight["tasks_completed_7d"] >= 6
