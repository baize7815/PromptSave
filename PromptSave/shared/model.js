import { SCHEMA_VERSION, UNCLASSIFIED_ID, appError } from "./constants.js";

function clone(value) {
  return value == null ? value : structuredClone(value);
}

export function newId(prefix = "") {
  const core = globalThis.crypto && typeof globalThis.crypto.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : String(Date.now()) + "-" + Math.random().toString(16).slice(2);
  return prefix ? prefix + "-" + core : core;
}

export function nowIso() {
  return new Date().toISOString();
}

export function createEmptyData() {
  const now = nowIso();
  return {
    schemaVersion: SCHEMA_VERSION,
    datasetId: newId("dataset"),
    revision: 0,
    createdAt: now,
    updatedAt: now,
    categories: [],
    items: []
  };
}

export function generateTitleFromText(text, maxChars = 24) {
  const lines = String(text || "").split(/\r?\n/);
  const first = lines.map((line) => line.trim()).find(Boolean) || "未命名提示词";
  return Array.from(first).slice(0, maxChars).join("");
}

export function imageTitleFromUrl(url, collectedAt = new Date()) {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:", "file:"].includes(parsed.protocol)) throw new Error("no filename");
    const last = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || "").trim();
    const clean = last.replace(/\.[a-z0-9]{1,8}$/i, "").trim();
    if (clean) return Array.from(clean).slice(0, 48).join("");
  } catch (_) {
    // Fall through to timestamp title.
  }
  const pad = (value) => String(value).padStart(2, "0");
  const stamp = collectedAt.getFullYear() + "-" + pad(collectedAt.getMonth() + 1) + "-" +
    pad(collectedAt.getDate()) + " " + pad(collectedAt.getHours()) + ":" + pad(collectedAt.getMinutes());
  return "图片 " + stamp;
}

export function createItem({
  id = newId("item"),
  title,
  prompt = "",
  categoryId = UNCLASSIFIED_ID,
  image = null,
  source = null,
  createdAt = nowIso(),
  updatedAt = null,
  deletedAt = null
}) {
  return {
    id,
    title: String(title || "").trim() || "未命名",
    prompt: String(prompt == null ? "" : prompt),
    categoryId: String(categoryId || UNCLASSIFIED_ID),
    image: image ? normalizeImageRef(image, true) : null,
    source: source && typeof source === "object" ? clone(source) : null,
    createdAt,
    updatedAt: updatedAt || createdAt,
    deletedAt: deletedAt || null
  };
}

export function normalizeImageRef(image, strict = false) {
  if (!image || typeof image !== "object") return null;
  const id = String(image.id || "");
  const path = String(image.path || "");
  const filename = String(image.filename || "");
  const mime = String(image.mime || "image/jpeg");
  const width = Number(image.width || 0);
  const height = Number(image.height || 0);
  const bytes = Number(image.bytes || 0);

  const validId = /^[A-Za-z0-9_-]{1,96}$/.test(id);
  const validPath = path === "images/" + id + ".jpg";
  const validNumbers = Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0 &&
    Number.isFinite(bytes) && bytes >= 0;
  if (strict && (!validId || !validPath || mime !== "image/jpeg" || !validNumbers)) {
    throw appError("INVALID_IMAGE_REF", "图片引用格式不合法");
  }
  if (!validId || !validPath) return null;

  return {
    id,
    path,
    filename,
    mime: "image/jpeg",
    width: Math.round(width),
    height: Math.round(height),
    bytes: Math.round(bytes)
  };
}

function validateCategory(category) {
  if (!category || typeof category !== "object") throw appError("INVALID_DATASET", "分类格式错误");
  const id = String(category.id || "");
  const name = String(category.name || "").trim();
  if (!/^[A-Za-z0-9_-]{1,96}$/.test(id) || id === UNCLASSIFIED_ID || !name) {
    throw appError("INVALID_DATASET", "分类 ID 或名称不合法");
  }
  return {
    id,
    name,
    createdAt: String(category.createdAt || nowIso()),
    updatedAt: String(category.updatedAt || category.createdAt || nowIso())
  };
}

function validateItem(item) {
  if (!item || typeof item !== "object") throw appError("INVALID_DATASET", "条目格式错误");
  const id = String(item.id || "");
  if (!/^[A-Za-z0-9_-]{1,96}$/.test(id)) throw appError("INVALID_DATASET", "条目 ID 不合法");
  const categoryId = String(item.categoryId || UNCLASSIFIED_ID);
  return {
    id,
    title: String(item.title || "").trim() || "未命名",
    prompt: String(item.prompt == null ? "" : item.prompt),
    categoryId,
    image: item.image ? normalizeImageRef(item.image, true) : null,
    source: item.source && typeof item.source === "object" ? clone(item.source) : null,
    createdAt: String(item.createdAt || nowIso()),
    updatedAt: String(item.updatedAt || item.createdAt || nowIso()),
    deletedAt: item.deletedAt ? String(item.deletedAt) : null
  };
}

export function validateDataset(raw, { strict = true } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw appError("INVALID_DATASET", "数据集不是对象");
  }
  if (Number(raw.schemaVersion) !== SCHEMA_VERSION) {
    throw appError("UNSUPPORTED_SCHEMA", "不支持的数据格式版本");
  }
  const datasetId = String(raw.datasetId || "");
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(datasetId)) {
    throw appError("INVALID_DATASET", "数据集 ID 不合法");
  }
  const revision = Number(raw.revision);
  if (!Number.isInteger(revision) || revision < 0) throw appError("INVALID_DATASET", "修订号不合法");

  const categories = Array.isArray(raw.categories) ? raw.categories.map(validateCategory) : [];
  const categoryIds = new Set([UNCLASSIFIED_ID]);
  for (const category of categories) {
    if (categoryIds.has(category.id)) throw appError("INVALID_DATASET", "分类 ID 重复");
    categoryIds.add(category.id);
  }

  const items = Array.isArray(raw.items) ? raw.items.map(validateItem) : [];
  const itemIds = new Set();
  const imageIds = new Set();
  for (const item of items) {
    if (itemIds.has(item.id)) throw appError("INVALID_DATASET", "条目 ID 重复");
    itemIds.add(item.id);
    if (!categoryIds.has(item.categoryId)) {
      if (strict) throw appError("INVALID_DATASET", "条目引用了不存在的分类");
      item.categoryId = UNCLASSIFIED_ID;
    }
    if (item.image) {
      if (imageIds.has(item.image.id)) throw appError("INVALID_DATASET", "图片 ID 重复");
      imageIds.add(item.image.id);
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    datasetId,
    revision,
    createdAt: String(raw.createdAt || nowIso()),
    updatedAt: String(raw.updatedAt || nowIso()),
    categories,
    items
  };
}

export function bumpRevision(data) {
  const next = clone(data);
  next.revision = Number(next.revision || 0) + 1;
  next.updatedAt = nowIso();
  return next;
}

export function getCategoryName(data, categoryId, fallback = "") {
  if (categoryId === UNCLASSIFIED_ID) return fallback || "未分类";
  const category = data.categories.find((entry) => entry.id === categoryId);
  return category ? category.name : fallback || "未分类";
}

export function mergeDatasetMetadata(targetRaw, sourceRaw) {
  const target = validateDataset(targetRaw, { strict: false });
  const source = validateDataset(sourceRaw, { strict: false });
  const result = clone(target);

  const usedCategoryIds = new Set(result.categories.map((entry) => entry.id));
  const categoryByName = new Map(result.categories.map((entry) => [entry.name, entry]));
  const categoryMap = new Map([[UNCLASSIFIED_ID, UNCLASSIFIED_ID]]);

  for (const category of source.categories) {
    const sameName = categoryByName.get(category.name);
    if (sameName) {
      categoryMap.set(category.id, sameName.id);
      continue;
    }
    let nextId = category.id;
    if (usedCategoryIds.has(nextId) || nextId === UNCLASSIFIED_ID) nextId = newId("cat");
    const copy = { ...category, id: nextId, updatedAt: nowIso() };
    result.categories.push(copy);
    usedCategoryIds.add(nextId);
    categoryByName.set(copy.name, copy);
    categoryMap.set(category.id, nextId);
  }

  const usedItemIds = new Set(result.items.map((entry) => entry.id));
  const usedImageIds = new Set(result.items.filter((entry) => entry.image).map((entry) => entry.image.id));
  const imageIdMap = new Map();
  const itemIdMap = new Map();

  for (const item of source.items) {
    let itemId = item.id;
    if (usedItemIds.has(itemId)) itemId = newId("item");
    usedItemIds.add(itemId);
    itemIdMap.set(item.id, itemId);

    const copy = clone(item);
    copy.id = itemId;
    copy.categoryId = categoryMap.get(item.categoryId) || UNCLASSIFIED_ID;
    copy.updatedAt = nowIso();

    if (copy.image) {
      let imageId = copy.image.id;
      if (usedImageIds.has(imageId)) imageId = newId("img");
      usedImageIds.add(imageId);
      imageIdMap.set(item.image.id, imageId);
      copy.image.id = imageId;
      copy.image.path = "images/" + imageId + ".jpg";
    }

    result.items.push(copy);
  }

  result.revision = target.revision + 1;
  result.updatedAt = nowIso();
  return { data: result, imageIdMap, itemIdMap, categoryMap };
}

export function isSafeZipPath(path) {
  const value = String(path || "").replace(/\\/g, "/");
  if (!value || value.startsWith("/") || /^[A-Za-z]:\//.test(value)) return false;
  const normalized = value.endsWith("/") ? value.slice(0, -1) : value;
  if (!normalized) return false;
  const segments = normalized.split("/");
  return !segments.some((part) => part === ".." || part === "");
}

export function findItem(data, itemId) {
  return data.items.find((item) => item.id === itemId) || null;
}

export function referencedImageIds(data) {
  return new Set(data.items.filter((item) => item.image).map((item) => item.image.id));
}
