import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("MV3 清单使用侧边栏入口且没有全站常驻脚本", async () => {
  const text = await readFile(new URL("../PromptSave/manifest.json", import.meta.url), "utf8");
  const manifest = JSON.parse(text);
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.action.default_popup, undefined);
  assert.equal(manifest.side_panel.default_path, "dashboard.html");
  assert.equal(manifest.content_scripts, undefined);
  assert.ok(manifest.permissions.includes("storage"));
  assert.ok(manifest.permissions.includes("contextMenus"));
  assert.ok(manifest.permissions.includes("sidePanel"));
  assert.ok(manifest.permissions.includes("unlimitedStorage"));
  assert.ok(manifest.permissions.includes("clipboardRead"));
  assert.ok(manifest.permissions.includes("offscreen"));
  // http/https are granted once at install time (see SMOKE_TEST.md), while
  // file:// stays optional and is never required for normal capture.
  assert.deepEqual(manifest.host_permissions.slice().sort(), ["http://*/*", "https://*/*"].sort());
  assert.deepEqual(manifest.optional_host_permissions.slice().sort(), ["file:///*"]);
});
