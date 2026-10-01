import { DIRECTORY_FILES, IMAGE_RULES, RESOURCE_RULES, appError } from "../shared/constants.js";
import { assertDatasetBudget, inspectStoredImage, assertBulkImageBudget, imageWriteBytes } from "../shared/resource-check.js";
import { createEmptyData, validateDataset, referencedImageIds } from "../shared/model.js";
import { base64ToUint8Array, uint8ArrayToBase64, isJpegBytes } from "../shared/image.js";
import { queryDirectoryPermission } from "../shared/idb-handle.js";

function classifyFsError(error, fallbackCode = "DIRECTORY_ERROR") {
  if (!error) return appError(fallbackCode, "目录操作失败");
  if (error.code) return error;
  if (error.name === "NotAllowedError" || error.name === "SecurityError") {
    return appError("DIRECTORY_PERMISSION_REQUIRED", "目录需要重新授权");
  }
  if (error.name === "NotFoundError") {
    return appError("DIRECTORY_NOT_FOUND", "目录或文件不存在");
  }
  return appError(fallbackCode, error.message || "目录操作失败");
}

async function writeFile(handle, data) {
  const writable = await handle.createWritable();
  try {
    await writable.write(data);
  } finally {
    await writable.close();
  }
}

async function isDecodableJpeg(bytes) {
  if (!isJpegBytes(bytes) || bytes.byteLength > IMAGE_RULES.maxInputBytes) return false;
  try { await inspectStoredImage(new Blob([bytes], { type: "image/jpeg" })); }
  catch (_) { return false; }
  if (typeof createImageBitmap !== "function") return true;
  let bitmap = null;
  try {
    bitmap = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }), { resizeWidth: 32, resizeHeight: 32 });
    return !!bitmap.width && !!bitmap.height && bitmap.width * bitmap.height <= IMAGE_RULES.maxPixels;
  } catch (_) {
    return false;
  } finally {
    if (bitmap && typeof bitmap.close === "function") bitmap.close();
  }
}

export class DirectoryBackend {
  mode = "directory";

  constructor(handle) {
    if (!handle || handle.kind !== "directory") throw appError("DIRECTORY_NOT_CONFIGURED", "尚未设置目录");
    this.handle = handle;
  }

  async permissionStatus() {
    return queryDirectoryPermission(this.handle, "readwrite");
  }

  async assertWritable() {
    const status = await this.permissionStatus();
    if (status !== "granted" && status !== "unknown") {
      throw appError("DIRECTORY_PERMISSION_REQUIRED", "目录需要重新授权");
    }
    try {
      await this.handle.keys().next();
    } catch (error) {
      throw classifyFsError(error, "DIRECTORY_UNAVAILABLE");
    }
    return true;
  }

  async hasExistingData() {
    await this.assertWritable();
    try {
      await this.handle.getFileHandle(DIRECTORY_FILES.data, { create: false });
      return true;
    } catch (error) {
      if (error && error.name === "NotFoundError") return false;
      throw classifyFsError(error);
    }
  }

  async readDataFile(name = DIRECTORY_FILES.data) {
    try {
      let file;
      if (this.handle.provider === "native") file = await this.handle.readFile(name);
      else {
        await this.assertWritable();
        const fileHandle = await this.handle.getFileHandle(name, { create: false });
        file = await fileHandle.getFile();
      }
      if (file.size > RESOURCE_RULES.metadataBytes) throw appError("DIRECTORY_DATA_INVALID", "目录元数据超过 8 MiB 限制");
      const text = await file.text();
      return JSON.parse(text);
    } catch (error) {
      if (error && error.name === "NotFoundError") throw error;
      if (error instanceof SyntaxError) throw appError("DIRECTORY_DATA_INVALID", name + " JSON 已损坏");
      if (error && error.code) throw error;
      throw classifyFsError(error);
    }
  }

  async loadData() {
    try {
      const raw = await this.readDataFile(DIRECTORY_FILES.data);
      const data = validateDataset(raw, { strict: false });
      assertDatasetBudget(data);
      return data;
    } catch (error) {
      if (error && error.name === "NotFoundError") return createEmptyData();
      throw error;
    }
  }

  async writeJson(name, value) {
    if (this.handle.provider === "native") return this.handle.writeFile(name, JSON.stringify(value, null, 2));
    const fileHandle = await this.handle.getFileHandle(name, { create: true });
    await writeFile(fileHandle, JSON.stringify(value, null, 2));
  }

  async imagesDirectory(create = true) {
    try {
      return await this.handle.getDirectoryHandle(DIRECTORY_FILES.images, { create });
    } catch (error) {
      throw classifyFsError(error, "DIRECTORY_UNAVAILABLE");
    }
  }

  async writeImage(imageId, base64) {
    const bytes = base64ToUint8Array(base64);
    if (!isJpegBytes(bytes)) throw appError("INVALID_JPEG", "准备写入的图片不是有效 JPG");
    if (this.handle.provider === "native") return this.handle.writeFile("images/" + imageId + ".jpg", bytes);
    const directory = await this.imagesDirectory(true);
    const fileHandle = await directory.getFileHandle(imageId + ".jpg", { create: true });
    await writeFile(fileHandle, bytes);
  }

  async deleteImage(imageId) {
    try {
      const directory = await this.imagesDirectory(false);
      await directory.removeEntry(imageId + ".jpg");
      return true;
    } catch (error) {
      if (error && error.name === "NotFoundError") return true;
      throw classifyFsError(error, "IMAGE_DELETE_FAILED");
    }
  }

  async saveDataset(nextRaw, { previous = null, imageWrites = {}, imageDeletes = [] } = {}) {
    await this.assertWritable();
    const next = validateDataset(nextRaw, { strict: false });
    assertDatasetBudget(next);
    let current = null;
    const exists = await this.hasExistingData();
    if (exists) current = await this.loadData();

    if (previous && current) {
      const normalizedPrevious = validateDataset(previous, { strict: false });
      const changedExternally =
        current.datasetId !== normalizedPrevious.datasetId ||
        current.revision !== normalizedPrevious.revision ||
        JSON.stringify(current) !== JSON.stringify(normalizedPrevious);
      if (changedExternally) {
        throw appError("EXTERNAL_CHANGE", "检测到 data.json 被外部修改，已暂停覆盖");
      }
    }

    const currentImageIds = current ? referencedImageIds(current) : new Set();
    let transactionBytes = imageWriteBytes(imageWrites);
    assertBulkImageBudget(transactionBytes);
    // Reserve rollback space before changing any image files; stat does not load image bytes.
    for (const id of new Set(imageDeletes || [])) {
      try {
        let size;
        if (this.handle.provider === "native") size = (await this.handle.statFile("images/" + id + ".jpg")).size;
        else {
          const directory = await this.imagesDirectory(false);
          const fileHandle = await directory.getFileHandle(id + ".jpg", { create: false });
          size = (await fileHandle.getFile()).size;
        }
        if (size > IMAGE_RULES.maxInputBytes) throw appError("IMAGE_TOO_LARGE", "旧图片超过 12 MiB 回滚读取上限，未修改文件");
        transactionBytes += size;
        assertBulkImageBudget(transactionBytes);
      } catch (error) {
        if (error?.name !== "NotFoundError" && error?.code !== "DIRECTORY_NOT_FOUND") throw error;
      }
    }
    transactionBytes = imageWriteBytes(imageWrites);
    const newlyWrittenIds = [];
    const deletedBackups = [];
    try {
      for (const [id, base64] of Object.entries(imageWrites || {})) {
        await this.writeImage(id, base64);
        if (!currentImageIds.has(id)) newlyWrittenIds.push(id);
      }

      for (const id of imageDeletes || []) {
        let backup = null;
        try {
          let file;
          if (this.handle.provider === "native") file = await this.handle.readFile("images/" + id + ".jpg");
          else {
            const directory = await this.imagesDirectory(false);
            const fileHandle = await directory.getFileHandle(id + ".jpg", { create: false });
            file = await fileHandle.getFile();
          }
          transactionBytes += file.size;
          assertBulkImageBudget(transactionBytes);
          backup = new Uint8Array(await file.arrayBuffer());
        } catch (error) {
          if (!error || error.name !== "NotFoundError") throw classifyFsError(error, "IMAGE_DELETE_FAILED");
        }
        await this.deleteImage(id);
        deletedBackups.push({ id, bytes: backup });
      }

      if (current) await this.writeJson(DIRECTORY_FILES.recovery, current);
      await this.writeJson(DIRECTORY_FILES.data, next);
    } catch (error) {
      for (const id of newlyWrittenIds) {
        try {
          await this.deleteImage(id);
        } catch (_) {
          // Best-effort orphan cleanup; the original failure is more important.
        }
      }
      for (const backup of deletedBackups) {
        if (!backup.bytes) continue;
        try {
          if (this.handle.provider === "native") await this.handle.writeFile("images/" + backup.id + ".jpg", backup.bytes);
          else {
            const directory = await this.imagesDirectory(true);
            const fileHandle = await directory.getFileHandle(backup.id + ".jpg", { create: true });
            await writeFile(fileHandle, backup.bytes);
          }
        } catch (_) {
          // Preserve the original write failure; recovery.json still records the old metadata.
        }
      }
      throw error;
    }

    return next;
  }

  async readImage(imageRef) {
    if (!imageRef) return { status: "missing", base64: null };
    try {
      let file;
      if (this.handle.provider === "native") file = await this.handle.readFile("images/" + imageRef.id + ".jpg");
      else {
        await this.assertWritable();
        const directory = await this.imagesDirectory(false);
        const fileHandle = await directory.getFileHandle(imageRef.id + ".jpg", { create: false });
        file = await fileHandle.getFile();
      }
      const dimensions = await inspectStoredImage(file);
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!isJpegBytes(bytes)) return { status: "corrupt", base64: null };
      return { status: "ok", base64: uint8ArrayToBase64(bytes), ...dimensions };
    } catch (error) {
      if (error && error.name === "NotFoundError") return { status: "missing", base64: null };
      if (error && error.code === "DIRECTORY_PERMISSION_REQUIRED") return { status: "permission", base64: null };
      if (error && (error.name === "NotAllowedError" || error.name === "SecurityError")) {
        return { status: "permission", base64: null };
      }
      return { status: "unavailable", base64: null };
    }
  }

  async checkImages(refs, { deep = false } = {}) {
    const statuses = {};
    await this.assertWritable();
    let directory;
    try {
      directory = await this.imagesDirectory(false);
    } catch (error) {
      if (error && error.code === "DIRECTORY_NOT_FOUND") {
        for (const ref of refs) if (ref) statuses[ref.id] = "missing";
        return statuses;
      }
      throw error;
    }

    for (const ref of refs) {
      if (!ref) continue;
      try {
        const fileHandle = await directory.getFileHandle(ref.id + ".jpg", { create: false });
        if (!deep) {
          statuses[ref.id] = "ok";
          continue;
        }
        const file = await fileHandle.getFile();
        if (file.size > IMAGE_RULES.maxInputBytes) { statuses[ref.id] = "unavailable"; continue; }
        const bytes = new Uint8Array(await file.arrayBuffer());
        statuses[ref.id] = await isDecodableJpeg(bytes) ? "ok" : "corrupt";
      } catch (error) {
        if (error && error.name === "NotFoundError") statuses[ref.id] = "missing";
        else throw classifyFsError(error);
      }
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

  async replaceDataset(nextRaw, imagesById = {}, { backup = true } = {}) {
    const next = validateDataset(nextRaw, { strict: false });
    const before = await this.loadData();
    const oldIds = referencedImageIds(before);
    const newIds = referencedImageIds(next);
    const writes = {};
    const providedImageIds = new Set();
    for (const [id, base64] of Object.entries(imagesById || {})) {
      if (newIds.has(id)) {
        writes[id] = base64;
        providedImageIds.add(id);
      }
    }
    if (backup) {
      try {
        await this.writeJson(DIRECTORY_FILES.recovery, before);
      } catch (_) {
        // saveDataset will still refuse to report success if the actual commit fails.
      }
    }
    return this.saveDataset(next, {
      previous: await this.hasExistingData() ? before : null,
      imageWrites: writes,
      imageDeletes: [...oldIds].filter((id) => !newIds.has(id) || !providedImageIds.has(id))
    });
  }
}
