import { base64ToUint8Array, uint8ArrayToBase64 } from "./image.js";
import { appError } from "./constants.js";
import { recordDebugEvent } from "./debug-log.js";
import { nativeTransport } from "./native-connection.js";

export const NATIVE_HOST = "com.promptshelf.local";
const CHUNK_BYTES = 256 * 1024;

export async function datasetFingerprint(data) {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function nativeCall(action, payload = {}) {
  let response;
  const started = performance.now();
  const fromUi = typeof document !== "undefined";
  try {
    // UI windows share the ONE background port; they never start their own hosts.
    if (fromUi) {
      response = await chrome.runtime.sendMessage({ action: "native:call", operation: action, payload });
    } else {
      response = await nativeTransport(action, payload);
    }
  } catch (error) {
    if (!fromUi) recordDebugEvent("native:failed", { action, code: error?.code || "DIRECTORY_UNAVAILABLE", durationMs: Math.round(performance.now() - started) });
    if (error?.code) throw error;
    throw appError("DIRECTORY_UNAVAILABLE", "本地桥接不可用。请先双击 native/install.bat，核对扩展 ID，然后重新加载扩展。");
  }
  if (!response?.ok) {
    const error = appError(response?.error?.code || "DIRECTORY_UNAVAILABLE",
      response?.error?.message || "本地目录操作失败");
    if (response?.error?.name) error.name = response.error.name;
    if (!fromUi) recordDebugEvent("native:failed", { action, code: error.code, durationMs: Math.round(performance.now() - started) });
    throw error;
  }
  if (!fromUi) recordDebugEvent("native:complete", { action, durationMs: Math.round(performance.now() - started) });
  return response.data;
}

export async function pickNativeDirectory() {
  const descriptor = await nativeCall("pick");
  return descriptor ? new NativeDirectoryHandle(descriptor) : null;
}

class NativeFileHandle {
  constructor(rootId, path) {
    this.rootId = rootId;
    this.path = path;
  }

  async getFile() {
    const info = await nativeCall("readFile", { rootId: this.rootId, path: this.path });
    if (typeof info.base64 === "string") return new Blob([base64ToUint8Array(info.base64)]);
    const parts = [];
    for (let offset = 0; offset < info.size; offset += CHUNK_BYTES) {
      const part = await nativeCall("read", {
        rootId: this.rootId, path: this.path, offset, version: info.version
      });
      const bytes = base64ToUint8Array(part.base64);
      if (bytes.length !== Math.min(CHUNK_BYTES, info.size - offset)) {
        throw appError("EXTERNAL_CHANGE", "读取过程中文件已改变，请刷新后重试");
      }
      parts.push(bytes);
    }
    return new Blob(parts);
  }

  async createWritable() {
    let bytes = null;
    return {
      write: async (value) => {
        if (typeof value === "string") bytes = new TextEncoder().encode(value);
        else if (value instanceof Uint8Array) bytes = value;
        else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
        else throw new TypeError("Unsupported native file content");
      },
      close: async () => {
        if (bytes === null) return;
        const content = bytes;
        bytes = null;
        await nativeCall("write", {
          rootId: this.rootId, path: this.path, base64: uint8ArrayToBase64(content)
        });
      }
    };
  }
}

// Implements only the File System Access methods consumed by DirectoryBackend.
export class NativeDirectoryHandle {
  kind = "directory";
  provider = "native";

  constructor(descriptor, prefix = "") {
    if (!/^[a-f0-9]{64}$/.test(descriptor?.rootId || "") || typeof descriptor.name !== "string") {
      throw new TypeError("Invalid native directory descriptor");
    }
    this.rootId = descriptor.rootId;
    this.name = descriptor.name;
    this.prefix = prefix;
  }

  descriptor() { return { rootId: this.rootId, name: this.name }; }

  readFile(path) { return new NativeFileHandle(this.rootId, path).getFile(); }
  statFile(path) { return nativeCall("stat", { rootId: this.rootId, path }); }

  async writeFile(path, value) {
    const writable = await new NativeFileHandle(this.rootId, path).createWritable();
    await writable.write(value);
    await writable.close();
  }

  async queryPermission() {
    await nativeCall("probe", { rootId: this.rootId });
    return "granted";
  }

  requestPermission() { return this.queryPermission(); }

  async *keys() {
    // permissionStatus already probes this root; subsequent file operations validate it again.
  }

  async isSameEntry(other) {
    return other?.provider === "native" && other.rootId === this.rootId && other.prefix === this.prefix;
  }

  async getDirectoryHandle(name, { create = false } = {}) {
    if (this.prefix || name !== "images") throw new TypeError("Unsupported native subdirectory");
    await nativeCall("images", { rootId: this.rootId, create });
    return new NativeDirectoryHandle(this.descriptor(), "images/");
  }

  async getFileHandle(name, { create = false } = {}) {
    const path = this.prefix + name;
    await nativeCall("file", { rootId: this.rootId, path, create });
    return new NativeFileHandle(this.rootId, path);
  }

  async removeEntry(name) {
    await nativeCall("delete", { rootId: this.rootId, path: this.prefix + name });
  }

  openInExplorer() { return nativeCall("open", { rootId: this.rootId }); }
}
