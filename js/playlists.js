/*
 * TuneFriend
 * Copyright (C) 2026 James
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

const PLAYLISTS_KEY = "tunefriend_playlists";

const listeners = new Set();

function loadRaw() {
  try {
    const data = JSON.parse(localStorage.getItem(PLAYLISTS_KEY));
    const list = Array.isArray(data?.playlists) ? data.playlists : [];
    return {
      playlists: list.map(normalizePlaylist).filter(Boolean),
    };
  } catch {
    return { playlists: [] };
  }
}

function normalizePlaylist(p) {
  if (!p?.id || !p?.name) return null;
  return {
    id: String(p.id),
    name: String(p.name),
    tracks: Array.isArray(p.tracks) ? p.tracks.filter((t) => t?.id) : [],
    createdAt: p.createdAt || Date.now(),
    updatedAt: p.updatedAt || p.createdAt || Date.now(),
  };
}

function saveRaw(data) {
  localStorage.setItem(PLAYLISTS_KEY, JSON.stringify({ playlists: data.playlists }));
  listeners.forEach((cb) => {
    try { cb(); } catch { /* ignore */ }
  });
}

function uid() {
  return `pl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function trackRecord(song) {
  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
    artistId: song.artistId,
    album: song.album,
    albumId: song.albumId,
    coverArt: song.coverArt,
    duration: song.duration,
    track: song.track,
    year: song.year,
    genre: song.genre || "",
  };
}

export function onPlaylistsChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getPlaylists() {
  return loadRaw().playlists.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export function getPlaylist(id) {
  return loadRaw().playlists.find((p) => p.id === id) || null;
}

export function createPlaylist(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) throw new Error("Name required");
  const data = loadRaw();
  const pl = {
    id: uid(),
    name: trimmed,
    tracks: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  data.playlists.push(pl);
  saveRaw(data);
  return pl;
}

export function renamePlaylist(id, name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) throw new Error("Name required");
  const data = loadRaw();
  const pl = data.playlists.find((p) => p.id === id);
  if (!pl) throw new Error("Playlist not found");
  pl.name = trimmed;
  pl.updatedAt = Date.now();
  saveRaw(data);
  return pl;
}

export function deletePlaylist(id) {
  const data = loadRaw();
  const before = data.playlists.length;
  data.playlists = data.playlists.filter((p) => p.id !== id);
  if (data.playlists.length === before) return false;
  saveRaw(data);
  return true;
}

/** Add songs; skips duplicates. Returns how many were newly added. */
export function addTracksToPlaylist(id, songs) {
  const data = loadRaw();
  const pl = data.playlists.find((p) => p.id === id);
  if (!pl) throw new Error("Playlist not found");
  const have = new Set(pl.tracks.map((t) => String(t.id)));
  let added = 0;
  for (const song of songs || []) {
    if (!song?.id || have.has(String(song.id))) continue;
    pl.tracks.push(trackRecord(song));
    have.add(String(song.id));
    added++;
  }
  if (added) {
    pl.updatedAt = Date.now();
    try {
      saveRaw(data);
    } catch {
      throw new Error("Storage full — remove tracks or free space");
    }
  }
  return added;
}

export function removeTrackFromPlaylist(playlistId, songId) {
  const data = loadRaw();
  const pl = data.playlists.find((p) => p.id === playlistId);
  if (!pl) return false;
  const before = pl.tracks.length;
  pl.tracks = pl.tracks.filter((t) => String(t.id) !== String(songId));
  if (pl.tracks.length === before) return false;
  pl.updatedAt = Date.now();
  saveRaw(data);
  return true;
}

export function playlistTrackCount(id) {
  return getPlaylist(id)?.tracks?.length || 0;
}
