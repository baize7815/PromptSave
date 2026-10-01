import { DEBUG_ENABLED_KEY } from "../shared/debug-log.js";

const toggle = document.querySelector("#debugEnabled");
const status = document.querySelector("#debugStatus");
const stored = await chrome.storage.local.get(DEBUG_ENABLED_KEY);
toggle.checked = !!stored[DEBUG_ENABLED_KEY];

function failed(error) { status.textContent = error.message || "操作失败"; }

async function send(action, payload = {}) {
  const response = await chrome.runtime.sendMessage({ action, ...payload });
  if (!response || !response.ok) throw new Error(response?.error?.message || "后台不可用");
  return response.data;
}

toggle.addEventListener("change", () => {
  send("debug:set", { enabled: toggle.checked })
    .then(() => { status.textContent = toggle.checked ? "已开启，请复现问题后导出。" : "已关闭记录。"; }).catch(failed);
});
document.querySelector("#clearDebug").addEventListener("click", async () => {
  try {
    await send("debug:clear");
    toggle.checked = false;
    status.textContent = "记录已关闭，日志已清除。";
  } catch (error) { failed(error); }
});
document.querySelector("#exportDebug").addEventListener("click", async () => {
  try {
    const events = await send("debug:get");
    const log = { version: chrome.runtime.getManifest().version, browser: navigator.userAgent, exportedAt: new Date().toISOString(), events };
    const url = URL.createObjectURL(new Blob([JSON.stringify(log, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "promptsave-debug.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    status.textContent = "日志已导出。";
  } catch (error) { failed(error); }
});
