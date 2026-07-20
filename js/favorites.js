/*
 * TuneFriend — song ratings (thumbs up / thumbs down)
 * Copyright (C) 2026 James
 *
 * Thumbs up  = liked (replaces old favorites)
 * Thumbs down = blocked — never auto-play on this device
 *
 * Fresh start: clears legacy favorites storage on first load.
 */

const RATINGS_KEY = "tunefriend_ratings_v1";
const LEGACY_FAVORITES_KEY = "tunefriend_favorites";

const listeners = new Set();

function emptyData() {
  return { liked: {}, blocked: {}, albums: {} };
}

/** Wipe old hearts/favorites once so we start clean with thumbs. */
function migrateFresh() {
  try {
    if (localStorage.getItem(LEGACY_FAVORITES_KEY) != null) {
      localStorage.removeItem(LEGACY_FAVORITES_KEY);
    }
    // One-time flag so we don't keep wiping if user had empty ratings
    if (!localStorage.getItem(RATINGS_KEY)) {
      localStorage.setItem(RATINGS_KEY, JSON.stringify(emptyData()));
    }
  } catch {
    /* ignore */
  }
}

migrateFresh();

function loadRaw() {
  try {
    const data = JSON.parse(localStorage.getItem(RATINGS_KEY));
    return {
      liked: data?.liked && typeof data.liked === "object" ? data.liked : {},
      blocked: data?.blocked && typeof data.blocked === "object" ? data.blocked : {},
      albums: data?.albums && typeof data.albums === "object" ? data.albums : {},
    };
  } catch {
    return emptyData();
  }
}

function saveRaw(data) {
  localStorage.setItem(RATINGS_KEY, JSON.stringify(data));
  listeners.forEach((cb) => cb());
}

export function onFavoritesChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function onRatingsChange(cb) {
  return onFavoritesChange(cb);
}

/** Always string keys — HTML data-* and localStorage object keys are strings. */
function sid(id) {
  return id == null ? "" : String(id);
}

function songRecord(song) {
  return {
    id: sid(song.id),
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

export function isSongLiked(id) {
  const k = sid(id);
  return !!k && !!loadRaw().liked[k];
}

export function isSongBlocked(id) {
  const k = sid(id);
  return !!k && !!loadRaw().blocked[k];
}

/** @deprecated use isSongLiked */
export function isSongFavorite(id) {
  return isSongLiked(id);
}

export function isAlbumFavorite(id) {
  const k = sid(id);
  return !!k && !!loadRaw().albums[k];
}

/**
 * Set thumbs up. Clears thumbs down for that song.
 * Toggle off if already liked.
 * @returns {"up"|"none"}
 */
export function setSongThumbsUp(song) {
  const id = sid(song?.id);
  if (!id) return "none";
  const data = loadRaw();
  if (data.liked[id]) {
    delete data.liked[id];
    saveRaw(data);
    return "none";
  }
  delete data.blocked[id];
  data.liked[id] = songRecord(song);
  saveRaw(data);
  return "up";
}

/**
 * Set thumbs down (do not play). Clears thumbs up.
 * Toggle off if already blocked.
 * @returns {"down"|"none"}
 */
export function setSongThumbsDown(song) {
  const id = sid(song?.id);
  if (!id) return "none";
  const data = loadRaw();
  if (data.blocked[id]) {
    delete data.blocked[id];
    saveRaw(data);
    return "none";
  }
  delete data.liked[id];
  data.blocked[id] = songRecord(song);
  saveRaw(data);
  return "down";
}

/** @returns {"up"|"down"|"none"} */
export function getSongRating(id) {
  const k = sid(id);
  if (!k) return "none";
  const data = loadRaw();
  if (data.liked[k]) return "up";
  if (data.blocked[k]) return "down";
  return "none";
}

export function unblockSong(id) {
  const k = sid(id);
  const data = loadRaw();
  if (!k || !data.blocked[k]) return false;
  delete data.blocked[k];
  saveRaw(data);
  return true;
}

export function clearAllBlocked() {
  const data = loadRaw();
  data.blocked = {};
  saveRaw(data);
}

export function clearAllLiked() {
  const data = loadRaw();
  data.liked = {};
  saveRaw(data);
}

/** Full reset of ratings on this device */
export function clearAllRatings() {
  saveRaw(emptyData());
  try {
    localStorage.removeItem(LEGACY_FAVORITES_KEY);
  } catch {
    /* ignore */
  }
}

export function getLikedSongs() {
  return Object.values(loadRaw().liked);
}

export function getBlockedSongs() {
  return Object.values(loadRaw().blocked);
}

/** @deprecated use getLikedSongs */
export function getFavoriteSongs() {
  return getLikedSongs();
}

export function getFavoriteAlbums() {
  return Object.values(loadRaw().albums);
}

export function favoriteSongCount() {
  return Object.keys(loadRaw().liked).length;
}

export function blockedSongCount() {
  return Object.keys(loadRaw().blocked).length;
}

export function filterPlayableSongs(songs) {
  const data = loadRaw();
  return (songs || []).filter((s) => {
    const id = sid(s?.id);
    return id && !data.blocked[id];
  });
}

export function toggleAlbumFavorite(album) {
  const id = sid(album?.id);
  if (!id) return false;
  const data = loadRaw();
  if (data.albums[id]) {
    delete data.albums[id];
    saveRaw(data);
    return false;
  }
  data.albums[id] = {
    id,
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

/** Bulk thumbs-up (liked). Skips blocked. */
export function addSongFavorites(songs) {
  if (!songs?.length) return 0;
  const data = loadRaw();
  let added = 0;
  for (const song of songs) {
    const id = sid(song?.id);
    if (!id || data.liked[id] || data.blocked[id]) continue;
    data.liked[id] = songRecord(song);
    added++;
  }
  if (added === 0) return 0;
  try {
    saveRaw(data);
    return added;
  } catch {
    return -1;
  }
}

export function replaceSongFavorites(songs) {
  const data = loadRaw();
  data.liked = {};
  for (const song of songs || []) {
    const id = sid(song?.id);
    if (!id || data.blocked[id]) continue;
    data.liked[id] = songRecord(song);
  }
  try {
    saveRaw(data);
    return Object.keys(data.liked).length;
  } catch {
    return -1;
  }
}

export function clearSongFavorites() {
  clearAllLiked();
}

/** @deprecated */
export function toggleSongFavorite(song) {
  return setSongThumbsUp(song) === "up";
}

export function thumbsUpSvg(active) {
  if (active) {
    return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M2 20h2c.55 0 1-.45 1-1v-9c0-.55-.45-1-1-1H2v11zm19.83-7.12c.11-.25.17-.52.17-.8V11c0-1.1-.9-2-2-2h-5.5l.92-4.65c.05-.22.02-.46-.08-.66-.23-.45-.52-.86-.88-1.22L14 2 7.59 8.41C7.21 8.79 7 9.3 7 9.83v7.84C7 18.95 8.05 20 9.34 20h8.11c.7 0 1.36-.37 1.72-.97l2.66-6.15z"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>`;
}

export function thumbsDownSvg(active) {
  if (active) {
    return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M22 4h-2c-.55 0-1 .45-1 1v9c0 .55.45 1 1 1h2V4zM2.17 11.12c-.11.25-.17.52-.17.8V13c0 1.1.9 2 2 2h5.5l-.92 4.65c-.05.22-.02.46.08.66.23.45.52.86.88 1.22L10 22l6.41-6.41c.38-.38.59-.89.59-1.42V6.34C17 5.05 15.95 4 14.66 4H6.55c-.7 0-1.36.37-1.72.97l-2.66 6.15z"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>`;
}

/** @deprecated */
export function favoriteHeartSvg(active) {
  return thumbsUpSvg(active);
}

export function songRateButtonsHtml(songId) {
  const id = sid(songId);
  const rating = getSongRating(id);
  // Escape quotes for attribute safety
  const attr = id.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `
    <div class="rate-btns">
      <button type="button" class="rate-btn up${rating === "up" ? " active" : ""}" data-rate-up="${attr}" aria-label="Thumbs up" title="Like">${thumbsUpSvg(rating === "up")}</button>
      <button type="button" class="rate-btn down${rating === "down" ? " active" : ""}" data-rate-down="${attr}" aria-label="Thumbs down" title="Never play">${thumbsDownSvg(rating === "down")}</button>
    </div>
  `;
}
