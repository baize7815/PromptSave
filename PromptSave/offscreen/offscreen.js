// Offscreen clipboard monitor.
//
// The MV3 service worker has no DOM and cannot use navigator.clipboard, so
// while the user has clicked "监听", this hidden document polls the clipboard
// once per interval and forwards newly copied images to the service worker.
//
// Why not the async Clipboard API (navigator.clipboard):
//   Its read() method requires the calling document to be focused. An
//   offscreen document can never be focused, so the call always rejects with
//   "Document is not focused" even with the clipboardRead permission.
//   Instead we focus a hidden contenteditable host and call the deprecated
//   document.execCommand("paste"); with clipboardRead it succeeds in an
//   extension document regardless of focus, synchronously firing a `paste`
//   event whose clipboardData exposes image files.
//
// Privacy model:
//   * Runs only while the session flag ps:clipboard:listen is true.
//   * Session storage is cleared on browser restart, so monitoring cannot
//   silently remain enabled.
//   * Only image/* files are forwarded; text is never inspected or sent.
//   * The first image already on the clipboard when monitoring starts is
//   treated as a baseline and is not saved.

const POLL_INTERVAL_MS = 800;
const ACCEPTED_IMAGE_MIME = /^image\/(png|jpeg|jpg|webp|gif|bmp|x-icon|vnd\.microsoft\.icon)$/i;

let pollTimer = null;
let lastHash = null; // SHA-256 of the last observed clipboard image, or null
let consecutiveFailures = 0;
let failureReported = false;
let polling = false;

// Hidden editable target for execCommand("paste").
const host = document.createElement("div");
host.contentEditable = "true";
host.setAttribute("aria-hidden", "true");
host.style.position = "fixed";
host.style.top = "-1000px";
host.style.left = "-1000px";
host.style.width = "100px";
host.style.height = "100px";
host.style.opacity = "0";
document.body.appendChild(host);

// Image captured from the latest synthetic paste event.
let capturedFile = null;
document.addEventListener("paste", (event) => {
  const items = event.clipboardData ? event.clipboardData.items : null;
  if (!items) return;
  for (const item of items) {
    if (item.kind === "file" && item.type.startsWith("image/") && ACCEPTED_IMAGE_MIME.test(item.type)) {
      const file = item.getAsFile();
      if (file && file.size >= 4) {
        capturedFile = file;
        event.preventDefault();
        return;
      }
    }
  }
});

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

async function hashBytes(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

// Reads the current clipboard image via execCommand("paste").
// Returns { hash, bytes, mime } or null when there is no image.
async function readClipboardImage() {
  capturedFile = null;
  host.replaceChildren();
  host.focus();
  let ok = false;
  try {
    ok = document.execCommand("paste");
  } catch (_) {
    ok = false;
  }
  if (!ok) {
    const error = new Error("execCommand paste denied");
    error.code = "PASTE_DENIED";
    throw error;
  }
  if (!capturedFile) return null; // clipboard held text or other non-image data
  const bytes = new Uint8Array(await capturedFile.arrayBuffer());
  return { hash: await hashBytes(bytes), bytes, mime: capturedFile.type };
}

function forwardImage(image) {
  chrome.runtime.sendMessage({
    action: "clipboard:image",
    image: {
      base64: bytesToBase64(image.bytes),
      mime: image.mime,
      bytes: image.bytes.length
    }
  }).catch((error) => console.warn("[PromptSave] failed to forward clipboard image", error));
}

function reportMonitorError(code) {
  if (failureReported) return;
  failureReported = true;
  chrome.runtime.sendMessage({
    action: "clipboard:status",
    status: { ok: false, code }
  }).catch(() => {});
}

async function pollOnce() {
  if (polling) return;
  polling = true;
  try {
    const current = await readClipboardImage();
    consecutiveFailures = 0;
    failureReported = false;
    const currentHash = current ? current.hash : null;
    if (currentHash === lastHash) return;
    lastHash = currentHash;
    if (current) forwardImage(current);
  } catch (error) {
    consecutiveFailures += 1;
    if (consecutiveFailures >= 3) reportMonitorError(error.code || "PASTE_FAILED");
  } finally {
    polling = false;
  }
}

async function establishBaseline(attempt = 0) {
  try {
    const baseline = await readClipboardImage();
    lastHash = baseline ? baseline.hash : null;
    consecutiveFailures = 0;
  } catch (error) {
    // execCommand can briefly fail while the freshly created document is
    // still settling; retry, then give up but still start the timer so the
    // monitor recovers on its first polls.
    if (attempt < 4) {
      await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
      return establishBaseline(attempt + 1);
    }
    lastHash = null;
  }
}

let starting = null;

async function runStart() {
  try {
    await establishBaseline();
    pollTimer = setInterval(() => {
      pollOnce().catch((error) => console.warn("[PromptSave] clipboard poll failed", error));
    }, POLL_INTERVAL_MS);
  } finally {
    starting = null;
  }
}

// Idempotent under concurrent nudges: concurrent start() calls share one
// in-flight startup instead of clobbering each other's baseline reads.
function start() {
  if (pollTimer) return Promise.resolve();
  if (!starting) starting = runStart();
  return starting;
}

function stop() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  lastHash = null;
  capturedFile = null;
  consecutiveFailures = 0;
  failureReported = false;
  host.replaceChildren();
}

// chrome.storage is not available in offscreen documents, so this script
// cannot self-start from session state; the service worker drives the
// lifecycle exclusively through start/stop messages. It also re-sends
// "start" during state reconciliation if the timer was reclaimed.

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.target !== "offscreen") return false;
  if (message.type === "start") {
    start()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, message: String(error && error.message || error) }));
    return true;
  }
  if (message.type === "stop") {
    stop();
    sendResponse({ ok: true });
    return false;
  }
  if (message.type === "ping") {
    sendResponse({ ok: true, running: !!pollTimer });
    return false;
  }
  return false;
});
