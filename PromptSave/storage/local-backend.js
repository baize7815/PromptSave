import { STORAGE_KEYS, RESOURCE_RULES, IMAGE_RULES, appError } from "../shared/constants.js";
import { createEmptyData, validateDataset, referencedImageIds } from "../shared/model.js";
import { base64ToUint8Array, isJpegBytes } from "../shared/image.js";
import { assertDatasetBudget, inspectStoredImage, assertBulkImageBudget, imageWriteBytes } from "../shared/resource-check.js";

const local = () => chrome.storage.local;
const itemKey = (id) => STORAGE_KEYS.localItemPrefix + id;
const imageKey = (id) => STORAGE_KEYS.localImagePrefix + id;

async function readMeta() {
  const result = await local().get(STORAGE_KEYS.localMeta);
  let meta = result[STORAGE_KEYS.localMeta];
  if (!meta) {
    const data = createEmptyData();
    meta = {
      schemaVersion: data.schemaVersion,
      datasetId: data.datasetId,
      revision: data.revision,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      categories: data.categories,
      itemIds: []
    };
    await local().set({ [STORAGE_KEYS.localMeta]: meta });
  }
  return meta;
}

function dataToMeta(data) {
  return {
    schemaVersion: data.schemaVersion,
    datasetId: data.datasetId,
    revision: data.revision,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    categories: data.categories,
    itemIds: data.items.map((item) => item.id)
  };
}

async function getMany(keys) {
  if (!keys.length) return {};
  const combined = {};
  for (let index = 0; index < keys.length; index += 250) {
    Object.assign(combined, await local().get(keys.slice(index, index + 250)));
  }
  return combined;
}

async function setMany(record) {
  const entries = Object.entries(record);
  for (let index = 0; index < entries.length; index += 100) {
    await local().set(Object.fromEntries(entries.slice(index, index + 100)));
  }
}

export class LocalBackend {
  mode = "local";

  async loadData() {
    const meta = await readMeta();
    const ids = Array.isArray(meta.itemIds) ? meta.itemIds : [];
    if (ids.length > RESOURCE_RULES.datasetItems) throw appError("DATASET_LIMIT", "单库超过 5000 条，请拆分数据集");
    const values = await getMany(ids.map(itemKey));
    const items = ids.map((id) => values[itemKey(id)]).filter(Boolean);
    const data = validateDataset({
      schemaVersion: meta.schemaVersion,
      datasetId: meta.datasetId,
      revision: meta.revision,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      categories: Array.isArray(meta.categories) ? meta.categories : [],
      items
    }, { strict: false });
    assertDatasetBudget(data);
    return data;
  }

  async saveDataset(nextRaw, { previous = null, imageWrites = {}, imageDeletes = [] } = {}) {
    const next = validateDataset(nextRaw, { strict: false });
    assertDatasetBudget(next);
    const before = previous ? validateDataset(previous, { strict: false }) : await this.loadData();
    const beforeById = new Map(before.items.map((item) => [item.id, item]));
    const nextById = new Map(next.items.map((item) => [item.id, item]));

    const itemWrites = {};
    for (const item of next.items) {
      const old = beforeById.get(item.id);
      if (!old || JSON.stringify(old) !== JSON.stringify(item)) itemWrites[itemKey(item.id)] = item;
    }

    const imageWriteEntries = Object.entries(imageWrites || {});
    const imageDeleteKeys = Array.isArray(imageDeletes) ? imageDeletes.map(imageKey) : [];
    const touchedImageKeys = [...new Set([...imageWriteEntries.map(([id]) => imageKey(id)), ...imageDeleteKeys])];
    const backupBytes = touchedImageKeys.length ? await local().getBytesInUse(touchedImageKeys) : 0;
    assertBulkImageBudget(imageWriteBytes(imageWrites) + backupBytes);
    const touchedKeys = [
      ...Object.keys(itemWrites),
      ...imageWriteEntries.map(([id]) => imageKey(id)),
      ...imageDeleteKeys
    ];
    const backupValues = await getMany([...new Set(touchedKeys)]);
    const backupKeys = new Set(Object.keys(backupValues));

    try {
      for (const [id, base64] of imageWriteEntries) {
        await local().set({ [imageKey(id)]: String(base64 || "") });
      }
      if (imageDeleteKeys.length) await local().remove(imageDeleteKeys);
      await setMany(itemWrites);
      await local().set({ [STORAGE_KEYS.localMeta]: dataToMeta(next) });
    } catch (error) {
      const restore = {};
      const remove = [];
      for (const key of [...new Set(touchedKeys)]) {
        if (backupKeys.has(key)) restore[key] = backupValues[key];
        else remove.push(key);
      }
      try {
        await setMany(restore);
        if (remove.length) await local().remove(remove);
      } catch (_) {
        // The original storage failure remains authoritative.
      }
      throw error;
    }

    const removedItemKeys = before.items.filter((item) => !nextById.has(item.id)).map((item) => itemKey(item.id));
    if (removedItemKeys.length) {
      try {
        await local().remove(removedItemKeys);
      } catch (_) {
        // Unindexed stale item keys are harmless and can be cleaned by a later maintenance pass.
      }
    }
    return next;
  }

  async readImage(imageRef) {
    if (!imageRef) return { status: "missing", base64: null };
    const result = await local().get(imageKey(imageRef.id));
    const base64 = result[imageKey(imageRef.id)];
    if (!base64) return { status: "missing", base64: null };
    try {
      if (base64.length > Math.ceil(IMAGE_RULES.maxInputBytes / 3) * 4) return { status: "unavailable", base64: null };
      const bytes = base64ToUint8Array(base64);
      if (!isJpegBytes(bytes)) return { status: "corrupt", base64: null };
      const dimensions = await inspectStoredImage(new Blob([bytes], { type: "image/jpeg" }));
      return { status: "ok", base64, ...dimensions };
    } catch (_) {
      return { status: "corrupt", base64: null };
    }
  }

  async checkImages(refs) {
    const statuses = {};
    for (const ref of refs) {
      if (!ref) continue;
      statuses[ref.id] = await local().getBytesInUse(imageKey(ref.id)) > 0 ? "ok" : "missing";
    }
    return statuses;
  }

  async exportSnapshot(data = null) {
    const current = data || await this.loadData();
    const images = {};
    let totalBytes = 0;
    for (const item of current.items) {
      if (!item.image || images[item.image.id]) continue;
      const result = await this.readImage(item.image);
      if (result.status === "ok") {
        totalBytes += Math.ceil(result.base64.length * 3 / 4);
        assertBulkImageBudget(totalBytes);
        images[item.image.id] = result.base64;
      }
    }
    return { data: current, images };
  }

  async backupCurrent() {
    const snapshot = await this.exportSnapshot();
    await local().set({ [STORAGE_KEYS.localRecovery]: snapshot });
    return snapshot;
  }

  async replaceDataset(nextRaw, imagesById = {}, { backup = true } = {}) {
    const next = validateDataset(nextRaw, { strict: false });
    const before = await this.loadData();
    if (backup) await this.backupCurrent();

    const oldImageIds = referencedImageIds(before);
    const newImageIds = referencedImageIds(next);

    const imageWrites = {};
    const providedImageIds = new Set();
    for (const [id, base64] of Object.entries(imagesById || {})) {
      if (newImageIds.has(id)) {
        imageWrites[id] = base64;
        providedImageIds.add(id);
      }
    }

    await this.saveDataset(next, {
      previous: before,
      imageWrites,
      imageDeletes: [...oldImageIds].filter((id) => !newImageIds.has(id) || !providedImageIds.has(id))
    });
    return next;
  }

  async bytesInUse() {
    if (typeof local().getBytesInUse !== "function") return null;
    return local().getBytesInUse(null);
  }

  async assertWritable() {
    try {
      await local().set({ "ps:write-probe": Date.now() });
      await local().remove("ps:write-probe");
      return true;
    } catch (error) {
      throw appError("LOCAL_STORAGE_UNAVAILABLE", "本地存储不可写", String(error && error.message || error));
    }
  }
}
