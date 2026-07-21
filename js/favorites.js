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
  return { liked: {}, blocked: {}, blockedArtists: {}, likedArtists: {}, albums: {} };
}

function artistStorageKey(artist) {
  const id = sid(artist?.id);
  if (id && !id.startsWith("local:")) return id;
  const nk = normalizeArtistKey(artist?.name);
  return nk ? `name:${nk}` : "";
}

function artistRecord(artist) {
  return {
    id: sid(artist?.id) || "",
    name: artist?.name || "Unknown artist",
    nameKey: normalizeArtistKey(artist?.name),
  };
}

function normalizeArtistKey(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
      blockedArtists:
        data?.blockedArtists && typeof data.blockedArtists === "object"
          ? data.blockedArtists
          : {},
      likedArtists:
        data?.likedArtists && typeof data.likedArtists === "object"
          ? data.likedArtists
          : {},
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

function artistMatchesMap(map, artistId, artistName) {
  if (!map || typeof map !== "object") return false;
  const id = sid(artistId);
  if (id && map[id]) return true;
  const nk = normalizeArtistKey(artistName);
  if (!nk) return false;
  if (map[`name:${nk}`]) return true;
  for (const a of Object.values(map)) {
    if (a?.nameKey && a.nameKey === nk) return true;
    if (a?.name && normalizeArtistKey(a.name) === nk) return true;
  }
  return false;
}

/**
 * Artist blocked by id and/or normalized name (covers songs without artistId).
 */
export function isArtistBlocked(artistId, artistName) {
  return artistMatchesMap(loadRaw().blockedArtists, artistId, artistName);
}

export function isArtistLiked(artistId, artistName) {
  return artistMatchesMap(loadRaw().likedArtists, artistId, artistName);
}

/** @returns {"up"|"down"|"none"} */
export function getArtistRating(artistId, artistName) {
  if (isArtistBlocked(artistId, artistName)) return "down";
  if (isArtistLiked(artistId, artistName)) return "up";
  return "none";
}

/** True if song is blocked directly or via blocked artist. */
export function isSongPlayBlocked(song) {
  if (!song) return true;
  if (isSongBlocked(song.id)) return true;
  return isArtistBlocked(song.artistId, song.artist);
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

/**
 * Like/unlike whole artist on this device (clears block if set).
 * @returns {"up"|"none"}
 */
export function setArtistThumbsUp(artist) {
  const key = artistStorageKey(artist);
  if (!key) return "none";
  const data = loadRaw();
  if (data.likedArtists[key] || isArtistLiked(artist?.id, artist?.name)) {
    // Remove any matching liked keys for this artist
    for (const k of Object.keys(data.likedArtists)) {
      const a = data.likedArtists[k];
      if (
        k === key ||
        (artist?.id && sid(a?.id) === sid(artist.id)) ||
        (a?.nameKey && a.nameKey === normalizeArtistKey(artist?.name))
      ) {
        delete data.likedArtists[k];
      }
    }
    saveRaw(data);
    return "none";
  }
  // Clear block when liking
  for (const k of Object.keys(data.blockedArtists)) {
    const a = data.blockedArtists[k];
    if (
      k === key ||
      (artist?.id && sid(a?.id) === sid(artist.id)) ||
      (a?.nameKey && a.nameKey === normalizeArtistKey(artist?.name))
    ) {
      delete data.blockedArtists[k];
    }
  }
  data.likedArtists[key] = artistRecord(artist);
  saveRaw(data);
  return "up";
}

/**
 * Block/unblock whole artist on this device (clears like if set).
 * @returns {"down"|"none"}
 */
export function setArtistThumbsDown(artist) {
  const key = artistStorageKey(artist);
  if (!key) return "none";
  const data = loadRaw();
  if (data.blockedArtists[key] || isArtistBlocked(artist?.id, artist?.name)) {
    for (const k of Object.keys(data.blockedArtists)) {
      const a = data.blockedArtists[k];
      if (
        k === key ||
        (artist?.id && sid(a?.id) === sid(artist.id)) ||
        (a?.nameKey && a.nameKey === normalizeArtistKey(artist?.name))
      ) {
        delete data.blockedArtists[k];
      }
    }
    saveRaw(data);
    return "none";
  }
  // Clear like when blocking
  for (const k of Object.keys(data.likedArtists)) {
    const a = data.likedArtists[k];
    if (
      k === key ||
      (artist?.id && sid(a?.id) === sid(artist.id)) ||
      (a?.nameKey && a.nameKey === normalizeArtistKey(artist?.name))
    ) {
      delete data.likedArtists[k];
    }
  }
  data.blockedArtists[key] = artistRecord(artist);
  saveRaw(data);
  return "down";
}

export function unblockArtist(key) {
  const k = sid(key);
  const data = loadRaw();
  if (!k || !data.blockedArtists[k]) return false;
  delete data.blockedArtists[k];
  saveRaw(data);
  return true;
}

export function unlikeArtist(key) {
  const k = sid(key);
  const data = loadRaw();
  if (!k || !data.likedArtists[k]) return false;
  delete data.likedArtists[k];
  saveRaw(data);
  return true;
}

export function getBlockedArtists() {
  return Object.entries(loadRaw().blockedArtists).map(([key, a]) => ({
    key,
    id: a?.id || "",
    name: a?.name || "Unknown artist",
  }));
}

export function getLikedArtists() {
  return Object.entries(loadRaw().likedArtists).map(([key, a]) => ({
    key,
    id: a?.id || "",
    name: a?.name || "Unknown artist",
  }));
}

export function blockedArtistCount() {
  return Object.keys(loadRaw().blockedArtists).length;
}

export function likedArtistCount() {
  return Object.keys(loadRaw().likedArtists).length;
}

export function clearAllBlocked() {
  const data = loadRaw();
  data.blocked = {};
  data.blockedArtists = {};
  saveRaw(data);
}

export function clearAllLiked() {
  const data = loadRaw();
  data.liked = {};
  data.likedArtists = {};
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

/** Songs + artists blocked (for Settings badge). */
export function blockedTotalCount() {
  return blockedSongCount() + blockedArtistCount();
}

export function filterPlayableSongs(songs) {
  return (songs || []).filter((s) => {
    const id = sid(s?.id);
    if (!id) return false;
    return !isSongPlayBlocked(s);
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
