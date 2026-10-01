import {
  CONTEXT_MENU_IDS,
  DEFAULT_SETTINGS,
  IMAGE_RULES,
  RESOURCE_RULES,
  ZIP_RULES,
  STORAGE_KEYS,
  SESSION_KEYS,
  CLIPBOARD_RULES,
  UNCLASSIFIED_ID,
  appError,
  serializeError
} from "../shared/constants.js";
import {
  bumpRevision,
  createEmptyData,
  createItem,
  findItem,
  generateTitleFromText,
  imageTitleFromUrl,
  mergeDatasetMetadata,
  newId,
  nowIso,
  validateDataset
} from "../shared/model.js";
import { processImageBlob, base64ToUint8Array } from "../shared/image.js";
import { readClickedImage } from "../shared/page-image.js";
import {
  getCandidateDirectoryHandle,
  getDirectoryHandle,
  promoteCandidateDirectoryHandle,
  queryDirectoryPermission
} from "../shared/idb-handle.js";
import { LocalBackend } from "../storage/local-backend.js";
import { DirectoryBackend } from "../storage/directory-backend.js";
import { mergeImportBundle } from "../shared/import-merge.js";
import { recordDebugEvent, setDebugRecording, getDebugSnapshot } from "../shared/debug-log.js";
import { datasetFingerprint, nativeCall } from "../shared/native-directory.js";
import { createTaskLimiter } from "../shared/task-limit.js";
import { assertBulkImageBudget } from "../shared/resource-check.js";

const localBackend = new LocalBackend();
const queueWrite = createTaskLimiter(1, RESOURCE_RULES.writeQueue, "WRITE_BUSY");
const queueImageTask = createTaskLimiter(1, RESOURCE_RULES.captureQueue, "CAPTURE_BUSY");
const queueImageRead = createTaskLimiter(RESOURCE_RULES.imageReadConcurrency, RESOURCE_RULES.imageReadQueue, "IMAGE_READ_BUSY");
const queueBulk = createTaskLimiter(1, 0, "BULK_BUSY");
const imageReads = new Map();
let readSnapshot = null;
let readingSnapshot = null;
let snapshotEpoch = 0;
let lastCacheSignature = "";
let feedbackTime = 0;

async function loadReadSnapshot(force = false) {
  if (!force && readSnapshot && Date.now() - readSnapshot.time < 5000) return readSnapshot.value;
  if (readingSnapshot) return readingSnapshot;
  const epoch = snapshotEpoch;
  const promise = loadCurrentData({ allowCache: true }).then((value) => {
    if (epoch === snapshotEpoch) readSnapshot = { time: Date.now(), value };
    return value;
  });
  readingSnapshot = promise;
  try { return await promise; }
  finally { if (readingSnapshot === promise) readingSnapshot = null; }
}

async function getSettings() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.settings);
  const stored = result[STORAGE_KEYS.settings] || {};
  return { ...DEFAULT_SETTINGS, ...stored };
}

async function updateSettings(patch) {
  const current = await getSettings();
  const allowed = {};
  for (const key of ["storageMode", "language", "theme", "view", "sort", "activeCategory", "directoryName", "pageSize"]) {
    if (Object.prototype.hasOwnProperty.call(patch || {}, key)) allowed[key] = patch[key];
  }
  const next = { ...current, ...allowed };
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: next });
  snapshotEpoch++;
  readSnapshot = null;
  readingSnapshot = null;
  if (Object.prototype.hasOwnProperty.call(allowed, "language")) installMenus(next.language);
  return next;
}

async function directoryBackend() {
  const handle = await getDirectoryHandle();
  if (!handle) throw appError("DIRECTORY_NOT_CONFIGURED", "尚未设置储存文件夹");
  return new DirectoryBackend(handle);
}

async function candidateDirectoryBackend() {
  const handle = await getCandidateDirectoryHandle();
  if (!handle) throw appError("DIRECTORY_NOT_CONFIGURED", "尚未选择新的储存文件夹");
  return new DirectoryBackend(handle);
}

async function backendForMode(mode) {
  if (mode === "directory") return directoryBackend();
  return localBackend;
}

async function directoryStatus(probe = true) {
  const handle = await getDirectoryHandle();
  if (!handle) return { configured: false, permission: "missing", name: "" };
  let permission;
  try {
    permission = probe ? await queryDirectoryPermission(handle, "readwrite") : "unknown";
  } catch (error) {
    if (handle.provider !== "native") throw error;
    permission = "unavailable";
  }
  recordDebugEvent("directory:status", { permission });
  return { configured: true, permission, name: String(handle.name || ""), provider: handle.provider || "browser" };
}

async function candidateDirectoryStatus() {
  const handle = await getCandidateDirectoryHandle();
  if (!handle) return { configured: false, permission: "missing", name: "" };
  const permission = await queryDirectoryPermission(handle, "readwrite");
  return { configured: true, permission, name: String(handle.name || "") };
}

async function cacheDirectoryData(data) {
  const signature = await datasetFingerprint(data);
  if (signature === lastCacheSignature) return;
  await chrome.storage.local.set({ [STORAGE_KEYS.directoryCache]: data });
  lastCacheSignature = signature;
}

async function getDirectoryCache() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.directoryCache);
  return result[STORAGE_KEYS.directoryCache] || null;
}

async function loadCurrentData({ allowCache = false } = {}) {
  const settings = await getSettings();
  let backend = null;
  try {
    backend = await backendForMode(settings.storageMode);
    const data = await backend.loadData();
    if (settings.storageMode === "directory") await cacheDirectoryData(data);
    return { data, backend, settings, readOnly: false };
  } catch (error) {
    if (settings.storageMode === "directory" && allowCache &&
        ["DIRECTORY_NOT_CONFIGURED", "DIRECTORY_PERMISSION_REQUIRED", "DIRECTORY_UNAVAILABLE"].includes(error.code)) {
      const cached = await getDirectoryCache();
      return {
        data: cached ? validateDataset(cached, { strict: false }) : createEmptyData(),
        backend,
        settings,
        readOnly: true,
        cacheReason: error.code
      };
    }
    throw error;
  }
}

async function mutateCurrentUnlocked(mutator) {
  const { data: previous, backend, settings } = await loadCurrentData();
  const draft = structuredClone(previous);
  const outcome = await mutator(draft, previous) || {};
  if (outcome.skip) return outcome.value || null;

  const next = bumpRevision(draft);
  await backend.saveDataset(next, {
    previous,
    imageWrites: outcome.imageWrites || {},
    imageDeletes: outcome.imageDeletes || []
  });
  if (settings.storageMode === "directory") await cacheDirectoryData(next);
  await broadcastDataChanged();
  return outcome.value || { revision: next.revision };
}

async function mutateCurrent(mutator) {
  return queueWrite(() => mutateCurrentUnlocked(mutator));
}

async function broadcastDataChanged() {
  snapshotEpoch++;
  readSnapshot = null;
  readingSnapshot = null;
  try {
    await chrome.runtime.sendMessage({ event: "dataChanged" });
  } catch (_) {
    // No open dashboard is a normal state.
  }
}

function categoryExists(data, categoryId) {
  return categoryId === UNCLASSIFIED_ID || data.categories.some((entry) => entry.id === categoryId);
}

function resolveItemCategory(draft, input) {
  if (!Object.prototype.hasOwnProperty.call(input, "categoryName")) {
    return categoryExists(draft, input.categoryId) ? input.categoryId : UNCLASSIFIED_ID;
  }
  const name = String(input.categoryName || "").trim();
  if (!name) return UNCLASSIFIED_ID;
  if (name.length > 60) throw appError("INVALID_CATEGORY", "分类名称不能超过 60 个字符");
  const existing = draft.categories.find((entry) => entry.name === name);
  if (existing) return existing.id;
  const stamp = nowIso();
  const category = { id: newId("cat"), name, createdAt: stamp, updatedAt: stamp };
  draft.categories.push(category);
  return category.id;
}

function preparedImageToRef(image) {
  if (!image || !image.base64) return { ref: null, write: null };
  const id = newId("img");
  return {
    ref: {
      id,
      path: "images/" + id + ".jpg",
      filename: String(image.filename || ""),
      mime: "image/jpeg",
      width: Number(image.width || 0),
      height: Number(image.height || 0),
      bytes: Number(image.bytes || 0)
    },
    write: { id, base64: String(image.base64) }
  };
}

async function addPreparedItemUnlocked(input, fixedItem = null) {
  const imagePrepared = fixedItem ? null : preparedImageToRef(input.image);
  const item = fixedItem || createItem({
    id: input.id || newId("item"),
    title: input.title || generateTitleFromText(input.prompt || ""),
    prompt: input.prompt || "",
    categoryId: input.categoryId || UNCLASSIFIED_ID,
    image: imagePrepared ? imagePrepared.ref : null,
    source: input.source || null
  });

  return mutateCurrentUnlocked((draft) => {
    if (draft.items.some((entry) => entry.id === item.id)) {
      return { skip: true, value: { id: item.id, duplicate: true } };
    }
    item.categoryId = fixedItem
      ? (categoryExists(draft, item.categoryId) ? item.categoryId : UNCLASSIFIED_ID)
      : resolveItemCategory(draft, input);
    draft.items.push(item);
    const imageWrites = {};
    if (fixedItem && input.imageBase64 && item.image) imageWrites[item.image.id] = input.imageBase64;
    if (!fixedItem && imagePrepared && imagePrepared.write) imageWrites[imagePrepared.write.id] = imagePrepared.write.base64;
    return { imageWrites, value: { id: item.id } };
  });
}

async function addPreparedItem(input, fixedItem = null) {
  return queueWrite(() => addPreparedItemUnlocked(input, fixedItem));
}

async function updateItem(input) {
  return mutateCurrent((draft) => {
    const item = findItem(draft, input.id);
    if (!item) throw appError("ITEM_NOT_FOUND", "条目不存在");
    const imageWrites = {};
    const imageDeletes = [];

    if (Object.prototype.hasOwnProperty.call(input, "title")) {
      item.title = String(input.title || "").trim() || "未命名";
    }
    if (Object.prototype.hasOwnProperty.call(input, "prompt")) {
      item.prompt = String(input.prompt == null ? "" : input.prompt);
    }
    if (Object.prototype.hasOwnProperty.call(input, "categoryId") || Object.prototype.hasOwnProperty.call(input, "categoryName")) {
      item.categoryId = resolveItemCategory(draft, input);
    }
    if (input.image && input.image.base64) {
      const nextImage = preparedImageToRef(input.image);
      if (item.image) imageDeletes.push(item.image.id);
      item.image = nextImage.ref;
      imageWrites[nextImage.write.id] = nextImage.write.base64;
    }

    item.updatedAt = nowIso();
    return { imageWrites, imageDeletes, value: { id: item.id } };
  });
}

async function softDeleteItems(ids) {
  const set = new Set((ids || []).map(String));
  return mutateCurrent((draft) => {
    const stamp = nowIso();
    let count = 0;
    for (const item of draft.items) {
      if (set.has(item.id) && !item.deletedAt) {
        item.deletedAt = stamp;
        item.updatedAt = stamp;
        count += 1;
      }
    }
    if (!count) return { skip: true, value: { count: 0 } };
    return { value: { count } };
  });
}

async function restoreItem(id) {
  return mutateCurrent((draft) => {
    const item = findItem(draft, id);
    if (!item) throw appError("ITEM_NOT_FOUND", "条目不存在");
    if (!item.deletedAt) return { skip: true, value: { id } };
    if (!categoryExists(draft, item.categoryId)) item.categoryId = UNCLASSIFIED_ID;
    item.deletedAt = null;
    item.updatedAt = nowIso();
    return { value: { id } };
  });
}

async function permanentDeleteOne(id) {
  return queueWrite(async () => {
    const { data: previous, backend, settings } = await loadCurrentData();
    const item = findItem(previous, id);
    if (!item) return { id, missing: true };

    const draft = structuredClone(previous);
    const index = draft.items.findIndex((entry) => entry.id === id);
    if (index >= 0) draft.items.splice(index, 1);
    const next = bumpRevision(draft);
    await backend.saveDataset(next, {
      previous,
      imageDeletes: item.image ? [item.image.id] : []
    });
    if (settings.storageMode === "directory") await cacheDirectoryData(next);
    await broadcastDataChanged();
    return { id };
  });
}

async function emptyTrash() {
  const { data } = await loadCurrentData();
  const ids = data.items.filter((item) => item.deletedAt).map((item) => item.id);
  const completed = [];
  const failed = [];
  for (const id of ids) {
    try {
      await permanentDeleteOne(id);
      completed.push(id);
    } catch (error) {
      failed.push({ id, error: serializeError(error) });
    }
  }
  return { completed: completed.length, failed };
}

async function bulkMoveCategory(ids, categoryId) {
  const set = new Set((ids || []).map(String));
  return mutateCurrent((draft) => {
    if (!categoryExists(draft, categoryId)) throw appError("CATEGORY_NOT_FOUND", "分类不存在");
    let count = 0;
    for (const item of draft.items) {
      if (set.has(item.id)) {
        item.categoryId = categoryId;
        item.updatedAt = nowIso();
        count += 1;
      }
    }
    if (!count) return { skip: true, value: { count: 0 } };
    return { value: { count } };
  });
}

async function addCategory(input) {
  return mutateCurrent((draft) => {
    const name = String(input.name || "").trim();
    if (!name) throw appError("INVALID_CATEGORY", "分类名称不能为空");
    if (draft.categories.some((entry) => entry.name === name)) throw appError("CATEGORY_EXISTS", "分类名称已存在");
    const id = String(input.id || newId("cat"));
    if (id === UNCLASSIFIED_ID || draft.categories.some((entry) => entry.id === id)) {
      throw appError("CATEGORY_EXISTS", "分类 ID 已存在");
    }
    const stamp = nowIso();
    draft.categories.push({ id, name, createdAt: stamp, updatedAt: stamp });
    return { value: { id } };
  });
}

async function renameCategory(id, name) {
  return mutateCurrent((draft) => {
    const category = draft.categories.find((entry) => entry.id === id);
    if (!category) throw appError("CATEGORY_NOT_FOUND", "分类不存在");
    const nextName = String(name || "").trim();
    if (!nextName) throw appError("INVALID_CATEGORY", "分类名称不能为空");
    if (draft.categories.some((entry) => entry.id !== id && entry.name === nextName)) {
      throw appError("CATEGORY_EXISTS", "分类名称已存在");
    }
    category.name = nextName;
    category.updatedAt = nowIso();
    return { value: { id } };
  });
}

async function deleteCategory(id) {
  return mutateCurrent((draft) => {
    const index = draft.categories.findIndex((entry) => entry.id === id);
    if (index < 0) throw appError("CATEGORY_NOT_FOUND", "分类不存在");
    draft.categories.splice(index, 1);
    let moved = 0;
    for (const item of draft.items) {
      if (item.categoryId === id) {
        item.categoryId = UNCLASSIFIED_ID;
        item.updatedAt = nowIso();
        moved += 1;
      }
    }
    return { value: { id, moved } };
  });
}

async function getImageForItem(id) {
  const { data, backend, settings } = await loadReadSnapshot();
  const item = findItem(data, id);
  if (!item || !item.image) return { status: "missing", base64: null };
  if (!backend) return { status: "unavailable", base64: null };
  const key = [settings.storageMode, backend.handle?.rootId || backend.handle?.name || "", data.datasetId, item.image.id].join(":");
  if (imageReads.has(key)) return imageReads.get(key);
  const request = queueImageRead(() => backend.readImage(item.image));
  imageReads.set(key, request);
  try { return await request; }
  finally { if (imageReads.get(key) === request) imageReads.delete(key); }
}

async function checkImages(ids, deep = false) {
  const { data, backend, settings } = await loadReadSnapshot(true);
  const idSet = new Set((ids || []).map(String));
  const refs = data.items.filter((item) => idSet.has(item.id) && item.image).map((item) => item.image);
  if (!refs.length) return {};
  if (!backend) return Object.fromEntries(refs.map((ref) => [ref.id, "unavailable"]));
  if (settings.storageMode !== "directory") return backend.checkImages(refs);
  return backend.checkImages(refs, { deep: !!deep });
}

async function getState(force = false) {
  const loaded = await loadReadSnapshot(force);
  const status = await directoryStatus(loaded.settings.storageMode === "directory");
  const pending = await pendingCount();
  const clipboardListening = await getClipboardListening();
  if (clipboardListening) {
    if (!(await hasOffscreenDocument())) {
      // Service worker restarted or the browser reclaimed the document; recreate
      // it. The new document self-starts from session state.
      try { await createOffscreenDocument(); await nudgeOffscreenStart(); } catch (error) {
        await recordDebugEvent("clipboard:reconcileFailed", { code: error.code || error.name });
      }
    } else if (!(await pingOffscreen())) {
      // Document exists but its timer stopped; restart it.
      await nudgeOffscreenStart();
    }
  }
  const feedback = await chrome.storage.session.get("ps:captureFeedback").catch(() => ({}));
  return {
    data: loaded.data,
    settings: loaded.settings,
    directory: status,
    pendingCount: pending,
    clipboardListening,
    captureFeedback: feedback["ps:captureFeedback"] || null,
    readOnly: loaded.readOnly || false,
    cacheReason: loaded.cacheReason || null
  };
}

async function inspectDirectory() {
  const backend = await candidateDirectoryBackend();
  const status = await candidateDirectoryStatus();
  if (status.permission !== "granted" && status.permission !== "unknown") {
    throw appError("DIRECTORY_PERMISSION_REQUIRED", "目录需要授权");
  }
  const hasData = await backend.hasExistingData();
  const rootId = backend.handle.provider === "native" ? backend.handle.rootId : null;
  if (!hasData) return { hasData: false, name: status.name, count: 0, rootId };
  const data = await backend.loadData();
  return {
    hasData: true,
    rootId,
    fingerprint: rootId ? await datasetFingerprint(data) : null,
    name: status.name,
    count: data.items.length,
    datasetId: data.datasetId,
    revision: data.revision
  };
}

async function collectImages(backend, data) {
  const images = {};
  const missing = [];
  let totalBytes = 0;
  for (const item of data.items) {
    if (!item.image || Object.prototype.hasOwnProperty.call(images, item.image.id)) continue;
    const result = await backend.readImage(item.image);
    if (result.status === "ok") {
      totalBytes += Math.ceil(result.base64.length * 3 / 4);
      assertBulkImageBudget(totalBytes);
      images[item.image.id] = result.base64;
    }
    else missing.push({ id: item.image.id, status: result.status });
  }
  return { images, missing };
}

async function verifyCopiedDataset(backend, expectedData, imageIds) {
  const expected = validateDataset(expectedData, { strict: false });
  const actual = await backend.loadData();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw appError("MIGRATION_VERIFY_FAILED", "目标存储的数据核对失败");
  }

  const expectedIds = new Set(imageIds || []);
  const refs = actual.items
    .filter((item) => item.image && expectedIds.has(item.image.id))
    .map((item) => item.image);
  if (!refs.length) return actual;

  const statuses = await backend.checkImages(refs, { deep: true });
  const failed = refs.filter((ref) => statuses[ref.id] !== "ok");
  if (failed.length) {
    throw appError("MIGRATION_VERIFY_FAILED", "目标存储的图片核对失败", {
      imageIds: failed.map((ref) => ref.id)
    });
  }
  return actual;
}

async function assertLocalCapacity(data, images) {
  if (!navigator.storage || typeof navigator.storage.estimate !== "function") return;
  const estimate = await navigator.storage.estimate();
  if (!Number.isFinite(estimate.quota) || !Number.isFinite(estimate.usage)) return;

  const metadataBytes = new TextEncoder().encode(JSON.stringify(data)).byteLength;
  let imageBytes = 0;
  for (const base64 of Object.values(images || {})) {
    const value = String(base64 || "");
    imageBytes += Math.floor(value.length * 0.75);
  }
  const required = metadataBytes + imageBytes;
  const available = Math.max(0, estimate.quota - estimate.usage);
  if (required > available * 0.9) {
    throw appError("LOCAL_STORAGE_CAPACITY", "本地可用空间不足，未切换存储", {
      required,
      available
    });
  }
}

async function configureDirectory(strategy, expectedRootId = null) {
  return queueWrite(async () => {
    const settings = await getSettings();
    const destinationHandle = await getCandidateDirectoryHandle();
    if (!destinationHandle) throw appError("DIRECTORY_NOT_CONFIGURED", "尚未选择新的储存文件夹");
    if (destinationHandle.provider === "native" && destinationHandle.rootId !== expectedRootId) {
      throw appError("DIRECTORY_CHOICE_CHANGED", "待连接目录已被其他窗口改变，请重新选择");
    }

    if (settings.storageMode === "directory") {
      const activeHandle = await getDirectoryHandle();
      if (activeHandle && typeof activeHandle.isSameEntry === "function") {
        try {
          if (await activeHandle.isSameEntry(destinationHandle)) strategy = "use";
        } catch (_) {
          // If the browser cannot compare entries, continue with the explicit strategy.
        }
      }
    }

    const destination = new DirectoryBackend(destinationHandle);
    await destination.assertWritable();
    const status = await candidateDirectoryStatus();
    const hasData = await destination.hasExistingData();

    if (hasData && strategy === "use") {
      const data = await destination.loadData();
      await promoteCandidateDirectoryHandle();
      await cacheDirectoryData(data);
      await updateSettings({ storageMode: "directory", directoryName: status.name });
      await flushPendingInternal();
      await broadcastDataChanged();
      return { mode: "directory", strategy: "use", count: data.items.length };
    }

    const sourceBackend = await backendForMode(settings.storageMode);
    const sourceData = await sourceBackend.loadData();

    if (!hasData) {
      const copied = structuredClone(sourceData);
      copied.revision = sourceData.revision + 1;
      copied.updatedAt = nowIso();
      const collected = await collectImages(sourceBackend, sourceData);
      await destination.saveDataset(copied, {
        previous: null,
        imageWrites: collected.images
      });
      await verifyCopiedDataset(destination, copied, Object.keys(collected.images));
      await promoteCandidateDirectoryHandle();
      await cacheDirectoryData(copied);
      await updateSettings({ storageMode: "directory", directoryName: status.name });
      await flushPendingInternal();
      await broadcastDataChanged();
      return { mode: "directory", strategy: "migrate", count: copied.items.length, missing: collected.missing };
    }

    if (strategy !== "merge") throw appError("DIRECTORY_CHOICE_REQUIRED", "目录已有数据，请选择使用或合并");

    const targetData = await destination.loadData();
    if (targetData.datasetId === sourceData.datasetId) {
      await promoteCandidateDirectoryHandle();
      await cacheDirectoryData(targetData);
      await updateSettings({ storageMode: "directory", directoryName: status.name });
      await flushPendingInternal();
      await broadcastDataChanged();
      return { mode: "directory", strategy: "use", count: targetData.items.length };
    }
    const merged = mergeDatasetMetadata(targetData, sourceData);
    const writes = {};
    const missing = [];
    for (const item of sourceData.items) {
      if (!item.image) continue;
      const result = await sourceBackend.readImage(item.image);
      if (result.status === "ok") {
        const targetImageId = merged.imageIdMap.get(item.image.id) || item.image.id;
        writes[targetImageId] = result.base64;
      } else {
        missing.push({ id: item.image.id, status: result.status });
      }
    }
    await destination.saveDataset(merged.data, { previous: targetData, imageWrites: writes });
    await verifyCopiedDataset(destination, merged.data, Object.keys(writes));
    await promoteCandidateDirectoryHandle();
    await cacheDirectoryData(merged.data);
    await updateSettings({ storageMode: "directory", directoryName: status.name });
    await flushPendingInternal();
    await broadcastDataChanged();
    return { mode: "directory", strategy: "merge", count: merged.data.items.length, missing };
  });
}

async function switchToLocal() {
  return queueWrite(async () => {
    const settings = await getSettings();
    if (settings.storageMode === "local") return { mode: "local", already: true };
    const source = await directoryBackend();
    const data = await source.loadData();
    const collected = await collectImages(source, data);
    await localBackend.assertWritable();
    await assertLocalCapacity(data, collected.images);
    await localBackend.replaceDataset(data, collected.images, { backup: true });
    await verifyCopiedDataset(localBackend, data, Object.keys(collected.images));
    await updateSettings({ storageMode: "local" });
    await broadcastDataChanged();
    return { mode: "local", count: data.items.length, missing: collected.missing };
  });
}

async function clearLocalLibrary() {
  return queueBulk(async () => {
    const settings = await getSettings();
    const stored = await chrome.storage.local.get(null);
    const exactKeys = new Set([
      STORAGE_KEYS.localMeta,
      STORAGE_KEYS.localRecovery,
      STORAGE_KEYS.directoryCache,
      STORAGE_KEYS.pendingIndex,
      "ps:native:candidate"
    ]);
    const prefixes = [
      STORAGE_KEYS.localItemPrefix,
      STORAGE_KEYS.localImagePrefix,
      STORAGE_KEYS.pendingPrefix
    ];
    const removed = Object.keys(stored).filter((key) =>
      exactKeys.has(key) || prefixes.some((prefix) => key.startsWith(prefix))
    );
    // Kept on purpose: ps:settings (mode/language/theme/folder name),
    // ps:native:directory (the external folder link), ps:debug:* logs and the
    // IndexedDB browser-folder handle. Files inside a connected data folder are
    // never touched by this operation.
    const previousIds = stored[STORAGE_KEYS.localMeta]?.itemIds;
    if (removed.length) await chrome.storage.local.remove(removed);
    snapshotEpoch++;
    readSnapshot = null;
    readingSnapshot = null;
    await broadcastDataChanged();
    return {
      mode: settings.storageMode,
      removedKeys: removed.length,
      localItems: Array.isArray(previousIds) ? previousIds.length : 0
    };
  });
}

async function exportBundle() {
  const { data, backend } = await loadCurrentData();
  const images = {};
  const missing = [];
  let totalBytes = new TextEncoder().encode(JSON.stringify(data, null, 2)).byteLength;
  for (const item of data.items) {
    if (!item.image || Object.prototype.hasOwnProperty.call(images, item.image.path)) continue;
    const result = await backend.readImage(item.image);
    if (result.status === "ok") {
      totalBytes += Math.ceil(result.base64.length * 3 / 4) + 256;
      if (totalBytes > ZIP_RULES.maxExportBytes) throw appError("ZIP_EXPORT_TOO_LARGE", "导出内容超过 32 MiB 安全上限，请拆分数据集");
      images[item.image.path] = result.base64;
    }
    else missing.push({ path: item.image.path, status: result.status });
  }
  return { data, images, missing };
}

async function applyImport(bundle, mode) {
  return queueWrite(async () => {
    const imported = validateDataset(bundle.data, { strict: true });
    const incomingByPath = bundle.images || {};
    const { data: current, backend, settings } = await loadCurrentData();

    if (mode === "merge") {
      const merged = await mergeImportBundle(current, imported, incomingByPath, backend);
      if (!merged.added && !merged.repaired && !merged.categoriesAdded) {
        return { mode: "merge", count: current.items.length, added: 0, skipped: merged.skipped, repaired: 0 };
      }
      await backend.saveDataset(merged.data, { previous: current, imageWrites: merged.imageWrites });
      if (settings.storageMode === "directory") await cacheDirectoryData(merged.data);
      await broadcastDataChanged();
      return { mode: "merge", count: merged.data.items.length, added: merged.added, skipped: merged.skipped, repaired: merged.repaired };
    }

    const next = structuredClone(imported);
    next.revision = current.revision + 1;
    next.updatedAt = nowIso();
    const imageMap = {};
    for (const item of next.items) {
      if (!item.image) continue;
      const importedPath = item.image.path;
      const base64 = incomingByPath[importedPath] || null;
      const replacementId = newId("img");
      item.image.id = replacementId;
      item.image.path = "images/" + replacementId + ".jpg";
      if (base64) imageMap[replacementId] = base64;
    }
    await backend.replaceDataset(next, imageMap, { backup: true });
    if (settings.storageMode === "directory") await cacheDirectoryData(next);
    await broadcastDataChanged();
    return { mode: "replace", count: next.items.length };
  });
}

async function addPending(operation) {
  const id = String(operation.id || newId("pending"));
  const key = STORAGE_KEYS.pendingPrefix + id;
  const result = await chrome.storage.local.get(STORAGE_KEYS.pendingIndex);
  const index = Array.isArray(result[STORAGE_KEYS.pendingIndex]) ? result[STORAGE_KEYS.pendingIndex] : [];
  if (!index.includes(id) && index.length >= RESOURCE_RULES.pendingCount) {
    throw appError("PENDING_FULL", "待保存内容已达 50 条，请先恢复目录并重试保存");
  }
  const existingKeys = index.map((entry) => STORAGE_KEYS.pendingPrefix + entry);
  const existingBytes = existingKeys.length ? await chrome.storage.local.getBytesInUse(existingKeys) : 0;
  const incomingBytes = new TextEncoder().encode(JSON.stringify(operation)).byteLength;
  if (existingBytes + incomingBytes > RESOURCE_RULES.pendingBytes) {
    throw appError("PENDING_FULL", "待保存内容已达 12 MiB 上限，请先恢复目录并重试保存");
  }
  if (!index.includes(id)) index.push(id);
  await chrome.storage.local.set({
    [key]: { ...operation, id },
    [STORAGE_KEYS.pendingIndex]: index
  });
  return id;
}

async function removePending(id) {
  const result = await chrome.storage.local.get(STORAGE_KEYS.pendingIndex);
  const index = Array.isArray(result[STORAGE_KEYS.pendingIndex]) ? result[STORAGE_KEYS.pendingIndex] : [];
  await chrome.storage.local.remove(STORAGE_KEYS.pendingPrefix + id);
  await chrome.storage.local.set({ [STORAGE_KEYS.pendingIndex]: index.filter((entry) => entry !== id) });
}

async function pendingCount() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.pendingIndex);
  return Array.isArray(result[STORAGE_KEYS.pendingIndex]) ? result[STORAGE_KEYS.pendingIndex].length : 0;
}

async function flushPendingInternal() {
  const settings = await getSettings();
  if (settings.storageMode !== "directory") return { completed: 0, remaining: await pendingCount() };
  const stored = await chrome.storage.local.get(STORAGE_KEYS.pendingIndex);
  const ids = stored[STORAGE_KEYS.pendingIndex] || [];
  let completed = 0;
  for (const id of ids) {
    const record = await chrome.storage.local.get(STORAGE_KEYS.pendingPrefix + id);
    const operation = record[STORAGE_KEYS.pendingPrefix + id];
    if (!operation) continue;
    if (operation.type !== "capture" || !operation.item) continue;
    try {
      await addPreparedItemUnlocked({ imageBase64: operation.imageBase64 || null }, operation.item);
      await removePending(operation.id);
      completed += 1;
    } catch (error) {
      if (["DIRECTORY_PERMISSION_REQUIRED", "EXTERNAL_CHANGE", "DIRECTORY_UNAVAILABLE"].includes(error.code)) break;
    }
  }
  return { completed, remaining: await pendingCount() };
}

async function flushPending() {
  return queueWrite(() => flushPendingInternal());
}

async function saveContextCapture(item, imageBase64 = null) {
  return queueWrite(async () => {
    const settings = await getSettings();
    await recordDebugEvent("capture:save", { storageMode: settings.storageMode });
    if (settings.storageMode !== "directory") return addPreparedItemUnlocked({ imageBase64 }, item);
    // Index changes and commits share the same queue; simultaneous captures cannot lose pending IDs.
    const pendingId = await addPending({ type: "capture", item, imageBase64 });
    await recordDebugEvent("capture:save", { stage: "pending_stored" });
    const result = await addPreparedItemUnlocked({ imageBase64 }, item);
    await removePending(pendingId);
    return result;
  });
}

async function downloadImage(srcUrl) {
  if (srcUrl.startsWith("data:") && srcUrl.length > IMAGE_RULES.maxInputBytes * 4 / 3 + 1024) {
    throw appError("IMAGE_TOO_LARGE", "内嵌图片地址超过 12 MiB 输入限制");
  }
  const response = await fetch(srcUrl, { credentials: "include", cache: "no-store", signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw appError("IMAGE_DOWNLOAD_FAILED", "图片下载失败：" + response.status);
  if (Number(response.headers.get("content-length")) > IMAGE_RULES.maxInputBytes) throw appError("IMAGE_TOO_LARGE", "原图超过 12 MiB 限制");
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > IMAGE_RULES.maxInputBytes) {
        await reader.cancel();
        throw appError("IMAGE_TOO_LARGE", "原图超过 12 MiB 限制");
      }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  return processImageBlob(new Blob(chunks, { type: response.headers.get("content-type") || "" }));
}

async function fetchAndProcessImage(srcUrl, info, tab) {
  if (!/^(https?:|file:|data:|blob:)/i.test(srcUrl)) throw appError("IMAGE_URL_UNSUPPORTED", "图片地址类型不支持，请手动选择图片");
  if (!srcUrl.startsWith("blob:")) {
    try {
      await recordDebugEvent("capture:image", { stage: "download", scheme: srcUrl.split(":")[0] });
      return await downloadImage(srcUrl);
    } catch (error) {
      await recordDebugEvent("capture:image", { stage: "download_failed", code: error.code || error.name });
      if (["IMAGE_TOO_LARGE", "IMAGE_DIMENSIONS_TOO_LARGE", "IMAGE_OUTPUT_TOO_LARGE"].includes(error.code)) throw error;
    }
  }
  if (!tab || !Number.isInteger(tab.id)) throw appError("IMAGE_DOWNLOAD_FAILED", "图片下载失败，请手动选择图片");
  await recordDebugEvent("capture:image", { stage: "page_fallback" });
  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [Number.isInteger(info.frameId) ? info.frameId : 0] },
      func: readClickedImage,
      args: [srcUrl, IMAGE_RULES]
    });
  } catch (_) {
    throw appError("PAGE_IMAGE_UNAVAILABLE", "无法读取此页面中的图片，请在添加窗口手动选择或粘贴图片");
  }
  const result = results && results[0] && results[0].result;
  if (!result || !result.base64) {
    throw appError(result && result.error || "PAGE_IMAGE_UNAVAILABLE", "图片无法读取或超过尺寸限制，请手动选择图片");
  }
  return result;
}

async function publishCaptureFeedback(kind, message, code = "") {
  feedbackTime = Math.max(Date.now(), feedbackTime + 1);
  const feedback = { id: newId("feedback"), time: feedbackTime, kind, message, code };
  try { await chrome.storage.session.set({ "ps:captureFeedback": feedback }); } catch (_) { /* Feedback must not turn a committed save into a reported failure. */ }
  try { await chrome.runtime.sendMessage({ event: "captureFeedback", feedback }); } catch (_) { /* Dashboard may be closed. */ }
}

async function showBadge(ok, message) {
  try {
    await chrome.action.setBadgeBackgroundColor({ color: ok ? "#2f855a" : "#c53030" });
    await chrome.action.setBadgeText({ text: ok ? "✓" : "!" });
    await chrome.action.setTitle({ title: message || (ok ? "收藏成功" : "收藏失败") });
    setTimeout(() => {
      chrome.action.setBadgeText({ text: "" }).catch(() => {});
      chrome.action.setTitle({ title: "PromptSave" }).catch(() => {});
    }, 1800);
  } catch (_) {
    // Badge feedback is best effort after the actual storage result is known.
  }
}

async function getClipboardListening() {
  const result = await chrome.storage.session.get(SESSION_KEYS.clipboardListen);
  return !!result[SESSION_KEYS.clipboardListen];
}

async function hasOffscreenDocument() {
  if (chrome.runtime.getContexts && chrome.runtime.ContextType) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT]
    });
    return contexts.length > 0;
  }
  return false;
}

async function createOffscreenDocument() {
  await chrome.offscreen.createDocument({
    url: CLIPBOARD_RULES.offscreenUrl,
    reasons: [chrome.offscreen.Reason.CLIPBOARD],
    justification: "监听剪贴板中的图片，复制图片后自动收藏；仅在你点击“监听”期间运行。"
  });
}

async function ensureOffscreenDocument() {
  if (!(await hasOffscreenDocument())) await createOffscreenDocument();
}

async function pingOffscreen() {
  try {
    const reply = await chrome.runtime.sendMessage({ target: "offscreen", type: "ping" });
    return !!(reply && reply.running);
  } catch (_) {
    return false;
  }
}

// The offscreen document's listener may not be registered immediately after
// createDocument resolves, and its self-start can briefly race; nudge until
// it confirms the poll timer is running.
async function nudgeOffscreenStart() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (await pingOffscreen()) return true;
    try { await chrome.runtime.sendMessage({ target: "offscreen", type: "start" }); } catch (_) { /* Listener not ready yet. */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return pingOffscreen();
}

async function setClipboardListening(enabled) {
  const next = !!enabled;
  await chrome.storage.session.set({ [SESSION_KEYS.clipboardListen]: next });
  if (next) {
    await ensureOffscreenDocument();
    await nudgeOffscreenStart();
  } else {
    try { await chrome.runtime.sendMessage({ target: "offscreen", type: "stop" }); } catch (_) { /* No document is a normal state. */ }
    if (await hasOffscreenDocument()) {
      try { await chrome.offscreen.closeDocument(); } catch (_) { /* Best effort. */ }
    }
  }
  return { listening: next };
}

async function handleClipboardImageCapture(payload) {
  const data = payload || {};
  const mime = CLIPBOARD_RULES.acceptedImageMime.test(data.mime) ? String(data.mime).toLowerCase() : "image/png";
  if (!data.base64) throw appError("CLIPBOARD_IMAGE_EMPTY", "剪贴板中没有可收藏的图片");
  const bytes = base64ToUint8Array(data.base64);
  const blob = new Blob([bytes], { type: mime });
  await recordDebugEvent("capture:clipboard", { mime, bytes: bytes.length });
  const processed = await processImageBlob(blob);
  await recordDebugEvent("capture:image", {
    stage: "processed", source: "clipboard", width: processed.width, height: processed.height, bytes: processed.bytes
  });
  const imageId = newId("img");
  const title = imageTitleFromUrl("clipboard:image");
  const item = createItem({
    title,
    prompt: "",
    categoryId: UNCLASSIFIED_ID,
    image: {
      id: imageId,
      path: "images/" + imageId + ".jpg",
      filename: title + ".jpg",
      mime: "image/jpeg",
      width: processed.width,
      height: processed.height,
      bytes: processed.bytes
    },
    source: { type: "clipboard" }
  });
  await saveContextCapture(item, processed.base64);
  await showBadge(true, "剪贴板图片已收藏");
  await recordDebugEvent("capture:complete", { kind: "clipboard" });
  await publishCaptureFeedback("success", "图片已收藏（剪贴板监听）");
  return { id: item.id };
}

async function handleContextMenu(info, tab) {
  await recordDebugEvent("capture:start", { kind: info.menuItemId === CONTEXT_MENU_IDS.image ? "image" : "text" });
  if (info.menuItemId === CONTEXT_MENU_IDS.selection) {
    const text = String(info.selectionText || "");
    if (!text) throw appError("EMPTY_SELECTION", "没有可收藏的文字");
    const item = createItem({
      title: generateTitleFromText(text),
      prompt: text,
      categoryId: UNCLASSIFIED_ID,
      source: { type: "selection" }
    });
    await saveContextCapture(item, null);
    await showBadge(true, "文字已收藏");
    await recordDebugEvent("capture:complete", { kind: "text" });
    await publishCaptureFeedback("success", "文字已收藏");
    return;
  }

  if (info.menuItemId === CONTEXT_MENU_IDS.image) {
    const srcUrl = String(info.srcUrl || "");
    if (!srcUrl) throw appError("IMAGE_URL_MISSING", "没有可收藏的图片地址");
    await publishCaptureFeedback("info", "正在收藏图片…");
    const processed = await fetchAndProcessImage(srcUrl, info, tab);
    await recordDebugEvent("capture:image", { stage: "processed", width: processed.width, height: processed.height, bytes: processed.bytes });
    const imageId = newId("img");
    const item = createItem({
      title: imageTitleFromUrl(srcUrl),
      prompt: "",
      categoryId: UNCLASSIFIED_ID,
      image: {
        id: imageId,
        path: "images/" + imageId + ".jpg",
        filename: imageTitleFromUrl(srcUrl) + ".jpg",
        mime: "image/jpeg",
        width: processed.width,
        height: processed.height,
        bytes: processed.bytes
      },
      source: { type: "image" }
    });
    await saveContextCapture(item, processed.base64);
    await showBadge(true, "图片已收藏");
    await recordDebugEvent("capture:complete", { kind: "image" });
    await publishCaptureFeedback("success", "图片已收藏");
  }
}

function installMenus(language = "zh") {
  const english = language === "en";
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_IDS.selection,
      title: english ? "Save selected text" : "收藏选中文字",
      contexts: ["selection"]
    });
    chrome.contextMenus.create({
      id: CONTEXT_MENU_IDS.image,
      title: english ? "Save image" : "收藏图片",
      contexts: ["image"]
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  getSettings().then((settings) => installMenus(settings.language)).catch(() => installMenus("zh"));
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  getSettings().then((settings) => installMenus(settings.language)).catch(() => installMenus("zh"));
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (![CONTEXT_MENU_IDS.selection, CONTEXT_MENU_IDS.image].includes(info.menuItemId)) return;
  // Site permissions are declared once in the manifest, never requested on each capture.
  queueImageTask(() => handleContextMenu(info, tab)).catch(async (error) => {
    console.warn("[PromptSave] context capture failed", error);
    await recordDebugEvent("capture:failed", { code: error.code || error.name });
    const pending = await pendingCount();
    const message = (error && error.message ? error.message : "收藏失败") + (pending ? "；待保存内容已保留，请恢复目录后重试。" : "");
    await showBadge(false, message);
    await publishCaptureFeedback("error", message, error.code || "UNKNOWN_ERROR");
    await broadcastDataChanged();
  });
});

async function handleMessage(message) {
  switch (message && message.action) {
    case "state:get":
      return getState(!!message.force);
    case "native:call": {
      if (!["pick", "open", "probe"].includes(message.operation)) throw appError("NATIVE_ACTION_DENIED", "界面不能直接读写桥接文件");
      return nativeCall(message.operation, { rootId: message.payload?.rootId });
    }
    case "debug:set":
      return setDebugRecording(!!message.enabled);
    case "debug:clear":
      return setDebugRecording(false, true);
    case "debug:get":
      return getDebugSnapshot();
    case "debug:record":
      return recordDebugEvent("ui:failed", { code: String(message.code || "UNKNOWN_ERROR") });
    case "debug:image":
      return recordDebugEvent("ui:image", { cacheHit: !!message.cacheHit, durationMs: Number(message.durationMs) || 0 });
    case "settings:update":
      return updateSettings(message.patch || {});
    case "clipboard:setListen":
      return setClipboardListening(!!message.enabled);
    case "clipboard:getState":
      return { listening: await getClipboardListening() };
    case "clipboard:image":
      return queueImageTask(() => handleClipboardImageCapture(message.image || {}));
    case "clipboard:status":
      if (message.status && !message.status.ok) {
        const text = message.status.code === "PASTE_DENIED"
          ? "无法读取剪贴板（浏览器拒绝），请重新加载扩展后重试"
          : "剪贴板监听出现错误，请重新加载扩展后重试";
        await publishCaptureFeedback("error", text);
      }
      return { ok: true };
    case "item:add":
      return addPreparedItem(message.item || {});
    case "item:update":
      return updateItem(message.item || {});
    case "items:softDelete":
      return softDeleteItems(message.ids || []);
    case "item:restore":
      return restoreItem(String(message.id || ""));
    case "item:deletePermanent":
      return permanentDeleteOne(String(message.id || ""));
    case "trash:empty":
      return emptyTrash();
    case "items:bulkCategory":
      return bulkMoveCategory(message.ids || [], String(message.categoryId || UNCLASSIFIED_ID));
    case "category:add":
      return addCategory(message.category || {});
    case "category:rename":
      return renameCategory(String(message.id || ""), message.name);
    case "category:delete":
      return deleteCategory(String(message.id || ""));
    case "image:get":
      return getImageForItem(String(message.id || ""));
    case "images:check":
      return queueBulk(() => checkImages(message.ids || [], !!message.deep));
    case "directory:status":
      return directoryStatus();
    case "directory:inspect":
      return inspectDirectory();
    case "directory:configure":
      return queueBulk(() => configureDirectory(String(message.strategy || ""), message.rootId || null));
    case "directory:reauthorized":
      return flushPending();
    case "storage:toLocal":
      return queueBulk(() => switchToLocal());
    case "storage:clearLocal":
      return clearLocalLibrary();
    case "pending:retry":
      return flushPending();
    case "export:get":
      return queueBulk(() => queueWrite(() => exportBundle()));
    case "import:apply":
      return queueBulk(() => applyImport(message.bundle || {}, message.mode === "replace" ? "replace" : "merge"));
    default:
      throw appError("UNKNOWN_ACTION", "未知操作");
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.event) return false;
  // Messages directed at the offscreen document are handled there; the SW
  // must not answer them (it would steal the response channel).
  if (message && message.target === "offscreen") return false;
  // Only extension pages can call library/file operations; transient page scripts cannot.
  if (!sender.url || !sender.url.startsWith(chrome.runtime.getURL(""))) {
    sendResponse({ ok: false, error: { code: "UNTRUSTED_SENDER", message: "不允许此来源调用扩展操作" } });
    return false;
  }
  const operationStart = performance.now();
  handleMessage(message)
    .then((data) => {
      if (!message.action.startsWith("debug:")) recordDebugEvent("operation:complete", { action: message.action, count: data && data.count, durationMs: Math.round(performance.now() - operationStart) });
      sendResponse({ ok: true, data });
    })
    .catch((error) => {
      recordDebugEvent("operation:failed", { action: message && message.action, code: error.code || error.name, durationMs: Math.round(performance.now() - operationStart) });
      console.warn("[PromptSave] message failed", message && message.action, error);
      sendResponse({ ok: false, error: serializeError(error) });
    });
  return true;
});
