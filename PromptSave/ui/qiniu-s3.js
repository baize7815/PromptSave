// Qiniu Kodo S3-compatible, single-object backup transport.
// The secret is never sent as plaintext: only AWS Signature V4 signatures leave this extension.
// NOTE: A browser extension is NOT a secure long-term secret vault.
import { ZIP_RULES, appError } from "../shared/constants.js";

export const CLOUD_OBJECT_KEY = "promptsave/backup.zip";
const encoder = new TextEncoder();
const EMPTY_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function toHex(bytes) {
  return Array.from(new Uint8Array(bytes), (v) => v.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(bytes) {
  return toHex(await crypto.subtle.digest("SHA-256", bytes));
}

async function hmac(key, message) {
  const raw = typeof key === "string" ? encoder.encode(key) : key;
  const imported = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", imported, encoder.encode(message)));
}

export function parseS3Endpoint(value) {
  let url;
  try { url = new URL(String(value || "").trim()); }
  catch (_) { throw appError("CLOUD_ENDPOINT_INVALID", "七牛 S3 地址无效"); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash) {
    throw appError("CLOUD_ENDPOINT_INVALID", "请输入完整的 HTTPS S3 域名，不要添加对象路径或参数");
  }
  // Only send credential-derived signatures to the recognized Qiniu S3 service.
  const match = /^([a-z0-9][a-z0-9-]*)\.s3\.([a-z0-9-]+)\.qiniucs\.com$/i.exec(url.hostname);
  if (!match) throw appError("CLOUD_ENDPOINT_INVALID", "地址应为 https://存储桶.s3.区域.qiniucs.com");
  return { origin: url.origin, host: url.host, bucket: match[1], region: match[2] };
}

async function signedRequest(method, config, body) {
  const { origin, host, region } = parseS3Endpoint(config.endpoint);
  const accessKey = String(config.accessKey || "").trim();
  const secretKey = String(config.secretKey || "").trim();
  if (!accessKey || !secretKey) throw appError("CLOUD_CREDENTIALS_MISSING", "请填写 AccessKey 和 SecretKey");
  if (!/^[A-Za-z0-9_-]+$/.test(accessKey)) throw appError("CLOUD_ACCESS_KEY_INVALID", "AccessKey 格式无效");
  const uri = "/" + CLOUD_OBJECT_KEY.split("/").map(encodeURIComponent).join("/");
  const url = origin + uri;
  const stamp = new Date().toISOString().replace(/[-:]|\.\d{3}/g, "");
  const day = stamp.slice(0, 8);
  const payloadHash = method === "PUT" ? await sha256Hex(await body.arrayBuffer()) : EMPTY_HASH;
  const canonicalHeaders = method === "PUT"
    ? `content-type:application/zip\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${stamp}\n`
    : `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${stamp}\n`;
  const signedHeaders = method === "PUT" ? "content-type;host;x-amz-content-sha256;x-amz-date" : "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [method, uri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", stamp, scope, await sha256Hex(encoder.encode(canonicalRequest))].join("\n");
  let signingKey = await hmac("AWS4" + secretKey, day);
  signingKey = await hmac(signingKey, region);
  signingKey = await hmac(signingKey, "s3");
  signingKey = await hmac(signingKey, "aws4_request");
  const signature = toHex(await hmac(signingKey, stringToSign));
  const headers = {
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": stamp,
    Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope},SignedHeaders=${signedHeaders},Signature=${signature}`
  };
  if (method === "PUT") headers["Content-Type"] = "application/zip";
  let response;
  try {
    response = await fetch(url, { method, headers, ...(method === "PUT" ? { body, cache: "no-store" } : { cache: "no-store" }) });
  } catch (_) {
    throw appError("CLOUD_NETWORK_ERROR", "无法连接七牛 S3，请检查网络或浏览器扩展的网络权限");
  }
  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    const xmlCode = /<Code>([A-Za-z0-9_-]+)<\/Code>/.exec(raw)?.[1];
    throw appError("CLOUD_HTTP_ERROR", `七牛云返回 HTTP ${response.status}${xmlCode ? " · " + xmlCode : ""}（请检查密钥、区域、空间权限）`);
  }
  return response;
}

export async function uploadCloudZip(config, blob) {
  if (!(blob instanceof Blob) || blob.size > ZIP_RULES.maxExportBytes) {
    throw appError("CLOUD_ZIP_INVALID", "ZIP 文件为空或超过 32 MiB 上限");
  }
  await signedRequest("PUT", config, blob);
  return CLOUD_OBJECT_KEY;
}

export async function downloadCloudZip(config) {
  const response = await signedRequest("GET", config);
  const declaredBytes = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(declaredBytes) && declaredBytes > ZIP_RULES.maxInputFileBytes) {
    await response.body?.cancel();
    throw appError("CLOUD_ZIP_TOO_LARGE", "云端 ZIP 超出 32 MiB 导入限制");
  }
  // Bound the total downloaded bytes even when Content-Length is missing.
  const reader = response.body?.getReader();
  if (!reader) throw appError("CLOUD_EMPTY_RESPONSE", "无法读取云端响应");
  const parts = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > ZIP_RULES.maxInputFileBytes) throw appError("CLOUD_ZIP_TOO_LARGE", "云端 ZIP 超出 32 MiB 导入限制");
      parts.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  return new File(parts, "promptsave-cloud.zip", { type: "application/zip" });
}
