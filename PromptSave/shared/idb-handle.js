import { NativeDirectoryHandle } from "./native-directory.js";

const NATIVE_ACTIVE_KEY = "ps:native:directory";
const NATIVE_CANDIDATE_KEY = "ps:native:candidate";
const DB_NAME = "promptshelf-local-handles";
const DB_VERSION = 1;
const STORE_NAME = "handles";
const ACTIVE_DIRECTORY_KEY = "library-directory";
const CANDIDATE_DIRECTORY_KEY = "candidate-directory";

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB 打开失败"));
  });
}

async function withStore(mode, callback) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      let request;
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error("IndexedDB 事务失败"));
      tx.onabort = () => reject(tx.error || new Error("IndexedDB 事务已中止"));
      try {
        request = callback(store);
      } catch (error) {
        reject(error);
        return;
      }
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => reject(request.error || new Error("IndexedDB 操作失败"));
    });
  } finally {
    db.close();
  }
}

export async function saveDirectoryHandle(handle) {
  if (!handle || handle.kind !== "directory") throw new Error("目录句柄无效");
  if (handle.provider === "native") {
    await chrome.storage.local.set({ [NATIVE_ACTIVE_KEY]: handle.descriptor() });
    return;
  }
  await withStore("readwrite", (store) => store.put(handle, ACTIVE_DIRECTORY_KEY));
  await chrome.storage.local.remove(NATIVE_ACTIVE_KEY);
}

export async function getDirectoryHandle() {
  const stored = await chrome.storage.local.get(NATIVE_ACTIVE_KEY);
  if (stored[NATIVE_ACTIVE_KEY]) return new NativeDirectoryHandle(stored[NATIVE_ACTIVE_KEY]);
  return withStore("readonly", (store) => store.get(ACTIVE_DIRECTORY_KEY));
}

export async function clearDirectoryHandle() {
  await withStore("readwrite", (store) => store.delete(ACTIVE_DIRECTORY_KEY));
  await chrome.storage.local.remove(NATIVE_ACTIVE_KEY);
}

export async function saveCandidateDirectoryHandle(handle) {
  if (!handle || handle.kind !== "directory") throw new Error("目录句柄无效");
  if (handle.provider === "native") {
    await chrome.storage.local.set({ [NATIVE_CANDIDATE_KEY]: handle.descriptor() });
    return;
  }
  await withStore("readwrite", (store) => store.put(handle, CANDIDATE_DIRECTORY_KEY));
  await chrome.storage.local.remove(NATIVE_CANDIDATE_KEY);
}

export async function getCandidateDirectoryHandle() {
  const stored = await chrome.storage.local.get(NATIVE_CANDIDATE_KEY);
  if (stored[NATIVE_CANDIDATE_KEY]) return new NativeDirectoryHandle(stored[NATIVE_CANDIDATE_KEY]);
  return withStore("readonly", (store) => store.get(CANDIDATE_DIRECTORY_KEY));
}

export async function clearCandidateDirectoryHandle() {
  await withStore("readwrite", (store) => store.delete(CANDIDATE_DIRECTORY_KEY));
  await chrome.storage.local.remove(NATIVE_CANDIDATE_KEY);
}

export async function promoteCandidateDirectoryHandle() {
  const handle = await getCandidateDirectoryHandle();
  if (!handle) throw new Error("没有待切换的目录");
  await saveDirectoryHandle(handle);
  await clearCandidateDirectoryHandle();
  return handle;
}

export async function queryDirectoryPermission(handle, mode = "readwrite") {
  if (!handle) return "missing";
  if (typeof handle.queryPermission !== "function") return "unknown";
  try {
    return await handle.queryPermission({ mode });
  } catch (error) {
    if (handle.provider === "native") throw error;
    return "denied";
  }
}

export async function requestDirectoryPermission(handle, mode = "readwrite") {
  if (!handle) return "missing";
  if (typeof handle.requestPermission !== "function") return "unknown";
  return handle.requestPermission({ mode });
}
