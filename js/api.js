/*
 * TuneFriend
 * Copyright (C) 2026 James
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { md5, randomSalt } from "./md5.js";
import { loadSettings } from "./settings.js";
import { secureSet, secureGet, secureRemove, secureClear } from "./secure-store.js";

const API_VERSION = "1.16.1";
const CLIENT = "TuneFriend";
const CLIENT_VERSION = "1.0";

/** Legacy cleartext blob (migrated away on first secure load). */
const LEGACY_CONFIG_KEY = "tunefriend_config";
/** Non-secret connection fields only (never password). */
const CONFIG_META_KEY = "tunefriend_config_meta";

/** In-memory config after initConfigStore() — loadConfig() is sync for app code. */
let configCache = null;
let configReady = false;

/** Subsonic JSON often returns a single object instead of a one-element array. */
export function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeServerUrl(url) {
  let u = url.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  return u;
}

export function isNativeApp() {
  return window.Capacitor?.isNativePlatform?.() === true;
}

/**
 * Load credentials into memory. Call once at app start before loadConfig().
 * Migrates legacy cleartext localStorage passwords into secure storage.
 */
export async function initConfigStore() {
  try {
    // 1) Legacy cleartext → migrate
    const legacyRaw = localStorage.getItem(LEGACY_CONFIG_KEY);
    if (legacyRaw) {
      try {
        const legacy = JSON.parse(legacyRaw);
        if (legacy && typeof legacy === "object") {
          await persistSecureConfig(legacy);
          localStorage.removeItem(LEGACY_CONFIG_KEY);
          configCache = {
            serverUrl: legacy.serverUrl || "",
            username: legacy.username || "",
            password: legacy.password || "",
            useProxy: legacy.useProxy,
          };
          configReady = true;
          return configCache;
        }
      } catch {
        localStorage.removeItem(LEGACY_CONFIG_KEY);
      }
    }

    // 2) Meta + secure password
    let meta = null;
    try {
      meta = JSON.parse(localStorage.getItem(CONFIG_META_KEY) || "null");
    } catch {
      meta = null;
    }
    if (!meta || !meta.serverUrl) {
      configCache = null;
      configReady = true;
      return null;
    }
    const password = (await secureGet("password")) || "";
    configCache = {
      serverUrl: meta.serverUrl || "",
      username: meta.username || "",
      password,
      useProxy: meta.useProxy,
    };
    configReady = true;
    return configCache;
  } catch {
    configCache = null;
    configReady = true;
    return null;
  }
}

async function persistSecureConfig(config) {
  const serverUrl = config?.serverUrl || "";
  const username = config?.username || "";
  const password = config?.password || "";
  const useProxy = config?.useProxy;

  // Never write password into localStorage
  localStorage.setItem(
    CONFIG_META_KEY,
    JSON.stringify({
      serverUrl,
      username,
      useProxy,
      // flag only — not the secret
      passwordStored: !!password,
    })
  );
  localStorage.removeItem(LEGACY_CONFIG_KEY);

  if (password) {
    await secureSet("password", password);
  } else {
    await secureRemove("password");
  }
  // Optional redundant copies under secure store for native restore without meta
  await secureSet("serverUrl", serverUrl);
  await secureSet("username", username);
}

/**
 * Persist connection settings. Password is encrypted (native Keystore / web AES-GCM).
 * @returns {Promise<void>}
 */
export async function saveConfig(config) {
  await persistSecureConfig(config || {});
  configCache = {
    serverUrl: config?.serverUrl || "",
    username: config?.username || "",
    password: config?.password || "",
    useProxy: config?.useProxy,
  };
  configReady = true;
}

/**
 * Sync read of in-memory config (after initConfigStore).
 * Returns null if not logged in / not initialized.
 */
export function loadConfig() {
  if (!configReady) {
    // Fallback: never return cleartext legacy password path without migration attempt
    try {
      const meta = JSON.parse(localStorage.getItem(CONFIG_META_KEY) || "null");
      if (meta?.serverUrl) {
        return {
          serverUrl: meta.serverUrl,
          username: meta.username || "",
          password: "", // not yet loaded from secure store
          useProxy: meta.useProxy,
        };
      }
    } catch {
      /* ignore */
    }
    return null;
  }
  return configCache ? { ...configCache } : null;
}

export async function clearConfig() {
  try {
    localStorage.removeItem(LEGACY_CONFIG_KEY);
    localStorage.removeItem(CONFIG_META_KEY);
  } catch {
    /* ignore */
  }
  try {
    await secureClear();
  } catch {
    try {
      await secureRemove("password");
      await secureRemove("serverUrl");
      await secureRemove("username");
    } catch {
      /* ignore */
    }
  }
  configCache = null;
  configReady = true;
}

export class SubsonicAPI {
  constructor({ serverUrl, username, password, useProxy }) {
    this.serverUrl = normalizeServerUrl(serverUrl);
    this.username = username;
    this.password = password;
    this.useProxy = useProxy ?? !isNativeApp();
  }

  _authParams({ json = false } = {}) {
    const salt = randomSalt();
    const token = md5(this.password + salt);
    const params = new URLSearchParams({
      u: this.username,
      t: token,
      s: salt,
      v: API_VERSION,
      c: CLIENT,
    });
    if (json) params.set("f", "json");
    return params;
  }

  async _fetch(endpoint, extra = {}) {
    const params = this._authParams({ json: true });
    for (const [k, v] of Object.entries(extra)) {
      if (v != null) params.set(k, String(v));
    }

    let url;
    if (this.useProxy) {
      url = `/api/proxy?server=${encodeURIComponent(this.serverUrl)}&endpoint=${encodeURIComponent(endpoint)}&${params}`;
    } else {
      url = `${this.serverUrl}/rest/${endpoint}?${params}`;
    }

    let res;
    try {
      res = await fetch(url);
    } catch (e) {
      throw new Error(e?.message || "Failed to fetch");
    }
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      if (!res.ok) {
        throw new Error(
          /1003/i.test(text)
            ? "Cloudflare blocked raw IP access. Use a hostname (e.g. music.tunefriend.org), not an IP."
            : `Server error: ${res.status}`
        );
      }
      throw new Error("Invalid response from server");
    }
    if (!res.ok) {
      throw new Error(data.error || data.message || `Server error: ${res.status}`);
    }
    const result = data["subsonic-response"];
    if (!result) throw new Error(data.error || "Invalid response from server");
    if (result.status === "failed") {
      throw new Error(result.error?.message || "Request failed");
    }
    return result;
  }

  async ping() {
    return this._fetch("ping.view");
  }

  async getArtists() {
    const r = await this._fetch("getArtists.view");
    const artists = [];
    for (const idx of asArray(r.indexes?.index)) {
      for (const a of asArray(idx.artist)) {
        if (a?.id) artists.push({ id: a.id, name: a.name, albumCount: a.albumCount });
      }
    }
    artists.sort((a, b) => a.name.localeCompare(b.name));
    return artists;
  }

  async getArtist(id) {
    const r = await this._fetch("getArtist.view", { id });
    const artist = r.artist;
    return {
      id: artist.id,
      name: artist.name,
      albums: asArray(artist.album).map((al) => ({
        id: al.id,
        name: al.name,
        artist: al.artist,
        artistId: al.artistId,
        coverArt: al.coverArt,
        songCount: al.songCount,
        year: al.year,
      })),
    };
  }

  async getAlbumList(type = "newest", size = 30, offset = 0, extra = {}) {
    const r = await this._fetch("getAlbumList2.view", { type, size, offset, ...extra });
    return asArray(r.albumList2?.album).map(mapAlbum);
  }

  async search3Page({
    query = '""',
    songCount = 0,
    songOffset = 0,
    albumCount = 0,
    albumOffset = 0,
    artistCount = 0,
    artistOffset = 0,
  } = {}) {
    const r = await this._fetch("search3.view", {
      query,
      songCount,
      songOffset,
      albumCount,
      albumOffset,
      artistCount,
      artistOffset,
    });
    return r.searchResult3 || r.searchResult || {};
  }

  /** Symfonium-style paginated song sync via search3 (OpenSubsonic empty query). */
  async getAllSongsViaSearch({ onProgress } = {}) {
    const queries = ['""', "*", "+"];
    for (const query of queries) {
      const songs = [];
      const seen = new Set();
      const pageSize = 500;
      let offset = 0;
      let gotPage = false;

      while (true) {
        const res = await this.search3Page({
          query,
          songCount: pageSize,
          songOffset: offset,
        });
        const batch = asArray(res.song).map(mapSong);
        if (!batch.length) break;
        gotPage = true;
        for (const s of batch) {
          if (seen.has(s.id)) continue;
          seen.add(s.id);
          songs.push(s);
        }
        onProgress?.(songs.length);
        if (batch.length < pageSize) break;
        offset += pageSize;
      }

      if (gotPage && songs.length) {
        songs.sort((a, b) => a.title.localeCompare(b.title));
        return songs;
      }
    }
    return [];
  }

  async paginateSearchAlbums(albumMap, { onProgress } = {}) {
    const queries = ['""', "*", "+"];
    for (const query of queries) {
      const pageSize = 500;
      let offset = 0;
      let gotPage = false;
      const before = albumMap.size;

      while (true) {
        const res = await this.search3Page({
          query,
          albumCount: pageSize,
          albumOffset: offset,
        });
        const batch = asArray(res.album).map(mapAlbum);
        if (!batch.length) break;
        gotPage = true;
        for (const al of batch) albumMap.set(al.id, al);
        onProgress?.(albumMap.size);
        if (batch.length < pageSize) break;
        offset += pageSize;
      }

      if (gotPage && albumMap.size > before) return;
    }
  }

  async scanAlbumsByYear(albumMap, { onProgress } = {}) {
    const endYear = new Date().getFullYear() + 1;
    for (let year = 1950; year <= endYear; year++) {
      try {
        let offset = 0;
        const size = 500;
        while (true) {
          const batch = await this.getAlbumList("byYear", size, offset, {
            fromYear: year,
            toYear: year,
          });
          for (const al of batch) albumMap.set(al.id, al);
          if (batch.length < size) break;
          offset += size;
        }
      } catch {
        /* year may have no albums */
      }
      if (year % 10 === 0) onProgress?.(albumMap.size);
    }
    onProgress?.(albumMap.size);
  }

  /**
   * Full album list — fast path: albumList2 + search3 (Symfonium-style).
   * Pass deep:true for artist/year scans when a server under-reports.
   */
  async getAllAlbums(type = "alphabeticalByName", { onProgress, deep = false } = {}) {
    const albumMap = new Map();

    const size = 500;
    let offset = 0;
    while (true) {
      const batch = await this.getAlbumList(type, size, offset);
      for (const al of batch) albumMap.set(al.id, al);
      onProgress?.(albumMap.size);
      if (batch.length < size) break;
      offset += size;
    }

    await this.paginateSearchAlbums(albumMap, { onProgress });

    if (deep) {
      const artists = await this.getArtists();
      const batchSize = 12;
      for (let i = 0; i < artists.length; i += batchSize) {
        const batch = artists.slice(i, i + batchSize);
        const results = await Promise.allSettled(batch.map((a) => this.getArtist(a.id)));
        for (const r of results) {
          if (r.status !== "fulfilled") continue;
          for (const al of r.value.albums) {
            if (!albumMap.has(al.id)) albumMap.set(al.id, mapAlbum(al));
          }
        }
        onProgress?.(albumMap.size);
      }

      await this.scanAlbumsByYear(albumMap, { onProgress });
    }

    const albums = [...albumMap.values()];
    albums.sort((a, b) => a.name.localeCompare(b.name));
    return albums;
  }

  async getAlbumWithRetry(id, retries = 3) {
    let lastErr;
    for (let i = 0; i < retries; i++) {
      try {
        return await this.getAlbum(id);
      } catch (e) {
        lastErr = e;
        if (i < retries - 1) await sleep(400 * (i + 1));
      }
    }
    throw lastErr;
  }

  async getAlbum(id) {
    const r = await this._fetch("getAlbum.view", { id });
    const album = r.album;
    return {
      id: album.id,
      name: album.name,
      artist: album.artist,
      artistId: album.artistId,
      coverArt: album.coverArt,
      year: album.year,
      songs: asArray(album.song).map(mapSong),
    };
  }

  async getRandomSongs(size = 50) {
    const r = await this._fetch("getRandomSongs.view", { size });
    return asArray(r.randomSongs?.song).map(mapSong);
  }

  async search(query) {
    // Request more artists — some Subsonic/Navidrome servers under-return artist hits
    const r = await this._fetch("search3.view", {
      query,
      songCount: 30,
      albumCount: 30,
      artistCount: 40,
    });
    const res = r.searchResult3 || r.searchResult || {};
    return {
      artists: asArray(res.artist).map((a) => ({
        id: a.id,
        name: a.name,
        albumCount: a.albumCount,
      })),
      albums: asArray(res.album).map((al) => ({
        id: al.id,
        name: al.name,
        artist: al.artist,
        artistId: al.artistId,
        coverArt: al.coverArt,
      })),
      songs: asArray(res.song).map(mapSong),
    };
  }

  async getAllSongsFromAlbums(albumList, { onProgress } = {}) {
    const songs = [];
    const seen = new Set();
    const batchSize = 10;
    const total = albumList.length;
    let failed = 0;

    for (let i = 0; i < albumList.length; i += batchSize) {
      const batch = albumList.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map((al) => this.getAlbumWithRetry(al.id)),
      );
      for (const r of results) {
        if (r.status !== "fulfilled") {
          failed++;
          continue;
        }
        for (const song of r.value.songs) {
          if (seen.has(song.id)) continue;
          seen.add(song.id);
          songs.push(song);
        }
      }
      onProgress?.(Math.min(i + batchSize, total), total, "albums", failed);
    }
    songs.sort((a, b) => a.title.localeCompare(b.title));
    return { songs, failed };
  }

  /**
   * Load all songs — prefer search3 pagination (fast, Symfonium-style).
   * Falls back to per-album walk only when search under-delivers.
   */
  async getAllSongs({ albums = null, onProgress, forceAlbumWalk = false } = {}) {
    let albumList = albums;
    if (!albumList?.length) {
      albumList = await this.getAllAlbums("alphabeticalByName", {
        onProgress: (n) => onProgress?.(0, n, "scan"),
      });
    }

    const expectedSongs = albumList.reduce((n, a) => n + (a.songCount || 0), 0);

    let viaSearch = [];
    try {
      viaSearch = await this.getAllSongsViaSearch({
        onProgress: (n) => onProgress?.(n, 0, "search"),
      });
    } catch {
      /* search3 may be unavailable on older Navidrome */
    }

    const searchLooksComplete =
      viaSearch.length > 0 &&
      (expectedSongs === 0
        ? viaSearch.length >= 200
        : viaSearch.length >= expectedSongs * 0.9 || viaSearch.length >= expectedSongs - 50);

    if (!forceAlbumWalk && searchLooksComplete) {
      return viaSearch;
    }

    let viaAlbums = [];
    if (albumList.length && (forceAlbumWalk || viaSearch.length < Math.max(100, expectedSongs * 0.5))) {
      const result = await this.getAllSongsFromAlbums(albumList, { onProgress });
      viaAlbums = result.songs;
    }

    const merged = new Map();
    for (const s of viaSearch) merged.set(s.id, s);
    for (const s of viaAlbums) merged.set(s.id, s);

    const songs = [...merged.values()];
    songs.sort((a, b) => a.title.localeCompare(b.title));
    return songs;
  }

  coverArtUrl(id, size = 300) {
    const params = this._authParams();
    params.set("id", id);
    params.set("size", String(size));
    if (this.useProxy) {
      return `/api/proxy?server=${encodeURIComponent(this.serverUrl)}&endpoint=getCoverArt.view&${params}`;
    }
    return `${this.serverUrl}/rest/getCoverArt.view?${params}`;
  }

  streamUrl(songId, { transcode } = {}) {
    const params = this._authParams();
    params.set("id", songId);
    // Transcoded streams can't be seeked in Android's native player — use original on device.
    const useTranscode = transcode ?? !isNativeApp();
    if (useTranscode) {
      params.set("maxBitRate", String(loadSettings().bitrate || 320));
    } else {
      params.set("estimateContentLength", "true");
    }
    if (this.useProxy) {
      return `/api/proxy?server=${encodeURIComponent(this.serverUrl)}&endpoint=stream.view&${params}`;
    }
    return `${this.serverUrl}/rest/stream.view?${params}`;
  }
}

function mapAlbum(al) {
  return {
    id: al.id,
    name: al.name || al.album || al.title || "Unknown",
    artist: al.artist,
    artistId: al.artistId,
    coverArt: al.coverArt,
    songCount: al.songCount,
    year: al.year,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mapSong(s) {
  return {
    id: s.id,
    title: s.title,
    artist: s.artist,
    artistId: s.artistId,
    album: s.album,
    albumId: s.albumId,
    coverArt: s.coverArt,
    duration: s.duration,
    track: s.track,
    year: s.year,
    genre: s.genre || "",
  };
}

export function formatDuration(seconds) {
  if (!seconds || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}