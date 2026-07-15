/*
 * TuneFriend
 * Copyright (C) 2026 James
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

const FAVORITES_KEY = "tunefriend_favorites";

const DEFAULTS = {
  songs: {},
  albums: {},
};

const listeners = new Set();

function loadRaw() {
  try {
    const data = JSON.parse(localStorage.getItem(FAVORITES_KEY));
    return {
      songs: data?.songs && typeof data.songs === "object" ? data.songs : {},
      albums: data?.albums && typeof data.albums === "object" ? data.albums : {},
    };
  } catch {
    return { ...DEFAULTS, songs: {}, albums: {} };
  }
}

function saveRaw(data) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(data));
  listeners.forEach((cb) => cb());
}

export function onFavoritesChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function isSongFavorite(id) {
  return !!loadRaw().songs[id];
}

export function isAlbumFavorite(id) {
  return !!loadRaw().albums[id];
}

function songFavoriteRecord(song) {
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

export function toggleSongFavorite(song) {
  const data = loadRaw();
  if (data.songs[song.id]) {
    delete data.songs[song.id];
    saveRaw(data);
    return false;
  }
  data.songs[song.id] = songFavoriteRecord(song);
  saveRaw(data);
  return true;
}

/** Bulk-add songs to favorites (skips ones already favorited). Returns how many were new. */
export function addSongFavorites(songs) {
  if (!songs?.length) return 0;
  const data = loadRaw();
  let added = 0;
  for (const song of songs) {
    if (!song?.id || data.songs[song.id]) continue;
    data.songs[song.id] = songFavoriteRecord(song);
    added++;
  }
  if (added === 0) return 0;
  try {
    saveRaw(data);
    return added;
  } catch {
    // localStorage quota — keep existing favorites, report partial failure
    return -1;
  }
}

export function favoriteSongCount() {
  return Object.keys(loadRaw().songs).length;
}

export function toggleAlbumFavorite(album) {
  const data = loadRaw();
  if (data.albums[album.id]) {
    delete data.albums[album.id];
    saveRaw(data);
    return false;
  }
  data.albums[album.id] = {
    id: album.id,
    name: album.name,
    artist: album.artist,
    artistId: album.artistId,
    coverArt: album.coverArt,
    songCount: album.songCount,
    year: album.year,
  };
  saveRaw(data);
  return true;
}

export function getFavoriteSongs() {
  return Object.values(loadRaw().songs);
}

export function getFavoriteAlbums() {
  return Object.values(loadRaw().albums);
}

export function favoriteHeartSvg(active) {
  if (active) {
    return `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
}