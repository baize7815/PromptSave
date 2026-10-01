import test from "node:test";
import assert from "node:assert/strict";

import {
  createEmptyData,
  createItem,
  generateTitleFromText,
  imageTitleFromUrl,
  isSafeZipPath,
  mergeDatasetMetadata,
  validateDataset
} from "../PromptSave/shared/model.js";
import { computePreviewSize } from "../PromptSave/shared/image.js";

test("自动标题取首个非空行且按 Unicode 字符截取", () => {
  const source = "\n   \n😀😀 你好，世界，这是一个很长的标题文本，用于测试截断\n正文";
  const title = generateTitleFromText(source, 24);
  assert.equal(Array.from(title).length, 24);
  assert.ok(title.startsWith("😀😀 你好"));
});

test("图片标题优先文件名，data URL 无文件名时回退到收藏时间", () => {
  assert.equal(imageTitleFromUrl("https://example.com/a%20b.png?x=1"), "a b");
  const fallback = imageTitleFromUrl("data:image/png;base64,AAAA", new Date("2026-10-01T03:04:00"));
  assert.match(fallback, /^图片 2026-10-01 03:04$/);
});

test("图片尺寸按横竖方形边界等比缩放且不放大", () => {
  assert.deepEqual(computePreviewSize(1920, 1080), { width: 1280, height: 720 });
  assert.deepEqual(computePreviewSize(1080, 1920), { width: 720, height: 1280 });
  assert.deepEqual(computePreviewSize(2000, 2000), { width: 720, height: 720 });
  assert.deepEqual(computePreviewSize(320, 240), { width: 320, height: 240 });
  assert.deepEqual(computePreviewSize(1920, 800), { width: 1280, height: 533 });
});

test("严格数据校验拒绝越界图片路径", () => {
  const data = createEmptyData();
  data.items.push(createItem({
    title: "x",
    image: {
      id: "img-safe",
      path: "images/img-safe.jpg",
      filename: "x.jpg",
      mime: "image/jpeg",
      width: 10,
      height: 10,
      bytes: 4
    }
  }));
  const valid = validateDataset(data, { strict: true });
  valid.items[0].image.path = "../escape.jpg";
  assert.throws(() => validateDataset(valid, { strict: true }), /图片引用格式不合法/);
});

test("合并数据集会处理条目和图片 ID 冲突并按分类名称合并", () => {
  const target = createEmptyData();
  target.categories.push({ id: "cat-a", name: "A", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  target.items.push(createItem({
    id: "item-x",
    title: "target",
    categoryId: "cat-a",
    image: {
      id: "img-x",
      path: "images/img-x.jpg",
      filename: "a.jpg",
      mime: "image/jpeg",
      width: 10,
      height: 10,
      bytes: 4
    }
  }));

  const source = createEmptyData();
  source.categories.push({ id: "cat-other", name: "A", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  source.items.push(createItem({
    id: "item-x",
    title: "source",
    categoryId: "cat-other",
    image: {
      id: "img-x",
      path: "images/img-x.jpg",
      filename: "b.jpg",
      mime: "image/jpeg",
      width: 10,
      height: 10,
      bytes: 4
    }
  }));

  const merged = mergeDatasetMetadata(target, source);
  assert.equal(merged.data.categories.length, 1);
  assert.equal(merged.data.items.length, 2);
  const imported = merged.data.items.find((item) => item.title === "source");
  assert.equal(imported.categoryId, "cat-a");
  assert.notEqual(imported.id, "item-x");
  assert.notEqual(imported.image.id, "img-x");
});

test("ZIP 路径检查拒绝绝对路径和父目录穿越", () => {
  assert.equal(isSafeZipPath("images/a.jpg"), true);
  assert.equal(isSafeZipPath("images/"), true);
  assert.equal(isSafeZipPath("../a.jpg"), false);
  assert.equal(isSafeZipPath("/images/a.jpg"), false);
  assert.equal(isSafeZipPath("C:/images/a.jpg"), false);
  assert.equal(isSafeZipPath("images/../a.jpg"), false);
});
