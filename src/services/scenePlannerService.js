/**
 * Scene Planner Service
 *
 * Backend-controlled scene carousel:
 *   - Every second, computes which scene each connected device should be showing
 *     based on an epoch-clock (wall-clock time mod total cycle duration).
 *   - If a device's actual scene (last sent) differs from the computed scene,
 *     emits a `scene-switch` command via Socket.IO.
 *   - Epoch-clock means all devices assigned the same scene list are always in sync,
 *     and reconnecting devices immediately receive the correct scene.
 */

const deviceSceneDao = require('../dao/deviceSceneDao');
const logger = require('../utils/logger');

/** Reference to socketService – set lazily to avoid circular require. */
let _socket = null;

/** Planner interval handle */
let _interval = null;

/**
 * Last scene we told each device to display.
 * deviceId → { sceneId: string, sceneIndex: number }
 */
const _lastSent = new Map();

/**
 * Per-device scene list cache (DB rows, enabled + sorted).
 * Cleared when config changes so the next tick re-reads from DB.
 * deviceId → [{ scene_id, duration, sort_order, ... }]
 */
const _sceneCache = new Map();

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function _loadDeviceScenes(deviceId) {
  if (_sceneCache.has(deviceId)) return _sceneCache.get(deviceId);
  try {
    const rows = await deviceSceneDao.findByDeviceId(deviceId);
    const enabled = rows.filter((r) => r.enabled !== 0);
    _sceneCache.set(deviceId, enabled);
    return enabled;
  } catch (e) {
    logger.error('ScenePlanner: failed to load device scenes', { deviceId, error: e.message });
    return [];
  }
}

/**
 * Determine which scene should be playing right now based on wall-clock time.
 * Uses epoch-seconds so all devices with the same scene list stay in sync.
 */
function _calculateCurrentScene(scenes) {
  if (!scenes || scenes.length === 0) return null;
  if (scenes.length === 1) {
    return { sceneId: scenes[0].scene_id, index: 0 };
  }

  const totalSec = scenes.reduce((sum, r) => sum + (r.duration || 15), 0);
  if (totalSec === 0) return { sceneId: scenes[0].scene_id, index: 0 };

  const elapsed = (Date.now() / 1000) % totalSec;
  let acc = 0;
  for (let i = 0; i < scenes.length; i++) {
    const dur = scenes[i].duration || 15;
    if (elapsed < acc + dur) {
      return { sceneId: scenes[i].scene_id, index: i };
    }
    acc += dur;
  }
  // Floating-point edge: return last scene
  return { sceneId: scenes[scenes.length - 1].scene_id, index: scenes.length - 1 };
}

async function _tickDevice(deviceId) {
  const scenes = await _loadDeviceScenes(deviceId);
  if (!scenes.length) return;

  const plan = _calculateCurrentScene(scenes);
  if (!plan) return;

  const last = _lastSent.get(deviceId);
  if (!last || last.sceneId !== plan.sceneId) {
    _lastSent.set(deviceId, { sceneId: plan.sceneId, sceneIndex: plan.index });
    _socket.emitToDevice(deviceId, 'scene-switch', {
      sceneId:    plan.sceneId,
      sceneIndex: plan.index,
    });
    logger.debug('ScenePlanner: scene-switch sent', { deviceId, sceneId: plan.sceneId, index: plan.index });
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Provide the socketService reference (avoids circular require at module load).
 * Must be called before startPlanner().
 */
function setSocketService(svc) {
  _socket = svc;
}

/**
 * Start the 1-second reconciliation loop.
 * Idempotent – calling again restarts the interval.
 */
function startPlanner() {
  if (_interval) clearInterval(_interval);
  _interval = setInterval(async () => {
    if (!_socket) return;
    const ids = _socket.getConnectedDevices();
    for (const deviceId of ids) {
      try {
        await _tickDevice(deviceId);
      } catch (e) {
        logger.error('ScenePlanner: tick error', { deviceId, error: e.message });
      }
    }
  }, 1000);
  logger.info('Scene planner started');
}

function stopPlanner() {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
  }
}

/**
 * Called when a device connects (or reconnects) via WebSocket.
 * Clears stale state and immediately pushes the correct scene.
 */
async function onDeviceConnect(deviceId) {
  _lastSent.delete(deviceId);
  _sceneCache.delete(deviceId); // force fresh DB read
  try {
    await _tickDevice(deviceId);
  } catch (e) {
    logger.error('ScenePlanner: onDeviceConnect error', { deviceId, error: e.message });
  }
}

/**
 * Called when a device's scene assignment or component config changes.
 * Clears cache so the planner reads fresh data, then immediately pushes.
 */
function onDeviceConfigChange(deviceId) {
  _lastSent.delete(deviceId);
  _sceneCache.delete(deviceId);
  if (!_socket) return;
  _tickDevice(deviceId).catch((e) =>
    logger.error('ScenePlanner: onDeviceConfigChange error', { deviceId, error: e.message })
  );
}

/**
 * Returns the last scene pushed to a device, or null if not yet sent.
 * { sceneId: string, sceneIndex: number }
 */
function getLastSent(deviceId) {
  return _lastSent.get(deviceId) || null;
}

module.exports = { setSocketService, startPlanner, stopPlanner, onDeviceConnect, onDeviceConfigChange, getLastSent };
