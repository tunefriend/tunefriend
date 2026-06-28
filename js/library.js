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

export function loadLibraryCache() {
  try {
    const data = JSON.parse(localStorage.getItem(LIBRARY_KEY));
    if (!data?.albums?.length) return null;
    return {
      albums: data.albums,
      syncedAt: data.syncedAt || null,
      albumCount: data.albums.length,
    };
  } catch {
    return null;
  }
}

export function saveLibraryCache(albums) {
  const payload = {
    albums,
    syncedAt: Date.now(),
    albumCount: albums.length,
  };
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(payload));
  return payload;
}

export function clearLibraryCache() {
  localStorage.removeItem(LIBRARY_KEY);
}

export async function syncLibrary(api, { onProgress } = {}) {
  const albums = [];
  const size = 500;
  let offset = 0;

  while (true) {
    const batch = await api.getAlbumList("alphabeticalByName", size, offset);
    albums.push(...batch);
    onProgress?.(albums.length);
    if (batch.length < size) break;
    offset += size;
  }

  return saveLibraryCache(albums);
}

export function formatSyncedAt(ts) {
  if (!ts) return "Never";
  const d = new Date(ts);
  return d.toLocaleString();
}