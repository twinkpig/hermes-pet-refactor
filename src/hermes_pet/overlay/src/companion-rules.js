(function (global) {
  var DEFAULT_LINE_ORDER = ['insight', 'pack', 'context', 'phase', 'expression', 'preference'];
  var DEFAULT_FALLBACK_ORDER = ['stage', 'memory', 'style', 'time'];

  function text(value, fallback) {
    var out = String(value || '').trim();
    return out || String(fallback || '');
  }

  function uniqueOrder(order) {
    var seen = Object.create(null);
    var out = [];
    (Array.isArray(order) ? order : []).forEach(function(item) {
      var key = text(item);
      if (!key || seen[key]) return;
      seen[key] = true;
      out.push(key);
    });
    DEFAULT_LINE_ORDER.forEach(function(item) {
      if (seen[item]) return;
      seen[item] = true;
      out.push(item);
    });
    return out;
  }

  function lineOrderFor(routeKey, speechPolicy, input) {
    var kind = text(input && input.kind);
    if (routeKey === 'manual-quiet' || routeKey === 'deep-work-quiet') {
      return uniqueOrder(['insight', 'context', 'phase', 'expression', 'pack', 'preference']);
    }
    if (routeKey === 'blocked-guard' || routeKey === 'approval-drag' || routeKey === 'pack-guard' || routeKey === 'pack-watch') {
      if (kind === 'waiting_care' || kind === 'review_care') {
        return uniqueOrder(['insight', 'context', 'phase', 'pack', 'expression', 'preference']);
      }
      return uniqueOrder(['insight', 'phase', 'context', 'pack', 'expression', 'preference']);
    }
    if (routeKey === 'recovery-loop') {
      return uniqueOrder(['insight', 'phase', 'expression', 'pack', 'context', 'preference']);
    }
    if (routeKey === 'pack-playmate') {
      return uniqueOrder(['pack', 'insight', 'context', 'phase', 'expression', 'preference']);
    }
    if (routeKey === 'pack-celestia') {
      return uniqueOrder(['pack', 'insight', 'phase', 'context', 'expression', 'preference']);
    }
    if (routeKey === 'pack-operator') {
      return uniqueOrder(['context', 'phase', 'insight', 'pack', 'expression', 'preference']);
    }
    if (routeKey === 'wrap-up-close') {
      return uniqueOrder(['insight', 'phase', 'expression', 'pack', 'context', 'preference']);
    }
    if (speechPolicy === 'quiet') {
      return uniqueOrder(['insight', 'phase', 'context', 'expression', 'pack', 'preference']);
    }
    return DEFAULT_LINE_ORDER.slice();
  }

  function fallbackOrderFor(routeKey, speechPolicy, input) {
    var kind = text(input && input.kind);
    if (routeKey === 'manual-quiet' || routeKey === 'deep-work-quiet') {
      if (kind === 'wrap_up' || kind === 'late_night') {
        return ['time', 'memory', 'style', 'stage'];
      }
      return ['memory', 'style', 'time', 'stage'];
    }
    if (routeKey === 'blocked-guard' || routeKey === 'approval-drag') {
      if (kind === 'waiting_care' || kind === 'review_care') {
        return ['stage', 'memory', 'style', 'time'];
      }
      return ['memory', 'style', 'time', 'stage'];
    }
    if (routeKey === 'recovery-loop') {
      return ['memory', 'style', 'stage', 'time'];
    }
    if (routeKey === 'pack-playmate') {
      return ['style', 'memory', 'time', 'stage'];
    }
    if (routeKey === 'pack-celestia') {
      return ['style', 'memory', 'stage', 'time'];
    }
    if (routeKey === 'pack-operator' || routeKey === 'pack-guard' || routeKey === 'pack-watch') {
      return ['style', 'memory', 'stage', 'time'];
    }
    if (routeKey === 'wrap-up-close') {
      return ['time', 'memory', 'style', 'stage'];
    }
    if (speechPolicy === 'supportive') {
      return ['memory', 'style', 'time', 'stage'];
    }
    return DEFAULT_FALLBACK_ORDER.slice();
  }

  function evaluate(input) {
    var phase = input && input.phase ? input.phase : {};
    var insight = input && input.insight ? input.insight : {};
    var prefs = input && input.preferences ? input.preferences : {};
    var pack = input && input.pack ? input.pack : {};
    var workflow = input && input.workflow ? input.workflow : {};
    var overrides = input && input.overrides ? input.overrides : {};

    var ruleId = 'baseline-balance';
    var routeKey = 'balanced-runtime';
    var speechPolicy = 'balanced';
    var note = '当前按默认 companion 路线运行，继续跟住 phase、memory 同 context 收放。';

    if (overrides.muted || overrides.quiet_mode === 'silent') {
      ruleId = 'manual-quiet-override';
      routeKey = 'manual-quiet';
      speechPolicy = 'muted';
      note = '当前有人工静音或安静覆盖，普通陪伴会先让路，只保留必要变化。';
    } else if (text(phase.session_phase) === 'blocked' && text(phase.stance) === 'guard') {
      ruleId = 'blocked-guard';
      routeKey = 'blocked-guard';
      speechPolicy = 'guarded';
      note = '当前是阻塞守位路线，会优先保住等待位、拍板位同升级提醒。';
    } else if (text(phase.session_phase) === 'deep_work' && text(phase.noise_budget) === 'low') {
      ruleId = 'deep-work-quiet';
      routeKey = 'deep-work-quiet';
      speechPolicy = 'quiet';
      note = '当前像深潜推进，规则会优先降噪，减少非必要插嘴。';
    } else if (text(insight.risk_key) === 'sleep_debt') {
      ruleId = 'sleep-debt-care';
      routeKey = 'late-night-care';
      speechPolicy = 'supportive';
      note = '近期夜战负荷偏高，规则会偏收一点，优先关心收尾同休息。';
    } else if (text(insight.risk_key) === 'approval_drag' || text(insight.pattern_key) === 'approval_bound') {
      ruleId = 'approval-drag-guard';
      routeKey = 'approval-drag';
      speechPolicy = 'guarded';
      note = '近几日审批拖压明显，规则会优先守位、保连续提醒、少讲题外话。';
    } else if (text(phase.rhythm) === 'trial_loop' || text(insight.risk_key) === 'failure_spike') {
      ruleId = 'recovery-soothe';
      routeKey = 'recovery-loop';
      speechPolicy = 'supportive';
      note = '当前像恢复或试错循环，规则会偏安抚、偏陪拆，减少强推进。';
    } else if (text(pack.id) === 'shinchan_playmate') {
      ruleId = 'pack-shinchan-playmate';
      routeKey = 'pack-playmate';
      speechPolicy = 'engaged';
      note = '当前用活跃陪跑人格包，规则会容许更明显的陪伴感同更主动的回应。';
    } else if (text(pack.id) === 'celestia_princess') {
      ruleId = 'pack-celestia-princess';
      routeKey = 'pack-celestia';
      speechPolicy = 'gentle';
      note = '当前用宇宙公主人格包，规则会偏温柔、主动但不吵闹，帮你守住节奏同关键位。';
    } else if (text(pack.id) === 'cat_operator') {
      ruleId = 'pack-cat-operator';
      routeKey = 'pack-operator';
      speechPolicy = 'steady';
      note = '当前用安静守位人格包，规则会偏克制、偏盯位，减少碎嘴。';
    } else if (text(pack.id) === 'dragon_guard') {
      ruleId = 'pack-dragon-guard';
      routeKey = 'pack-guard';
      speechPolicy = 'guarded';
      note = '当前用稳定守位人格包，规则会优先保住关键位同稳定节奏。';
    } else if (text(pack.id) === 'onion_watcher') {
      ruleId = 'pack-onion-watch';
      routeKey = 'pack-watch';
      speechPolicy = 'alert';
      note = '当前用警醒推进人格包，规则会偏提早观察卡点同推进提醒。';
    } else if (text(workflow.checkpoint) && text(workflow.checkpoint).indexOf('收尾') !== -1) {
      ruleId = 'wrap-up-close';
      routeKey = 'wrap-up-close';
      speechPolicy = 'close';
      note = '当前已接近收尾段，规则会优先帮你确认收口，而不是再推新节奏。';
    }

    return {
      rule_id: ruleId,
      route_key: routeKey,
      speech_policy: speechPolicy,
      line_order: lineOrderFor(routeKey, speechPolicy, input),
      fallback_order: fallbackOrderFor(routeKey, speechPolicy, input),
      note: note,
      checkpoint: text(workflow.checkpoint),
      escalation: text(workflow.escalation),
      pack: text(pack.id || pack.label),
      trend: text(insight.trend_key),
      risk: text(insight.risk_key),
      session_phase: text(phase.session_phase),
      stance: text(phase.stance),
      noise_budget: text(phase.noise_budget),
      proactivity: text(prefs.proactivity),
    };
  }

  global.HermesCompanionRules = {
    evaluate: evaluate,
  };
})(window);
