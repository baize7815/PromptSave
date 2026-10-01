import { IMAGE_RULES, appError } from "./constants.js";

// Inspect a bounded header BEFORE asking the browser to allocate decoded pixels.
export async function inspectImageBlob(blob) {
  if (!(blob instanceof Blob) || !blob.size || blob.size > IMAGE_RULES.maxInputBytes) {
    throw appError("IMAGE_TOO_LARGE", "图片为空或超过 12 MiB 输入限制");
  }
  const bytes = new Uint8Array(await blob.slice(0, 256 * 1024).arrayBuffer());
  const view = new DataView(bytes.buffer);
  const fits = (offset, size) => offset >= 0 && offset + size <= bytes.length;
  const ascii = (offset, text) => fits(offset, text.length) &&
    [...text].every((character, index) => bytes[offset + index] === character.charCodeAt(0));
  let width = 0;
  let height = 0;
  let orientation = 1;
  if (ascii(0, "\x89PNG\r\n\x1a\n") && ascii(12, "IHDR") && fits(16, 8)) {
    width = view.getUint32(16); height = view.getUint32(20);
  } else if ((ascii(0, "GIF87a") || ascii(0, "GIF89a")) && fits(6, 4)) {
    width = view.getUint16(6, true); height = view.getUint16(8, true);
  } else if (ascii(0, "BM") && fits(14, 12)) {
    const header = view.getUint32(14, true);
    if (header === 12) {
      width = view.getUint16(18, true); height = view.getUint16(20, true);
    } else if (header >= 40 && fits(14, 40)) {
      width = view.getInt32(18, true); height = Math.abs(view.getInt32(22, true));
    }
  } else if (ascii(0, "RIFF") && ascii(8, "WEBP")) {
    for (let offset = 12; fits(offset, 8);) {
      const length = view.getUint32(offset + 4, true);
      const data = offset + 8;
      if (ascii(offset, "VP8X") && length >= 10 && fits(data, 10)) {
        width = 1 + bytes[data + 4] + (bytes[data + 5] << 8) + (bytes[data + 6] << 16);
        height = 1 + bytes[data + 7] + (bytes[data + 8] << 8) + (bytes[data + 9] << 16);
        break;
      }
      if (ascii(offset, "VP8 ") && length >= 10 && ascii(data + 3, "\x9d\x01\x2a") && fits(data, 10)) {
        width = view.getUint16(data + 6, true) & 0x3fff;
        height = view.getUint16(data + 8, true) & 0x3fff;
        break;
      }
      if (ascii(offset, "VP8L") && length >= 5 && fits(data, 5) && bytes[data] === 0x2f) {
        const bits = view.getUint32(data + 1, true);
        width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1;
        break;
      }
      offset = data + length + (length & 1);
    }
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let offset = 2; fits(offset, 2);) {
      if (bytes[offset++] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (!fits(offset, 2)) break;
      const length = view.getUint16(offset);
      if (length < 2 || !fits(offset, length)) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 8) {
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5);
      }
      if (marker === 0xe1 && ascii(offset + 2, "Exif\x00\x00")) {
        const tiff = offset + 8;
        const end = offset + length;
        const little = ascii(tiff, "II");
        if (tiff + 8 <= end && (little || ascii(tiff, "MM")) && view.getUint16(tiff + 2, little) === 42) {
          const directory = tiff + view.getUint32(tiff + 4, little);
          if (directory >= tiff && directory + 2 <= end) {
            const count = Math.min(view.getUint16(directory, little), 512);
            for (let index = 0; index < count; index++) {
              const entry = directory + 2 + index * 12;
              if (entry + 12 > end) break;
              if (view.getUint16(entry, little) === 0x112 && view.getUint16(entry + 2, little) === 3 &&
                  view.getUint32(entry + 4, little) === 1) orientation = view.getUint16(entry + 8, little);
            }
          }
        }
      }
      offset += length;
      if (width && height) break;
    }
  }
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw appError("IMAGE_DIMENSIONS_UNKNOWN", "无法安全识别图片尺寸，请使用 JPG、PNG、WebP、GIF 或 BMP；网页中已显示的图片可重试右键收藏");
  }
  if (width > 16384 || height > 16384 || width * height > IMAGE_RULES.maxPixels) {
    throw appError("IMAGE_DIMENSIONS_TOO_LARGE", "原图超过 2000 万像素或单边尺寸限制，已停止解码");
  }
  if (orientation >= 5 && orientation <= 8) [width, height] = [height, width];
  return { width, height };
}
