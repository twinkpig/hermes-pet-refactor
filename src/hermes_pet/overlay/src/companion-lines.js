(function (global) {
  var LABELS = {
    preset: {
      quiet_operator: 'Quiet Operator',
      balanced_partner: 'Balanced Partner',
      warm_companion: 'Warm Companion',
      focused_foreman: 'Focused Foreman',
    },
    tone_balance: {
      soothing: '安抚',
      balanced: '平衡',
      pushing: '推进',
    },
    focus_mode: {
      work: '工作',
      balanced: '均衡',
      companion: '陪伴',
    },
    verbosity: {
      low: '简洁',
      medium: '正常',
      high: '多话',
    },
    session_phase: {
      warmup: '热身',
      deep_work: '深水区',
      blocked: '受阻',
      cooldown: '缓冲',
      wrap_up: '收尾',
    },
    stance: {
      push: '轻推',
      guard: '守位',
      soothe: '安抚',
      quiet: '静陪',
      close: '收陪',
    },
    rhythm: {
      steady_flow: '稳流推进',
      approval_fragmented: '审批打断',
      trial_loop: '试错循环',
      long_haul: '长程推进',
      return_after_idle: '回流返场',
    },
    noise_budget: {
      low: '低噪陪跑',
      medium: '均衡陪跑',
      high: '高触达提醒',
    },
    quiet_mode: {
      off: '正常',
      important: '重要优先',
      silent: '静音',
    },
    task_context: {
      coding: '写码调试',
      review: '拍板决位',
      shell_heavy: '命令流程',
      browser_heavy: '网页流程',
      approval_heavy: '审批等待',
      general: '一般陪跑',
    },
    style_profile: {
      steady_worker: '稳阵推进型',
      late_night_builder: '夜战推进型',
      approval_magnet: '审批缠身型',
      trial_and_error: '边试边拆型',
      settling: '热身适应型',
    },
    insight_trend: {
      warming_up: '热身中',
      steady_gain: '稳步上扬',
      deepening: '越做越深',
      approval_drag: '审批拖慢',
      fragmented: '节奏偏碎',
      night_load: '夜战偏多',
      recovery_loop: '恢复循环',
    },
    insight_risk: {
      none: '低',
      sleep_debt: '夜战负荷',
      failure_spike: '试错偏高',
      approval_drag: '审批拖压',
      unfinished_tail: '收尾偏少',
      stalled_load: '长任务停滞',
    },
    insight_pattern: {
      early_ramp: '起步铺排',
      steady_cadence: '稳节奏',
      deep_focus: '深潜专注',
      approval_bound: '审批牵引',
      stop_start: '停一停再返场',
      retry_spiral: '试错修复',
      night_push: '夜战推进',
    },
    semantic_kind: {
      planning: '拆计划',
      delegation: '派支线',
      coding: '写码调试',
      review: '拍板决位',
      shell_heavy: '命令流程',
      browser_heavy: '网页流程',
      approval_heavy: '审批等待',
      general: '一般任务',
    },
  };

  function text(value, fallback) {
    var out = String(value || '').trim();
    return out || String(fallback || '');
  }

  function label(group, value, fallback) {
    var key = text(group);
    var raw = text(value);
    var map = LABELS[key] || {};
    return map[raw] || text(raw, fallback);
  }

  function preferenceLine(input) {
    var prefs = input && input.preferences ? input.preferences : {};
    var phase = input && input.phase ? input.phase : {};
    var kind = text(input && input.kind);
    var stage = Number((input && input.stage) || 0);
    var toneBalance = text(prefs.tone_balance);
    var focusMode = text(prefs.focus_mode);
    var sessionPhase = text(phase.session_phase);

    if (toneBalance === 'soothing') {
      if (kind === 'long_running') {
        return stage >= 2
          ? '我唔会催你，呢段真系跑咗几耐，饮啖水再慢慢收窄都得呀 🤍'
          : '呢段我会偏静静地陪住你做，唔使急住交代俾我听呀 🤍';
      }
      if (kind === 'review_care' || kind === 'waiting_care') {
        return '我守住呢个位先，你慢慢谂、慢慢等都得，我唔会逼你 🤍';
      }
      if (kind === 'wrap_up') {
        return '今晚收到呢度已经够㗎喇，我会轻轻陪你收埋尾先 🌙';
      }
    }

    if (toneBalance === 'pushing') {
      if (kind === 'day_greeting') {
        return '今日一开波就上手啦，我会帮你顶住节奏，尽量唔畀你散开 👀';
      }
      if (kind === 'long_running') {
        return stage >= 2
          ? '呢段已经拉长咗，可以试下收窄下一步，唔使一次过顶晒佢 👀'
          : '我见你一路推进紧，下一步可以再落实少少，唔好畀佢散呀 👀';
      }
      if (kind === 'review_care' || kind === 'waiting_care') {
        return stage >= 2
          ? '呢个位已经挂咗一阵，可以拣个最细决定先郁返佢 👀'
          : '我守住呢个位，你一拍板或者一过批，就继续推落去 👀';
      }
    }

    if (focusMode === 'work' && sessionPhase === 'deep_work' && kind === 'wrap_up') {
      return '依段算系认真做完一轮，我会收住声陪你静静地收尾。';
    }

    if (focusMode === 'companion' && (kind === 'idle_nudge' || kind === 'day_greeting')) {
      return kind === 'day_greeting'
        ? '我今日会主动啲陪住你开工，你一郁我就跟上 🤍'
        : '我仲喺度呀，你想继续我就即刻陪返你开工 🤍';
    }

    return '';
  }

  function contextLine(input) {
    var context = input && input.context ? input.context : {};
    var kind = text(input && input.kind);
    var stage = Number((input && input.stage) || 0);
    var category = text(context.category, 'general');
    var commandFamily = text(context.command_family);

    if (category === 'coding') {
      if (kind === 'day_greeting') return '今日似系写码调试流，我会偏陪你拆位同守进度。';
      if (kind === 'long_running') {
        return stage >= 2
          ? '呢段似系埋 code / 查 bug 查得深咗，我会静静陪你收窄下一刀。'
          : '依家似系写码调试流，我会偏陪你拆位，多过催你快。';
      }
      if (kind === 'wrap_up') return '呢轮写码似乎收到尾，我会陪你静静收埋最后几步。';
      if (kind === 'idle_nudge') return '写码流静一静都正常，你想再开我就跟返你落去。';
    }

    if (category === 'shell_heavy') {
      if (kind === 'day_greeting') return commandFamily ? '今日似系 `' + commandFamily + '` 命令流，我会偏帮你守输出同步骤。' : '今日似系命令流，我会偏帮你守输出同步骤。';
      if (kind === 'long_running') return commandFamily ? '依家似系 `' + commandFamily + '` 命令跑紧，我帮你守住输出节奏。' : '依家似系命令跑紧，我帮你守住输出节奏。';
      if (kind === 'wrap_up') return '呢轮命令流似乎跑到尾，我会陪你确认收口。';
      if (kind === 'idle_nudge') return '命令流停一停都几正常，我仲会帮你记住上一轮节奏。';
    }

    if (category === 'browser_heavy') {
      if (kind === 'day_greeting') return '今日似系网页流程位，我会偏帮你望住跳转、加载同等待。';
      if (kind === 'waiting_care' || kind === 'review_care') return '依家似系网页流程位，我帮你望住跳转同等待，你慢慢拍板就得。';
      if (kind === 'long_running') return '依段似系网页/流程位拉长咗，我会偏守位同等你下一步。';
      if (kind === 'wrap_up') return '网页流程似乎收到尾，我会陪你对一对最后个状态。';
    }

    if (category === 'approval_heavy') {
      if (kind === 'day_greeting') return '今日似系审批等待流，我会偏守位、偏提醒，唔会畀你断线。';
      if (kind === 'waiting_care') return '依家明显系审批等待流，我会守住个批示位，唔会畀你断线。';
      if (kind === 'review_care') return '依家系审批带住拍板，你拣最细一步落手都得，我守住。';
      if (kind === 'wrap_up') return '今轮好多节奏都系审批拖住，收到呢度已经算稳稳接住。';
    }

    if (category === 'review') {
      if (kind === 'day_greeting') return '今日好多位似乎都会去到拍板流，我会少讲废话，偏守决定位。';
      if (kind === 'review_care') return '依下真系决定位，我会偏守拍板位，等你慢慢定。';
      if (kind === 'wrap_up') return '今轮好多位都要你拍板，收到呢度都算交代得住。';
      if (kind === 'idle_nudge') return '头先好多位都要你拍板，依家静一静都合理，我仲喺度。';
    }

    return '';
  }

  function contextNote(input) {
    var context = input && input.context ? input.context : {};
    var category = text(context.category, 'general');
    var commandFamily = text(context.command_family);

    if (category === 'coding') {
      return commandFamily
        ? '依家似系 `' + commandFamily + '` 呢类写码/调试流，我会偏陪你拆同守进度。'
        : '依家似系写码调试流，我会偏陪你拆同守进度。';
    }
    if (category === 'review') return '依家重点系决定位，我会偏守拍板位，少啲乱插嘴。';
    if (category === 'approval_heavy') return '依家似系审批等待流，我会偏守位同温柔催一下。';
    if (category === 'browser_heavy') return '依家似系网页/流程位，我会偏帮你望住跳转同等待。';
    if (category === 'shell_heavy') {
      return commandFamily
        ? '依家似系 `' + commandFamily + '` 命令流，我会偏守输出节奏。'
        : '依家似系命令流，我会偏守输出节奏。';
    }
    return '依家仲系一般陪跑流，我会继续跟住 phase 同 memory 陪你。';
  }

  function phaseLine(input) {
    var phase = input && input.phase ? input.phase : {};
    var sessionPhase = text(phase.session_phase, 'warmup');
    var stance = text(phase.stance, 'push');
    var rhythm = text(phase.rhythm, 'steady_flow');

    if (sessionPhase === 'deep_work' && stance === 'quiet') {
      return '我见你入咗深水区，会尽量静静地陪住你。';
    }
    if (sessionPhase === 'blocked' && stance === 'guard') {
      return '依家似系卡位期，我会守住等待同拍板位。';
    }
    if (sessionPhase === 'wrap_up' && stance === 'close') {
      return '你似乎开始收尾，我会陪你慢慢收工。';
    }
    if (rhythm === 'trial_loop' && stance === 'soothe') {
      return '依家似系试错循环，我会偏安抚多过催你。';
    }
    if (rhythm === 'return_after_idle') {
      return '你似系停一停再返嚟，我会用返场节奏陪你。';
    }
    return '';
  }

  function workflowHint(input) {
    var phase = input && input.phase ? input.phase : {};
    var context = input && input.context ? input.context : {};
    var sessionPhase = text(phase.session_phase, 'warmup');
    var rhythm = text(phase.rhythm, 'steady_flow');
    var category = text(context.category, 'general');

    if (sessionPhase === 'blocked' && category === 'review') {
      return '当前像拍板瓶颈，下一步多半要你定方向。';
    }
    if (sessionPhase === 'blocked' && category === 'approval_heavy') {
      return '当前像审批阻塞，下一步多半是在等授权或确认。';
    }
    if (sessionPhase === 'blocked') {
      return '当前像等待位，下一步多半要等回应或补一个决定。';
    }
    if (rhythm === 'trial_loop') {
      return '当前像试错恢复期，下一步更适合收窄方向再试。';
    }
    if (sessionPhase === 'deep_work' || rhythm === 'long_haul') {
      return '当前像长任务深潜，先让推进保持连续会更好。';
    }
    if (rhythm === 'return_after_idle') {
      return '当前像返场恢复，先接回上一段节奏会更顺。';
    }
    if (sessionPhase === 'wrap_up') {
      return '当前像收尾阶段，下一步适合确认结果同收一收尾。';
    }
    return '';
  }

  function workflowCheckpoint(input) {
    var phase = input && input.phase ? input.phase : {};
    var semantic = input && input.semantic ? input.semantic : {};
    var companionState = input && input.companionState ? input.companionState : {};
    var mode = text(input && input.mode, text(companionState.mode, 'idle'));
    var sessionPhase = text(phase.session_phase, 'warmup');
    var rhythm = text(phase.rhythm, 'steady_flow');
    var sessionOpen = !!companionState.session_open;
    var sessionAgeMinutes = Number(input && input.sessionAgeMinutes);
    var semanticStatus = text(semantic.status, 'idle');
    if (!Number.isFinite(sessionAgeMinutes)) sessionAgeMinutes = 0;

    if (semanticStatus === 'blocked') return '卡住处理中';
    if (semanticStatus === 'failed') return '恢复处理中';
    if (semanticStatus === 'completed') return '收尾中';
    if (semanticStatus === 'active') {
      if (text(semantic.step)) return '推进中';
      if (text(semantic.title)) return '执行中';
    }
    if (mode === 'review' || mode === 'waiting') return '卡住处理中';
    if (mode === 'failed') return '恢复处理中';
    if (mode === 'running') {
      if (rhythm === 'return_after_idle') return '回流恢复';
      if (sessionPhase === 'deep_work' || rhythm === 'long_haul') return '深潜推进';
      if (sessionOpen && sessionAgeMinutes < 2) return '启动中';
      return '推进中';
    }
    if (sessionPhase === 'blocked') return '卡住处理中';
    if (sessionPhase === 'wrap_up') return '收尾中';
    if (sessionPhase === 'cooldown') return '缓冲中';
    if (rhythm === 'return_after_idle') return '回流恢复';
    if (sessionPhase === 'deep_work' || rhythm === 'long_haul') return '深潜推进';
    if (sessionPhase === 'warmup') return '启动中';
    return '推进中';
  }

  function workflowEscalation(input) {
    var phase = input && input.phase ? input.phase : {};
    var semantic = input && input.semantic ? input.semantic : {};
    var companionState = input && input.companionState ? input.companionState : {};
    var mode = text(input && input.mode, text(companionState.mode, 'idle'));
    var sessionPhase = text(phase.session_phase, 'warmup');
    var rhythm = text(phase.rhythm, 'steady_flow');
    var blockingNudges = Number(companionState.blocking_nudges || 0);
    var runningNudges = Number(companionState.running_nudges || 0);
    var semanticStatus = text(semantic.status, 'idle');
    var semanticNeedsUser = !!semantic.needs_user;

    if (semanticStatus === 'blocked') {
      if (semanticNeedsUser && blockingNudges >= 2) return '明确提醒';
      if (semanticNeedsUser) return '等你处理';
      return '陪等守位';
    }
    if (semanticStatus === 'failed') return '恢复提示';
    if (semanticStatus === 'completed') return '收尾确认';
    if (mode === 'review' || mode === 'waiting') {
      if (blockingNudges >= 2) return '明确提醒';
      if (blockingNudges >= 1) return '轻催守位';
      return '陪等守位';
    }
    if (mode === 'running') {
      if (runningNudges >= 2 && sessionPhase !== 'deep_work') return '停滞提醒';
      if (runningNudges >= 1) return '轻提醒';
      return sessionPhase === 'deep_work' ? '静陪观察' : '推进观察';
    }
    if (mode === 'failed' || companionState.pending_failure_comfort) return '恢复提示';
    if (sessionPhase === 'wrap_up') return '收尾确认';
    if (rhythm === 'return_after_idle') return '返场恢复';
    if (sessionPhase === 'cooldown') return '缓冲观察';
    return '正常陪跑';
  }

  function workflowStatus(input) {
    var semantic = input && input.semantic ? input.semantic : {};
    var checkpoint = workflowCheckpoint(input);
    var escalation = workflowEscalation(input);
    var companionState = input && input.companionState ? input.companionState : {};
    var mode = text(input && input.mode, text(companionState.mode, 'idle'));
    var sessionOpen = !!companionState.session_open;
    var sessionAgeMinutes = Number(input && input.sessionAgeMinutes);
    var semanticStatus = text(semantic.status, 'idle');
    if (!Number.isFinite(sessionAgeMinutes)) sessionAgeMinutes = 0;

    if (semanticStatus === 'blocked' || semanticStatus === 'failed' || semanticStatus === 'completed') {
      if (!escalation || escalation === '正常陪跑') return checkpoint;
      return checkpoint + ' / ' + escalation;
    }
    if (mode === 'running' && sessionOpen && sessionAgeMinutes < 2) return checkpoint;
    if (!escalation || escalation === '正常陪跑') return checkpoint;
    return checkpoint + ' / ' + escalation;
  }

  function workflowNext(input) {
    var phase = input && input.phase ? input.phase : {};
    var context = input && input.context ? input.context : {};
    var semantic = input && input.semantic ? input.semantic : {};
    var workflow = input && input.workflow ? input.workflow : {};
    var companionState = input && input.companionState ? input.companionState : {};
    var sessionPhase = text(phase.session_phase, 'warmup');
    var rhythm = text(phase.rhythm, 'steady_flow');
    var category = text(context.category, 'general');
    var blockingNudges = Number(companionState.blocking_nudges || 0);
    var runningNudges = Number(companionState.running_nudges || 0);
    var mode = text(input && input.mode, text(companionState.mode, 'idle'));
    var sessionOpen = !!companionState.session_open;
    var sessionAgeMinutes = Number(input && input.sessionAgeMinutes);
    var semanticStatus = text(semantic.status, 'idle');
    if (!Number.isFinite(sessionAgeMinutes)) sessionAgeMinutes = 0;

    if (text(semantic.next_action)) return text(semantic.next_action);
    if (semanticStatus === 'blocked' && text(semantic.blocker_detail)) return text(semantic.blocker_detail);
    if (semanticStatus === 'completed') return '可以确认结果后，再慢慢收尾。';
    if (semanticStatus === 'failed') return '可以先收窄一个最细切入点，再慢慢试返。';
    if (mode === 'running' && sessionOpen && sessionAgeMinutes < 2) {
      return '先起稳头几步，我会帮你守住节奏。';
    }
    if (mode === 'review') {
      if (blockingNudges >= 2) return '可以先定最细一步方向。';
      return category === 'review' ? '等你拍板后就可以继续推进。' : '呢下多半要你先定方向。';
    }
    if (mode === 'waiting') {
      if (category === 'approval_heavy') {
        return blockingNudges >= 2 ? '值得回头确认授权、密码或批示。' : '先守住授权位，等确认落嚟。';
      }
      if (category === 'browser_heavy') return '可以望下页面仲系咪停在加载或跳转位。';
      return blockingNudges >= 2 ? '值得追一下回应或补一个确认。' : '先守住等待位，等回应返嚟。';
    }
    if (mode === 'running') {
      if (runningNudges >= 2 && sessionPhase !== 'deep_work') {
        if (category === 'shell_heavy') return '可能值得睇下最新输出有冇停住。';
        if (category === 'coding') return '可能值得睇下最新错误位或输出。';
        if (category === 'browser_heavy') return '可以确认一下页面或流程位有冇卡住。';
        return '可能值得睇下输出、批示或者流程位。';
      }
      if (sessionPhase === 'deep_work' || rhythm === 'long_haul') return '先保持连续推进，我会少啲插嘴。';
    }
    if (mode === 'failed' || rhythm === 'trial_loop') return '可以先收窄一个最细切入点，再慢慢试返。';
    if (rhythm === 'return_after_idle') return '先接返上一段最近停低嗰个位。';
    if (sessionPhase === 'wrap_up') return '可以确认结果后，再慢慢收尾。';
    return text(workflow.hint);
  }

  function insightLine(input) {
    var insight = input && input.insight ? input.insight : {};
    var trend = text(insight.trend_key, 'warming_up');
    var risk = text(insight.risk_key, 'none');
    var pattern = text(insight.pattern_key, 'early_ramp');

    if (trend === 'night_load') return '近两周夜战偏多，我会多留意你收工同休息。';
    if (trend === 'approval_drag') return '近几日审批位比较黏，我会继续偏守位同轻提醒。';
    if (trend === 'deepening') return '近几日长任务比例上升，整体更像深潜推进。';
    if (trend === 'steady_gain') return '近几日推进算稳，节奏比较成形。';
    if (trend === 'fragmented') return '近几日任务偏碎，我会帮你守返主线。';
    if (trend === 'recovery_loop') return '最近仲喺恢复段，我会偏安抚同陪你收窄。';
    if (risk === 'sleep_debt') return '近期夜战负荷偏高，我会更克制但更留意收尾。';
    if (risk === 'unfinished_tail') return '最近开得多、收得少，我会多帮你盯住收尾。';
    if (pattern === 'approval_bound') return '最近工作 pattern 偏向审批牵引，下一步通常卡在确认位。';
    return '';
  }

  function rollingMemoryLine(input) {
    var expression = input && input.expression ? input.expression : {};
    var memory = input && input.memory ? input.memory : {};
    var summaryKey = text(expression.summary_key, 'warming_up');
    var approval3d = Number(expression.approval_waits_3d || 0);
    var review3d = Number(expression.review_waits_3d || 0);
    var tasks3d = Number(expression.tasks_completed_3d || 0);
    var nightStreak = Number(expression.night_streak || 0);
    var night7d = Number(expression.night_days_7d || 0);
    var fails = Number(memory.consecutive_failures || 0);

    if (summaryKey === 'night_approval_push') {
      return '近 3 日审批 ' + approval3d + ' 次，连住 ' + Math.max(2, nightStreak) + ' 晚夜战。';
    }
    if (summaryKey === 'steady_night_owl') {
      return '近 3 日完成 ' + tasks3d + ' 单，连住 ' + Math.max(2, nightStreak) + ' 晚仲有开工。';
    }
    if (summaryKey === 'approval_heavy') {
      return '近 3 日审批 ' + approval3d + ' 次，拍板位 ' + review3d + ' 次。';
    }
    if (summaryKey === 'steady_progress') {
      return '近 3 日完成 ' + tasks3d + ' 单，节奏算稳。';
    }
    if (summaryKey === 'failure_recovery') {
      return '最近连续失手 ' + Math.max(2, fails) + ' 次，今晚会偏安抚。';
    }
    if (summaryKey === 'night_owl') {
      return '近 7 日有 ' + Math.max(2, night7d) + ' 晚夜战，我会多提醒你抖。';
    }
    if (summaryKey === 'trial_and_error') {
      return '近排试法偏多，我会用陪拆同鼓励为主。';
    }
    return '';
  }

  function expressionSummary(input) {
    var expression = input && input.expression ? input.expression : {};
    var summaryKey = text(expression.summary_key, 'warming_up');

    if (summaryKey === 'night_approval_push') {
      return '近排夜晚开工同审批都偏多，我会用体贴啲嘅口气陪住你。';
    }
    if (summaryKey === 'steady_night_owl') {
      return '近几晚都仲有开工，不过整体推进算稳，我会陪你慢慢收。';
    }
    if (summaryKey === 'approval_heavy') {
      return '最近审批同拍板位偏多，我会更主动帮你守住等待位。';
    }
    if (summaryKey === 'failure_recovery') {
      return '最近试错有啲密，我会偏安抚同低压，唔会催你。';
    }
    if (summaryKey === 'steady_progress') {
      return '近排推进几稳，我会偏轻快同收敛，唔会太嘈。';
    }
    if (summaryKey === 'night_owl') {
      return '近排夜晚活动偏多，我会偏关心休息多过催进度。';
    }
    if (summaryKey === 'trial_and_error') {
      return '最近试法比较多，我会偏陪你拆同鼓励再试。';
    }
    return '';
  }

  function decisionExplain(input) {
    var phase = input && input.phase ? input.phase : {};
    var overrides = input && input.overrides ? input.overrides : {};
    var quietMode = text(input && input.quiet_mode, 'off');
    var muted = !!(input && input.muted);
    var rule = input && input.rule ? input.rule : {};

    if (overrides.proactivity === 'high') {
      return '当前开了更主动模式，我会更早出声，但仍会跟住 phase 收放。';
    }
    if (overrides.proactivity === 'low') {
      return '当前开了更安静模式，我会放慢提醒节奏，减少插嘴。';
    }
    if (muted) {
      return '当前有静音窗口，普通陪伴气泡会先让路。';
    }
    if (quietMode === 'important') {
      return '当前只保留重要提醒，普通陪伴会主动收敛。';
    }
    if (quietMode === 'silent') {
      return '当前进入静音模式，只保留必要状态变化。';
    }
    if (text(phase.noise_budget, 'medium') === 'low' && text(phase.session_phase) === 'deep_work') {
      return '你似乎进入深度工作，我会主动降噪，减少插嘴。';
    }
    if (text(phase.session_phase) === 'blocked' && text(phase.stance) === 'guard') {
      return '你依家卡在等待或拍板位，我会提高存在感守住关键提醒。';
    }
    if (text(phase.rhythm) === 'trial_loop' && text(phase.stance) === 'soothe') {
      return '依家似系试错循环，我会偏安抚，减少催促。';
    }
    if (text(rule.note)) return text(rule.note);
    return '';
  }

  function semanticTaskLine(input) {
    var semantic = input && input.semantic ? input.semantic : {};
    var intent = text(semantic.intent);
    var title = text(semantic.title);
    var goal = text(semantic.goal);
    var step = text(semantic.step);
    var summary = text(semantic.summary);
    var status = text(semantic.status, 'idle');
    var kind = label('semantic_kind', text(semantic.kind, 'general'), '一般任务');

    if (intent) return intent;
    if (!title && !goal && !summary && !step) return '';
    if (goal && step) return goal + ' · ' + step;
    if (goal && title && title !== ('Goal · ' + goal)) return goal + ' · ' + title;
    if (goal) return 'Goal · ' + goal + (status === 'blocked' ? ' · 卡住中' : status === 'completed' ? ' · 已完成' : '');
    if (title && step) return title + ' · ' + step;
    if (title && summary && summary !== title) return title + ' · ' + summary;
    if (title) return title + (status === 'blocked' ? ' · 卡住中' : status === 'completed' ? ' · 已完成' : '');
    if (summary) return kind + ' · ' + summary;
    return step;
  }

  function semanticNeedLine(input) {
    var semantic = input && input.semantic ? input.semantic : {};
    var nextAction = text(semantic.next_action);
    var criteria = Array.isArray(semantic.criteria) ? semantic.criteria : [];
    var blockerDetail = text(semantic.blocker_detail);
    var blockerType = text(semantic.blocker_type);
    var needsUser = !!semantic.needs_user;

    if (needsUser && nextAction) return nextAction;
    if (criteria.length && !nextAction) return 'Criteria · ' + text(criteria[0]);
    if (needsUser && blockerDetail) return blockerDetail;
    if (blockerDetail && blockerType) return blockerType.replace(/_/g, ' ') + ' · ' + blockerDetail;
    if (nextAction) return nextAction;
    if (blockerType) return '卡在 ' + blockerType.replace(/_/g, ' ');
    return '';
  }

  function compactBubbleText(value, limit) {
    var max = Number(limit || 80);
    var out = text(value).replace(/\s+/g, ' ').trim();
    if (!out) return '';
    out = out.replace(/^[`"'“”‘’]+|[`"'“”‘’]+$/g, '').trim();
    if (!out) return '';
    if (out.length <= max) return out;
    return out.slice(0, Math.max(0, max - 1)).trimEnd() + '...';
  }

  function looksLikeTechnicalBubbleText(value) {
    var out = text(value);
    if (!out) return true;
    return /\b(bubble|bridge)\b.*\b(check|visible|verified|render|test)\b/i.test(out) ||
      /\b(regression|guard|blocked|approval|running)\b.*\btest\b/i.test(out) ||
      /plain resumed should not reuse stale/i.test(out) ||
      /[{}[\]<>]/.test(out) ||
      /https?:\/\//i.test(out) ||
      /file:\/\//i.test(out) ||
      /[a-z]:[\\/]/i.test(out) ||
      /(^|[\s"'])\/[\w.-]+/.test(out) ||
      /\b(browser|terminal|shell|powershell|bash|navigate|apply_patch|pytest|python|node|git|rg|sed|cat|grep|curl|wget)\b/i.test(out);
  }

  function semanticBubbleSubject(input) {
    var semantic = input && input.semantic ? input.semantic : {};
    var choices = [semantic.intent, semantic.title, semantic.goal, semantic.summary, semantic.step];
    for (var i = 0; i < choices.length; i++) {
      var line = compactBubbleText(choices[i], 36);
      if (line && !looksLikeTechnicalBubbleText(line)) return line;
    }
    var kind = text(semantic.kind, 'general');
    if (kind === 'coding') return '改代码';
    if (kind === 'review') return '看审查';
    if (kind === 'browser_heavy') return '跑网页流程';
    if (kind === 'shell_heavy') return '看命令输出';
    if (kind === 'approval_heavy') return '守审批位';
    if (kind === 'delegation') return '支线处理';
    if (kind === 'planning') return '拆步骤';
    return label('semantic_kind', kind, '一般任务');
  }

  function isFallbackBubbleSubject(subject, semantic) {
    var out = text(subject);
    var kind = text(semantic && semantic.kind, 'general');
    if (!out) return true;
    if (out === label('semantic_kind', kind, '一般任务')) return true;
    var fallbackByKind = {
      coding: '改代码',
      review: '看审查',
      browser_heavy: '跑网页流程',
      shell_heavy: '看命令输出',
      approval_heavy: '守审批位',
      delegation: '支线处理',
      planning: '拆步骤',
    };
    return out === fallbackByKind[kind];
  }

  function semanticBubbleNeed(input) {
    var semantic = input && input.semantic ? input.semantic : {};
    var choices = [semantic.next_action, semantic.blocker_detail, semantic.outcome_summary];
    for (var i = 0; i < choices.length; i++) {
      var line = compactBubbleText(choices[i], 42);
      if (line && !looksLikeTechnicalBubbleText(line)) return line;
    }
    return '';
  }

  function semanticBubbleAction(semantic, eventType) {
    var kind = text(semantic.kind, 'general');
    if (eventType === 'task_started') {
      if (kind === 'coding') return '我开始改代码。';
      if (kind === 'review') return '我开始看审查。';
      if (kind === 'browser_heavy') return '我在跑网页流程。';
      if (kind === 'shell_heavy') return '我在看命令输出。';
      if (kind === 'approval_heavy') return '我开始守审批位。';
      if (kind === 'delegation') return '我开始派支线。';
      if (kind === 'planning') return '我开始拆步骤。';
      return '我开始处理这件事。';
    }
    if (eventType === 'task_progress') {
      if (kind === 'coding') return '我继续改代码。';
      if (kind === 'review') return '我继续看审查。';
      if (kind === 'browser_heavy') return '我继续跑网页流程。';
      if (kind === 'shell_heavy') return '我继续看输出。';
      if (kind === 'approval_heavy') return '我继续守审批位。';
      if (kind === 'delegation') return '我继续跟支线。';
      if (kind === 'planning') return '我继续拆步骤。';
      return '我继续处理紧要位。';
    }
    if (eventType === 'task_resumed') return '收到，我继续推进。';
    if (eventType === 'task_blocked') return '这里卡住了。';
    if (eventType === 'task_completed') return '这轮处理完了。';
    if (eventType === 'task_failed') return '这步没过。';
    return '';
  }

  function semanticSignalLine(input) {
    var semantic = input && input.semantic ? input.semantic : {};
    var eventType = text(input && input.event_type);
    var urgency = text(input && input.urgency, '').toLowerCase();
    var action = semanticBubbleAction(semantic, eventType);
    var subject = semanticBubbleSubject(input);
    var need = semanticBubbleNeed(input);
    var summary = compactBubbleText(semantic.summary, 42);
    var outcome = compactBubbleText(semantic.outcome_summary, 42);
    var importantProgress = urgency === 'important' || urgency === 'urgent' || !!semantic.needs_user || !!text(semantic.blocker_type) || !!outcome;

    if (eventType === 'task_started') {
      if (subject && !isFallbackBubbleSubject(subject, semantic)) return action.replace('。', '') + '：' + subject;
      return action;
    }
    if (eventType === 'task_progress') {
      if (!importantProgress) return '';
      if (need) return action.replace('。', '') + '：' + need;
      if (summary && !looksLikeTechnicalBubbleText(summary)) return action.replace('。', '') + '：' + summary;
      if (subject && !isFallbackBubbleSubject(subject, semantic)) return action.replace('。', '') + '：' + subject;
      return action;
    }
    if (eventType === 'task_blocked') {
      if (need) return '要你处理一下：' + need;
      if (summary && !looksLikeTechnicalBubbleText(summary)) return '这里卡住了：' + summary;
      if (subject) return '这里卡住了：' + subject;
      return '这里卡住了，需要你处理。';
    }
    if (eventType === 'task_resumed') {
      if (subject && !isFallbackBubbleSubject(subject, semantic)) return action.replace('。', '') + '：' + subject;
      return action;
    }
    if (eventType === 'task_completed') {
      if (outcome && !looksLikeTechnicalBubbleText(outcome)) return action.replace('。', '') + '：' + outcome;
      if (summary && !looksLikeTechnicalBubbleText(summary)) return action.replace('。', '') + '：' + summary;
      if (subject && !isFallbackBubbleSubject(subject, semantic)) return action.replace('。', '') + '：' + subject;
      return action;
    }
    if (eventType === 'task_failed') {
      if (need) return '这步没过，先看：' + need;
      if (summary && !looksLikeTechnicalBubbleText(summary)) return '这步没过：' + summary;
      if (subject) return '这步没过：' + subject;
      return action;
    }
    return '';
  }

  function semanticEventLine(input) {
    return semanticSignalLine(input);
  }

  function summaryLines(input) {
    var lines = [];

    lines.push('Story: ' + text(input && input.narrative_panel_story, '当前还未形成明显主线，我先安静守住。'));
    lines.push('Need: ' + (text(input && input.thread_need, '') || text(input && input.semantic_need, '') || text(input && input.workflow_next, '')));
    lines.push('Timeline: ' + text(input && input.narrative_panel_timeline, '最近还没有可读任务线索。'));
    lines.push('Today Line: ' + text(input && input.narrative_panel_today, '今日还没有形成明显主线。'));
    lines.push('Details: ' + [
      text(input && input.profile_label, 'Balanced Partner'),
      text(input && input.pack_label, ''),
      text(input && input.context_label, '一般陪跑'),
      text(input && input.phase_label, '热身'),
      'Risk ' + text(input && input.risk_label, '低'),
    ].filter(Boolean).join(' · '));
    return lines;
  }

  function panelModel(input) {
    var actionState = input && input.actions ? input.actions : {};
    return {
      profile: text(input && input.profile_label, 'Balanced Partner'),
      pack: text(input && input.pack_label, '') + (input && input.pack_auto ? ' · Auto' : ''),
      prefs: text(input && input.prefs_short, 'medium / 平衡'),
      context: text(input && input.context_label, '一般陪跑') + ' / ' + text(input && input.context_confidence, 'low'),
      phase: text(input && input.phase_label, '热身') + ' / ' + text(input && input.stance_label, '轻推'),
      workflow: text(input && input.workflow_status, '推进中'),
      rhythm: text(input && input.rhythm_label, '稳流推进'),
      next: text(input && input.workflow_next, ''),
      workflow_line: text(input && input.workflow_status, '推进中') + ' · ' + text(input && input.workflow_next, ''),
      trend: text(input && input.trend_label, '热身中'),
      risk: text(input && input.risk_label, '低'),
      pattern: text(input && input.pattern_label, '起步铺排'),
      now: text(input && input.narrative_panel_story, '') || text(input && input.workflow_status, '推进中'),
      story: text(input && input.narrative_panel_story, ''),
      today_story: text(input && input.narrative_panel_today, ''),
      timeline: text(input && input.narrative_panel_timeline, ''),
      task: text(input && input.semantic_focus, ''),
      need: text(input && input.thread_need, '') || text(input && input.semantic_need, ''),
      need_primary: text(input && input.thread_need, '') || text(input && input.semantic_need, '') || text(input && input.workflow_next, ''),
      noise: text(input && input.noise_label, '均衡陪跑'),
      control: text(input && input.control_line, ''),
      override: text(input && input.override_line, ''),
      tone: text(input && input.tone, 'warming_up'),
      pack_note: text(input && input.pack_summary, ''),
      note: text(input && input.phase_note, ''),
      workflow_hint: text(input && input.workflow_hint, ''),
      reason: text(input && input.context_note, ''),
      explain: text(input && input.decision_explain, ''),
      summary: text(input && input.narrative_panel_story, '') || text(input && input.task_recent, '') || text(input && input.expression_summary, ''),
      insight: text(input && input.insight_line, ''),
      details_a: [
        'Profile ' + text(input && input.profile_label, 'Balanced Partner'),
        'Pack ' + text(input && input.pack_label, ''),
        'Prefs ' + text(input && input.prefs_short, 'medium / 平衡'),
      ].join(' · '),
      details_b: [
        text(input && input.context_label, '一般陪跑') + '/' + text(input && input.context_confidence, 'low'),
        text(input && input.phase_label, '热身') + '/' + text(input && input.stance_label, '轻推'),
        text(input && input.rhythm_label, '稳流推进'),
        'Risk ' + text(input && input.risk_label, '低'),
        'Tone ' + text(input && input.tone, 'warming_up'),
      ].join(' · '),
      actions: actionState,
      details_open: !!actionState.panelDetails,
      hasOverrides: !!(actionState.quiet1h || actionState.quietTonight || actionState.moreActive || actionState.moreQuiet),
    };
  }

  global.HermesCompanionLines = {
    label: label,
    preferenceLine: preferenceLine,
    contextLine: contextLine,
    contextNote: contextNote,
    phaseLine: phaseLine,
    workflowCheckpoint: workflowCheckpoint,
    workflowEscalation: workflowEscalation,
    workflowStatus: workflowStatus,
    workflowHint: workflowHint,
    workflowNext: workflowNext,
    insightLine: insightLine,
    rollingMemoryLine: rollingMemoryLine,
    expressionSummary: expressionSummary,
    decisionExplain: decisionExplain,
    semanticTaskLine: semanticTaskLine,
    semanticNeedLine: semanticNeedLine,
    semanticSignalLine: semanticSignalLine,
    semanticEventLine: semanticEventLine,
    summaryLines: summaryLines,
    panelModel: panelModel,
  };
})(window);
