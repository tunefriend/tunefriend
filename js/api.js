import { md5, randomSalt } from "./md5.js";
import { loadSettings } from "./settings.js";

const API_VERSION = "1.16.1";
const CLIENT = "TuneFriend";
const CLIENT_VERSION = "1.0";

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
    const indexes = r.indexes?.index || [];
    const artists = [];
    for (const idx of indexes) {
      for (const a of idx.artist || []) {
        artists.push({ id: a.id, name: a.name, albumCount: a.albumCount });
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
      albums: (artist.album || []).map((al) => ({
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

  async getAlbumList(type = "newest", size = 30) {
    const r = await this._fetch("getAlbumList2.view", { type, size });
    return (r.albumList2?.album || []).map((al) => ({
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
      songs: (album.song || []).map(mapSong),
    };
  }

  async getRandomSongs(size = 50) {
    const r = await this._fetch("getRandomSongs.view", { size });
    return (r.randomSongs?.song || []).map(mapSong);
  }

  async search(query) {
    const r = await this._fetch("search3.view", { query, songCount: 20, albumCount: 20, artistCount: 20 });
    const res = r.searchResult3 || r.searchResult || {};
    return {
      artists: (res.artist || []).map((a) => ({ id: a.id, name: a.name, albumCount: a.albumCount })),
      albums: (res.album || []).map((al) => ({
        id: al.id,
        name: al.name,
        artist: al.artist,
        artistId: al.artistId,
        coverArt: al.coverArt,
      })),
      songs: (res.song || []).map(mapSong),
    };
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

  streamUrl(songId) {
    const params = this._authParams();
    params.set("id", songId);
    params.set("maxBitRate", String(loadSettings().bitrate || 320));
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