import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../PromptSave/", import.meta.url));

async function walk(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(full));
    else result.push(full);
  }
  return result;
}

test("运行时代码不包含 eval/new Function 或远程脚本加载", async () => {
  const files = (await walk(root)).filter((file) => /\.(?:js|html|json)$/i.test(file));
  for (const file of files) {
    const text = await readFile(file, "utf8");
    assert.equal(/\beval\s*\(/.test(text), false, file + " contains eval()");
    assert.equal(/new\s+Function\s*\(/.test(text), false, file + " contains new Function()");
    if (/\.html$/i.test(file)) {
      assert.equal(/<script[^>]+src\s*=\s*["']https?:\/\//i.test(text), false, file + " loads remote script");
    }
  }
});

test("界面不使用 HTML 字符串注入用户内容", async () => {
  const app = await readFile(path.join(root, "ui", "app.js"), "utf8");
  assert.equal(/\.innerHTML\s*=/.test(app), false);
  assert.equal(/insertAdjacentHTML\s*\(/.test(app), false);
  assert.equal(/\.outerHTML\s*=/.test(app), false);
});

test("右键图片不会把原始签名 URL 写入收藏数据", async () => {
  const worker = await readFile(path.join(root, "background", "service-worker.js"), "utf8");
  assert.equal(worker.includes('source: { type: "image", url: srcUrl }'), false);
  assert.ok(worker.includes('source: { type: "image" }'));
});

test("MV3 CSP 不允许 unsafe-eval", async () => {
  const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
  const policy = manifest.content_security_policy.extension_pages;
  assert.equal(policy.includes("unsafe-eval"), false);
  assert.equal(policy.includes("http:"), false);
  assert.equal(policy.includes("https:"), false);
});
