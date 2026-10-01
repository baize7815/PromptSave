import { mergeDatasetMetadata } from "./model.js";
import { base64ToUint8Array } from "./image.js";

function textKey(item) {
  // Preserve deliberate differences in titles and prompt whitespace.
  return JSON.stringify([item.title, item.prompt, !!item.image]);
}

function sameImageRef(a, b) {
  return a.id === b.id && a.width === b.width && a.height === b.height && a.bytes === b.bytes;
}

async function imageHash(base64) {
  if (!base64) return null;
  const hash = await crypto.subtle.digest("SHA-256", base64ToUint8Array(base64));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function mergeImportBundle(current, imported, incomingByPath, backend) {
  const candidates = new Map();
  for (const item of current.items) {
    const key = textKey(item);
    if (!candidates.has(key)) candidates.set(key, []);
    candidates.get(key).push(item);
  }
  const imageStates = new Map();
  const accepted = [];
  const repairs = {};
  let skipped = 0;

  async function readImageState(item) {
    if (!imageStates.has(item)) {
      const result = await backend.readImage(item.image);
      // Keep fingerprints only; retaining every decoded response duplicates the entire library in memory.
      imageStates.set(item, { status: result.status, hash: await imageHash(result.base64) });
    }
    return imageStates.get(item);
  }

  for (const item of imported.items) {
    const key = textKey(item);
    const matches = candidates.get(key) || [];
    const incoming = item.image ? incomingByPath[item.image.path] || null : null;
    const incomingHash = await imageHash(incoming);
    let duplicate = null;
    for (const existing of matches) {
      if (!item.image) {
        duplicate = existing;
        break;
      }
      const stored = await readImageState(existing);
      const contentsMatch = incomingHash && stored.hash && incomingHash === stored.hash;
      const knownReference = sameImageRef(existing.image, item.image);
      // A missing ZIP image can match its original reference; unrelated missing files cannot.
      const canMatchReference = knownReference && (!incoming || ["missing", "corrupt"].includes(stored.status));
      if (!contentsMatch && !canMatchReference) continue;
      duplicate = existing;
      if (incoming && ["missing", "corrupt"].includes(stored.status)) {
        repairs[existing.image.id] = incoming;
        imageStates.set(existing, { status: "ok", hash: incomingHash });
      }
      break;
    }
    if (duplicate) {
      // Keep the destination's category, title, timestamps and Trash state.
      skipped += 1;
      continue;
    }
    accepted.push(item);
    if (!candidates.has(key)) candidates.set(key, []);
    candidates.get(key).push(item);
    if (item.image) imageStates.set(item, { status: incoming ? "ok" : "missing", hash: incomingHash });
  }

  const source = { ...imported, items: accepted };
  const merged = mergeDatasetMetadata(current, source);
  const imageWrites = { ...repairs };
  for (const item of accepted) {
    if (!item.image) continue;
    const base64 = incomingByPath[item.image.path];
    if (base64) imageWrites[merged.imageIdMap.get(item.image.id) || item.image.id] = base64;
  }
  return { data: merged.data, imageWrites, added: accepted.length, skipped, repaired: Object.keys(repairs).length, categoriesAdded: merged.data.categories.length - current.categories.length };
}
