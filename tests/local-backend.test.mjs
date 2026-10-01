import test from "node:test";
import assert from "node:assert/strict";

const memory = new Map();
const getCalls = [];
const setCalls = [];
let failSetKey = null;

function normalizeKeys(keys) {
  if (keys == null) return [...memory.keys()];
  if (Array.isArray(keys)) return keys;
  if (typeof keys === "string") return [keys];
  return Object.keys(keys);
}

globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        getCalls.push(keys);
        const result = {};
        for (const key of normalizeKeys(keys)) {
          if (memory.has(key)) result[key] = structuredClone(memory.get(key));
        }
        return result;
      },
      async set(record) {
        setCalls.push(Object.keys(record));
        if (failSetKey && Object.prototype.hasOwnProperty.call(record, failSetKey)) {
          throw new Error("simulated set failure");
        }
        for (const [key, value] of Object.entries(record)) memory.set(key, structuredClone(value));
      },
      async remove(keys) {
        for (const key of normalizeKeys(keys)) memory.delete(key);
      },
      async getBytesInUse() {
        return JSON.stringify(Object.fromEntries(memory)).length;
      }
    }
  }
};

const { LocalBackend } = await import("../PromptSave/storage/local-backend.js");
const { createItem, bumpRevision, newId } = await import("../PromptSave/shared/model.js");
const { STORAGE_KEYS } = await import("../PromptSave/shared/constants.js");

test("读取条目列表不会加载图片键，修改文字也不会重写图片", async () => {
  memory.clear();
  getCalls.length = 0;
  setCalls.length = 0;

  const backend = new LocalBackend();
  const initial = await backend.loadData();
  const imageId = newId("img");
  const item = createItem({
    title: "测试",
    prompt: "原文",
    image: {
      id: imageId,
      path: "images/" + imageId + ".jpg",
      filename: "a.jpg",
      mime: "image/jpeg",
      width: 10,
      height: 10,
      bytes: 5
    }
  });

  const withItem = bumpRevision({ ...initial, items: [item] });
  // Minimal valid baseline JPEG: SOI + a baseline SOF0 segment declaring
  // 10x10 (one grayscale component) + EOI, so header inspection can read
  // dimensions instead of reporting the bytes as corrupt.
  const jpegBase64 = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x0a, 0x00, 0x0a, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9]).toString("base64");
  await backend.saveDataset(withItem, {
    previous: initial,
    imageWrites: { [imageId]: jpegBase64 }
  });

  getCalls.length = 0;
  const loaded = await backend.loadData();
  const flattenedGets = getCalls.flatMap((entry) => normalizeKeys(entry));
  assert.ok(flattenedGets.every((key) => !String(key).startsWith(STORAGE_KEYS.localImagePrefix)));
  assert.equal(loaded.items[0].prompt, "原文");

  setCalls.length = 0;
  const updatedItem = { ...loaded.items[0], prompt: "修改后的文字", updatedAt: new Date().toISOString() };
  const updated = bumpRevision({ ...loaded, items: [updatedItem] });
  await backend.saveDataset(updated, { previous: loaded });
  const flattenedSets = setCalls.flat();
  assert.ok(flattenedSets.every((key) => !String(key).startsWith(STORAGE_KEYS.localImagePrefix)));

  const image = await backend.readImage(updatedItem.image);
  assert.equal(image.status, "ok");
});

test("本地提交失败会恢复预先删除的图片并保留旧索引", async () => {
  memory.clear();
  getCalls.length = 0;
  setCalls.length = 0;
  failSetKey = null;

  const backend = new LocalBackend();
  const initial = await backend.loadData();
  const imageId = newId("img");
  const item = createItem({
    id: "item-rollback",
    title: "待删除",
    image: {
      id: imageId,
      path: "images/" + imageId + ".jpg",
      filename: "rollback.jpg",
      mime: "image/jpeg",
      width: 10,
      height: 10,
      bytes: 5
    }
  });
  // Minimal valid baseline JPEG: SOI + a baseline SOF0 segment declaring
  // 10x10 (one grayscale component) + EOI, so header inspection can read
  // dimensions instead of reporting the bytes as corrupt.
  const jpegBase64 = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x0a, 0x00, 0x0a, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9]).toString("base64");
  const before = bumpRevision({ ...initial, items: [item] });
  await backend.saveDataset(before, {
    previous: initial,
    imageWrites: { [imageId]: jpegBase64 }
  });

  const after = bumpRevision({ ...before, items: [] });
  failSetKey = STORAGE_KEYS.localMeta;
  await assert.rejects(() => backend.saveDataset(after, {
    previous: before,
    imageDeletes: [imageId]
  }));
  failSetKey = null;

  const restored = await backend.loadData();
  assert.equal(restored.items.length, 1);
  assert.equal(restored.items[0].id, "item-rollback");
  assert.equal((await backend.readImage(item.image)).status, "ok");
});
