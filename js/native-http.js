import { isNativeApp } from "./api.js";

function base64ToBlob(base64, mime) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function getHttpPlugin() {
  return window.Capacitor?.Plugins?.CapacitorHttp ?? null;
}

export async function fetchStreamUrl(url) {
  if (!isNativeApp()) return url;

  const http = getHttpPlugin();
  if (!http) throw new Error("Native HTTP unavailable");

  const resp = await http.get({ url, responseType: "blob" });
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`Stream failed (${resp.status})`);
  }

  const headers = resp.headers || {};
  const mime = headers["Content-Type"] || headers["content-type"] || "audio/mpeg";

  if (typeof resp.data === "string" && resp.data.startsWith("{")) {
    throw new Error("Server returned error instead of audio");
  }

  const blob = base64ToBlob(resp.data, mime.split(";")[0].trim());
  if (blob.size < 1000) throw new Error("Empty or invalid audio stream");
  return URL.createObjectURL(blob);
}

export function revokeBlobUrl(url) {
  if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
}