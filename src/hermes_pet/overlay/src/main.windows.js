const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createRequire } = require('module');

const windowsNodeModules = process.env.HERMES_PET_WINDOWS_NODE_MODULES;
const requireFromWindowsCache = windowsNodeModules
  ? createRequire(path.join(windowsNodeModules, 'hermes-pet-overlay-cache.js'))
  : require;
const WebSocket = requireFromWindowsCache('ws');

let win = null;
let wss = null;
let tuiClient = null;
let bridgeConnected = null;
let dragState = null;
let mousePassthrough = null;
let mousePassthroughTimer = null;
let trayVisible = false;
let thinkingStageTimers = [];
let topmostReassertTimer = null;

const ALWAYS_ON_TOP_LEVEL = process.env.HERMES_PET_ALWAYS_ON_TOP_LEVEL || 'screen-saver';
const TOPMOST_REASSERT_INTERVAL_MS = 10000;
const WINDOW_SIZE = { width: 236, height: 688 };
const DEFAULT_SPRITE_RECT = { left: 34, top: 124, width: 148, height: 148 };
const PET_SPECIES = process.env.HERMES_PET_SPECIES || 'cat';
const DEBUG_EVENTS = process.env.HERMES_PET_DEBUG_EVENTS === '1';
const DEBUG_ANIMATION = process.env.HERMES_PET_DEBUG_ANIMATION === '1';
const DEBUG_DRAG = process.env.HERMES_PET_DEBUG_DRAG === '1';
const VERIFY_FILE = process.env.HERMES_PET_OVERLAY_VERIFY_FILE || '';

let lastSpriteRect = DEFAULT_SPRITE_RECT;

function clearThinkingStageTimers() {
  while (thinkingStageTimers.length) {
    clearTimeout(thinkingStageTimers.pop());
  }
}

const userDataRoot = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'HermesAgent', 'pet-overlay-electron', 'user-data')
  : path.join(os.homedir(), '.hermes-pet-overlay-electron');
app.setPath('userData', userDataRoot);
app.setName('Hermes Pets Overlay');

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.exit(0);
} else {
  app.on('second-instance', () => {
    bringOverlayToFront('second-instance');
  });
}

function debugEvent(message, ...args) {
  if (DEBUG_EVENTS) console.log(`[pet-overlay/events] ${message}`, ...args);
}

const LOG_FILE = path.join(
  process.env.LOCALAPPDATA || os.homedir(),
  'HermesAgent',
  'pet-overlay-electron',
  'hermes-pet-overlay.log',
);
const PET_MEMORY_FILE = process.env.HERMES_PET_MEMORY_FILE
  || path.join(os.homedir(), '.hermes_pet', 'pet-memory.json');
const OVERLAY_COMPANION_FILE = path.join(path.dirname(PET_MEMORY_FILE), 'overlay-companion.json');
const COMPANION_TIMEZONE = process.env.HERMES_PET_TIMEZONE || 'Asia/Shanghai';

function writeLog(...args) {
  const msg = args.map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg))).join(' ');
  const now = new Date();
  const line = `[utc=${now.toISOString()} local=${now.toLocaleString('sv-SE', { hour12: false })}] ${msg}\n`;
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch (_) {}
  console.log(...args);
}

function loadPetMemoryFile() {
  try {
    return JSON.parse(fs.readFileSync(PET_MEMORY_FILE, 'utf8'));
  } catch (_) {
    return null;
  }
}

function savePetMemoryFile(payload) {
  if (!payload || typeof payload !== 'object') return false;
  try {
    fs.mkdirSync(path.dirname(PET_MEMORY_FILE), { recursive: true });
    fs.writeFileSync(PET_MEMORY_FILE, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    writeLog('pet-memory-save', { path: PET_MEMORY_FILE, version: payload.version || 0 });
    return true;
  } catch (e) {
    writeLog(`pet-memory-save failed: ${e.message}`);
    return false;
  }
}

function loadOverlayCompanionFile() {
  try {
    return JSON.parse(fs.readFileSync(OVERLAY_COMPANION_FILE, 'utf8'));
  } catch (_) {
    return null;
  }
}

function saveOverlayCompanionFile(payload) {
  if (!payload || typeof payload !== 'object') return false;
  try {
    fs.mkdirSync(path.dirname(OVERLAY_COMPANION_FILE), { recursive: true });
    fs.writeFileSync(OVERLAY_COMPANION_FILE, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    writeLog('overlay-companion-save', { path: OVERLAY_COMPANION_FILE });
    return true;
  } catch (e) {
    writeLog(`overlay-companion-save failed: ${e.message}`);
    return false;
  }
}

function verifyEvent(type, payload = {}) {
  if (!VERIFY_FILE) return;
  try {
    fs.mkdirSync(path.dirname(VERIFY_FILE), { recursive: true });
    fs.appendFileSync(
      VERIFY_FILE,
      JSON.stringify({ type, pid: process.pid, at: new Date().toISOString(), ...payload }) + '\n',
      'utf8',
    );
  } catch (e) {
    if (DEBUG_EVENTS) console.warn(`[pet-overlay/events] verify write failed: ${e.message}`);
  }
}

function verifyRendererSnapshot(reason) {
  if (!VERIFY_FILE || !win || win.webContents.isDestroyed()) return;
  win.webContents.executeJavaScript(`
    (() => {
      const smoke = window.__hermesPetRendererSmoke;
      if (!smoke) return null;
      const state = smoke.getState();
      return {
        species: state.species || '',
        customPet: state.custom_pet && state.custom_pet.name || '',
        animation: smoke.getCurrentAnimation(),
        trayVisible: smoke.isTrayVisible(),
        trayAttention: smoke.isTrayAttention(),
        bubbleText: smoke.getBubbleText(),
        recentTypes: smoke.getRecentEvents().map((event) => event.type),
      };
    })()
  `).then((snapshot) => {
    if (snapshot) verifyEvent('renderer-snapshot', { reason, snapshot });
  }).catch((e) => {
    verifyEvent('renderer-snapshot-error', { reason, error: e.message });
  });
}

function bringOverlayToFront(reason) {
  if (!win) return;
  try {
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.showInactive();
    reassertOverlayOnTop(reason);
  } catch (e) {
    console.warn(`[pet-overlay] failed to show existing overlay after ${reason}: ${e.message}`);
  }
}

function positionFilePath() {
  return process.env.HERMES_PET_POSITION_FILE
    || path.join(os.homedir(), '.hermes', 'pet_position.json');
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

function createWindow() {
  if (win) return;

  const pos = loadPosition();
  const focusable = process.env.HERMES_PET_FOCUSABLE === '1';

  win = new BrowserWindow({
    ...WINDOW_SIZE,
    x: pos.x,
    y: pos.y,
    title: `Hermes Pets Overlay [windows ${process.pid}]`,
    transparent: true,
    frame: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable,
    hasShadow: false,
    resizable: false,
    backgroundColor: '#00000000',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer.html'), {
      query: {
        species: PET_SPECIES,
        showUpload: process.env.HERMES_PET_SHOW_UPLOAD === '1' ? '1' : '0',
        debugEvents: DEBUG_EVENTS ? '1' : '0',
        debugAnimation: DEBUG_ANIMATION ? '1' : '0',
        debugDrag: DEBUG_DRAG ? '1' : '0',
      },
  });
  notifyBridgeConnected(false);

  win.webContents.once('did-finish-load', () => {
    win.webContents.executeJavaScript(
      "document.body.classList.add('overlay-mode')",
    ).catch(() => {});
    verifyEvent('renderer-loaded');
    setTimeout(() => verifyRendererSnapshot('renderer-loaded'), 250);
  });

  win.once('ready-to-show', () => {
    reassertOverlayOnTop('ready-to-show');
    startMousePassthroughLoop();
    startTopmostReassertLoop();
    win.showInactive();
    verifyEvent('ready-to-show', { bounds: win.getBounds() });
  });

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
    if (topmostReassertTimer) clearInterval(topmostReassertTimer);
    mousePassthroughTimer = null;
    topmostReassertTimer = null;
    mousePassthrough = null;
    win = null;
  });
}

function reassertOverlayOnTop(reason, options = {}) {
  if (!win) return;
  try {
    win.setAlwaysOnTop(true, ALWAYS_ON_TOP_LEVEL);
    win.moveTop();
    if (!options.quiet) console.log(`[pet-overlay] reasserted always-on-top (${ALWAYS_ON_TOP_LEVEL}) after ${reason}`);
  } catch (e) {
    console.warn(`[pet-overlay] failed to reassert always-on-top after ${reason}: ${e.message}`);
  }
}

function startTopmostReassertLoop() {
  if (topmostReassertTimer) clearInterval(topmostReassertTimer);
  topmostReassertTimer = setInterval(() => reassertOverlayOnTop('topmost-watchdog', { quiet: true }), TOPMOST_REASSERT_INTERVAL_MS);
  topmostReassertTimer.unref?.();
}

function persistWindowPosition() {
  if (!win) return;

  const bounds = win.getBounds();
  const clamped = clampWindowToVisibleBounds(bounds.x, bounds.y, lastSpriteRect, bounds.width, bounds.height);
  if (bounds.x !== clamped.x || bounds.y !== clamped.y) {
    win.setBounds({ ...bounds, ...clamped });
  }
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
  if (dragState) {
    setMousePassthrough(false);
    return;
  }
  if (trayVisible) {
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

function defaultWindowPosition() {
  const display = screen.getPrimaryDisplay();
  const area = display.workArea || display.bounds;
  return {
    x: area.x + area.width - 200,
    y: area.y + area.height - 220,
  };
}

function clampToWorkArea(x, y, width = WINDOW_SIZE.width, height = WINDOW_SIZE.height) {
  const display = screen.getPrimaryDisplay();
  const area = display.workArea || display.bounds;
  const maxX = area.x + Math.max(0, area.width - width);
  const maxY = area.y + Math.max(0, area.height - height);
  return {
    x: Math.min(Math.max(Number.isFinite(x) ? x : area.x, area.x), maxX),
    y: Math.min(Math.max(Number.isFinite(y) ? y : area.y, area.y), maxY),
  };
}

function sanitizeSpriteRect(rect, windowWidth = WINDOW_SIZE.width, windowHeight = WINDOW_SIZE.height) {
  if (!rect || typeof rect !== 'object') return null;

  const left = Number(rect.left);
  const top = Number(rect.top);
  const width = Number(rect.width);
  const height = Number(rect.height);
  if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    return null;
  }

  const normalizedLeft = Math.min(Math.max(Math.round(left), 0), Math.max(0, windowWidth - 1));
  const normalizedTop = Math.min(Math.max(Math.round(top), 0), Math.max(0, windowHeight - 1));
  return {
    left: normalizedLeft,
    top: normalizedTop,
    width: Math.min(Math.round(width), Math.max(1, windowWidth - normalizedLeft)),
    height: Math.min(Math.round(height), Math.max(1, windowHeight - normalizedTop)),
  };
}

function clampWindowToVisibleBounds(
  x,
  y,
  spriteRect = lastSpriteRect,
  windowWidth = WINDOW_SIZE.width,
  windowHeight = WINDOW_SIZE.height,
) {
  const rect = sanitizeSpriteRect(spriteRect, windowWidth, windowHeight);
  if (!rect) return clampToWorkArea(x, y, windowWidth, windowHeight);

  const display = screen.getPrimaryDisplay();
  const area = display.workArea || display.bounds;
  const maxX = area.x + area.width - rect.left - rect.width;
  const maxY = area.y + area.height - rect.top - rect.height;
  return {
    x: Math.min(Math.max(Number.isFinite(x) ? x : area.x - rect.left, area.x - rect.left), maxX),
    y: Math.min(Math.max(Number.isFinite(y) ? y : area.y - rect.top, area.y - rect.top), maxY),
  };
}

function startWSServer() {
  const serverHost = process.env.HERMES_PET_BIND_HOST || '0.0.0.0';
  const serverPort = Number(process.env.HERMES_PET_PORT || 17473);
  wss = new WebSocket.Server({ host: serverHost, port: serverPort });

  wss.on('connection', (ws) => {
    console.log('[pet-overlay] TUI connected');
    if (tuiClient && tuiClient.readyState === WebSocket.OPEN) {
      writeLog('closing stale TUI connection');
      tuiClient.close();
    }
    tuiClient = ws;
    notifyBridgeConnected(true);

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        writeLog(`ws message type=${msg?.type || 'unknown'}`);
        debugEvent(`tui message type=${msg?.type || 'unknown'}`);
        if (win) {
          if (ws !== tuiClient) {
            writeLog('dropped stale message');
            return;
          }
          win.webContents.send('pet-event', msg);
          writeLog(`forwarded to renderer type=${msg?.type || 'unknown'}`);
          debugEvent(`forwarded to renderer type=${msg?.type || 'unknown'}`);
          verifyEvent('pet-event', {
            eventType: msg?.type || 'unknown',
            severity: msg?.severity || '',
            hasCustomPet: Boolean(msg?.custom_pet),
          });
          setTimeout(() => verifyRendererSnapshot(`pet-event:${msg?.type || 'unknown'}`), 250);
        } else {
          debugEvent(`dropped renderer event type=${msg?.type || 'unknown'} reason=no-window`);
        }
      } catch (_) {
        console.error('[pet-overlay] invalid JSON from TUI');
      }
    });

    ws.on('close', () => {
      if (tuiClient === ws) {
        tuiClient = null;
        notifyBridgeConnected(false);
      } else {
        writeLog('ignored close from stale connection');
      }
    });

    ws.on('pong', () => {});
    const interval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.ping();
    }, 30000);
    ws.on('close', () => clearInterval(interval));
  });

  console.log(`[pet-overlay] WS server listening on ${serverHost}:${serverPort}`);
}

function notifyBridgeConnected(connected) {
  if (bridgeConnected === connected) return;
  bridgeConnected = connected;
  debugEvent(`bridge connected state=${connected}`);
  writeLog(`bridge state change: connected=${connected}`);
  verifyEvent('bridge-connected', { connected });
  setTimeout(() => verifyRendererSnapshot(`bridge-connected:${connected}`), 250);
  if (win) win.webContents.send('bridge-connected', connected);
}

ipcMain.on('to-tui', (_, data) => {
  if (tuiClient && tuiClient.readyState === WebSocket.OPEN) {
    tuiClient.send(JSON.stringify(data));
  }
});

writeLog(`startup: pid=${process.pid}, platform=${process.platform}, arch=${process.arch}`);
writeLog(
  `env: HERMES_PET_BIND_HOST=${process.env.HERMES_PET_BIND_HOST}, HERMES_PET_PORT=${process.env.HERMES_PET_PORT}, HERMES_PET_WINDOWS_NODE_MODULES=${process.env.HERMES_PET_WINDOWS_NODE_MODULES}`,
);

process.on('uncaughtException', (err) => {
  writeLog(`uncaughtException: ${err.message}\n${err.stack}`);
});

process.on('unhandledRejection', (reason) => {
  writeLog(`unhandledRejection: ${reason}`);
});

if (hasSingleInstanceLock) {
  app.whenReady().then(() => {
    try {
      startWSServer();
    } catch (err) {
      writeLog(`startWSServer threw: ${err.message}\n${err.stack}`);
    }
    try {
      createWindow();
    } catch (err) {
      writeLog(`createWindow threw: ${err.message}\n${err.stack}`);
    }
  });
}

app.on('window-all-closed', () => {
  app.isQuitting = true;
  if (wss) wss.close();
  if (tuiClient) tuiClient.close();
  app.quit();
});

ipcMain.on('minimize-pet', () => {
  if (win) win.setSize(80, 80);
});

ipcMain.on('restore-pet', () => {
  if (win) win.setSize(WINDOW_SIZE.width, WINDOW_SIZE.height);
});

ipcMain.on('hide-pet', () => {
  if (win) win.hide();
});

ipcMain.on('show-pet', () => {
  if (win) {
    win.showInactive();
    reassertOverlayOnTop('show-pet');
  }
});

ipcMain.on('pet-drag-start', (_, point) => {
  if (!win) return;

  const startX = Number(point?.screenX);
  const startY = Number(point?.screenY);
  if (!Number.isFinite(startX) || !Number.isFinite(startY) || (startX === 0 && startY === 0)) {
    return;
  }

  const bounds = win.getBounds();
  lastSpriteRect = sanitizeSpriteRect(point?.spriteRect, bounds.width, bounds.height) || lastSpriteRect;
  dragState = {
    startX,
    startY,
    bounds,
    spriteRect: lastSpriteRect,
  };
  setMousePassthrough(false);
  if (DEBUG_DRAG) console.log(`[pet-overlay/drag] start ${JSON.stringify({ x: bounds.x, y: bounds.y })}`);
});

ipcMain.on('pet-drag-move', (_, point) => {
  if (!win || !dragState) return;

  const screenX = Number(point?.screenX);
  const screenY = Number(point?.screenY);
  if (!Number.isFinite(screenX) || !Number.isFinite(screenY) || (screenX === 0 && screenY === 0)) {
    return;
  }

  const nextX = dragState.bounds.x + Math.round(screenX - dragState.startX);
  const nextY = dragState.bounds.y + Math.round(screenY - dragState.startY);
  const clamped = clampWindowToVisibleBounds(
    nextX,
    nextY,
    dragState.spriteRect,
    dragState.bounds.width,
    dragState.bounds.height,
  );
  win.setPosition(clamped.x, clamped.y, false);
});

ipcMain.on('pet-drag-end', () => {
  if (!win || !dragState) return;

  dragState = null;
  persistWindowPosition();
  updateMousePassthrough();
  reassertOverlayOnTop('drag-end');
  if (DEBUG_DRAG) console.log(`[pet-overlay/drag] end ${JSON.stringify(win.getBounds())}`);
});

ipcMain.on('pet-sprite-rect', (_, rect) => {
  if (!win) return;
  const bounds = win.getBounds();
  lastSpriteRect = sanitizeSpriteRect(rect, bounds.width, bounds.height) || lastSpriteRect;
  updateMousePassthrough();
});

ipcMain.on('event-tray-visibility', (_, visible) => {
  trayVisible = !!visible;
  updateMousePassthrough();
});

ipcMain.on('renderer-log', (_, payload) => {
  if (!payload || typeof payload.message !== 'string') return;
  if (payload.extra !== undefined) {
    writeLog(`renderer: ${payload.message}`, payload.extra);
    return;
  }
  writeLog(`renderer: ${payload.message}`);
});

ipcMain.on('thinking-stage-schedule', (_event, payload) => {
  clearThinkingStageTimers();
  const token = payload && Number(payload.token);
  writeLog('thinking-stage-schedule', { token });
  [
    { delay: 30000, stage: 2, pool: 'thinking_long' },
    { delay: 120000, stage: 3, pool: 'thinking_stalled' },
  ].forEach((item) => {
    thinkingStageTimers.push(setTimeout(() => {
      if (!win || win.webContents.isDestroyed()) return;
      writeLog('thinking-stage-fire', { token, stage: item.stage, pool: item.pool });
      win.webContents.send('thinking-stage-timer', {
        token,
        stage: item.stage,
        pool: item.pool,
      });
    }, item.delay));
  });
});

ipcMain.on('thinking-stage-clear', () => {
  clearThinkingStageTimers();
});

ipcMain.on('pet-memory-load', (event) => {
  event.returnValue = loadPetMemoryFile();
});

ipcMain.on('pet-memory-save', (_event, payload) => {
  savePetMemoryFile(payload);
});

ipcMain.on('pet-memory-meta', (event) => {
  event.returnValue = { path: PET_MEMORY_FILE };
});

ipcMain.on('pet-runtime-config', (event) => {
  event.returnValue = { timezone: COMPANION_TIMEZONE };
});

ipcMain.on('overlay-companion-load', (event) => {
  event.returnValue = loadOverlayCompanionFile();
});

ipcMain.on('overlay-companion-save', (_event, payload) => {
  saveOverlayCompanionFile(payload);
});

const CUSTOM_SPRITE_DIR = path.join(os.homedir(), '.hermes');
const CUSTOM_SPRITE_PATH = path.join(CUSTOM_SPRITE_DIR, 'pet_custom.png');

function emitCustomSprite(pathOrUrl) {
  if (win) win.webContents.send('custom-sprite-set', pathOrUrl);
}

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
    const result = await require('electron').dialog.showOpenDialog(win, {
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
