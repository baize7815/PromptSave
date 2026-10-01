// Serialized by chrome.scripting; reuse a page's decoded image without copying its original bytes.
export async function readClickedImage(srcUrl, rules) {
  let image = null;
  for (const candidate of document.images) {
    if ((candidate.currentSrc === srcUrl || candidate.src === srcUrl) && candidate.complete && candidate.naturalWidth > 0) {
      image = candidate;
      break;
    }
  }
  if (!image) return { error: "PAGE_IMAGE_UNAVAILABLE" };
  const w = image.naturalWidth;
  const h = image.naturalHeight;
  if (w > 16384 || h > 16384 || w * h > rules.maxPixels) return { error: "IMAGE_DIMENSIONS_TOO_LARGE" };
  const maxW = w === h ? rules.squareWidth : w > h ? rules.landscapeWidth : rules.portraitWidth;
  const maxH = w === h ? rules.squareHeight : w > h ? rules.landscapeHeight : rules.portraitHeight;
  const scale = Math.min(1, maxW / w, maxH / h);
  const canvas = document.createElement("canvas");
  let best = null;
  try {
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return { error: "PAGE_IMAGE_UNAVAILABLE" };
    for (const shrink of [1, 0.8, 0.64]) {
      canvas.width = Math.max(1, Math.round(w * scale * shrink));
      canvas.height = Math.max(1, Math.round(h * scale * shrink));
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [rules.jpegQuality, 0.68, rules.minJpegQuality]) {
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
        if (!blob) return { error: "PAGE_IMAGE_UNAVAILABLE" };
        if (!best || blob.size < best.blob.size) best = { blob, width: canvas.width, height: canvas.height };
        if (blob.size <= rules.targetOutputBytes) break;
      }
      if (best.blob.size <= rules.targetOutputBytes) break;
    }
    if (!best || best.blob.size > rules.maxOutputBytes) return { error: "IMAGE_OUTPUT_TOO_LARGE" };
    const bytes = new Uint8Array(await best.blob.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    return { base64: btoa(binary), width: best.width, height: best.height, bytes: bytes.length, mime: "image/jpeg", processed: true };
  } catch (_) {
    return { error: "PAGE_IMAGE_UNAVAILABLE" };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    best = null;
  }
}
