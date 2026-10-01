import { appError } from "./constants.js";

const HOST = "com.promptshelf.local";
const MAX_QUEUE = 32;
const MAX_QUEUED_BYTES = 16 * 1024 * 1024;
let port = null;
let pending = null;
let running = false;
let queue = [];
let queuedBytes = 0;
let nextId = 0;
let idleTimer = null;

function connectionError() {
  return appError("DIRECTORY_UNAVAILABLE", "本地桥接连接中断，请检查桥接安装与目录；未自动重试写入");
}

function rejectQueue(error) {
  for (const job of queue) job.reject(error);
  queue = [];
  queuedBytes = 0;
}

function disconnect() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  const previous = port;
  port = null;
  if (previous) previous.disconnect();
}

function connect() {
  if (port) return port;
  const opened = chrome.runtime.connectNative(HOST);
  port = opened;
  opened.onMessage.addListener((response) => {
    if (opened !== port || !pending) return;
    if (response?.requestId !== pending.id) {
      pending.reject(appError("DIRECTORY_UNAVAILABLE", "桥接协议版本不匹配，请保留新版 native/host.py 并重新加载扩展"));
      disconnect();
      return;
    }
    pending.resolve(response);
  });
  opened.onDisconnect.addListener(() => {
    // Consume lastError; do not copy OS paths into diagnostics.
    void chrome.runtime.lastError;
    if (opened !== port) return;
    port = null;
    const error = connectionError();
    if (pending) pending.reject(error);
    rejectQueue(error);
  });
  return opened;
}

async function pump() {
  if (running) return;
  running = true;
  while (queue.length) {
    const job = queue.shift();
    queuedBytes -= job.bytes;
    let timer;
    try {
      const response = await new Promise((resolve, reject) => {
        pending = { id: ++nextId, resolve, reject };
        timer = setTimeout(() => {
          reject(connectionError());
          disconnect();
        }, job.action === "pick" ? 180000 : 30000);
        connect().postMessage({ ...job.payload, action: job.action, requestId: pending.id });
      });
      job.resolve(response);
    } catch (error) {
      job.reject(error);
      rejectQueue(error);
      disconnect();
    } finally {
      clearTimeout(timer);
      pending = null;
    }
  }
  running = false;
  // No persistent host or service-worker keepalive after a short burst of work.
  idleTimer = setTimeout(disconnect, 5000);
}

export function nativeTransport(action, payload = {}) {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  const bytes = typeof payload.base64 === "string" ? payload.base64.length : 1024;
  if (queue.length >= MAX_QUEUE || queuedBytes + bytes > MAX_QUEUED_BYTES) {
    return Promise.reject(appError("NATIVE_BUSY", "本地读写任务已达上限，请稍后重试"));
  }
  return new Promise((resolve, reject) => {
    queue.push({ action, payload, bytes, resolve, reject });
    queuedBytes += bytes;
    pump();
  });
}
