const { contextBridge, ipcRenderer, dialog } = require('electron');

contextBridge.exposeInMainWorld('hermesPetAPI', {
  // Bridge event listener
  onPetEvent: (cb) => ipcRenderer.on('pet-event', (_, data) => cb(data)),
  onBridgeConnected: (cb) => ipcRenderer.on('bridge-connected', (_, state) => cb(state)),
  onPositionChange: (cb) => ipcRenderer.on('position-changed', (_, x, y) => cb(x, y)),

  // Actions back to main
  minimize: () => ipcRenderer.send('minimize-pet'),
  restore: () => ipcRenderer.send('restore-pet'),
  hide: () => ipcRenderer.send('hide-pet'),
  show: () => ipcRenderer.send('show-pet'),
  petDragStart: (point) => ipcRenderer.send('pet-drag-start', point),
  petDragMove: (point) => ipcRenderer.send('pet-drag-move', point),
  petDragEnd: () => ipcRenderer.send('pet-drag-end'),
  reportSpriteRect: (rect) => ipcRenderer.send('pet-sprite-rect', rect),
  setEventTrayVisibility: (visible) => ipcRenderer.send('event-tray-visibility', !!visible),
  logRenderer: (message, extra) => ipcRenderer.send('renderer-log', { message, extra }),
  scheduleThinkingStageTimers: (payload) => ipcRenderer.send('thinking-stage-schedule', payload),
  clearThinkingStageTimers: (token) => ipcRenderer.send('thinking-stage-clear', token),
  onThinkingStageTimer: (cb) => ipcRenderer.on('thinking-stage-timer', (_, data) => cb(data)),
  loadPetMemory: () => ipcRenderer.sendSync('pet-memory-load'),
  savePetMemory: (payload) => ipcRenderer.send('pet-memory-save', payload),
  getPetMemoryMeta: () => ipcRenderer.sendSync('pet-memory-meta'),
  getRuntimeConfig: () => ipcRenderer.sendSync('pet-runtime-config'),
  loadOverlayCompanionState: () => ipcRenderer.sendSync('overlay-companion-load'),
  saveOverlayCompanionState: (payload) => ipcRenderer.send('overlay-companion-save', payload),

  // Animation manifest (loaded from main process to bypass file:// fetch restrictions)
  loadManifest: () => ipcRenderer.invoke('get-pet-manifest'),

  // F1: Custom sprite upload
  saveCustomSprite: (path) => ipcRenderer.send('save-custom-sprite', path),
  pickCustomSprite: () => ipcRenderer.send('pick-custom-sprite'),
  onCustomSpriteSet: (cb) => ipcRenderer.on('custom-sprite-set', (_, path) => cb(path)),
});
