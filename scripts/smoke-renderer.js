#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '..');
const overlayDir = path.resolve(process.argv[2] || path.join(repoRoot, 'src/hermes_pet/overlay'));
const rendererPath = path.join(overlayDir, 'src/renderer.js');
const manifestPath = path.join(overlayDir, 'assets/manifest.json');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

class FakeClassList {
  constructor(initial = []) {
    this.values = new Set(initial);
  }

  add(...names) {
    names.forEach((name) => this.values.add(name));
  }

  remove(...names) {
    names.forEach((name) => this.values.delete(name));
  }

  contains(name) {
    return this.values.has(name);
  }

  toggle(name, force) {
    const next = force === undefined ? !this.values.has(name) : !!force;
    if (next) this.values.add(name);
    else this.values.delete(name);
    return next;
  }
}

function makeElement(id = '') {
  const initialClasses = [];
  if (['pet-bubble', 'event-tray', 'pet-stats', 'drop-zone', 'upload-hint'].includes(id)) {
    initialClasses.push('hidden');
  }
  if (id === 'pet-sprite') initialClasses.push('sprite', 'idle');
  return {
    id,
    style: {},
    children: [],
    classList: new FakeClassList(initialClasses),
    _textContent: '',
    offsetWidth: 120,
    addEventListener() {},
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    remove() {},
    setPointerCapture() {},
    releasePointerCapture() {},
    hasPointerCapture() {
      return true;
    },
    getBoundingClientRect() {
      return { left: 40, top: 40, width: 160, height: 160 };
    },
    set innerHTML(value) {
      this.textContent = String(value || '');
    },
    get innerHTML() {
      return this.textContent;
    },
    set textContent(value) {
      this._textContent = String(value || '');
      this.children = [];
    },
    get textContent() {
      return this._textContent;
    },
  };
}

function makeDocument() {
  const elements = new Map();
  const document = {
    body: makeElement('body'),
    addEventListener() {},
    createElement(tag) {
      const el = makeElement(tag);
      el.tagName = tag.toUpperCase();
      return el;
    },
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, makeElement(id));
      }
      return elements.get(id);
    },
  };
  return document;
}

async function flush() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  await Promise.resolve();
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const renderer = fs.readFileSync(rendererPath, 'utf8');
  const bridgeCallbacks = { events: null, connected: null };
  const document = makeDocument();
  let timerId = 0;
  const timers = new Map();
  function runTimersWithDelay(delay) {
    const due = [];
    for (const [id, timer] of timers.entries()) {
      if (timer.delay === delay) {
        timers.delete(id);
        due.push(timer.callback);
      }
    }
    due.forEach((callback) => {
      if (typeof callback === 'function') callback();
    });
  }
  const context = {
    console,
    document,
    Image: class {
      set src(value) {
        this._src = value;
        if (this.onload) queueMicrotask(() => this.onload());
      }
      get src() {
        return this._src;
      }
    },
    URL,
    URLSearchParams,
    setTimeout(callback, delay) {
      const id = ++timerId;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    setInterval() {
      return 1;
    },
    clearInterval() {},
    requestAnimationFrame(callback) {
      if (typeof callback === 'function') callback();
      return 1;
    },
    cancelAnimationFrame() {},
    fetch() {
      throw new Error('fetch should not be used when IPC manifest is present');
    },
    window: {
      location: { search: '?debugSmoke=1&species=cat' },
      addEventListener() {},
      hermesPetAPI: {
        loadManifest: () => manifest,
        onPetEvent: (callback) => {
          bridgeCallbacks.events = callback;
        },
        onBridgeConnected: (callback) => {
          bridgeCallbacks.connected = callback;
        },
        onPositionChange() {},
        show() {},
        hide() {},
        minimize() {},
        restore() {},
        petDragStart() {},
        petDragMove() {},
        petDragEnd() {},
      },
    },
  };
  context.globalThis = context;

  vm.runInNewContext(renderer, context, { filename: rendererPath });
  await flush();

  const smoke = context.window.__hermesPetRendererSmoke;
  assert(smoke, 'renderer smoke API was not exposed');
  assert(typeof bridgeCallbacks.events === 'function', 'pet event listener was not registered');
  assert(typeof bridgeCallbacks.connected === 'function', 'bridge connection listener was not registered');
  assert(smoke.getCurrentAnimation() === 'idle', 'startup should render idle animation');

  smoke.handleEvent({ type: 'state', species: 'cat', name: 'Miso', level: 2, xp: 30, xp_next: 100 });
  await flush();
  assert(smoke.getState().name === 'Miso', 'state event should update pet name');
  assert(document.getElementById('pet-sprite').style.backgroundImage.includes('/cat/idle/'), 'built-in cat sprite should be visible');

  bridgeCallbacks.connected(false);
  await flush();
  assert(smoke.getCurrentAnimation() === 'idle', 'disconnect should not force stale waiting before timeout');
  bridgeCallbacks.connected(true);
  await flush();
  assert(smoke.getCurrentAnimation() === 'idle', 'reconnect should return waiting pet to idle');

  smoke.handleEvent({
    type: 'notification_prefs',
    prefs: { notification_profile: 'focus', quiet_mode: 'important', show_idle_bubbles: false },
  });
  assert(smoke.getNotificationPrefs().notification_profile === 'focus', 'profile should normalize through renderer prefs');
  assert(smoke.getNotificationPrefs().quiet_mode === 'important', 'quiet profile should be active');

  smoke.handleEvent({ type: 'job_started', text: 'Tests', id: 'job-1' });
  await flush();
  assert(smoke.getCurrentAnimation() === 'running', 'job_started should animate running');
  assert(smoke.isBubbleVisible(), 'job_started should show a pinned running bubble');
  assert(smoke.getBubbleText().includes('帮紧你'), 'job_started should use running bubble copy');
  smoke.showBubbleForSmoke('Short active-state nudge', 1000);
  smoke.hideBubbleForSmoke();
  assert(smoke.restorePinnedBubbleForSmoke('smoke'), 'hidden transient bubble should restore pinned running bubble');
  assert(smoke.isBubbleVisible(), 'restored running bubble should be visible');
  assert(smoke.getBubbleText().includes('帮紧你'), 'restored running bubble should use running copy');

  smoke.handleEvent({ type: 'job_finished', text: 'Tests passed', id: 'job-1' });
  await flush();
  assert(smoke.getCurrentAnimation() === 'idle', 'job_finished should return running animation to idle');

  smoke.handleEvent({ type: 'task_started', task_title: 'Plugin task', task_id: 'plugin-1' });
  await flush();
  assert(smoke.getCurrentAnimation() === 'running', 'task_started should animate running');
  smoke.handleEvent({ type: 'task_completed', task_title: 'Plugin task', task_id: 'plugin-1' });
  await flush();
  assert(smoke.getCurrentAnimation() === 'idle', 'task_completed should return running animation to idle');

  smoke.handleEvent({ type: 'task_started', task_title: 'Plugin task', task_id: 'plugin-2' });
  await flush();
  assert(smoke.getCurrentAnimation() === 'running', 'second task_started should animate running');
  smoke.handleEvent({ type: 'idle' });
  await flush();
  assert(smoke.getCurrentAnimation() === 'idle', 'idle should not be realigned to running after an active semantic task');

  smoke.handleEvent({ type: 'running', text: 'Plugin pulse running' });
  await flush();
  assert(smoke.getCurrentAnimation() === 'running', 'bare running pulse should animate running');
  runTimersWithDelay(12000);
  await flush();
  assert(smoke.getCurrentAnimation() === 'idle', 'bare running pulse should auto-return to idle');

  smoke.handleEvent({ type: 'job_failed', text: 'Tests failed', id: 'job-2', exit_code: 7 });
  await flush();
  assert(smoke.getCurrentAnimation() === 'failed', 'job_failed should animate failed');
  assert(smoke.isTrayVisible(), 'job_failed should open the activity tray');
  assert(smoke.isTrayAttention(), 'job_failed should mark the tray as attention state');
  assert(smoke.getBubbleText(), 'job_failed should leave an operator-visible bubble');

  smoke.handleEvent({ type: 'message_received', source: 'telegram', sender: 'Ada', text: 'Can you review?', urgent: true });
  await flush();
  assert(
    smoke.getRecentEvents().some((event) => event.type === 'message_received'),
    'message events should be recorded for tray scanning'
  );

  smoke.resetActivityForSmoke();
  smoke.handleEvent({
    type: 'notification_prefs',
    prefs: { notification_profile: 'normal', quiet_mode: 'off', show_idle_bubbles: false },
  });
  smoke.handleEvent({ type: 'achievement_unlocked', achievement: { title: 'Clean Run' } });
  await flush();
  const achievementEvent = smoke.getRecentEvents()[0];
  assert(achievementEvent.type === 'achievement_unlocked', 'achievement events should reach activity handling');
  assert(achievementEvent.severity === 'info', 'achievement events should remain non-critical');
  assert(!smoke.isTrayAttention(), 'achievement unlock should not mark the tray as attention state');
  assert(smoke.getBubbleText(), 'achievement unlock should show quiet bubble copy');

  const bubbleBeforeQuietAchievement = smoke.getBubbleText();
  smoke.resetActivityForSmoke();
  smoke.handleEvent({
    type: 'notification_prefs',
    prefs: { notification_profile: 'focus', quiet_mode: 'important', show_idle_bubbles: false },
  });
  smoke.handleEvent({ type: 'achievement_unlocked', achievement: { title: 'Quiet Win' } });
  await flush();
  assert(smoke.getRecentEvents()[0].type === 'achievement_unlocked', 'quiet achievement should still be recorded');
  assert(smoke.getBubbleText() === bubbleBeforeQuietAchievement, 'quiet mode should not replace the previous non-critical bubble');

  smoke.handleEvent({
    type: 'state',
    species: 'cat',
    name: 'Custom',
    custom_pet: {
      name: 'spark',
      path: '/tmp/hermes-pet-smoke',
      manifest: { states: { idle: { fps: 1, frames: ['idle_00.png'] } } },
    },
  });
  await flush();
  assert(
    document.getElementById('pet-sprite').style.backgroundImage.includes('/tmp/hermes-pet-smoke/sprites/idle/idle_00.png'),
    'selected custom pet should load its idle frame'
  );

  smoke.handleEvent({ type: 'state', species: 'cat', name: 'Fallback', custom_pet: { name: 'bad' } });
  await flush();
  assert(document.getElementById('pet-sprite').style.backgroundImage.includes('/cat/idle/'), 'invalid custom pet should fall back to built-in sprite');

  console.log('renderer smoke ok');
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
