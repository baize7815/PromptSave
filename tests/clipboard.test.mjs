import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const ext = new URL("../PromptSave/", import.meta.url);

async function read(relative) {
  return readFile(new URL(relative, ext), "utf8");
}

test("offscreen 文档存在并加载监听脚本", async () => {
  const html = await read("offscreen/offscreen.html");
  assert.ok(html.includes('src="offscreen.js"'));
  assert.ok(!/<script[^>]+src\s*=\s*["']https?:\/\//i.test(html));
});

test("offscreen 监听通过 execCommand paste 只读图片、建立基线并按哈希去重", async () => {
  const js = await read("offscreen/offscreen.js");
  // navigator.clipboard.read() cannot work in an unfocused offscreen doc.
  assert.ok(!js.includes("navigator.clipboard.read"));
  assert.ok(js.includes('document.execCommand("paste")'));
  assert.ok(js.includes('addEventListener("paste"'));
  assert.ok(js.includes('digest("SHA-256"'));
  // Only image files are forwarded; text clipboard data is never sent.
  assert.ok(js.includes('item.kind === "file" && item.type.startsWith("image/")'));
  assert.ok(!js.includes("readText"));
  // Baseline is captured on start so a pre-existing image is not saved.
  assert.ok(js.includes("await establishBaseline()"));
  // start() delegates to a shared in-flight startup (idempotent under nudges).
  assert.ok(js.includes("starting = runStart()"));
  // New images are forwarded to the service worker.
  assert.ok(js.includes('action: "clipboard:image"'));
});

test("服务工作线程管理 offscreen 生命周期并收藏剪贴板图片", async () => {
  const sw = await read("background/service-worker.js");
  assert.ok(sw.includes("chrome.offscreen.createDocument"));
  assert.ok(sw.includes("chrome.offscreen.Reason.CLIPBOARD"));
  assert.ok(sw.includes("chrome.offscreen.closeDocument"));
  // Monitoring state lives in session storage so it resets on browser restart.
  assert.ok(sw.includes("SESSION_KEYS.clipboardListen"));
  assert.ok(sw.includes('case "clipboard:setListen"'));
  assert.ok(sw.includes('case "clipboard:image"'));
  assert.ok(sw.includes('case "clipboard:status"'));
  // Saved items are marked with the clipboard source and reuse the capture
  // pipeline (including pending-save handling for directory storage).
  assert.ok(sw.includes('source: { type: "clipboard" }'));
  assert.ok(sw.includes("saveContextCapture(item, processed.base64)"));
});

test("界面包含监听按钮与图标", async () => {
  const html = await read("dashboard.html");
  assert.ok(html.includes('id="listenBtn"'));
  const icons = await read("ui/icons.js");
  assert.ok(icons.includes("listen: ["));
  const app = await read("ui/app.js");
  assert.ok(app.includes("toggleClipboardListen"));
  assert.ok(app.includes("clipboard:setListen"));
  assert.ok(app.includes("renderListenButton"));
});
