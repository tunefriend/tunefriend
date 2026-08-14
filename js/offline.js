/*
 * TuneFriend — offline song/album downloads
 * Copyright (C) 2026 James — GPL-3.0-or-later
 *
 * Native: OfflineStore plugin writes files under app private storage.
 * Web: IndexedDB blob store + object URLs for <audio>.
 */

import { isNativeApp } from "./api.js";

const META_KEY = "tunefriend_offline_meta";
const IDB_NAME = "tunefriend_offline";
const IDB_STORE = "tracks";

const listeners = new Set();
let metaCache = null;
let queue = Promise.resolve();
let downloading = new Set(); // song ids in progress

function notify() {
  listeners.forEach((cb) => {
    try { cb(); } catch { /* ignore */ }
  });
}

export function onOfflineChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function loadMeta() {
  if (metaCache) return metaCache;
  try {
    const raw = JSON.parse(localStorage.getItem(META_KEY) || "{}");
    metaCache = raw && typeof raw === "object" ? raw : {};
  } catch {
    metaCache = {};
  }
  return metaCache;
}

function saveMeta(data) {
  metaCache = data;
  try {
    localStorage.setItem(META_KEY, JSON.stringify(data));
  } catch {
    /* quota */
  }
  notify();
}

function songKey(id) {
  return id == null ? "" : String(id);
}

function getNativePlugin() {
  if (!isNativeApp()) return null;
  const cap = window.Capacitor;
  if (!cap) return null;
  if (typeof cap.registerPlugin === "function") {
    return cap.registerPlugin("OfflineStore");
  }
  return cap.Plugins?.OfflineStore ?? null;
}

function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
  });
}

async function idbPut(id, blob) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(blob, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(id) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(id) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** In-memory playable path/URL for sync player enrich (native file path or blob:). */
const pathCache = new Map();

export function getCachedOfflinePath(id) {
  const k = songKey(id);
  if (!k) return null;
  return pathCache.get(k) || null;
}

export function isOffline(id) {
  const k = songKey(id);
  if (!k) return false;
  return !!loadMeta()[k] || pathCache.has(k);
}

export function isDownloading(id) {
  return downloading.has(songKey(id));
}

export function getOfflineMeta(id) {
  return loadMeta()[songKey(id)] || null;
}

export function listOffline() {
  return Object.values(loadMeta()).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
}

export function offlineCount() {
  return Object.keys(loadMeta()).length;
}

export function offlineTotalBytes() {
  return listOffline().reduce((n, t) => n + (t.size || 0), 0);
}

export function formatBytes(n) {
  if (!n || n < 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Absolute file path (native) or blob: URL (web) for playback.
 * Returns null if not downloaded.
 */
export async function getOfflinePlayUrl(songId) {
  const k = songKey(songId);
  const meta = loadMeta()[k];
  if (!meta) return null;

  const plugin = getNativePlugin();
  if (plugin) {
    try {
      const ret = await plugin.getPath({ songId: k });
      if (ret?.exists && ret.path) return ret.path;
    } catch {
      /* fall through */
    }
    // Stale meta
    const data = loadMeta();
    delete data[k];
    saveMeta(data);
    return null;
  }

  // Web IndexedDB
  try {
    const blob = await idbGet(k);
    if (!blob) {
      const data = loadMeta();
      delete data[k];
      saveMeta(data);
      return null;
    }
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

function recordMeta(song, size, path) {
  const k = songKey(song.id);
  const data = loadMeta();
  data[k] = {
    id: k,
    title: song.title || "Unknown",
    artist: song.artist || "",
    album: song.album || "",
    albumId: song.albumId || "",
    coverArt: song.coverArt || "",
    duration: song.duration || 0,
    size: size || 0,
    path: path || "",
    savedAt: Date.now(),
  };
  saveMeta(data);
  if (path) pathCache.set(k, path);
}

async function downloadWithUrl(song, url) {
  const k = songKey(song.id);
  const plugin = getNativePlugin();
  if (plugin) {
    const ret = await plugin.download({ songId: k, url });
    recordMeta(song, ret.size || 0, ret.path || "");
    if (ret.path) pathCache.set(k, ret.path);
    return { ok: true, size: ret.size || 0 };
  }

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Download failed (${resp.status})`);
  const blob = await resp.blob();
  if (blob.size < 1000) throw new Error("Empty or invalid audio");
  await idbPut(k, blob);
  const prev = pathCache.get(k);
  if (prev?.startsWith("blob:")) {
    try { URL.revokeObjectURL(prev); } catch { /* ignore */ }
  }
  const objUrl = URL.createObjectURL(blob);
  pathCache.set(k, objUrl);
  recordMeta(song, blob.size, "");
  return { ok: true, size: blob.size };
}

/**
 * Download one song. primaryUrl = download.view preferred; fallbackUrl = stream.
 * @returns {{ ok: boolean, already?: boolean, size?: number }}
 */
export async function downloadSong(song, primaryUrl, fallbackUrl = null) {
  const k = songKey(song?.id);
  if (!k || !primaryUrl) throw new Error("Missing song or url");
  if (loadMeta()[k] || pathCache.has(k)) return { ok: true, already: true };
  if (downloading.has(k)) throw new Error("Already downloading");

  downloading.add(k);
  notify();
  try {
    try {
      return await downloadWithUrl(song, primaryUrl);
    } catch (e) {
      if (fallbackUrl && fallbackUrl !== primaryUrl) {
        return await downloadWithUrl(song, fallbackUrl);
      }
      throw e;
    }
  } finally {
    downloading.delete(k);
    notify();
  }
}

export async function removeOffline(songId) {
  const k = songKey(songId);
  if (!k) return false;
  const plugin = getNativePlugin();
  if (plugin) {
    try { await plugin.delete({ songId: k }); } catch { /* ignore */ }
  } else {
    try { await idbDelete(k); } catch { /* ignore */ }
  }
  const prev = pathCache.get(k);
  if (prev?.startsWith("blob:")) {
    try { URL.revokeObjectURL(prev); } catch { /* ignore */ }
  }
  pathCache.delete(k);
  const data = loadMeta();
  if (!data[k]) {
    notify();
    return false;
  }
  delete data[k];
  saveMeta(data);
  return true;
}

export async function clearAllOffline() {
  const plugin = getNativePlugin();
  if (plugin) {
    try { await plugin.clearAll(); } catch { /* ignore */ }
  } else {
    for (const t of listOffline()) {
      try { await idbDelete(t.id); } catch { /* ignore */ }
    }
  }
  for (const [, prev] of pathCache) {
    if (prev?.startsWith("blob:")) {
      try { URL.revokeObjectURL(prev); } catch { /* ignore */ }
    }
  }
  pathCache.clear();
  saveMeta({});
}

/** Warm path cache for player (call at startup and after downloads). */
export async function refreshOfflinePathCache() {
  pathCache.clear();
  for (const t of listOffline()) {
    const url = await getOfflinePlayUrl(t.id);
    if (url) pathCache.set(String(t.id), url);
  }
  notify();
}

/**
 * Download many songs sequentially.
 * urlsForSong(song) => { primary, fallback? } or a single URL string.
 * onProgress(done, total, song).
 */
export function downloadSongs(songs, urlsForSong, { onProgress } = {}) {
  const list = (songs || []).filter((s) => s?.id);
  const total = list.length;
  let done = 0;
  let added = 0;
  let skipped = 0;
  let failed = 0;

  const run = list.reduce((chain, song) => chain.then(async () => {
    try {
      if (loadMeta()[songKey(song.id)] || pathCache.has(songKey(song.id))) {
        skipped++;
      } else {
        const u = urlsForSong(song);
        const primary = typeof u === "string" ? u : u?.primary;
        const fallback = typeof u === "string" ? null : u?.fallback;
        await downloadSong(song, primary, fallback);
        added++;
      }
    } catch {
      failed++;
    }
    done++;
    onProgress?.(done, total, song);
  }), Promise.resolve());

  const job = queue.then(() => run).then(() => ({ added, skipped, failed, total }));
  queue = job.catch(() => {});
  return job;
}

/** Reconcile meta with native files (startup). */
export async function reconcileOfflineIndex() {
  const plugin = getNativePlugin();
  if (!plugin) {
    await refreshOfflinePathCache();
    return;
  }
  try {
    const ret = await plugin.list();
    const files = ret?.files || [];
    const byId = new Map();
    for (const f of files) {
      if (f.songId) byId.set(String(f.songId), f);
    }
    const data = loadMeta();
    let changed = false;
    for (const id of Object.keys(data)) {
      if (!byId.has(id)) {
        delete data[id];
        changed = true;
      } else {
        data[id].size = byId.get(id).size || data[id].size;
        data[id].path = byId.get(id).path || data[id].path;
      }
    }
    for (const [id, f] of byId) {
      if (!data[id]) {
        data[id] = {
          id,
          title: "Downloaded track",
          artist: "",
          album: "",
          albumId: "",
          coverArt: "",
          duration: 0,
          size: f.size || 0,
          path: f.path || "",
          savedAt: Date.now(),
        };
        changed = true;
      }
    }
    if (changed) saveMeta(data);
    else notify();
  } catch {
    /* ignore */
  }
  await refreshOfflinePathCache();
}

export function downloadIconSvg(state) {
  // state: "yes" | "busy" | "no"
  if (state === "yes") {
    return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/><path d="M12 3v10" opacity="0"/></svg>`;
  }
  if (state === "busy") {
    return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" class="spin"><circle cx="12" cy="12" r="9" stroke-dasharray="40" stroke-dashoffset="10"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>`;
}
