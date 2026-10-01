import { RESOURCE_RULES, appError } from "../shared/constants.js";
import { base64ToUint8Array } from "../shared/image.js";

const abort = () => new DOMException("Image request no longer visible", "AbortError");

export class ImageCache {
  entries = new Map();
  inflight = new Map();
  queue = [];
  active = 0;
  bytes = 0;
  generation = 0;
  expiryTimer = null;

  clear() {
    clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    this.generation++;
    this.entries.clear();
    this.inflight.clear();
    this.bytes = 0;
    for (const job of this.queue) job.reject(abort());
    this.queue = [];
  }

  scheduleExpiry() {
    clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    if (!this.entries.size) return;
    const firstExpiry = Math.min(...[...this.entries.values()].map((entry) => entry.time + 60000));
    this.expiryTimer = setTimeout(() => {
      for (const [key, entry] of this.entries) {
        if (Date.now() - entry.time < 60000) continue;
        this.entries.delete(key);
        this.bytes -= entry.value.blob.size;
      }
      this.scheduleExpiry();
    }, Math.max(1, firstExpiry - Date.now()));
  }

  get(key, loader, valid, priority = false) {
    const cached = this.entries.get(key);
    if (cached && Date.now() - cached.time < 60000) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return Promise.resolve({ ...cached.value, cacheHit: true });
    }
    if (cached) { this.entries.delete(key); this.bytes -= cached.value.blob.size; }
    const existing = this.inflight.get(key);
    if (existing) {
      existing.validators = existing.validators.filter((check) => check()).slice(-7);
      existing.validators.push(valid);
      return existing.promise;
    }
    for (let index = this.queue.length - 1; index >= 0; index--) {
      const job = this.queue[index];
      if (!job.validators.some((check) => check())) {
        this.queue.splice(index, 1);
        if (this.inflight.get(job.key) === job) this.inflight.delete(job.key);
        job.reject(abort());
      }
    }
    if (this.queue.length >= 8) return Promise.reject(appError("IMAGE_READ_BUSY", "图片加载任务繁忙，请稍后重试"));
    const job = { key, loader, validators: [valid], generation: this.generation };
    job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
    this.inflight.set(key, job);
    if (priority) this.queue.unshift(job);
    else this.queue.push(job);
    this.pump();
    return job.promise;
  }

  pump() {
    while (this.active < 2 && this.queue.length) {
      const job = this.queue.shift();
      if (!job.validators.some((check) => check()) || job.generation !== this.generation) {
        if (this.inflight.get(job.key) === job) this.inflight.delete(job.key);
        job.reject(abort());
        continue;
      }
      this.active++;
      Promise.resolve().then(job.loader).then((result) => {
        if (job.generation !== this.generation) throw abort();
        if (result.status !== "ok" || !result.base64) return { status: result.status };
        const blob = new Blob([base64ToUint8Array(result.base64)], { type: "image/jpeg" });
        const value = { status: "ok", blob, width: result.width, height: result.height, cacheHit: false };
        if (blob.size <= RESOURCE_RULES.uiImageCacheBytes) {
          while (this.entries.size && (this.entries.size >= RESOURCE_RULES.uiImageCacheCount ||
                 this.bytes + blob.size > RESOURCE_RULES.uiImageCacheBytes)) {
            const oldest = this.entries.keys().next().value;
            this.bytes -= this.entries.get(oldest).value.blob.size;
            this.entries.delete(oldest);
          }
          this.entries.set(job.key, { time: Date.now(), value });
          this.bytes += blob.size;
          this.scheduleExpiry();
        }
        return value;
      }).then(job.resolve, job.reject).finally(() => {
        if (this.inflight.get(job.key) === job) this.inflight.delete(job.key);
        this.active--;
        this.pump();
      });
    }
  }
}
