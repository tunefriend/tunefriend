/*
 * TuneFriend
 * Copyright (C) 2026 James
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

const LIBRARY_KEY = "tunefriend_library";
const IDB_NAME = "tunefriend";
const IDB_STORE = "kv";

let memoryCache = null;

function normalizeCache(data) {
  if (!data?.albums?.length) return null;
  return {
    albums: data.albums,
    songs: data.songs?.length ? data.songs : null,
    syncedAt: data.syncedAt || null,
    albumCount: data.albums.length,
    songCount: data.songs?.length || data.songCount || 0,
  };
}

function openIdb() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(key) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function loadLibraryCacheSync() {
  try {
    const data = JSON.parse(localStorage.getItem(LIBRARY_KEY));
    return normalizeCache(data);
  } catch {
    return null;
  }
}

/** Load cache from IndexedDB (and migrate legacy localStorage). Call once at app start. */
export async function initLibraryCache() {
  let cache = null;
  try {
    const data = await idbGet(LIBRARY_KEY);
    cache = normalizeCache(data);
  } catch {
    /* IndexedDB unavailable */
  }

  if (!cache) {
    cache = loadLibraryCacheSync();
    if (cache) {
      try {
        await idbSet(LIBRARY_KEY, {
          albums: cache.albums,
          songs: cache.songs,
          syncedAt: cache.syncedAt,
          albumCount: cache.albumCount,
          songCount: cache.songCount,
        });
        localStorage.removeItem(LIBRARY_KEY);
      } catch {
        /* keep legacy copy */
      }
    }
  }

  memoryCache = cache;
  return cache;
}

export function loadLibraryCache() {
  if (memoryCache) return memoryCache;
  return loadLibraryCacheSync();
}

export async function saveLibraryCache(albums, songs = null) {
  const payload = {
    albums,
    syncedAt: Date.now(),
    albumCount: albums.length,
  };
  if (songs?.length) {
    payload.songs = songs;
    payload.songCount = songs.length;
  }

  try {
    await idbSet(LIBRARY_KEY, payload);
    memoryCache = normalizeCache(payload);
    try { localStorage.removeItem(LIBRARY_KEY); } catch { /* migrated */ }
    return payload;
  } catch {
    /* IndexedDB failed — try legacy localStorage */
  }

  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(payload));
    memoryCache = normalizeCache(payload);
    return payload;
  } catch {
    throw new Error(
      `Library too large to save (${payload.songCount || 0} songs). ` +
      "Update TuneFriend to the latest version, or free space and try again."
    );
  }
}

export async function clearLibraryCache() {
  memoryCache = null;
  try { localStorage.removeItem(LIBRARY_KEY); } catch { /* ignore */ }
  try { await idbDelete(LIBRARY_KEY); } catch { /* ignore */ }
}

export async function syncLibrary(api, { onProgress } = {}) {
  const albums = await api.getAllAlbums("alphabeticalByName", {
    onProgress: (n) => onProgress?.(`albums ${n}`),
  });
  const expectedSongs = albums.reduce((n, a) => n + (a.songCount || 0), 0);

  const songs = await api.getAllSongs({
    albums,
    onProgress: (done, total, phase) => {
      if (phase === "search") onProgress?.(`songs ${done} (search)`);
      else if (phase === "albums" && total) onProgress?.(`songs ${done}/${total}`);
      else onProgress?.(`songs ${done}`);
    },
  });

  const result = await saveLibraryCache(albums, songs);
  result.expectedSongCount = expectedSongs;
  return result;
}

export function formatSyncedAt(ts) {
  if (!ts) return "Never";
  const d = new Date(ts);
  return d.toLocaleString();
}