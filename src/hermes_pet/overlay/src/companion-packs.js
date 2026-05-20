(function (global) {
  var REGISTRY = {
    classic_default: {
      id: 'classic_default',
      label: '平衡陪跑',
      short_label: '平衡',
      summary: '稳阵陪跑',
      proactivity_bias: 0,
      verbosity_bias: 0,
      focus_bias: 'balanced',
      tone_bias: 'balanced',
    },
    cat_operator: {
      id: 'cat_operator',
      label: '安静守位',
      short_label: '安静',
      summary: '稳阵盯位',
      proactivity_bias: 0,
      verbosity_bias: -1,
      focus_bias: 'work',
      tone_bias: 'balanced',
    },
    onion_watcher: {
      id: 'onion_watcher',
      label: '警醒推进',
      short_label: '警醒',
      summary: '守位偏警醒',
      proactivity_bias: 1,
      verbosity_bias: -1,
      focus_bias: 'work',
      tone_bias: 'pushing',
    },
    dragon_guard: {
      id: 'dragon_guard',
      label: '稳定守位',
      short_label: '稳定',
      summary: '大守位',
      proactivity_bias: 1,
      verbosity_bias: 0,
      focus_bias: 'work',
      tone_bias: 'balanced',
    },
    shinchan_playmate: {
      id: 'shinchan_playmate',
      label: '活跃陪跑',
      short_label: '活跃',
      summary: '嘴碎陪跑',
      proactivity_bias: 1,
      verbosity_bias: 1,
      focus_bias: 'companion',
      tone_bias: 'soothing',
    },
    celestia_princess: {
      id: 'celestia_princess',
      label: '宇宙公主',
      short_label: '公主',
      summary: '温柔守光',
      proactivity_bias: 1,
      verbosity_bias: 0,
      focus_bias: 'companion',
      tone_bias: 'soothing',
    },
  };

  var LINES = {
    shinchan_playmate: {
      day_greeting: ['今日都由我陪你开波啦，慢慢嚟都得，不过唔准发梦呀 😏'],
      idle_nudge: ['我仲喺度呀，你再唔郁我就当你想我继续讲嘢喇 😗'],
      wrap_up: ['做到呢度都差唔多喇，今日都算你乖，我准你抖一阵啦 😌'],
    },
    celestia_princess: {
      day_greeting: ['今日由我陪你开波啦，慢慢嚟都得，我会稳住呢道晨光 ☀️'],
      idle_nudge: ['我喺度呀，等你下一步，唔使急，我会照住你 🌤️'],
      running: ['帮紧你，帮紧你，我会温柔啲陪你一路向前 ✨'],
      running_bubble: [
        '帮紧你，帮紧你，我会温柔啲陪你一路向前 ✨',
        '帮紧你，帮紧你，我帮你照住呢段光 ☀️',
        '帮紧你，帮紧你，慢慢嚟，我陪你推到通 🌤️',
      ],
      thinking_bubble: [
        '我静静谂紧，谂清楚先再行 🌙',
        '等我用少少星光照下条路先 ✨',
        '我喺度思考紧，唔系走咗开呀 🌤️',
      ],
      thinking_long_bubble: [
        '呢步要谂耐少少，我仲喺度守住你 💛',
        '星光转紧圈，我继续帮你拆开佢 ✨',
      ],
      thinking_stalled_bubble: [
        '呢下谂得有啲耐，我继续守住，唔会消失 🌙',
        '似乎卡住咗一阵，我陪你等下个信号 ☀️',
      ],
      waiting_bubble: [
        '呢个位等你一下，我会陪你守住 🌤️',
        '你俾个信号，我就继续帮你照亮条路 ✨',
        '我企定定等你，唔催你，但我会望住 👀',
      ],
      review_bubble: [
        '等你拍板先，我帮你守住最后一格光 ☀️',
        '呢下你话事，我会温柔咁等你决定 🌙',
        '你一点头，我就继续陪你向前 ✨',
      ],
      idle_bubble: [
        '今日辛苦喇，我帮你收好呢缕光 ✨',
        '我喺度呀，你想继续就叫我 🌤️',
        '先抖一抖都得，我会守住这里 💛',
      ],
      task_resumed_bubble: ['收到，我继续帮你照住前面条路 ✨'],
      task_completed_bubble: ['呢轮收好喇，你做得好好，我帮你盖上星光印章 🌟'],
      task_failed_bubble: ['唔紧要，我陪你重新照亮呢一步 🌈'],
      long_running: ['呢段我会陪你慢慢推，记得饮啖水先继续呀 💛'],
      late_night: ['夜深都唔怕，我陪你守住尾灯，不过都要休息呀 🌙'],
      failure_comfort: ['唔紧要，呢次未完全对，我陪你再照亮返条路 🌈'],
      review_care: ['等你拍板先，我帮你守住最后一格光 ☀️'],
      waiting_care: ['呢个位我帮你望住，你慢慢等，我唔会走开 🫶'],
      wrap_up: ['今日辛苦喇，你已经做得好好，我帮你收好最后一缕光 ✨'],
    },
    cat_operator: {
      waiting_care: [
        '呢个位我帮你盯住先，你有回应再接返落去。',
        '我继续帮你盯住呢个等待位，等返个回应落嚟。',
      ],
      review_care: ['决定位我会帮你守住，你慢慢收窄都得。'],
    },
    dragon_guard: {
      waiting_care: ['呢个位我会帮你稳稳守住，你一落决定就继续推进。'],
      review_care: ['呢个位我会帮你稳稳守住，你一落决定就继续推进。'],
      long_running: ['呢段我会帮你压住阵脚，慢慢推进唔使急。'],
    },
    onion_watcher: {
      late_night: ['今晚我会继续帮你望住节奏，但都记得唔好一路烧到太夜。'],
      failure_comfort: ['失一两下都未算，我会继续陪你睇清下一步。'],
    },
  };

  function registry() {
    return REGISTRY;
  }

  function labels() {
    return {
      auto: 'Auto',
      classic_default: '平衡',
      cat_operator: '安静',
      onion_watcher: '警醒',
      dragon_guard: '稳定',
      shinchan_playmate: '活跃',
      celestia_princess: '公主',
    };
  }

  function infer(input) {
    var customName = String((input && input.custom_name) || '').toLowerCase();
    var species = String((input && input.species) || '').toLowerCase();
    if (customName.indexOf('celestia') !== -1 || customName.indexOf('princess') !== -1 || customName.indexOf('alicorn') !== -1) return 'celestia_princess';
    if (customName.indexOf('shinchan') !== -1) return 'shinchan_playmate';
    if (species === 'cat' || species === 'custom') return 'cat_operator';
    if (species === 'flame-onion') return 'onion_watcher';
    if (species === 'dragon') return 'dragon_guard';
    return 'classic_default';
  }

  function lineFor(packId, kind, stage) {
    var lines = LINES[String(packId || '')] || {};
    var pool = lines[String(kind || '')];
    if (!Array.isArray(pool) || !pool.length) return '';
    if ((kind === 'waiting_care' || kind === 'review_care') && pool.length > 1) {
      return pool[Number(stage || 0) >= 2 ? 1 : 0];
    }
    return pool[0];
  }

  function bubbleLines(packId, kind) {
    var lines = LINES[String(packId || '')] || {};
    var key = String(kind || '');
    var pool = lines[key + '_bubble'] || lines[key];
    if (!Array.isArray(pool) || !pool.length) return [];
    return pool.slice();
  }

  global.HermesCompanionPacks = {
    registry: registry,
    labels: labels,
    infer: infer,
    lineFor: lineFor,
    bubbleLines: bubbleLines,
  };
})(window);
