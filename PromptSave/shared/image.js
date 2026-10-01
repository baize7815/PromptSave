import { IMAGE_RULES, appError } from "./constants.js";
import { inspectImageBlob } from "./image-header.js";

// Keep image decoding serial. A browser extension can otherwise hold several
// decompressed bitmaps at once even when the input files are small on disk.
const MAX_PENDING_IMAGE_TASKS = 2;
const imageTaskQueue = [];
let imageTaskActive = false;

export function computePreviewSize(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    throw appError("INVALID_IMAGE_SIZE", "图片尺寸无效");
  }

  let maxW;
  let maxH;
  if (w === h) {
    maxW = IMAGE_RULES.squareWidth;
    maxH = IMAGE_RULES.squareHeight;
  } else if (w > h) {
    maxW = IMAGE_RULES.landscapeWidth;
    maxH = IMAGE_RULES.landscapeHeight;
  } else {
    maxW = IMAGE_RULES.portraitWidth;
    maxH = IMAGE_RULES.portraitHeight;
  }

  const scale = Math.min(1, maxW / w, maxH / h);
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale))
  };
}

export function uint8ArrayToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

export function base64ToUint8Array(base64) {
  const binary = atob(String(base64 || ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return uint8ArrayToBase64(bytes);
}

export function isJpegBytes(bytes) {
  return bytes && bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 &&
    bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
}

async function processImageBlobNow(blob) {
  if (!(blob instanceof Blob)) throw appError("INVALID_IMAGE", "没有可处理的图片");
  const maxInputBytes = Number(IMAGE_RULES.maxInputBytes);
  if (Number.isFinite(maxInputBytes) && blob.size > maxInputBytes) {
    throw appError("IMAGE_TOO_LARGE", "原图超过大小限制");
  }

  // Check the encoded header before asking the browser to decode pixels. The
  // header helper also applies the input format and pixel-count limits.
  const inspected = await inspectImageBlob(blob);
  const inspectedWidth = Number(inspected && inspected.width);
  const inspectedHeight = Number(inspected && inspected.height);
  if (!Number.isFinite(inspectedWidth) || !Number.isFinite(inspectedHeight) ||
      inspectedWidth <= 0 || inspectedHeight <= 0) {
    throw appError("INVALID_IMAGE_SIZE", "图片尺寸无效");
  }
  const maxPixels = Number(IMAGE_RULES.maxPixels);
  if (Number.isFinite(maxPixels) && inspectedWidth * inspectedHeight > maxPixels) {
    throw appError("IMAGE_DIMENSIONS_TOO_LARGE", "图片像素尺寸过大");
  }

  const decodeTarget = computePreviewSize(inspectedWidth, inspectedHeight);
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob, {
      imageOrientation: "from-image",
      resizeWidth: decodeTarget.width,
      resizeHeight: decodeTarget.height,
      resizeQuality: "high"
    });
  } catch (error) {
    throw appError("IMAGE_DECODE_FAILED", "图片无法解码", String(error && error.message || error));
  }

  let canvas;
  try {
    if (!Number.isFinite(bitmap.width) || !Number.isFinite(bitmap.height) ||
        bitmap.width <= 0 || bitmap.height <= 0) {
      throw appError("INVALID_IMAGE_SIZE", "图片尺寸无效");
    }
    if (Number.isFinite(maxPixels) && bitmap.width * bitmap.height > maxPixels) {
      throw appError("IMAGE_DIMENSIONS_TOO_LARGE", "图片像素尺寸过大");
    }

    // Use the bitmap's dimensions after EXIF orientation has been applied.
    // This avoids writing a rotated image with the source aspect constraints.
    const initialTarget = computePreviewSize(bitmap.width, bitmap.height);
    canvas = new OffscreenCanvas(initialTarget.width, initialTarget.height);
    const targetOutputBytes = Number(IMAGE_RULES.targetOutputBytes);
    const maxOutputBytes = Number(IMAGE_RULES.maxOutputBytes);
    const jpegQuality = Number(IMAGE_RULES.jpegQuality);
    const minJpegQuality = Number(IMAGE_RULES.minJpegQuality);
    const qualitySteps = [...new Set([
      Number.isFinite(jpegQuality) ? jpegQuality : 0.76,
      0.68,
      Number.isFinite(minJpegQuality) ? minJpegQuality : 0.6
    ])].filter((quality) => Number.isFinite(quality) && quality > 0 && quality <= 1);
    const scaleSteps = [1, 0.8, 0.64];
    let finalOutput = null;
    let finalWidth = initialTarget.width;
    let finalHeight = initialTarget.height;

    for (const scale of scaleSteps) {
      const width = Math.max(1, Math.round(initialTarget.width * scale));
      const height = Math.max(1, Math.round(initialTarget.height * scale));
      finalWidth = width;
      finalHeight = height;

      for (const quality of qualitySteps) {
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { alpha: false, desynchronized: true });
        if (!context) throw appError("CANVAS_UNAVAILABLE", "无法创建图片画布");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, width, height);
        context.drawImage(bitmap, 0, 0, width, height);
        const output = await canvas.convertToBlob({ type: "image/jpeg", quality });
        finalOutput = output;

        const underTarget = !Number.isFinite(targetOutputBytes) || output.size <= targetOutputBytes;
        const underMaximum = !Number.isFinite(maxOutputBytes) || output.size <= maxOutputBytes;
        if (underTarget && underMaximum) {
          const base64 = await blobToBase64(output);
          return {
            base64,
            width,
            height,
            bytes: output.size,
            mime: "image/jpeg"
          };
        }
      }
    }

    // targetOutputBytes is a preferred target; maxOutputBytes is the hard
    // safety cap. A difficult image may remain above the preferred target
    // after the bounded attempts while still being safe to store.
    if (finalOutput && (!Number.isFinite(maxOutputBytes) || finalOutput.size <= maxOutputBytes)) {
      const base64 = await blobToBase64(finalOutput);
      return {
        base64,
        width: finalWidth,
        height: finalHeight,
        bytes: finalOutput.size,
        mime: "image/jpeg"
      };
    }

    // No more quality/size attempts are allowed. Do not create an oversized
    // base64 string or retain the last Blob when the safety cap was exceeded.
    if (finalOutput && Number.isFinite(maxOutputBytes) && finalOutput.size > maxOutputBytes) {
      throw appError("IMAGE_OUTPUT_TOO_LARGE", "压缩后的图片仍超过大小限制");
    }
    throw appError("IMAGE_OUTPUT_TOO_LARGE", "图片压缩未达到大小限制", {
      width: finalWidth,
      height: finalHeight
    });
  } finally {
    if (bitmap && typeof bitmap.close === "function") bitmap.close();
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}

function pumpImageTaskQueue() {
  if (imageTaskActive || imageTaskQueue.length === 0) return;
  imageTaskActive = true;
  const task = imageTaskQueue.shift();
  processImageBlobNow(task.blob).then(task.resolve, task.reject).finally(() => {
    imageTaskActive = false;
    pumpImageTaskQueue();
  });
}

export function processImageBlob(blob) {
  if (!(blob instanceof Blob)) return Promise.reject(appError("INVALID_IMAGE", "没有可处理的图片"));
  const maxInputBytes = Number(IMAGE_RULES.maxInputBytes);
  if (Number.isFinite(maxInputBytes) && blob.size > maxInputBytes) {
    return Promise.reject(appError("IMAGE_TOO_LARGE", "原图超过大小限制"));
  }
  if (imageTaskQueue.length >= MAX_PENDING_IMAGE_TASKS) {
    return Promise.reject(appError("IMAGE_PROCESSING_BUSY", "图片处理任务繁忙，请稍后重试"));
  }

  return new Promise((resolve, reject) => {
    imageTaskQueue.push({ blob, resolve, reject });
    pumpImageTaskQueue();
  });
}
