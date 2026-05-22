"""Hermes Pets plugin for Hermes agent lifecycle events."""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any

try:
    from websocket import create_connection as _create_ws_connection
except Exception:  # pragma: no cover - optional transport fallback
    _create_ws_connection = None

try:
    from websockets.sync.client import connect as _sync_ws_connect
except Exception:  # pragma: no cover - optional transport fallback
    _sync_ws_connect = None

logger = logging.getLogger(__name__)

_last_bubble_time: float = 0.0
_last_bubble_session: str | None = None
_BUBBLE_THROTTLE_SEC = 3.0


def _bridge_url() -> str:
    for name in ("HERMES_PET_WS_URL", "HERMES_PET_BRIDGE_URL"):
        explicit = str(os.environ.get(name, "") or "").strip()
        if explicit:
            return explicit
    host = str(os.environ.get("HERMES_PET_HOST", "") or "").strip() or _default_bridge_host()
    port = str(os.environ.get("HERMES_PET_PORT", "") or "").strip() or "17473"
    return f"ws://{host}:{port}"


def _default_bridge_host() -> str:
    if os.environ.get("WSL_DISTRO_NAME"):
        return "172.27.128.1"
    try:
        with open("/proc/version", "r", encoding="utf-8", errors="ignore") as handle:
            if "microsoft" in handle.read().lower():
                return "172.27.128.1"
    except Exception:
        pass
    return "127.0.0.1"


def _clean_text(value: Any, limit: int = 220) -> str:
    text = " ".join(str(value or "").split())
    if not text:
        return ""
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 3)].rstrip() + "..."


def _send_ws(event: dict[str, Any]) -> bool:
    payload = json.dumps(event, ensure_ascii=False, separators=(",", ":"))
    url = _bridge_url()

    if _create_ws_connection is not None:
        ws = None
        try:
            ws = _create_ws_connection(url, timeout=1.5)
            ws.send(payload)
            return True
        except Exception as exc:
            logger.debug("hermes-pet websocket-client send failed: %s", exc)
        finally:
            if ws is not None:
                try:
                    ws.close()
                except Exception:
                    pass

    if _sync_ws_connect is not None:
        ws = None
        try:
            ws = _sync_ws_connect(url, open_timeout=1.5, max_size=None)
            ws.send(payload)
            return True
        except Exception as exc:
            logger.debug("hermes-pet websockets.sync send failed: %s", exc)
        finally:
            if ws is not None:
                try:
                    ws.close()
                except Exception:
                    pass

    return False


def _approval_detail(command: str = "", description: str = "") -> str:
    return _clean_text(description, 220) or _clean_text(command, 220) or "Approval required"


def _on_pre_llm_call(session_id: str = "", user_message: str = "", **kwargs: Any) -> None:
    global _last_bubble_time, _last_bubble_session
    if not user_message:
        return
    now = time.monotonic()
    if now - _last_bubble_time < _BUBBLE_THROTTLE_SEC and _last_bubble_session == session_id:
        return
    _last_bubble_time = now
    _last_bubble_session = session_id
    _send_ws({"type": "waiting", "text": _clean_text(user_message, 40)})


def _on_post_llm_call(
    session_id: str = "",
    user_message: str = "",
    assistant_response: str = "",
    **kwargs: Any,
) -> None:
    _send_ws({
        "type": "task_completed",
        "task_status": "completed",
        "task_title": _clean_text(user_message, 80) or "Hermes turn complete",
        "outcome_summary": _clean_text(assistant_response, 220) or "Hermes turn complete",
        "session_id": _clean_text(session_id, 120),
        "source": "hermes-pet-plugin",
    })


def _on_pre_approval_request(
    command: str = "",
    description: str = "",
    session_key: str = "",
    **kwargs: Any,
) -> None:
    detail = _approval_detail(command, description)
    _send_ws({
        "type": "task_blocked",
        "task_title": "Approval needed",
        "task_kind": "approval_heavy",
        "task_status": "blocked",
        "task_step": "Awaiting approval",
        "task_summary": detail,
        "task_next": "Approve or deny the next step",
        "blocker_type": "approval",
        "blocker_detail": detail,
        "needs_user": True,
        "session_id": _clean_text(session_key, 120),
        "source": "hermes-pet-plugin",
    })


def _on_post_approval_response(
    choice: str = "",
    session_key: str = "",
    **kwargs: Any,
) -> None:
    normalized = _clean_text(choice, 40).lower()
    approved = normalized in {
        "once",
        "session",
        "always",
        "approve",
        "approved",
        "allow",
        "allowed",
        "approve_once",
        "approve_session",
        "always_approve",
    }
    if approved:
        _send_ws({
            "type": "task_resumed",
            "task_status": "active",
            "resumed_from": "approval",
            "session_id": _clean_text(session_key, 120),
            "source": "hermes-pet-plugin",
        })
        return

    outcome = "Approval timed out" if normalized == "timeout" else "Approval denied"
    _send_ws({
        "type": "task_failed",
        "task_status": "failed",
        "outcome_summary": outcome,
        "resumed_from": "approval",
        "session_id": _clean_text(session_key, 120),
        "source": "hermes-pet-plugin",
    })


def _on_session_start(session_id: str = "", **kwargs: Any) -> None:
    _send_ws({"type": "waving"})


def _on_session_end(session_id: str = "", **kwargs: Any) -> None:
    _send_ws({"type": "idle"})


def _on_session_finalize(session_id: str = "", **kwargs: Any) -> None:
    _send_ws({"type": "idle"})


def register(ctx: Any) -> None:
    ctx.register_hook("pre_llm_call", _on_pre_llm_call)
    ctx.register_hook("post_llm_call", _on_post_llm_call)
    ctx.register_hook("pre_approval_request", _on_pre_approval_request)
    ctx.register_hook("post_approval_response", _on_post_approval_response)
    ctx.register_hook("on_session_start", _on_session_start)
    ctx.register_hook("on_session_end", _on_session_end)
    ctx.register_hook("on_session_finalize", _on_session_finalize)
