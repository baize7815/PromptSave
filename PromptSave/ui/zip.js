import { IMAGE_RULES, ZIP_RULES, appError } from "../shared/constants.js";
import { validateDataset, isSafeZipPath } from "../shared/model.js";
import { base64ToUint8Array, uint8ArrayToBase64, isJpegBytes } from "../shared/image.js";
import { inspectImageBlob } from "../shared/image-header.js";

let loadingPromise = null;

function utf8ByteLength(value) {
  if (typeof TextEncoder === "function") return new TextEncoder().encode(String(value)).byteLength;
  return new Blob([String(value)]).size;
}

function base64ByteLength(value) {
  const text = String(value || "").replace(/[\r\n\t ]/g, "");
  if (!text) return 0;
  const padding = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor(text.length * 3 / 4) - padding);
}

function yieldToEventLoop() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function ensureJsZip() {
  if (globalThis.JSZip) return globalThis.JSZip;
  if (!loadingPromise) {
    loadingPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = chrome.runtime.getURL("vendor/jszip.min.js");
      script.onload = () => globalThis.JSZip ? resolve(globalThis.JSZip) : reject(new Error("JSZip 未加载"));
      script.onerror = () => reject(new Error("JSZip 加载失败"));
      document.head.appendChild(script);
    });
  }
  return loadingPromise;
}

export async function buildZipBlob(bundle) {
  const JSZip = await ensureJsZip();
  const dataJson = JSON.stringify(bundle.data, null, 2);
  const imageEntries = bundle.images || {};
  let estimatedBytes = utf8ByteLength(dataJson);
  for (const path in imageEntries) {
    if (!Object.prototype.hasOwnProperty.call(imageEntries, path)) continue;
    const base64 = imageEntries[path];
    if (!isSafeZipPath(path) || !path.startsWith("images/") || !path.endsWith(".jpg")) continue;
    estimatedBytes += base64ByteLength(base64);
    if (estimatedBytes > ZIP_RULES.maxExportBytes) {
      throw appError("ZIP_EXPORT_TOO_LARGE", "导出内容超过 32 MiB 安全上限，请拆分数据集");
    }
  }

  const zip = new JSZip();
  zip.file("data.json", dataJson, {
    binary: false,
    compression: "DEFLATE",
    compressionOptions: { level: 1 }
  });
  let imageIndex = 0;
  for (const path in imageEntries) {
    if (!Object.prototype.hasOwnProperty.call(imageEntries, path)) continue;
    const base64 = imageEntries[path];
    if (!isSafeZipPath(path) || !path.startsWith("images/") || !path.endsWith(".jpg")) continue;
    let bytes;
    try {
      bytes = base64ToUint8Array(base64);
    } catch (_) {
      throw appError("ZIP_EXPORT_IMAGE_INVALID", path + " 不是有效图片数据");
    }
    zip.file(path, bytes, { binary: true, compression: "STORE" });
    imageIndex += 1;
    if (imageIndex % 8 === 0) await yieldToEventLoop();
  }

  const output = await zip.generateAsync({
    type: "blob",
    compression: "STORE",
    streamFiles: true
  });
  if (output.size > ZIP_RULES.maxExportBytes) {
    throw appError("ZIP_EXPORT_TOO_LARGE", "导出内容超过 32 MiB 安全上限，请拆分数据集");
  }
  return output;
}

export async function parseZipFile(file) {
  if (!(file instanceof File)) throw appError("INVALID_ZIP", "请选择 ZIP 文件");
  if (file.size > ZIP_RULES.maxInputFileBytes) {
    throw appError("ZIP_INPUT_TOO_LARGE", "ZIP 文件超过大小限制");
  }
  const JSZip = await ensureJsZip();
  let zip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch (_) {
    throw appError("INVALID_ZIP", "ZIP 无法读取或已损坏");
  }

  const entries = Object.values(zip.files);
  if (entries.length > ZIP_RULES.maxFiles) throw appError("ZIP_TOO_MANY_FILES", "ZIP 文件数量超限");

  let declaredExpandedBytes = 0;
  for (const entry of entries) {
    const original = entry.unsafeOriginalName || entry.name;
    if (!isSafeZipPath(original)) throw appError("ZIP_PATH_TRAVERSAL", "ZIP 包含越界路径");
    if (!entry.dir) {
      const declaredSize = Number(entry._data && entry._data.uncompressedSize);
      if (Number.isFinite(declaredSize) && declaredSize >= 0) {
        declaredExpandedBytes += declaredSize;
        if (declaredExpandedBytes > ZIP_RULES.maxExpandedBytes) {
          throw appError("ZIP_TOO_LARGE", "ZIP 解压后体积超限");
        }
      }
    }
  }

  const dataEntry = zip.file("data.json");
  if (!dataEntry) throw appError("INVALID_ZIP", "ZIP 缺少 data.json");
  const declaredDataSize = Number(dataEntry._data && dataEntry._data.uncompressedSize);
  if (Number.isFinite(declaredDataSize) && declaredDataSize > ZIP_RULES.maxDataJsonBytes) {
    throw appError("ZIP_DATA_TOO_LARGE", "data.json 超出限制");
  }
  const dataText = await dataEntry.async("string");
  if (utf8ByteLength(dataText) > ZIP_RULES.maxDataJsonBytes) {
    throw appError("ZIP_DATA_TOO_LARGE", "data.json 超出限制");
  }

  let raw;
  try {
    raw = JSON.parse(dataText);
  } catch (_) {
    throw appError("INVALID_ZIP", "data.json 不是有效 JSON");
  }
  const data = validateDataset(raw, { strict: true });

  let expandedBytes = utf8ByteLength(dataText);
  const images = {};
  const expectedPaths = new Set(data.items.filter((item) => item.image).map((item) => item.image.path));

  let imageIndex = 0;
  for (const path of expectedPaths) {
    if (!isSafeZipPath(path) || !/^images\/[A-Za-z0-9_-]{1,96}\.jpg$/.test(path)) {
      throw appError("INVALID_ZIP", "图片路径不合法");
    }
    const entry = zip.file(path);
    if (!entry) continue;
    const declaredImageSize = Number(entry._data && entry._data.uncompressedSize);
    if (Number.isFinite(declaredImageSize) && declaredImageSize > IMAGE_RULES.maxInputBytes) {
      throw appError("ZIP_IMAGE_TOO_LARGE", path + " 超过单张图片大小限制");
    }
    const bytes = await entry.async("uint8array");
    if (bytes.byteLength > IMAGE_RULES.maxInputBytes) {
      throw appError("ZIP_IMAGE_TOO_LARGE", path + " 超过单张图片大小限制");
    }
    expandedBytes += bytes.byteLength;
    if (expandedBytes > ZIP_RULES.maxExpandedBytes) throw appError("ZIP_TOO_LARGE", "ZIP 解压后体积超限");
    if (!isJpegBytes(bytes)) throw appError("INVALID_ZIP_IMAGE", path + " 不是有效 JPG");

    const imageBlob = new Blob([bytes], { type: "image/jpeg" });
    try {
      await inspectImageBlob(imageBlob);
    } catch (_) {
      throw appError("INVALID_ZIP_IMAGE", path + " 图片尺寸或格式无效");
    }
    if (typeof createImageBitmap === "function") {
      let bitmap = null;
      try {
        bitmap = await createImageBitmap(imageBlob, {
          imageOrientation: "from-image",
          resizeWidth: 32,
          resizeHeight: 32,
          resizeQuality: "low"
        });
        if (!bitmap.width || !bitmap.height) {
          throw new Error("invalid image dimensions");
        }
      } catch (_) {
        throw appError("INVALID_ZIP_IMAGE", path + " 无法解码为有效 JPG");
      } finally {
        if (bitmap && typeof bitmap.close === "function") bitmap.close();
      }
    }
    images[path] = uint8ArrayToBase64(bytes);
    imageIndex += 1;
    if (imageIndex % 8 === 0) await yieldToEventLoop();
  }

  return { data, images };
}
