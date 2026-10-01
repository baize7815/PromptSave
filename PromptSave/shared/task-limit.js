import { appError } from "./constants.js";

export function createTaskLimiter(concurrency, maxQueued, code = "RESOURCE_BUSY") {
  let active = 0;
  const queue = [];
  function pump() {
    while (active < concurrency && queue.length) {
      const job = queue.shift();
      active++;
      Promise.resolve().then(job.task).then(job.resolve, job.reject).finally(() => {
        active--;
        pump();
      });
    }
  }
  return (task) => {
    if (active >= concurrency && queue.length >= maxQueued) {
      return Promise.reject(appError(code, "处理任务已达上限，请等待当前任务完成后重试"));
    }
    return new Promise((resolve, reject) => {
      queue.push({ task, resolve, reject });
      pump();
    });
  };
}
