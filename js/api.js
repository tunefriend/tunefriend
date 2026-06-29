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

const API_VERSION = "1.16.1";
const CLIENT = "TuneFriend";
const CLIENT_VERSION = "1.0";

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

export function saveConfig(config) {
  localStorage.setItem("tunefriend_config", JSON.stringify(config));
}

export function loadConfig() {
  try {
    return JSON.parse(localStorage.getItem("tunefriend_config"));
  } catch {
    return null;
  }
}

export function clearConfig() {
  localStorage.removeItem("tunefriend_config");
}

export function isNativeApp() {
  return window.Capacitor?.isNativePlatform?.() === true;
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

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Server error: ${res.status}`);

    const data = await res.json();
    const result = data["subsonic-response"];
    if (!result) throw new Error("Invalid response from server");
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

  async getAlbumList(type = "newest", size = 30, offset = 0) {
    const r = await this._fetch("getAlbumList2.view", { type, size, offset });
    return asArray(r.albumList2?.album).map((al) => ({
      id: al.id,
      name: al.name,
      artist: al.artist,
      artistId: al.artistId,
      coverArt: al.coverArt,
      songCount: al.songCount,
      year: al.year,
    }));
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
    const r = await this._fetch("search3.view", { query, songCount: 20, albumCount: 20, artistCount: 20 });
    const res = r.searchResult3 || r.searchResult || {};
    return {
      artists: asArray(res.artist).map((a) => ({ id: a.id, name: a.name, albumCount: a.albumCount })),
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

  /** Load all songs — tries search first, then walks synced albums. */
  async getAllSongs({ albums = null, onProgress } = {}) {
    for (const q of ["*", "+"]) {
      try {
        const r = await this._fetch("search3.view", {
          query: q,
          songCount: 5000,
          albumCount: 0,
          artistCount: 0,
        });
        const res = r.searchResult3 || r.searchResult || {};
        const songs = asArray(res.song).map(mapSong);
        if (songs.length) {
          songs.sort((a, b) => a.title.localeCompare(b.title));
          return songs;
        }
      } catch {
        /* try next query or album walk */
      }
    }

    let albumList = albums;
    if (!albumList?.length) {
      albumList = await this.getAlbumList("alphabeticalByName", 500);
    }
    if (!albumList.length) return [];

    const songs = [];
    const batchSize = 8;
    for (let i = 0; i < albumList.length; i += batchSize) {
      const batch = albumList.slice(i, i + batchSize);
      const results = await Promise.all(batch.map((al) => this.getAlbum(al.id)));
      for (const album of results) songs.push(...album.songs);
      onProgress?.(Math.min(i + batchSize, albumList.length), albumList.length);
    }
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
  };
}

export function formatDuration(seconds) {
  if (!seconds || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}