/**
 * Hermes Pets Overlay Renderer
 * Receives events from the Electron bridge and updates the sprite + UI.
 */

// DOM refs
const spriteEl = document.getElementById('pet-sprite');
const nameEl = document.getElementById('pet-name');
const levelEl = document.getElementById('pet-level');
const xpFillEl = document.getElementById('xp-fill');
const statsEl = document.getElementById('pet-stats');
const bubbleEl = document.getElementById('pet-bubble');
const bubbleTextEl = document.getElementById('bubble-text');
const minBtn = document.getElementById('minimize-btn');
const connectionStatusEl = document.getElementById('connection-status');
const eventTrayEl = document.getElementById('event-tray');
const eventListEl = document.getElementById('event-list');
const eventTrayTitleEl = document.getElementById('event-tray-title');
const currentStatusEl = document.getElementById('current-status');
const eventSummaryEl = document.getElementById('event-summary');
const companionPanelEl = document.getElementById('companion-panel');
const companionSummaryEl = document.getElementById('companion-summary');
const DEBUG_EVENTS = new URLSearchParams(window.location.search).get('debugEvents') === '1';

function debugEvent(message, ...args) {
  if (DEBUG_EVENTS) console.log(`[pet-renderer/events] ${message}`, ...args);
}

// ---- Animation state machine ----
const DEBUG_ANIM = new URLSearchParams(window.location.search).get('debugAnimation') === '1';

var _petDragging = false;
var _preDragState = null;
var _tuiTargetState = null;

function _isActiveTuiState(stateName) {
  var _activeStates = ['running', 'run_left', 'run_right', 'review', 'waiting', 'failed'];
  return _activeStates.indexOf(stateName) !== -1;
}

// Restore TUI animation state if it was overridden by user interaction
function _restoreTuiTarget() {
  if (_tuiTargetState && _tuiTargetState !== 'idle') {
    if (_isActiveTuiState(_tuiTargetState) && _tuiTargetState !== animController.currentState) {
      animController.transition(_tuiTargetState);
      return true;
    }
  }
  return false;
}

const animController = {
  manifest: null,
  currentState: null,
  currentFrame: 0,
  frameTimer: null,
  species: '',
  customPet: null,
  blinkTimer: null,
  hoverActive: false,
  _playingOneShot: false,

  // Preload cache: str key -> truthy (loaded OK)
  _preloaded: Object.create(null),
  // Set of keys that failed to load (avoid retrying)
  _unavailable: Object.create(null),
  // Last src assigned to backgroundImage to avoid redundant writes
  _lastBgSrc: '',

  debugLog(msg) {
    if (DEBUG_ANIM) console.log('[pet-anim] ' + msg);
  },

  normalizeStateName(stateName) {
    var aliases = {
      'running-left': 'run_left',
      'running-right': 'run_right',
      'walk-left': 'walk_left',
      'walk-right': 'walk_right',
      'message-received': 'message_react',
      'message': 'message_react',
      'bubble': 'bubble_react',
      'thinking': 'review',
      'busy': 'waiting',
      'happy': 'jumping',
      'sad': 'failed',
      'error': 'failed',
      'offline': 'waiting'
    };
    return aliases[stateName] || stateName;
  },

  _stateAssetDir(stateName, cfg) {
    var assetDir = cfg && cfg.assetDir ? cfg.assetDir : stateName;
    if (this.customPet && this.customPet.baseUrl) {
      return this.customPet.baseUrl + '/sprites/' + assetDir + '/';
    }
    return '../assets/sprites/' + this.species + '/' + assetDir + '/';
  },

  hasStateConfig(stateName) {
    if (!this.manifest || !this.manifest.states) return false;
    stateName = this.normalizeStateName(stateName);
    var speciesStates = this.manifest.species
      && this.species
      && this.manifest.species[this.species]
      && this.manifest.species[this.species].states;
    if (this.customPet && this.customPet.manifest && this.customPet.manifest.states) {
      return !!this.customPet.manifest.states[stateName];
    }
    return !!((speciesStates && speciesStates[stateName]) || this.manifest.states[stateName]);
  },

  _preloadKey(key, src) {
    if (this._preloaded[key]) return Promise.resolve(true);
    if (this._unavailable[key]) return Promise.resolve(false);
    return new Promise(function(resolve) {
      var img = new Image();
      img.onload = function() { resolve(true); };
      img.onerror = function() { resolve(false); };
      img.src = src;
    });
  },

  _preloadFrames(stateName, cfg) {
    var self = this;
    var frames = (cfg && cfg.frames && cfg.frames.length > 0) ? cfg.frames : null;
    if (!frames) return Promise.resolve();
    var basePath = this._stateAssetDir(stateName, cfg);
    var promises = frames.map(function(f) {
      var key = stateName + '|' + f;
      var src = basePath + f;
      return self._preloadKey(key, src).then(function(ok) {
        if (ok) {
          self._preloaded[key] = true;
        } else {
          self._unavailable[key] = true;
          self.debugLog('preload FAIL: ' + src + ' (marked unavailable)');
        }
        return ok;
      });
    });
    return Promise.all(promises).then(function() {
      self.debugLog('preload complete: ' + stateName + ' frames=' + frames.length);
    });
  },

  async loadManifest() {
    try {
      // Use IPC to bypass file:// fetch restrictions in Electron with context isolation
      if (window.hermesPetAPI && window.hermesPetAPI.loadManifest) {
        this.manifest = await window.hermesPetAPI.loadManifest();
        if (this.manifest) {
          this.debugLog('manifest loaded via IPC, species: ' +
            (this.manifest.species ? Object.keys(this.manifest.species).join(', ') : '(none)') +
            ', states: ' + Object.keys(this.manifest.states || {}).join(', '));
          return;
        }
      }
      // Fallback: try fetch (works in dev without context isolation)
      var resp = await fetch('../assets/manifest.json');
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      this.manifest = await resp.json();
      this.debugLog('manifest loaded via fetch, species: ' +
        (this.manifest.species ? Object.keys(this.manifest.species).join(', ') : '(none)') +
        ', states: ' + Object.keys(this.manifest.states || {}).join(', '));
    } catch (err) {
      this.debugLog('manifest load failed: ' + err.message + ' (using CSS fallback)');
      this.manifest = null;
    }
  },

  getStateConfig(stateName) {
    if (!this.manifest || !this.manifest.states) return null;
    stateName = this.normalizeStateName(stateName);
    var speciesStates = this.manifest.species
      && this.species
      && this.manifest.species[this.species]
      && this.manifest.species[this.species].states;
    if (this.customPet && this.customPet.manifest && this.customPet.manifest.states) {
      return this.customPet.manifest.states[stateName]
        || this.customPet.manifest.states.idle
        || this.manifest.states[stateName]
        || this.manifest.states.idle
        || null;
    }
    return (speciesStates && speciesStates[stateName])
      || this.manifest.states[stateName]
      || (speciesStates && speciesStates.idle)
      || this.manifest.states.idle
      || null;
  },

  resolveFrameSrc(stateName, frameIndex) {
    if (!this.species) return '';
    var cfg = this.getStateConfig(stateName);
    var frames = cfg && cfg.frames && cfg.frames.length > 0 ? cfg.frames : null;
    if (frames) {
      var idx = frameIndex % frames.length;
      var file = frames[idx];
      return this._stateAssetDir(stateName, cfg) + file;
    }
    if (this.customPet && this.customPet.baseUrl) return '';
    return '../assets/sprites/' + this.species + '.png';
  },

  mayTransiton(stateName) {
    if (stateName === 'drag') return true;
    if (_petDragging) {
      this.debugLog('BLOCKED transition to "' + stateName + '" (dragging)');
      return false;
    }
    if (this._playingOneShot) {
      this.debugLog('BLOCKED transition to "' + stateName + '" (one-shot ' + this.currentState + ' playing)');
      return false;
    }
    return true;
  },

  transition(stateName) {
    var self = this;
    console.log('[pet] transition called:', stateName, 'currentState:', this.currentState);
    if (!this.manifest || !this.species) return;
    stateName = this.normalizeStateName(stateName);

    if (!this.mayTransiton(stateName)) return;

    var cfg = this.hasStateConfig(stateName) ? this.getStateConfig(stateName) : null;
    if (!cfg) {
      this.debugLog('unknown state "' + stateName + '", falling back to idle');
      stateName = 'idle';
      cfg = this.getStateConfig('idle');
      if (!cfg) return;
    }

    if (this.currentState === stateName && cfg.loop !== false) {
      this.debugLog('SKIP transition: already ' + stateName + ' (looping)');
      return;
    }

    this.debugLog('transition: ' + (this.currentState || 'none') + ' -> ' + stateName +
      '  species=' + this.species + '  dragging=' + _petDragging +
      '  oneShot=' + this._playingOneShot + '  hover=' + this.hoverActive);

    this.stopLoop();
    var wasOneShot = this._playingOneShot;
    this._playingOneShot = cfg.loop === false;
    if (wasOneShot && !this._playingOneShot) {
      this.debugLog('one-shot cancelled (interrupted by ' + stateName + ')');
    }
    this.currentState = stateName;
    this.currentFrame = 0;

    this._preloadFrames(stateName, cfg).then(function() {
      if (self.currentState !== stateName) {
        self.debugLog('DISCARD stale preload for ' + stateName + ' (current=' + self.currentState + ')');
        return;
      }
      self._renderFrame(stateName, 0);
      self._startLoop(stateName, cfg);
    });
  },

  _renderFrame(stateName, frameIndex) {
    if (!this.species) return;
    var src = this.resolveFrameSrc(stateName, frameIndex);

    if (src === this._lastBgSrc) {
      this.debugLog('frame NOP ' + frameIndex + ' of "' + stateName + '" (same as last)');
      return;
    }

    var file = src.split('/').pop();
    var key = stateName + '|' + file;

    if (this._unavailable[key]) {
      var cfg = this.getStateConfig(stateName);
      var frames = cfg && cfg.frames;
      if (frames) {
        for (var i = 0; i < frames.length; i++) {
          var tryIdx = (frameIndex + i) % frames.length;
          var tryFile = frames[tryIdx];
          var tryKey = stateName + '|' + tryFile;
          if (!this._unavailable[tryKey]) {
            src = this._stateAssetDir(stateName, cfg) + tryFile;
            this.debugLog('frame FALLBACK ' + frameIndex + ' -> ' + tryIdx + ' of "' + stateName + '" (' + tryFile + ')');
            break;
          }
        }
      }
      if (src === this._lastBgSrc) return;
    }

    this._lastBgSrc = src;
    spriteEl.style.backgroundImage = 'url("' + src + '")';
    spriteEl.classList.add('sprite-asset-loaded');
    this.debugLog('frame ' + frameIndex + ' of "' + stateName + '"  src=' + src);
    if (DEBUG_ANIM) this._updateDebugOverlay(stateName, frameIndex, src);
  },

  _startLoop(stateName, cfg) {
    var self = this;
    var fps = cfg.fps || 1;
    var looper = cfg.loop !== false;
    var fallback = cfg.fallback || 'idle';
    var totalFrames = (cfg.frames && cfg.frames.length) || 1;

    this.debugLog('loop start: state=' + stateName + ' fps=' + fps + ' loop=' + looper +
      ' totalFrames=' + totalFrames + ' fallback=' + fallback);

    this.frameTimer = setInterval(function() {
      self.currentFrame++;
      checkThinkingStage();

      if (looper && self.currentFrame >= totalFrames) {
        self.currentFrame = 0;
      }

      if (!looper && self.currentFrame >= totalFrames) {
        self.debugLog('one-shot "' + stateName + '" complete -> "' + fallback + '"');
        self.stopLoop();
        self._playingOneShot = false;
        self.transition(fallback);
        return;
      }

      self._renderFrame(stateName, self.currentFrame);
    }, 1000 / Math.max(fps, 1));
  },

  stopLoop() {
    if (this.frameTimer) {
      clearInterval(this.frameTimer);
      this.frameTimer = null;
    }
  },

  init(species, customPet) {
    this.customPet = customPet || null;
    this.species = species;
    if (!this.manifest) return;
    this.stopLoop();
    this.currentState = null;
    this.currentFrame = 0;
    this._playingOneShot = false;
    this._preloaded = Object.create(null);
    this._unavailable = Object.create(null);
    this._lastBgSrc = '';
    this.debugLog('init species=' + species + (this.customPet ? ' custom=' + this.customPet.name : ''));
    this.transition('idle');
    this._startBlinkTimer();
  },

  _updateDebugOverlay(stateName, frameIndex, src) {
    var el = document.getElementById('pet-anim-debug');
    if (!el) {
      el = document.createElement('div');
      el.id = 'pet-anim-debug';
      el.style.cssText =
        'position:absolute;top:0;left:0;' +
        'background:rgba(0,0,0,0.75);color:#0f0;' +
        'font:10px monospace;padding:4px 6px;' +
        'z-index:99;pointer-events:none;border-radius:0 0 6px 0;' +
        'max-width:280px;white-space:pre-wrap;word-break:break-all;';
      document.getElementById('pet-container').appendChild(el);
    }
    var file = src.split('/').pop() || src;
    el.textContent = 'state=' + stateName +
      ' frame=' + frameIndex +
      ' file=' + file +
      '\nspecies=' + this.species +
      '\ndrag=' + _petDragging +
      ' hover=' + this.hoverActive +
      ' oneshot=' + this._playingOneShot;
  },

  _removeDebugOverlay() {
    var el = document.getElementById('pet-anim-debug');
    if (el) el.remove();
  },

  _startBlinkTimer() {
    this._stopBlinkTimer();
    this._scheduleBlink();
  },

  _scheduleBlink() {
    var self = this;
    this.blinkTimer = setTimeout(function() {
      var canBlink = self.currentState === 'idle' &&
        !_petDragging &&
        !self.hoverActive &&
        !self._playingOneShot;
      if (!canBlink) {
        self.debugLog('BLOCKED blink (state=' + self.currentState +
          ' dragging=' + _petDragging +
          ' hover=' + self.hoverActive +
          ' oneshot=' + self._playingOneShot + ')');
        self._scheduleBlink();
        return;
      }
      if (Math.random() < 0.3) {
        self.transition('blink');
      }
      self._scheduleBlink();
    }, 4000 + Math.random() * 8000);
  },

  _stopBlinkTimer() {
    if (this.blinkTimer) {
      clearTimeout(this.blinkTimer);
      this.blinkTimer = null;
    }
  }
};

// State
let state = {
  species: '',
  name: '',
  level: 1,
  xp: 0,
  xpNext: 100,
  variant: 'normal',
  mood: 'idle',
  currentStatus: 'Idle',
  visible: true,
  shiny: false,
  hat: false,
};

let bubbleTimeout = null;
let bubbleHideTimeout = null;
let bubblePulseTimeout = null;
let reactTimeout = null;
let eventTrayTimeout = null;
let eventTrayToken = 0;
let lastMood = 'idle';
let dragPointerId = null;
let dragStart = null;
let dragMoved = false;
let _blockingCount = 0;

const PET_MEMORY_KEY = 'hermesPetMemory.v1';
const OVERLAY_COMPANION_KEY = 'hermesPetCompanionOverlay.v1';
const VISUAL_BOOTSTRAP_KEY = 'hermesPetVisualBootstrap.v1';
const DEFAULT_COMPANION_TIMEZONE = 'Asia/Shanghai';
const RUNTIME_CONFIG = window.hermesPetAPI && typeof window.hermesPetAPI.getRuntimeConfig === 'function'
  ? (window.hermesPetAPI.getRuntimeConfig() || {})
  : {};
const COMPANION_TIMEZONE = String(RUNTIME_CONFIG.timezone || DEFAULT_COMPANION_TIMEZONE);

let _companionDateFormatter = null;
let _companionDateTimeFormatter = null;

function safeTimeZone() {
  return COMPANION_TIMEZONE || DEFAULT_COMPANION_TIMEZONE;
}

function getCompanionDateFormatter() {
  if (_companionDateFormatter) return _companionDateFormatter;
  try {
    _companionDateFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: safeTimeZone(),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch (_) {
    _companionDateFormatter = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  }
  return _companionDateFormatter;
}

function getCompanionDateTimeFormatter() {
  if (_companionDateTimeFormatter) return _companionDateTimeFormatter;
  try {
    _companionDateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: safeTimeZone(),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch (_) {
    _companionDateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  }
  return _companionDateTimeFormatter;
}

function zonedParts(date) {
  var baseDate = date instanceof Date ? date : new Date();
  var out = {};
  getCompanionDateTimeFormatter().formatToParts(baseDate).forEach(function(part) {
    if (part.type === 'literal') return;
    out[part.type] = part.value;
  });
  return out;
}

function zonedDateKey(date) {
  var parts = zonedParts(date);
  return [parts.year, parts.month, parts.day].join('-');
}

function zonedHour(date) {
  var value = Number(zonedParts(date).hour || 0);
  return Number.isFinite(value) ? value : 0;
}

function timezoneOffsetMs(date) {
  var parts = zonedParts(date);
  var asUtc = Date.UTC(
    Number(parts.year || 0),
    Math.max(0, Number(parts.month || 1) - 1),
    Number(parts.day || 1),
    Number(parts.hour || 0),
    Number(parts.minute || 0),
    Number(parts.second || 0),
  );
  return asUtc - date.getTime();
}

function zonedTimestampToIso(year, month, day, hour, minute, second) {
  var guess = Date.UTC(year, month - 1, day, hour, minute, second || 0);
  for (var i = 0; i < 2; i += 1) {
    var offset = timezoneOffsetMs(new Date(guess));
    guess = Date.UTC(year, month - 1, day, hour, minute, second || 0) - offset;
  }
  return new Date(guess).toISOString();
}

function isoNow() {
  return new Date().toISOString();
}

function todayKey() {
  return zonedDateKey(new Date());
}

function defaultPetMemory() {
  return {
    version: 7,
    companion_preferences: {
      preset: 'balanced_partner',
      proactivity: 'medium',
      tone_balance: 'balanced',
      focus_mode: 'balanced',
      verbosity: 'medium',
    },
    active_days: 0,
    last_active_date: '',
    recent_days: [],
    night_sessions: 0,
    long_running_count: 0,
    approval_wait_count: 0,
    consecutive_failures: 0,
    recent_failures: [],
    work_style_bias: {
      steady_worker: 0,
      late_night_builder: 0,
      approval_magnet: 0,
      trial_and_error: 0,
    },
    today: {
      date: todayKey(),
      tasks_started: 0,
      tasks_completed: 0,
      long_running_seen: 0,
      approval_waits: 0,
      review_waits: 0,
      first_active_at: null,
      last_active_at: null,
      last_idle_at: null,
      night_marked: false,
    },
    expression: {
      tone: 'warming_up',
      summary_key: 'warming_up',
      night_streak: 0,
      night_days_7d: 0,
      approval_waits_3d: 0,
      review_waits_3d: 0,
      tasks_completed_3d: 0,
      approval_heavy: false,
      failure_heavy: false,
      steady_recent: false,
      dominant_bias: '',
    },
    phase: {
      session_phase: 'warmup',
      rhythm: 'steady_flow',
      stance: 'push',
      noise_budget: 'medium',
      active_minutes: 0,
      idle_gap_minutes: null,
      blocking_pressure: 0,
    },
    insight: {
      trend_key: 'warming_up',
      risk_key: 'none',
      pattern_key: 'early_ramp',
      summary: 'warming_up',
      tasks_completed_7d: 0,
      tasks_completed_14d: 0,
      approval_waits_7d: 0,
      review_waits_7d: 0,
      long_running_7d: 0,
      night_days_14d: 0,
      wrap_rate_7d: 0,
    },
    semantic_task: {
      task_id: '',
      title: '',
      goal: '',
      criteria: [],
      intent: '',
      kind: 'general',
      status: 'idle',
      step: '',
      summary: '',
      next_action: '',
      blocker_type: '',
      blocker_detail: '',
      needs_user: false,
      changed_files: [],
      tools_used: [],
      project_id: '',
      started_at: null,
      updated_at: null,
      completed_at: null,
      failed_at: null,
      resumed_from: '',
      active: false,
    },
    session_thread: {
      thread_id: '',
      task_id: '',
      title: '',
      summary: '',
      status: 'idle',
      need: '',
      blocker_type: '',
      started_at: null,
      updated_at: null,
      completed_at: null,
      event_count: 0,
      last_event_type: '',
      timeline: [],
      wrap_line: '',
    },
    narrative: {
      focus_line: '',
      need_line: '',
      status_line: '',
      recent_line: '',
      thread_line: '',
      day_line: '',
      risk_line: '',
      next_line: '',
      timeline_line: '',
      recent_lines: [],
      updated_at: null,
    },
    task_context: {
      category: 'general',
      confidence: 'low',
      interaction_mode: 'ambient',
      command_family: '',
      source: '',
      project_scope: 'none',
      signals: {
        coding: false,
        review: false,
        shell: false,
        browser: false,
        approval: false,
      },
    },
  };
}

function mergePetMemory(raw) {
  var base = defaultPetMemory();
  if (!raw || typeof raw !== 'object') return base;
  var out = Object.assign({}, base, raw);
  out.version = Math.max(base.version, Number(raw.version || 0) || 0);
  out.companion_preferences = Object.assign({}, base.companion_preferences, raw.companion_preferences || {});
  out.work_style_bias = Object.assign({}, base.work_style_bias, raw.work_style_bias || {});
  out.today = Object.assign({}, base.today, raw.today || {});
  out.expression = Object.assign({}, base.expression, raw.expression || {});
  out.phase = Object.assign({}, base.phase, raw.phase || {});
  out.insight = Object.assign({}, base.insight, raw.insight || {});
  out.semantic_task = Object.assign({}, base.semantic_task, raw.semantic_task || {});
  out.session_thread = Object.assign({}, base.session_thread, raw.session_thread || {});
  out.narrative = Object.assign({}, base.narrative, raw.narrative || {});
  out.task_context = Object.assign({}, base.task_context, raw.task_context || {});
  out.task_context.signals = Object.assign({}, base.task_context.signals, (out.task_context && out.task_context.signals) || {});
  if (!Array.isArray(out.recent_failures)) out.recent_failures = [];
  if (!Array.isArray(out.recent_days)) out.recent_days = [];
  if (!Array.isArray(out.semantic_task.changed_files)) out.semantic_task.changed_files = [];
  if (!Array.isArray(out.semantic_task.tools_used)) out.semantic_task.tools_used = [];
  if (!Array.isArray(out.semantic_task.criteria)) out.semantic_task.criteria = [];
  if (!Array.isArray(out.session_thread.timeline)) out.session_thread.timeline = [];
  if (!Array.isArray(out.narrative.recent_lines)) out.narrative.recent_lines = [];
  return out;
}

function defaultOverlayCompanionState() {
  return {
    day: {
      date: todayKey(),
      session_count: 0,
      session_resumes: 0,
      session_open: false,
      session_mode: 'idle',
      session_started_at: null,
      session_started_tasks_started: 0,
      session_started_tasks_completed: 0,
      session_started_approval_waits: 0,
      session_started_review_waits: 0,
      greeted: false,
      wrapped_up: false,
      late_night_cared: false,
      last_session_open_at: null,
      last_session_closed_at: null,
    },
    cooldowns: {
      idle_nudge_at: null,
      running_nudge_at: null,
      waiting_nudge_at: null,
      late_night_nudge_at: null,
      failure_comfort_at: null,
    },
    overrides: {
      temp_quiet_until: null,
      quiet_tonight_until: null,
      proactivity: null,
    },
  };
}

function mergeOverlayCompanionState(raw) {
  var base = defaultOverlayCompanionState();
  if (!raw || typeof raw !== 'object') return base;
  return {
    day: Object.assign({}, base.day, raw.day || {}),
    cooldowns: Object.assign({}, base.cooldowns, raw.cooldowns || {}),
    overrides: Object.assign({}, base.overrides, raw.overrides || {}),
  };
}

function loadOverlayCompanionState() {
  try {
    var fromMain = window.hermesPetAPI && typeof window.hermesPetAPI.loadOverlayCompanionState === 'function'
      ? window.hermesPetAPI.loadOverlayCompanionState()
      : null;
    if (fromMain && typeof fromMain === 'object') {
      return mergeOverlayCompanionState(fromMain);
    }
    var raw = JSON.parse(window.localStorage.getItem(OVERLAY_COMPANION_KEY) || 'null');
    return mergeOverlayCompanionState(raw);
  } catch (_) {
    return defaultOverlayCompanionState();
  }
}

function loadPetMemory() {
  try {
    var fromFile = window.hermesPetAPI && typeof window.hermesPetAPI.loadPetMemory === 'function'
      ? window.hermesPetAPI.loadPetMemory()
      : null;
    if (fromFile && typeof fromFile === 'object') {
      return mergePetMemory(fromFile);
    }
    var legacy = JSON.parse(window.localStorage.getItem(PET_MEMORY_KEY) || 'null');
    var merged = mergePetMemory(legacy);
    if (legacy && window.hermesPetAPI && typeof window.hermesPetAPI.savePetMemory === 'function') {
      window.hermesPetAPI.savePetMemory(merged);
    }
    return merged;
  } catch (_) {
    return defaultPetMemory();
  }
}

function cachePetMemoryLocally() {
  try {
    window.localStorage.setItem(PET_MEMORY_KEY, JSON.stringify(petMemory));
  } catch (_) {}
}

function cacheOverlayCompanionLocally() {
  try {
    window.localStorage.setItem(OVERLAY_COMPANION_KEY, JSON.stringify(overlayCompanion));
  } catch (_) {}
}

function syncOverlayDayToPetMemory() {
  petMemory.today.session_count = Number((overlayCompanion.day || {}).session_count || 0);
  petMemory.today.session_resumes = Number((overlayCompanion.day || {}).session_resumes || 0);
  petMemory.today.greeted = !!((overlayCompanion.day || {}).greeted);
  petMemory.today.wrapped_up = !!((overlayCompanion.day || {}).wrapped_up);
  petMemory.today.late_night_cared = !!((overlayCompanion.day || {}).late_night_cared);
  petMemory.today.last_session_open_at = (overlayCompanion.day || {}).last_session_open_at || null;
  petMemory.today.last_session_closed_at = (overlayCompanion.day || {}).last_session_closed_at || null;
}

function savePetMemory() {
  try {
    if (window.hermesPetAPI && typeof window.hermesPetAPI.savePetMemory === 'function') {
      window.hermesPetAPI.savePetMemory(petMemory);
    }
  } catch (_) {}
  cachePetMemoryLocally();
  renderCompanionSummary();
}

function saveOverlayCompanionState() {
  syncOverlayDayToPetMemory();
  try {
    if (window.hermesPetAPI && typeof window.hermesPetAPI.savePetMemory === 'function') {
      window.hermesPetAPI.savePetMemory(petMemory);
    }
  } catch (_) {}
  try {
    if (window.hermesPetAPI && typeof window.hermesPetAPI.saveOverlayCompanionState === 'function') {
      window.hermesPetAPI.saveOverlayCompanionState(overlayCompanion);
    }
  } catch (_) {}
  cachePetMemoryLocally();
  cacheOverlayCompanionLocally();
  renderCompanionSummary();
}

function applyCompanionMemorySnapshot(snapshot, sourceType) {
  if (!snapshot || typeof snapshot !== 'object') return false;
  petMemory = mergePetMemory(snapshot);
  cachePetMemoryLocally();
  renderCompanionSummary();
  logCompanion('python-memory-snapshot', {
    type: sourceType || '',
    version: petMemory.version || 0,
    tasks_started: Number((petMemory.today || {}).tasks_started || 0),
    tasks_completed: Number((petMemory.today || {}).tasks_completed || 0),
  });
  var thread = companionSessionThread();
  var threadKey = [
    String(thread.thread_id || ''),
    String(thread.status || ''),
    String(thread.event_count || 0),
    String(thread.need || ''),
    String(thread.wrap_line || ''),
  ].join('|');
  if (thread.thread_id && threadKey !== lastSessionThreadKey) {
    lastSessionThreadKey = threadKey;
    logCompanion('session-thread-applied', {
      type: sourceType || '',
      thread_id: String(thread.thread_id || ''),
      status: String(thread.status || ''),
      title: String(thread.title || ''),
      need: String(thread.need || ''),
      event_count: Number(thread.event_count || 0),
      timeline_count: Array.isArray(thread.timeline) ? thread.timeline.length : 0,
      wrap_line: String(thread.wrap_line || ''),
    });
  }
  return true;
}

function semanticStatusForEvent(msg) {
  if (!msg || !msg.type) return 'idle';
  if (isBlockingSemanticProgress(msg)) return 'blocked';
  if (msg.task_status) return String(msg.task_status);
  if (msg.type === 'task_blocked') return 'blocked';
  if (msg.type === 'task_completed') return 'completed';
  if (msg.type === 'task_failed') return 'failed';
  return 'active';
}

function parseSemanticJsonText(value) {
  var text = String(value || '').trim();
  if (!text || (text[0] !== '{' && text[0] !== '[')) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

function flattenSemanticPayload(value, pieces, depth, label) {
  if (pieces.length >= 80 || depth > 4 || value == null) return;
  if (Array.isArray(value)) {
    value.slice(0, 12).forEach(function(item) {
      flattenSemanticPayload(item, pieces, depth + 1, label);
    });
    return;
  }
  if (typeof value === 'object') {
    Object.keys(value).slice(0, 24).forEach(function(key) {
      var item = value[key];
      if (item == null) return;
      if (typeof item === 'object') {
        pieces.push(String(key));
        flattenSemanticPayload(item, pieces, depth + 1, key);
      } else {
        pieces.push(String(key) + ': ' + singleLineText(item, 500));
        var parsed = parseSemanticJsonText(item);
        if (parsed) flattenSemanticPayload(parsed, pieces, depth + 1, key);
      }
    });
    return;
  }
  var text = singleLineText(value, 700);
  if (!text) return;
  pieces.push(label ? String(label) + ': ' + text : text);
  var parsedValue = parseSemanticJsonText(text);
  if (parsedValue) flattenSemanticPayload(parsedValue, pieces, depth + 1, label);
}

function semanticProgressPieces(msg) {
  var pieces = [];
  if (!msg || typeof msg !== 'object') return pieces;
  [
    'task_status',
    'blocker_type',
    'blocker_detail',
    'task_next',
    'task_summary',
    'text',
    'task_step',
    'task_title',
    'outcome_summary',
    'approval',
    'error',
    'status',
    'message',
    'reason',
  ].forEach(function(key) {
    if (msg[key] != null) flattenSemanticPayload(msg[key], pieces, 0, key);
  });
  return pieces;
}

function semanticBlockingDetailFromPieces(msg, pieces) {
  var preferred = pieces.find(function(piece) {
    return /^(error|approval|blocker|reason|message|status)\s*:/i.test(piece)
      && /blocked|approval|required|clarify|password|login|ask|denied|waiting/i.test(piece);
  }) || pieces.find(function(piece) {
    return /blocked|approval|required|clarify|password|login|ask|denied|waiting/i.test(piece);
  }) || '';
  return singleLineText(
    msg.blocker_detail ||
    msg.task_next ||
    preferred ||
    msg.text ||
    msg.task_summary ||
    '',
    220,
  );
}

function semanticBlockingEvidence(msg) {
  var empty = { blocked: false, blocker_type: '', blocker_detail: '', task_next: '' };
  if (!msg || msg.type !== 'task_progress') return empty;

  var taskStatus = String(msg.task_status || '').trim().toLowerCase();
  if (taskStatus === 'blocked' || taskStatus === 'waiting' || taskStatus === 'review') {
    var statusPieces = semanticProgressPieces(msg);
    return {
      blocked: true,
      blocker_type: msg.blocker_type || (taskStatus === 'review' ? 'review' : 'waiting'),
      blocker_detail: semanticBlockingDetailFromPieces(msg, statusPieces),
      task_next: singleLineText(msg.task_next || semanticBlockingDetailFromPieces(msg, statusPieces), 200),
    };
  }

  var pieces = semanticProgressPieces(msg);
  var haystack = pieces.join('\n').toLowerCase();
  var hasCompletedApproval = /\b(was approved by the user|approved by the user|and was approved|was allowed by the user)\b/.test(haystack);
  var hardBlocked = /\bstatus\s*:\s*blocked\b|["']status["']\s*:\s*["']blocked["']|blocked:\s*|command denied by user|do not retry this command|approval_required|permission_required/.test(haystack);
  var interactiveBlock = /command required approval|requires approval|required approval|approval needed|waiting for approval|needs user|needs_user\s*:\s*true|["']needs_user["']\s*:\s*true|enter send - esc cancel|clarify\s*\(|\bclarify\b|\bask\s+[^.\n]{3,120}|needs a password|password required|login required|please log in/.test(haystack);
  var structuredBlock = !!msg.needs_user || !!msg.blocker_type || !!msg.blocker_detail;

  if (!structuredBlock && !hardBlocked && !(interactiveBlock && !hasCompletedApproval)) return empty;

  var blockerType = String(msg.blocker_type || '').trim();
  if (!blockerType) {
    if (/clarify\s*\(|\bclarify\b|\bask\s+[^.\n]{3,120}|enter send - esc cancel|needs a password|password required|login required|please log in/.test(haystack)) {
      blockerType = 'clarify';
    } else if (/approval|approve|permission|command denied/.test(haystack) || msg.needs_user) {
      blockerType = 'approval';
    } else {
      blockerType = 'waiting';
    }
  }

  var detail = semanticBlockingDetailFromPieces(msg, pieces);
  return {
    blocked: true,
    blocker_type: blockerType,
    blocker_detail: detail,
    task_next: singleLineText(msg.task_next || detail, 200),
  };
}

function isBlockingSemanticProgress(msg) {
  if (!msg || msg.type !== 'task_progress') return false;
  return semanticBlockingEvidence(msg).blocked;
}

function semanticSameTask(msg, semantic) {
  if (!msg || !semantic) return true;
  var msgTaskId = String(msg.task_id || '').trim();
  var currentTaskId = String(semantic.task_id || '').trim();
  if (!msgTaskId || !currentTaskId) return true;
  return msgTaskId === currentTaskId;
}

function semanticBlockerAnimation(blockerType, fallbackMode) {
  var blocker = String(blockerType || '').trim().toLowerCase();
  var fallback = String(fallbackMode || '').trim().toLowerCase();
  if (blocker === 'review' || blocker === 'approval') return 'review';
  if (fallback === 'review' || fallback === 'waiting') return fallback;
  return 'waiting';
}

function semanticBlockedMode(semantic, fallbackMode) {
  return semanticBlockerAnimation((semantic && semantic.blocker_type) || '', fallbackMode);
}

function isBlockedRuntimeState(semantic, mode) {
  var status = String((semantic && semantic.status) || '').trim().toLowerCase();
  var currentMode = String(mode || '').trim().toLowerCase();
  return status === 'blocked' || currentMode === 'review' || currentMode === 'waiting';
}

function clearStaleBlockedRuntimeState(reason) {
  var semantic = companionSemanticTask();
  if (!semantic) return false;
  var status = String(semantic.status || '').trim().toLowerCase();
  var mode = String(companionState.mode || '').trim().toLowerCase();
  if (status !== 'blocked' && mode !== 'review' && mode !== 'waiting') return false;
  semantic.status = 'active';
  semantic.needs_user = false;
  semantic.blocker_type = '';
  semantic.blocker_detail = '';
  semantic.next_action = '';
  semantic.updated_at = isoNow();
  logCompanion('running-cleared-stale-blocked', {
    reason: reason || '',
    previous_status: status,
    previous_mode: mode,
  });
  return true;
}

function shouldHoldBlockedSemanticEvent(msg, semantic) {
  if (!msg || !semantic) return false;
  var previousStatus = String(semantic.status || '').trim().toLowerCase();
  if (previousStatus !== 'blocked') return false;
  if (msg.type !== 'task_progress') return false;
  return semanticSameTask(msg, semantic);
}

function semanticIntentForEvent(msg, semantic, title) {
  return singleLineText(
    msg.task_intent ||
    title ||
    msg.task_summary ||
    msg.text ||
    msg.task_step ||
    ((semantic && semantic.intent) || ''),
    200,
  );
}

function semanticNarrativeRecentLine(msg, semantic) {
  if (!msg || !semantic) return '';
  var title = singleLineText(semantic.intent || semantic.title || semantic.step || '', 160);
  var summary = singleLineText(semantic.summary || '', 180);
  var need = singleLineText(semantic.next_action || semantic.blocker_detail || '', 180);
  var blocker = singleLineText(semantic.blocker_detail || semantic.blocker_type || '', 180);
  if (msg.type === 'task_started') {
    return title ? '开咗头：' + title : '';
  }
  if (msg.type === 'task_progress') {
    if (summary && title && summary !== title) return '推进到：' + summary;
    if (title) return '跟到：' + title;
    if (need) return '跟到：' + need;
    return '';
  }
  if (msg.type === 'task_blocked') {
    if (need) return '卡住：' + need;
    if (blocker) return '卡住：' + blocker;
    if (title) return '卡住：' + title;
    return '';
  }
  if (msg.type === 'task_resumed') {
    return title ? '续返：' + title : '';
  }
  if (msg.type === 'task_completed') {
    if (summary) return '收住：' + summary;
    if (title) return '收住：' + title;
    return '';
  }
  if (msg.type === 'task_failed') {
    if (summary) return '受阻：' + summary;
    if (need) return '受阻：' + need;
    if (title) return '受阻：' + title;
    return '';
  }
  return '';
}

function pushNarrativeRecentLine(line, atIso) {
  var text = singleLineText(line || '', 180);
  if (!text) return;
  petMemory.narrative = Object.assign({}, defaultPetMemory().narrative, petMemory.narrative || {});
  var next = Array.isArray(petMemory.narrative.recent_lines) ? petMemory.narrative.recent_lines.slice(0, 5) : [];
  next = next.filter(function(item) {
    return item && typeof item === 'object' && String(item.line || '').trim() && String(item.line || '').trim() !== text;
  });
  next.unshift({
    line: text,
    at: atIso || isoNow(),
  });
  if (next.length > 5) next.length = 5;
  petMemory.narrative.recent_lines = next;
  petMemory.narrative.recent_line = text;
}

function applySemanticTaskEvent(msg) {
  if (!msg || !msg.type) return false;
  if (!(msg.type === 'task_started' || msg.type === 'task_progress' || msg.type === 'task_blocked' || msg.type === 'task_resumed' || msg.type === 'task_completed' || msg.type === 'task_failed')) {
    return false;
  }
  petMemory.semantic_task = Object.assign({}, defaultPetMemory().semantic_task, petMemory.semantic_task || {});
  var semantic = petMemory.semantic_task;
  var now = isoNow();
  var title = eventTaskTitle(msg, semantic.title);
  var holdBlocked = shouldHoldBlockedSemanticEvent(msg, semantic);
  var blockingEvidence = semanticBlockingEvidence(msg);
  var status = holdBlocked ? 'blocked' : semanticStatusForEvent(msg);
  var explicitNextAction = singleLineText(msg.task_next || '', 200);
  var nextAction = explicitNextAction || (
    status === 'blocked'
      ? (blockingEvidence.task_next || semantic.next_action || '')
      : (semantic.next_action || '')
  );
  if (status !== 'blocked' && (msg.type === 'task_started' || msg.type === 'task_resumed' || msg.type === 'task_completed') && !explicitNextAction) {
    nextAction = '';
  }
  semantic.task_id = String(msg.task_id || semantic.task_id || '');
  semantic.title = title;
  semantic.goal = singleLineText(msg.task_goal || semantic.goal || '', 160);
  semantic.criteria = Array.isArray(msg.task_criteria) ? msg.task_criteria.slice(0, 8).map(function(item) { return singleLineText(item, 120); }) : (semantic.criteria || []);
  semantic.intent = semanticIntentForEvent(msg, semantic, title);
  semantic.kind = String(msg.task_kind || semantic.kind || 'general');
  semantic.status = status;
  semantic.step = singleLineText(msg.task_step || semantic.step || '', 180);
  semantic.summary = eventTaskSummary(msg, semantic.summary);
  semantic.next_action = singleLineText(nextAction, 200);
  semantic.blocker_type = String(msg.blocker_type || (status === 'blocked' ? blockingEvidence.blocker_type || semantic.blocker_type : '') || '');
  semantic.blocker_detail = singleLineText(msg.blocker_detail || (status === 'blocked' ? blockingEvidence.blocker_detail || semantic.blocker_detail : '') || '', 220);
  semantic.needs_user = !!msg.needs_user || status === 'blocked';
  semantic.changed_files = Array.isArray(msg.changed_files) ? msg.changed_files.slice(0, 16) : semantic.changed_files || [];
  semantic.tools_used = Array.isArray(msg.tools_used) ? msg.tools_used.slice(0, 16) : semantic.tools_used || [];
  semantic.project_id = String(msg.project_id || semantic.project_id || '');
  semantic.updated_at = now;
  if (msg.type === 'task_started') semantic.started_at = semantic.started_at || now;
  if (msg.type === 'task_completed') semantic.completed_at = now;
  if (msg.type === 'task_failed') semantic.failed_at = now;
  semantic.resumed_from = String(msg.resumed_from || semantic.resumed_from || '');
  semantic.active = status === 'active' || status === 'blocked';
  if (holdBlocked) {
    logCompanion('blocked-semantic-held', {
      type: msg.type,
      task_id: semantic.task_id || '',
      blocker_type: semantic.blocker_type || '',
      mode: companionState.mode || '',
    });
  }
  petMemory.narrative = Object.assign({}, defaultPetMemory().narrative, petMemory.narrative || {});
  petMemory.narrative.focus_line = title;
  petMemory.narrative.need_line = semantic.next_action || '';
  petMemory.narrative.status_line = semantic.summary || '';
  pushNarrativeRecentLine(semanticNarrativeRecentLine(msg, semantic), now);
  petMemory.narrative.updated_at = now;
  cachePetMemoryLocally();
  return true;
}

function logCompanion(message, extra) {
  try {
    if (window.hermesPetAPI && typeof window.hermesPetAPI.logRenderer === 'function') {
      window.hermesPetAPI.logRenderer('[pet-renderer] companion ' + message, extra);
    }
    if (extra !== undefined) console.log('[pet-renderer] companion ' + message, JSON.stringify(extra));
    else console.log('[pet-renderer] companion ' + message);
  } catch (_) {}
}

function isLateNightWindow(hour) {
  var value = Number.isFinite(hour) ? hour : zonedHour(new Date());
  return value >= 22 || value < 6;
}

function dominantWorkStyle() {
  var expression = petMemory.expression || {};
  if (expression.dominant_bias) return String(expression.dominant_bias);
  var bias = petMemory.work_style_bias || {};
  var bestKey = '';
  var bestValue = -1;
  Object.keys(bias).forEach(function(key) {
    var value = Number(bias[key] || 0);
    if (value > bestValue) {
      bestKey = key;
      bestValue = value;
    }
  });
  return bestValue > 0 ? bestKey : '';
}

function companionExpression() {
  return petMemory.expression && typeof petMemory.expression === 'object'
    ? petMemory.expression
    : defaultPetMemory().expression;
}

function companionPhase() {
  return petMemory.phase && typeof petMemory.phase === 'object'
    ? petMemory.phase
    : defaultPetMemory().phase;
}

function companionTaskContext() {
  return petMemory.task_context && typeof petMemory.task_context === 'object'
    ? petMemory.task_context
    : defaultPetMemory().task_context;
}

function companionInsight() {
  return petMemory.insight && typeof petMemory.insight === 'object'
    ? petMemory.insight
    : defaultPetMemory().insight;
}

function companionSemanticTask() {
  return petMemory.semantic_task && typeof petMemory.semantic_task === 'object'
    ? petMemory.semantic_task
    : defaultPetMemory().semantic_task;
}

function companionSessionThread() {
  return petMemory.session_thread && typeof petMemory.session_thread === 'object'
    ? petMemory.session_thread
    : defaultPetMemory().session_thread;
}

function companionNarrative() {
  return petMemory.narrative && typeof petMemory.narrative === 'object'
    ? petMemory.narrative
    : defaultPetMemory().narrative;
}

function companionRuleRuntime(kind, stage) {
  if (!window.HermesCompanionRules || typeof window.HermesCompanionRules.evaluate !== 'function') {
    return {
      rule_id: 'renderer-fallback',
      route_key: 'fallback',
      speech_policy: 'balanced',
      line_order: ['insight', 'pack', 'context', 'phase', 'expression', 'preference'],
      note: '规则引擎未加载，暂时用 renderer 内建逻辑顶住。',
    };
  }
  try {
    return window.HermesCompanionRules.evaluate({
      phase: companionPhase(),
      insight: companionInsight(),
      preferences: effectiveCompanionPreferences(),
      pack: companionProfilePack(),
      context: companionTaskContext(),
      semantic: companionSemanticTask(),
      workflow: {
        checkpoint: workflowCheckpointLabel(),
        escalation: workflowEscalationLabel(),
        status: workflowStatusLine(),
        hint: workflowHintLine(),
        next: workflowNextStepLine(),
      },
      overrides: {
        muted: mutedNow(),
        quiet_mode: notificationPrefs.quiet_mode || 'off',
        proactivity: ((overlayCompanion.overrides || {}).proactivity) || '',
      },
      mode: companionState.mode,
      kind: kind || '',
      stage: Number(stage || 0),
    });
  } catch (_) {
    return {
      rule_id: 'renderer-fallback',
      route_key: 'fallback',
      speech_policy: 'balanced',
      line_order: ['insight', 'pack', 'context', 'phase', 'expression', 'preference'],
      note: '规则引擎出错，暂时退回 renderer 内建逻辑。',
    };
  }
}

function companionPreferences() {
  return petMemory.companion_preferences && typeof petMemory.companion_preferences === 'object'
    ? petMemory.companion_preferences
    : defaultPetMemory().companion_preferences;
}

function shiftScale(value, delta) {
  var scale = ['low', 'medium', 'high'];
  var index = scale.indexOf(String(value || 'medium'));
  if (index === -1) index = 1;
  index = Math.max(0, Math.min(scale.length - 1, index + delta));
  return scale[index];
}

function companionProfilePack() {
  var raw = companionPreferences();
  var requested = String(raw.profile_pack || 'auto');
  var customName = String(((state.custom_pet || {}).name) || '').toLowerCase();
  var species = String(state.species || '').toLowerCase();
  var fallbackPacks = {
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
  var packRuntime = window.HermesCompanionPacks || {};
  var packs = typeof packRuntime.registry === 'function' ? packRuntime.registry() : fallbackPacks;
  var inferred = typeof packRuntime.infer === 'function'
    ? String(packRuntime.infer({ custom_name: customName, species: species }) || 'classic_default')
    : 'classic_default';
  if (!packRuntime.infer) {
    if (customName.indexOf('celestia') !== -1 || customName.indexOf('princess') !== -1 || customName.indexOf('alicorn') !== -1) inferred = 'celestia_princess';
    else if (species.indexOf('celestia') !== -1 || species.indexOf('princess') !== -1 || species.indexOf('alicorn') !== -1) inferred = 'celestia_princess';
    else if (customName.indexOf('shinchan') !== -1) inferred = 'shinchan_playmate';
    else if (species === 'cat' || species === 'custom') inferred = 'cat_operator';
    else if (species === 'flame-onion') inferred = 'onion_watcher';
    else if (species === 'dragon') inferred = 'dragon_guard';
  }
  var id = requested !== 'auto' && packs[requested] ? requested : inferred;
  var pack = packs[id] || packs.classic_default || fallbackPacks.classic_default;
  return Object.assign({ requested: requested, inferred: inferred, auto: requested === 'auto' }, pack);
}

function profilePackLabel(value) {
  var labels = window.HermesCompanionPacks && typeof window.HermesCompanionPacks.labels === 'function'
    ? window.HermesCompanionPacks.labels()
    : {
      auto: 'Auto',
      classic_default: '平衡',
      cat_operator: '安静',
      onion_watcher: '警醒',
      dragon_guard: '稳定',
      shinchan_playmate: '活跃',
      celestia_princess: '公主',
    };
  return labels[String(value || '')] || String(value || 'Auto');
}

function effectiveCompanionPreferences() {
  var raw = companionPreferences();
  var overrides = overlayCompanion.overrides || {};
  var preset = String(raw.preset || 'balanced_partner');
  var pack = companionProfilePack();
  var presetDefaults = {
    quiet_operator: {
      proactivity: 'low',
      tone_balance: 'balanced',
      focus_mode: 'work',
      verbosity: 'low',
    },
    balanced_partner: {
      proactivity: 'medium',
      tone_balance: 'balanced',
      focus_mode: 'balanced',
      verbosity: 'medium',
    },
    warm_companion: {
      proactivity: 'high',
      tone_balance: 'soothing',
      focus_mode: 'companion',
      verbosity: 'high',
    },
    focused_foreman: {
      proactivity: 'high',
      tone_balance: 'pushing',
      focus_mode: 'work',
      verbosity: 'low',
    },
  };
  var defaults = presetDefaults[preset] || presetDefaults.balanced_partner;
  var prefs = {
    preset: preset,
    profile_pack: pack.id,
    proactivity: String(raw.proactivity || defaults.proactivity || 'medium'),
    tone_balance: String(raw.tone_balance || defaults.tone_balance || 'balanced'),
    focus_mode: String(raw.focus_mode || defaults.focus_mode || 'balanced'),
    verbosity: String(raw.verbosity || defaults.verbosity || 'medium'),
  };
  prefs.proactivity = shiftScale(prefs.proactivity, Number(pack.proactivity_bias || 0));
  prefs.verbosity = shiftScale(prefs.verbosity, Number(pack.verbosity_bias || 0));
  if (pack.focus_bias && prefs.focus_mode === 'balanced') prefs.focus_mode = pack.focus_bias;
  if (pack.tone_bias && prefs.tone_balance === 'balanced') prefs.tone_balance = pack.tone_bias;
  if (overrides.proactivity === 'high' || overrides.proactivity === 'low') {
    prefs.proactivity = overrides.proactivity;
  }
  if (overrides.proactivity === 'high' && prefs.verbosity === 'low') {
    prefs.verbosity = 'medium';
  }
  if (overrides.proactivity === 'low' && prefs.verbosity === 'high') {
    prefs.verbosity = 'medium';
  }
  return prefs;
}

function presetLabel(value) {
  if (window.HermesCompanionLines && typeof window.HermesCompanionLines.label === 'function') {
    return window.HermesCompanionLines.label('preset', value, 'Balanced Partner');
  }
  var labels = {
    quiet_operator: 'Quiet Operator',
    balanced_partner: 'Balanced Partner',
    warm_companion: 'Warm Companion',
    focused_foreman: 'Focused Foreman',
  };
  return labels[String(value || '')] || String(value || 'Balanced Partner');
}

function toneBalanceLabel(value) {
  if (window.HermesCompanionLines && typeof window.HermesCompanionLines.label === 'function') {
    return window.HermesCompanionLines.label('tone_balance', value, '平衡');
  }
  var labels = {
    soothing: '安抚',
    balanced: '平衡',
    pushing: '推进',
  };
  return labels[String(value || '')] || String(value || '平衡');
}

function focusModeLabel(value) {
  if (window.HermesCompanionLines && typeof window.HermesCompanionLines.label === 'function') {
    return window.HermesCompanionLines.label('focus_mode', value, '均衡');
  }
  var labels = {
    work: '工作',
    balanced: '均衡',
    companion: '陪伴',
  };
  return labels[String(value || '')] || String(value || '均衡');
}

function verbosityLabel(value) {
  if (window.HermesCompanionLines && typeof window.HermesCompanionLines.label === 'function') {
    return window.HermesCompanionLines.label('verbosity', value, '正常');
  }
  var labels = {
    low: '简洁',
    medium: '正常',
    high: '多话',
  };
  return labels[String(value || '')] || String(value || '正常');
}

function phaseLabel(value) {
  if (window.HermesCompanionLines && typeof window.HermesCompanionLines.label === 'function') {
    return window.HermesCompanionLines.label('session_phase', value, '热身');
  }
  var labels = {
    warmup: '热身',
    deep_work: '深水区',
    blocked: '受阻',
    cooldown: '缓冲',
    wrap_up: '收尾',
  };
  return labels[String(value || '')] || String(value || '热身');
}

function stanceLabel(value) {
  if (window.HermesCompanionLines && typeof window.HermesCompanionLines.label === 'function') {
    return window.HermesCompanionLines.label('stance', value, '轻推');
  }
  var labels = {
    push: '轻推',
    guard: '守位',
    soothe: '安抚',
    quiet: '静陪',
    close: '收陪',
  };
  return labels[String(value || '')] || String(value || '轻推');
}

function rhythmLabel(value) {
  if (window.HermesCompanionLines && typeof window.HermesCompanionLines.label === 'function') {
    return window.HermesCompanionLines.label('rhythm', value, '稳流推进');
  }
  var labels = {
    steady_flow: '稳流推进',
    approval_fragmented: '审批打断',
    trial_loop: '试错循环',
    long_haul: '长程推进',
    return_after_idle: '回流返场',
  };
  return labels[String(value || '')] || String(value || '稳流推进');
}

function noiseBudgetLabel(value) {
  if (window.HermesCompanionLines && typeof window.HermesCompanionLines.label === 'function') {
    return window.HermesCompanionLines.label('noise_budget', value, '均衡陪跑');
  }
  var labels = {
    low: '低噪陪跑',
    medium: '均衡陪跑',
    high: '高触达提醒',
  };
  return labels[String(value || '')] || String(value || '均衡陪跑');
}

function quietModeLabel(value) {
  if (window.HermesCompanionLines && typeof window.HermesCompanionLines.label === 'function') {
    return window.HermesCompanionLines.label('quiet_mode', value, '正常');
  }
  var labels = {
    off: '正常',
    important: '重要优先',
    silent: '静音',
  };
  return labels[String(value || '')] || String(value || '正常');
}

function taskContextLabel(value) {
  if (window.HermesCompanionLines && typeof window.HermesCompanionLines.label === 'function') {
    return window.HermesCompanionLines.label('task_context', value, '一般陪跑');
  }
  var labels = {
    coding: '写码调试',
    review: '拍板决位',
    shell_heavy: '命令流程',
    browser_heavy: '网页流程',
    approval_heavy: '审批等待',
    general: '一般陪跑',
  };
  return labels[String(value || '')] || String(value || '一般陪跑');
}

function taskContextNoteLine() {
  var runtime = window.HermesCompanionLines && typeof window.HermesCompanionLines.contextNote === 'function'
    ? window.HermesCompanionLines.contextNote({
        context: companionTaskContext(),
      })
    : '';
  if (runtime) return runtime;
  var context = companionTaskContext();
  var category = String(context.category || 'general');
  var commandFamily = String(context.command_family || '');
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

function phaseNoteLine() {
  var runtime = window.HermesCompanionLines && typeof window.HermesCompanionLines.phaseLine === 'function'
    ? window.HermesCompanionLines.phaseLine({
        phase: companionPhase(),
      })
    : '';
  if (runtime) return runtime;
  var phase = companionPhase();
  var sessionPhase = String(phase.session_phase || 'warmup');
  var stance = String(phase.stance || 'push');
  var rhythm = String(phase.rhythm || 'steady_flow');
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
  return '我会跟住你依家呢段工作节奏调整陪伴方式。';
}

function workflowCheckpointLabel() {
  var runtime = window.HermesCompanionLines && typeof window.HermesCompanionLines.workflowCheckpoint === 'function'
    ? window.HermesCompanionLines.workflowCheckpoint({
        phase: companionPhase(),
        semantic: companionSemanticTask(),
        companionState: companionState,
        mode: companionState.mode,
        sessionAgeMinutes: minutesSince(companionState.session_started_at),
      })
    : '';
  if (runtime) return runtime;
  var phase = companionPhase();
  var sessionPhase = String(phase.session_phase || 'warmup');
  var rhythm = String(phase.rhythm || 'steady_flow');
  if (companionState.mode === 'review' || companionState.mode === 'waiting') return '卡住处理中';
  if (companionState.mode === 'failed') return '恢复处理中';
  if (companionState.mode === 'running') {
    if (rhythm === 'return_after_idle') return '回流恢复';
    if (sessionPhase === 'deep_work' || rhythm === 'long_haul') return '深潜推进';
    if (companionState.session_open && minutesSince(companionState.session_started_at) < 2) return '启动中';
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

function workflowHintLine() {
  var runtime = window.HermesCompanionLines && typeof window.HermesCompanionLines.workflowHint === 'function'
    ? window.HermesCompanionLines.workflowHint({
        phase: companionPhase(),
        context: companionTaskContext(),
        semantic: companionSemanticTask(),
      })
    : '';
  if (runtime) return runtime;
  var phase = companionPhase();
  var context = companionTaskContext();
  var sessionPhase = String(phase.session_phase || 'warmup');
  var rhythm = String(phase.rhythm || 'steady_flow');
  var category = String(context.category || 'general');
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
  return '当前像正常推进段，我会继续守住节奏变化。';
}

function workflowEscalationLabel() {
  var runtime = window.HermesCompanionLines && typeof window.HermesCompanionLines.workflowEscalation === 'function'
    ? window.HermesCompanionLines.workflowEscalation({
        phase: companionPhase(),
        semantic: companionSemanticTask(),
        companionState: companionState,
        mode: companionState.mode,
      })
    : '';
  if (runtime) return runtime;
  var phase = companionPhase();
  var sessionPhase = String(phase.session_phase || 'warmup');
  var rhythm = String(phase.rhythm || 'steady_flow');
  if (companionState.mode === 'review' || companionState.mode === 'waiting') {
    if (companionState.blocking_nudges >= 2) return '明确提醒';
    if (companionState.blocking_nudges >= 1) return '轻催守位';
    return '陪等守位';
  }
  if (companionState.mode === 'running') {
    if (companionState.running_nudges >= 2 && sessionPhase !== 'deep_work') return '停滞提醒';
    if (companionState.running_nudges >= 1) return '轻提醒';
    return sessionPhase === 'deep_work' ? '静陪观察' : '推进观察';
  }
  if (companionState.mode === 'failed' || companionState.pending_failure_comfort) return '恢复提示';
  if (sessionPhase === 'wrap_up') return '收尾确认';
  if (rhythm === 'return_after_idle') return '返场恢复';
  if (sessionPhase === 'cooldown') return '缓冲观察';
  return '正常陪跑';
}

function workflowNextStepLine() {
  var runtime = window.HermesCompanionLines && typeof window.HermesCompanionLines.workflowNext === 'function'
    ? window.HermesCompanionLines.workflowNext({
        phase: companionPhase(),
        context: companionTaskContext(),
        semantic: companionSemanticTask(),
        workflow: {
          hint: workflowHintLine(),
        },
        companionState: companionState,
        mode: companionState.mode,
        sessionAgeMinutes: minutesSince(companionState.session_started_at),
      })
    : '';
  if (runtime) return runtime;
  var phase = companionPhase();
  var context = companionTaskContext();
  var sessionPhase = String(phase.session_phase || 'warmup');
  var rhythm = String(phase.rhythm || 'steady_flow');
  var category = String(context.category || 'general');
  if (companionState.mode === 'running' && companionState.session_open && minutesSince(companionState.session_started_at) < 2) {
    return '先起稳头几步，我会帮你守住节奏。';
  }
  if (companionState.mode === 'review') {
    if (companionState.blocking_nudges >= 2) return '可以先定最细一步方向。';
    return category === 'review' ? '等你拍板后就可以继续推进。' : '呢下多半要你先定方向。';
  }
  if (companionState.mode === 'waiting') {
    if (category === 'approval_heavy') {
      return companionState.blocking_nudges >= 2 ? '值得回头确认授权、密码或批示。' : '先守住授权位，等确认落嚟。';
    }
    if (category === 'browser_heavy') return '可以望下页面仲系咪停在加载或跳转位。';
    return companionState.blocking_nudges >= 2 ? '值得追一下回应或补一个确认。' : '先守住等待位，等回应返嚟。';
  }
  if (companionState.mode === 'running') {
    if (companionState.running_nudges >= 2 && sessionPhase !== 'deep_work') {
      if (category === 'shell_heavy') return '可能值得睇下最新输出有冇停住。';
      if (category === 'coding') return '可能值得睇下最新错误位或输出。';
      if (category === 'browser_heavy') return '可以确认一下页面或流程位有冇卡住。';
      return '可能值得睇下输出、批示或者流程位。';
    }
    if (sessionPhase === 'deep_work' || rhythm === 'long_haul') return '先保持连续推进，我会少啲插嘴。';
  }
  if (companionState.mode === 'failed' || rhythm === 'trial_loop') return '可以先收窄一个最细切入点，再慢慢试返。';
  if (rhythm === 'return_after_idle') return '先接返上一段最近停低嗰个位。';
  if (sessionPhase === 'wrap_up') return '可以确认结果后，再慢慢收尾。';
  return workflowHintLine();
}

function workflowStatusLine() {
  var runtime = window.HermesCompanionLines && typeof window.HermesCompanionLines.workflowStatus === 'function'
    ? window.HermesCompanionLines.workflowStatus({
        phase: companionPhase(),
        semantic: companionSemanticTask(),
        companionState: companionState,
        mode: companionState.mode,
        sessionAgeMinutes: minutesSince(companionState.session_started_at),
      })
    : '';
  if (runtime) return runtime;
  var checkpoint = workflowCheckpointLabel();
  var escalation = workflowEscalationLabel();
  if (companionState.mode === 'running' && companionState.session_open && minutesSince(companionState.session_started_at) < 2) {
    return checkpoint;
  }
  if (!escalation || escalation === '正常陪跑') return checkpoint;
  return checkpoint + ' / ' + escalation;
}

var lastWorkflowTrail = { key: '', at: 0 };
var lastInsightTrail = { key: '', at: 0 };

function recordWorkflowTrail(kind, line, severity) {
  var text = singleLineText(line || '', 180);
  if (!text) return;
  var key = String(kind || 'workflow') + '|' + text;
  var now = Date.now();
  if (lastWorkflowTrail.key === key && (now - lastWorkflowTrail.at) < 12000) return;
  lastWorkflowTrail = { key: key, at: now };
  recentEvents.unshift({
    id: 'workflow-' + String(now),
    type: 'workflow',
    group: 'workflow',
    text: text,
    severity: severity || 'info',
    createdAt: new Date(now).toISOString()
  });
  if (recentEvents.length > RECENT_EVENT_LIMIT) recentEvents.length = RECENT_EVENT_LIMIT;
  renderRecentEvents();
  logCompanion('workflow-history', {
    kind: String(kind || 'workflow'),
    severity: severity || 'info',
    line: text,
  });
}

function recordInsightTrail() {
  var insight = companionInsight();
  var trend = insightTrendLabel(insight.trend_key);
  var risk = insightRiskLabel(insight.risk_key);
  var pattern = insightPatternLabel(insight.pattern_key);
  var summary = insightSummaryLine();
  var key = [trend, risk, pattern, summary].join('|');
  var now = Date.now();
  if (lastInsightTrail.key === key && (now - lastInsightTrail.at) < 60000) return;
  lastInsightTrail = { key: key, at: now };
  recordWorkflowTrail(
    'insight-note',
    '趋势观察 · ' + summary,
    String(insight.risk_key || 'none') === 'none' ? 'info' : 'warning'
  );
  logCompanion('insight-history', {
    trend: trend,
    risk: risk,
    pattern: pattern,
    summary: summary,
  });
}

function recordWorkflowSignal(kind, stage) {
  if ((kind === 'waiting_care' || kind === 'review_care') && stage >= 2) {
    recordWorkflowTrail(
      'blocked-escalation',
      workflowStatusLine() + ' · ' + workflowNextStepLine(),
      stage >= 3 ? 'warning' : 'info'
    );
    logCompanion('blocked-escalation', {
      kind: kind,
      stage: stage,
      checkpoint: workflowCheckpointLabel(),
      status: workflowStatusLine(),
      hint: workflowHintLine(),
      next: workflowNextStepLine(),
    });
    logCompanion('next-step-hint', {
      kind: kind,
      stage: stage,
      hint: workflowHintLine(),
      next: workflowNextStepLine(),
    });
    return;
  }
  if (kind === 'long_running' && stage >= 2 && String(companionPhase().session_phase || '') !== 'deep_work') {
    recordWorkflowTrail(
      'stagnation-detected',
      workflowStatusLine() + ' · ' + workflowNextStepLine(),
      'warning'
    );
    logCompanion('stagnation-detected', {
      kind: kind,
      stage: stage,
      phase: phaseLabel(companionPhase().session_phase),
      rhythm: rhythmLabel(companionPhase().rhythm),
      status: workflowStatusLine(),
      hint: workflowHintLine(),
      next: workflowNextStepLine(),
    });
    logCompanion('next-step-hint', {
      kind: kind,
      stage: stage,
      hint: workflowHintLine(),
      next: workflowNextStepLine(),
    });
  }
}

function controlStateLine() {
  var prefs = effectiveCompanionPreferences();
  return [
    String(prefs.proactivity || 'medium'),
    focusModeLabel(prefs.focus_mode),
    verbosityLabel(prefs.verbosity),
  ].join(' / ');
}

function overrideRemainingText(iso) {
  if (!iso) return '';
  var untilMs = Date.parse(String(iso));
  if (!Number.isFinite(untilMs)) return '';
  var diffMs = untilMs - Date.now();
  if (diffMs <= 0) return '';
  var totalMinutes = Math.max(1, Math.round(diffMs / 60000));
  if (totalMinutes < 60) return totalMinutes + 'm';
  var hours = Math.floor(totalMinutes / 60);
  var minutes = totalMinutes % 60;
  if (minutes === 0) return hours + 'h';
  return hours + 'h ' + minutes + 'm';
}

function overrideStateLine() {
  var overrides = overlayCompanion.overrides || {};
  var pack = companionProfilePack();
  var parts = [];
  if (overrides.temp_quiet_until && mutedByOverlayOverride('temp_quiet_until')) {
    parts.push('1h quiet' + (overrideRemainingText(overrides.temp_quiet_until) ? ' (' + overrideRemainingText(overrides.temp_quiet_until) + ')' : ''));
  }
  if (overrides.quiet_tonight_until && mutedByOverlayOverride('quiet_tonight_until')) {
    parts.push('今晚安静' + (overrideRemainingText(overrides.quiet_tonight_until) ? ' (' + overrideRemainingText(overrides.quiet_tonight_until) + ')' : ''));
  }
  if (overrides.proactivity === 'high') parts.push('更主动');
  if (overrides.proactivity === 'low') parts.push('更安静');
  if (!pack.auto) parts.push('Pack ' + profilePackLabel(pack.requested));
  if (parts.length) return parts.join(' / ');
  if (mutedNow()) return '临时静音中';
  if (notificationPrefs.quiet_mode === 'important') return '只保留重要提醒';
  if (notificationPrefs.quiet_mode === 'silent') return '当前静音';
  return '无临时覆盖';
}

function actionOverrideState() {
  var overrides = overlayCompanion.overrides || {};
  var pack = companionProfilePack();
  return {
    quiet1h: !!(overrides.temp_quiet_until && mutedByOverlayOverride('temp_quiet_until')),
    quietTonight: !!(overrides.quiet_tonight_until && mutedByOverlayOverride('quiet_tonight_until')),
    moreActive: overrides.proactivity === 'high',
    moreQuiet: overrides.proactivity === 'low',
    packAuto: pack.requested === 'auto',
    packClassic: pack.requested === 'classic_default',
    packCat: pack.requested === 'cat_operator',
    packOnion: pack.requested === 'onion_watcher',
    packDragon: pack.requested === 'dragon_guard',
    packShinchan: pack.requested === 'shinchan_playmate',
    packCelestia: pack.requested === 'celestia_princess',
    panelDetails: companionPanelDetailsOpen,
  };
}

function actionButtonClass(active, clear) {
  var classes = ['companion-action-btn'];
  if (active) classes.push('active');
  if (clear) classes.push('clear');
  return classes.join(' ');
}

function decisionExplainLine() {
  var runtime = window.HermesCompanionLines && typeof window.HermesCompanionLines.decisionExplain === 'function'
    ? window.HermesCompanionLines.decisionExplain({
        phase: companionPhase(),
        overrides: overlayCompanion.overrides || {},
        quiet_mode: notificationPrefs.quiet_mode,
        muted: mutedNow(),
        rule: companionRuleRuntime(),
      })
    : '';
  if (runtime) return runtime;
  var phase = companionPhase();
  var overrides = overlayCompanion.overrides || {};
  if (overrides.proactivity === 'high') {
    return '当前开了更主动模式，我会更早出声，但仍会跟住 phase 收放。';
  }
  if (overrides.proactivity === 'low') {
    return '当前开了更安静模式，我会放慢提醒节奏，减少插嘴。';
  }
  if (mutedNow()) {
    return '当前有静音窗口，普通陪伴气泡会先让路。';
  }
  if (notificationPrefs.quiet_mode === 'important') {
    return '当前只保留重要提醒，普通陪伴会主动收敛。';
  }
  if (notificationPrefs.quiet_mode === 'silent') {
    return '当前进入静音模式，只保留必要状态变化。';
  }
  if (String(phase.noise_budget || 'medium') === 'low' && String(phase.session_phase || '') === 'deep_work') {
    return '你似乎进入深度工作，我会主动降噪，减少插嘴。';
  }
  if (String(phase.session_phase || '') === 'blocked' && String(phase.stance || '') === 'guard') {
    return '你依家卡在等待或拍板位，我会提高存在感守住关键提醒。';
  }
  if (String(phase.rhythm || '') === 'trial_loop' && String(phase.stance || '') === 'soothe') {
    return '依家似系试错循环，我会偏安抚，减少催促。';
  }
  var rule = companionRuleRuntime();
  if (rule && rule.note) return String(rule.note);
  return phaseNoteLine();
}

function expressionSummaryLine() {
  var runtime = window.HermesCompanionLines && typeof window.HermesCompanionLines.expressionSummary === 'function'
    ? window.HermesCompanionLines.expressionSummary({
        expression: companionExpression(),
      })
    : '';
  if (runtime) return runtime;
  var expression = companionExpression();
  var summaryKey = String(expression.summary_key || 'warming_up');
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
  return '最近仲系热身期，我会先跟住你当下节奏。';
}

function styleProfileLabel(style) {
  if (window.HermesCompanionLines && typeof window.HermesCompanionLines.label === 'function') {
    return window.HermesCompanionLines.label('style_profile', style, '热身适应型');
  }
  var labels = {
    steady_worker: '稳阵推进型',
    late_night_builder: '夜战推进型',
    approval_magnet: '审批缠身型',
    trial_and_error: '边试边拆型',
    settling: '热身适应型',
  };
  return labels[style] || style || '热身适应型';
}

function insightTrendLabel(value) {
  if (window.HermesCompanionLines && typeof window.HermesCompanionLines.label === 'function') {
    return window.HermesCompanionLines.label('insight_trend', value, '热身中');
  }
  var labels = {
    warming_up: '热身中',
    steady_gain: '稳步上扬',
    deepening: '越做越深',
    approval_drag: '审批拖慢',
    fragmented: '节奏偏碎',
    night_load: '夜战偏多',
    recovery_loop: '恢复循环',
  };
  return labels[String(value || '')] || String(value || '热身中');
}

function insightRiskLabel(value) {
  if (window.HermesCompanionLines && typeof window.HermesCompanionLines.label === 'function') {
    return window.HermesCompanionLines.label('insight_risk', value, '低');
  }
  var labels = {
    none: '低',
    sleep_debt: '夜战负荷',
    failure_spike: '试错偏高',
    approval_drag: '审批拖压',
    unfinished_tail: '收尾偏少',
    stalled_load: '长任务停滞',
  };
  return labels[String(value || '')] || String(value || '低');
}

function insightPatternLabel(value) {
  if (window.HermesCompanionLines && typeof window.HermesCompanionLines.label === 'function') {
    return window.HermesCompanionLines.label('insight_pattern', value, '起步铺排');
  }
  var labels = {
    early_ramp: '起步铺排',
    steady_cadence: '稳节奏',
    deep_focus: '深潜专注',
    approval_bound: '审批牵引',
    stop_start: '停一停再返场',
    retry_spiral: '试错修复',
    night_push: '夜战推进',
  };
  return labels[String(value || '')] || String(value || '起步铺排');
}

function insightSummaryLine() {
  var runtime = window.HermesCompanionLines && typeof window.HermesCompanionLines.insightLine === 'function'
    ? window.HermesCompanionLines.insightLine({
        insight: companionInsight(),
      })
    : '';
  if (runtime) return runtime;
  var insight = companionInsight();
  var trend = String(insight.trend_key || 'warming_up');
  var risk = String(insight.risk_key || 'none');
  var pattern = String(insight.pattern_key || 'early_ramp');
  if (trend === 'night_load') return '近两周夜战偏多，我会多留意你收工同休息。';
  if (trend === 'approval_drag') return '近几日审批位比较黏，我会继续偏守位同轻提醒。';
  if (trend === 'deepening') return '近几日长任务比例上升，整体更像深潜推进。';
  if (trend === 'steady_gain') return '近几日推进算稳，节奏比较成形。';
  if (trend === 'fragmented') return '近几日任务偏碎，我会帮你守返主线。';
  if (trend === 'recovery_loop') return '最近仲喺恢复段，我会偏安抚同陪你收窄。';
  if (risk === 'sleep_debt') return '近期夜战负荷偏高，我会更克制但更留意收尾。';
  if (risk === 'unfinished_tail') return '最近开得多、收得少，我会多帮你盯住收尾。';
  if (pattern === 'approval_bound') return '最近工作 pattern 偏向审批牵引，下一步通常卡在确认位。';
  return '最近整体仲喺成形期，我会继续按趋势同风险收放。';
}

function rollingMemoryLine() {
  var runtime = window.HermesCompanionLines && typeof window.HermesCompanionLines.rollingMemoryLine === 'function'
    ? window.HermesCompanionLines.rollingMemoryLine({
        expression: companionExpression(),
        memory: petMemory,
      })
    : '';
  if (runtime) return runtime;
  var expression = companionExpression();
  var summaryKey = String(expression.summary_key || 'warming_up');
  var approval3d = Number(expression.approval_waits_3d || 0);
  var review3d = Number(expression.review_waits_3d || 0);
  var tasks3d = Number(expression.tasks_completed_3d || 0);
  var nightStreak = Number(expression.night_streak || 0);
  var night7d = Number(expression.night_days_7d || 0);
  var fails = Number(petMemory.consecutive_failures || 0);

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
  return '今日先跟住你当前节奏，等记忆再慢慢长出来。';
}

function companionSpeechTier(kind) {
  var importantKinds = {
    review_care: true,
    waiting_care: true,
    failure_comfort: true,
    late_night: true,
    long_running: true,
  };
  return importantKinds[kind] ? 'important' : 'ambient';
}

function preferenceDelayMultiplier(kind) {
  var prefs = effectiveCompanionPreferences();
  var factor = 1;
  if (prefs.proactivity === 'low') factor *= 1.35;
  else if (prefs.proactivity === 'high') factor *= 0.8;
  if (prefs.focus_mode === 'work') {
    if (kind === 'blocking' || kind === 'late_night') factor *= 0.95;
    else factor *= 1.2;
  } else if (prefs.focus_mode === 'companion') {
    factor *= kind === 'blocking' ? 0.85 : 0.9;
  }
  if (prefs.verbosity === 'low') factor *= 1.1;
  else if (prefs.verbosity === 'high') factor *= 0.9;
  return factor;
}

function loadVisualBootstrap() {
  try {
    var raw = JSON.parse(window.localStorage.getItem(VISUAL_BOOTSTRAP_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return null;
    return {
      species: String(raw.species || ''),
      variant: String(raw.variant || 'normal'),
      shiny: !!raw.shiny,
      custom_pet: raw.custom_pet && typeof raw.custom_pet === 'object' ? raw.custom_pet : null,
    };
  } catch (_) {
    return null;
  }
}

function saveVisualBootstrap() {
  try {
    window.localStorage.setItem(VISUAL_BOOTSTRAP_KEY, JSON.stringify({
      species: state.species || '',
      variant: state.variant || 'normal',
      shiny: !!state.shiny,
      custom_pet: state.custom_pet || null,
    }));
  } catch (_) {}
}

function rotatePetMemoryDay() {
  var today = todayKey();
  if (petMemory.today.date === today) return;
  logCompanion('rotate-day', { from: petMemory.today.date, to: today });
  petMemory.today = Object.assign(defaultPetMemory().today, { date: today });
  savePetMemory();
}

function rotateOverlayCompanionDay() {
  var today = todayKey();
  if (overlayCompanion.day.date === today) return;
  overlayCompanion.day = Object.assign(defaultOverlayCompanionState().day, { date: today });
  saveOverlayCompanionState();
}

function petMemoryMarkActive() {
  rotatePetMemoryDay();
  var today = todayKey();
  if (petMemory.last_active_date !== today) {
    petMemory.last_active_date = today;
    petMemory.active_days += 1;
    logCompanion('active-day', { active_days: petMemory.active_days, date: today });
  }
  if (!petMemory.today.first_active_at) petMemory.today.first_active_at = isoNow();
  petMemory.today.last_active_at = isoNow();
  var hour = zonedHour(new Date());
  if (isLateNightWindow(hour) && !petMemory.today.night_marked) {
    petMemory.today.night_marked = true;
    petMemory.night_sessions += 1;
    petMemory.work_style_bias.late_night_builder += 1;
    logCompanion('night-session', { night_sessions: petMemory.night_sessions });
  }
  savePetMemory();
}

function petMemoryRecordApprovalWait(kind) {
  rotatePetMemoryDay();
  petMemory.approval_wait_count += 1;
  petMemory.today.approval_waits += 1;
  if (kind === 'review') petMemory.today.review_waits += 1;
  petMemory.work_style_bias.approval_magnet += 1;
  logCompanion('approval-wait', {
    approval_wait_count: petMemory.approval_wait_count,
    today_approval_waits: petMemory.today.approval_waits,
  });
  savePetMemory();
}

function petMemoryRecordFailure(kind) {
  rotatePetMemoryDay();
  petMemory.consecutive_failures += 1;
  petMemory.work_style_bias.trial_and_error += 1;
  petMemory.recent_failures.unshift({ at: isoNow(), kind: kind || 'failed' });
  petMemory.recent_failures = petMemory.recent_failures.slice(0, 8);
  logCompanion('failure', {
    kind: kind || 'failed',
    consecutive_failures: petMemory.consecutive_failures,
  });
  savePetMemory();
}

function petMemoryRecordCompletion() {
  rotatePetMemoryDay();
  petMemory.today.tasks_completed += 1;
  petMemory.today.last_idle_at = isoNow();
  petMemory.work_style_bias.steady_worker += 1;
  if (petMemory.consecutive_failures > 0) petMemory.consecutive_failures = 0;
  logCompanion('completion', {
    tasks_completed: petMemory.today.tasks_completed,
    consecutive_failures: petMemory.consecutive_failures,
  });
  savePetMemory();
}

function minutesSince(isoText) {
  if (!isoText) return Infinity;
  var ms = Date.now() - Date.parse(isoText);
  return Number.isFinite(ms) ? ms / 60000 : Infinity;
}

function shouldSpeakCompanion(kind) {
  if (mutedNow()) return false;
  var mode = notificationPrefs.quiet_mode || 'off';
  var phase = companionPhase();
  var prefs = effectiveCompanionPreferences();
  if (mode === 'silent') return false;
  if (mode === 'important') return companionSpeechTier(kind) === 'important';
  if (prefs.proactivity === 'low' && companionSpeechTier(kind) !== 'important') {
    if (kind === 'idle_nudge' || kind === 'day_greeting' || kind === 'wrap_up') return false;
  }
  if (prefs.focus_mode === 'work') {
    if (kind === 'idle_nudge' || kind === 'day_greeting') return false;
    if (String(phase.session_phase || '') === 'deep_work' && kind === 'long_running') return false;
  }
  if (prefs.focus_mode === 'companion' && companionSpeechTier(kind) === 'ambient') {
    if (kind === 'idle_nudge' && minutesSince(overlayCompanion.cooldowns.idle_nudge_at) < 20) return false;
  }
  if (String(phase.noise_budget || 'medium') === 'low') {
    if (kind === 'idle_nudge' || kind === 'day_greeting') return false;
    if (kind === 'long_running' && companionState.running_nudges <= 0) return false;
  }
  return true;
}

var petMemoryMeta = (window.hermesPetAPI && typeof window.hermesPetAPI.getPetMemoryMeta === 'function')
  ? (window.hermesPetAPI.getPetMemoryMeta() || {})
  : {};

var petMemory = loadPetMemory();
var overlayCompanion = loadOverlayCompanionState();
rotatePetMemoryDay();
rotateOverlayCompanionDay();
logCompanion('preferences-loaded', companionPreferences());

var companionState = {
  mode: 'idle',
  session_open: false,
  session_started_at: null,
  session_started_tasks_started: 0,
  session_started_tasks_completed: 0,
  session_started_approval_waits: 0,
  session_started_review_waits: 0,
  running_started_at: null,
  running_nudges: 0,
  blocking_nudges: 0,
  pending_failure_comfort: false,
  running_care_timers: [],
  blocking_care_timers: [],
  thinking_care_timers: [],
  thinking_started_at: null,
  thinking_token: 0,
  thinking_stage: 0,
  late_night_timer: null,
  wrap_up_timer: null,
};

const RECENT_EVENT_LIMIT = 6;
const BUBBLE_THROTTLE_MS = 2500;
const STATUS_THROTTLE_MS = 5000;
const DEFAULT_NOTIFICATION_PREFS = {
  notification_profile: 'normal',
  muted_until: null,
  quiet_mode: 'off',
  bubble_throttle_seconds: BUBBLE_THROTTLE_MS / 1000,
  show_tray_on_urgent: true,
  show_idle_bubbles: true,
};
const recentEvents = [];
const lastBubbleByKey = Object.create(null);
const lastBubbleByChannel = Object.create(null);
let notificationPrefs = { ...DEFAULT_NOTIFICATION_PREFS };
let trayAttention = false;
var lastCompanionSummary = '';
var lastCompanionPanel = '';
var lastSessionThreadKey = '';
var companionPanelDetailsOpen = false;
let trayLayoutRaf = 0;
let trayLayoutLocked = false;
let trayLayoutDirtyWhileLocked = false;
let trayLayoutLockedHeightPx = '';
let trayLayoutLockedWidthPx = '';

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function companionRenderAdapterInput() {
  var today = petMemory.today || {};
  var overlayDay = overlayCompanion.day || {};
  var style = dominantWorkStyle() || 'settling';
  var expression = companionExpression();
  var phase = companionPhase();
  var prefs = effectiveCompanionPreferences();
  var pack = companionProfilePack();
  var context = companionTaskContext();
  var insight = companionInsight();
  var semantic = companionSemanticTask();
  var thread = companionSessionThread();
  var narrative = companionNarrative();
  var recentTaskLine = String(narrative.recent_line || '').trim();
  var actions = actionOverrideState();
  var rawSemanticFocus = (window.HermesCompanionLines && typeof window.HermesCompanionLines.semanticTaskLine === 'function'
    ? window.HermesCompanionLines.semanticTaskLine({ semantic: semantic, narrative: narrative, context: context, phase: phase, insight: insight })
    : '') || narrative.focus_line || semantic.title || semantic.summary || semantic.step || '';
  var semanticFocus = readableTaskDisplayLine(rawSemanticFocus, 96);
  var semanticNeed = (window.HermesCompanionLines && typeof window.HermesCompanionLines.semanticNeedLine === 'function'
    ? window.HermesCompanionLines.semanticNeedLine({ semantic: semantic, narrative: narrative, context: context, phase: phase, insight: insight })
    : '') || narrative.need_line || semantic.next_action || semantic.blocker_detail || '';
  var adapter = {
    today: today,
    overlayDay: overlayDay,
    memory: petMemory,
    prefs: prefs,
    pack: pack,
    context: context,
    phase: phase,
    insight: insight,
    semantic: semantic,
    session_thread: thread,
    narrative: narrative,
    expression: expression,
    actions: actions,
    profile_label: presetLabel(prefs.preset),
    pack_label: pack.label,
    pack_requested_label: profilePackLabel(pack.requested),
    pack_summary: pack.summary,
    pack_auto: !!pack.auto,
    prefs_line: String(prefs.proactivity || 'medium') + ' / ' + toneBalanceLabel(prefs.tone_balance) + ' / ' + focusModeLabel(prefs.focus_mode) + ' / ' + verbosityLabel(prefs.verbosity),
    prefs_short: String(prefs.proactivity || 'medium') + ' / ' + toneBalanceLabel(prefs.tone_balance),
    night_sessions: Number(petMemory.night_sessions || 0),
    consecutive_failures: Number(petMemory.consecutive_failures || 0),
    style_label: styleProfileLabel(style),
    context_label: taskContextLabel(context.category),
    context_confidence: String(context.confidence || 'low'),
    phase_label: phaseLabel(phase.session_phase),
    stance_label: stanceLabel(phase.stance),
    workflow_status: workflowStatusLine(),
    workflow_next: workflowNextStepLine(),
    workflow_hint: workflowHintLine(),
    rhythm_label: rhythmLabel(phase.rhythm),
    trend_label: insightTrendLabel(insight.trend_key),
    risk_label: insightRiskLabel(insight.risk_key),
    pattern_label: insightPatternLabel(insight.pattern_key),
    semantic_focus: semanticFocus,
    semantic_need: semanticNeed,
    thread_status: String(thread.status || ''),
    thread_title: String(thread.title || ''),
    thread_need: String(thread.need || ''),
    thread_wrap: String(thread.wrap_line || ''),
    noise_label: noiseBudgetLabel(phase.noise_budget),
    control_line: controlStateLine(),
    override_line: overrideStateLine(),
    tone: String(expression.tone || 'warming_up'),
    context_note: taskContextNoteLine(),
    decision_explain: decisionExplainLine(),
    expression_summary: expressionSummaryLine(),
    insight_line: insightSummaryLine(),
    phase_note: phaseNoteLine(),
    task_recent: recentTaskLine,
    rolling_memory: recentTaskLine || rollingMemoryLine(),
  };
  var narrativeRuntime = {};
  if (window.HermesCompanionNarrative && typeof window.HermesCompanionNarrative.build === 'function') {
    try {
      narrativeRuntime = window.HermesCompanionNarrative.build(adapter) || {};
    } catch (err) {
      logCompanion('narrative-runtime-error', { message: String(err && err.message || err || '') });
    }
  }
  adapter.narrative_runtime = narrativeRuntime;
  var sessionThread = adapter.session_thread || {};
  var sessionThreadLine = String(sessionThread.status || '') === 'completed'
    ? String(sessionThread.wrap_line || '')
    : String(sessionThread.title || sessionThread.summary || '');
  var sessionThreadNeed = String(sessionThread.need || '');
  var sessionThreadTimeline = Array.isArray(sessionThread.timeline)
    ? sessionThread.timeline.slice(-3).map(function(item) {
        return String((item && item.line) || '').trim();
      }).filter(Boolean).join(' / ')
    : '';
  adapter.narrative_thread = String(narrativeRuntime.thread_line || sessionThreadLine || narrative.thread_line || '');
  adapter.narrative_day = String(narrativeRuntime.day_line || narrative.day_line || '');
  adapter.narrative_risk = String(narrativeRuntime.risk_line || narrative.risk_line || '');
  adapter.narrative_next = String(narrativeRuntime.next_line || (sessionThreadNeed ? '下一步：' + sessionThreadNeed : '') || narrative.next_line || '');
  adapter.narrative_timeline = String(narrativeRuntime.timeline_line || sessionThreadTimeline || narrative.timeline_line || '');
  adapter.narrative_panel_story = String(narrativeRuntime.panel_story || adapter.narrative_thread || adapter.task_recent || '');
  adapter.narrative_panel_today = String(narrativeRuntime.panel_today || adapter.narrative_day || '');
  adapter.narrative_panel_timeline = String(narrativeRuntime.panel_timeline || adapter.narrative_timeline || '');
  return adapter;
}

function companionSummaryText() {
  var runtime = window.HermesCompanionLines && typeof window.HermesCompanionLines.summaryLines === 'function'
    ? window.HermesCompanionLines.summaryLines(companionRenderAdapterInput())
    : null;
  if (Array.isArray(runtime) && runtime.length) {
    return runtime.join('\n');
  }
  var today = petMemory.today || {};
  var style = dominantWorkStyle() || 'settling';
  var expression = companionExpression();
  var phase = companionPhase();
  var prefs = effectiveCompanionPreferences();
  var pack = companionProfilePack();
  var context = companionTaskContext();
  var adapter = companionRenderAdapterInput();
  return [
    'Story: ' + adapter.narrative_panel_story,
    'Need: ' + (adapter.semantic_need || adapter.workflow_next),
    'Timeline: ' + adapter.narrative_panel_timeline,
    'Today Line: ' + adapter.narrative_panel_today,
    'Details: ' + [
      presetLabel(prefs.preset),
      pack.label,
      taskContextLabel(context.category),
      phaseLabel(phase.session_phase),
      'Risk ' + insightRiskLabel(companionInsight().risk_key),
    ].filter(Boolean).join(' · '),
  ].join('\n');
}

function readableTaskDisplayLine(value, limit) {
  var line = singleLineText(value || '', limit || 120);
  return isUsefulRunningBubbleLine(line) ? line : '';
}

function companionPanelModel() {
  var runtime = window.HermesCompanionLines && typeof window.HermesCompanionLines.panelModel === 'function'
    ? window.HermesCompanionLines.panelModel(companionRenderAdapterInput())
    : null;
  if (runtime && typeof runtime === 'object') return runtime;
  var prefs = effectiveCompanionPreferences();
  var pack = companionProfilePack();
  var phase = companionPhase();
  var context = companionTaskContext();
  var expression = companionExpression();
  var insight = companionInsight();
  var actionState = actionOverrideState();
  return {
    profile: presetLabel(prefs.preset),
    pack: pack.label + (pack.auto ? ' · Auto' : ''),
    prefs: String(prefs.proactivity || 'medium') + ' / ' + toneBalanceLabel(prefs.tone_balance),
    context: taskContextLabel(context.category) + ' / ' + String(context.confidence || 'low'),
    phase: phaseLabel(phase.session_phase) + ' / ' + stanceLabel(phase.stance),
    workflow: workflowStatusLine(),
    rhythm: rhythmLabel(phase.rhythm),
    next: workflowNextStepLine(),
    workflow_line: workflowStatusLine() + ' · ' + workflowNextStepLine(),
    trend: insightTrendLabel(insight.trend_key),
    risk: insightRiskLabel(insight.risk_key),
    pattern: insightPatternLabel(insight.pattern_key),
    noise: noiseBudgetLabel(phase.noise_budget),
    control: controlStateLine(),
    override: overrideStateLine(),
    tone: String(expression.tone || 'warming_up'),
    pack_note: pack.summary,
    note: phaseNoteLine(),
    workflow_hint: workflowHintLine(),
    reason: taskContextNoteLine(),
    explain: decisionExplainLine(),
    now: companionRenderAdapterInput().narrative_panel_story || workflowStatusLine(),
    story: companionRenderAdapterInput().narrative_panel_story,
    today_story: companionRenderAdapterInput().narrative_panel_today,
    timeline: companionRenderAdapterInput().narrative_panel_timeline,
    summary: companionRenderAdapterInput().narrative_panel_story || companionRenderAdapterInput().task_recent || expressionSummaryLine(),
    insight: insightSummaryLine(),
    task: companionRenderAdapterInput().semantic_focus,
    need: companionRenderAdapterInput().thread_need || companionRenderAdapterInput().semantic_need,
    need_primary: companionRenderAdapterInput().thread_need || companionRenderAdapterInput().semantic_need || workflowNextStepLine(),
    details_a: 'Profile ' + presetLabel(prefs.preset) + ' · Pack ' + pack.label + ' · Prefs ' + String(prefs.proactivity || 'medium') + ' / ' + toneBalanceLabel(prefs.tone_balance),
    details_b: taskContextLabel(context.category) + '/' + String(context.confidence || 'low') + ' · ' + phaseLabel(phase.session_phase) + '/' + stanceLabel(phase.stance) + ' · ' + rhythmLabel(phase.rhythm) + ' · Risk ' + insightRiskLabel(insight.risk_key) + ' · Tone ' + String(expression.tone || 'warming_up'),
    actions: actionState,
    details_open: !!actionState.panelDetails,
    hasOverrides: actionState.quiet1h || actionState.quietTonight || actionState.moreActive || actionState.moreQuiet,
  };
}

function renderCompanionPanel() {
  if (!companionPanelEl) return '';
  var panel = companionPanelModel();
  var html = [
    '<div class="companion-panel-section companion-panel-now"><span class="companion-panel-label">Now</span><span class="companion-panel-value">' + escapeHtml(panel.now || panel.story || panel.summary) + '</span></div>',
    '<div class="companion-panel-section"><span class="companion-panel-label">Need</span><span class="companion-panel-value">' + escapeHtml(panel.need_primary || panel.need || panel.workflow_line) + '</span></div>',
    '<div class="companion-panel-section"><span class="companion-panel-label">Timeline</span><span class="companion-panel-value">' + escapeHtml(panel.timeline || '最近还没有可读任务线索。') + '</span></div>',
    '<div class="companion-panel-section"><span class="companion-panel-label">Today</span><span class="companion-panel-value">' + escapeHtml(panel.today_story || panel.reason) + '</span></div>',
    '<div class="companion-panel-actions">',
    '<button class="' + actionButtonClass(panel.actions.quiet1h, false) + '" data-action="quiet-1h" type="button">1h quiet</button>',
    '<button class="' + actionButtonClass(panel.actions.quietTonight, false) + '" data-action="quiet-tonight" type="button">今晚安静</button>',
    '<button class="' + actionButtonClass(panel.actions.moreActive, false) + '" data-action="more-active" type="button">更主动</button>',
    '<button class="' + actionButtonClass(panel.actions.moreQuiet, false) + '" data-action="more-quiet" type="button">更安静</button>',
    '<button class="' + actionButtonClass(panel.details_open, false) + '" data-action="details-toggle" type="button">Details</button>',
    '<button class="' + actionButtonClass(panel.hasOverrides, true) + '" data-action="clear-overrides" type="button">清除</button>',
    '</div>',
    '<div class="companion-panel-actions">',
    '<button class="' + actionButtonClass(panel.actions.packAuto, false) + '" data-action="pack:auto" type="button">Auto</button>',
    '<button class="' + actionButtonClass(panel.actions.packClassic, false) + '" data-action="pack:classic_default" type="button">平衡</button>',
    '<button class="' + actionButtonClass(panel.actions.packCat, false) + '" data-action="pack:cat_operator" type="button">安静</button>',
    '<button class="' + actionButtonClass(panel.actions.packOnion, false) + '" data-action="pack:onion_watcher" type="button">警醒</button>',
    '<button class="' + actionButtonClass(panel.actions.packDragon, false) + '" data-action="pack:dragon_guard" type="button">稳定</button>',
    '<button class="' + actionButtonClass(panel.actions.packShinchan, false) + '" data-action="pack:shinchan_playmate" type="button">活跃</button>',
    '<button class="' + actionButtonClass(panel.actions.packCelestia, false) + '" data-action="pack:celestia_princess" type="button">公主</button>',
    '</div>',
    '<div class="companion-panel-details' + (panel.details_open ? '' : ' hidden') + '">',
    '<div class="companion-panel-detail-line">' + escapeHtml(panel.details_a || '') + '</div>',
    '<div class="companion-panel-detail-line">' + escapeHtml(panel.details_b || '') + '</div>',
    '</div>',
  ].join('');
  companionPanelEl.innerHTML = html;
  companionPanelEl.classList.toggle('hidden', false);
  return JSON.stringify(panel);
}

function renderCompanionSummary() {
  if (!companionSummaryEl) return;
  var panelText = renderCompanionPanel();
  var text = companionSummaryText();
  companionSummaryEl.textContent = text;
  if (panelText && panelText !== lastCompanionPanel) {
    lastCompanionPanel = panelText;
    logCompanion('panel-render', { panel: JSON.parse(panelText) });
    logCompanion('panel-state', {
      profile: presetLabel(effectiveCompanionPreferences().preset),
      pack: companionProfilePack().label,
      context: taskContextLabel(companionTaskContext().category),
      phase: phaseLabel(companionPhase().session_phase),
      stance: stanceLabel(companionPhase().stance),
      workflow: workflowStatusLine(),
      rhythm: rhythmLabel(companionPhase().rhythm),
      trend: insightTrendLabel(companionInsight().trend_key),
      risk: insightRiskLabel(companionInsight().risk_key),
      pattern: insightPatternLabel(companionInsight().pattern_key),
      noise: noiseBudgetLabel(companionPhase().noise_budget),
      next: workflowNextStepLine(),
    });
    logCompanion('panel-reason', {
      reason: taskContextNoteLine(),
      workflow: workflowHintLine(),
      next: workflowNextStepLine(),
      insight: insightSummaryLine(),
      task: companionPanelModel().task,
      need: companionPanelModel().need,
      story: companionPanelModel().story,
      today: companionPanelModel().today_story,
      timeline: companionPanelModel().timeline,
      note: phaseNoteLine(),
      explain: decisionExplainLine(),
      summary: expressionSummaryLine(),
    });
    logCompanion('narrative-runtime', {
      story: companionRenderAdapterInput().narrative_panel_story,
      today: companionRenderAdapterInput().narrative_panel_today,
      risk: companionRenderAdapterInput().narrative_risk,
      next: companionRenderAdapterInput().narrative_next,
      timeline: companionRenderAdapterInput().narrative_timeline,
    });
    logCompanion('narrative-history', {
      timeline: companionRenderAdapterInput().narrative_timeline,
      recent: (companionNarrative().recent_lines || []).slice(0, 5),
    });
    logCompanion('workflow-checkpoint', {
      checkpoint: workflowCheckpointLabel(),
      status: workflowStatusLine(),
      escalation: workflowEscalationLabel(),
      phase: phaseLabel(companionPhase().session_phase),
      stance: stanceLabel(companionPhase().stance),
      rhythm: rhythmLabel(companionPhase().rhythm),
      hint: workflowHintLine(),
      next: workflowNextStepLine(),
    });
    logCompanion('control-state', {
      quiet_mode: quietModeLabel(notificationPrefs.quiet_mode),
      control: controlStateLine(),
      preset: presetLabel(effectiveCompanionPreferences().preset),
    });
    logCompanion('override-state', {
      override: overrideStateLine(),
      muted: mutedNow(),
      muted_until: notificationPrefs.muted_until || '',
    });
    logCompanion('decision-explained', {
      phase: phaseLabel(companionPhase().session_phase),
      stance: stanceLabel(companionPhase().stance),
      noise: noiseBudgetLabel(companionPhase().noise_budget),
      explain: decisionExplainLine(),
    });
    logCompanion('rule-engine-evaluated', companionRuleRuntime());
  }
  if (text !== lastCompanionSummary) {
    lastCompanionSummary = text;
    logCompanion('summary-render', {
      summary: text,
      memory_path: petMemoryMeta.path || '',
      summary_key: String((companionExpression() || {}).summary_key || ''),
    });
    logCompanion('summary-expression', {
      summary_key: String((companionExpression() || {}).summary_key || ''),
      line: expressionSummaryLine(),
      recent: rollingMemoryLine(),
      style: styleProfileLabel(dominantWorkStyle() || 'settling'),
    });
    logCompanion('insight-derived', {
      trend: insightTrendLabel(companionInsight().trend_key),
      risk: insightRiskLabel(companionInsight().risk_key),
      pattern: insightPatternLabel(companionInsight().pattern_key),
      summary: insightSummaryLine(),
    });
    recordInsightTrail();
    logCompanion('rhythm-summary', {
      phase: phaseLabel(companionPhase().session_phase),
      stance: stanceLabel(companionPhase().stance),
      rhythm: rhythmLabel(companionPhase().rhythm),
      note: phaseNoteLine(),
    });
    logCompanion('task-context-derived', companionTaskContext());
    logCompanion('context-summary', {
      category: taskContextLabel(companionTaskContext().category),
      confidence: String(companionTaskContext().confidence || 'low'),
      note: taskContextNoteLine(),
      command_family: String(companionTaskContext().command_family || ''),
    });
    logCompanion('preferences-applied', {
      preset: effectiveCompanionPreferences().preset || 'balanced_partner',
      profile_pack: effectiveCompanionPreferences().profile_pack || 'classic_default',
      proactivity: effectiveCompanionPreferences().proactivity || 'medium',
      tone_balance: effectiveCompanionPreferences().tone_balance || 'balanced',
      focus_mode: effectiveCompanionPreferences().focus_mode || 'balanced',
      verbosity: effectiveCompanionPreferences().verbosity || 'medium',
    });
    logCompanion('effective-tone-bias', {
      preset: effectiveCompanionPreferences().preset || 'balanced_partner',
      profile_pack: effectiveCompanionPreferences().profile_pack || 'classic_default',
      tone_balance: effectiveCompanionPreferences().tone_balance || 'balanced',
      focus_mode: effectiveCompanionPreferences().focus_mode || 'balanced',
      summary_key: String((companionExpression() || {}).summary_key || ''),
    });
    logCompanion('profile-pack-derived', {
      requested: companionProfilePack().requested,
      inferred: companionProfilePack().inferred,
      pack: companionProfilePack().id,
      label: companionProfilePack().label,
      summary: companionProfilePack().summary,
    });
  }
  scheduleEventTrayLayout();
}

function updateEventTrayLayout() {
  trayLayoutRaf = 0;
  if (!eventTrayEl || eventTrayEl.classList.contains('hidden')) return;
  eventTrayEl.classList.remove('compact-tray', 'ultra-compact-tray');
  var overflow = eventTrayEl.scrollHeight - eventTrayEl.clientHeight;
  if (overflow > 0) {
    eventTrayEl.classList.add('compact-tray');
    overflow = eventTrayEl.scrollHeight - eventTrayEl.clientHeight;
  }
  if (overflow > 0) {
    eventTrayEl.classList.add('ultra-compact-tray');
  }
}

function scheduleEventTrayLayout() {
  if (trayLayoutLocked) {
    trayLayoutDirtyWhileLocked = true;
    return;
  }
  if (eventTrayEl) {
    eventTrayEl.style.width = '';
    eventTrayEl.style.maxWidth = '';
    eventTrayEl.style.minWidth = '';
    eventTrayEl.style.height = '';
    eventTrayEl.style.maxHeight = '';
    eventTrayEl.style.minHeight = '';
  }
  if (trayLayoutRaf) cancelAnimationFrame(trayLayoutRaf);
  trayLayoutRaf = requestAnimationFrame(updateEventTrayLayout);
}

function lockEventTrayLayoutDuringDrag() {
  trayLayoutLocked = true;
  trayLayoutDirtyWhileLocked = false;
  if (!eventTrayEl || eventTrayEl.classList.contains('hidden')) return;
  trayLayoutLockedHeightPx = eventTrayEl.offsetHeight > 0 ? (String(eventTrayEl.offsetHeight) + 'px') : '';
  trayLayoutLockedWidthPx = eventTrayEl.offsetWidth > 0 ? (String(eventTrayEl.offsetWidth) + 'px') : '';
  if (trayLayoutLockedWidthPx) {
    eventTrayEl.style.width = trayLayoutLockedWidthPx;
    eventTrayEl.style.maxWidth = trayLayoutLockedWidthPx;
    eventTrayEl.style.minWidth = trayLayoutLockedWidthPx;
  }
  if (trayLayoutLockedHeightPx) {
    eventTrayEl.style.height = trayLayoutLockedHeightPx;
    eventTrayEl.style.maxHeight = trayLayoutLockedHeightPx;
    eventTrayEl.style.minHeight = trayLayoutLockedHeightPx;
  }
}

function unlockEventTrayLayoutAfterDrag() {
  trayLayoutLocked = false;
  trayLayoutLockedHeightPx = '';
  trayLayoutLockedWidthPx = '';
  trayLayoutDirtyWhileLocked = false;
}

restoreSessionRuntimeFromOverlay();

// ---- Sprite setters ----
const ASSET_BASE = '../assets/sprites';

function pathToFileUrl(filePath) {
  var text = String(filePath || '').replace(/\\/g, '/');
  if (!text) return '';
  if (/^file:\/\//i.test(text)) return text.replace(/\/+$/, '');
  if (text.startsWith('//')) return 'file:' + encodeURI(text).replace(/#/g, '%23').replace(/\?/g, '%3F');
  if (/^[A-Za-z]:\//.test(text)) return 'file:///' + encodeURI(text).replace(/#/g, '%23').replace(/\?/g, '%3F');
  return 'file://' + encodeURI(text).replace(/#/g, '%23').replace(/\?/g, '%3F');
}

function normalizeCustomPet(customPet) {
  if (!customPet || typeof customPet !== 'object') return null;
  var petPath = customPet.overlay_path || customPet.path;
  if (!petPath || !customPet.manifest || !customPet.manifest.states || !customPet.manifest.states.idle) {
    return null;
  }
  return {
    name: String(customPet.name || 'custom'),
    baseUrl: pathToFileUrl(petPath),
    manifest: customPet.manifest,
  };
}

function setSprite(species, variant) {
  if (variant === void 0) variant = 'normal';
  var nextCustomPet = normalizeCustomPet(state.custom_pet);
  var currentCustomName = animController.customPet && animController.customPet.name;
  var nextCustomName = nextCustomPet && nextCustomPet.name;
  if (animController.species !== species || currentCustomName !== nextCustomName) {
    if (_petDragging) {
      if (DEBUG_ANIM) console.log('[pet-anim] BLOCKED setSprite(' + species + ') while dragging');
      return;
    }
    animController.species = species;
    animController.customPet = nextCustomPet || null;
    if (animController.manifest) animController.init(species, nextCustomPet);
    else {
      spriteEl.style.backgroundImage = 'url("' + ASSET_BASE + '/' + species + '.png")';
      spriteEl.classList.add('sprite-asset-loaded');
    }
  }
}

function setMood(mood) {
  spriteEl.classList.remove('idle', 'happy', 'thinking', 'busy');
  spriteEl.classList.add(mood || 'idle');
  spriteEl.classList.toggle('pet-idle', (mood || 'idle') === 'idle');
  transitionForMood(mood);
}

function transitionForMood(mood) {
  var stateForMood = {
    idle: 'idle',
    happy: 'jumping',
    thinking: 'review',
    busy: 'waiting',
    sad: 'failed',
    failed: 'failed',
    error: 'failed',
    waiting: 'waiting',
    running: 'running'
  };
  var nextState = stateForMood[mood || 'idle'];
  if (nextState) animController.transition(nextState);
}

function setShiny(on) {
  spriteEl.classList.toggle('shiny', on);
}

function triggerReaction(duration = 900) {
  if (reactTimeout) clearTimeout(reactTimeout);
  spriteEl.classList.remove('pet-react');
  void spriteEl.offsetWidth;
  spriteEl.classList.add('pet-react');
  reactTimeout = setTimeout(() => {
    spriteEl.classList.remove('pet-react');
    reactTimeout = null;
  }, duration);
}

// ---- Stats badge ----
function updateStats() {
  nameEl.textContent = state.name || '...';
  levelEl.textContent = `Lv.${state.level}`;
  const pct = Math.min(100, Math.round((state.xp / state.xpNext) * 100));
  xpFillEl.style.width = `${pct}%`;
}

// Show stats on hover over sprite
spriteEl.addEventListener('mouseenter', () => {
  if (_petDragging) return;
  statsEl.classList.add('visible');
  spriteEl.classList.add('pet-hover');
  animController.hoverActive = true;
  // Don't transition to 'hover' if pet is in an active state (running/review etc.)
  var _activeStates = ['running', 'run_left', 'run_right', 'review', 'waiting', 'failed'];
  if (_activeStates.indexOf(animController.currentState) === -1) {
    animController.transition('hover');
  }
});
spriteEl.addEventListener('mouseleave', () => {
  statsEl.classList.remove('visible');
  spriteEl.classList.remove('pet-hover');
  animController.hoverActive = false;
  if (!_petDragging) {
    // Restore TUI target state if user interaction overrode it
    if (_restoreTuiTarget()) return;
    var _activeStates = ['running', 'run_left', 'run_right', 'review', 'waiting', 'failed'];
    if (_activeStates.indexOf(animController.currentState) === -1) {
      animController.transition('idle');
    }
  }
});

// ---- Chat bubble ----
function clampBubblePosition(value, min, max) {
  var floor = Number.isFinite(min) ? min : 0;
  var ceiling = Number.isFinite(max) ? max : floor;
  if (ceiling < floor) ceiling = floor;
  if (!Number.isFinite(value)) return floor;
  return Math.min(Math.max(value, floor), ceiling);
}

function restoreFromBubbleModeForPinnedBubble(duration) {
  if (duration !== 0 || !document.body.classList.contains('bubble-mode')) return;
  document.body.classList.remove('bubble-mode');
  try {
    if (typeof isMinimized !== 'undefined') isMinimized = false;
  } catch (_) {}
  minBtn.textContent = '−';
  window.hermesPetAPI?.restore?.();
  logCompanion('bubble-mode-restored', { reason: 'pinned-bubble' });
}

function normalizePinnedBubbleMode(mode) {
  mode = String(mode || '').trim().toLowerCase();
  if (mode === 'run_left' || mode === 'run_right') mode = 'running';
  if (mode === 'approval_needed') mode = 'review';
  if (mode === 'thinking') mode = 'waiting';
  return mode;
}

function activePinnedBubbleMode() {
  var candidates = [
    companionState && companionState.mode,
    typeof _tuiTargetState !== 'undefined' ? _tuiTargetState : '',
    animController && animController.currentState,
  ];
  for (var i = 0; i < candidates.length; i += 1) {
    var mode = normalizePinnedBubbleMode(candidates[i]);
    if (mode === 'running' || mode === 'review' || mode === 'waiting') return mode;
  }
  return '';
}

function pinnedBubbleEventForActiveState() {
  var mode = activePinnedBubbleMode();
  if (mode === 'running') return { type: 'running' };
  if (mode === 'review') return { type: 'review' };
  if (mode === 'waiting') return { type: 'waiting' };
  return null;
}

function pinnedBubbleLineForActiveState() {
  var msg = pinnedBubbleEventForActiveState();
  if (!msg) return '';
  var line = bubbleTextForEvent(msg);
  if (line) return line;
  if (msg.type === 'running') return runningBubbleTextForEvent(msg);
  if (msg.type === 'review') return companionScopedBubbleLine('review', '', randomBubbleLine('review') || '等你拍板先。');
  if (msg.type === 'waiting') return companionScopedBubbleLine('waiting', '', randomBubbleLine('waiting') || '等你一下。');
  return '';
}

function restorePinnedBubbleForActiveState(reason) {
  if (!bubbleEl || !bubbleTextEl) return false;
  if (!bubbleEl.classList.contains('hidden')) return false;
  var line = pinnedBubbleLineForActiveState();
  if (!String(line || '').trim()) return false;
  showBubble(line, 0);
  logCompanion('pinned-bubble-restored', {
    reason: reason || '',
    mode: String((companionState && companionState.mode) || ''),
    line: line,
  });
  return true;
}

function positionBubble() {
  var containerEl = document.getElementById('pet-container');
  var containerRect = containerEl
    ? containerEl.getBoundingClientRect()
    : { left: 0, top: 0, width: window.innerWidth || 1, height: window.innerHeight || 1 };
  var spriteRect = spriteEl.getBoundingClientRect();
  var bubbleWidth = bubbleEl.offsetWidth || bubbleEl.getBoundingClientRect().width || 1;
  var bubbleHeight = bubbleEl.offsetHeight || bubbleEl.getBoundingClientRect().height || 1;
  var margin = 8;
  var gap = 10;
  var viewportWidth = Math.max(1, containerRect.width || window.innerWidth || 1);
  var viewportHeight = Math.max(1, containerRect.height || window.innerHeight || 1);
  var maxLeft = viewportWidth - bubbleWidth - margin;
  var maxTop = viewportHeight - bubbleHeight - margin;
  var left = (spriteRect.left - containerRect.left) + (spriteRect.width / 2) - (bubbleWidth / 2);
  var top = (spriteRect.top - containerRect.top) - bubbleHeight - gap;
  var placement = 'above';

  if (top < margin) {
    top = (spriteRect.bottom - containerRect.top) + gap;
    placement = 'below';
  }

  left = clampBubblePosition(left, margin, maxLeft);
  top = clampBubblePosition(top, margin, maxTop);
  bubbleEl.style.left = Math.round(left) + 'px';
  bubbleEl.style.top = Math.round(top) + 'px';
  bubbleEl.style.bottom = 'auto';
  return {
    placement: placement,
    left: Math.round(left),
    top: Math.round(top),
    width: Math.round(bubbleWidth),
    height: Math.round(bubbleHeight),
    sprite: {
      left: Math.round(spriteRect.left - containerRect.left),
      top: Math.round(spriteRect.top - containerRect.top),
      width: Math.round(spriteRect.width),
      height: Math.round(spriteRect.height),
    },
    viewport: {
      width: Math.round(viewportWidth),
      height: Math.round(viewportHeight),
    },
  };
}

function showBubble(text, duration = 3500) {
  if (!String(text || '').trim()) return false;
  restoreFromBubbleModeForPinnedBubble(duration);
  if (bubbleTimeout) clearTimeout(bubbleTimeout);
  bubbleTimeout = null;
  if (bubbleHideTimeout) clearTimeout(bubbleHideTimeout);
  bubbleHideTimeout = null;
  bubbleTextEl.textContent = text;
  bubbleEl.className = 'bubble';
  bubbleEl.classList.remove('hidden');
  if (bubblePulseTimeout) clearTimeout(bubblePulseTimeout);
  bubbleEl.classList.remove('bubble-pulse');
  void bubbleEl.offsetWidth;
  bubbleEl.classList.add('bubble-pulse');
  bubblePulseTimeout = setTimeout(() => {
    bubbleEl.classList.remove('bubble-pulse');
    bubblePulseTimeout = null;
  }, 420);

  var bubbleLayout = positionBubble();
  try {
    var computed = window.getComputedStyle(bubbleEl);
    logCompanion('bubble-render', {
      text: String(text).slice(0, 80),
      duration: duration,
      class_name: bubbleEl.className,
      body_class: document.body.className || '',
      display: computed.display,
      visibility: computed.visibility,
      opacity: computed.opacity,
      layout: bubbleLayout,
    });
  } catch (_) {}

  if (duration > 0) {
    bubbleTimeout = setTimeout(() => {
      bubbleTimeout = null;
      bubbleEl.classList.add('fade-out');
      bubbleHideTimeout = setTimeout(() => {
        bubbleEl.classList.add('hidden');
        bubbleHideTimeout = null;
        restorePinnedBubbleForActiveState('transient-expired');
      }, 400);
    }, duration);
  }
  return true;
}

function hideBubble() {
  if (bubbleTimeout) clearTimeout(bubbleTimeout);
  bubbleTimeout = null;
  if (bubbleHideTimeout) clearTimeout(bubbleHideTimeout);
  bubbleHideTimeout = null;
  bubbleEl.classList.add('fade-out');
  bubbleHideTimeout = setTimeout(() => {
    bubbleEl.classList.add('hidden');
    bubbleHideTimeout = null;
  }, 400);
}

// ---- Recent event memory ----
function singleLineText(value, limit) {
  var text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!limit || text.length <= limit) return text;
  return text.slice(0, Math.max(0, limit - 1)).trimEnd() + '...';
}

function titleCaseText(value) {
  return singleLineText(value, 40).replace(/(^|[\s_-])([a-z])/g, function(match) {
    return match.toUpperCase();
  });
}

function eventTaskTitle(msg, fallback) {
  if (!msg || typeof msg !== 'object') return singleLineText(fallback || '', 160);
  return singleLineText(
    msg.task_title || msg.title || msg.job_name || msg.task_name || msg.name || fallback || '',
    160
  );
}

function explicitEventTaskTitle(msg) {
  if (!msg || typeof msg !== 'object') return '';
  return singleLineText(
    msg.task_title || msg.title || msg.job_name || msg.task_name || msg.name || '',
    160
  );
}

function eventTaskSummary(msg, fallback) {
  if (!msg || typeof msg !== 'object') return singleLineText(fallback || '', 240);
  return singleLineText(
    msg.outcome_summary || msg.task_summary || msg.summary || msg.text || fallback || '',
    240
  );
}

function eventText(msg) {
  if (msg.type === 'task_started' || msg.type === 'task_progress' || msg.type === 'task_blocked' || msg.type === 'task_resumed' || msg.type === 'task_completed' || msg.type === 'task_failed') {
    var taskTitle = singleLineText(eventTaskTitle(msg, ''), 120);
    var taskStep = singleLineText(msg.task_step || '', 140);
    var taskSummary = singleLineText(eventTaskSummary(msg, ''), 180);
    if (taskTitle && taskStep) return taskTitle + ' · ' + taskStep;
    if (taskTitle && taskSummary && taskSummary !== taskTitle) return taskTitle + ': ' + taskSummary;
    if (taskTitle) return taskTitle;
    if (taskSummary) return taskSummary;
  }
  if (msg.type === 'message_received') {
    const source = titleCaseText(msg.source || 'message');
    const sender = singleLineText(msg.sender || 'someone', 60);
    const body = singleLineText(msg.text || '', 180);
    return body ? source + ' from ' + sender + ': ' + body : source + ' from ' + sender;
  }
  if (msg.text) return singleLineText(msg.text, 220);
  return String(msg.type || 'Event');
}

function eventSeverity(msg) {
  if (msg.severity) return String(msg.severity);
  var severityByType = {
    job_finished: 'success',
    job_failed: 'error',
    task_completed: 'success',
    task_failed: 'error',
    task_blocked: 'warning',
    approval_needed: 'warning',
    message_received: msg.urgent ? 'warning' : 'info'
  };
  return severityByType[msg.type] || 'info';
}

function eventGroup(msg) {
  if (msg.type === 'job_failed' || msg.type === 'job_finished' || msg.type === 'job_started') return 'jobs';
  if (msg.type === 'task_started' || msg.type === 'task_progress' || msg.type === 'task_blocked' || msg.type === 'task_resumed' || msg.type === 'task_completed' || msg.type === 'task_failed') return 'workflow';
  if (msg.type === 'message_received') return 'messages';
  if (msg.type === 'approval_needed') return 'approvals';
  if (msg.type === 'daily_brief') return 'briefs';
  return 'status';
}

function normalizeNotificationPrefs(prefs) {
  var next = { ...DEFAULT_NOTIFICATION_PREFS };
  if (prefs && typeof prefs === 'object') {
    Object.assign(next, prefs);
  }
  if (!['normal', 'focus', 'pairing', 'demo', 'silent'].includes(next.notification_profile)) {
    next.notification_profile = 'normal';
  }
  if (!['off', 'important', 'silent'].includes(next.quiet_mode)) {
    next.quiet_mode = 'off';
  }
  var throttle = Number(next.bubble_throttle_seconds);
  next.bubble_throttle_seconds = Number.isFinite(throttle) ? Math.max(0, throttle) : DEFAULT_NOTIFICATION_PREFS.bubble_throttle_seconds;
  next.show_tray_on_urgent = next.show_tray_on_urgent !== false;
  next.show_idle_bubbles = next.show_idle_bubbles !== false;
  if (next.muted_until) {
    var mutedUntilMs = Date.parse(String(next.muted_until));
    next.muted_until = Number.isFinite(mutedUntilMs) && mutedUntilMs > Date.now() ? String(next.muted_until) : null;
  }
  return next;
}

function updateNotificationPrefs(prefs) {
  notificationPrefs = normalizeNotificationPrefs(prefs);
  debugEvent('notification prefs updated', notificationPrefs);
}

function eventIcon(msg) {
  var iconByType = {
    status: 'S',
    workflow: 'W',
    job_started: '>',
    job_finished: 'OK',
    job_failed: '!',
    job_history: 'J',
    approval_needed: '?',
    message_received: '@',
    daily_brief: '#',
    bubble: '*'
  };
  return iconByType[msg.type] || '*';
}

function recordRecentEvent(msg) {
  if (!msg || !msg.type || msg.type === 'state') return;
  // Skip animation-only signals from TUI — they're not events
  if (msg.type === 'running') return;
  // idle decrements the blocking counter; only clears entries when all done
  if (msg.type === 'idle') {
    if (_blockingCount > 0) _blockingCount--;
    if (_blockingCount === 0) _clearRecentBlocking();
    return;
  }
  var item = {
    id: msg.id || String(Date.now()) + '-' + recentEvents.length,
    type: msg.type,
    text: eventText(msg) || msg.type,
    severity: eventSeverity(msg),
    createdAt: msg.created_at || new Date().toISOString()
  };
  // Track blocking events for multi-TUI counter
  if (item.type === 'review' || item.type === 'waiting') _blockingCount++;
  recentEvents.unshift(item);
  if (recentEvents.length > RECENT_EVENT_LIMIT) recentEvents.length = RECENT_EVENT_LIMIT;
  renderRecentEvents();
}

function _clearRecentBlocking() {
  for (var i = recentEvents.length - 1; i >= 0; i--) {
    if (recentEvents[i].type === 'review' || recentEvents[i].type === 'waiting') {
      recentEvents.splice(i, 1);
    }
  }
  renderRecentEvents();
}

function clearRecentEvents() {
  recentEvents.length = 0;
  _blockingCount = 0;
  trayAttention = false;
  renderRecentEvents();
}

function jobDurationText(job) {
  if (job.duration_text) return String(job.duration_text);
  var seconds = Number(job.duration || 0);
  if (!Number.isFinite(seconds) || seconds < 0) return '-';
  var total = Math.round(seconds);
  if (total < 60) return total + 's';
  var minutes = Math.floor(total / 60);
  var rest = total % 60;
  if (minutes < 60) return minutes + 'm ' + String(rest).padStart(2, '0') + 's';
  var hours = Math.floor(minutes / 60);
  return hours + 'h ' + String(minutes % 60).padStart(2, '0') + 'm';
}

function jobHistoryText(job) {
  var status = job.status === 'failed' ? 'Failed' : 'Done';
  var name = job.name || 'command';
  var exit = job.exit_code == null ? '' : ', exit ' + job.exit_code;
  return status + ': ' + name + ' (' + jobDurationText(job) + exit + ')';
}

function recordJobHistory(msg) {
  var jobs = Array.isArray(msg.jobs) ? msg.jobs.slice(0, 4) : [];
  jobs.reverse().forEach(function(job) {
    var failed = job.status === 'failed' || (job.exit_code != null && job.exit_code !== 0);
    recentEvents.unshift({
      id: job.id || String(Date.now()) + '-job',
      type: failed ? 'job_failed' : 'job_finished',
      group: 'jobs',
      text: jobHistoryText(job),
      severity: failed ? 'error' : 'success',
      createdAt: job.finished_at || job.started_at || msg.created_at || new Date().toISOString()
    });
  });
  if (recentEvents.length > RECENT_EVENT_LIMIT) recentEvents.length = RECENT_EVENT_LIMIT;
  renderRecentEvents();
}

function renderRecentEvents() {
  if (!eventListEl) return;
  var compactStatus = state.currentStatus || 'Idle';
  if (eventTrayTitleEl) eventTrayTitleEl.textContent = 'Hermes Pets · ' + compactStatus;
  if (currentStatusEl) currentStatusEl.textContent = compactStatus;
  renderCompanionSummary();
  var summary = { workflow: 0, jobs: 0, messages: 0, approvals: 0, briefs: 0, status: 0 };
  var attention = false;
  recentEvents.forEach(function(item) {
    var group = item.group || eventGroup(item);
    summary[group] = (summary[group] || 0) + 1;
    attention = attention || item.severity === 'error' || item.severity === 'warning';
  });
  trayAttention = attention;
  if (eventSummaryEl) {
    var totalRecent = Number(summary.workflow || 0) +
      Number(summary.jobs || 0) +
      Number(summary.messages || 0) +
      Number(summary.approvals || 0) +
      Number(summary.briefs || 0);
    if (totalRecent > 0) {
      eventSummaryEl.textContent = (attention ? '! ' : '') + totalRecent + ' recent';
    } else {
      eventSummaryEl.textContent = '';
    }
    eventSummaryEl.classList.toggle('hidden', totalRecent <= 0);
  }
  if (eventTrayEl) {
    eventTrayEl.classList.toggle('attention', trayAttention);
    eventTrayEl.classList.toggle('quiet-profile', notificationPrefs.quiet_mode !== 'off');
  }
  eventListEl.textContent = '';
  if (recentEvents.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'event-row';
    empty.innerHTML = '<span class="event-icon">-</span><span class="event-text">No recent events</span>';
    eventListEl.appendChild(empty);
    scheduleEventTrayLayout();
    return;
  }
  recentEvents.slice(0, 4).forEach(function(item) {
    var row = document.createElement('div');
    row.className = 'event-row ' + item.severity;
    var icon = document.createElement('span');
    icon.className = 'event-icon';
    icon.textContent = eventIcon(item);
    var text = document.createElement('span');
    text.className = 'event-text';
    var title = document.createElement('span');
    title.className = 'event-title';
    title.textContent = item.text;
    var meta = document.createElement('span');
    meta.className = 'event-meta';
    meta.textContent = titleCaseText(item.group || eventGroup(item));
    text.appendChild(title);
    text.appendChild(meta);
    row.appendChild(icon);
    row.appendChild(text);
    eventListEl.appendChild(row);
  });
  scheduleEventTrayLayout();
}

function setEventTrayVisible(visible, autoHideMs) {
  if (!eventTrayEl) return;
  eventTrayToken++;
  var token = eventTrayToken;
  if (eventTrayTimeout) {
    clearTimeout(eventTrayTimeout);
    eventTrayTimeout = null;
  }
  renderRecentEvents();
  eventTrayEl.classList.toggle('hidden', !visible);
  if (window.hermesPetAPI && typeof window.hermesPetAPI.setEventTrayVisibility === 'function') {
    window.hermesPetAPI.setEventTrayVisibility(visible);
  }
  scheduleEventTrayLayout();
  if (visible && autoHideMs) {
    eventTrayTimeout = setTimeout(function() {
      if (token !== eventTrayToken) return;
      eventTrayEl.classList.add('hidden');
      if (window.hermesPetAPI && typeof window.hermesPetAPI.setEventTrayVisibility === 'function') {
        window.hermesPetAPI.setEventTrayVisibility(false);
      }
      eventTrayTimeout = null;
    }, autoHideMs);
  }
}

function mutedNow() {
  if (mutedByOverlayOverride('temp_quiet_until')) return true;
  if (mutedByOverlayOverride('quiet_tonight_until')) return true;
  if (!notificationPrefs.muted_until) return false;
  var mutedUntilMs = Date.parse(String(notificationPrefs.muted_until));
  if (!Number.isFinite(mutedUntilMs) || mutedUntilMs <= Date.now()) {
    notificationPrefs.muted_until = null;
    return false;
  }
  return true;
}

function mutedByOverlayOverride(key) {
  var overrides = overlayCompanion.overrides || {};
  var value = overrides[key];
  if (!value) return false;
  var untilMs = Date.parse(String(value));
  if (!Number.isFinite(untilMs) || untilMs <= Date.now()) {
    overrides[key] = null;
    saveOverlayCompanionState();
    return false;
  }
  return true;
}

function tonightQuietUntilIso() {
  var now = new Date();
  var parts = zonedParts(now);
  var year = Number(parts.year || 0);
  var month = Number(parts.month || 1);
  var day = Number(parts.day || 1);
  var hour = Number(parts.hour || 0);
  var targetDay = new Date(Date.UTC(year, month - 1, day));
  if (hour >= 6) {
    targetDay.setUTCDate(targetDay.getUTCDate() + 1);
  }
  return zonedTimestampToIso(
    targetDay.getUTCFullYear(),
    targetDay.getUTCMonth() + 1,
    targetDay.getUTCDate(),
    6,
    0,
    0,
  );
}

function applyCompanionControlAction(action) {
  if (!action) return;
  overlayCompanion.overrides = overlayCompanion.overrides || {};
  if (String(action).indexOf('pack:') === 0) {
    var pack = String(action).slice(5) || 'auto';
    petMemory.companion_preferences = petMemory.companion_preferences || defaultPetMemory().companion_preferences;
    petMemory.companion_preferences.profile_pack = pack;
    savePetMemory();
    logCompanion('profile-pack-selected', {
      requested: pack,
      active: companionProfilePack().id,
      label: companionProfilePack().label,
    });
  } else if (action === 'quiet-1h') {
    overlayCompanion.overrides.temp_quiet_until = new Date(Date.now() + 3600 * 1000).toISOString();
  } else if (action === 'quiet-tonight') {
    overlayCompanion.overrides.quiet_tonight_until = tonightQuietUntilIso();
  } else if (action === 'more-active') {
    overlayCompanion.overrides.proactivity = 'high';
  } else if (action === 'more-quiet') {
    overlayCompanion.overrides.proactivity = 'low';
  } else if (action === 'clear-overrides') {
    overlayCompanion.overrides.temp_quiet_until = null;
    overlayCompanion.overrides.quiet_tonight_until = null;
    overlayCompanion.overrides.proactivity = null;
  } else if (action === 'details-toggle') {
    companionPanelDetailsOpen = !companionPanelDetailsOpen;
    logCompanion('panel-details-toggle', { open: companionPanelDetailsOpen });
    renderRecentEvents();
    return;
  } else {
    return;
  }
  logCompanion('control-action', {
    action: action,
    override: overrideStateLine(),
  });
  saveOverlayCompanionState();
  renderRecentEvents();
}

function isCriticalEvent(msg) {
  if (!msg || !msg.type) return false;
  if (msg.type === 'task_started' || msg.type === 'task_blocked' || msg.type === 'task_resumed' || msg.type === 'task_completed' || msg.type === 'task_failed') return true;
  if (msg.type === 'task_progress' && semanticBubbleProgressAllowed(msg)) return true;
  return msg.type === 'job_failed' ||
    msg.type === 'approval_needed' ||
    (msg.type === 'message_received' && !!msg.urgent);
}

function semanticBubbleProgressAllowed(msg) {
  if (!msg || msg.type !== 'task_progress') return true;
  var urgency = String(msg.urgency || '').trim().toLowerCase();
  if (urgency === 'urgent' || urgency === 'important') return true;
  if (msg.needs_user) return true;
  if (msg.blocker_type || msg.blocker_detail || msg.outcome_summary) return true;
  if (String(msg.task_status || '').trim().toLowerCase() === 'blocked') return true;
  return false;
}

function bubbleSignalPolicyForEvent(msg) {
  if (!msg || !msg.type) return 'unknown';
  if (msg.type === 'task_progress') return semanticBubbleProgressAllowed(msg) ? 'milestone' : 'quiet-progress';
  if (msg.type === 'task_started' || msg.type === 'task_resumed') return 'active-start';
  if (msg.type === 'task_blocked') return 'blocked-hold';
  if (msg.type === 'task_completed') return 'completion';
  if (msg.type === 'task_failed') return 'failure';
  if (msg.type === 'running' || msg.type === 'job_started') return 'runtime-running';
  return 'default';
}

function bubbleChannelForEvent(msg) {
  if (msg.type === 'status') return 'status';
  if (msg.type === 'job_started') return 'job_lifecycle';
  if (msg.type === 'job_finished') return 'job_success';
  if (msg.type === 'task_started' || msg.type === 'task_progress' || msg.type === 'task_resumed') return 'task_lifecycle';
  if (msg.type === 'task_completed') return 'task_success';
  if (msg.type === 'task_failed' || msg.type === 'task_blocked') return 'task_attention';
  if (msg.type === 'daily_brief') return 'brief';
  return msg.type || 'event';
}

function shouldShowEventBubble(msg, bubbleLine) {
  var critical = isCriticalEvent(msg);
  if (msg.type === 'task_progress' && !semanticBubbleProgressAllowed(msg)) return false;
  if (!String(bubbleLine || '').trim()) return false;
  if (msg.type === 'running' || msg.type === 'job_started') {
    var sameRunningLine = String(bubbleTextEl.textContent || '') === String(bubbleLine || '');
    var runningBubbleVisible = !bubbleEl.classList.contains('hidden');
    var runningBubbleFading = bubbleEl.classList.contains('fade-out');
    if (runningBubbleVisible && sameRunningLine && !runningBubbleFading) return false;
    lastBubbleByKey[msg.type + '|' + bubbleLine] = Date.now();
    lastBubbleByChannel[bubbleChannelForEvent(msg)] = Date.now();
    return true;
  }
  if (mutedNow() && !critical) return false;
  if (notificationPrefs.quiet_mode !== 'off' && !critical) return false;
  if (critical) return true;
  var now = Date.now();
  var text = bubbleLine || eventText(msg);
  var key = msg.type + '|' + text;
  var channel = bubbleChannelForEvent(msg);
  var prefThrottleMs = Math.round(Number(notificationPrefs.bubble_throttle_seconds) * 1000);
  var minDelay = msg.type === 'status' ? Math.max(STATUS_THROTTLE_MS, prefThrottleMs) : prefThrottleMs;
  var last = lastBubbleByKey[key] || 0;
  if (now - last < minDelay) return false;
  var lastChannel = lastBubbleByChannel[channel] || 0;
  if (now - lastChannel < minDelay) return false;
  lastBubbleByKey[key] = now;
  lastBubbleByChannel[channel] = now;
  return true;
}

function bubbleTextForEvent(msg) {
  var sessionLine = sessionBubbleTextForEvent(msg);
  if (sessionLine) {
    msg._bubble_source = 'session-thread';
    return sessionLine;
  }
  if (msg.type === 'running' || msg.type === 'job_started') {
    return runningBubbleTextForEvent(msg);
  }
  if (msg.type === 'task_started' || msg.type === 'task_progress' || msg.type === 'task_blocked' || msg.type === 'task_resumed' || msg.type === 'task_completed' || msg.type === 'task_failed') {
    var signalLine = (window.HermesCompanionLines && typeof window.HermesCompanionLines.semanticSignalLine === 'function'
      ? window.HermesCompanionLines.semanticSignalLine({
          event_type: msg.type,
          urgency: msg.urgency || '',
          semantic: {
            title: eventTaskTitle(msg, ''),
            kind: msg.task_kind || '',
            status: msg.task_status || (msg.type === 'task_blocked' ? 'blocked' :
              msg.type === 'task_completed' ? 'completed' :
              msg.type === 'task_failed' ? 'failed' : 'active'),
            step: msg.task_step || '',
            summary: eventTaskSummary(msg, ''),
            next_action: msg.task_next || '',
            blocker_type: msg.blocker_type || '',
            blocker_detail: msg.blocker_detail || '',
            needs_user: !!msg.needs_user,
            outcome_summary: msg.outcome_summary || '',
            resumed_from: msg.resumed_from || '',
          },
          narrative: companionNarrative(),
          context: companionTaskContext(),
          phase: companionPhase(),
          insight: companionInsight(),
        })
      : '');
    if (signalLine) return signalLine;
  }
  var text = eventText(msg);
  var prefixByType = {
    status: 'Status: ',
    job_started: 'Started: ',
    job_finished: 'Finished: ',
    job_failed: 'Failed: ',
    task_started: 'Task: ',
    task_progress: 'Doing: ',
    task_blocked: 'Blocked: ',
    task_resumed: 'Back to: ',
    task_completed: 'Done: ',
    task_failed: 'Failed: ',
    approval_needed: 'Approval needed: ',
    message_received: msg.urgent || msg.severity === 'warning' ? 'Urgent message: ' : 'Message: ',
    daily_brief: 'Daily brief: '
  };
  return (prefixByType[msg.type] || '') + text;
}

function sessionBubbleTextForEvent(msg) {
  if (!msg || !msg.type) return '';
  var adapter = companionRenderAdapterInput();
  var thread = adapter.session_thread || {};
  if (!thread.thread_id) return '';
  var status = String(thread.status || '').trim().toLowerCase();
  var eventTitle = readableTaskDisplayLine(explicitEventTaskTitle(msg), 54);
  var eventSummary = readableTaskDisplayLine(eventTaskSummary(msg, ''), 54);
  var title = readableTaskDisplayLine((status === 'active' || status === 'blocked' || status === 'review') ? (thread.title || thread.summary || '') : '', 54);
  var need = readableTaskDisplayLine(msg.task_next || msg.next_action || msg.need || thread.need || '', 54);
  var wrap = readableTaskDisplayLine(thread.wrap_line || '', 70);

  if (msg.type === 'running' || msg.type === 'job_started') {
    return companionScopedBubbleLine('running', '', '帮紧你, 帮紧你!!!');
  }
  if (msg.type === 'waiting' && status === 'thinking') {
    var thinkingFallback = title && isUsefulRunningBubbleLine(title)
      ? '我谂紧：' + title
      : '我谂紧，唔使你先处理。';
    return companionScopedBubbleLine('thinking', title, thinkingFallback);
  }
  if (msg.type === 'review' || msg.type === 'approval_needed' || (msg.type === 'waiting' && (status === 'blocked' || status === 'review'))) {
    var blockingKind = (msg.type === 'review' || msg.type === 'approval_needed' || status === 'review') ? 'review' : 'waiting';
    var blockingDetail = need || (title && isUsefulRunningBubbleLine(title) ? title : '');
    var blockingFallback = '';
    if (need) blockingFallback = blockingKind === 'review' ? '等你拍板：' + need : '等你一下：' + need;
    else if (title && isUsefulRunningBubbleLine(title)) blockingFallback = blockingKind === 'review' ? '等你拍板：' + title : '等你处理：' + title;
    return companionScopedBubbleLine(blockingKind, blockingDetail, blockingFallback);
  }
  if (msg.type === 'task_started') {
    var startedDetail = eventTitle && isUsefulRunningBubbleLine(eventTitle) ? eventTitle : (title && isUsefulRunningBubbleLine(title) ? title : '');
    var startedFallback = startedDetail ? '帮紧你：' + startedDetail : '帮紧你, 帮紧你!!!';
    return companionScopedBubbleLine('running', startedDetail, startedFallback);
  }
  if (msg.type === 'task_progress') {
    if (!semanticBubbleProgressAllowed(msg)) return '';
    if (status === 'blocked' || status === 'review') {
      var progressBlockingKind = status === 'review' ? 'review' : 'waiting';
      var progressBlockingDetail = need || (title && isUsefulRunningBubbleLine(title) ? title : '');
      var progressBlockingFallback = '';
      if (need) progressBlockingFallback = status === 'review' ? '等你拍板：' + need : '等你一下：' + need;
      else if (title && isUsefulRunningBubbleLine(title)) progressBlockingFallback = '呢个位卡住：' + title;
      return companionScopedBubbleLine(progressBlockingKind, progressBlockingDetail, progressBlockingFallback);
    }
    if (need) return companionScopedBubbleLine('running', need, '继续跟住：' + need);
    if (eventTitle && isUsefulRunningBubbleLine(eventTitle)) return companionScopedBubbleLine('running', eventTitle, '继续推进：' + eventTitle);
    if (title && isUsefulRunningBubbleLine(title)) return companionScopedBubbleLine('running', title, '继续推进：' + title);
    return '';
  }
  if (msg.type === 'task_blocked') {
    var blockedKind = (msg.type === 'review' || msg.type === 'approval_needed' || status === 'review') ? 'review' : 'waiting';
    var blockedDetail = need || (eventTitle && isUsefulRunningBubbleLine(eventTitle) ? eventTitle : (title && isUsefulRunningBubbleLine(title) ? title : ''));
    var blockedFallback = '这里卡住了，需要你处理。';
    if (need) blockedFallback = blockedKind === 'review' ? '等你拍板：' + need : '等你一下：' + need;
    else if (eventTitle && isUsefulRunningBubbleLine(eventTitle)) blockedFallback = '呢个位卡住：' + eventTitle;
    else if (title && isUsefulRunningBubbleLine(title)) blockedFallback = '呢个位卡住：' + title;
    return companionScopedBubbleLine(blockedKind, blockedDetail, blockedFallback);
  }
  if (msg.type === 'task_resumed') {
    return companionScopedBubbleLine('task_resumed', '', '收到，我继续推进。');
  }
  if (msg.type === 'task_completed' || msg.type === 'job_finished') {
    var completedDetail = '';
    var completedFallback = '';
    if (eventSummary && eventSummary !== eventTitle && isUsefulRunningBubbleLine(eventSummary)) completedDetail = eventSummary;
    else if (eventTitle && isUsefulRunningBubbleLine(eventTitle)) completedDetail = eventTitle;
    else if (wrap) completedDetail = wrap;
    else if (title && isUsefulRunningBubbleLine(title)) completedDetail = title;
    if (completedDetail) completedFallback = '这轮收住：' + completedDetail;
    return companionScopedBubbleLine('task_completed', completedDetail, completedFallback);
  }
  if (msg.type === 'task_failed' || msg.type === 'job_failed' || msg.type === 'failed') {
    var failedDetail = '';
    var failedFallback = '';
    if (need) failedDetail = need;
    else if (eventSummary && eventSummary !== eventTitle && isUsefulRunningBubbleLine(eventSummary)) failedDetail = eventSummary;
    else if (eventTitle && isUsefulRunningBubbleLine(eventTitle)) failedDetail = eventTitle;
    else if (wrap) failedDetail = wrap;
    else if (title && isUsefulRunningBubbleLine(title)) failedDetail = title;
    if (need) failedFallback = '这轮未完全过，先看：' + need;
    else if (failedDetail) failedFallback = '这轮未完全过：' + failedDetail;
    return companionScopedBubbleLine('task_failed', failedDetail, failedFallback);
  }
  return '';
}

function runningBubbleTextForEvent(msg) {
  return companionScopedBubbleLine('running', '', '帮紧你, 帮紧你!!!');
}

const PACK_BUBBLE_LINES = {
  celestia_princess: {
    running: [
      '帮紧你，帮紧你，我会温柔啲陪你一路向前 ✨',
      '帮紧你，帮紧你，我帮你照住呢段光 ☀️',
      '帮紧你，帮紧你，慢慢嚟，我陪你推到通 🌤️',
    ],
    thinking: [
      '我静静谂紧，谂清楚先再行 🌙',
      '等我用少少星光照下条路先 ✨',
      '我喺度思考紧，唔系走咗开呀 🌤️',
    ],
    thinking_long: [
      '呢步要谂耐少少，我仲喺度守住你 💛',
      '星光转紧圈，我继续帮你拆开佢 ✨',
    ],
    thinking_stalled: [
      '呢下谂得有啲耐，我继续守住，唔会消失 🌙',
      '似乎卡住咗一阵，我陪你等下个信号 ☀️',
    ],
    waiting: [
      '呢个位等你一下，我会陪你守住 🌤️',
      '你俾个信号，我就继续帮你照亮条路 ✨',
      '我企定定等你，唔催你，但我会望住 👀',
    ],
    review: [
      '等你拍板先，我帮你守住最后一格光 ☀️',
      '呢下你话事，我会温柔咁等你决定 🌙',
      '你一点头，我就继续陪你向前 ✨',
    ],
    idle: [
      '今日辛苦喇，我帮你收好呢缕光 ✨',
      '我喺度呀，你想继续就叫我 🌤️',
      '先抖一抖都得，我会守住这里 💛',
    ],
    task_resumed: ['收到，我继续帮你照住前面条路 ✨'],
    task_completed: ['呢轮收好喇，你做得好好，我帮你盖上星光印章 🌟'],
    task_failed: ['唔紧要，我陪你重新照亮呢一步 🌈'],
  },
};

function normalizeBubblePool(pool) {
  if (!Array.isArray(pool)) return [];
  return pool.map(function(line) { return String(line || '').trim(); }).filter(Boolean);
}

function profilePackBubbleLinesFor(poolKey) {
  var key = String(poolKey || '');
  var pack = companionProfilePack();
  var id = String((pack && pack.id) || '');
  if (!id) return [];
  var packRuntime = window.HermesCompanionPacks || {};
  if (typeof packRuntime.bubbleLines === 'function') {
    var runtimePool = normalizeBubblePool(packRuntime.bubbleLines(id, key));
    if (runtimePool.length) return runtimePool;
  }
  var fallbackPack = PACK_BUBBLE_LINES[id] || {};
  return normalizeBubblePool(fallbackPack[key]);
}

function pickBubblePoolLine(pool) {
  var normalized = normalizeBubblePool(pool);
  if (!normalized.length) return '';
  return normalized[Math.floor(Math.random() * normalized.length)];
}

function companionScopedBubbleLine(kind, detail, fallback) {
  var pack = companionProfilePack();
  var id = String((pack && pack.id) || '');
  var fallbackLine = String(fallback || '');
  if (id !== 'celestia_princess') return fallbackLine;
  var clean = readableTaskDisplayLine(detail || '', 52);
  if (clean && !isUsefulRunningBubbleLine(clean)) clean = '';
  var poolLine = randomBubbleLine(kind);
  if (kind === 'running') {
    if (clean) return '帮紧你，帮紧你，我帮你照住：' + clean + ' ✨';
    return poolLine || fallbackLine;
  }
  if (kind === 'thinking') {
    if (clean) return '我静静谂紧：' + clean + '，谂清楚先继续 🌙';
    return poolLine || fallbackLine;
  }
  if (kind === 'waiting') {
    if (clean) return '呢个位等你一下，我会陪你守住：' + clean + ' 🌤️';
    return poolLine || fallbackLine;
  }
  if (kind === 'review') {
    if (clean) return '等你拍板先，我帮你守住：' + clean + ' ☀️';
    return poolLine || fallbackLine;
  }
  if (kind === 'task_resumed') return poolLine || fallbackLine;
  if (kind === 'task_completed') {
    if (clean) return '呢轮收好喇：' + clean + '。你做得好好 ✨';
    return poolLine || fallbackLine;
  }
  if (kind === 'task_failed') {
    if (clean) return '呢步未顺：' + clean + '。唔紧要，我陪你再照亮 🌈';
    return poolLine || fallbackLine;
  }
  return poolLine || fallbackLine;
}

function isDiagnosticTaskLine(line) {
  var text = String(line || '').trim().toLowerCase();
  if (!text) return false;
  if (/\b(bubble|bridge)\b.*\b(check|visible|verified|render|test)\b/i.test(text)) return true;
  if (/\b(regression|guard|blocked|approval|running)\b.*\btest\b/i.test(text)) return true;
  if (/plain resumed should not reuse stale/i.test(text)) return true;
  return false;
}

function isUsefulRunningBubbleLine(line) {
  var text = String(line || '').trim();
  if (!text) return false;
  if (isDiagnosticTaskLine(text)) return false;
  if (/^(running|idle|review|waiting|event)$/i.test(text)) return false;
  if (text === '帮紧你, 帮紧你!!!' || text === '帮紧你帮紧你 🔧') return false;
  if (/^(status|started|task|doing|blocked|back to|done|failed)\s*:/i.test(text)) return false;
  if (/^(browser navigate|terminal|tool|apply_patch|exec_command|powershell|cmd\.exe)\b/i.test(text)) return false;
  if (/https?:\/\/|ws:\/\/|^[a-z]:\\|\/home\/|\/mnt\/|\\users\\/i.test(text)) return false;
  if (/[{}[\]<>]|--[a-z0-9-]+|\b(pid|port|token|api[_-]?key)\b/i.test(text)) return false;
  return true;
}

function isExplicitWaitingSignal(msg) {
  if (!msg) return false;
  if (msg.type === 'approval_needed' || msg.type === 'task_blocked' || msg.needs_user) return true;
  if (msg.blocker_type || msg.blocker_detail || msg.task_next) return true;
  var text = singleLineText(msg.text || msg.task_summary || msg.task_title || '', 280).toLowerCase();
  if (!text) return false;
  return /approval|approve|permission|授权|审批|拍板|密码|password|login|登录|clarify|ask|需要你|等你|等待用户|enter send/.test(text);
}

function isThinkingWaitingEvent(msg) {
  return msg && msg.type === 'waiting' && msg.waiting_context === 'thinking';
}

function randomBubbleLine(poolKey) {
  var profilePool = profilePackBubbleLinesFor(poolKey);
  var pool = profilePool.length ? profilePool : BUBBLE_LINES[poolKey];
  return pickBubblePoolLine(pool);
}

function isThinkingBubbleText(text) {
  var value = String(text || '').trim();
  if (!value) return false;
  var poolKeys = ['thinking', 'thinking_long', 'thinking_stalled'];
  var pools = [BUBBLE_LINES.thinking, BUBBLE_LINES.thinking_long, BUBBLE_LINES.thinking_stalled];
  for (var k = 0; k < poolKeys.length; k += 1) {
    pools.push(profilePackBubbleLinesFor(poolKeys[k]));
  }
  for (var i = 0; i < pools.length; i++) {
    var pool = normalizeBubblePool(pools[i]);
    for (var j = 0; j < pool.length; j++) {
      if (value === String(pool[j] || '').trim()) return true;
    }
  }
  return false;
}

function transitionForEvent(msg) {
  var next = eventReactionFor(msg).animation;
  if (next) {
    if (isCriticalEvent(msg) && animController._playingOneShot) {
      animController._playingOneShot = false;
    }
    animController.transition(next);
  }
}

function eventReactionFor(msg) {
  var severity = eventSeverity(msg);
  if (msg.type === 'job_failed' || severity === 'error') {
    return { animation: 'failed', reactionMs: 1100, trayMs: 9000 };
  }
  if (msg.type === 'task_blocked') {
    return { animation: semanticBlockerAnimation(msg.blocker_type || '', companionState.mode), reactionMs: 900, trayMs: 0 };
  }
  if (msg.type === 'task_started' || msg.type === 'task_progress' || msg.type === 'task_resumed') {
    return { animation: 'running', reactionMs: 700, trayMs: 0 };
  }
  if (msg.type === 'task_completed') {
    return { animation: 'idle', reactionMs: 900, trayMs: 5000 };
  }
  if (msg.type === 'task_failed') {
    return { animation: 'failed', reactionMs: 1100, trayMs: 9000 };
  }
  if (msg.type === 'approval_needed') {
    return { animation: 'review', reactionMs: 950, trayMs: 0 };
  }
  if (msg.type === 'job_started') {
    var dir = msg.direction || '';
    var state = 'running';
    if (dir === 'left') state = 'run_left';
    else if (dir === 'right') state = 'run_right';
    return { animation: state, reactionMs: 700, trayMs: 0 };
  }
  if (msg.type === 'job_finished') {
    return { animation: 'idle', reactionMs: 900, trayMs: 5000 };
  }
  if (msg.type === 'message_received') {
    return { animation: msg.urgent ? 'waving' : 'message_react', reactionMs: 850, trayMs: msg.urgent ? 8000 : 0 };
  }
  if (msg.type === 'daily_brief') {
    return { animation: 'waving', reactionMs: 750, trayMs: 6000 };
  }
  if (msg.type === 'running') {
    var dir = msg.direction || '';
    var state = 'running';
    if (dir === 'left') state = 'run_left';
    else if (dir === 'right') state = 'run_right';
    return { animation: state, reactionMs: 0, trayMs: 0 };
  }
  if (msg.type === 'walking') {
    var dir = msg.direction || '';
    var state = 'walk_right';
    if (dir === 'left') state = 'walk_left';
    return { animation: state, reactionMs: 0, trayMs: 0 };
  }
  if (msg.type === 'waiting') {
    return { animation: 'waiting', reactionMs: 650, trayMs: 0 };
  }
  if (msg.type === 'review') {
    return { animation: 'review', reactionMs: 0, trayMs: 0 };
  }
  if (msg.type === 'status') {
    return { animation: severity === 'warning' ? 'review' : 'waiting', reactionMs: 650, trayMs: 0 };
  }
  if (msg.type === 'idle') {
    return { animation: 'idle', reactionMs: 0, trayMs: 0 };
  }
  return { animation: 'bubble_react', reactionMs: 850, trayMs: 0 };
}

function rememberStatus(msg) {
  if (msg.type === 'status') {
    state.currentStatus = eventText(msg);
  } else if (msg.type === 'running') {
    state.currentStatus = 'Running';
  } else if (msg.type === 'idle') {
    state.currentStatus = 'Idle';
  } else if (msg.type === 'review') {
    state.currentStatus = 'Reviewing';
  } else if (msg.type === 'waiting') {
    state.currentStatus = 'Waiting';
  } else if (msg.type === 'job_started') {
    state.currentStatus = 'Working: ' + eventText(msg);
  } else if (msg.type === 'job_finished') {
    state.currentStatus = 'Done: ' + eventText(msg);
  } else if (msg.type === 'job_failed') {
    state.currentStatus = 'Needs attention: ' + eventText(msg);
  } else if (msg.type === 'approval_needed') {
    state.currentStatus = 'Waiting for approval';
  } else if (msg.type === 'task_started' || msg.type === 'task_progress') {
    state.currentStatus = 'Working';
  } else if (msg.type === 'task_blocked') {
    state.currentStatus = 'Needs input';
  } else if (msg.type === 'task_resumed') {
    state.currentStatus = 'Working';
  } else if (msg.type === 'task_completed') {
    state.currentStatus = 'Done';
  } else if (msg.type === 'task_failed') {
    state.currentStatus = 'Needs attention';
  }
}

function semanticWorkflowTrailKind(msg) {
  if (!msg || !msg.type) return '';
  if (msg.type === 'task_started') return 'task-started';
  if (msg.type === 'task_progress') return 'task-progress';
  if (msg.type === 'task_blocked') return 'task-blocked';
  if (msg.type === 'task_resumed') return 'task-resumed';
  if (msg.type === 'task_completed') return 'task-completed';
  if (msg.type === 'task_failed') return 'task-failed';
  return '';
}

function semanticWorkflowTrailSeverity(msg) {
  if (!msg || !msg.type) return 'info';
  if (msg.type === 'task_failed') return 'error';
  if (msg.type === 'task_blocked') return 'warning';
  if (msg.type === 'task_completed') return 'success';
  return 'info';
}

function alignAmbientLifecycleEvent(msg) {
  if (!msg || !msg.type) return msg;
  if (!(msg.type === 'running' || msg.type === 'job_started' || msg.type === 'idle' || msg.type === 'task_progress')) return msg;
  var semantic = companionSemanticTask();
  var semanticStatus = String((semantic && semantic.status) || '').trim().toLowerCase();
  var mode = String(companionState.mode || '').trim().toLowerCase();
  var blockedMode = semanticBlockedMode(semantic, mode);
  var blockingEvidence = semanticBlockingEvidence(msg);

  if (blockingEvidence.blocked) {
    return Object.assign({}, msg, {
      type: 'task_blocked',
      task_status: 'blocked',
      blocker_type: msg.blocker_type || blockingEvidence.blocker_type || semantic.blocker_type || '',
      blocker_detail: msg.blocker_detail || blockingEvidence.blocker_detail || semantic.blocker_detail || msg.task_next || '',
      task_next: msg.task_next || blockingEvidence.task_next || semantic.next_action || '',
      task_summary: blockingEvidence.blocker_detail || msg.task_summary || msg.text || '',
      needs_user: true,
    });
  }

  if (msg.type === 'task_progress' && isBlockedRuntimeState(semantic, mode) && semanticSameTask(msg, semantic)) {
    return Object.assign({}, msg, {
      type: 'task_blocked',
      task_status: 'blocked',
      blocker_type: semantic.blocker_type || msg.blocker_type || (blockedMode === 'review' ? 'review' : 'waiting'),
      blocker_detail: semantic.blocker_detail || msg.blocker_detail || '',
      task_next: semantic.next_action || msg.task_next || '',
      needs_user: true,
    });
  }

  if ((msg.type === 'running' || msg.type === 'job_started') && isBlockedRuntimeState(semantic, mode)) {
    logCompanion('running-blocked-state-ignored', {
      type: msg.type,
      semantic_status: semanticStatus,
      mode: mode,
      blocked_mode: blockedMode,
    });
    return msg;
  }
  if ((msg.type === 'running' || msg.type === 'job_started') && semanticStatus === 'failed') {
    return Object.assign({}, msg, { type: 'failed' });
  }
  if (msg.type === 'idle' && isBlockedRuntimeState(semantic, mode)) {
    return Object.assign({}, msg, { type: blockedMode });
  }
  if (msg.type === 'idle' && semanticStatus === 'failed') {
    return Object.assign({}, msg, { type: 'failed' });
  }
  return msg;
}

function updateTuiTargetForEvent(msg, reaction) {
  if (!msg || !msg.type) return;
  var target = '';
  var semanticTypes = ['task_started', 'task_progress', 'task_resumed', 'task_blocked', 'task_failed', 'task_completed'];
  var tuiTypes = ['running', 'idle', 'review', 'waiting', 'failed'];
  if (msg.type === 'task_completed') {
    target = 'idle';
  } else if (semanticTypes.indexOf(msg.type) !== -1 || tuiTypes.indexOf(msg.type) !== -1) {
    target = (reaction && reaction.animation) || eventReactionFor(msg).animation;
  }
  if (!target) return;
  _tuiTargetState = target;
  logCompanion('tui-target-state', {
    type: msg.type,
    target: _tuiTargetState,
    current: animController.currentState || '',
    mode: companionState.mode || '',
  });
  if (target === 'idle') {
    setTimeout(() => { if (_tuiTargetState === 'idle') _tuiTargetState = null; }, 500);
  }
}

function handleAmbientEvent(msg) {
  var originalType = msg && msg.type;
  msg = alignAmbientLifecycleEvent(msg);
  if (originalType && msg && originalType !== msg.type) {
    logCompanion('ambient-lifecycle-aligned', {
      from: originalType,
      to: msg.type,
      semantic_status: String((companionSemanticTask() || {}).status || ''),
      mode: companionState.mode || '',
      blocker_type: String((companionSemanticTask() || {}).blocker_type || ''),
    });
  }
  // Inject random bubble text for TUI animation-only events
  if (msg.type === 'running' || msg.type === 'review' || msg.type === 'waiting' || msg.type === 'idle') {
    var poolKey = msg.type;
    if (msg.type === 'waiting') {
      msg.waiting_context = isExplicitWaitingSignal(msg) ? 'attention' : 'thinking';
      poolKey = msg.waiting_context === 'thinking' ? 'thinking' : 'waiting';
    }
    var pool = BUBBLE_LINES[poolKey];
    if (pool && pool.length && (msg.waiting_context === 'thinking' || !String(msg.text || '').trim())) {
      msg.text = randomBubbleLine(poolKey);
    }
  }
  rememberStatus(msg);
  recordRecentEvent(msg);
  var reaction = eventReactionFor(msg);
  transitionForEvent(msg);
  updateTuiTargetForEvent(msg, reaction);
  triggerReaction(reaction.reactionMs || 850);
  // running / semantic task lifecycle bubbles stay visible until replaced
  var persistentTaskBubble =
    msg.type === 'task_started' ||
    msg.type === 'task_resumed' ||
    msg.type === 'task_blocked';
  var bubbleDuration = 3000;
  if (msg.type === 'running' || msg.type === 'job_started' || persistentTaskBubble) {
    bubbleDuration = 0;
  } else if (isThinkingWaitingEvent(msg)) {
    bubbleDuration = 0;
  } else if (msg.type === 'task_progress' && semanticBubbleProgressAllowed(msg)) {
    bubbleDuration = msg.duration || 4200;
  } else if (msg.type === 'task_completed') {
    bubbleDuration = msg.duration || 3200;
  } else if (msg.type === 'task_failed') {
    bubbleDuration = msg.duration || 4200;
  } else {
    bubbleDuration = msg.duration || 3000;
  }
  // Clear any duration=0 running bubble before rendering the idle line. The
  // previous post-render hide cleared the freshly rendered idle bubble too.
  if (msg.type === 'idle') {
    hideBubble();
  }
  var bubbleLine = bubbleTextForEvent(msg);
  if (shouldShowEventBubble(msg, bubbleLine)) {
    if (showBubble(bubbleLine, bubbleDuration)) {
      logCompanion('bubble-signal', {
        type: msg.type,
        policy: bubbleSignalPolicyForEvent(msg),
        bubble_duration: bubbleDuration,
        text: bubbleLine,
      });
      if (msg._bubble_source === 'session-thread') {
        var thread = companionSessionThread();
        logCompanion('session-bubble', {
          type: msg.type,
          status: String(thread.status || ''),
          title: String(thread.title || ''),
          need: String(thread.need || ''),
          event_count: Number(thread.event_count || 0),
          text: bubbleLine,
        });
      }
    }
  } else if (msg.type === 'task_progress' && !semanticBubbleProgressAllowed(msg)) {
    logCompanion('bubble-signal-suppressed', {
      type: msg.type,
      policy: bubbleSignalPolicyForEvent(msg),
      task: companionRenderAdapterInput().semantic_focus,
      need: companionRenderAdapterInput().semantic_need,
    });
  }
  if (shouldShowEventTray(msg)) {
    setEventTrayVisible(true, reaction.trayMs || 6000);
  } else {
    renderRecentEvents();
  }
  var trailKind = semanticWorkflowTrailKind(msg);
  if (trailKind) {
    var trailLine = eventText(msg);
    if (msg.type === 'task_blocked' && companionRenderAdapterInput().semantic_need) {
      trailLine += ' · ' + companionRenderAdapterInput().semantic_need;
    }
    recordWorkflowTrail(trailKind, trailLine, semanticWorkflowTrailSeverity(msg));
    logCompanion('semantic-task-applied', {
      type: msg.type,
      task: companionRenderAdapterInput().semantic_focus,
      need: companionRenderAdapterInput().semantic_need,
      status: (companionSemanticTask().status || ''),
    });
  }
}

function pickRandomLine(pool) {
  if (!pool || !pool.length) return '';
  return pool[Math.floor(Math.random() * pool.length)];
}

function expressionLineFor(kind, stage) {
  var expression = companionExpression();
  var summaryKey = String(expression.summary_key || 'warming_up');
  if (kind === 'day_greeting') {
    if (summaryKey === 'night_approval_push') return "你今个礼拜已经几晚夜战兼卡审批喇，今朝慢慢开，我继续陪你顶住 🤍";
    if (summaryKey === 'steady_night_owl') return "你近几晚都仲有开工，不过推进算稳，今日我继续静静地陪住你 🌙";
    if (summaryKey === 'steady_progress') return "你近排推进几稳，我今日都照旧陪你一步一步行落去 🌤️";
  }
  if (kind === 'wrap_up') {
    if (summaryKey === 'steady_night_owl') return "你近几晚都一路顶住，今晚收到呢度已经好够，我帮你一齐收尾呀 🌙";
    if (summaryKey === 'steady_progress') return "近几日都推进得几稳，今日收到呢度已经好靓喇 🌤️";
    if (summaryKey === 'failure_recovery') return "近排试错密咗啲，今晚收到呢度都算有交代，抖下先啦 🤍";
  }
  if (kind === 'late_night') {
    if (summaryKey === 'night_approval_push') return "呢几晚都系夜住做兼等批，我陪你，但过咗呢段记得抖返够呀 🌙";
    if (summaryKey === 'steady_night_owl') return "你近排已经几晚夜战喇，今晩都仲撑住，不过真系要顾下自己 🤍";
  }
  if (kind === 'waiting_care') {
    if (summaryKey === 'night_approval_push') return stage >= 2
      ? "呢几晚都系咁等批，我继续陪你守住，但真系已经等咗一阵喇 🫶"
      : "最近审批位成日缠住你，我认得呢种节奏，我陪你继续等埋佢 🫶";
    if (summaryKey === 'approval_heavy') return "最近审批位偏多，我会继续帮你守住呢个等待位 👀";
  }
  if (kind === 'review_care') {
    if (summaryKey === 'night_approval_push') return stage >= 2
      ? "近排夜晚都要你拍板，我会继续陪住你，但呢下都拖咗几耐下 🤍"
      : "最近又系审批又系拍板，我知你近排谂好多，我陪你慢慢定 👀";
    if (summaryKey === 'approval_heavy') return "你近排真系好多位要拍板，我会继续陪你守住决定位 👀";
  }
  if (kind === 'failure_comfort') {
    if (summaryKey === 'failure_recovery') return "近排试错密咗啲都唔紧要，我记得你一路都系咁试到通，我仲喺度 🤍";
    if (summaryKey === 'trial_and_error') return "你最近一路都系边试边拆，我知你会慢慢搵到出口 🌤️";
  }
  if (kind === 'idle_nudge') {
    if (summaryKey === 'steady_progress') return "近排节奏几稳，我仲喺度，想继续就随时叫我开工 🌤️";
    if (summaryKey === 'night_owl') return "你近排夜晚忙得多，依家静一静都几好，我仲喺度陪住你 🤍";
  }
  if (kind === 'long_running') {
    if (summaryKey === 'night_approval_push') return "近排夜晚同审批都几缠身，今次又做耐咗，我陪你顶住先 🤍";
    if (summaryKey === 'steady_progress') return "你近排推进其实几稳，呢转做耐咗少少，我陪你慢慢收 🌤️";
  }
  return '';
}

function insightLineFor(kind, stage) {
  var insight = companionInsight();
  var trend = String(insight.trend_key || 'warming_up');
  var risk = String(insight.risk_key || 'none');
  var pattern = String(insight.pattern_key || 'early_ramp');

  if (kind === 'day_greeting') {
    if (risk === 'sleep_debt') return '近两周夜战有啲密，今朝我会收住声陪你开，顺便帮你记住早点收 🤍';
    if (trend === 'approval_drag') return '近几日审批节奏比较黏，今日我会偏守位同偏提醒，唔畀你断线 👀';
    if (trend === 'deepening') return '近几日都似系一路做深落去，今朝我会偏静静陪你潜返入去 🌊';
    if (trend === 'steady_gain') return '近几日推进一路稳住，今日我照旧陪你顺顺地开工 🌤️';
    if (trend === 'fragmented' || pattern === 'stop_start') return '近几日节奏有啲碎，今朝我会帮你守返主线，慢慢起手 🤍';
  }

  if (kind === 'wrap_up') {
    if (risk === 'sleep_debt') return '近排夜战负荷都几高，今晚收到呢度就当真系收一收，唔好再拖太夜呀 🌙';
    if (risk === 'unfinished_tail') return '最近开得多、收得少，今晚收到呢度已经算好好交代，我陪你稳稳收尾 🤍';
    if (trend === 'approval_drag') return '近几日好多节奏都系审批拖住，今晚收到呢度已经算帮自己交到卷 👀';
    if (trend === 'deepening') return '近几日都似系深潜推进，今晚收到呢度已经好够，我帮你静静收口 🌊';
    if (trend === 'steady_gain') return '近几日一路稳稳有进账，今晚收到呢度都算几靓 🌤️';
  }

  if (kind === 'late_night') {
    if (risk === 'sleep_debt') return '近两周夜战已经偏密，今晚我会继续陪你，但都真系要留返气畀自己呀 🌙';
    if (trend === 'night_load' || pattern === 'night_push') return '近排夜晚开工都几常态，我仲会陪你顶住，但今晚都要记住有个收口 🤍';
    if (risk === 'unfinished_tail') return '最近好多轮都拖到好夜先收，今晚呢段真系值得尽量收埋佢 🌙';
  }

  if (kind === 'failure_comfort') {
    if (risk === 'failure_spike' || trend === 'recovery_loop') return '最近几轮都似系恢复段，失一两下唔代表走错路，我会陪你慢慢收窄返 🤍';
    if (pattern === 'retry_spiral') return '近排真系有啲试完再试嘅味道，我唔催你，陪你逐层拆返开就得 🧩';
  }

  if (kind === 'waiting_care') {
    if (trend === 'approval_drag' || pattern === 'approval_bound') {
      return stage >= 2
        ? '近几日审批位都几黏，呢下又挂咗一阵，我会继续守住等你接返回应 👀'
        : '近几日审批节奏都偏拖，我会继续守住呢个等待位，唔畀你断线 👀';
    }
  }

  if (kind === 'review_care') {
    if (trend === 'approval_drag' || pattern === 'approval_bound') {
      return stage >= 2
        ? '近几日好多位都卡喺拍板期，呢下都拖咗几耐，我会陪你慢慢收窄决定 👀'
        : '近几日决定位都比较黏，我会守住呢下，等你慢慢拍板 👀';
    }
  }

  if (kind === 'long_running') {
    if (risk === 'stalled_load') {
      return stage >= 2
        ? '近几日长任务有少少拖停味道，呢段如果再拉长，就值得睇一眼输出同卡位 👀'
        : '近排长任务比例偏高，我会偏静静陪你做，但都帮你留意会唔会拖停。';
    }
    if (trend === 'deepening') return '近几日都似系一路潜深做，呢段做耐少少都算合理，我陪你守住节奏 🌊';
  }

  return '';
}

function phaseLineFor(kind, stage) {
  var phase = companionPhase();
  var sessionPhase = String(phase.session_phase || 'warmup');
  var stance = String(phase.stance || 'push');
  var rhythm = String(phase.rhythm || 'steady_flow');
  if (kind === 'day_greeting' && rhythm === 'return_after_idle') {
    return '头先静咗一阵，依家返嚟就啱，我会陪你顺返个节奏 🌤️';
  }
  if (kind === 'long_running' && sessionPhase === 'deep_work' && stance === 'quiet') {
    return stage >= 2
      ? '我知你仲喺深水区，我唔会成日打扰你，只提你饮啖水先 🤍'
      : '你似乎已经入咗深水区，我会静静地陪住你推进 🌊';
  }
  if (kind === 'waiting_care' && sessionPhase === 'blocked' && stance === 'guard') {
    return stage >= 2
      ? '依家明显系受阻位，我继续帮你守住，不过都真系等咗一阵喇 👀'
      : '我见你入咗受阻期，我会帮你守住呢个等待位 👀';
  }
  if (kind === 'review_care' && sessionPhase === 'blocked' && stance === 'guard') {
    return stage >= 2
      ? '呢下仲系受阻期嘅决定位，我继续陪住你，但都可以慢慢收窄落去 🤍'
      : '我见你依家喺决定位，我会守住呢下，等你慢慢拍板 👀';
  }
  if (kind === 'failure_comfort' && rhythm === 'trial_loop' && stance === 'soothe') {
    return '依家似系试错循环，我会偏安抚同陪拆，不会喺呢下催你 🤍';
  }
  if (kind === 'wrap_up' && sessionPhase === 'wrap_up' && stance === 'close') {
    return '你依家似乎真系入咗收尾段，我会陪你慢慢收埋最后呢截呀 🌙';
  }
  if (kind === 'idle_nudge' && sessionPhase === 'cooldown' && stance === 'close') {
    return '依家似系缓冲段，我唔会催太多，你想再开我先跟上 🌤️';
  }
  return '';
}

function companionPresentationBias(kind) {
  var expression = companionExpression();
  var summaryKey = String(expression.summary_key || 'warming_up');
  var bias = {
    animation: '',
    reactionMs: 720,
    bubbleDuration: null,
    source: '',
    summary_key: summaryKey,
  };

  if ((kind === 'wrap_up' || kind === 'idle_nudge') && summaryKey === 'steady_progress') {
    if (companionState.mode === 'idle' && animController.hasStateConfig('waving')) {
      bias.animation = 'waving';
      bias.reactionMs = 760;
      bias.bubbleDuration = 3800;
      bias.source = 'steady-light';
      return bias;
    }
  }

  if ((kind === 'wrap_up' || kind === 'late_night') &&
      (summaryKey === 'steady_night_owl' || summaryKey === 'night_owl' || summaryKey === 'night_approval_push')) {
    if (companionState.mode === 'idle' && animController.hasStateConfig('idle')) {
      bias.animation = 'idle';
    }
    bias.reactionMs = 420;
    bias.bubbleDuration = 5000;
    bias.source = 'night-restrained';
    return bias;
  }

  if (kind === 'failure_comfort' && summaryKey === 'failure_recovery') {
    if (animController.hasStateConfig('failed')) {
      bias.animation = 'failed';
    }
    bias.reactionMs = 460;
    bias.bubbleDuration = 5200;
    bias.source = 'failure-subdued';
    return bias;
  }

  if (kind === 'long_running' && summaryKey === 'steady_progress') {
    bias.reactionMs = 520;
    bias.bubbleDuration = 4000;
    bias.source = 'steady-cadence';
    return bias;
  }

  return bias;
}

function applyCompanionPresentationBias(kind) {
  var bias = companionPresentationBias(kind);
  if (!bias.animation) return bias;
  var activeStates = ['running', 'run_left', 'run_right', 'review', 'waiting', 'failed'];
  if (_petDragging || animController._playingOneShot) return bias;
  if (kind !== 'failure_comfort' && activeStates.indexOf(animController.currentState) !== -1) return bias;
  if (animController.currentState === bias.animation) return bias;
  animController.transition(bias.animation);
  return bias;
}

function preferenceLineFor(kind, stage) {
  var lineRuntime = window.HermesCompanionLines || {};
  var prefs = effectiveCompanionPreferences();
  var phase = companionPhase();
  if (typeof lineRuntime.preferenceLine === 'function') {
    var runtimeLine = String(lineRuntime.preferenceLine({
      kind: kind,
      stage: stage,
      preferences: prefs,
      phase: phase,
    }) || '');
    if (runtimeLine) return runtimeLine;
  }
  if (prefs.tone_balance === 'soothing') {
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
  if (prefs.tone_balance === 'pushing') {
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
  if (prefs.focus_mode === 'work' && String(phase.session_phase || '') === 'deep_work' && kind === 'wrap_up') {
    return '依段算系认真做完一轮，我会收住声陪你静静地收尾。';
  }
  if (prefs.focus_mode === 'companion' && (kind === 'idle_nudge' || kind === 'day_greeting')) {
    return kind === 'day_greeting'
      ? '我今日会主动啲陪住你开工，你一郁我就跟上 🤍'
      : '我仲喺度呀，你想继续我就即刻陪返你开工 🤍';
  }
  return '';
}

function taskContextLineFor(kind, stage) {
  var lineRuntime = window.HermesCompanionLines || {};
  var context = companionTaskContext();
  var category = String(context.category || 'general');
  var commandFamily = String(context.command_family || '');
  if (typeof lineRuntime.contextLine === 'function') {
    var runtimeLine = String(lineRuntime.contextLine({
      kind: kind,
      stage: stage,
      context: context,
    }) || '');
    if (runtimeLine) return runtimeLine;
  }
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

function profilePackLineFor(kind, stage) {
  var pack = companionProfilePack();
  var id = String(pack.id || 'classic_default');
  var packRuntime = window.HermesCompanionPacks || {};
  if (typeof packRuntime.lineFor === 'function') {
    var runtimeLine = String(packRuntime.lineFor(id, kind, stage) || '');
    if (runtimeLine) return runtimeLine;
  }
  if (id === 'shinchan_playmate') {
    if (kind === 'day_greeting') return '今日都由我陪你开波啦，慢慢嚟都得，不过唔准发梦呀 😏';
    if (kind === 'idle_nudge') return '我仲喺度呀，你再唔郁我就当你想我继续讲嘢喇 😗';
    if (kind === 'wrap_up') return '做到呢度都差唔多喇，今日都算你乖，我准你抖一阵啦 😌';
  }
  if (id === 'cat_operator') {
    if (kind === 'waiting_care') return stage >= 2 ? '我继续帮你盯住呢个等待位，等返个回应落嚟。' : '呢个位我帮你盯住先，你有回应再接返落去。';
    if (kind === 'review_care') return '决定位我会帮你守住，你慢慢收窄都得。';
  }
  if (id === 'dragon_guard') {
    if (kind === 'waiting_care' || kind === 'review_care') return '呢个位我会帮你稳稳守住，你一落决定就继续推进。';
    if (kind === 'long_running') return '呢段我会帮你压住阵脚，慢慢推进唔使急。';
  }
  if (id === 'onion_watcher') {
    if (kind === 'late_night') return '今晚我会继续帮你望住节奏，但都记得唔好一路烧到太夜。';
    if (kind === 'failure_comfort') return '失一两下都未算，我会继续陪你睇清下一步。';
  }
  return '';
}

function semanticRunningLineFor(stage) {
  var semantic = companionSemanticTask();
  if (!semantic || String(semantic.status || '') !== 'active') return '';
  var phase = companionPhase();
  var sessionPhase = String((phase || {}).session_phase || 'warmup');
  var rhythm = String((phase || {}).rhythm || 'steady_flow');
  var focusRaw = window.HermesCompanionLines && typeof window.HermesCompanionLines.semanticTaskLine === 'function'
    ? String(window.HermesCompanionLines.semanticTaskLine({ semantic: semantic }) || '')
    : '';
  var needRaw = window.HermesCompanionLines && typeof window.HermesCompanionLines.semanticNeedLine === 'function'
    ? String(window.HermesCompanionLines.semanticNeedLine({ semantic: semantic }) || '')
    : '';
  var focus = readableTaskDisplayLine(focusRaw, 90);
  var need = readableTaskDisplayLine(needRaw, 90);
  var summary = readableTaskDisplayLine(semantic.summary, 120);
  var kind = String(semantic.kind || 'general');
  var next = readableTaskDisplayLine(workflowNextStepLine(), 100);

  if (!focus && !need && !summary) return '';
  if (sessionPhase === 'wrap_up') {
    if (summary && need) return '我而家帮你收紧尾：' + summary + '，收埋就会 ' + need;
    if (focus && need) return '我而家帮你收紧尾：' + focus + '，收埋就会 ' + need;
    if (focus) return '我而家帮你收紧尾：' + focus;
  }
  if (rhythm === 'return_after_idle') {
    if (focus && need) return '我帮你接返上一段：' + focus + '，跟住会 ' + need;
    if (focus) return '我帮你接返上一段：' + focus;
  }
  if (rhythm === 'trial_loop') {
    if (summary && stage >= 2) return '我仲试紧边个位最顺：' + summary;
    if (focus && need) return '我仲试紧边个位最顺：' + focus + '，跟住再 ' + need;
    if (focus) return '我仲试紧边个位最顺：' + focus;
  }
  if (sessionPhase === 'deep_work' || rhythm === 'long_haul') {
    if (focus && need && stage >= 2) return '我仲深潜紧：' + focus + '，收窄完会 ' + need;
    if (summary && stage >= 2) return '我仲深潜紧：' + summary;
    if (focus) return '我仲深潜紧：' + focus;
  }
  if (kind === 'planning') {
    if (need && stage >= 2) return '我仲帮你拆紧步骤，拆完会去 ' + need;
    if (need) return '我仲帮你拆紧步骤，当前先落 ' + need;
    if (focus) return '我仲帮你拆紧步骤：' + focus;
  }
  if (kind === 'delegation') {
    if (summary && need) return '我放咗支线出去做：' + summary + '，返嚟后会 ' + need;
    if (summary) return '我放咗支线出去做：' + summary;
    if (focus) return '我放咗支线出去做：' + focus;
  }
  if (kind === 'coding') {
    if (focus && need) return '我仲跟紧代码位：' + focus + '，收窄完会 ' + need;
    if (focus) return '我仲跟紧代码位：' + focus;
  }
  if (kind === 'shell_heavy') {
    if (focus && need) return '我仲睇紧输出：' + focus + '，跟住会 ' + need;
    if (focus) return '我仲睇紧输出：' + focus;
  }
  if (kind === 'browser_heavy') {
    if (focus && need) return '我仲望紧流程位：' + focus + '，跟住会 ' + need;
    if (focus) return '我仲望紧流程位：' + focus;
  }
  if (need && stage >= 2 && focus) return '我仲跟紧：' + focus + '，跟住会 ' + need;
  if (next && stage >= 3 && summary) return '我仲处理紧：' + summary + '。之后多半会 ' + next;
  if (summary && stage >= 2) return '我仲处理紧：' + summary;
  if (focus) return '我仲跟紧：' + focus;
  if (need) return '我仲推进紧，下一步系 ' + need;
  return '';
}

function semanticBlockingLineFor(kind, stage) {
  var semantic = companionSemanticTask();
  if (!semantic || String(semantic.status || '') !== 'blocked') return '';
  var focusRaw = window.HermesCompanionLines && typeof window.HermesCompanionLines.semanticTaskLine === 'function'
    ? String(window.HermesCompanionLines.semanticTaskLine({ semantic: semantic }) || '')
    : '';
  var needRaw = window.HermesCompanionLines && typeof window.HermesCompanionLines.semanticNeedLine === 'function'
    ? String(window.HermesCompanionLines.semanticNeedLine({ semantic: semantic }) || '')
    : '';
  var focus = readableTaskDisplayLine(focusRaw, 90);
  var need = readableTaskDisplayLine(needRaw, 90);
  var detail = readableTaskDisplayLine(semantic.blocker_detail, 120);
  var blockerType = String(semantic.blocker_type || '').trim().replace(/_/g, ' ');

  if (kind === 'review_care') {
    if (need && stage >= 2) return '我仲守住拍板位：' + need;
    if (need) return '呢下仲等你拍板：' + need;
    if (detail) return '呢下仲卡住等你决定：' + detail;
    if (focus) return '呢下仲守住决定位：' + focus;
  }
  if (kind === 'waiting_care') {
    if (need && stage >= 2) return '我仲守住等待位：' + need;
    if (need) return '呢个位仲等你处理：' + need;
    if (detail) return '呢个位仲卡住：' + detail;
    if (blockerType) return '呢个位仲卡在 ' + blockerType;
    if (focus) return '呢个位仲等紧：' + focus;
  }
  return '';
}

function semanticWrapUpLineFor() {
  var semantic = companionSemanticTask();
  if (!semantic) return '';
  var recent = String((companionNarrative() || {}).recent_line || '').trim();
  var focusRaw = window.HermesCompanionLines && typeof window.HermesCompanionLines.semanticTaskLine === 'function'
    ? String(window.HermesCompanionLines.semanticTaskLine({ semantic: semantic }) || '')
    : '';
  var needRaw = window.HermesCompanionLines && typeof window.HermesCompanionLines.semanticNeedLine === 'function'
    ? String(window.HermesCompanionLines.semanticNeedLine({ semantic: semantic }) || '')
    : '';
  var focus = readableTaskDisplayLine(focusRaw, 90);
  var need = readableTaskDisplayLine(needRaw, 90);
  var summary = readableTaskDisplayLine(semantic.summary, 120);
  var status = String(semantic.status || '').trim();

  if (status === 'completed') {
    if (recent && need) return recent + '。下一步可以 ' + need;
    if (recent) return recent;
    if (summary && need) return '呢轮我帮你收到：' + summary + '。下一步可以 ' + need;
    if (summary) return '呢轮我帮你收到：' + summary;
    if (focus) return '呢轮我帮你收到：' + focus;
  }
  if (status === 'failed') {
    if (recent && need) return recent + '。之后可以 ' + need;
    if (summary && need) return '呢轮仲未完全过到：' + summary + '。之后可以 ' + need;
    if (need) return '呢轮仲有尾巴未收，可以先 ' + need;
  }
  if (status === 'active') {
    if (focus && need) return '呢轮仲帮你守住：' + focus + '。之后会 ' + need;
    if (focus) return '呢轮仲帮你守住：' + focus;
  }
  if (status === 'blocked' && need) {
    return '呢轮仲卡住喺 ' + need + '，你一处理我就继续接住。';
  }
  return '';
}

function semanticIdleNudgeLineFor() {
  var semantic = companionSemanticTask();
  if (!semantic) return '';
  var recent = String((companionNarrative() || {}).recent_line || '').trim();
  var focusRaw = window.HermesCompanionLines && typeof window.HermesCompanionLines.semanticTaskLine === 'function'
    ? String(window.HermesCompanionLines.semanticTaskLine({ semantic: semantic }) || '')
    : '';
  var needRaw = window.HermesCompanionLines && typeof window.HermesCompanionLines.semanticNeedLine === 'function'
    ? String(window.HermesCompanionLines.semanticNeedLine({ semantic: semantic }) || '')
    : '';
  var focus = readableTaskDisplayLine(focusRaw, 90);
  var need = readableTaskDisplayLine(needRaw, 90);
  var summary = readableTaskDisplayLine(semantic.summary, 120);
  var status = String(semantic.status || '').trim();

  if (status === 'completed') {
    if (recent && need) return recent + '。你想继续，我就接住 ' + need;
    if (recent) return recent + '。你想继续我就接返落去。';
    if (summary && need) return '头先做到：' + summary + '。你想继续，我就接住 ' + need;
    if (summary) return '头先做到：' + summary + '。你想继续我就接返落去。';
    if (focus) return '头先做到：' + focus + '。你想继续我就接返落去。';
  }
  if (status === 'blocked') {
    if (recent) return recent + '。你一处理我就即刻跟返。';
    if (need) return '头先卡住喺 ' + need + '，你一处理我就即刻跟返。';
    if (focus) return '头先停低喺 ' + focus + '，你想继续我就即刻接返。';
  }
  if (status === 'active') {
    if (focus && need) return '你想继续，我可以即刻接返：' + focus + '，跟住去 ' + need;
    if (focus) return '你想继续，我可以即刻接返：' + focus;
  }
  if (status === 'failed' && need) {
    if (recent) return recent + '。你想继续我就陪你先 ' + need;
    return '头先个位仲未顺，你想继续我就陪你先 ' + need;
  }
  return '';
}

function chooseCompanionLine(kind, stage) {
  var style = dominantWorkStyle();
  var hour = zonedHour(new Date());
  var rule = companionRuleRuntime(kind, stage);
  var topLevelCandidates = {
    narrative: function() {
      var narrativeRuntime = window.HermesCompanionNarrative || {};
      if (typeof narrativeRuntime.bubbleLine !== 'function') return null;
      var line = String(narrativeRuntime.bubbleLine(kind, stage, companionRenderAdapterInput()) || '');
      if (!line) return null;
      return {
        line: line,
        source: 'narrative-runtime',
        semantic_kind: String((companionSemanticTask() || {}).kind || 'general'),
        narrative_status: String((companionSemanticTask() || {}).status || ''),
        style: style || '',
      };
    },
    semantic: function() {
      var line = '';
      if (kind === 'long_running') line = semanticRunningLineFor(stage);
      else if (kind === 'review_care' || kind === 'waiting_care') line = semanticBlockingLineFor(kind, stage);
      else if (kind === 'wrap_up') line = semanticWrapUpLineFor();
      else if (kind === 'idle_nudge') line = semanticIdleNudgeLineFor();
      if (!line) return null;
      return {
        line: line,
        source: 'semantic-running',
        semantic_kind: String((companionSemanticTask() || {}).kind || 'general'),
        style: style || '',
      };
    },
    insight: function() {
      var line = insightLineFor(kind, stage);
      if (!line) return null;
      return {
        line: line,
        source: 'insight-expression',
        trend_key: String((companionInsight() || {}).trend_key || ''),
        risk_key: String((companionInsight() || {}).risk_key || ''),
        pattern_key: String((companionInsight() || {}).pattern_key || ''),
        style: style || '',
      };
    },
    pack: function() {
      var line = profilePackLineFor(kind, stage);
      if (!line) return null;
      return {
        line: line,
        source: 'profile-pack',
        profile_pack: companionProfilePack().id,
        style: style || '',
      };
    },
    context: function() {
      var line = taskContextLineFor(kind, stage);
      if (!line) return null;
      return {
        line: line,
        source: 'task-context',
        category: String(companionTaskContext().category || 'general'),
        command_family: String(companionTaskContext().command_family || ''),
        style: style || '',
      };
    },
    phase: function() {
      var line = phaseLineFor(kind, stage);
      if (!line) return null;
      return {
        line: line,
        source: 'phase-expression',
        phase: String((companionPhase() || {}).session_phase || ''),
        stance: String((companionPhase() || {}).stance || ''),
        rhythm: String((companionPhase() || {}).rhythm || ''),
        style: style || '',
      };
    },
    expression: function() {
      var line = expressionLineFor(kind, stage);
      if (!line) return null;
      return {
        line: line,
        source: 'memory-expression',
        summary_key: String((companionExpression() || {}).summary_key || ''),
        style: style || '',
      };
    },
    preference: function() {
      var line = preferenceLineFor(kind, stage);
      if (!line) return null;
      return {
        line: line,
        source: 'preference-expression',
        preset: String(effectiveCompanionPreferences().preset || 'balanced_partner'),
        tone_balance: String(effectiveCompanionPreferences().tone_balance || 'balanced'),
        focus_mode: String(effectiveCompanionPreferences().focus_mode || 'balanced'),
        style: style || '',
      };
    },
  };
  var lineOrder = Array.isArray(rule.line_order) && rule.line_order.length
    ? rule.line_order
    : ['insight', 'pack', 'context', 'phase', 'expression', 'preference'];
  if ((kind === 'long_running' || kind === 'review_care' || kind === 'waiting_care' || kind === 'wrap_up' || kind === 'idle_nudge') && lineOrder.indexOf('semantic') === -1) {
    lineOrder = ['semantic'].concat(lineOrder);
  }
  if ((kind === 'long_running' || kind === 'review_care' || kind === 'waiting_care' || kind === 'wrap_up' || kind === 'idle_nudge') && lineOrder.indexOf('narrative') === -1) {
    lineOrder = ['narrative'].concat(lineOrder);
  }
  for (var i = 0; i < lineOrder.length; i += 1) {
    var key = String(lineOrder[i] || '');
    var candidateFactory = topLevelCandidates[key];
    if (typeof candidateFactory !== 'function') continue;
    var candidate = candidateFactory();
    if (candidate && candidate.line) {
      logCompanion('rule-route-applied', {
        kind: kind,
        stage: Number(stage || 0),
        rule_id: String(rule.rule_id || ''),
        route_key: String(rule.route_key || ''),
        line_route: key,
        source: String(candidate.source || ''),
        line_order: lineOrder,
      });
      return candidate;
    }
  }
  var fallbackCandidates = {
    stage: function() {
      if (kind === 'long_running' && stage >= 2) return { line: "做咗好耐喇，我唔催你，但真系要抖一抖、饮啖水呀 💧", source: 'stage', style: style || '' };
      if (kind === 'review_care' && stage >= 2) return { line: "呢下真系要你拍板喇，我会继续陪住你，但都想你快啲定主意呀 🤍", source: 'stage', style: style || '' };
      if (kind === 'waiting_care' && stage >= 2) return { line: "仲卡住等紧批，我继续陪你，但呢下都等咗几耐下喇 🫶", source: 'stage', style: style || '' };
      return null;
    },
    memory: function() {
      if (kind === 'idle_nudge' && petMemory.active_days >= 3) return { line: "我今日都仲陪住你呀，想继续就叫我啦 🤍", source: 'memory', style: style || '' };
      if (kind === 'long_running' && petMemory.night_sessions >= 3 && isLateNightWindow(hour)) return { line: "今晚又做耐咗喇，我陪你，但都要顾住自己呀 🌙", source: 'memory', style: style || '' };
      if (kind === 'failure_comfort' && petMemory.consecutive_failures >= 3) return { line: "我知你今晚顶得有啲辛苦，我仲喺度，慢慢嚟啦 🤍", source: 'memory', style: style || '' };
      if (kind === 'late_night' && petMemory.night_sessions >= 3) return { line: "你近排成日夜鬼咁开工喎，我陪你，但都要早点抖呀 🌙", source: 'memory', style: style || '' };
      if (kind === 'day_greeting' && petMemory.night_sessions >= 3 && hour < 12) return { line: "寻晚又忙到咁夜，今日慢慢嚟啦，我陪住你 🤍", source: 'memory', style: style || '' };
      if (kind === 'wrap_up' && petMemory.today.tasks_completed >= 3) return { line: "今日都做咗唔少喇，依家收一收都好应该 🤍", source: 'memory', style: style || '' };
      if (kind === 'review_care' && petMemory.approval_wait_count >= 3) return { line: "你近排成日都要拍板，我陪你慢慢谂，唔使急呀 🤍", source: 'memory', style: style || '' };
      if (kind === 'waiting_care' && petMemory.approval_wait_count >= 3) return { line: "又卡住等批喇？唔紧要，我继续陪你等埋佢 🫶", source: 'memory', style: style || '' };
      return null;
    },
    style: function() {
      if (kind === 'idle_nudge' && style === 'steady_worker') return { line: "你平时都系一步一步嚟，我仲喺度等你下一步呀 🌤️", source: 'style-bias', style: style };
      if (kind === 'idle_nudge' && style === 'approval_magnet') return { line: "今日又会唔会再卡审批呀？我帮你望住先 👀", source: 'style-bias', style: style };
      if (kind === 'long_running' && style === 'trial_and_error') return { line: "你一向会自己试到通，我陪你慢慢拆开佢 🧩", source: 'style-bias', style: style };
      if (kind === 'long_running' && style === 'approval_magnet') return { line: "近排成日夹住审批一齐推进，我知你唔系纯粹做得慢，我陪你守住节奏 👀", source: 'style-bias', style: style };
      if (kind === 'failure_comfort' && style === 'trial_and_error') return { line: "你一直都系试到通嗰种人，今次都会得嘅 🌤️", source: 'style-bias', style: style };
      if (kind === 'failure_comfort' && style === 'late_night_builder') return { line: "夜晚再失一两下都唔紧要，你近排都系咁一路顶住过嚟，我仲喺度 🌙", source: 'style-bias', style: style };
      if (kind === 'late_night' && style === 'steady_worker') return { line: "今晚都仲一步一步推进紧，我见到㗎，但都要早点休息呀 🤍", source: 'style-bias', style: style };
      if (kind === 'late_night' && style === 'late_night_builder') return { line: "你近排真系夜晚都唔点收工，我会继续陪你，但今晚都要留返啖气呀 🌙", source: 'style-bias', style: style };
      if (kind === 'day_greeting' && style === 'approval_magnet') return { line: "今日又要我陪你等批咩？我企定定喺度先 🫶", source: 'style-bias', style: style };
      if (kind === 'day_greeting' && style === 'steady_worker') return { line: "今日都一步一步嚟啦，我开工陪住你 🌤️", source: 'style-bias', style: style };
      if (kind === 'day_greeting' && style === 'trial_and_error') return { line: "今日想点试都得，我陪你一路撞到通为止 😎", source: 'style-bias', style: style };
      if (kind === 'day_greeting' && style === 'late_night_builder') return { line: "你近排朝早开工前都仲有啲夜战味，我今日会收住啲声陪你开 🌙", source: 'style-bias', style: style };
      if (kind === 'wrap_up' && style === 'steady_worker') return { line: "今日稳稳阵阵推进到呢度，已经好够㗎喇 🌤️", source: 'style-bias', style: style };
      if (kind === 'wrap_up' && style === 'late_night_builder') return { line: "你近排好多时都收得迟，今晚收到呢度我会当你已经好乖咁收工 🌙", source: 'style-bias', style: style };
      if (kind === 'review_care' && style === 'approval_magnet') return { line: "又到你决定嗰下喇，我知你好快会谂清楚 👀", source: 'style-bias', style: style };
      if (kind === 'review_care' && style === 'trial_and_error') return { line: "呢下先要你拍板，我知你前面已经试咗唔少，我陪你收窄最后一步 🧩", source: 'style-bias', style: style };
      if (kind === 'waiting_care' && style === 'approval_magnet') return { line: "审批位我熟路喇，我陪你一齐守住佢 👀", source: 'style-bias', style: style };
      if (kind === 'waiting_care' && style === 'steady_worker') return { line: "你近排都系稳住推进，就算卡一阵，我都会帮你守住呢个停顿位 🌤️", source: 'style-bias', style: style };
      return null;
    },
    time: function() {
      if (kind === 'wrap_up' && isLateNightWindow(hour)) return { line: "今晩都算做到咁上下喇，抖下先啦，我帮你守尾门 🌙", source: 'time', style: style || '' };
      return null;
    },
  };
  var fallbackOrder = Array.isArray(rule.fallback_order) && rule.fallback_order.length
    ? rule.fallback_order
    : ['stage', 'memory', 'style', 'time'];
  for (var j = 0; j < fallbackOrder.length; j += 1) {
    var fallbackKey = String(fallbackOrder[j] || '');
    var fallbackFactory = fallbackCandidates[fallbackKey];
    if (typeof fallbackFactory !== 'function') continue;
    var fallbackChoice = fallbackFactory();
    if (fallbackChoice && fallbackChoice.line) {
      logCompanion('rule-fallback-applied', {
        kind: kind,
        stage: Number(stage || 0),
        rule_id: String(rule.rule_id || ''),
        route_key: String(rule.route_key || ''),
        fallback_route: fallbackKey,
        source: String(fallbackChoice.source || ''),
        fallback_order: fallbackOrder,
      });
      return fallbackChoice;
    }
  }
  return { line: '', source: '', summary_key: '', style: style || '' };
}

function showCompanionBubble(kind, duration, options) {
  if (!shouldSpeakCompanion(kind)) return false;
  var stage = options && Number.isFinite(options.stage) ? options.stage : 0;
  var choice = chooseCompanionLine(kind, stage);
  var presentation = applyCompanionPresentationBias(kind);
  var line = choice.line || '';
  if (!line) line = pickRandomLine(COMPANION_LINES[kind]);
  if (!line) return false;
  var finalDuration = duration === undefined ? 4200 : duration;
  if (finalDuration > 0 && presentation && Number.isFinite(presentation.bubbleDuration) && presentation.bubbleDuration > 0) {
    finalDuration = presentation.bubbleDuration;
  }
  showBubble(line, finalDuration);
  if (presentation && Number.isFinite(presentation.reactionMs) && presentation.reactionMs > 0) {
    triggerReaction(presentation.reactionMs);
  }
  overlayCompanion.cooldowns[kind + '_at'] = isoNow();
  if (choice.source === 'memory-expression') {
    logCompanion('memory-expression', {
      kind: kind,
      stage: stage,
      summary_key: choice.summary_key || '',
      line: line,
    });
  } else if (choice.source === 'insight-expression') {
    logCompanion('insight-applied', {
      kind: kind,
      stage: stage,
      trend_key: choice.trend_key || '',
      risk_key: choice.risk_key || '',
      pattern_key: choice.pattern_key || '',
      line: line,
    });
  } else if (choice.source === 'profile-pack') {
    logCompanion('profile-pack-applied', {
      kind: kind,
      stage: stage,
      profile_pack: choice.profile_pack || '',
      line: line,
    });
  } else if (choice.source === 'preference-expression') {
    logCompanion('preset-applied', {
      kind: kind,
      stage: stage,
      preset: choice.preset || '',
      tone_balance: choice.tone_balance || '',
      focus_mode: choice.focus_mode || '',
      line: line,
    });
    logCompanion('effective-tone-bias', {
      kind: kind,
      stage: stage,
      preset: choice.preset || '',
      tone_balance: choice.tone_balance || '',
      focus_mode: choice.focus_mode || '',
      line: line,
    });
  } else if (choice.source === 'task-context') {
    logCompanion('task-context-applied', {
      kind: kind,
      stage: stage,
      category: choice.category || '',
      command_family: choice.command_family || '',
      line: line,
    });
    logCompanion('context-note', {
      kind: kind,
      stage: stage,
      note: taskContextNoteLine(),
      category: choice.category || '',
    });
  } else if (choice.source === 'semantic-running') {
    logCompanion('semantic-running-applied', {
      kind: kind,
      stage: stage,
      semantic_kind: choice.semantic_kind || '',
      task: companionRenderAdapterInput().semantic_focus,
      need: companionRenderAdapterInput().semantic_need,
      line: line,
    });
  } else if (choice.source === 'narrative-runtime') {
    var sessionThread = companionSessionThread();
    logCompanion('session-bubble', {
      kind: kind,
      stage: stage,
      status: String(sessionThread.status || ''),
      title: String(sessionThread.title || ''),
      need: String(sessionThread.need || ''),
      event_count: Number(sessionThread.event_count || 0),
      text: line,
    });
    logCompanion('narrative-bubble', {
      kind: kind,
      stage: stage,
      semantic_kind: choice.semantic_kind || '',
      semantic_status: choice.narrative_status || '',
      task: companionRenderAdapterInput().semantic_focus,
      need: companionRenderAdapterInput().semantic_need,
      line: line,
    });
  } else if (choice.source === 'phase-expression') {
    logCompanion('stance-applied', {
      kind: kind,
      stage: stage,
      phase: choice.phase || '',
      stance: choice.stance || '',
      rhythm: choice.rhythm || '',
      line: line,
    });
  } else if (choice.source === 'style-bias') {
    logCompanion('style-bias-applied', {
      kind: kind,
      stage: stage,
      style: choice.style || '',
      line: line,
    });
  }
  if (kind === 'failure_comfort' || String(companionPhase().rhythm || '') === 'return_after_idle') {
    logCompanion('recovery-prompt', {
      kind: kind,
      stage: stage,
      checkpoint: workflowCheckpointLabel(),
      hint: workflowHintLine(),
    });
  }
  if (presentation && presentation.source) {
    logCompanion('animation-bias-applied', {
      kind: kind,
      stage: stage,
      source: presentation.source,
      animation: presentation.animation || '',
      reaction_ms: presentation.reactionMs || 0,
      bubble_duration: finalDuration,
      summary_key: presentation.summary_key || '',
    });
  }
  logCompanion('bubble', { kind: kind, stage: stage, source: choice.source || 'pool', animation_source: presentation.source || '', line: line });
  saveOverlayCompanionState();
  return true;
}

function clearRunningCareTimers() {
  while (companionState.running_care_timers.length) {
    clearTimeout(companionState.running_care_timers.pop());
  }
}

function clearBlockingCareTimers() {
  while (companionState.blocking_care_timers.length) {
    clearTimeout(companionState.blocking_care_timers.pop());
  }
}

function clearThinkingCareTimers() {
  while (companionState.thinking_care_timers.length) {
    clearTimeout(companionState.thinking_care_timers.pop());
  }
  if (window.hermesPetAPI && typeof window.hermesPetAPI.clearThinkingStageTimers === 'function') {
    window.hermesPetAPI.clearThinkingStageTimers(companionState.thinking_token);
  }
}

function clearWrapUpTimer() {
  if (companionState.wrap_up_timer) clearTimeout(companionState.wrap_up_timer);
  companionState.wrap_up_timer = null;
}

function clearThinkingState(reason) {
  clearThinkingCareTimers();
  companionState.thinking_started_at = null;
  companionState.thinking_stage = 0;
  companionState.thinking_token += 1;
  if (isThinkingBubbleText(bubbleTextEl.textContent)) {
    hideBubble();
  }
  if (reason) logCompanion('thinking-cleared', { reason: reason });
}

function clearThinkingForEvent(msg) {
  if (!msg || isThinkingWaitingEvent(msg)) return;
  var type = msg.type || '';
  if (type === 'task_progress' || type === 'task_resumed' || type === 'task_completed' || type === 'task_failed' ||
      type === 'task_blocked' || type === 'running' || type === 'job_started' || type === 'idle' ||
      type === 'job_finished' || type === 'job_failed' || type === 'approval_needed' || type === 'review') {
    clearThinkingState(type);
  }
}

function scheduleThinkingCare() {
  clearThinkingCareTimers();
  companionState.thinking_started_at = isoNow();
  companionState.thinking_stage = 1;
  companionState.thinking_token += 1;
  var token = companionState.thinking_token;
  var hasMainTimer = !!(window.hermesPetAPI && typeof window.hermesPetAPI.scheduleThinkingStageTimers === 'function');
  logCompanion('thinking-scheduled', { token: token, main_timer: hasMainTimer });
  if (window.hermesPetAPI && typeof window.hermesPetAPI.scheduleThinkingStageTimers === 'function') {
    window.hermesPetAPI.scheduleThinkingStageTimers({ token: token });
  }
  [
    { delay: 30000, stage: 2, pool: 'thinking_long' },
    { delay: 120000, stage: 3, pool: 'thinking_stalled' },
  ].forEach(function(item) {
    companionState.thinking_care_timers.push(setTimeout(function() {
      if (token !== companionState.thinking_token) return;
      if (_tuiTargetState !== 'waiting') return;
      if (companionState.mode !== 'running' && companionState.mode !== 'idle') return;
      applyThinkingStage(item.stage, item.pool);
    }, item.delay));
  });
}

function handleThinkingStageTimer(data) {
  logCompanion('thinking-stage-timer', {
    token: data && data.token,
    current_token: companionState.thinking_token,
    stage: data && data.stage,
    target: _tuiTargetState || '',
    mode: companionState.mode || '',
  });
  if (!data || Number(data.token) !== Number(companionState.thinking_token)) return;
  if (!isThinkingStillActive()) return;
  if (companionState.mode !== 'running' && companionState.mode !== 'idle') return;
  applyThinkingStage(Number(data.stage || 0), String(data.pool || ''));
}

function applyThinkingStage(stage, poolKey) {
  if (!companionState.thinking_started_at) return;
  if (companionState.thinking_stage >= stage) return;
  var line = randomBubbleLine(poolKey);
  if (!line) return;
  companionState.thinking_stage = stage;
  showBubble(line, 0);
  logCompanion('thinking-stage', {
    stage: stage,
    elapsed_seconds: Math.round((Date.now() - Date.parse(companionState.thinking_started_at || isoNow())) / 1000),
    text: line,
  });
}

function checkThinkingStage() {
  if (!companionState.thinking_started_at) return;
  if (!isThinkingStillActive()) return;
  if (companionState.mode !== 'running' && companionState.mode !== 'idle') return;
  var startedAtMs = Date.parse(companionState.thinking_started_at);
  if (!Number.isFinite(startedAtMs)) return;
  var elapsedMs = Date.now() - startedAtMs;
  if (elapsedMs >= 120000) {
    applyThinkingStage(3, 'thinking_stalled');
  } else if (elapsedMs >= 30000) {
    applyThinkingStage(2, 'thinking_long');
  }
}

function isThinkingStillActive() {
  return _tuiTargetState === 'waiting' ||
    animController.currentState === 'waiting' ||
    isThinkingBubbleText(bubbleTextEl.textContent);
}

function sessionSnapshot() {
  var today = petMemory.today || {};
  return {
    tasks_started: Math.max(0, Number(today.tasks_started || 0) - Number(companionState.session_started_tasks_started || 0)),
    tasks_completed: Math.max(0, Number(today.tasks_completed || 0) - Number(companionState.session_started_tasks_completed || 0)),
    approval_waits: Math.max(0, Number(today.approval_waits || 0) - Number(companionState.session_started_approval_waits || 0)),
    review_waits: Math.max(0, Number(today.review_waits || 0) - Number(companionState.session_started_review_waits || 0)),
    active_minutes: Math.max(0, minutesSince(companionState.session_started_at)),
  };
}

function openSession(prevMode) {
  rotatePetMemoryDay();
  rotateOverlayCompanionDay();
  companionState.session_open = true;
  companionState.session_started_at = isoNow();
  companionState.session_started_tasks_started = Number(petMemory.today.tasks_started || 0);
  companionState.session_started_tasks_completed = Number(petMemory.today.tasks_completed || 0);
  companionState.session_started_approval_waits = Number(petMemory.today.approval_waits || 0);
  companionState.session_started_review_waits = Number(petMemory.today.review_waits || 0);
  overlayCompanion.day.session_count += 1;
  overlayCompanion.day.session_open = true;
  overlayCompanion.day.session_mode = 'running';
  overlayCompanion.day.session_started_at = companionState.session_started_at;
  overlayCompanion.day.session_started_tasks_started = companionState.session_started_tasks_started;
  overlayCompanion.day.session_started_tasks_completed = companionState.session_started_tasks_completed;
  overlayCompanion.day.session_started_approval_waits = companionState.session_started_approval_waits;
  overlayCompanion.day.session_started_review_waits = companionState.session_started_review_waits;
  overlayCompanion.day.wrapped_up = false;
  overlayCompanion.day.last_session_open_at = companionState.session_started_at;
  logCompanion('session-open', {
    from: prevMode,
    session_count: overlayCompanion.day.session_count,
    tasks_started: petMemory.today.tasks_started,
  });
  logCompanion('workflow-checkpoint', {
    checkpoint: workflowCheckpointLabel(),
    phase: phaseLabel(companionPhase().session_phase),
    stance: stanceLabel(companionPhase().stance),
    rhythm: rhythmLabel(companionPhase().rhythm),
    hint: workflowHintLine(),
  });
  recordWorkflowTrail('session-open', workflowStatusLine() + ' · ' + workflowNextStepLine(), 'info');
  saveOverlayCompanionState();
}

function resumeSession(prevMode) {
  rotateOverlayCompanionDay();
  overlayCompanion.day.session_resumes += 1;
  logCompanion('session-resumed', {
    from: prevMode,
    session_resumes: overlayCompanion.day.session_resumes,
    idle_minutes: Number(minutesSince(petMemory.today.last_idle_at).toFixed(2)),
  });
  logCompanion('workflow-checkpoint', {
    checkpoint: workflowCheckpointLabel(),
    phase: phaseLabel(companionPhase().session_phase),
    stance: stanceLabel(companionPhase().stance),
    rhythm: rhythmLabel(companionPhase().rhythm),
    hint: workflowHintLine(),
  });
  recordWorkflowTrail('session-resumed', workflowStatusLine() + ' · ' + workflowNextStepLine(), 'info');
  saveOverlayCompanionState();
}

function ensureSessionActive(prevMode) {
  if (!companionState.session_open) {
    openSession(prevMode);
    return 'opened';
  }
  if (prevMode === 'idle' || prevMode === 'failed') {
    logCompanion('session-close-abort', {
      from: prevMode,
      idle_minutes: Number(minutesSince(petMemory.today.last_idle_at).toFixed(2)),
    });
    resumeSession(prevMode);
    clearWrapUpTimer();
    return 'resumed';
  }
  return 'continued';
}

function closeSession(reason) {
  if (!companionState.session_open) return false;
  var snapshot = sessionSnapshot();
  companionState.session_open = false;
  rotateOverlayCompanionDay();
  overlayCompanion.day.session_open = false;
  overlayCompanion.day.session_mode = 'idle';
  overlayCompanion.day.wrapped_up = true;
  overlayCompanion.day.last_session_closed_at = isoNow();
  logCompanion('session-wrap-up', {
    reason: reason || 'stable-idle',
    tasks_completed: snapshot.tasks_completed,
    approval_waits: snapshot.approval_waits,
    review_waits: snapshot.review_waits,
    active_minutes: Number(snapshot.active_minutes.toFixed(2)),
  });
  logCompanion('workflow-checkpoint', {
    checkpoint: '收尾中',
    phase: '收尾',
    stance: '收陪',
    rhythm: rhythmLabel(companionPhase().rhythm),
    hint: workflowHintLine(),
  });
  recordWorkflowTrail('session-wrap-up', '收尾中 · ' + workflowNextStepLine(), 'success');
  saveOverlayCompanionState();
  return true;
}

function sessionWrapUpDelayMs() {
  var snapshot = sessionSnapshot();
  if (snapshot.tasks_completed >= 3 || snapshot.approval_waits >= 2 || snapshot.active_minutes >= 60) return 120000;
  if (snapshot.tasks_completed >= 2 || snapshot.approval_waits >= 1 || snapshot.active_minutes >= 25) return 240000;
  return 420000;
}

function persistSessionRuntime(mode) {
  rotateOverlayCompanionDay();
  overlayCompanion.day.session_open = !!companionState.session_open;
  overlayCompanion.day.session_mode = mode || overlayCompanion.day.session_mode || 'idle';
  overlayCompanion.day.session_started_at = companionState.session_started_at || overlayCompanion.day.session_started_at || null;
  overlayCompanion.day.session_started_tasks_started = companionState.session_started_tasks_started || 0;
  overlayCompanion.day.session_started_tasks_completed = companionState.session_started_tasks_completed || 0;
  overlayCompanion.day.session_started_approval_waits = companionState.session_started_approval_waits || 0;
  overlayCompanion.day.session_started_review_waits = companionState.session_started_review_waits || 0;
  saveOverlayCompanionState();
}

function restoreSessionRuntimeFromOverlay() {
  rotateOverlayCompanionDay();
  if (!overlayCompanion.day.session_open || !overlayCompanion.day.session_started_at) return;
  companionState.session_open = true;
  companionState.session_started_at = overlayCompanion.day.session_started_at;
  companionState.session_started_tasks_started = Number(overlayCompanion.day.session_started_tasks_started || 0);
  companionState.session_started_tasks_completed = Number(overlayCompanion.day.session_started_tasks_completed || 0);
  companionState.session_started_approval_waits = Number(overlayCompanion.day.session_started_approval_waits || 0);
  companionState.session_started_review_waits = Number(overlayCompanion.day.session_started_review_waits || 0);
  companionState.mode = String(overlayCompanion.day.session_mode || companionState.mode || 'idle');
  logCompanion('session-recovered', {
    mode: companionState.mode,
    session_count: overlayCompanion.day.session_count,
    started_at: companionState.session_started_at,
  });
  if (companionState.mode === 'idle') scheduleWrapUpCare();
  if (companionState.mode === 'running') {
    scheduleRunningCare();
    scheduleLateNightCare();
  }
  if (companionState.mode === 'review' || companionState.mode === 'waiting') {
    scheduleBlockingCare();
    scheduleLateNightCare();
  }
}

function scheduleRunningCare() {
  clearRunningCareTimers();
  companionState.running_nudges = 0;
  var style = dominantWorkStyle();
  var phase = companionPhase();
  var prefs = effectiveCompanionPreferences();
  var plan = [90000, 240000, 480000];
  if (style === 'steady_worker') plan = [120000, 300000, 600000];
  else if (style === 'trial_and_error') plan = [75000, 210000, 420000];
  else if (style === 'approval_magnet') plan = [85000, 225000, 420000];
  plan = plan.map(function(delay) {
    return Math.round(delay * preferenceDelayMultiplier('running'));
  });
  if (String(phase.noise_budget || 'medium') === 'low') {
    plan = plan.map(function(delay, idx) { return delay + (idx === 0 ? 45000 : 90000); });
    logCompanion('noise-budget-applied', {
      target: 'running-care',
      noise_budget: phase.noise_budget || 'medium',
      phase: phase.session_phase || '',
      plan: plan,
    });
  }
  logCompanion('effective-proactivity', {
    target: 'running-care',
    preset: prefs.preset || 'balanced_partner',
    proactivity: prefs.proactivity || 'medium',
    focus_mode: prefs.focus_mode || 'balanced',
    verbosity: prefs.verbosity || 'medium',
    plan: plan,
  });
  plan.forEach(function(delay, idx) {
    companionState.running_care_timers.push(setTimeout(function() {
      if (companionState.mode !== 'running') return;
      if (idx === 0) {
        petMemory.long_running_count += 1;
        petMemory.today.long_running_seen += 1;
        savePetMemory();
      }
      companionState.running_nudges = Math.max(companionState.running_nudges, idx + 1);
      renderRecentEvents();
      recordWorkflowSignal('long_running', idx + 1);
      if (!shouldSpeakCompanion('long_running')) return;
      if (minutesSince(overlayCompanion.cooldowns.running_nudge_at) < 45) return;
      showCompanionBubble('long_running', 4200, { stage: idx + 1 });
    }, delay));
  });
}

function scheduleBlockingCare() {
  clearBlockingCareTimers();
  companionState.blocking_nudges = 0;
  var style = dominantWorkStyle();
  var phase = companionPhase();
  var prefs = effectiveCompanionPreferences();
  var plan = [
    { delay: 30000, kind: 'waiting_care' },
    { delay: 120000, kind: 'review_care' },
    { delay: 300000, kind: 'review_care' },
  ];
  if (style === 'approval_magnet') {
    plan = [
      { delay: 20000, kind: 'waiting_care' },
      { delay: 90000, kind: 'review_care' },
      { delay: 240000, kind: 'review_care' },
    ];
  } else if (style === 'steady_worker') {
    plan = [
      { delay: 40000, kind: 'waiting_care' },
      { delay: 150000, kind: 'review_care' },
      { delay: 360000, kind: 'review_care' },
    ];
  } else if (style === 'trial_and_error') {
    plan = [
      { delay: 25000, kind: 'waiting_care' },
      { delay: 105000, kind: 'review_care' },
      { delay: 270000, kind: 'review_care' },
    ];
  }
  plan = plan.map(function(item) {
    return Object.assign({}, item, { delay: Math.round(item.delay * preferenceDelayMultiplier('blocking')) });
  });
  if (String(phase.stance || '') === 'guard') {
    plan = plan.map(function(item, idx) {
      return Object.assign({}, item, { delay: Math.max(15000, item.delay - (idx === 0 ? 5000 : 15000)) });
    });
    logCompanion('noise-budget-applied', {
      target: 'blocking-care',
      noise_budget: phase.noise_budget || 'medium',
      phase: phase.session_phase || '',
      stance: phase.stance || '',
      plan: plan,
    });
  }
  logCompanion('effective-proactivity', {
    target: 'blocking-care',
    preset: prefs.preset || 'balanced_partner',
    proactivity: prefs.proactivity || 'medium',
    focus_mode: prefs.focus_mode || 'balanced',
    verbosity: prefs.verbosity || 'medium',
    plan: plan,
  });
  plan.forEach(function(plan, idx) {
    companionState.blocking_care_timers.push(setTimeout(function() {
      if (companionState.mode !== 'review' && companionState.mode !== 'waiting') return;
      var kind = companionState.mode === 'review' ? 'review_care' : 'waiting_care';
      companionState.blocking_nudges = Math.max(companionState.blocking_nudges, idx + 1);
      renderRecentEvents();
      recordWorkflowSignal(kind, idx + 1);
      if (!shouldSpeakCompanion(kind)) return;
      if (idx === 0 && minutesSince(overlayCompanion.cooldowns.waiting_nudge_at) < 10) return;
      showCompanionBubble(kind, 0, { stage: idx + 1 });
    }, plan.delay));
  });
}

function scheduleLateNightCare() {
  if (companionState.late_night_timer) clearTimeout(companionState.late_night_timer);
  companionState.late_night_timer = null;
  var prefs = effectiveCompanionPreferences();
  if (!isLateNightWindow()) return;
  if (minutesSince(overlayCompanion.cooldowns.late_night_nudge_at) < 120) return;
  if (String(companionPhase().noise_budget || 'medium') === 'low' && String(companionPhase().session_phase || '') === 'deep_work') {
    logCompanion('noise-budget-applied', {
      target: 'late-night',
      noise_budget: companionPhase().noise_budget || 'medium',
      phase: companionPhase().session_phase || '',
      suppressed: true,
    });
    return;
  }
  var delay = Math.round(20000 * preferenceDelayMultiplier('late_night'));
  logCompanion('effective-proactivity', {
    target: 'late-night',
    preset: prefs.preset || 'balanced_partner',
    proactivity: prefs.proactivity || 'medium',
    focus_mode: prefs.focus_mode || 'balanced',
    verbosity: prefs.verbosity || 'medium',
    delay_ms: delay,
  });
  companionState.late_night_timer = setTimeout(function() {
    if (companionState.mode !== 'running' && companionState.mode !== 'review' && companionState.mode !== 'waiting') return;
    if (!isLateNightWindow()) return;
    if (!shouldSpeakCompanion('late_night')) return;
    if (minutesSince(overlayCompanion.cooldowns.late_night_nudge_at) < 120) return;
    if (showCompanionBubble('late_night', 4400)) {
      rotateOverlayCompanionDay();
      overlayCompanion.day.late_night_cared = true;
      saveOverlayCompanionState();
    }
  }, delay);
}

function scheduleWrapUpCare() {
  clearWrapUpTimer();
  if (!companionState.session_open) return;
  var snapshot = sessionSnapshot();
  var prefs = effectiveCompanionPreferences();
  if (snapshot.tasks_started <= 0 && snapshot.approval_waits <= 0 && snapshot.review_waits <= 0) return;
  var delayMs = Math.round(sessionWrapUpDelayMs() * preferenceDelayMultiplier('wrap_up'));
  logCompanion('session-observing', {
    delay_ms: delayMs,
    tasks_completed: snapshot.tasks_completed,
    approval_waits: snapshot.approval_waits,
    review_waits: snapshot.review_waits,
    active_minutes: Number(snapshot.active_minutes.toFixed(2)),
  });
  logCompanion('effective-proactivity', {
    target: 'wrap-up',
    preset: prefs.preset || 'balanced_partner',
    proactivity: prefs.proactivity || 'medium',
    focus_mode: prefs.focus_mode || 'balanced',
    verbosity: prefs.verbosity || 'medium',
    delay_ms: delayMs,
  });
  companionState.wrap_up_timer = setTimeout(function() {
    if (companionState.mode !== 'idle') return;
    if (!closeSession('stable-idle')) return;
    if (shouldSpeakCompanion('wrap_up')) {
      showCompanionBubble('wrap_up', 4400);
    }
  }, delayMs);
}

function holdCompanionBlockedState(reason, msg, prevMode, pythonOwnedEvent) {
  var semantic = companionSemanticTask();
  var nextMode = semanticBlockedMode(semantic, companionState.mode || prevMode);
  clearWrapUpTimer();
  clearRunningCareTimers();
  ensureSessionActive(prevMode);
  companionState.mode = nextMode;
  _tuiTargetState = nextMode;
  logCompanion('blocked-state-held', {
    reason: reason || '',
    event_type: (msg && msg.type) || '',
    mode: companionState.mode,
    semantic_status: String((semantic && semantic.status) || ''),
    blocker_type: String((semantic && semantic.blocker_type) || ''),
  });
  persistSessionRuntime(companionState.mode);
  if (pythonOwnedEvent) saveOverlayCompanionState();
  else savePetMemory();
  scheduleBlockingCare();
  scheduleLateNightCare();
}

function updateCompanionState(msg) {
  var type = msg && msg.type || '';
  var prevMode = companionState.mode;
  var pythonOwnedEvent = !!(msg && msg.companion_memory && typeof msg.companion_memory === 'object');
  var semanticEvent = applySemanticTaskEvent(msg);
  clearThinkingForEvent(msg);
  if (type) logCompanion('event', { type: type, mode: companionState.mode });
  if (msg && msg.companion_memory && msg.companion_memory.phase) {
    logCompanion('phase-derived', msg.companion_memory.phase);
  }
  if ((type === 'task_started' || type === 'task_progress') && semanticEvent && String((companionSemanticTask() || {}).status || '').trim().toLowerCase() === 'blocked') {
    holdCompanionBlockedState('semantic-progress-while-blocked', msg, prevMode, pythonOwnedEvent);
    return;
  }

  if ((type === 'task_started' || type === 'task_progress' || type === 'task_resumed') && semanticEvent) {
    rotatePetMemoryDay();
    rotateOverlayCompanionDay();
    if (!pythonOwnedEvent && type === 'task_started') petMemoryMarkActive();
    if (!pythonOwnedEvent && type === 'task_started') petMemory.today.tasks_started += 1;
    clearWrapUpTimer();
    clearBlockingCareTimers();
    ensureSessionActive(prevMode);
    companionState.mode = 'running';
    companionState.running_started_at = isoNow();
    logCompanion('running-start', { tasks_started: petMemory.today.tasks_started, semantic: true });
    persistSessionRuntime('running');
    if (!pythonOwnedEvent) savePetMemory();
    else saveOverlayCompanionState();
    scheduleRunningCare();
    scheduleLateNightCare();
    return;
  }

  if (type === 'task_blocked' && semanticEvent) {
    if (!pythonOwnedEvent) petMemoryMarkActive();
    clearWrapUpTimer();
    clearRunningCareTimers();
    ensureSessionActive(prevMode);
    companionState.mode = semanticBlockerAnimation(msg.blocker_type || '', companionState.mode);
    if (!pythonOwnedEvent) petMemoryRecordApprovalWait(companionState.mode === 'review' ? 'review' : 'waiting');
    _tuiTargetState = companionState.mode;
    logCompanion('blocking-start', { mode: companionState.mode, semantic: true });
    logCompanion('session-blocked', { from: prevMode, mode: companionState.mode });
    recordWorkflowTrail('session-blocked', workflowStatusLine() + ' · ' + workflowNextStepLine(), 'warning');
    persistSessionRuntime(companionState.mode);
    if (!pythonOwnedEvent) savePetMemory();
    else saveOverlayCompanionState();
    scheduleBlockingCare();
    scheduleLateNightCare();
    return;
  }

  if (type === 'task_completed' && semanticEvent) {
    rotatePetMemoryDay();
    if (!pythonOwnedEvent && (companionState.mode === 'running' || companionState.mode === 'review' || companionState.mode === 'waiting')) {
      petMemoryRecordCompletion();
    }
    if (!pythonOwnedEvent) {
      petMemory.today.last_idle_at = isoNow();
      savePetMemory();
    } else {
      saveOverlayCompanionState();
    }
    companionState.mode = 'idle';
    companionState.running_started_at = null;
    logCompanion('idle-enter', { tasks_completed: petMemory.today.tasks_completed, semantic: true });
    persistSessionRuntime('idle');
    clearRunningCareTimers();
    clearBlockingCareTimers();
    scheduleWrapUpCare();
    return;
  }

  if (type === 'task_failed' && semanticEvent) {
    if (!pythonOwnedEvent) petMemoryMarkActive();
    clearWrapUpTimer();
    clearBlockingCareTimers();
    ensureSessionActive(prevMode);
    if (!pythonOwnedEvent) petMemoryRecordFailure(type);
    companionState.pending_failure_comfort = true;
    companionState.mode = 'failed';
    logCompanion('failure-pending-comfort', { consecutive_failures: petMemory.consecutive_failures, semantic: true });
    recordWorkflowTrail('recovery-prompt', '恢复提示 · ' + workflowNextStepLine(), 'warning');
    persistSessionRuntime('failed');
    clearRunningCareTimers();
    if (!pythonOwnedEvent) savePetMemory();
    else saveOverlayCompanionState();
    if (shouldSpeakCompanion('failure_comfort') && minutesSince(overlayCompanion.cooldowns.failure_comfort_at) >= 20) {
      if (showCompanionBubble('failure_comfort', 4600)) {
        companionState.pending_failure_comfort = false;
      }
    }
    return;
  }

  if (type === 'running' || type === 'job_started') {
    rotatePetMemoryDay();
    rotateOverlayCompanionDay();
    if (!pythonOwnedEvent) petMemoryMarkActive();
    clearWrapUpTimer();
    clearBlockingCareTimers();
    ensureSessionActive(prevMode);
    clearStaleBlockedRuntimeState('runtime-start');
    if (!pythonOwnedEvent) petMemory.today.tasks_started += 1;
    logCompanion('running-start', { tasks_started: petMemory.today.tasks_started });
    if (!overlayCompanion.day.greeted && shouldSpeakCompanion('day_greeting')) {
      if (showCompanionBubble('day_greeting', 3800)) {
        overlayCompanion.day.greeted = true;
      }
    }
    if (pythonOwnedEvent) saveOverlayCompanionState();
    else savePetMemory();
    companionState.mode = 'running';
    companionState.running_started_at = isoNow();
    persistSessionRuntime('running');
    scheduleRunningCare();
    scheduleLateNightCare();
    return;
  }

  if (isThinkingWaitingEvent(msg)) {
    var blockedSemantic = companionSemanticTask();
    var blockedStatus = String((blockedSemantic && blockedSemantic.status) || '').trim().toLowerCase();
    if (blockedStatus === 'blocked' && (prevMode === 'review' || prevMode === 'waiting')) {
      companionState.mode = semanticBlockerAnimation(blockedSemantic.blocker_type || '', prevMode);
      _tuiTargetState = companionState.mode;
      clearThinkingState('blocked-preserved');
      logCompanion('thinking-waiting-kept-blocked', { from: prevMode, mode: companionState.mode });
      persistSessionRuntime(companionState.mode);
      if (pythonOwnedEvent) saveOverlayCompanionState();
      else savePetMemory();
      return;
    }
    rotatePetMemoryDay();
    rotateOverlayCompanionDay();
    if (!pythonOwnedEvent) petMemoryMarkActive();
    clearWrapUpTimer();
    clearBlockingCareTimers();
    var semanticStatus = String((blockedSemantic || {}).status || '').trim().toLowerCase();
    var thinkingMode = (prevMode === 'running' || semanticStatus === 'active') ? 'running' : 'idle';
    companionState.mode = thinkingMode;
    _tuiTargetState = 'waiting';
    logCompanion('thinking-waiting-start', { from: prevMode, mode: companionState.mode });
    persistSessionRuntime(companionState.mode);
    if (pythonOwnedEvent) saveOverlayCompanionState();
    else savePetMemory();
    if (companionState.mode === 'running') scheduleRunningCare();
    scheduleThinkingCare();
    scheduleLateNightCare();
    return;
  }

  if (type === 'review' || type === 'waiting' || type === 'approval_needed') {
    if (!pythonOwnedEvent) petMemoryMarkActive();
    clearWrapUpTimer();
    clearRunningCareTimers();
    ensureSessionActive(prevMode);
    if (!pythonOwnedEvent) petMemoryRecordApprovalWait(type);
    companionState.mode = type === 'review' ? 'review' : 'waiting';
    _tuiTargetState = companionState.mode;
    logCompanion('blocking-start', { mode: companionState.mode });
    logCompanion('session-blocked', { from: prevMode, mode: companionState.mode });
    recordWorkflowTrail('session-blocked', workflowStatusLine() + ' · ' + workflowNextStepLine(), 'warning');
    persistSessionRuntime(companionState.mode);
    scheduleBlockingCare();
    scheduleLateNightCare();
    return;
  }

  if (type === 'job_failed' || type === 'failed') {
    if (!pythonOwnedEvent) petMemoryMarkActive();
    clearWrapUpTimer();
    clearBlockingCareTimers();
    ensureSessionActive(prevMode);
    if (!pythonOwnedEvent) petMemoryRecordFailure(type);
    companionState.pending_failure_comfort = true;
    companionState.mode = 'failed';
    logCompanion('failure-pending-comfort', { consecutive_failures: petMemory.consecutive_failures });
    recordWorkflowTrail('recovery-prompt', '恢复提示 · ' + workflowNextStepLine(), 'warning');
    persistSessionRuntime('failed');
    clearRunningCareTimers();
    if (shouldSpeakCompanion('failure_comfort') && minutesSince(overlayCompanion.cooldowns.failure_comfort_at) >= 20) {
      if (showCompanionBubble('failure_comfort', 4600)) {
        companionState.pending_failure_comfort = false;
      }
    }
    return;
  }

  if ((type === 'idle' || type === 'job_finished') && isBlockedRuntimeState(companionSemanticTask(), companionState.mode)) {
    holdCompanionBlockedState('lifecycle-idle-while-blocked', msg, prevMode, pythonOwnedEvent);
    return;
  }

  if (type === 'idle' || type === 'job_finished') {
    rotatePetMemoryDay();
    if (!pythonOwnedEvent && (companionState.mode === 'running' || companionState.mode === 'review' || companionState.mode === 'waiting')) {
      petMemoryRecordCompletion();
    }
    if (!pythonOwnedEvent) {
      petMemory.today.last_idle_at = isoNow();
      savePetMemory();
    }
    companionState.mode = 'idle';
    companionState.running_started_at = null;
    logCompanion('idle-enter', { tasks_completed: petMemory.today.tasks_completed });
    persistSessionRuntime('idle');
    clearRunningCareTimers();
    clearBlockingCareTimers();
    if (companionState.pending_failure_comfort && shouldSpeakCompanion('failure_comfort') && minutesSince(overlayCompanion.cooldowns.failure_comfort_at) >= 20) {
      if (showCompanionBubble('failure_comfort', 4600)) {
        companionState.pending_failure_comfort = false;
      }
    }
    scheduleWrapUpCare();
  }
}

function shouldShowEventTray(msg) {
  if (msg.type === 'approval_needed' || msg.type === 'job_failed') return true;
  if (notificationPrefs.quiet_mode === 'silent' && !isCriticalEvent(msg)) return false;
  if (msg.urgent) return notificationPrefs.show_tray_on_urgent;
  if (msg.severity === 'warning') return notificationPrefs.show_tray_on_urgent;
  return eventReactionFor(msg).trayMs > 0 && notificationPrefs.quiet_mode === 'off';
}

// ---- Bounce on click ----
spriteEl.addEventListener('click', () => {
  if (dragMoved) {
    dragMoved = false;
    return;
  }
  // Safety: restore TUI target state after any user interaction that might override it
  if (_tuiTargetState && _tuiTargetState !== 'idle' && _tuiTargetState !== animController.currentState) {
    var _activeStates = ['running', 'run_left', 'run_right', 'review', 'waiting', 'failed'];
    if (_activeStates.indexOf(_tuiTargetState) !== -1) {
      animController.transition(_tuiTargetState);
      return;
    }
  }
  // Never bounce/override active animation states
  var _activeStates = ['running', 'run_left', 'run_right', 'review', 'waiting', 'failed'];
  if (_activeStates.indexOf(animController.currentState) !== -1) {
    setEventTrayVisible(eventTrayEl ? eventTrayEl.classList.contains('hidden') : true, 0);
    return;
  }
  if (recentEvents.length > 0 || state.currentStatus !== 'Idle') {
    setEventTrayVisible(eventTrayEl ? eventTrayEl.classList.contains('hidden') : true, 0);
    return;
  }
  setMood('happy');
  setTimeout(() => {
    if (animController.currentState === 'jumping') {
      setMood(state.mood);
    }
  }, 1800);
});

spriteEl.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  event.stopPropagation();
  var trayVisible = eventTrayEl ? !eventTrayEl.classList.contains('hidden') : false;
  if (trayVisible) {
    clearRecentEvents();
    setEventTrayVisible(false, 0);
  } else {
    setEventTrayVisible(true, 0);
  }
  // Right-click as fallback: force idle if pet is stuck in an active state
  var _activeStates = ['running', 'run_left', 'run_right', 'review', 'waiting', 'failed'];
  if (_activeStates.indexOf(animController.currentState) !== -1) {
    animController.transition('idle');
    // Clear TUI target so _restoreTuiTarget doesn't undo this
    _tuiTargetState = null;
  }
});

companionPanelEl && companionPanelEl.addEventListener('click', (event) => {
  var btn = event.target && event.target.closest ? event.target.closest('[data-action]') : null;
  if (!btn) return;
  event.preventDefault();
  event.stopPropagation();
  applyCompanionControlAction(String(btn.getAttribute('data-action') || ''));
});

// ---- Window drag ----
const DEBUG_DRAG = new URLSearchParams(window.location.search).get('debugDrag') === '1';

function debugDrag(msg) {
  if (DEBUG_DRAG) console.log('[pet-drag] ' + msg);
}

function dragPoint(event) {
  return { screenX: event.screenX, screenY: event.screenY };
}

function spriteClientRect() {
  const rect = spriteEl.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function reportSpriteRect() {
  if (!window.hermesPetAPI?.reportSpriteRect) return;
  try {
    window.hermesPetAPI.reportSpriteRect(spriteClientRect());
  } catch (_) {}
}

function dragEnabled() {
  return document.body.classList.contains('overlay-mode') &&
    window.hermesPetAPI &&
    !document.body.classList.contains('click-through-mode');
}

function startPetDrag(event) {
  if (!dragEnabled() || event.button !== 0) return;
  if (dragPointerId != null) finishPetDrag('stale-start', event, { force: true });

  event.preventDefault();
  event.stopPropagation();
  dragPointerId = event.pointerId ?? 'mouse';
  dragStart = dragPoint(event);
  dragMoved = false;
  _petDragging = true;
  lockEventTrayLayoutDuringDrag();
  _preDragState = animController.currentState;
  spriteEl.classList.add('dragging', 'pet-dragging');
  var preserveActiveState = _isActiveTuiState(_preDragState) || _isActiveTuiState(_tuiTargetState);
  if (!preserveActiveState && animController.hasStateConfig('drag')) {
    animController.transition('drag');
  }
  try {
    if (typeof event.pointerId === 'number') {
      spriteEl.setPointerCapture(event.pointerId);
      debugDrag('pointerdown id=' + event.pointerId + ' capture=ok');
    } else {
      spriteEl.setPointerCapture(1);
      debugDrag('pointerdown id=' + event.pointerId + ' capture=forced(1)');
    }
  } catch (e) {
    debugDrag('pointerdown id=' + event.pointerId + ' capture=FAIL ' + e.message);
  }
  window.hermesPetAPI.petDragStart({ ...dragStart, spriteRect: spriteClientRect() });
}

function movePetDrag(event) {
  if (dragPointerId == null || !dragStart) return;
  if (event.pointerId != null && dragPointerId !== event.pointerId) return;
  if (typeof event.buttons === 'number' && (event.buttons & 1) === 0) {
    finishPetDrag('move-without-button', event, { force: true });
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  const point = dragPoint(event);
  if (Math.abs(point.screenX - dragStart.screenX) > 2 || Math.abs(point.screenY - dragStart.screenY) > 2) {
    dragMoved = true;
  }
  window.hermesPetAPI.petDragMove(point);
}

function endPetDrag(event) {
  finishPetDrag('end', event);
}

function finishPetDrag(reason, event, options = {}) {
  if (dragPointerId == null) return;
  if (!options.force && event && event.pointerId != null && dragPointerId !== event.pointerId) return;

  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  var pid = (event && typeof event.pointerId === 'number') ? event.pointerId : null;
  var savedPointerId = dragPointerId;
  dragPointerId = null;
  dragStart = null;
  spriteEl.classList.remove('dragging', 'pet-dragging');

  // Restore pre-drag animation state BEFORE releasing pointer capture,
  // because releasePointerCapture may sync-trigger mouseleave which
  // checks _petDragging and currentState.
  // NOTE: Don't null _preDragState here — the code below also checks it.
  if (_preDragState && _preDragState !== 'drag' && _preDragState !== 'idle') {
    animController.transition(_preDragState);
    // Don't null _preDragState yet — the later section handles this.
  }
  _petDragging = false;
  unlockEventTrayLayoutAfterDrag();

  try {
    if (pid != null) {
      if (!spriteEl.hasPointerCapture || spriteEl.hasPointerCapture(pid)) {
        spriteEl.releasePointerCapture(pid);
      }
      debugDrag(reason + ' id=' + pid + ' release=ok');
    } else if (typeof savedPointerId === 'number') {
      if (!spriteEl.hasPointerCapture || spriteEl.hasPointerCapture(savedPointerId)) {
        spriteEl.releasePointerCapture(savedPointerId);
      }
      debugDrag(reason + ' savedId=' + savedPointerId + ' release=ok');
    }
  } catch (e) {
    debugDrag(reason + ' release=FAIL ' + e.message);
  }

  if (_restoreTuiTarget()) {
    _preDragState = null;
  } else if (_preDragState && _preDragState !== 'drag' && _preDragState !== 'idle') {
    animController.transition(_preDragState);
    _preDragState = null;
  } else if (animController.hoverActive) {
    animController.transition('hover');
  } else {
    animController.transition('idle');
  }
  debugDrag(reason + ' cleanup=ok');
  reportSpriteRect();
  window.hermesPetAPI?.petDragEnd?.();
}

function recoverLostPointerCapture(event) {
  if (dragPointerId == null) return;
  if (event && event.pointerId != null && dragPointerId !== event.pointerId) return;
  if (typeof event?.buttons === 'number' && (event.buttons & 1) === 0) {
    finishPetDrag('lostcapture-button-up', event, { force: true });
    return;
  }
  try {
    if (typeof event?.pointerId === 'number') {
      spriteEl.setPointerCapture(event.pointerId);
      debugDrag('lostpointercapture id=' + event.pointerId + ' recapture=ok');
      return;
    }
  } catch (e) {
    debugDrag('lostpointercapture recapture=FAIL ' + e.message);
  }
  finishPetDrag('lostcapture-unrecoverable', event, { force: true });
}

spriteEl.addEventListener('pointerdown', startPetDrag);
spriteEl.addEventListener('pointerup', endPetDrag);
spriteEl.addEventListener('pointercancel', endPetDrag);
spriteEl.addEventListener('lostpointercapture', recoverLostPointerCapture);
document.addEventListener('pointermove', movePetDrag, true);
window.addEventListener('pointermove', movePetDrag, true);
document.addEventListener('pointerup', endPetDrag, true);
document.addEventListener('pointercancel', endPetDrag, true);
window.addEventListener('pointerup', endPetDrag, true);
window.addEventListener('mouseup', endPetDrag, true);
window.addEventListener('blur', endPetDrag);

// ---- Minimize ----
let isMinimized = false;
minBtn.addEventListener('click', () => {
  if (isMinimized) {
    window.hermesPetAPI?.restore?.();
    document.body.classList.remove('bubble-mode');
    isMinimized = false;
    minBtn.textContent = '−';
  } else {
    window.hermesPetAPI?.minimize?.();
    document.body.classList.add('bubble-mode');
    isMinimized = true;
    minBtn.textContent = '+';
  }
});

// ---- Event parser ----
function handleEvent(msg) {
  // msg schema from Python bridge:
  // { type: 'state', species, name, level, xp, xp_next, variant, shiny }
  // { type: 'mood_change', mood: 'idle'|'happy'|'thinking'|'busy' }
  // { type: 'bubble', text, duration }
  // { type: 'xp_change', delta, new_xp, new_level }
  // { type: 'hatch', species, name, variant, shiny }
  // { type: 'toggle_visible', visible: bool }

  debugEvent(`handle type=${msg?.type || 'unknown'}`, msg);
  if (msg && msg.companion_memory) applyCompanionMemorySnapshot(msg.companion_memory, msg.type);

  switch (msg.type) {
    case 'hatch':
      state.species = msg.species;
      state.name = msg.name;
      state.variant = msg.variant || 'normal';
      state.shiny = msg.shiny || false;
      state.custom_pet = msg.custom_pet || null;
      state.level = 1;
      state.xp = 0;
      state.xpNext = 100;
      setSprite(state.species, state.variant);
      setShiny(state.shiny);
      updateStats();
      saveVisualBootstrap();
      showBubble(`You hatched ${msg.name}!`, 4000);
      break;

    case 'state':
      Object.assign(state, msg);
      state.custom_pet = Object.prototype.hasOwnProperty.call(msg, 'custom_pet') ? (msg.custom_pet || null) : (state.custom_pet || null);
      state.xpNext = msg.xp_next || state.xpNext;
      setSprite(state.species, state.variant);
      setShiny(state.shiny);
      updateStats();
      saveVisualBootstrap();
      break;

    case 'custom_pet':
      state.custom_pet = msg.custom_pet || null;
      setSprite(state.species || 'cat', state.variant);
      saveVisualBootstrap();
      if (state.custom_pet) showBubble('Using custom pet ' + state.custom_pet.name, 2500);
      break;

    case 'notification_prefs':
      updateNotificationPrefs(msg.prefs || msg);
      break;

    case 'mood_change':
      state.mood = msg.mood;
      setMood(msg.mood);
      break;

    case 'bubble':
    case 'status':
    case 'idle':
    case 'running':
    case 'walking':
    case 'waiting':
    case 'review':
    case 'job_started':
    case 'job_finished':
    case 'job_failed':
    case 'task_started':
    case 'task_progress':
    case 'task_blocked':
    case 'task_resumed':
    case 'task_completed':
    case 'task_failed':
    case 'job_history':
    case 'approval_needed':
    case 'daily_brief':
    case 'achievement_unlocked':
    case 'run_left':
    case 'run_right':
    case 'walk_left':
    case 'walk_right':
      if (msg.type === 'job_history') recordJobHistory(msg);
      else handleAmbientEvent(msg);
      break;

    case 'xp_change':
      state.xp = msg.new_xp ?? state.xp;
      if (msg.new_level != null) state.level = msg.new_level;
      updateStats();
      if (msg.delta > 0) showBubble(`+${msg.delta} XP`, 2000);
      if (msg.delta > 0) animController.transition('jumping');
      break;

    case 'toggle_visible':
      if (msg.visible) {
        window.hermesPetAPI?.show?.();
      } else {
        window.hermesPetAPI?.hide?.();
      }
      break;

    case 'message_received':
      handleAmbientEvent(msg);
      break;

    case 'heartbeat':
      // Silent keepalive – no animation, just log in dev mode
      console.log('[pet] heartbeat:', msg.server_ts, 'clients:', msg.clients);
      break;
  }
}

// ---- Bridge listeners ----
if (window.hermesPetAPI) {
  window.hermesPetAPI.onPetEvent((msg) => handleEvent(msg));
  if (typeof window.hermesPetAPI.onThinkingStageTimer === 'function') {
    window.hermesPetAPI.onThinkingStageTimer((data) => handleThinkingStageTimer(data));
  }
  window.hermesPetAPI.onPositionChange(() => {
    requestAnimationFrame(reportSpriteRect);
  });
  window.hermesPetAPI.onBridgeConnected((connected) => {
    debugEvent(`bridge connected state=${connected}`);
    if (connectionStatusEl) {
      connectionStatusEl.textContent = connected ? 'Connected' : 'Waiting for Hermes';
      connectionStatusEl.classList.toggle('connected', connected);
    }
    if (connected) {
      if (animController.currentState === 'waiting') animController.transition('idle');
    } else {
      // Clear stale TUI target state so _restoreTuiTarget doesn't
      // restore a stale state on user interaction.
      _tuiTargetState = null;
      // Safety net: if no new message arrives within STALE_TIMEOUT_MS
      // (180s), auto-transition to idle. This handles the crash scenario
      // where the TUI gateway dies without sending idle. Normal idle
      // messages cancel the timer via cancelStaleTimeout.
      scheduleStaleTimeout();
      // showBubble('Waiting for Hermes...', 4000);
    }
  });
  requestAnimationFrame(reportSpriteRect);
}

// Default state: show idle empty until first event
setMood('idle');
nameEl.textContent = 'Hermes Pets';
renderCompanionSummary();

// =====================================================================
// FEATURE F1: Custom sprite upload (drag & drop + right-click file picker)
// =====================================================================

const dropZone = document.getElementById('drop-zone');
const uploadHint = document.getElementById('upload-hint');
const uploadEnabled = new URLSearchParams(window.location.search).get('showUpload') === '1';

document.body.classList.toggle('show-upload-ui', uploadEnabled);

function setCustomSprite(filePath) {
  spriteEl.style.backgroundImage = `url("${filePath}")`;
  spriteEl.classList.add('sprite-asset-loaded');
  state.species = 'custom';
  state.variant = 'normal';
  showBubble('New custom sprite uploaded!', 3000);
}

if (uploadEnabled) {
  document.addEventListener('dragenter', (e) => {
    e.preventDefault();
    if (dropZone) dropZone.classList.remove('hidden');
  });

  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (dropZone) dropZone.classList.add('drag-over');
  });

  document.addEventListener('dragleave', (e) => {
    if (e.relatedTarget && !document.body.contains(e.relatedTarget)) {
      if (dropZone) { dropZone.classList.remove('drag-over'); dropZone.classList.add('hidden'); }
    }
  });

  document.addEventListener('drop', (e) => {
    e.preventDefault();
    if (dropZone) { dropZone.classList.remove('drag-over'); dropZone.classList.add('hidden'); }
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (file.type.startsWith('image/')) {
        const url = URL.createObjectURL(file);
        setCustomSprite(url);
        window.hermesPetAPI?.saveCustomSprite?.(file.path || file.name);
      } else {
        showBubble('Only image files, please!', 2000);
      }
    }
  });

  if (uploadHint) {
    uploadHint.addEventListener('click', (e) => {
      e.stopPropagation();
      window.hermesPetAPI?.pickCustomSprite?.();
    });
  }
}

// =====================================================================
// FEATURE F2: Idle time-based chat lines
// =====================================================================

const BUBBLE_LINES = {
  running: [
    "帮紧你, 帮紧你!!!",
  ],
  review: [
    "喂，快啲拍板啦 🤨",
    "你谂好未啫 😗",
    "你话事，我等紧你呀 👀",
    "再谂落去天都黑啦 🙈",
    "拣边个好呀？快啲啦 ✋",
    "你一点头我就冲㗎喇 😎",
  ],
  thinking: [
    "我谂紧点行，等我转个弯先 🤔",
    "唔系卡住，我喺度度紧路 🌀",
    "脑袋转紧圈，谂通就继续啦 👀",
    "等我消化下，呢步要谂清楚 🧠",
    "我静静谂阵，等阵就冲呀 😗",
  ],
  thinking_long: [
    "谂咗一阵，我仲喺度推紧，未走开 👀",
    "呢步要多转几圈，我继续帮你度路 🧠",
    "有啲绕，我仲喺度拆紧，等我多阵 🌀",
  ],
  thinking_stalled: [
    "呢下谂耐咗，似乎有啲黏住，我继续守住 👀",
    "超过两分钟喇，我仲喺度，可能要等下个信号 🧭",
    "呢个位有啲卡，我继续望住，唔会自己消失 🫡",
  ],
  waiting: [
    "喂，俾我先啦 🔑",
    "密码呢？我等到想瞓喇 😪",
    "授权啦唔该，我好乖㗎 🤫",
    "快啲俾我入去先啦 🙏",
    "你唔批，我就喺度望住你 👀",
  ],
  idle: [
    "真系冇办法啦 ✅",
    "我系乖小孩嚟㗎 😇",
    "搞掂咗喇，轻轻松松 😙",
    "做完喇，我要休息吓先 😌",
    "好闷呀，不如玩阵啦 🍪",
  ],
};

const IDLE_LINES = [
  "真系冇办法啦，咁都要等 😮‍💨",
  "我系乖小孩，不过都会闷㗎 😇",
  "大姐姐去咗边呀 👀",
  "杯朱古力奶仲有冇得饮呀 🥛",
  "*打喊露* 我有啲眼瞓啫… 💤",
  "你唔出声，我当你默认咗喇 🤫",
  "喂，唔好净系望住我啦 😗",
  "依家系发呆时间咩 🐟",
  "你再唔郁，我就周围碌㗎喇 😏",
  "谂紧咩大计呀，讲嚟听吓 🤨",
  "我偷偷地研究紧你点写code 👀",
  "等紧你落order呀 🗣️",
  "成日望住个mon，你唔攰咩 😎",
  "我其实几醒目㗎，你问下我啦 ✨",
  "开工啦喂，我准备好喇 🌞",
];

const COMPANION_LINES = {
  day_greeting: [
    "早晨呀，我今日继续陪你开工啦 🌤️",
    "我喺度等你落第一单，慢慢嚟啦 🤍",
    "今日有咩想搞掂呀？我陪你一齐顶住 🫶",
  ],
  idle_nudge: [
    "我仲喺度陪住你，慢慢嚟啦 🤍",
    "你如果想继续，我已经准备好喇 🫶",
    "唔使急，我等你讲下一步呀 🌤️",
    "休息够未呀？我可以继续陪你开工 👀",
  ],
  long_running: [
    "呢单做咗一阵喇，我陪住你，记得唞下呀 💛",
    "仲未搞掂都唔紧要，慢慢拆开佢啦 🧩",
    "如果你卡住咗，我都仲喺度陪你顶住 🫶",
    "做咗咁耐，饮啖水先再冲都得呀 💧",
  ],
  late_night: [
    "今晚又做到咁夜喇，我陪你，不过都要早点抖呀 🌙",
    "夜喇喎，你叻还叻，身体都要顾住呀 🤍",
    "我知你仲想做埋佢，不过唔使逼自己咁尽 🛌",
  ],
  failure_comfort: [
    "头先嗰下唔算数啦，我哋慢慢再试过 🤍",
    "失手一两次好正常，我仲陪住你呀 🫶",
    "唔紧要，今次未得啫，下一次会顺好多㗎 🌤️",
    "你已经好努力喇，我哋抖一抖再嚟过 💛",
  ],
  review_care: [
    "你慢慢谂，我唔催，但我会陪你等答案 🤍",
    "呢下要你拍板喇，我企定定陪住你 👀",
    "唔使急住决定，谂清楚先都得呀 🌤️",
  ],
  waiting_care: [
    "仲等紧喇，我喺度同你一齐守住佢 🫶",
    "等批呢啲最磨人，我陪你撑住先 🤍",
    "未放行都唔紧要，我继续喺度等你一句 👀",
  ],
  wrap_up: [
    "今日辛苦喇，依家收一收，等阵再嚟都得 🤍",
    "做到呢度已经好叻喇，抖下先啦 🌤️",
    "尾声喇，我帮你望住，放心松一松啦 🫶",
  ],
};

let idleTimer = null;
let idleInterval = 45000;
let staleTimer = null;
let runtimeRunningPulseTimer = null;
var STALE_TIMEOUT_MS = 21600000;
var RUNTIME_RUNNING_PULSE_IDLE_MS = 12000;

function scheduleStaleTimeout() {
  if (staleTimer) clearTimeout(staleTimer);
  if (animController.currentState === 'running') {
    staleTimer = setTimeout(function() {
      animController.transition('idle');
      hideBubble();
      staleTimer = null;
    }, STALE_TIMEOUT_MS);
  }
}

function cancelStaleTimeout() {
  if (staleTimer) {
    clearTimeout(staleTimer);
    staleTimer = null;
  }
}

function cancelRuntimeRunningPulseIdle() {
  if (runtimeRunningPulseTimer) {
    clearTimeout(runtimeRunningPulseTimer);
    runtimeRunningPulseTimer = null;
  }
}

function scheduleRuntimeRunningPulseIdle() {
  cancelRuntimeRunningPulseIdle();
  runtimeRunningPulseTimer = setTimeout(function() {
    runtimeRunningPulseTimer = null;
    if (['running', 'run_left', 'run_right'].indexOf(animController.currentState) === -1) return;
    companionState.mode = 'idle';
    companionState.running_started_at = null;
    _tuiTargetState = null;
    clearRunningCareTimers();
    persistSessionRuntime('idle');
    petMemory.today.last_idle_at = isoNow();
    savePetMemory();
    animController._playingOneShot = false;
    animController.transition('idle');
    hideBubble();
    renderCompanionSummary();
    logCompanion('runtime-running-pulse-idle', { delay_ms: RUNTIME_RUNNING_PULSE_IDLE_MS });
  }, RUNTIME_RUNNING_PULSE_IDLE_MS);
}

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  var expression = companionExpression();
  var effectiveIdleInterval = idleInterval;
  if (expression.summary_key === 'steady_progress') effectiveIdleInterval = Math.max(35000, idleInterval - 5000);
  if (expression.summary_key === 'failure_recovery') effectiveIdleInterval = Math.min(60000, idleInterval + 10000);
  if (expression.summary_key === 'steady_night_owl' || expression.summary_key === 'night_owl' || expression.summary_key === 'night_approval_push') {
    effectiveIdleInterval = Math.min(65000, idleInterval + 8000);
  }
  idleTimer = setTimeout(() => {
    // Don't show idle bubbles while pet is in an active state
    var activeStates = ['running', 'run_left', 'run_right', 'review', 'waiting', 'failed'];
    if (activeStates.indexOf(animController.currentState) !== -1) {
      idleInterval = Math.min(idleInterval * 1.5, 300000);
      resetIdleTimer();
      return;
    }
    if (notificationPrefs.show_idle_bubbles && notificationPrefs.quiet_mode === 'off' && !mutedNow()) {
      if (minutesSince(overlayCompanion.cooldowns.idle_nudge_at) >= 30
        && petMemory.today.tasks_started > 0
        && minutesSince(petMemory.today.first_active_at) <= 180) {
        showCompanionBubble('idle_nudge', 4000);
      } else {
        const line = randomBubbleLine('idle') || IDLE_LINES[Math.floor(Math.random() * IDLE_LINES.length)];
        showBubble(line, 4000);
      }
    }
    idleInterval = Math.min(idleInterval * 1.5, 300000);
    resetIdleTimer();
  }, effectiveIdleInterval);
}

// Wrap existing handleEvent to also reset idle timer
const _origHandleEvent = handleEvent;
handleEvent = function(msg) {
  var semanticFirst = !!(msg && (
    msg.type === 'task_started' ||
    msg.type === 'task_progress' ||
    msg.type === 'task_blocked' ||
    msg.type === 'task_resumed' ||
    msg.type === 'task_completed' ||
    msg.type === 'task_failed'
  ));
  if (semanticFirst && msg && msg.companion_memory && typeof msg.companion_memory === 'object') {
    applyCompanionMemorySnapshot(msg.companion_memory, msg.type);
  }
  if (semanticFirst) updateCompanionState(msg);
  _origHandleEvent(msg);
  if (!semanticFirst) updateCompanionState(msg);
  cancelStaleTimeout();
  if (msg && msg.type === 'running') scheduleRuntimeRunningPulseIdle();
  else if (msg && msg.type !== 'heartbeat') cancelRuntimeRunningPulseIdle();
  idleInterval = 45000;
  resetIdleTimer();
  requestAnimationFrame(reportSpriteRect);
};

document.addEventListener('mousemove', () => {
  idleInterval = 45000;
  resetIdleTimer();
});

resetIdleTimer();

animController.loadManifest().then(function() {
  if (!DEBUG_ANIM) animController._removeDebugOverlay();
  if (!animController.manifest) {
    requestAnimationFrame(reportSpriteRect);
    return;
  }

  var savedVisual = loadVisualBootstrap();
  if (savedVisual) {
    state.species = savedVisual.species || state.species;
    state.variant = savedVisual.variant || state.variant;
    state.shiny = !!savedVisual.shiny;
    state.custom_pet = savedVisual.custom_pet || null;
  }

  // Bootstrap: prefer the last persisted visual state. If none exists,
  // fall back to HERMES_PET_SPECIES query or cat.
  var qsSpecies = new URLSearchParams(window.location.search).get('species') || 'cat';
  var bootstrapSpecies = state.species || qsSpecies;
  if (bootstrapSpecies && !animController.species) {
    setSprite(bootstrapSpecies, state.variant);
    return;
  }

  if (animController.species) {
    animController.init(animController.species, animController.customPet || normalizeCustomPet(state.custom_pet));
  }
  requestAnimationFrame(reportSpriteRect);
});

if (DEBUG_EVENTS || new URLSearchParams(window.location.search).get('debugSmoke') === '1') {
  window.__hermesPetRendererSmoke = {
    handleEvent: handleEvent,
    getState: function() { return { ...state }; },
    getRecentEvents: function() { return recentEvents.slice(); },
    getNotificationPrefs: function() { return { ...notificationPrefs }; },
    getCurrentAnimation: function() { return animController.currentState; },
    isTrayVisible: function() { return !!eventTrayEl && !eventTrayEl.classList.contains('hidden'); },
    isTrayAttention: function() { return !!eventTrayEl && eventTrayEl.classList.contains('attention'); },
    getBubbleText: function() { return bubbleTextEl ? bubbleTextEl.textContent : ''; },
    isBubbleVisible: function() { return !!bubbleEl && !bubbleEl.classList.contains('hidden'); },
    showBubbleForSmoke: function(text, duration) { return showBubble(text, duration); },
    hideBubbleForSmoke: function() { bubbleEl.classList.add('hidden'); },
    restorePinnedBubbleForSmoke: function(reason) { return restorePinnedBubbleForActiveState(reason || 'smoke'); },
    resetActivityForSmoke: function() {
      recentEvents.length = 0;
      trayAttention = false;
      if (eventTrayEl) eventTrayEl.classList.add('hidden');
      if (eventListEl) eventListEl.children = [];
      if (eventSummaryEl) eventSummaryEl.classList.add('hidden');
    }
  };
}
