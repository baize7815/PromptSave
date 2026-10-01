export const DEBUG_ENABLED_KEY = "ps:debug:enabled";
export const DEBUG_LOG_KEY = "ps:debug:events";
let logQueue = Promise.resolve();
let recordingEnabled = null;
let queuedEvents = 0;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[DEBUG_ENABLED_KEY]) recordingEnabled = !!changes[DEBUG_ENABLED_KEY].newValue;
});

export function setDebugRecording(enabled, clear = false) {
  const run = logQueue.then(async () => {
    await chrome.storage.local.set({ [DEBUG_ENABLED_KEY]: !!enabled });
    recordingEnabled = !!enabled;
    if (clear) await chrome.storage.local.remove(DEBUG_LOG_KEY);
  });
  logQueue = run.catch(() => {});
  return run;
}

export async function getDebugSnapshot() {
  await logQueue;
  const stored = await chrome.storage.local.get(DEBUG_LOG_KEY);
  return stored[DEBUG_LOG_KEY] || [];
}

export function recordDebugEvent(event, fields = {}) {
  if (recordingEnabled === false || queuedEvents >= 200) return Promise.resolve();
  queuedEvents++;
  const run = logQueue.then(async () => {
    if (recordingEnabled === null) {
      const enabled = await chrome.storage.local.get(DEBUG_ENABLED_KEY);
      recordingEnabled = !!enabled[DEBUG_ENABLED_KEY];
    }
    if (!recordingEnabled) return;
    const stored = await chrome.storage.local.get(DEBUG_LOG_KEY);
    const entry = { time: new Date().toISOString(), event: String(event) };
    // Only operational metadata. Never store prompts, image bytes, URLs or folder names.
    for (const key of ["action", "code", "stage", "kind", "storageMode", "permission", "status", "scheme", "count", "pending", "width", "height", "bytes", "durationMs", "cacheHit", "queueDepth"]) {
      if (["string", "number", "boolean"].includes(typeof fields[key])) entry[key] = fields[key];
    }
    const entries = Array.isArray(stored[DEBUG_LOG_KEY]) ? stored[DEBUG_LOG_KEY] : [];
    await chrome.storage.local.set({ [DEBUG_LOG_KEY]: [...entries, entry].slice(-200) });
  }).finally(() => { queuedEvents--; });
  logQueue = run.catch(() => {});
  return logQueue;
}
