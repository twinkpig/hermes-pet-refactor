(function (global) {
  function text(value, fallback) {
    var out = String(value === undefined || value === null ? '' : value).trim();
    return out || String(fallback || '').trim();
  }

  function compact(value, limit) {
    var max = Number(limit || 120);
    var out = text(value).replace(/\s+/g, ' ');
    if (!out) return '';
    return out.length > max ? out.slice(0, Math.max(0, max - 1)).trimEnd() + '...' : out;
  }

  function readableTaskLine(value, limit) {
    var out = compact(value, limit || 120);
    if (!out) return '';
    if (/\b(bubble|bridge)\b.*\b(check|visible|verified|render|test)\b/i.test(out)) return '';
    if (/\b(regression|guard|blocked|approval|running)\b.*\btest\b/i.test(out)) return '';
    if (/plain resumed should not reuse stale/i.test(out)) return '';
    if (/[{}[\]<>]/.test(out)) return '';
    if (/https?:\/\/|ws:\/\/|^[a-z]:\\|\/home\/|\/mnt\/|\\users\\/i.test(out)) return '';
    if (/^(browser navigate|terminal|tool|apply_patch|exec_command|powershell|cmd\.exe)\b/i.test(out)) return '';
    if (/--[a-z0-9-]+|\b(pid|port|token|api[_-]?key)\b/i.test(out)) return '';
    return out;
  }

  function cleanKind(kind) {
    return text(kind, 'general').replace(/_/g, ' ');
  }

  function sentence(value, limit) {
    var out = compact(value, limit || 180);
    if (!out) return '';
    return /[。.!?！？]$/.test(out) ? out : out + '。';
  }

  function sessionThread(input) {
    var memory = input && input.memory ? input.memory : {};
    var thread = input && input.session_thread ? input.session_thread : memory.session_thread;
    return thread && typeof thread === 'object' ? thread : {};
  }

  function hasSessionThread(thread) {
    return !!(thread && (thread.thread_id || thread.title || Number(thread.event_count || 0) > 0));
  }

  function dayLine(input) {
    var today = input && input.today ? input.today : {};
    var overlayDay = input && input.overlayDay ? input.overlayDay : {};
    var completed = Number(today.tasks_completed || 0);
    var started = Number(today.tasks_started || 0);
    var approvals = Number(today.approval_waits || 0);
    var reviews = Number(today.review_waits || 0);
    var sessions = Number(overlayDay.session_count || 0);
    var parts = [];

    if (completed > 0) parts.push('收咗 ' + completed + ' 件');
    if (started > completed) parts.push('仲有 ' + Math.max(0, started - completed) + ' 段推进过');
    if (approvals > 0 || reviews > 0) parts.push('卡过 ' + approvals + ' 次等待' + (reviews > 0 ? ' / ' + reviews + ' 次拍板' : ''));
    if (!parts.length && sessions > 0) parts.push('今日已经开过 ' + sessions + ' 段陪跑');
    if (!parts.length) return '今日仲未形成明显主线，我先安静守住。';
    return '今日主线：' + parts.join('，') + '。';
  }

  function riskLine(input) {
    var insight = input && input.insight ? input.insight : {};
    var phase = input && input.phase ? input.phase : {};
    var risk = text(insight.risk_key, 'none');
    var pattern = text(insight.pattern_key, '');
    var rhythm = text(phase.rhythm, '');

    if (risk === 'sleep_debt') return '我见到最近夜战偏多，会收住声但守住提醒。';
    if (risk === 'approval_drag') return '最近审批/拍板位拖慢节奏，我会优先守这些位。';
    if (risk === 'failure_spike') return '最近失败反馈偏密，我会偏安抚，帮你收窄下一步。';
    if (risk === 'unfinished_tail') return '最近有些尾巴未收，我会提醒你别漏掉收口。';
    if (risk === 'stalled_load') return '最近有长时间推进但产出偏少的迹象，我会看住卡点。';
    if (pattern === 'deep_focus' || rhythm === 'long_haul') return '现在更像深水区，我会少打断，只报关键节点。';
    if (pattern === 'approval_bound') return '现在节奏被等待位切碎，我会帮你守住恢复点。';
    if (pattern === 'retry_spiral') return '现在像试错循环，我会帮你稳住，不急着催。';
    return '';
  }

  function statusPrefix(status, needsUser) {
    if (status === 'review') return '等你拍板';
    if (status === 'thinking') return '我谂紧';
    if (status === 'blocked') return needsUser ? '等你处理' : '卡住处理中';
    if (status === 'completed') return '这轮已收住';
    if (status === 'failed') return '这轮没完全过';
    if (status === 'active') return '正在推进';
    return '待命观察';
  }

  function threadLine(input) {
    var thread = sessionThread(input);
    if (hasSessionThread(thread)) {
      var threadStatus = text(thread.status, 'idle');
      var threadTitle = readableTaskLine(thread.title || thread.summary, 110);
      var threadNeed = readableTaskLine(thread.need, 90);
      var wrap = readableTaskLine(thread.wrap_line, 170);
      var fallbackTitle = threadTitle || '这轮任务';

      if (threadStatus === 'completed') return sentence(wrap || (threadTitle ? '这轮已收住：' + threadTitle : '这轮已收住'), 180);
      if (threadStatus === 'failed') return sentence(wrap || (threadTitle ? '这轮未完全过：' + threadTitle : '这轮未完全过'), 180);
      if (threadStatus === 'thinking') return sentence('我谂紧：' + fallbackTitle + '，暂时唔使你处理', 180);
      if (threadStatus === 'review') {
        if (threadNeed) return sentence('等你拍板：' + fallbackTitle + '；下一步看 ' + threadNeed, 180);
        return sentence('等你拍板：' + fallbackTitle, 180);
      }
      if (threadStatus === 'blocked') {
        if (threadNeed) return sentence('等你处理：' + fallbackTitle + '；下一步看 ' + threadNeed, 180);
        return sentence('等你处理：' + fallbackTitle, 180);
      }
      if (threadStatus === 'active') {
        if (threadNeed) return sentence('正在推进：' + fallbackTitle + '；下一步看 ' + threadNeed, 180);
        if (threadTitle) return sentence('正在推进：' + threadTitle, 180);
      }
    }

    var semantic = input && input.semantic ? input.semantic : {};
    var narrative = input && input.narrative ? input.narrative : {};
    var status = text(semantic.status, 'idle');
    var focus = readableTaskLine(input && input.semantic_focus, 96) || readableTaskLine(narrative.focus_line, 96) || readableTaskLine(semantic.title || semantic.summary || semantic.step, 96);
    var need = readableTaskLine(input && input.semantic_need, 88) || readableTaskLine(narrative.need_line || semantic.next_action || semantic.blocker_detail, 88);
    var prefix = statusPrefix(status, !!semantic.needs_user);

    if (focus && need) return prefix + '：' + focus + '；下一步看 ' + need + '。';
    if (focus) return prefix + '：' + focus + '。';
    if (need) return prefix + '，下一步看 ' + need + '。';
    if (status === 'active') return '正在推进一段 ' + cleanKind(semantic.kind) + ' 任务，我会等关键节点再出声。';
    return '';
  }

  function nextLine(input) {
    var thread = sessionThread(input);
    if (hasSessionThread(thread)) {
      var threadStatus = text(thread.status, 'idle');
      var threadNeed = compact(thread.need, 120);
      if ((threadStatus === 'blocked' || threadStatus === 'review') && threadNeed) return '下一步需要你处理：' + threadNeed;
      if (threadStatus === 'active' && threadNeed) return '下一步：' + threadNeed;
      if (threadStatus === 'thinking') return '我还在想这一步，不需要你先处理。';
      if (threadStatus === 'failed' && threadNeed) return '下一步可以先看：' + threadNeed;
    }

    var semantic = input && input.semantic ? input.semantic : {};
    var workflowNext = compact(input && input.workflow_next, 120);
    var need = compact(input && input.semantic_need, 120);
    var status = text(semantic.status, 'idle');
    if (status === 'blocked' && need) return '下一步需要你处理：' + need;
    if (need) return '下一步：' + need;
    if (workflowNext) return '下一步：' + workflowNext;
    return '';
  }

  function recentItems(input) {
    var narrative = input && input.narrative ? input.narrative : {};
    var items = Array.isArray(narrative.recent_lines) ? narrative.recent_lines : [];
    return items.filter(function(item) {
      return item && typeof item === 'object' && text(item.line);
    }).slice(0, 4);
  }

  function timelineLine(input) {
    var thread = sessionThread(input);
    if (hasSessionThread(thread)) {
      var timeline = Array.isArray(thread.timeline) ? thread.timeline : [];
      var lines = timeline.filter(function(item) {
        return item && typeof item === 'object' && text(item.line);
      }).slice(-3).map(function(item) {
        return readableTaskLine(item.line, 58);
      }).filter(Boolean);
      if (lines.length) return lines.join(' / ');
      if (thread.wrap_line) return readableTaskLine(thread.wrap_line, 120);
    }
    var items = recentItems(input);
    if (!items.length) return '';
    return items.map(function(item) {
      return readableTaskLine(item.line, 48);
    }).filter(Boolean).join(' / ');
  }

  function bubbleLine(kind, stage, input) {
    var built = build(input || {});
    var thread = sessionThread(input || {});
    var semantic = input && input.semantic ? input.semantic : {};
    var status = hasSessionThread(thread) ? text(thread.status, 'idle') : text(semantic.status, 'idle');
    var focus = hasSessionThread(thread)
      ? readableTaskLine(thread.title || thread.summary, 62)
      : (readableTaskLine(input && input.semantic_focus, 62) || readableTaskLine(semantic.title || semantic.summary || semantic.step, 62));
    var need = hasSessionThread(thread)
      ? readableTaskLine(thread.need, 58)
      : (readableTaskLine(input && input.semantic_need, 58) || readableTaskLine(semantic.next_action || semantic.blocker_detail, 58));
    var risk = compact(built.risk_line, 86);
    var day = compact(built.day_line, 86);
    var s = Number(stage || 0);

    if (kind === 'long_running') {
      if (status === 'active' && focus && need && s >= 2) return '仲跟紧：' + focus + '。下一步会看 ' + need;
      if (status === 'active' && focus) return '仲推进紧：' + focus;
      if (risk && s >= 2) return risk;
      return '';
    }

    if (kind === 'review_care' || kind === 'waiting_care') {
      if (status !== 'blocked' && status !== 'review') return '';
      if (need && s >= 2) return '呢个位仲等你处理：' + need;
      if (need) return '等你一下：' + need;
      if (focus) return '呢个位仲卡住：' + focus;
      return built.thread_line || '';
    }

    if (kind === 'wrap_up') {
      if (status === 'completed' && focus) return '呢轮收到：' + focus;
      if (status === 'failed' && need) return '呢轮未完全过，之后先看：' + need;
      if (status === 'blocked' && need) return '呢轮仲卡喺：' + need + '。你处理完我就接返。';
      if (built.timeline_line) return '呢轮线索：' + compact(built.timeline_line, 72);
      if (day && day.indexOf('明显主线') === -1) return day;
      return built.thread_line || '';
    }

    if (kind === 'idle_nudge') {
      if (status === 'completed' && focus) return '头先做到：' + focus + '。你想继续我就接返。';
      if (status === 'blocked' && need) return '头先卡住喺：' + need + '。你一处理我就跟返。';
      if (status === 'active' && focus) return '我仲记住上一段：' + focus + '。你想继续就叫我。';
      if (risk) return risk;
      return '';
    }

    return '';
  }

  function build(input) {
    var narrative = input && input.narrative ? input.narrative : {};
    var thread = compact(threadLine(input), 180) || readableTaskLine(narrative.thread_line, 180);
    var day = compact(dayLine(input) || narrative.day_line, 180);
    var risk = compact(riskLine(input) || narrative.risk_line, 180);
    var next = compact(nextLine(input) || narrative.next_line, 180);
    var timeline = compact(timelineLine(input) || narrative.timeline_line, 220);
    var out = {
      thread_line: thread || '当前还未形成明显主线，我先安静守住。',
      day_line: day || '今日还没有形成明显主线。',
      risk_line: risk || '',
      next_line: next || '下一步先等新的任务信号。',
      timeline_line: timeline || '',
    };
    out.panel_story = out.thread_line || out.risk_line || out.day_line;
    out.panel_today = out.day_line + (out.risk_line ? ' ' + out.risk_line : '');
    out.panel_timeline = out.timeline_line || '最近还没有可读任务线索。';
    return out;
  }

  global.HermesCompanionNarrative = {
    build: build,
    bubbleLine: bubbleLine,
  };
})(window);
