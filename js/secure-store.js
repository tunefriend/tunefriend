/*
 * TuneFriend — secure secret helpers
 * Copyright (C) 2026 James — GPL-3.0-or-later
 *
 * Native (Android): Capacitor SecureStorage → EncryptedSharedPreferences + Keystore
 * Web: AES-GCM with a non-extractable CryptoKey in IndexedDB (better than plain localStorage)
 */

const IDB_NAME = "tunefriend_secure_v1";
const IDB_STORE = "keys";
const IDB_KEY = "aes";
const WEB_PREFIX = "tunefriend_sec_";

function isNativeApp() {
  return window.Capacitor?.isNativePlatform?.() === true;
}

function nativePlugin() {
  if (!isNativeApp()) return null;
  const cap = window.Capacitor;
  return cap?.Plugins?.SecureStorage
    || (cap?.registerPlugin && cap.registerPlugin("SecureStorage"))
    || null;
}

export async function secureSet(key, value) {
  const plugin = nativePlugin();
  if (plugin?.set) {
    await plugin.set({ key, value: value == null ? "" : String(value) });
    return;
  }
  await webSet(key, value == null ? "" : String(value));
}

export async function secureGet(key) {
  const plugin = nativePlugin();
  if (plugin?.get) {
    const ret = await plugin.get({ key });
    return ret?.value ?? null;
  }
  return webGet(key);
}

export async function secureRemove(key) {
  const plugin = nativePlugin();
  if (plugin?.remove) {
    await plugin.remove({ key });
    return;
  }
  try {
    localStorage.removeItem(WEB_PREFIX + key);
  } catch {
    /* ignore */
  }
}

export async function secureClear() {
  const plugin = nativePlugin();
  if (plugin?.clear) {
    await plugin.clear();
    return;
  }
  try {
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(WEB_PREFIX)) toRemove.push(k);
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

/* ── Web AES-GCM ─────────────────────────────────────────────────────────── */

function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
  });
}

async function getOrCreateWebKey() {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto unavailable");
  }
  const db = await openIdb();
  try {
    const existing = await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    if (existing) return existing;

    const key = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false, // non-extractable
      ["encrypt", "decrypt"]
    );
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      const req = tx.objectStore(IDB_STORE).put(key, IDB_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    return key;
  } finally {
    db.close();
  }
}

function b64encode(buf) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b64decode(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function webSet(key, value) {
  try {
    const cryptoKey = await getOrCreateWebKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(value);
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, encoded);
    const packed = b64encode(iv) + "." + b64encode(ct);
    localStorage.setItem(WEB_PREFIX + key, packed);
  } catch {
    // Last resort: still avoid writing password under the old cleartext config key.
    // Fail closed — do not store plain password in localStorage.
    throw new Error("Could not encrypt credentials in this browser");
  }
}

async function webGet(key) {
  try {
    const packed = localStorage.getItem(WEB_PREFIX + key);
    if (!packed) return null;
    const [ivB64, ctB64] = packed.split(".");
    if (!ivB64 || !ctB64) return null;
    const cryptoKey = await getOrCreateWebKey();
    const iv = b64decode(ivB64);
    const ct = b64decode(ctB64);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, cryptoKey, ct);
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}
