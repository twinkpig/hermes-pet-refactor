const { app, BrowserWindow, dialog, ipcMain, screen } = require('electron');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const os = require('os');

let win = null;
let wsClient = null;
let reconnectTimer = null;
let reconnectDelayMs = 1000;
let lastConnectionLogMs = 0;
let bridgeConnected = null;
let dragState = null;
let lastSpriteRect = { left: 60, top: 164, width: 160, height: 160 };
let mousePassthrough = null;
let mousePassthroughTimer = null;
let trayVisible = false;
let thinkingStageTimers = [];

const IS_MAC = process.platform === 'darwin';
const MAC_STANDARD_WINDOW = IS_MAC && process.env.HERMES_PET_MAC_STANDARD_WINDOW === '1';
const MIN_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30000;
const CONNECTION_LOG_INTERVAL_MS = 30000;
const DEFAULT_ALWAYS_ON_TOP_LEVEL = IS_MAC ? 'floating' : 'screen-saver';
const ALWAYS_ON_TOP_LEVEL = process.env.HERMES_PET_ALWAYS_ON_TOP_LEVEL || DEFAULT_ALWAYS_ON_TOP_LEVEL;
const WINDOW_SIZE = { width: 280, height: 340 };
const MAC_WINDOW_SIZE = { width: 280, height: 1020 };
const PET_TITLE = `Hermes Pets Overlay [${process.pid}]`;
const PET_SPECIES = process.env.HERMES_PET_SPECIES || 'cat';
const DEBUG_EVENTS = process.env.HERMES_PET_DEBUG_EVENTS === '1';
const DEBUG_ANIMATION = process.env.HERMES_PET_DEBUG_ANIMATION === '1';
const DEBUG_DRAG = process.env.HERMES_PET_DEBUG_DRAG === '1';
const CUSTOM_SPRITE_DIR = path.join(os.homedir(), '.hermes');
const CUSTOM_SPRITE_PATH = path.join(CUSTOM_SPRITE_DIR, 'pet_custom.png');
const PET_MEMORY_FILE = process.env.HERMES_PET_MEMORY_FILE
  || path.join(os.homedir(), '.hermes_pet', 'pet-memory.json');
const OVERLAY_COMPANION_FILE = path.join(path.dirname(PET_MEMORY_FILE), 'overlay-companion.json');
const COMPANION_TIMEZONE = process.env.HERMES_PET_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

const positionFilePath = () => process.env.HERMES_PET_POSITION_FILE || path.join(os.homedir(), '.hermes', 'pet_position.json');

if (IS_MAC) {
  app.setName('Hermes Pets');
  app.setActivationPolicy('regular');
}

function defaultWindowPosition() {
  const area = screen.getPrimaryDisplay().workArea || screen.getPrimaryDisplay().bounds;
  return {
    x: area.x + Math.max(0, area.width - WINDOW_SIZE.width - 24),
    y: area.y + Math.max(0, area.height - WINDOW_SIZE.height - 24),
  };
}

function clampToWorkArea(x, y, width = WINDOW_SIZE.width, height = WINDOW_SIZE.height) {
  const area = screen.getPrimaryDisplay().workArea || screen.getPrimaryDisplay().bounds;
  const maxX = area.x + Math.max(0, area.width - width);
  const maxY = area.y + Math.max(0, area.height - height);
  return { x: Math.min(Math.max(Number.isFinite(x) ? x : area.x, area.x), maxX), y: Math.min(Math.max(Number.isFinite(y) ? y : area.y, area.y), maxY) };
}

function sanitizeSpriteRect(rect, windowWidth = WINDOW_SIZE.width, windowHeight = WINDOW_SIZE.height) {
  if (!rect || typeof rect !== 'object') return null;
  const left = Number(rect.left), top = Number(rect.top), width = Number(rect.width), height = Number(rect.height);
  if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  const normalizedLeft = Math.min(Math.max(Math.round(left), 0), Math.max(0, windowWidth - 1));
  const normalizedTop = Math.min(Math.max(Math.round(top), 0), Math.max(0, windowHeight - 1));
  return { left: normalizedLeft, top: normalizedTop, width: Math.min(Math.round(width), Math.max(1, windowWidth - normalizedLeft)), height: Math.min(Math.round(height), Math.max(1, windowHeight - normalizedTop)) };
}

function clampWindowToVisibleBounds(x, y, spriteRect = lastSpriteRect, windowWidth = WINDOW_SIZE.width, windowHeight = WINDOW_SIZE.height) {
  const rect = sanitizeSpriteRect(spriteRect, windowWidth, windowHeight);
  if (!rect) return clampToWorkArea(x, y, windowWidth, windowHeight);
  const area = screen.getPrimaryDisplay().workArea || screen.getPrimaryDisplay().bounds;
  const minX = area.x - rect.left;
  const minY = area.y - rect.top;
  const maxX = area.x + area.width - rect.left - rect.width;
  const maxY = area.y + area.height - rect.top - rect.height;
  return { x: Math.min(Math.max(Number.isFinite(x) ? x : minX, minX), maxX), y: Math.min(Math.max(Number.isFinite(y) ? y : minY, minY), maxY) };
}

function loadPosition() {
  try {
    const posFile = positionFilePath();
    if (fs.existsSync(posFile)) {
      const data = JSON.parse(fs.readFileSync(posFile, 'utf8'));
      return clampToWorkArea(data.x, data.y);
    }
  } catch (_) {}
  return defaultWindowPosition();
}

function savePosition(x, y) {
  try {
    const posFile = positionFilePath();
    fs.mkdirSync(path.dirname(posFile), { recursive: true });
    fs.writeFileSync(posFile, JSON.stringify({ x, y }, null, 2));
  } catch (e) {
    console.warn(`[pet-overlay] failed to save position: ${e.message}`);
  }
}

function persistWindowPosition() {
  if (!win) return;
  const bounds = win.getBounds();
  const clamped = clampWindowToVisibleBounds(bounds.x, bounds.y, lastSpriteRect, bounds.width, bounds.height);
  if (bounds.x !== clamped.x || bounds.y !== clamped.y) win.setBounds({ ...bounds, ...clamped });
  savePosition(clamped.x, clamped.y);
  win.webContents.send('position-changed', clamped.x, clamped.y);
}

function setMousePassthrough(ignore) {
  if (!win || win.isDestroyed() || mousePassthrough === ignore) return;
  try {
    win.setIgnoreMouseEvents(ignore, ignore ? { forward: true } : undefined);
    mousePassthrough = ignore;
  } catch (_) {}
}

function cursorHitsSprite() {
  if (!win || win.isDestroyed()) return false;
  const bounds = win.getBounds();
  const rect = sanitizeSpriteRect(lastSpriteRect, bounds.width, bounds.height);
  if (!rect) return false;
  const point = screen.getCursorScreenPoint();
  const localX = point.x - bounds.x;
  const localY = point.y - bounds.y;
  return localX >= rect.left &&
    localX < rect.left + rect.width &&
    localY >= rect.top &&
    localY < rect.top + rect.height;
}

function updateMousePassthrough() {
  if (!win || win.isDestroyed()) return;
  if (dragState || trayVisible) {
    setMousePassthrough(false);
    return;
  }
  setMousePassthrough(!cursorHitsSprite());
}

function startMousePassthroughLoop() {
  if (mousePassthroughTimer) clearInterval(mousePassthroughTimer);
  mousePassthroughTimer = setInterval(updateMousePassthrough, 75);
  updateMousePassthrough();
}

function reassertOverlayOnTop(reason) {
  if (!win) return;
  try {
    if (!MAC_STANDARD_WINDOW || process.env.HERMES_PET_ALWAYS_ON_TOP_LEVEL) {
      win.setAlwaysOnTop(true, ALWAYS_ON_TOP_LEVEL);
      win.moveTop();
    }
    console.log(`[pet-overlay] reasserted always-on-top (${ALWAYS_ON_TOP_LEVEL}) after ${reason}`);
  } catch (e) {
    console.warn(`[pet-overlay] failed to reassert always-on-top after ${reason}: ${e.message}`);
  }
}

function makeWindowVisible(reason) {
  if (!win) return;
  try {
    if (process.platform === 'darwin') {
      if (!MAC_STANDARD_WINDOW) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      win.show();
      win.focus();
      if (!MAC_STANDARD_WINDOW) app.focus({ steal: true });
    } else {
      win.showInactive();
    }
    reassertOverlayOnTop(reason);
  } catch (e) {
    console.warn(`[pet-overlay] failed to show overlay after ${reason}: ${e.message}`);
  }
}

function notifyBridgeConnected(connected) {
  if (bridgeConnected === connected) return;
  bridgeConnected = connected;
  if (win) win.webContents.send('bridge-connected', connected);
}

function scheduleReconnect(url) {
  if (app.isQuitting) return;
  const delay = reconnectDelayMs;
  reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connectBridge, delay);
  reconnectTimer.unref?.();
  const now = Date.now();
  if (now - lastConnectionLogMs >= CONNECTION_LOG_INTERVAL_MS) {
    lastConnectionLogMs = now;
    console.log(`[pet-overlay] waiting for pet bridge at ${url}; retrying in ${Math.round(delay / 1000)}s`);
  }
}

function connectBridge() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  const bridgePort = process.env.HERMES_PET_PORT || 17473;
  const url = process.env.HERMES_PET_WS_URL || `ws://127.0.0.1:${bridgePort}`;
  notifyBridgeConnected(false);
  wsClient = new WebSocket(url);

  wsClient.on('open', () => {
    reconnectDelayMs = MIN_RECONNECT_DELAY_MS;
    lastConnectionLogMs = 0;
    console.log(`[pet-overlay] connected to bridge at ${url}`);
    notifyBridgeConnected(true);
  });

  wsClient.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (win) win.webContents.send('pet-event', msg);
    } catch (_) {
      console.error('[pet-overlay] bad bridge message');
    }
  });

  wsClient.on('close', () => {
    notifyBridgeConnected(false);
    scheduleReconnect(url);
  });

  wsClient.on('error', (err) => {
    const now = Date.now();
    if (now - lastConnectionLogMs < CONNECTION_LOG_INTERVAL_MS) return;
    lastConnectionLogMs = now;
    console.warn(`[pet-overlay] Hermes bridge unavailable at ${url}: ${err.message}`);
  });
}

function emitCustomSprite(pathOrUrl) {
  if (win) win.webContents.send('custom-sprite-set', pathOrUrl);
}

function loadJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function saveJsonFile(filePath, payload) {
  if (!payload || typeof payload !== 'object') return false;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    return true;
  } catch (e) {
    console.warn(`[pet-overlay] failed to save ${filePath}: ${e.message}`);
    return false;
  }
}

function clearThinkingStageTimers() {
  while (thinkingStageTimers.length) {
    clearTimeout(thinkingStageTimers.pop());
  }
}

function loadFallbackPage(reason) {
  if (!win || win.isDestroyed()) return;
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      background: #111827;
      color: #f9fafb;
      font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    body {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 14px;
      border: 2px solid #60a5fa;
      box-sizing: border-box;
    }
    .pet {
      width: 96px;
      height: 96px;
      border-radius: 42% 42% 48% 48%;
      background:
        radial-gradient(circle at 34% 36%, #111827 0 5px, transparent 6px),
        radial-gradient(circle at 66% 36%, #111827 0 5px, transparent 6px),
        radial-gradient(circle at 50% 58%, #111827 0 4px, transparent 5px),
        linear-gradient(135deg, #f7d08a, #f97316);
    }
    .msg { max-width: 220px; text-align: center; line-height: 1.35; }
    code { color: #93c5fd; }
  </style>
</head>
<body>
  <div class="pet"></div>
  <div class="msg">Hermes Pets fallback window<br><code>${String(reason).replace(/[<>&]/g, '')}</code></div>
</body>
</html>`;
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)).catch((e) => {
    console.error('[pet-overlay] fallback page failed:', e.message);
  });
}

function createWindow() {
  if (win) return;
  const pos = loadPosition();
  const focusable = process.env.HERMES_PET_FOCUSABLE === '1' || IS_MAC;
  const clickThrough = process.env.HERMES_PET_CLICK_THROUGH === '1';
  const debugWindow = process.env.HERMES_PET_DEBUG_WINDOW === '1';
  const standardWindow = debugWindow || MAC_STANDARD_WINDOW;
  const showUpload = process.env.HERMES_PET_SHOW_UPLOAD === '1' ? '1' : '0';
  console.log(`[pet-overlay] platform ${process.platform}`);
  console.log(`[pet-overlay] always-on-top level ${ALWAYS_ON_TOP_LEVEL}`);
  if (clickThrough) console.log('[pet-overlay] click-through enabled');
  if (debugWindow) console.log('[pet-overlay] debug window enabled');
  if (MAC_STANDARD_WINDOW) console.log('[pet-overlay] mac standard window enabled');

  win = new BrowserWindow({
    ...(IS_MAC ? MAC_WINDOW_SIZE : WINDOW_SIZE),
    x: pos.x,
    y: pos.y,
    title: PET_TITLE,
    transparent: !standardWindow,
    frame: standardWindow,
    skipTaskbar: !standardWindow,
    alwaysOnTop: !standardWindow,
    focusable,
    hasShadow: standardWindow,
    resizable: standardWindow,
    backgroundColor: standardWindow ? '#111827' : '#00000000',
    show: standardWindow,
    fullScreenable: !IS_MAC,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });

  let rendererLoaded = false;
  const rendererFallbackTimer = setTimeout(() => {
    if (!rendererLoaded) loadFallbackPage('renderer load timeout');
  }, 2000);
  rendererFallbackTimer.unref?.();

  win.loadFile(path.join(__dirname, 'renderer.html'), {
    query: { species: PET_SPECIES, showUpload, debugEvents: DEBUG_EVENTS ? '1' : '0', debugAnimation: DEBUG_ANIMATION ? '1' : '0', debugDrag: DEBUG_DRAG ? '1' : '0' },
  }).catch((e) => {
    clearTimeout(rendererFallbackTimer);
    loadFallbackPage('renderer load failed: ' + e.message);
  });
  notifyBridgeConnected(false);

  win.webContents.once('did-finish-load', () => {
    rendererLoaded = true;
    clearTimeout(rendererFallbackTimer);
    const classes = ['overlay-mode'];
    if (IS_MAC) classes.push('mac-overlay');
    if (clickThrough) classes.push('click-through-mode');
    if (debugWindow) classes.push('debug-window', 'debug-sprite');
    if (process.env.HERMES_PET_DEBUG_SPRITE === '1') classes.push('debug-sprite');
    win.webContents.executeJavaScript(`document.body.classList.add(${classes.map((c) => JSON.stringify(c)).join(',')})`).catch(() => {});
    if (fs.existsSync(CUSTOM_SPRITE_PATH)) emitCustomSprite(CUSTOM_SPRITE_PATH);
  });

  win.once('ready-to-show', () => {
    console.log(`[pet-overlay] final window bounds ${JSON.stringify(win.getBounds())}`);
    makeWindowVisible('ready-to-show');
    if (clickThrough) win.setIgnoreMouseEvents(true, { forward: true });
    else if (IS_MAC && !standardWindow) startMousePassthroughLoop();
  });
  win.webContents.once('did-finish-load', () => setTimeout(() => makeWindowVisible('did-finish-load'), 250));

  let moveTimeout = null;
  win.on('move', () => {
    if (dragState) return;
    if (moveTimeout) clearTimeout(moveTimeout);
    moveTimeout = setTimeout(persistWindowPosition, 500);
  });
  win.on('blur', () => reassertOverlayOnTop('blur'));
  win.on('show', () => reassertOverlayOnTop('show'));
  win.on('restore', () => reassertOverlayOnTop('restore'));
  win.on('moved', () => updateMousePassthrough());
  win.on('closed', () => {
    dragState = null;
    if (mousePassthroughTimer) clearInterval(mousePassthroughTimer);
    mousePassthroughTimer = null;
    mousePassthrough = null;
    trayVisible = false;
    win = null;
  });
}

app.whenReady().then(() => { createWindow(); connectBridge(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('window-all-closed', () => {
  app.isQuitting = true;
  if (wsClient) wsClient.close();
  if (reconnectTimer) clearTimeout(reconnectTimer);
  app.quit();
});

ipcMain.on('minimize-pet', () => { if (win) win.setSize(80, 80); });
ipcMain.on('restore-pet', () => { if (win) win.setSize(WINDOW_SIZE.width, WINDOW_SIZE.height); });
ipcMain.on('hide-pet', () => { if (win) win.hide(); });
ipcMain.on('show-pet', () => makeWindowVisible('show-pet'));
ipcMain.on('pet-sprite-rect', (_, rect) => {
  const bounds = win ? win.getBounds() : WINDOW_SIZE;
  lastSpriteRect = sanitizeSpriteRect(rect, bounds.width, bounds.height) || lastSpriteRect;
  updateMousePassthrough();
});
ipcMain.on('event-tray-visibility', (_, visible) => {
  trayVisible = !!visible;
  updateMousePassthrough();
});
ipcMain.on('renderer-log', (_event, payload) => {
  if (DEBUG_EVENTS) console.log('[pet-overlay/renderer]', JSON.stringify(payload || {}));
});
ipcMain.on('thinking-stage-schedule', (_event, payload) => {
  clearThinkingStageTimers();
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.stages)) return;
  const token = payload.token || '';
  for (const stage of payload.stages) {
    const delayMs = Number(stage && stage.delay_ms);
    if (!Number.isFinite(delayMs) || delayMs < 0) continue;
    const timer = setTimeout(() => {
      if (win && !win.isDestroyed()) win.webContents.send('thinking-stage-timer', { token, stage });
    }, delayMs);
    thinkingStageTimers.push(timer);
  }
});
ipcMain.on('thinking-stage-clear', () => {
  clearThinkingStageTimers();
});
ipcMain.on('pet-memory-load', (event) => {
  event.returnValue = loadJsonFile(PET_MEMORY_FILE);
});
ipcMain.on('pet-memory-save', (_event, payload) => {
  saveJsonFile(PET_MEMORY_FILE, payload);
});
ipcMain.on('pet-memory-meta', (event) => {
  event.returnValue = { path: PET_MEMORY_FILE };
});
ipcMain.on('pet-runtime-config', (event) => {
  event.returnValue = { timezone: COMPANION_TIMEZONE };
});
ipcMain.on('overlay-companion-load', (event) => {
  event.returnValue = loadJsonFile(OVERLAY_COMPANION_FILE);
});
ipcMain.on('overlay-companion-save', (_event, payload) => {
  saveJsonFile(OVERLAY_COMPANION_FILE, payload);
});

ipcMain.on('pet-drag-start', (_, point) => {
  if (!win || process.env.HERMES_PET_CLICK_THROUGH === '1') return;
  const startX = Number(point?.screenX), startY = Number(point?.screenY);
  if (!Number.isFinite(startX) || !Number.isFinite(startY) || (startX === 0 && startY === 0)) return;
  const bounds = win.getBounds();
  lastSpriteRect = sanitizeSpriteRect(point?.spriteRect, bounds.width, bounds.height) || lastSpriteRect;
  dragState = { startX, startY, bounds, spriteRect: lastSpriteRect };
  setMousePassthrough(false);
  console.log(`[pet-overlay] drag start ${JSON.stringify({ x: bounds.x, y: bounds.y })}`);
});

ipcMain.on('pet-drag-move', (_, point) => {
  if (!win || !dragState || process.env.HERMES_PET_CLICK_THROUGH === '1') return;
  const screenX = Number(point?.screenX), screenY = Number(point?.screenY);
  if (!Number.isFinite(screenX) || !Number.isFinite(screenY) || (screenX === 0 && screenY === 0)) return;
  const nextX = dragState.bounds.x + Math.round(screenX - dragState.startX);
  const nextY = dragState.bounds.y + Math.round(screenY - dragState.startY);
  const clamped = clampWindowToVisibleBounds(nextX, nextY, dragState.spriteRect, dragState.bounds.width, dragState.bounds.height);
  win.setPosition(clamped.x, clamped.y, false);
});

ipcMain.on('pet-drag-end', () => {
  if (!win || !dragState) return;
  dragState = null;
  persistWindowPosition();
  updateMousePassthrough();
  reassertOverlayOnTop('drag-end');
  console.log(`[pet-overlay] drag end ${JSON.stringify(win.getBounds())}`);
});

ipcMain.on('save-custom-sprite', (_, srcPath) => {
  try {
    fs.mkdirSync(CUSTOM_SPRITE_DIR, { recursive: true });
    fs.copyFileSync(srcPath, CUSTOM_SPRITE_PATH);
    emitCustomSprite(CUSTOM_SPRITE_PATH);
  } catch (e) {
    console.error('[pet-overlay] failed to save custom sprite:', e.message);
  }
});

ipcMain.on('pick-custom-sprite', async () => {
  if (!win) return;
  try {
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose a pet sprite',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
      properties: ['openFile'],
    });
    if (!result.canceled && result.filePaths.length > 0) {
      fs.mkdirSync(CUSTOM_SPRITE_DIR, { recursive: true });
      fs.copyFileSync(result.filePaths[0], CUSTOM_SPRITE_PATH);
      emitCustomSprite(CUSTOM_SPRITE_PATH);
    }
  } catch (e) {
    console.error('[pet-overlay] dialog failed:', e.message);
  }
});

// Load animation manifest from disk (renderer can't fetch file:// URLs due to context isolation)
const MANIFEST_PATH = path.join(__dirname, '..', 'assets', 'manifest.json');
let _cachedManifest = null;
ipcMain.handle('get-pet-manifest', async () => {
  if (_cachedManifest) return _cachedManifest;
  try {
    _cachedManifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    return _cachedManifest;
  } catch (e) {
    console.error('[pet-overlay] failed to load manifest:', e.message);
    return null;
  }
});
