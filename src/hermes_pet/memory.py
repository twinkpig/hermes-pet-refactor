"""Persistent companion memory for Hermes Pets."""

from __future__ import annotations

import json
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

MEMORY_VERSION = 7
DEFAULT_TIMEZONE = "Asia/Shanghai"
THREAD_ACTIVE_WINDOW_MINUTES = 30
THREAD_BLOCKED_WINDOW_MINUTES = 60
THREAD_IDLE_WRAP_GRACE_MINUTES = 10


def state_dir(base_dir: str | Path | None = None) -> Path:
    if base_dir is not None:
        return Path(base_dir).expanduser()
    return Path(os.environ.get("HERMES_PET_HOME") or "~/.hermes_pet").expanduser()


def memory_path(base_dir: str | Path | None = None) -> Path:
    return state_dir(base_dir) / "pet-memory.json"


def configured_timezone_name() -> str:
    return str(os.environ.get("HERMES_PET_TIMEZONE") or DEFAULT_TIMEZONE)


def configured_timezone() -> ZoneInfo:
    name = configured_timezone_name()
    try:
        return ZoneInfo(name)
    except Exception:
        return ZoneInfo(DEFAULT_TIMEZONE)


def now_in_timezone(now: datetime | None = None) -> datetime:
    tz = configured_timezone()
    if now is None:
        return datetime.now(tz)
    return now.astimezone(tz)


def iso_now(now: datetime | None = None) -> str:
    current = now or datetime.now().astimezone()
    return current.astimezone().isoformat(timespec="seconds").replace("+00:00", "Z")


def today_key(now: datetime | None = None) -> str:
    current = now_in_timezone(now)
    return current.date().isoformat()


def is_late_night_window(now: datetime | None = None) -> bool:
    current = now_in_timezone(now)
    hour = current.hour
    return hour >= 22 or hour < 6


def default_memory(now: datetime | None = None) -> dict[str, Any]:
    return {
        "version": MEMORY_VERSION,
        "companion_preferences": {
            "preset": "balanced_partner",
            "profile_pack": "auto",
            "proactivity": "medium",
            "tone_balance": "balanced",
            "focus_mode": "balanced",
            "verbosity": "medium",
        },
        "active_days": 0,
        "last_active_date": "",
        "recent_days": [],
        "night_sessions": 0,
        "long_running_count": 0,
        "approval_wait_count": 0,
        "consecutive_failures": 0,
        "recent_failures": [],
        "work_style_bias": {
            "steady_worker": 0,
            "late_night_builder": 0,
            "approval_magnet": 0,
            "trial_and_error": 0,
        },
        "today": {
            "date": today_key(now),
            "session_count": 0,
            "session_resumes": 0,
            "tasks_started": 0,
            "tasks_completed": 0,
            "long_running_seen": 0,
            "approval_waits": 0,
            "review_waits": 0,
            "first_active_at": None,
            "last_active_at": None,
            "last_idle_at": None,
            "last_session_open_at": None,
            "last_session_closed_at": None,
            "greeted": False,
            "wrapped_up": False,
            "night_marked": False,
            "late_night_cared": False,
        },
        "cooldowns": {
            "idle_nudge_at": None,
            "running_nudge_at": None,
            "waiting_nudge_at": None,
            "late_night_nudge_at": None,
            "failure_comfort_at": None,
        },
        "expression": {
            "tone": "warming_up",
            "summary_key": "warming_up",
            "night_streak": 0,
            "night_days_7d": 0,
            "approval_waits_3d": 0,
            "review_waits_3d": 0,
            "tasks_completed_3d": 0,
            "approval_heavy": False,
            "failure_heavy": False,
            "steady_recent": False,
            "dominant_bias": "",
        },
        "last_event_context": {
            "event_type": "",
            "source": "",
            "command_family": "",
            "project_id": "",
            "has_action_url": False,
            "sender": "",
        },
        "phase": {
            "session_phase": "warmup",
            "rhythm": "steady_flow",
            "stance": "push",
            "noise_budget": "medium",
            "active_minutes": 0,
            "idle_gap_minutes": None,
            "blocking_pressure": 0,
        },
        "insight": {
            "trend_key": "warming_up",
            "risk_key": "none",
            "pattern_key": "early_ramp",
            "summary": "warming_up",
            "tasks_completed_7d": 0,
            "tasks_completed_14d": 0,
            "approval_waits_7d": 0,
            "review_waits_7d": 0,
            "long_running_7d": 0,
            "night_days_14d": 0,
            "wrap_rate_7d": 0.0,
        },
        "semantic_task": {
            "task_id": "",
            "title": "",
            "goal": "",
            "criteria": [],
            "intent": "",
            "kind": "general",
            "status": "idle",
            "step": "",
            "summary": "",
            "next_action": "",
            "blocker_type": "",
            "blocker_detail": "",
            "needs_user": False,
            "changed_files": [],
            "tools_used": [],
            "project_id": "",
            "started_at": None,
            "updated_at": None,
            "completed_at": None,
            "failed_at": None,
            "resumed_from": "",
            "active": False,
        },
        "session_thread": {
            "thread_id": "",
            "task_id": "",
            "title": "",
            "summary": "",
            "status": "idle",
            "need": "",
            "blocker_type": "",
            "started_at": None,
            "updated_at": None,
            "completed_at": None,
            "event_count": 0,
            "last_event_type": "",
            "timeline": [],
            "wrap_line": "",
        },
        "narrative": {
            "focus_line": "",
            "need_line": "",
            "status_line": "",
            "recent_line": "",
            "thread_line": "",
            "day_line": "",
            "risk_line": "",
            "next_line": "",
            "recent_lines": [],
            "updated_at": None,
        },
        "task_context": {
            "category": "general",
            "confidence": "low",
            "interaction_mode": "ambient",
            "command_family": "",
            "source": "",
            "project_scope": "none",
            "signals": {
                "coding": False,
                "review": False,
                "shell": False,
                "browser": False,
                "approval": False,
            },
        },
    }


def merge_memory(raw: dict[str, Any] | None, now: datetime | None = None) -> dict[str, Any]:
    base = default_memory(now)
    if not isinstance(raw, dict):
        return base
    out = dict(base)
    out.update(raw)
    out["version"] = max(MEMORY_VERSION, int(raw.get("version") or 0))
    out["companion_preferences"] = {**base["companion_preferences"], **dict(raw.get("companion_preferences") or {})}
    out["work_style_bias"] = {**base["work_style_bias"], **dict(raw.get("work_style_bias") or {})}
    out["today"] = {**base["today"], **dict(raw.get("today") or {})}
    out["cooldowns"] = {**base["cooldowns"], **dict(raw.get("cooldowns") or {})}
    out["expression"] = {**base["expression"], **dict(raw.get("expression") or {})}
    out["last_event_context"] = {**base["last_event_context"], **dict(raw.get("last_event_context") or {})}
    out["phase"] = {**base["phase"], **dict(raw.get("phase") or {})}
    out["insight"] = {**base["insight"], **dict(raw.get("insight") or {})}
    out["semantic_task"] = {**base["semantic_task"], **dict(raw.get("semantic_task") or {})}
    out["session_thread"] = {**base["session_thread"], **dict(raw.get("session_thread") or {})}
    out["narrative"] = {**base["narrative"], **dict(raw.get("narrative") or {})}
    task_context = {**base["task_context"], **dict(raw.get("task_context") or {})}
    task_context["signals"] = {**base["task_context"]["signals"], **dict(task_context.get("signals") or {})}
    out["task_context"] = task_context
    if not isinstance(out.get("recent_failures"), list):
        out["recent_failures"] = []
    if not isinstance(out.get("recent_days"), list):
        out["recent_days"] = []
    if not isinstance(out["semantic_task"].get("changed_files"), list):
        out["semantic_task"]["changed_files"] = []
    if not isinstance(out["semantic_task"].get("tools_used"), list):
        out["semantic_task"]["tools_used"] = []
    if not isinstance(out["semantic_task"].get("criteria"), list):
        out["semantic_task"]["criteria"] = []
    if not isinstance(out["session_thread"].get("timeline"), list):
        out["session_thread"]["timeline"] = []
    if not isinstance(out["narrative"].get("recent_lines"), list):
        out["narrative"]["recent_lines"] = []
    return out


def load_memory(base_dir: str | Path | None = None, now: datetime | None = None) -> dict[str, Any]:
    path = memory_path(base_dir)
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default_memory(now)
    memory = merge_memory(raw, now)
    _clear_stale_semantic_task_after_idle(memory, now)
    memory["expression"] = derive_expression(memory)
    memory["phase"] = derive_phase(memory, now)
    memory["insight"] = derive_insight(memory)
    memory["narrative"] = derive_narrative(memory)
    memory["task_context"] = derive_task_context(memory)
    return memory


def save_memory(memory: dict[str, Any], base_dir: str | Path | None = None, now: datetime | None = None) -> dict[str, Any]:
    merged = merge_memory(memory, now)
    _clear_stale_semantic_task_after_idle(merged, now)
    merged["expression"] = derive_expression(merged)
    merged["phase"] = derive_phase(merged, now)
    merged["insight"] = derive_insight(merged)
    merged["narrative"] = derive_narrative(merged)
    merged["task_context"] = derive_task_context(merged)
    path = memory_path(base_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(merged, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(path)
    return merged


def rotate_memory_day(memory: dict[str, Any], now: datetime | None = None) -> dict[str, Any]:
    merged = merge_memory(memory, now)
    today = today_key(now)
    if merged["today"]["date"] != today:
        archived = _day_summary(dict(merged["today"]))
        if _day_has_activity(archived):
            merged["recent_days"] = [day for day in merged.get("recent_days", []) if isinstance(day, dict)]
            if not merged["recent_days"] or merged["recent_days"][-1].get("date") != archived.get("date"):
                merged["recent_days"].append(archived)
            merged["recent_days"] = merged["recent_days"][-7:]
        merged["today"] = {**default_memory(now)["today"], "date": today}
    _clear_stale_semantic_task_after_idle(merged, now)
    merged["expression"] = derive_expression(merged)
    merged["phase"] = derive_phase(merged, now)
    merged["insight"] = derive_insight(merged)
    merged["narrative"] = derive_narrative(merged)
    merged["task_context"] = derive_task_context(merged)
    return merged


def _parse_iso(value: Any) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        return datetime.fromisoformat(text)
    except Exception:
        return None


def _clear_stale_semantic_task_after_idle(memory: dict[str, Any], now: datetime | None = None) -> bool:
    task = memory.get("semantic_task")
    today = memory.get("today")
    if not isinstance(task, dict) or not isinstance(today, dict):
        return False

    status = str(task.get("status") or "").strip().lower()
    if status not in {"active", "blocked"} and not bool(task.get("active")):
        return False

    task_updated = _parse_iso(task.get("updated_at") or task.get("started_at"))
    last_idle = _parse_iso(today.get("last_idle_at"))
    if task_updated is None or last_idle is None or last_idle < task_updated:
        return False

    task["status"] = "completed"
    task["active"] = False
    task["needs_user"] = False
    task["blocker_type"] = ""
    task["blocker_detail"] = ""
    task["next_action"] = ""
    task["completed_at"] = task.get("completed_at") or today.get("last_idle_at") or iso_now(now)
    task["updated_at"] = iso_now(now)

    narrative = {**default_memory(now)["narrative"], **dict(memory.get("narrative") or {})}
    narrative["need_line"] = ""
    narrative["next_line"] = ""
    narrative["updated_at"] = iso_now(now)
    memory["narrative"] = narrative
    return True


def _minutes_between(start_value: Any, end_value: Any) -> float:
    start_dt = _parse_iso(start_value)
    end_dt = _parse_iso(end_value)
    if start_dt is None or end_dt is None:
        return 0.0
    delta = (end_dt - start_dt).total_seconds() / 60.0
    return max(0.0, delta)


def _day_summary(day: dict[str, Any]) -> dict[str, Any]:
    return {
        "date": str(day.get("date") or ""),
        "tasks_started": int(day.get("tasks_started") or 0),
        "tasks_completed": int(day.get("tasks_completed") or 0),
        "long_running_seen": int(day.get("long_running_seen") or 0),
        "approval_waits": int(day.get("approval_waits") or 0),
        "review_waits": int(day.get("review_waits") or 0),
        "night_marked": bool(day.get("night_marked")),
        "session_count": int(day.get("session_count") or 0),
        "session_resumes": int(day.get("session_resumes") or 0),
        "greeted": bool(day.get("greeted")),
        "wrapped_up": bool(day.get("wrapped_up")),
        "late_night_cared": bool(day.get("late_night_cared")),
    }


def _day_has_activity(day: dict[str, Any]) -> bool:
    return any(
        (
            int(day.get("tasks_started") or 0) > 0,
            int(day.get("tasks_completed") or 0) > 0,
            int(day.get("approval_waits") or 0) > 0,
            int(day.get("review_waits") or 0) > 0,
            int(day.get("long_running_seen") or 0) > 0,
            int(day.get("session_count") or 0) > 0,
            bool(day.get("night_marked")),
        )
    )


def _dominant_bias(memory: dict[str, Any]) -> str:
    bias = dict(memory.get("work_style_bias") or {})
    best_key = ""
    best_value = -1
    for key, value in bias.items():
        score = int(value or 0)
        if score > best_value:
            best_key = str(key)
            best_value = score
    return best_key if best_value > 0 else ""


def _recent_activity_days(memory: dict[str, Any]) -> list[dict[str, Any]]:
    days = [day for day in memory.get("recent_days", []) if isinstance(day, dict)]
    today = _day_summary(dict(memory.get("today") or {}))
    if _day_has_activity(today):
        if not days or days[-1].get("date") != today.get("date"):
            days = [*days, today]
        else:
            days[-1] = today
    return days[-14:]


def _night_streak(days: list[dict[str, Any]]) -> int:
    streak = 0
    for day in reversed(days):
        if bool(day.get("night_marked")):
            streak += 1
            continue
        if _day_has_activity(day):
            break
    return streak


def derive_expression(memory: dict[str, Any]) -> dict[str, Any]:
    days = _recent_activity_days(memory)
    last3 = days[-3:]
    last7 = days[-7:]
    approval_waits_3d = sum(int(day.get("approval_waits") or 0) for day in last3)
    review_waits_3d = sum(int(day.get("review_waits") or 0) for day in last3)
    tasks_completed_3d = sum(int(day.get("tasks_completed") or 0) for day in last3)
    night_days_7d = sum(1 for day in last7 if bool(day.get("night_marked")))
    night_streak = _night_streak(days)
    approval_heavy = approval_waits_3d >= 3 or int(memory.get("approval_wait_count") or 0) >= 5
    failure_heavy = int(memory.get("consecutive_failures") or 0) >= 2
    steady_recent = tasks_completed_3d >= 3 and not failure_heavy
    dominant_bias = _dominant_bias(memory)

    summary_key = "warming_up"
    tone = "warming_up"
    if failure_heavy:
        summary_key = "failure_recovery"
        tone = "reassuring"
    elif approval_heavy and night_streak >= 2:
        summary_key = "night_approval_push"
        tone = "caring"
    elif night_streak >= 2 and steady_recent:
        summary_key = "steady_night_owl"
        tone = "steady"
    elif approval_heavy:
        summary_key = "approval_heavy"
        tone = "caring"
    elif steady_recent:
        summary_key = "steady_progress"
        tone = "steady"
    elif night_days_7d >= 2:
        summary_key = "night_owl"
        tone = "caring"
    elif dominant_bias == "trial_and_error":
        summary_key = "trial_and_error"
        tone = "reassuring"
    elif dominant_bias == "approval_magnet":
        summary_key = "approval_heavy"
        tone = "caring"
    elif dominant_bias == "steady_worker":
        summary_key = "steady_progress"
        tone = "steady"
    elif dominant_bias == "late_night_builder":
        summary_key = "night_owl"
        tone = "caring"

    return {
        "tone": tone,
        "summary_key": summary_key,
        "night_streak": night_streak,
        "night_days_7d": night_days_7d,
        "approval_waits_3d": approval_waits_3d,
        "review_waits_3d": review_waits_3d,
        "tasks_completed_3d": tasks_completed_3d,
        "approval_heavy": approval_heavy,
        "failure_heavy": failure_heavy,
        "steady_recent": steady_recent,
        "dominant_bias": dominant_bias,
    }


def derive_phase(memory: dict[str, Any], now: datetime | None = None) -> dict[str, Any]:
    today = dict(memory.get("today") or {})
    expression = dict(memory.get("expression") or derive_expression(memory))
    tasks_started = int(today.get("tasks_started") or 0)
    tasks_completed = int(today.get("tasks_completed") or 0)
    approval_waits = int(today.get("approval_waits") or 0)
    review_waits = int(today.get("review_waits") or 0)
    long_running_seen = int(today.get("long_running_seen") or 0)
    session_resumes = int(today.get("session_resumes") or 0)
    wrapped_up = bool(today.get("wrapped_up"))
    active_end = today.get("last_active_at") or today.get("last_idle_at") or iso_now(now)
    active_start = today.get("last_session_open_at") or today.get("first_active_at")
    active_minutes = round(_minutes_between(active_start, active_end), 2)
    idle_gap_minutes = None
    if today.get("last_idle_at") and today.get("last_active_at"):
        last_idle_dt = _parse_iso(today.get("last_idle_at"))
        last_active_dt = _parse_iso(today.get("last_active_at"))
        if last_idle_dt and last_active_dt and last_idle_dt >= last_active_dt:
            idle_gap_minutes = round(_minutes_between(today.get("last_idle_at"), iso_now(now)), 2)
    blocking_pressure = approval_waits + review_waits

    rhythm = "steady_flow"
    if int(memory.get("consecutive_failures") or 0) >= 2:
        rhythm = "trial_loop"
    elif session_resumes > 0 and tasks_started > 0:
        rhythm = "return_after_idle"
    elif approval_waits >= 2 or review_waits >= 1:
        rhythm = "approval_fragmented"
    elif long_running_seen > 0 or active_minutes >= 45 or (tasks_started - tasks_completed) >= 2:
        rhythm = "long_haul"

    session_phase = "warmup"
    if wrapped_up:
        session_phase = "wrap_up"
    elif idle_gap_minutes is not None:
        session_phase = "cooldown" if idle_gap_minutes < 30 else "wrap_up"
    elif blocking_pressure > 0:
        session_phase = "blocked"
    elif active_minutes >= 20 or long_running_seen > 0 or tasks_started >= 3:
        session_phase = "deep_work"
    elif tasks_started > 0:
        session_phase = "warmup"

    stance = "push"
    if session_phase in {"cooldown", "wrap_up"}:
        stance = "close"
    elif session_phase == "blocked":
        stance = "guard"
    elif rhythm == "trial_loop" or bool(expression.get("failure_heavy")):
        stance = "soothe"
    elif session_phase == "deep_work":
        stance = "quiet"

    noise_budget = "medium"
    if stance in {"quiet", "close", "soothe"}:
        noise_budget = "low"
    elif stance == "guard":
        noise_budget = "medium"
    if bool(expression.get("night_streak")) and session_phase in {"deep_work", "wrap_up", "cooldown"}:
        noise_budget = "low"

    return {
        "session_phase": session_phase,
        "rhythm": rhythm,
        "stance": stance,
        "noise_budget": noise_budget,
        "active_minutes": active_minutes,
        "idle_gap_minutes": idle_gap_minutes,
        "blocking_pressure": blocking_pressure,
    }


def derive_insight(memory: dict[str, Any]) -> dict[str, Any]:
    days = _recent_activity_days(memory)
    last3 = days[-3:]
    last7 = days[-7:]
    last14 = days[-14:]

    tasks_completed_3d = sum(int(day.get("tasks_completed") or 0) for day in last3)
    tasks_completed_7d = sum(int(day.get("tasks_completed") or 0) for day in last7)
    tasks_completed_14d = sum(int(day.get("tasks_completed") or 0) for day in last14)
    approval_waits_7d = sum(int(day.get("approval_waits") or 0) for day in last7)
    review_waits_7d = sum(int(day.get("review_waits") or 0) for day in last7)
    long_running_7d = sum(int(day.get("long_running_seen") or 0) for day in last7)
    night_days_14d = sum(1 for day in last14 if bool(day.get("night_marked")))
    session_count_7d = sum(int(day.get("session_count") or 0) for day in last7)
    wrapped_days_7d = sum(1 for day in last7 if bool(day.get("wrapped_up")))
    wrap_rate_7d = round((wrapped_days_7d / len(last7)), 2) if last7 else 0.0
    consecutive_failures = int(memory.get("consecutive_failures") or 0)
    expression = dict(memory.get("expression") or derive_expression(memory))
    phase = dict(memory.get("phase") or derive_phase(memory))

    trend_key = "warming_up"
    if consecutive_failures >= 2:
        trend_key = "recovery_loop"
    elif night_days_14d >= 5:
        trend_key = "night_load"
    elif approval_waits_7d >= 6 or review_waits_7d >= 4:
        trend_key = "approval_drag"
    elif tasks_completed_7d >= 8 and long_running_7d >= 2:
        trend_key = "deepening"
    elif tasks_completed_7d >= 6:
        trend_key = "steady_gain"
    elif session_count_7d >= 10 and tasks_completed_7d <= 3:
        trend_key = "fragmented"

    risk_key = "none"
    if night_days_14d >= 6:
        risk_key = "sleep_debt"
    elif consecutive_failures >= 2:
        risk_key = "failure_spike"
    elif approval_waits_7d >= 8:
        risk_key = "approval_drag"
    elif wrap_rate_7d < 0.35 and session_count_7d >= 5:
        risk_key = "unfinished_tail"
    elif long_running_7d >= 4 and tasks_completed_7d <= 2:
        risk_key = "stalled_load"

    pattern_key = "early_ramp"
    if str(phase.get("rhythm") or "") == "trial_loop" or trend_key == "recovery_loop":
        pattern_key = "retry_spiral"
    elif str(phase.get("rhythm") or "") == "approval_fragmented" or trend_key == "approval_drag":
        pattern_key = "approval_bound"
    elif trend_key == "night_load":
        pattern_key = "night_push"
    elif str(phase.get("rhythm") or "") == "return_after_idle":
        pattern_key = "stop_start"
    elif str(phase.get("session_phase") or "") == "deep_work" or trend_key == "deepening":
        pattern_key = "deep_focus"
    elif trend_key == "steady_gain" or bool(expression.get("steady_recent")):
        pattern_key = "steady_cadence"

    return {
        "trend_key": trend_key,
        "risk_key": risk_key,
        "pattern_key": pattern_key,
        "summary": trend_key,
        "tasks_completed_7d": tasks_completed_7d,
        "tasks_completed_14d": tasks_completed_14d,
        "approval_waits_7d": approval_waits_7d,
        "review_waits_7d": review_waits_7d,
        "long_running_7d": long_running_7d,
        "night_days_14d": night_days_14d,
        "wrap_rate_7d": wrap_rate_7d,
    }


def derive_narrative(memory: dict[str, Any]) -> dict[str, Any]:
    semantic = dict(memory.get("semantic_task") or {})
    phase = dict(memory.get("phase") or derive_phase(memory))
    insight = dict(memory.get("insight") or derive_insight(memory))
    context = dict(memory.get("task_context") or derive_task_context(memory))

    title = _session_text(semantic.get("title") or "", 160)
    step = _session_text(semantic.get("step") or "", 180)
    summary = _session_text(semantic.get("summary") or "", 180)
    next_action = _session_text(semantic.get("next_action") or "", 180)
    blocker_detail = _session_text(semantic.get("blocker_detail") or "", 180)
    blocker_type = _session_text(semantic.get("blocker_type") or "", 80)
    status = str(semantic.get("status") or "idle").strip()
    kind = str(semantic.get("kind") or context.get("category") or "general").strip()
    risk_key = str(insight.get("risk_key") or "none").strip()
    pattern_key = str(insight.get("pattern_key") or "").strip()
    rhythm = str(phase.get("rhythm") or "").strip()
    today = dict(memory.get("today") or {})
    tasks_started = int(today.get("tasks_started") or 0)
    tasks_completed = int(today.get("tasks_completed") or 0)
    approval_waits = int(today.get("approval_waits") or 0)
    review_waits = int(today.get("review_waits") or 0)
    session_count = int(today.get("session_count") or 0)

    focus_line = title or summary or step
    if step and title:
        focus_line = f"{title} · {step}"
    elif summary and title and summary != title:
        focus_line = f"{title} · {summary}"

    need_line = next_action or blocker_detail
    if not need_line and blocker_type:
        need_line = blocker_type.replace("_", " ").strip()

    status_map = {
        "active": "推进中",
        "blocked": "受阻中",
        "completed": "已完成",
        "failed": "恢复中",
        "idle": "待命中",
    }
    status_line = status_map.get(status, "推进中")
    if status == "blocked" and blocker_type:
        status_line = f"受阻中 · {blocker_type.replace('_', ' ')}"
    elif status == "active" and kind:
        status_line = f"推进中 · {kind.replace('_', ' ')}"

    recent_line = ""
    if risk_key == "approval_drag":
        recent_line = "最近多次卡在审批或拍板位。"
    elif risk_key == "sleep_debt":
        recent_line = "最近夜战偏多，节奏负荷较高。"
    elif str(phase.get("rhythm") or "") == "trial_loop":
        recent_line = "当前更像试错恢复段。"
    elif focus_line:
        recent_line = "当前主线已进入持续推进。"

    day_parts = []
    if tasks_completed > 0:
        day_parts.append(f"收了 {tasks_completed} 件")
    if tasks_started > tasks_completed:
        day_parts.append(f"推进过 {tasks_started - tasks_completed} 段未收口任务")
    if approval_waits > 0 or review_waits > 0:
        day_parts.append(f"遇到 {approval_waits} 次等待 / {review_waits} 次拍板")
    if not day_parts and session_count > 0:
        day_parts.append(f"开过 {session_count} 段陪跑")
    day_line = "今日主线：" + "，".join(day_parts) + "。" if day_parts else "今日还没有形成明显主线。"

    risk_line = ""
    if risk_key == "approval_drag":
        risk_line = "最近审批/拍板位偏多，我会优先守这些断点。"
    elif risk_key == "sleep_debt":
        risk_line = "最近夜战偏多，我会收住声但保留关键提醒。"
    elif risk_key == "failure_spike":
        risk_line = "最近失败反馈偏密，我会偏安抚，帮你收窄下一步。"
    elif risk_key == "unfinished_tail":
        risk_line = "最近有些尾巴未收，我会提醒你做收口。"
    elif risk_key == "stalled_load":
        risk_line = "最近长时间推进但产出偏少，我会帮你看住卡点。"
    elif pattern_key == "deep_focus" or rhythm == "long_haul":
        risk_line = "现在更像深水区，我会少打断，只报关键节点。"

    if status == "blocked":
        thread_line = f"等你处理：{focus_line or status_line}"
        if need_line:
            thread_line += f"；下一步看 {need_line}"
        thread_line += "。"
    elif status == "completed":
        thread_line = f"这轮已收住：{focus_line or summary or title or '当前任务'}。"
    elif status == "failed":
        thread_line = f"这轮没完全过：{focus_line or summary or title or '当前任务'}。"
        if need_line:
            thread_line += f" 下一步可以先看 {need_line}。"
    elif status == "active":
        thread_line = f"正在推进：{focus_line or kind.replace('_', ' ')}"
        if need_line:
            thread_line += f"；下一步看 {need_line}"
        thread_line += "。"
    else:
        thread_line = recent_line or day_line

    next_line = ""
    if status == "blocked" and need_line:
        next_line = f"下一步需要你处理：{need_line}"
    elif need_line:
        next_line = f"下一步：{need_line}"

    return {
        "focus_line": focus_line[:220],
        "need_line": need_line[:220],
        "status_line": status_line[:120],
        "recent_line": recent_line[:220],
        "thread_line": thread_line[:220],
        "day_line": day_line[:220],
        "risk_line": risk_line[:220],
        "next_line": next_line[:220],
        "recent_lines": list(memory.get("narrative", {}).get("recent_lines") or [])[:5],
        "updated_at": str(semantic.get("updated_at") or "") or None,
    }


def _semantic_narrative_recent_line(event_type: str, semantic: dict[str, Any]) -> str:
    title = _session_text(
        semantic.get("intent") or semantic.get("title") or semantic.get("step") or "",
        160,
    )
    summary = _session_text(semantic.get("summary") or "", 180)
    need = _session_text(semantic.get("next_action") or semantic.get("blocker_detail") or "", 180)
    blocker = _session_text(semantic.get("blocker_detail") or semantic.get("blocker_type") or "", 180)
    if event_type == "task_started":
        return f"开咗头：{title}" if title else ""
    if event_type == "task_progress":
        if summary and title and summary != title:
            return f"推进到：{summary}"
        if title:
            return f"跟到：{title}"
        return f"跟到：{need}" if need else ""
    if event_type == "task_blocked":
        if need:
            return f"卡住：{need}"
        if blocker:
            return f"卡住：{blocker}"
        return f"卡住：{title}" if title else ""
    if event_type == "task_resumed":
        return f"续返：{title}" if title else ""
    if event_type == "task_completed":
        if summary:
            return f"收住：{summary}"
        return f"收住：{title}" if title else ""
    if event_type == "task_failed":
        if summary:
            return f"受阻：{summary}"
        if need:
            return f"受阻：{need}"
        return f"受阻：{title}" if title else ""
    return ""


def _push_narrative_recent_line(memory: dict[str, Any], line: str, now: datetime | None = None) -> None:
    text = _session_text(line, 180)
    if not text:
        return
    narrative = {**default_memory(now)["narrative"], **dict(memory.get("narrative") or {})}
    recent = []
    for item in narrative.get("recent_lines", []):
        if not isinstance(item, dict):
            continue
        item_line = _session_text(item.get("line") or "", 180)
        if not item_line or item_line == text:
            continue
        clean_item = dict(item)
        clean_item["line"] = item_line
        recent.append(clean_item)
    recent.insert(0, {"line": text, "at": iso_now(now)})
    narrative["recent_lines"] = recent[:5]
    narrative["recent_line"] = text
    memory["narrative"] = narrative


def _command_family(value: Any) -> str:
    if not isinstance(value, list) or not value:
        return ""
    head = str(value[0] or "").strip()
    if not head:
        return ""
    return Path(head).name.lower()


def _extract_last_event_context(event: dict[str, Any]) -> dict[str, Any]:
    return {
        "event_type": _event_type(event),
        "source": str(event.get("source") or "").strip().lower(),
        "command_family": _command_family(event.get("command")),
        "project_id": str(event.get("project_id") or "").strip(),
        "has_action_url": bool(event.get("action_url")),
        "sender": str(event.get("sender") or "").strip().lower(),
    }


def derive_task_context(memory: dict[str, Any]) -> dict[str, Any]:
    phase = dict(memory.get("phase") or derive_phase(memory))
    event_ctx = dict(memory.get("last_event_context") or {})
    semantic = dict(memory.get("semantic_task") or {})
    event_type = str(event_ctx.get("event_type") or "")
    source = str(event_ctx.get("source") or "")
    command_family = str(event_ctx.get("command_family") or "")
    project_id = str(event_ctx.get("project_id") or "")
    has_action_url = bool(event_ctx.get("has_action_url"))
    sender = str(event_ctx.get("sender") or "")
    semantic_kind = str(semantic.get("kind") or "").strip().lower()
    semantic_active = bool(semantic.get("active")) or bool(str(semantic.get("title") or "").strip()) or semantic_kind not in {"", "general"}

    coding_families = {
        "git", "python", "python3", "pytest", "uv", "npm", "pnpm", "yarn", "node",
        "cargo", "go", "make", "cmake", "docker", "kubectl", "terraform", "ansible",
        "mvn", "gradle", "java", "javac", "ruff", "mypy", "tsc", "poetry", "bundle",
        "rspec", "mix", "composer", "php", "deno",
    }
    browser_families = {
        "playwright", "chromium", "chrome", "google-chrome", "firefox", "edge",
        "selenium", "web-driver", "web", "browser",
    }

    interaction_mode = "ambient"
    if event_type in {"running", "job_started", "status", "job_finished", "job_failed", "failed"}:
        interaction_mode = "execution"
    elif event_type in {"review", "waiting", "approval_needed"}:
        interaction_mode = "blocking"
    elif event_type == "message_received":
        interaction_mode = "message"

    review_signal = event_type == "review"
    approval_signal = event_type in {"waiting", "approval_needed"} or str(phase.get("rhythm") or "") == "approval_fragmented"
    browser_signal = has_action_url or source in {"browser", "dashboard", "web"} or command_family in browser_families or sender in {"browser", "web"}
    coding_signal = command_family in coding_families or (interaction_mode == "execution" and bool(project_id) and not browser_signal)
    shell_signal = interaction_mode == "execution" and bool(command_family) and not coding_signal and not browser_signal

    category = "general"
    confidence = "low"
    if semantic_active and semantic_kind in {"coding", "review", "shell_heavy", "browser_heavy", "approval_heavy"}:
        category = semantic_kind
        confidence = "high"
    elif review_signal:
        category = "review"
        confidence = "high"
    elif approval_signal:
        category = "approval_heavy"
        confidence = "high" if event_type in {"waiting", "approval_needed"} else "medium"
    elif browser_signal:
        category = "browser_heavy"
        confidence = "high" if has_action_url or command_family in browser_families else "medium"
    elif coding_signal:
        category = "coding"
        confidence = "high" if command_family in coding_families else "medium"
    elif shell_signal:
        category = "shell_heavy"
        confidence = "medium"

    return {
        "category": category,
        "confidence": confidence,
        "interaction_mode": interaction_mode,
        "command_family": command_family,
        "source": source,
        "project_scope": "project" if project_id else "none",
        "signals": {
            "coding": coding_signal,
            "review": review_signal,
            "shell": shell_signal,
            "browser": browser_signal,
            "approval": approval_signal,
        },
    }


def _mark_active(memory: dict[str, Any], now: datetime | None = None) -> None:
    today = today_key(now)
    if memory.get("last_active_date") != today:
        memory["last_active_date"] = today
        memory["active_days"] = int(memory.get("active_days") or 0) + 1
    timestamp = iso_now(now)
    if not memory["today"].get("first_active_at"):
        memory["today"]["first_active_at"] = timestamp
    memory["today"]["last_active_at"] = timestamp
    if is_late_night_window(now) and not memory["today"].get("night_marked"):
        memory["today"]["night_marked"] = True
        memory["night_sessions"] = int(memory.get("night_sessions") or 0) + 1
        memory["work_style_bias"]["late_night_builder"] = int(memory["work_style_bias"].get("late_night_builder") or 0) + 1


def _event_type(event: dict[str, Any]) -> str:
    return str(event.get("type") or "").strip().lower().replace("-", "_")


def _semantic_text(value: Any, limit: int = 220) -> str:
    return str(value or "").strip()[:limit]


def _looks_like_diagnostic_text(text: str) -> bool:
    lowered = str(text or "").strip().lower()
    if not lowered:
        return True
    if re.search(r"\b(bubble|bridge)\b.*\b(check|visible|verified|render|test)\b", lowered):
        return True
    if re.search(r"\b(regression|guard|blocked|approval|running)\b.*\btest\b", lowered):
        return True
    if "plain resumed should not reuse stale" in lowered:
        return True
    return False


def _semantic_list(value: Any, item_limit: int = 120, count_limit: int = 12) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip()[:item_limit] for item in value[:count_limit] if str(item).strip()]


def _parse_semantic_json_text(value: Any) -> Any:
    text = str(value or "").strip()
    if not text or text[0] not in "{[":
        return None
    try:
        return json.loads(text)
    except Exception:
        return None


def _flatten_semantic_payload(value: Any, pieces: list[str], *, depth: int = 0, label: str = "") -> None:
    if len(pieces) >= 80 or depth > 4 or value is None:
        return
    if isinstance(value, dict):
        for key, item in list(value.items())[:24]:
            if item is None:
                continue
            if isinstance(item, (dict, list)):
                pieces.append(str(key))
                _flatten_semantic_payload(item, pieces, depth=depth + 1, label=str(key))
            else:
                text = _semantic_text(item, 700)
                if text:
                    pieces.append(f"{key}: {text}")
                    parsed = _parse_semantic_json_text(text)
                    if parsed is not None:
                        _flatten_semantic_payload(parsed, pieces, depth=depth + 1, label=str(key))
        return
    if isinstance(value, list):
        for item in value[:12]:
            _flatten_semantic_payload(item, pieces, depth=depth + 1, label=label)
        return
    text = _semantic_text(value, 700)
    if not text:
        return
    pieces.append(f"{label}: {text}" if label else text)
    parsed = _parse_semantic_json_text(text)
    if parsed is not None:
        _flatten_semantic_payload(parsed, pieces, depth=depth + 1, label=label)


def _semantic_progress_pieces(event: dict[str, Any]) -> list[str]:
    pieces: list[str] = []
    for key in (
        "task_status",
        "blocker_type",
        "blocker_detail",
        "task_next",
        "task_summary",
        "text",
        "task_step",
        "task_title",
        "outcome_summary",
        "approval",
        "error",
        "status",
        "message",
        "reason",
    ):
        if key in event and event.get(key) is not None:
            _flatten_semantic_payload(event.get(key), pieces, label=key)
    return pieces


def _semantic_blocking_detail_from_pieces(event: dict[str, Any], pieces: list[str]) -> str:
    preferred = next(
        (
            piece
            for piece in pieces
            if any(piece.lower().startswith(prefix) for prefix in ("error:", "approval:", "blocker:", "reason:", "message:", "status:"))
            and any(marker in piece.lower() for marker in ("blocked", "approval", "required", "clarify", "password", "login", "ask", "denied", "waiting"))
        ),
        "",
    )
    if not preferred:
        preferred = next(
            (
                piece
                for piece in pieces
                if any(marker in piece.lower() for marker in ("blocked", "approval", "required", "clarify", "password", "login", "ask", "denied", "waiting"))
            ),
            "",
        )
    return _semantic_text(
        event.get("blocker_detail")
        or event.get("task_next")
        or preferred
        or event.get("text")
        or event.get("task_summary")
        or "",
        220,
    )


def _semantic_progress_blocking_evidence(event: dict[str, Any]) -> dict[str, Any]:
    empty = {"blocked": False, "blocker_type": "", "blocker_detail": "", "task_next": ""}
    if _event_type(event) != "task_progress":
        return empty

    event_status = _semantic_text(event.get("task_status") or "", 60).lower()
    if event_status in {"blocked", "waiting", "review"}:
        status_pieces = _semantic_progress_pieces(event)
        detail = _semantic_blocking_detail_from_pieces(event, status_pieces)
        return {
            "blocked": True,
            "blocker_type": _semantic_text(event.get("blocker_type") or ("review" if event_status == "review" else "waiting"), 80),
            "blocker_detail": detail,
            "task_next": _semantic_text(event.get("task_next") or detail, 200),
        }

    pieces = _semantic_progress_pieces(event)
    haystack = "\n".join(pieces).lower()
    has_completed_approval = any(
        marker in haystack
        for marker in (
            "was approved by the user",
            "approved by the user",
            "and was approved",
            "was allowed by the user",
        )
    )
    hard_blocked = any(
        marker in haystack
        for marker in (
            "status: blocked",
            '"status": "blocked"',
            "'status': 'blocked'",
            "blocked:",
            "command denied by user",
            "do not retry this command",
            "approval_required",
            "permission_required",
        )
    )
    interactive_block = any(
        marker in haystack
        for marker in (
            "command required approval",
            "requires approval",
            "required approval",
            "approval needed",
            "waiting for approval",
            "needs user",
            "needs_user: true",
            '"needs_user": true',
            "'needs_user': true",
            "enter send - esc cancel",
            "clarify(",
            "clarify",
            "needs a password",
            "password required",
            "login required",
            "please log in",
        )
    ) or "ask " in haystack
    structured_block = bool(event.get("needs_user") or event.get("blocker_type") or event.get("blocker_detail"))

    if not structured_block and not hard_blocked and not (interactive_block and not has_completed_approval):
        return empty

    blocker_type = _semantic_text(event.get("blocker_type") or "", 80)
    if not blocker_type:
        if any(marker in haystack for marker in ("clarify(", "clarify", "ask ", "enter send - esc cancel", "needs a password", "password required", "login required", "please log in")):
            blocker_type = "clarify"
        elif any(marker in haystack for marker in ("approval", "approve", "permission", "command denied")) or bool(event.get("needs_user")):
            blocker_type = "approval"
        else:
            blocker_type = "waiting"

    detail = _semantic_blocking_detail_from_pieces(event, pieces)
    return {
        "blocked": True,
        "blocker_type": blocker_type,
        "blocker_detail": detail,
        "task_next": _semantic_text(event.get("task_next") or detail, 200),
    }


_THREAD_EVENT_TYPES = {
    "running",
    "status",
    "job_started",
    "job_finished",
    "job_failed",
    "idle",
    "failed",
    "review",
    "waiting",
    "approval_needed",
    "task_started",
    "task_progress",
    "task_blocked",
    "task_resumed",
    "task_completed",
    "task_failed",
}


def _session_text(value: Any, limit: int = 180) -> str:
    text = _semantic_text(value, 700)
    if not text:
        return ""
    parsed = _parse_semantic_json_text(text)
    if isinstance(parsed, dict):
        for key in ("summary", "message", "reason", "status"):
            candidate = _session_text(parsed.get(key), limit)
            if candidate:
                return candidate
        return ""
    if isinstance(parsed, list):
        return ""
    if text[:1] in "{[" or "{" in text or "}" in text or "[" in text or "]" in text:
        return ""
    text = next((line.strip() for line in text.splitlines() if line.strip()), text)
    text = re.sub(r"https?://\S+", "相关链接", text)
    text = re.sub(r"\b[A-Za-z]:\\[^\s]+", "相关路径", text)
    text = re.sub(r"(?<!\w)/(?:[\w.\-]+/)+[\w.\-]+", "相关路径", text)
    text = re.sub(r"\s+", " ", text).strip()
    if _looks_like_diagnostic_text(text):
        return ""
    return text[:limit].rstrip()


def _session_thread_id(now: datetime | None = None) -> str:
    compact = re.sub(r"[^0-9A-Za-z]", "", iso_now(now))
    return f"thread-{compact[:15]}"


def _session_task_id(event: dict[str, Any], semantic: dict[str, Any]) -> str:
    return _session_text(event.get("task_id") or semantic.get("task_id") or event.get("job_id") or "", 120)


def _session_waiting_needs_user(event: dict[str, Any]) -> bool:
    if bool(event.get("needs_user") or event.get("blocker_type") or event.get("blocker_detail")):
        return True
    if bool(event.get("action_url") or event.get("action_label") or event.get("action_command")):
        return True
    event_status = _session_text(event.get("task_status") or event.get("status") or "", 80).lower()
    if event_status in {"blocked", "review", "approval", "approval_needed"}:
        return True
    pieces = _semantic_progress_pieces(event)
    haystack = "\n".join(pieces).lower()
    return any(
        marker in haystack
        for marker in (
            "approval",
            "approve",
            "permission",
            "review",
            "clarify",
            "password",
            "login required",
            "needs user",
            "needs_user: true",
            '"needs_user": true',
            "enter send - esc cancel",
            "ask ",
        )
    )


def _session_thread_status(event: dict[str, Any], semantic: dict[str, Any]) -> str:
    event_type = _event_type(event)
    semantic_status = str(semantic.get("status") or "").strip().lower()
    blocker_type = str(event.get("blocker_type") or semantic.get("blocker_type") or "").strip().lower()

    if event_type in {"idle", "job_finished", "task_completed"}:
        return "completed"
    if event_type in {"failed", "job_failed", "task_failed"}:
        return "failed"
    if event_type == "review" or blocker_type == "review":
        return "review"
    if event_type in {"task_blocked", "approval_needed"}:
        return "review" if blocker_type == "review" else "blocked"
    if event_type == "waiting":
        if _session_waiting_needs_user(event):
            return "review" if blocker_type == "review" else "blocked"
        return "thinking"
    if semantic_status == "blocked" and event_type == "task_progress":
        return "review" if blocker_type == "review" else "blocked"
    if event_type in {"running", "status", "job_started", "task_started", "task_progress", "task_resumed"}:
        return "active"
    if semantic_status in {"active", "completed", "failed", "idle"}:
        return semantic_status
    return "active"


def _session_thread_title(event: dict[str, Any], semantic: dict[str, Any]) -> str:
    candidates = (
        event.get("task_title"),
        event.get("job_name"),
        semantic.get("title"),
        semantic.get("intent"),
        event.get("task_goal"),
        semantic.get("goal"),
        semantic.get("step"),
        event.get("task_summary"),
        semantic.get("summary"),
        event.get("text"),
    )
    for value in candidates:
        text = _session_text(value, 120)
        if text:
            return text
    kind = str(semantic.get("kind") or "").strip().lower()
    if kind == "coding":
        return "代码这轮任务"
    if kind == "browser_heavy":
        return "浏览器这轮任务"
    if kind == "shell_heavy":
        return "命令这轮任务"
    if kind == "review":
        return "待确认这轮任务"
    return "这轮任务"


def _session_thread_summary(event: dict[str, Any], semantic: dict[str, Any]) -> str:
    candidates = (
        event.get("outcome_summary"),
        event.get("task_summary"),
        semantic.get("summary"),
        semantic.get("step"),
        event.get("text"),
    )
    for value in candidates:
        text = _session_text(value, 160)
        if text:
            return text
    return ""


def _session_thread_need(status: str, event: dict[str, Any], semantic: dict[str, Any]) -> str:
    if status in {"completed", "thinking"}:
        return ""
    candidates: list[Any] = [
        event.get("task_next"),
        event.get("blocker_detail"),
        event.get("action_label"),
        semantic.get("next_action"),
        semantic.get("blocker_detail"),
    ]
    if event.get("action_url"):
        candidates.append("处理相关页面")
    if event.get("action_command"):
        candidates.append("确认命令执行")
    for value in candidates:
        text = _session_text(value, 160)
        if text:
            return text
    blocker_type = str(event.get("blocker_type") or semantic.get("blocker_type") or "").strip().lower()
    if status == "review" or blocker_type == "review":
        return "查看并拍板"
    if blocker_type == "clarify":
        return "补充关键信息"
    if blocker_type == "approval":
        return "确认是否继续"
    if status == "blocked":
        return "处理卡点"
    return ""


def _session_thread_blocker_type(status: str, event: dict[str, Any], semantic: dict[str, Any]) -> str:
    if status not in {"blocked", "review"}:
        return ""
    blocker_type = _session_text(event.get("blocker_type") or semantic.get("blocker_type") or "", 80).lower()
    if blocker_type:
        return blocker_type
    if status == "review":
        return "review"
    return "approval" if _session_waiting_needs_user(event) else "waiting"


def _thread_update_age_minutes(thread: dict[str, Any], now: datetime | None = None) -> float:
    updated_at = thread.get("updated_at") or thread.get("started_at")
    if not updated_at:
        return 0.0
    return _minutes_between(updated_at, iso_now(now))


def _thread_continuation_window_minutes(thread: dict[str, Any]) -> int:
    status = str(thread.get("status") or "").strip().lower()
    if status in {"blocked", "review"}:
        return THREAD_BLOCKED_WINDOW_MINUTES
    if status in {"completed", "failed", "idle"}:
        return THREAD_IDLE_WRAP_GRACE_MINUTES
    return THREAD_ACTIVE_WINDOW_MINUTES


def _thread_matches_semantic(thread: dict[str, Any], event: dict[str, Any], semantic: dict[str, Any]) -> bool:
    thread_task_id = _session_text(thread.get("task_id") or "", 120)
    event_task_id = _session_task_id(event, semantic)
    if thread_task_id and event_task_id and thread_task_id == event_task_id:
        return True
    title = _session_thread_title(event, semantic).lower()
    current = _session_text(thread.get("title") or "", 120).lower()
    if not title or not current:
        return False
    return title == current or title in current or current in title


def _should_start_new_thread(
    event: dict[str, Any],
    thread: dict[str, Any],
    semantic: dict[str, Any],
    now: datetime | None = None,
) -> bool:
    event_type = _event_type(event)
    if event_type not in _THREAD_EVENT_TYPES:
        return False
    has_thread = bool(thread.get("thread_id") or thread.get("title") or int(thread.get("event_count") or 0) > 0)
    if not has_thread:
        return event_type not in {"idle", "job_finished", "task_completed"}

    status = str(thread.get("status") or "idle").strip().lower()
    if status in {"completed", "failed", "idle"}:
        if event_type in {"running", "job_started", "task_started"}:
            return True
        if event_type in {"task_progress", "task_resumed", "task_blocked", "review", "waiting", "approval_needed"}:
            return _thread_update_age_minutes(thread, now) > THREAD_IDLE_WRAP_GRACE_MINUTES
        return False

    age_minutes = _thread_update_age_minutes(thread, now)
    if age_minutes > _thread_continuation_window_minutes(thread):
        return event_type not in {"idle", "job_finished", "task_completed", "job_failed", "task_failed", "failed"}
    if event_type == "task_started" and not _thread_matches_semantic(thread, event, semantic) and age_minutes > 5:
        return True
    return False


def _session_timeline_kind(event_type: str, previous_status: str, status: str, start_new: bool, thread: dict[str, Any]) -> str:
    if status == "completed":
        return "completed"
    if status == "failed":
        return "failed"
    if event_type == "task_resumed" or (previous_status in {"blocked", "review", "thinking"} and status == "active"):
        return "resumed"
    if status == "review":
        return "review"
    if status == "blocked":
        return "blocked"
    if status == "thinking" and previous_status != "thinking":
        return "thinking"
    if start_new or not thread.get("timeline") or event_type in {"running", "job_started", "task_started"}:
        return "started"
    return ""


def _session_timeline_line(kind: str, thread: dict[str, Any]) -> str:
    title = _session_text(thread.get("title") or "这轮任务", 120)
    need = _session_text(thread.get("need") or "", 120)
    summary = _session_text(thread.get("summary") or "", 140)
    if kind == "started":
        return f"开始：{title}"
    if kind == "thinking":
        return f"思考：{title}"
    if kind == "blocked":
        return f"卡住：{need or title}"
    if kind == "review":
        return f"待拍板：{need or title}"
    if kind == "resumed":
        return f"续返：{title}"
    if kind == "completed":
        return f"收住：{summary or title}"
    if kind == "failed":
        return f"受阻：{summary or title}"
    return ""


def _push_session_timeline(thread: dict[str, Any], kind: str, line: str, now: datetime | None = None) -> None:
    line = _session_text(line, 180)
    if not kind or not line:
        return
    timeline = []
    for item in thread.get("timeline", []):
        if not isinstance(item, dict):
            continue
        item_line = _session_text(item.get("line") or "", 180)
        if not item_line:
            continue
        clean_item = dict(item)
        clean_item["line"] = item_line
        timeline.append(clean_item)
    if timeline:
        last = timeline[-1]
        if last.get("kind") == kind and _session_text(last.get("line") or "", 180) == line:
            last["at"] = iso_now(now)
            thread["timeline"] = timeline[-5:]
            return
    timeline.append({"kind": kind, "line": line, "at": iso_now(now)})
    thread["timeline"] = timeline[-5:]


def _session_thread_wrap_line(thread: dict[str, Any]) -> str:
    status = str(thread.get("status") or "").strip().lower()
    title = _session_text(thread.get("title") or "这轮任务", 120)
    summary = _session_text(thread.get("summary") or "", 140)
    if status == "failed":
        return f"这轮未完全过：{summary or title}"
    if status == "completed":
        return f"这轮收住：{summary or title}"
    return ""


def _session_thread_from_event(event: dict[str, Any], memory: dict[str, Any], now: datetime | None = None) -> dict[str, Any]:
    event_type = _event_type(event)
    base = {**default_memory(now)["session_thread"], **dict(memory.get("session_thread") or {})}
    if event_type not in _THREAD_EVENT_TYPES:
        return base

    semantic = dict(memory.get("semantic_task") or {})
    status = _session_thread_status(event, semantic)
    start_new = _should_start_new_thread(event, base, semantic, now)
    if not base.get("thread_id") and not start_new and event_type in {"idle", "job_finished", "task_completed"}:
        return base

    timestamp = iso_now(now)
    if start_new or not base.get("thread_id"):
        base = {**default_memory(now)["session_thread"], "thread_id": _session_thread_id(now), "started_at": timestamp}

    previous_status = str(base.get("status") or "idle").strip().lower()
    title = _session_thread_title(event, semantic) or _session_text(base.get("title") or "", 120)
    summary = _session_thread_summary(event, semantic) or _session_text(base.get("summary") or "", 160)
    if summary == title:
        summary = _session_text(base.get("summary") or "", 160)
    task_id = _session_task_id(event, semantic) or _session_text(base.get("task_id") or "", 120)
    need = _session_thread_need(status, event, semantic)
    blocker_type = _session_thread_blocker_type(status, event, semantic)

    base.update(
        {
            "task_id": task_id,
            "title": title,
            "summary": summary,
            "status": status,
            "need": need,
            "blocker_type": blocker_type,
            "updated_at": timestamp,
            "event_count": int(base.get("event_count") or 0) + 1,
            "last_event_type": event_type,
        }
    )
    if status in {"completed", "failed"}:
        base["completed_at"] = timestamp
        base["need"] = "" if status == "completed" else need
        base["blocker_type"] = "" if status == "completed" else blocker_type
        base["wrap_line"] = _session_thread_wrap_line(base)
    elif status in {"active", "thinking"}:
        base["completed_at"] = None
        base["blocker_type"] = ""
        base["wrap_line"] = ""
    else:
        base["completed_at"] = None
        base["wrap_line"] = ""

    timeline_kind = _session_timeline_kind(event_type, previous_status, status, start_new, base)
    _push_session_timeline(base, timeline_kind, _session_timeline_line(timeline_kind, base), now)
    return base


def _semantic_task_from_event(event: dict[str, Any], memory: dict[str, Any], now: datetime | None = None) -> dict[str, Any]:
    base = dict(memory.get("semantic_task") or {})
    task = {**default_memory(now)["semantic_task"], **base}
    event_type = _event_type(event)
    title = _session_text(event.get("task_title") or event.get("job_name") or task.get("title") or "", 160)
    goal = _session_text(event.get("task_goal") or task.get("goal") or "", 160)
    criteria = _semantic_list(event.get("task_criteria")) or list(task.get("criteria") or [])
    summary = _session_text(event.get("task_summary") or event.get("text") or task.get("summary") or "", 240)
    step = _session_text(event.get("task_step") or task.get("step") or "", 180)
    explicit_next_action = _session_text(
        event.get("task_next")
        or event.get("action_label")
        or event.get("action_command")
        or event.get("action_url")
        or "",
        220,
    )
    next_action = explicit_next_action or _session_text(task.get("next_action") or "", 220)
    blocker_type = _session_text(event.get("blocker_type") or task.get("blocker_type") or "", 80)
    blocker_detail = _session_text(event.get("blocker_detail") or task.get("blocker_detail") or "", 220)
    task_kind = _session_text(event.get("task_kind") or task.get("kind") or "", 80).lower()
    intent = _session_text(event.get("task_intent") or "", 200)
    if not intent:
        intent = _session_text(title or summary or step or next_action or blocker_detail or task.get("intent") or "", 200)
    timestamp = iso_now(now)

    previous_status = str(task.get("status") or "idle").strip().lower()
    event_task_id = _session_text(event.get("task_id") or event.get("job_id") or "", 120)
    current_task_id = _session_text(task.get("task_id") or "", 120)
    same_task = not event_task_id or not current_task_id or event_task_id == current_task_id
    event_status = _semantic_text(event.get("task_status") or "", 60).lower()
    progress_evidence = _semantic_progress_blocking_evidence(event)
    progress_blocks = (
        event_type == "task_progress"
        and (
            event_status in {"blocked", "waiting", "review"}
            or bool(event.get("needs_user"))
            or bool(blocker_type)
            or bool(blocker_detail)
            or bool(progress_evidence["blocked"])
        )
    )

    status = previous_status or "idle"
    active = bool(task.get("active"))
    needs_user = bool(event.get("needs_user", task.get("needs_user")))

    if event_type in {"task_started", "job_started", "running", "status"}:
        if previous_status == "blocked" and same_task and event_type != "task_started":
            status = "blocked"
            needs_user = True
        else:
            status = "active"
        active = True
        if event_type in {"task_started", "job_started"} and not task.get("started_at"):
            task["started_at"] = timestamp
    elif event_type in {"task_progress"}:
        if previous_status == "blocked" and same_task:
            status = "blocked"
            needs_user = True
        elif progress_blocks:
            status = "blocked"
            needs_user = True
            if not blocker_type:
                blocker_type = str(progress_evidence.get("blocker_type") or ("approval" if bool(event.get("needs_user")) else "waiting"))
            if not blocker_detail:
                blocker_detail = _session_text(progress_evidence.get("blocker_detail") or "", 220)
            if bool(progress_evidence.get("blocked")) and not explicit_next_action:
                next_action = _session_text(progress_evidence.get("task_next") or blocker_detail or "", 220)
        else:
            status = "active"
        active = True
    elif event_type in {"task_blocked", "review", "waiting", "approval_needed"}:
        status = "blocked"
        active = True
        needs_user = True if event_type != "task_blocked" else needs_user
        if not blocker_type:
            blocker_type = "review" if event_type == "review" else "approval"
    elif event_type in {"task_resumed"}:
        status = "active"
        active = True
        task["resumed_from"] = _session_text(event.get("resumed_from") or blocker_type or task.get("resumed_from") or "", 80)
        blocker_type = ""
        blocker_detail = ""
        needs_user = False
    elif event_type in {"task_completed", "job_finished", "idle"}:
        status = "completed"
        active = False
        task["completed_at"] = timestamp
        blocker_type = ""
        blocker_detail = ""
        needs_user = False
        next_action = ""
    elif event_type in {"task_failed", "job_failed", "failed"}:
        status = "failed"
        active = False
        task["failed_at"] = timestamp

    if not task_kind:
        task_kind = str(memory.get("task_context", {}).get("category") or "general")

    if status != "blocked":
        blocker_type = ""
        blocker_detail = ""
        needs_user = False
        if event_type in {"task_started", "job_started", "task_resumed", "task_completed"} and not explicit_next_action:
            next_action = ""

    task.update(
        {
            "task_id": _session_text(event.get("task_id") or task.get("task_id") or event.get("job_id") or "", 120),
            "title": title,
            "goal": goal,
            "criteria": criteria[:8],
            "intent": intent,
            "kind": task_kind or "general",
            "status": status,
            "step": step,
            "summary": summary,
            "next_action": next_action,
            "blocker_type": blocker_type,
            "blocker_detail": blocker_detail,
            "needs_user": bool(needs_user),
            "changed_files": _semantic_list(event.get("changed_files")) or list(task.get("changed_files") or []),
            "tools_used": _semantic_list(event.get("tools_used")) or list(task.get("tools_used") or []),
            "project_id": _session_text(event.get("project_id") or task.get("project_id") or "", 120),
            "updated_at": timestamp,
            "active": active,
        }
    )
    if event_type in {"task_started", "job_started"} and not task.get("started_at"):
        task["started_at"] = timestamp
    return task


def update_memory_for_event(
    event: dict[str, Any] | None,
    *,
    base_dir: str | Path | None = None,
    now: datetime | None = None,
    save: bool = True,
) -> dict[str, Any]:
    memory = rotate_memory_day(load_memory(base_dir, now), now)
    if not isinstance(event, dict):
        return save_memory(memory, base_dir, now) if save else memory

    event_type = _event_type(event)
    memory["last_event_context"] = _extract_last_event_context(event)
    memory["semantic_task"] = _semantic_task_from_event(event, memory, now)
    if event_type in {"task_started", "task_progress", "task_blocked", "task_resumed", "task_completed", "task_failed"}:
        _push_narrative_recent_line(
            memory,
            _semantic_narrative_recent_line(event_type, dict(memory.get("semantic_task") or {})),
            now,
        )
    memory["session_thread"] = _session_thread_from_event(event, memory, now)
    progress_blocked = (
        event_type == "task_progress"
        and bool(_semantic_progress_blocking_evidence(event).get("blocked"))
    )
    active_types = {
        "running", "job_started", "review", "waiting", "approval_needed", "failed", "job_failed",
        "task_started", "task_progress", "task_blocked", "task_resumed", "task_failed",
    }
    if event_type in active_types:
        _mark_active(memory, now)

    if event_type in {"running", "job_started", "task_started"}:
        memory["today"]["tasks_started"] = int(memory["today"].get("tasks_started") or 0) + 1
    elif event_type in {"review", "waiting", "approval_needed", "task_blocked"} or progress_blocked:
        memory["approval_wait_count"] = int(memory.get("approval_wait_count") or 0) + 1
        memory["today"]["approval_waits"] = int(memory["today"].get("approval_waits") or 0) + 1
        if event_type == "review" or str(memory["semantic_task"].get("blocker_type") or "") in {"review", "approval"}:
            memory["today"]["review_waits"] = int(memory["today"].get("review_waits") or 0) + 1
        memory["work_style_bias"]["approval_magnet"] = int(memory["work_style_bias"].get("approval_magnet") or 0) + 1
    elif event_type in {"failed", "job_failed", "task_failed"}:
        memory["consecutive_failures"] = int(memory.get("consecutive_failures") or 0) + 1
        memory["work_style_bias"]["trial_and_error"] = int(memory["work_style_bias"].get("trial_and_error") or 0) + 1
        failures = list(memory.get("recent_failures") or [])
        failures.insert(0, {"at": iso_now(now), "kind": event_type})
        memory["recent_failures"] = failures[:8]
    elif event_type in {"idle", "job_finished", "task_completed"}:
        memory["today"]["tasks_completed"] = int(memory["today"].get("tasks_completed") or 0) + 1
        memory["today"]["last_idle_at"] = iso_now(now)
        memory["work_style_bias"]["steady_worker"] = int(memory["work_style_bias"].get("steady_worker") or 0) + 1
        if int(memory.get("consecutive_failures") or 0) > 0:
            memory["consecutive_failures"] = 0

    return save_memory(memory, base_dir, now) if save else memory


def snapshot_memory(base_dir: str | Path | None = None, now: datetime | None = None) -> dict[str, Any]:
    memory = rotate_memory_day(load_memory(base_dir, now), now)
    return save_memory(memory, base_dir, now)


def attach_memory_snapshot(
    event: dict[str, Any],
    *,
    base_dir: str | Path | None = None,
    now: datetime | None = None,
    update: bool = False,
) -> dict[str, Any]:
    payload = dict(event)
    snapshot = update_memory_for_event(payload, base_dir=base_dir, now=now) if update else snapshot_memory(base_dir, now)
    payload["companion_memory"] = snapshot
    return payload
