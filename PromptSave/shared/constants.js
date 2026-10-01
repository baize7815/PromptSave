export const SCHEMA_VERSION = 1;
export const UNCLASSIFIED_ID = "uncategorized";

export const STORAGE_KEYS = Object.freeze({
  settings: "ps:settings",
  localMeta: "ps:local:meta",
  localItemPrefix: "ps:local:item:",
  localImagePrefix: "ps:local:image:",
  localRecovery: "ps:local:recovery",
  directoryCache: "ps:directory:cache",
  pendingIndex: "ps:pending:index",
  pendingPrefix: "ps:pending:"
});

// chrome.storage.session is cleared when the browser restarts, so clipboard
// monitoring can never silently remain enabled without the user re-opening it.
export const SESSION_KEYS = Object.freeze({
  clipboardListen: "ps:clipboard:listen"
});

export const CLIPBOARD_RULES = Object.freeze({
  offscreenUrl: "offscreen/offscreen.html",
  pollIntervalMs: 800,
  acceptedImageMime: /^image\/(png|jpeg|jpg|webp|gif|bmp|x-icon|vnd\.microsoft\.icon)$/i
});

export const DEFAULT_SETTINGS = Object.freeze({
  storageMode: "local",
  language: "zh",
  theme: "light",
  view: "grid",
  sort: "created-desc",
  activeCategory: "all",
  directoryName: "",
  pageSize: 8
});

export const IMAGE_RULES = Object.freeze({
  jpegQuality: 0.76,
  minJpegQuality: 0.6,
  targetOutputBytes: 192 * 1024,
  maxOutputBytes: 512 * 1024,
  maxInputBytes: 12 * 1024 * 1024,
  maxPixels: 20 * 1000 * 1000,
  landscapeWidth: 1280,
  landscapeHeight: 720,
  portraitWidth: 720,
  portraitHeight: 1280,
  squareWidth: 720,
  squareHeight: 720
});

export const ZIP_RULES = Object.freeze({
  maxFiles: 5000,
  maxInputFileBytes: 32 * 1024 * 1024,
  maxExpandedBytes: 64 * 1024 * 1024,
  maxExportBytes: 32 * 1024 * 1024,
  maxDataJsonBytes: 8 * 1024 * 1024
});

export const RESOURCE_RULES = Object.freeze({
  captureQueue: 8,
  writeQueue: 16,
  imageReadConcurrency: 2,
  imageReadQueue: 16,
  pendingCount: 50,
  pendingBytes: 12 * 1024 * 1024,
  metadataBytes: 8 * 1024 * 1024,
  datasetItems: 5000,
  bulkImageBytes: 32 * 1024 * 1024,
  pageItems: 8,
  uiImageCacheBytes: 4 * 1024 * 1024,
  uiImageCacheCount: 12,
  uiDecodedPixels: 8 * 1000 * 1000
});

export const DIRECTORY_FILES = Object.freeze({
  data: "data.json",
  recovery: "recovery.json",
  images: "images"
});

export const CONTEXT_MENU_IDS = Object.freeze({
  selection: "ps-save-selection",
  image: "ps-save-image"
});

export function appError(code, message, details = null) {
  const error = new Error(message || code);
  error.code = code;
  if (details !== null) error.details = details;
  return error;
}

export function serializeError(error) {
  return {
    code: error && error.code ? String(error.code) : "UNKNOWN_ERROR",
    message: error && error.message ? String(error.message) : "未知错误",
    details: error && error.details ? error.details : null
  };
}
