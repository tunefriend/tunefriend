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
      songs: data.songs?.length ? data.songs : null,
      syncedAt: data.syncedAt || null,
      albumCount: data.albums.length,
      songCount: data.songs?.length || data.songCount || 0,
    };
  } catch {
    return null;
  }
}

export function saveLibraryCache(albums, songs = null) {
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
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(payload));
  } catch {
    throw new Error("Library too large for phone storage — try again on Wi‑Fi or clear app data");
  }
  return payload;
}

export function clearLibraryCache() {
  localStorage.removeItem(LIBRARY_KEY);
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

  const result = saveLibraryCache(albums, songs);
  result.expectedSongCount = expectedSongs;
  return result;
}

export function formatSyncedAt(ts) {
  if (!ts) return "Never";
  const d = new Date(ts);
  return d.toLocaleString();
}