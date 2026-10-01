import { RESOURCE_RULES, appError } from "./constants.js";
import { inspectImageBlob } from "./image-header.js";

export function assertDatasetBudget(data) {
  if (data.items.length > RESOURCE_RULES.datasetItems ||
      new TextEncoder().encode(JSON.stringify(data, null, 2)).byteLength > RESOURCE_RULES.metadataBytes) {
    throw appError("DATASET_LIMIT", "单库超过 5000 条或 8 MiB 元数据限制，请拆分数据集；原数据未覆盖");
  }
}

export function imageWriteBytes(images) {
  let bytes = 0;
  for (const base64 of Object.values(images || {})) bytes += Math.ceil(String(base64 || "").length * 3 / 4);
  return bytes;
}

export function assertBulkImageBudget(bytes) {
  if (bytes > RESOURCE_RULES.bulkImageBytes) {
    throw appError("BULK_IMAGE_LIMIT", "本次图片总量超过 32 MiB 安全上限，请拆分数据集后重试");
  }
}

export async function inspectStoredImage(blob) {
  const dimensions = await inspectImageBlob(blob);
  if (dimensions.width * dimensions.height > RESOURCE_RULES.uiDecodedPixels) {
    throw appError("IMAGE_DIMENSIONS_TOO_LARGE", "旧图片超过展示像素上限，请重新收藏生成压缩图");
  }
  return dimensions;
}
