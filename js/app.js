/*
 * TuneFriend
 * Copyright (C) 2026 James
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { SubsonicAPI, saveConfig, loadConfig, clearConfig, formatDuration, isNativeApp } from "./api.js";
import { Player, bindPlayerUI } from "./player.js";
import { setupMediaSession } from "./media-session.js";
import { loadSettings, saveSettings } from "./settings.js";
import {
  isSongLiked,
  isSongBlocked,
  isAlbumFavorite,
  setSongThumbsUp,
  setSongThumbsDown,
  getSongRating,
  toggleAlbumFavorite,
  getLikedSongs,
  getBlockedSongs,
  getFavoriteAlbums,
  thumbsUpSvg,
  thumbsDownSvg,
  songRateButtonsHtml,
  onFavoritesChange,
  addSongFavorites,
  replaceSongFavorites,
  favoriteSongCount,
  blockedSongCount,
  filterPlayableSongs,
  unblockSong,
  clearAllBlocked,
  clearAllLiked,
  clearAllRatings,
} from "./favorites.js";
import {
  loadLibraryCache,
  initLibraryCache,
  saveLibraryCache,
  syncLibrary,
  clearLibraryCache,
  formatSyncedAt,
} from "./library.js";
import { clearPlaybackSession } from "./session.js";
import { createBackNav } from "./back-nav.js";
import {
  getPlaylists,
  getPlaylist,
  createPlaylist,
  renamePlaylist,
  deletePlaylist,
  addTracksToPlaylist,
  removeTrackFromPlaylist,
  onPlaylistsChange,
} from "./playlists.js";

let api = null;
let currentTab = "home";
let tabRenderGen = 0;

/** Drill-down stack so Search → Artist → Album back returns correctly. */
let contentStack = [];
let lastSearchQuery = "";
let lastSearchData = null;

function isTabStale(gen, tab) {
  return gen !== tabRenderGen || currentTab !== tab;
}

const LIST_CHUNK = 100;
const ALBUM_CHUNK = 60;
const TAB_TITLES = { home: "Home", songs: "Songs", albums: "Albums", genres: "Genres" };

const GENRE_PRESETS = [
  { id: "rock", label: "Rock", patterns: ["rock"], exclude: ["alt", "alternative", "punk"] },
  { id: "pop", label: "Pop", patterns: ["pop"] },
  { id: "rap", label: "Rap / Hip-Hop", patterns: ["rap", "hip hop", "hip-hop", "hiphop", "trap"] },
  { id: "country", label: "Country", patterns: ["country"] },
  { id: "alt-rock", label: "Alt Rock", patterns: ["alt rock", "alternative rock", "alternative", "alt."] },
];

const DECADES = [1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020];

function pushContentFrame(frame) {
  contentStack.push(frame);
  backNav.setNavDepth(frame.depth || "drill");
}

function clearContentStack() {
  contentStack = [];
}

function songMatchesGenre(song, preset) {
  const g = String(song.genre || "").toLowerCase();
  if (!g) return false;
  const matched = preset.patterns.some((p) => g.includes(p));
  if (!matched) return false;
  // Keep "Rock" separate from Alt Rock / Punk tags
  if (preset.exclude?.some((x) => g.includes(x))) return false;
  return true;
}

function songsForGenre(songs, preset) {
  return songs.filter((s) => songMatchesGenre(s, preset));
}

function songsForDecade(songs, decadeStart) {
  return songs.filter((s) => {
    const y = Number(s.year);
    return y >= decadeStart && y <= decadeStart + 9;
  });
}

/**
 * Cap per-artist so huge discographies don't flood Shuffle All (50k library).
 */
function sampleDiverseSongs(songs, max = 900) {
  if (!songs?.length) return [];
  if (songs.length <= max) return songs;

  const byArtist = new Map();
  for (const s of songs) {
    const key = String(s.artist || s.artistId || "unknown").trim().toLowerCase();
    if (!byArtist.has(key)) byArtist.set(key, []);
    byArtist.get(key).push(s);
  }

  const maxPerArtist = Math.max(2, Math.min(6, Math.ceil(max / Math.max(byArtist.size, 1)) + 1));
  const pool = [];
  for (const list of byArtist.values()) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    pool.push(...list.slice(0, Math.min(list.length, maxPerArtist)));
  }
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, max);
}

function nextFrame() {
  return new Promise((r) => requestAnimationFrame(r));
}

const els = {
  audio: document.getElementById("audio"),
  content: document.getElementById("content"),
  pageTitle: document.getElementById("page-title"),
  loginForm: document.getElementById("login-form"),
  loginError: document.getElementById("login-error"),
  loginBtn: document.getElementById("login-btn"),
  nowPlaying: document.getElementById("now-playing"),
  npArt: document.getElementById("np-art"),
  npTitle: document.getElementById("np-title"),
  npArtist: document.getElementById("np-artist"),
  npPlay: document.getElementById("np-play"),
  npIconPlay: document.getElementById("np-icon-play"),
  npIconPause: document.getElementById("np-icon-pause"),
  playerScreen: document.getElementById("screen-player"),
  playerArt: document.getElementById("player-art"),
  playerTitle: document.getElementById("player-title"),
  playerArtist: document.getElementById("player-artist"),
  playerAlbum: document.getElementById("player-album"),
  progress: document.getElementById("progress"),
  timeCurrent: document.getElementById("time-current"),
  timeTotal: document.getElementById("time-total"),
  btnPlay: document.getElementById("btn-play"),
  iconPlay: document.getElementById("icon-play"),
  iconPause: document.getElementById("icon-pause"),
  btnPrev: document.getElementById("btn-prev"),
  btnNext: document.getElementById("btn-next"),
  btnShuffle: document.getElementById("btn-shuffle"),
  btnRepeat: document.getElementById("btn-repeat"),
  btnClosePlayer: document.getElementById("btn-close-player"),
  npExpand: document.getElementById("np-expand"),

};

const player = new Player(els.audio);
player.onError = (msg) => {
  if (player.isPlaying && msg === "Playback error") return;
  showToast(msg);
};
player.onPlaybackOk = () => dismissToast();
player.onLoading = (loading) => {
  document.getElementById("loading-overlay")?.classList.toggle("show", loading);
};
const playerUI = bindPlayerUI(player, () => api, { ...els, content: els.content });

function songsWithUrls(songs) {
  const transcode = !isNativeApp();
  // Never queue thumbs-down (blocked) songs on this device
  return filterPlayableSongs(songs).map((s) => ({
    ...s,
    streamUrl: api.streamUrl(s.id, { transcode }),
    coverArtUrl: s.coverArt ? api.coverArtUrl(s.coverArt, 512) : "",
  }));
}

function showBottomDock(show) {
  const dock = document.getElementById("bottom-dock");
  dock?.classList.toggle("hidden", !show);
  playerUI.updateDockHeight?.();
}

function dismissToast() {
  clearTimeout(showToast._t);
  document.getElementById("toast")?.classList.remove("show");
}

function showToast(msg) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    el.addEventListener("click", dismissToast);
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove("show"), 3500);
}

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  document.getElementById(id)?.classList.add("active");
}

function showLoading() {
  els.content.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
}

function showError(msg) {
  els.content.innerHTML = `<div class="empty-state">${escapeHtml(msg)}</div>`;
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function coverImg(coverArt, size = 300) {
  if (!coverArt) {
    return `<div class="album-cover placeholder"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg></div>`;
  }
  return `<img class="album-cover" src="${api.coverArtUrl(coverArt, size)}" alt="" loading="lazy" />`;
}

function renderAlbumCard(al) {
  return `
    <div class="album-card-wrap">
      <button class="album-card" data-album="${al.id}">
        <div class="album-cover-wrap">${coverImg(al.coverArt)}</div>
        <div class="album-name">${escapeHtml(al.name)}</div>
        <div class="album-artist">${escapeHtml(al.artist || "")}</div>
      </button>
      <button class="rate-btn up album-fav${isAlbumFavorite(al.id) ? " active" : ""}" data-fav-album="${al.id}" aria-label="Like album">${thumbsUpSvg(isAlbumFavorite(al.id))}</button>
    </div>
  `;
}

function renderAlbumGrid(albums) {
  if (!albums.length) return '<div class="empty-state">No albums found</div>';
  return `<div class="album-grid">${albums.map((al) => renderAlbumCard(al)).join("")}</div>`;
}

function renderAlbumGridSlice(albums, start, count) {
  const end = Math.min(start + count, albums.length);
  let html = "";
  for (let i = start; i < end; i++) html += renderAlbumCard(albums[i]);
  return html;
}

function renderSongItem(s, i, showAlbum = false) {
  const currentId = player.current?.id;
  return `
    <li class="song-item${s.id === currentId ? " playing" : ""}" data-song-idx="${i}" data-song-id="${s.id}">
      <span class="song-num">${s.track || i + 1}</span>
      <div class="song-info">
        <div class="song-title">${escapeHtml(s.title)}</div>
        <div class="song-sub">${escapeHtml(showAlbum ? s.album : s.artist)}</div>
      </div>
      ${songRateButtonsHtml(s.id)}
      <span class="song-dur">${formatDuration(s.duration)}</span>
    </li>
  `;
}

function renderSongList(songs, showAlbum = false) {
  if (!songs.length) return '<div class="empty-state">No songs found</div>';
  return `<ul class="song-list">${songs.map((s, i) => renderSongItem(s, i, showAlbum)).join("")}</ul>`;
}

function renderSongListSlice(songs, start, count, showAlbum = false) {
  const end = Math.min(start + count, songs.length);
  let html = "";
  for (let i = start; i < end; i++) html += renderSongItem(songs[i], i, showAlbum);
  return html;
}

async function mountSongListIncremental(songs, listEl, gen, showAlbum = true) {
  for (let i = 0; i < songs.length; i += LIST_CHUNK) {
    if (gen != null && isTabStale(gen, "songs")) return false;
    listEl.insertAdjacentHTML("beforeend", renderSongListSlice(songs, i, LIST_CHUNK, showAlbum));
    if (i + LIST_CHUNK < songs.length) await nextFrame();
  }
  return true;
}

async function mountAlbumGridIncremental(albums, gridEl, gen) {
  for (let i = 0; i < albums.length; i += ALBUM_CHUNK) {
    if (gen != null && isTabStale(gen, "albums")) return false;
    gridEl.insertAdjacentHTML("beforeend", renderAlbumGridSlice(albums, i, ALBUM_CHUNK));
    if (i + ALBUM_CHUNK < albums.length) await nextFrame();
  }
  return true;
}

function getSongsWithUrls(container) {
  if (!container._songsWithUrls && container._listSongs?.length) {
    container._songsWithUrls = songsWithUrls(container._listSongs);
  }
  return container._songsWithUrls;
}

function bindListData(container, songs = [], albums = []) {
  container._listSongs = songs;
  container._listAlbums = albums;
  container._songsWithUrls = null;
  setupContentDelegation(container);
}

function songIdEq(a, b) {
  return a != null && b != null && String(a) === String(b);
}

function findListSong(container, id) {
  return container?._listSongs?.find((s) => songIdEq(s.id, id)) || null;
}

function findListAlbum(container, id) {
  return container?._listAlbums?.find((a) => songIdEq(a.id, id)) || null;
}

function setupContentDelegation(container) {
  if (container._delegated) return;
  container._delegated = true;
  container.addEventListener("click", (e) => {
    const upBtn = e.target.closest("[data-rate-up]");
    if (upBtn) {
      e.preventDefault();
      e.stopPropagation();
      const song = findListSong(container, upBtn.dataset.rateUp);
      if (!song) {
        showToast("Could not rate — try again");
        return;
      }
      handleSongThumbsUp(song, container);
      return;
    }
    const downBtn = e.target.closest("[data-rate-down]");
    if (downBtn) {
      e.preventDefault();
      e.stopPropagation();
      const song = findListSong(container, downBtn.dataset.rateDown);
      if (!song) {
        showToast("Could not rate — try again");
        return;
      }
      handleSongThumbsDown(song, container);
      return;
    }
    const favAlbum = e.target.closest("[data-fav-album]");
    if (favAlbum) {
      e.preventDefault();
      e.stopPropagation();
      const album = findListAlbum(container, favAlbum.dataset.favAlbum);
      if (!album) return;
      const added = toggleAlbumFavorite(album);
      favAlbum.classList.toggle("active", added);
      favAlbum.innerHTML = thumbsUpSvg(added);
      showToast(added ? "Liked album" : "Removed album like");
      return;
    }
    const albumBtn = e.target.closest("[data-album]");
    if (albumBtn) {
      if (currentTab === "search") ensureSearchOnStack();
      openAlbum(albumBtn.dataset.album, {
        fromScreen: container._albumFromScreen,
        skipPush: !!container._albumFromScreen,
      });
      return;
    }
    const songItem = e.target.closest("[data-song-idx]");
    if (songItem && container._listSongs?.length) {
      const withUrls = getSongsWithUrls(container);
      player.play(withUrls, parseInt(songItem.dataset.songIdx, 10));
      highlightPlaying();
    }
  });
}

function attachAlbumClicks(container, fromScreen) {
  if (fromScreen) container._albumFromScreen = fromScreen;
  if ((container._listAlbums?.length || 0) > 30) return;
  container.querySelectorAll("[data-album]").forEach((el) => {
    el.addEventListener("click", () => {
      if (currentTab === "search") ensureSearchOnStack();
      openAlbum(el.dataset.album, {
        fromScreen: container._albumFromScreen,
        skipPush: !!container._albumFromScreen,
      });
    });
  });
}

function refreshAllRateButtonsForSong(songId) {
  const want = String(songId);
  const rating = getSongRating(want);
  document.querySelectorAll(".rate-btns").forEach((wrap) => {
    const up = wrap.querySelector("[data-rate-up]");
    const down = wrap.querySelector("[data-rate-down]");
    const id = up?.dataset?.rateUp;
    if (id == null || String(id) !== want) return;
    if (up) {
      up.classList.toggle("active", rating === "up");
      up.innerHTML = thumbsUpSvg(rating === "up");
    }
    if (down) {
      down.classList.toggle("active", rating === "down");
      down.innerHTML = thumbsDownSvg(rating === "down");
    }
  });
}

function handleSongThumbsUp(song, container) {
  if (!song?.id) {
    showToast("No song to rate");
    return;
  }
  const result = setSongThumbsUp(song);
  refreshAllRateButtonsForSong(song.id);
  updatePlayingRating(player.current);
  showToast(result === "up" ? "Liked" : "Like removed");
}

function handleSongThumbsDown(song, container) {
  if (!song?.id) {
    showToast("No song to rate");
    return;
  }
  const result = setSongThumbsDown(song);
  refreshAllRateButtonsForSong(song.id);
  updatePlayingRating(player.current);
  if (result === "down") {
    showToast("Won't play again on this device");
    if (songIdEq(player.current?.id, song.id)) {
      try {
        player.next();
      } catch {
        /* ignore */
      }
    }
  } else {
    showToast("Unblocked — can play again");
  }
  renderBlockedSettingsList();
}

function attachFavoriteHandlers(container, songs = [], albums = []) {
  // Single path: delegated clicks + string id match (avoids double-handlers and
  // number-vs-string Subsonic id bugs with HTML data-* attributes).
  bindListData(container, songs, albums);
}

function attachSongClicks(container, songs) {
  if (songs.length > 30) {
    bindListData(container, songs, container._listAlbums || []);
    return;
  }
  const withUrls = songsWithUrls(songs);
  container.querySelectorAll("[data-song-idx]").forEach((el) => {
    el.addEventListener("click", () => {
      player.play(withUrls, parseInt(el.dataset.songIdx, 10));
      highlightPlaying();
    });
  });
}

function attachPlayButtons(container, songs) {
  container.querySelector("#btn-play-all")?.addEventListener("click", () => {
    player.playAll(songsWithUrls(songs));
  });
  container.querySelector("#btn-shuffle-album")?.addEventListener("click", () => {
    player.playShuffled(songsWithUrls(songs));
  });
}

function highlightPlaying() {
  const prev = els.content.querySelector(".song-item.playing");
  prev?.classList.remove("playing");
  const id = player.current?.id;
  if (id == null) return;
  // Attribute selector — string match for numeric ids
  els.content.querySelector(`.song-item[data-song-id="${CSS.escape?.(String(id)) ?? String(id)}"]`)?.classList.add("playing");
}

function updatePlayingRating(song) {
  const rating = song ? getSongRating(song.id) : "none";
  const pairs = [
    [document.getElementById("np-thumb-up"), document.getElementById("np-thumb-down")],
    [document.getElementById("btn-thumb-up"), document.getElementById("btn-thumb-down")],
  ];
  for (const [up, down] of pairs) {
    if (up) {
      up.disabled = !song;
      up.classList.toggle("active", rating === "up");
      up.innerHTML = thumbsUpSvg(rating === "up");
    }
    if (down) {
      down.disabled = !song;
      down.classList.toggle("active", rating === "down");
      down.innerHTML = thumbsDownSvg(rating === "down");
    }
  }
}

function onPlayingThumbsUp(e) {
  e?.preventDefault?.();
  e?.stopPropagation?.();
  const song = player.current;
  if (!song?.id) {
    showToast("Play a song first");
    return;
  }
  handleSongThumbsUp(song);
}

function onPlayingThumbsDown(e) {
  e?.preventDefault?.();
  e?.stopPropagation?.();
  const song = player.current;
  if (!song?.id) {
    showToast("Play a song first");
    return;
  }
  handleSongThumbsDown(song);
}

// Capture phase so mini-player thumbs win over parent handlers
for (const id of ["np-thumb-up", "np-thumb-down", "btn-thumb-up", "btn-thumb-down"]) {
  const el = document.getElementById(id);
  if (!el) continue;
  const handler = id.endsWith("down") ? onPlayingThumbsDown : onPlayingThumbsUp;
  el.addEventListener("click", handler, true);
}

const _origTrackChange = player.onTrackChange;
player.onTrackChange = (song) => {
  // Skip blocked tracks if they somehow enter the queue
  if (song?.id && isSongBlocked(song.id)) {
    try {
      player.next();
    } catch {
      /* ignore */
    }
    return;
  }
  _origTrackChange?.(song);
  highlightPlaying();
  updatePlayingRating(song);
};

function captureSearchFrame() {
  return {
    depth: "search",
    restore: () => {
      currentTab = "search";
      document.querySelectorAll(".nav-item").forEach((n) => {
        n.classList.toggle("active", n.dataset.tab === "home");
      });
      renderSearch({ restoreQuery: lastSearchQuery, restoreData: lastSearchData });
      backNav.setNavDepth("search");
      backNav.updateMainBackButton?.();
    },
  };
}

function captureArtistFrame(id, name) {
  return {
    depth: "artist",
    restore: () => openArtist(id, name, { skipPush: true }),
  };
}

function captureGenreListFrame() {
  return {
    depth: "genres",
    restore: () => {
      currentTab = "genres";
      document.querySelectorAll(".nav-item").forEach((n) => {
        n.classList.toggle("active", n.dataset.tab === "genres");
      });
      renderGenres();
      backNav.setNavDepth("root");
      backNav.updateMainBackButton?.();
    },
  };
}

function ensureSearchOnStack() {
  if (currentTab !== "search") return;
  if (contentStack.some((f) => f.depth === "search")) return;
  pushContentFrame(captureSearchFrame());
}

function popMainContent() {
  const returnTo = backNav.consumeReturnScreen();
  if (returnTo) {
    clearContentStack();
    backNav.setNavDepth("root");
    showScreen(returnTo);
    return;
  }

  const prev = contentStack.pop();
  if (prev?.restore) {
    prev.restore();
    return;
  }

  backNav.setNavDepth("root");
  if (currentTab === "search") {
    switchTab(backNav.getLastMainTab() || "home", { fromBack: true });
    return;
  }
  tabRenderers[currentTab]?.();
  backNav.updateMainBackButton?.();
}

let playlistViewId = null; // null = list, else open playlist detail

const backNav = createBackNav({
  getActiveScreen: () => document.querySelector(".screen.active")?.id,
  getCurrentTab: () => currentTab,
  onBackFromPlayer: () => showScreen("screen-main"),
  onBackFromFavorites: () => showScreen("screen-main"),
  onBackFromPlaylists: () => {
    if (playlistViewId) {
      playlistViewId = null;
      renderPlaylistsScreen();
      return;
    }
    showScreen("screen-main");
  },
  onBackFromSettings: (tab) => {
    showScreen("screen-main");
    if (tab && tab !== "settings") switchTab(tab, { fromBack: true });
  },
  onBackFromMainDrillDown: () => popMainContent(),
  onBackToHome: () => switchTab("home", { fromBack: true }),
});

async function openAlbum(id, { fromScreen, skipPush = false } = {}) {
  if (fromScreen) {
    showScreen("screen-main");
    backNav.setReturnScreen(fromScreen);
  } else if (!skipPush) {
    ensureSearchOnStack();
  }
  backNav.setNavDepth("album");
  showLoading();
  els.pageTitle.textContent = "Album";
  try {
    const album = await api.getAlbum(id);
    const art = album.coverArt
      ? `<img src="${api.coverArtUrl(album.coverArt, 300)}" alt="" style="width:120px;height:120px;border-radius:14px;object-fit:cover;background:var(--bg-card)" />`
      : `<div class="artist-avatar" style="width:120px;height:120px;border-radius:14px"><svg viewBox="0 0 24 24" fill="currentColor" width="48" height="48"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg></div>`;
    els.content.innerHTML = `
      <div class="detail-header">
        ${art}
        <div class="meta">
          <h3>${escapeHtml(album.name)}</h3>
          <p>${escapeHtml(album.artist)}${album.year ? ` · ${album.year}` : ""}</p>
        </div>
        <button class="rate-btn up detail-fav${isAlbumFavorite(album.id) ? " active" : ""}" data-fav-album="${album.id}" aria-label="Like album">${thumbsUpSvg(isAlbumFavorite(album.id))}</button>
      </div>
      <div class="album-actions">
        <button class="quick-btn primary" id="btn-play-all">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          Play All
        </button>
        <button class="quick-btn secondary" id="btn-shuffle-album">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>
          Shuffle
        </button>
      </div>
      ${renderSongList(album.songs)}
    `;
    attachSongClicks(els.content, album.songs);
    attachPlayButtons(els.content, album.songs);
    attachFavoriteHandlers(els.content, album.songs, [album]);
  } catch (e) {
    showError(e.message);
  }
}

async function openArtist(id, name, { skipPush = false } = {}) {
  if (!skipPush) ensureSearchOnStack();
  backNav.setNavDepth("artist");
  showLoading();
  els.pageTitle.textContent = name || "Artist";
  try {
    const artist = await api.getArtist(id);
    els.content.innerHTML = `
      <div class="section-title">${escapeHtml(artist.name)}</div>
      ${renderAlbumGrid(artist.albums)}
    `;
    attachFavoriteHandlers(els.content, [], artist.albums);
    els.content.querySelectorAll("[data-album]").forEach((el) => {
      el.addEventListener("click", () => {
        pushContentFrame(captureArtistFrame(id, artist.name));
        openAlbum(el.dataset.album, { skipPush: true });
      });
    });
  } catch (e) {
    showError(e.message);
  }
}

async function renderHome() {
  els.pageTitle.textContent = "Home";
  showLoading();
  try {
    const [newest, random] = await Promise.all([
      api.getAlbumList("newest", 12),
      api.getAlbumList("random", 12),
    ]);
    els.content.innerHTML = `
      <div class="quick-actions">
        <button class="quick-btn primary" id="btn-shuffle-all">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>
          Shuffle All
        </button>
        <button class="quick-btn secondary" id="btn-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          Search
        </button>
      </div>
      <div class="section-title">Recently Added</div>
      ${renderAlbumGrid(newest)}
      <div class="section-title">Discover</div>
      ${renderAlbumGrid(random)}
    `;
    attachAlbumClicks(els.content);
    attachFavoriteHandlers(els.content, [], [...newest, ...random]);
    els.content.querySelector("#btn-shuffle-all")?.addEventListener("click", shuffleAll);
    els.content.querySelector("#btn-search")?.addEventListener("click", openSearch);
  } catch (e) {
    showError(e.message);
  }
}

async function getAlbumsForDisplay() {
  const cached = loadLibraryCache();
  if (cached?.albums?.length) return cached.albums;
  return api.getAllAlbums("alphabeticalByName");
}

function updateLibrarySettingsUI() {
  const cache = loadLibraryCache();
  document.getElementById("settings-album-count").textContent =
    cache ? String(cache.albumCount) : "Not synced";
  document.getElementById("settings-song-count").textContent =
    cache?.songCount ? String(cache.songCount) : "Not synced";
  document.getElementById("settings-last-sync").textContent =
    formatSyncedAt(cache?.syncedAt);
}

async function renderAlbums() {
  const gen = tabRenderGen;
  els.pageTitle.textContent = "Albums";
  try {
    const albums = await getAlbumsForDisplay();
    if (isTabStale(gen, "albums")) return;
    const cached = loadLibraryCache();
    const hint = cached
      ? `<p class="library-hint">Synced ${formatSyncedAt(cached.syncedAt)} · ${albums.length} albums. Settings → Sync Library to pick up new music.</p>`
      : '<p class="library-hint">Loading full album list from server…</p>';
    els.content.innerHTML = `${hint}<div class="section-title">${albums.length} albums</div><div class="album-grid" id="active-album-grid"></div>`;
    bindListData(els.content, [], albums);
    const grid = document.getElementById("active-album-grid");
    if (albums.length > ALBUM_CHUNK) {
      await mountAlbumGridIncremental(albums, grid, gen);
    } else {
      grid.innerHTML = albums.map((al) => renderAlbumCard(al)).join("");
    }
    if (!isTabStale(gen, "albums")) attachAlbumClicks(els.content);
  } catch (e) {
    if (!isTabStale(gen, "albums")) showError(e.message);
  }
}

function attachArtistClicks(container) {
  container.querySelectorAll("[data-artist]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.dataset.artist;
      const name = el.querySelector(".artist-name")?.textContent?.trim() || "Artist";
      openArtist(id, name);
    });
  });
}

function openSearch() {
  clearContentStack();
  backNav.setNavDepth("search");
  currentTab = "search";
  document.querySelectorAll(".nav-item").forEach((n) => {
    n.classList.toggle("active", n.dataset.tab === "home");
  });
  renderSearch();
  backNav.updateMainBackButton?.();
}

async function displaySongsList(songs, cache, gen) {
  if (!songs.length) {
    els.content.innerHTML = '<div class="empty-state">No songs found. Try Settings → Sync Library first.</div>';
    return;
  }
  const hint = cache?.syncedAt
    ? `<p class="library-hint">Synced ${formatSyncedAt(cache.syncedAt)} · ${songs.length} songs. Re-sync in Settings after new music is added.</p>`
    : '<p class="library-hint">Tip: Settings → Sync Library — saves albums and songs for instant browsing.</p>';
  els.content.innerHTML = `${hint}
    <div class="album-actions">
      <button class="quick-btn primary" id="btn-play-all-songs">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        Play All
      </button>
      <button class="quick-btn secondary" id="btn-shuffle-all-songs">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>
        Shuffle
      </button>
    </div>
    <div class="section-title">${songs.length} songs</div>
    <ul class="song-list" id="active-song-list"></ul>
  `;
  bindListData(els.content, songs, []);
  els.content.querySelector("#btn-play-all-songs")?.addEventListener("click", () => {
    player.playAll(songsWithUrls(songs));
  });
  els.content.querySelector("#btn-shuffle-all-songs")?.addEventListener("click", () => {
    const pool = sampleDiverseSongs(songs, 900);
    player.playShuffled(songsWithUrls(pool));
  });
  const listEl = document.getElementById("active-song-list");
  if (songs.length > LIST_CHUNK) {
    await mountSongListIncremental(songs, listEl, gen, true);
  } else {
    listEl.innerHTML = songs.map((s, i) => renderSongItem(s, i, true)).join("");
  }
  if (!isTabStale(gen, "songs")) highlightPlaying();
}

async function renderSongs() {
  const gen = tabRenderGen;
  els.pageTitle.textContent = "Songs";

  const cache = loadLibraryCache();
  if (cache?.songs?.length) {
    await displaySongsList(cache.songs, cache, gen);
    return;
  }

  showLoading();
  try {
    const songs = await api.getAllSongs({
      albums: cache?.albums,
      onProgress: (done, total) => {
        if (isTabStale(gen, "songs")) return;
        const label = done === 0
          ? `Loading albums… ${total}`
          : `Loading songs… album ${done} of ${total}`;
        els.content.innerHTML = `<div class="loading"><div class="spinner"></div><span>${label}</span></div>`;
      },
    });
    if (isTabStale(gen, "songs")) return;

    if (songs.length && cache?.albums) {
      try {
        saveLibraryCache(cache.albums, songs);
        updateLibrarySettingsUI();
      } catch {
        /* cache optional — list still works this session */
      }
    }

    if (isTabStale(gen, "songs")) return;
    await displaySongsList(songs, cache, gen);
  } catch (e) {
    if (!isTabStale(gen, "songs")) showError(e.message);
  }
}

function paintSearchResults(resultsEl, data) {
  let html = "";
  if (data.artists.length) {
    html += '<div class="section-title">Artists</div><ul class="artist-list">';
    html += data.artists.map((a) => `
      <li class="artist-item" data-artist="${a.id}">
        <div class="artist-avatar"><svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg></div>
        <span class="artist-name">${escapeHtml(a.name)}</span>
      </li>
    `).join("");
    html += "</ul>";
  }
  if (data.albums.length) {
    html += '<div class="section-title">Albums</div>' + renderAlbumGrid(data.albums);
  }
  if (data.songs.length) {
    html += '<div class="section-title">Songs</div>' + renderSongList(data.songs, true);
  }
  if (!html) html = '<div class="empty-state">No results</div>';
  resultsEl.innerHTML = html;
  attachArtistClicks(resultsEl);
  attachAlbumClicks(resultsEl);
  attachSongClicks(resultsEl, data.songs);
  attachFavoriteHandlers(resultsEl, data.songs, data.albums);
}

function renderSearch({ restoreQuery = "", restoreData = null } = {}) {
  els.pageTitle.textContent = "Search";
  els.content.innerHTML = `
    <div class="search-box">
      <input type="search" id="search-input" placeholder="Artists, albums, songs…" autocomplete="off" />
    </div>
    <div id="search-results"></div>
  `;
  const input = document.getElementById("search-input");
  const results = document.getElementById("search-results");
  let timer;

  if (restoreQuery) {
    input.value = restoreQuery;
    lastSearchQuery = restoreQuery;
  }
  if (restoreData) {
    lastSearchData = restoreData;
    paintSearchResults(results, restoreData);
  } else {
    input.focus();
  }

  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    lastSearchQuery = q;
    if (q.length < 2) {
      results.innerHTML = "";
      lastSearchData = null;
      return;
    }
    timer = setTimeout(async () => {
      results.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
      try {
        const data = await api.search(q);
        lastSearchData = data;
        paintSearchResults(results, data);
      } catch (e) {
        results.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
      }
    }, 300);
  });
}

function getCachedSongs() {
  return loadLibraryCache()?.songs || [];
}

function collectMyMixSongs(allSongs) {
  const byId = new Map();
  const wantGenres = GENRE_PRESETS.filter((g) =>
    ["rock", "alt-rock", "country"].includes(g.id)
  );
  for (const preset of wantGenres) {
    for (const s of songsForGenre(allSongs, preset)) byId.set(s.id, s);
  }
  for (const decade of [1980, 1990]) {
    for (const s of songsForDecade(allSongs, decade)) byId.set(s.id, s);
  }
  return filterPlayableSongs([...byId.values()]);
}

/**
 * Rebuild Liked = Rock + Alt + Country + 80s + 90s (excludes thumbs-down).
 * Replaces previous thumbs-up list.
 */
function rebuildMyMixFavorites() {
  const all = getCachedSongs();
  if (!all.length) {
    showToast("Sync Library first, then try again");
    return { ok: false, total: 0, matched: 0 };
  }
  let mix = collectMyMixSongs(all);
  const pool = mix.length > 4000 ? sampleDiverseSongs(mix, 4000) : mix;
  const total = replaceSongFavorites(pool);
  if (total < 0) {
    showToast("Storage full — could not save likes");
    return { ok: false, total: 0, matched: mix.length };
  }
  showToast(`Liked list: ${total} songs · open Liked to shuffle`);
  return { ok: true, total, matched: mix.length };
}

function favoriteSongsBulk(songs, label, { replace = false } = {}) {
  const filtered = filterPlayableSongs(songs);
  if (!filtered.length) {
    showToast(`No songs found for ${label} — Sync Library first`);
    return 0;
  }
  const pool = filtered.length > 4000 ? sampleDiverseSongs(filtered, 4000) : filtered;
  if (replace) {
    const total = replaceSongFavorites(pool);
    if (total < 0) {
      showToast("Storage full — remove some likes and try again");
      return -1;
    }
    showToast(`Liked set to ${total} songs · ${label}`);
    return total;
  }
  const added = addSongFavorites(pool);
  if (added < 0) {
    showToast("Storage full — remove some likes and try again");
    return -1;
  }
  const total = favoriteSongCount();
  showToast(
    added
      ? `Liked ${added} more (${total} total) · ${label}`
      : `Already liked (${total}) · ${label}`
  );
  return added;
}

function openGenreSongs(title, songs) {
  if (!songs.length) {
    showToast("No songs in this category — try Sync Library");
    return;
  }
  if (currentTab === "genres") {
    pushContentFrame(captureGenreListFrame());
  }
  backNav.setNavDepth("genre");
  els.pageTitle.textContent = title;
  const sampleNote = songs.length > 900
    ? `<p class="library-hint">${songs.length} songs · shuffle uses a diverse mix so one artist never dominates.</p>`
    : `<p class="library-hint">${songs.length} songs</p>`;
  els.content.innerHTML = `
    ${sampleNote}
    <div class="album-actions">
      <button class="quick-btn primary" id="btn-play-genre">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        Play All
      </button>
      <button class="quick-btn secondary" id="btn-shuffle-genre">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>
        Shuffle All
      </button>
      <button class="quick-btn secondary" id="btn-fav-genre">
        ${thumbsUpSvg(true)}
        Like All
      </button>
    </div>
    <ul class="song-list" id="active-song-list"></ul>
  `;
  const listSongs = songs.slice(0, 200);
  bindListData(els.content, listSongs, []);
  const listEl = document.getElementById("active-song-list");
  listEl.innerHTML = listSongs.map((s, i) => renderSongItem(s, i, true)).join("");
  if (songs.length > 200) {
    listEl.insertAdjacentHTML("beforeend", `<li class="library-hint" style="padding:1rem;list-style:none">Showing first 200 — use Play / Shuffle / Favorite All for the full set (${songs.length}).</li>`);
  }
  els.content.querySelector("#btn-play-genre")?.addEventListener("click", () => {
    const pool = sampleDiverseSongs(songs, 500);
    player.playAll(songsWithUrls(pool));
  });
  els.content.querySelector("#btn-shuffle-genre")?.addEventListener("click", () => {
    const pool = sampleDiverseSongs(songs, 900);
    player.playShuffled(songsWithUrls(pool));
  });
  els.content.querySelector("#btn-fav-genre")?.addEventListener("click", () => {
    favoriteSongsBulk(songs, title);
  });
  backNav.updateMainBackButton?.();
}

function renderGenres() {
  els.pageTitle.textContent = "Genres";
  const songs = getCachedSongs();
  if (!songs.length) {
    els.content.innerHTML = `
      <div class="empty-state">
        Sync your library first (Settings → Sync Library) to browse genres and decades.
      </div>`;
    return;
  }

  const mix = collectMyMixSongs(songs);
  const genreCards = GENRE_PRESETS.map((g) => {
    const count = songsForGenre(songs, g).length;
    return `
      <button type="button" class="genre-chip" data-genre="${g.id}">
        <span class="genre-chip-name">${escapeHtml(g.label)}</span>
        <span class="genre-chip-count">${count} songs</span>
      </button>`;
  }).join("");

  const decadeCards = DECADES.map((d) => {
    const count = songsForDecade(songs, d).length;
    return `
      <button type="button" class="genre-chip" data-decade="${d}">
        <span class="genre-chip-name">${d}s</span>
        <span class="genre-chip-count">${count} songs</span>
      </button>`;
  }).join("");

  els.content.innerHTML = `
    <p class="library-hint">From your synced library · tags come from the server (genre / year).</p>
    <div class="album-actions" style="margin-bottom:1rem">
      <button class="quick-btn primary" id="btn-fav-my-mix">
        ${thumbsUpSvg(true)}
        Like my mix
      </button>
    </div>
    <p class="library-hint">My mix = Rock + Alt Rock + Country + 1980s + 1990s (${mix.length} songs, skips thumbs-down). Rebuilds your Liked list. Then open <strong>Liked → Shuffle</strong>.</p>
    <div class="section-title">Genres</div>
    <div class="genre-grid">${genreCards}</div>
    <div class="section-title">Decades</div>
    <div class="genre-grid">${decadeCards}</div>
  `;

  els.content.querySelector("#btn-fav-my-mix")?.addEventListener("click", () => {
    rebuildMyMixFavorites();
  });

  els.content.querySelectorAll("[data-genre]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const preset = GENRE_PRESETS.find((g) => g.id === btn.dataset.genre);
      if (!preset) return;
      openGenreSongs(preset.label, songsForGenre(songs, preset));
    });
  });
  els.content.querySelectorAll("[data-decade]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const d = parseInt(btn.dataset.decade, 10);
      openGenreSongs(`${d}s`, songsForDecade(songs, d));
    });
  });
}

const tabRenderers = {
  home: renderHome,
  songs: renderSongs,
  albums: renderAlbums,
  genres: renderGenres,
};

async function shuffleAll() {
  try {
    showToast("Building a diverse shuffle…");
    const cache = loadLibraryCache();
    let songs = [];
    if (cache?.songs?.length) {
      songs = sampleDiverseSongs(cache.songs, 900);
    } else {
      // Multiple server draws + diversify (single getRandomSongs(100) re-hears the same big catalogs)
      const batches = await Promise.all([
        api.getRandomSongs(200),
        api.getRandomSongs(200),
        api.getRandomSongs(200),
      ]);
      const merged = new Map();
      for (const batch of batches) {
        for (const s of batch) merged.set(s.id, s);
      }
      songs = sampleDiverseSongs([...merged.values()], 500);
    }
    if (!songs.length) return showToast("No songs found — try Sync Library first");
    await player.playShuffled(songsWithUrls(songs));
    showToast(`Shuffling ${songs.length} songs · artist-spread`);
  } catch (e) {
    showToast(e.message);
  }
}

function switchTab(tab, { fromBack = false } = {}) {
  tabRenderGen++;
  const gen = tabRenderGen;
  if (!fromBack && tab !== "settings" && tab !== "search") backNav.rememberMainTab(tab);
  currentTab = tab;
  clearContentStack();
  lastSearchQuery = "";
  lastSearchData = null;
  backNav.setNavDepth("root");
  backNav.updateMainBackButton?.();
  document.querySelectorAll(".nav-item").forEach((n) => {
    n.classList.toggle("active", n.dataset.tab === tab);
  });
  showScreen("screen-main");
  if (TAB_TITLES[tab]) els.pageTitle.textContent = TAB_TITLES[tab];
  if (tab === "songs" || tab === "albums") showLoading();
  requestAnimationFrame(() => {
    if (gen !== tabRenderGen) return;
    tabRenderers[tab]?.();
  });
}

function renderFavorites() {
  const panel = document.getElementById("favorites-content");
  const songs = getLikedSongs();
  const albums = getFavoriteAlbums();
  const playlists = getPlaylists();

  let html = `
    <div class="favorites-section">
      <div class="section-title">Playlists</div>
      <p class="library-hint" style="margin-bottom:0.75rem">Your custom lists (by artist or song). Manage them under <strong>Playlists</strong> in the top bar.</p>
      <div class="album-actions">
        <button class="quick-btn secondary" id="btn-open-playlists-from-fav">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>
          ${playlists.length ? `Open Playlists (${playlists.length})` : "Create a playlist"}
        </button>
      </div>
    </div>
  `;

  if (!songs.length && !albums.length) {
    html += '<div class="empty-state" style="padding-top:1rem">No liked songs yet — tap 👍 on any track. 👎 never plays on this device.</div>';
    panel.innerHTML = html;
    panel.querySelector("#btn-open-playlists-from-fav")?.addEventListener("click", openPlaylists);
    return;
  }

  if (songs.length) {
    html += `
      <div class="favorites-section">
        <div class="section-title">Liked songs (${songs.length})</div>
        <div class="album-actions">
          <button class="quick-btn primary" id="btn-play-fav-songs">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            Play All
          </button>
          <button class="quick-btn secondary" id="btn-shuffle-fav-songs">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>
            Shuffle
          </button>
        </div>
        ${renderSongList(songs)}
      </div>
    `;
  }
  if (albums.length) {
    html += `<div class="favorites-section"><div class="section-title">Liked albums</div>${renderAlbumGrid(albums)}</div>`;
  }
  panel.innerHTML = html;

  bindListData(panel, songs, albums);
  panel._albumFromScreen = "screen-favorites";
  attachSongClicks(panel, songs);
  attachAlbumClicks(panel, "screen-favorites");
  attachFavoriteHandlers(panel, songs, albums);

  panel.querySelector("#btn-open-playlists-from-fav")?.addEventListener("click", openPlaylists);
  panel.querySelector("#btn-play-fav-songs")?.addEventListener("click", () => {
    player.playAll(songsWithUrls(songs));
  });
  panel.querySelector("#btn-shuffle-fav-songs")?.addEventListener("click", () => {
    const pool = sampleDiverseSongs(songs, Math.min(songs.length, 900));
    player.playShuffled(songsWithUrls(pool));
  });
}

function openFavorites() {
  renderFavorites();
  showScreen("screen-favorites");
}

/** First credited name: "Tom MacDonald, Adam Calhoun" → "Tom MacDonald" */
function primaryArtistName(artist) {
  const raw = String(artist || "").trim();
  if (!raw) return "";
  return raw
    .split(/\s*(?:,|&|\/| feat\.? | ft\.? | featuring | with | x )\s*/i)[0]
    .trim();
}

function artistSearchKey(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Artists for playlist picker — groups collabs under the primary name
 * so "Tom MacDonald" finds all "Tom MacDonald, Adam Calhoun" tracks too.
 */
function libraryArtists() {
  const songs = getCachedSongs();
  const map = new Map(); // primaryKey -> { name, count }
  for (const s of songs) {
    const full = (s.artist || "").trim();
    if (!full) continue;
    const primary = primaryArtistName(full) || full;
    const key = artistSearchKey(primary);
    if (!key) continue;
    if (!map.has(key)) map.set(key, { name: primary, count: 0 });
    map.get(key).count++;
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function artistMatchesQuery(artistName, query) {
  const a = artistSearchKey(artistName);
  const q = artistSearchKey(query);
  if (!a || !q) return false;
  if (a.includes(q) || q.includes(a)) return true;
  // token match: "tom mac" matches "tom macdonald"
  const qTokens = q.split(" ").filter(Boolean);
  if (qTokens.length && qTokens.every((t) => a.includes(t))) return true;
  return false;
}

/** All library songs by this artist (exact, primary name, or credit line contains name). */
function songsByArtistName(artistName) {
  const key = artistSearchKey(artistName);
  if (!key) return [];
  return getCachedSongs().filter((s) => {
    const full = artistSearchKey(s.artist);
    const primary = artistSearchKey(primaryArtistName(s.artist));
    if (full === key || primary === key) return true;
    if (full.includes(key) || primary.includes(key)) return true;
    // multi-credit: any segment matches
    const segments = String(s.artist || "").split(/\s*(?:,|&|\/)\s*/);
    return segments.some((seg) => artistSearchKey(seg) === key || artistSearchKey(primaryArtistName(seg)) === key);
  });
}

function filterArtistsByQuery(artists, query) {
  const q = String(query || "").trim();
  if (!q) return artists.slice(0, 50);
  return artists.filter((a) => artistMatchesQuery(a.name, q)).slice(0, 50);
}

function renderPlaylistsScreen() {
  const panel = document.getElementById("playlists-content");
  const titleEl = document.getElementById("playlists-title");
  if (playlistViewId) {
    renderPlaylistDetail(playlistViewId);
    return;
  }
  if (titleEl) titleEl.textContent = "Playlists";
  const list = getPlaylists();
  const libCount = getCachedSongs().length;
  const allPlTracks = (() => {
    const byId = new Map();
    for (const pl of list) {
      for (const t of pl.tracks || []) {
        if (t?.id) byId.set(String(t.id), t);
      }
    }
    return [...byId.values()];
  })();

  let html = `
    <p class="library-hint">Name a list → <strong>Create</strong> → open it → <strong>Add artist</strong>. ${libCount ? `${libCount.toLocaleString()} songs synced.` : "Sync Library in Settings first."}</p>
    <div id="new-playlist-form" class="playlist-add-panel">
      <input type="text" id="new-playlist-name" placeholder="Playlist name" autocomplete="off" maxlength="80" />
      <div class="album-actions">
        <button type="button" class="quick-btn primary" id="btn-create-playlist-confirm">Create</button>
        <button type="button" class="quick-btn secondary" id="btn-create-playlist-cancel">Cancel</button>
        <button type="button" class="quick-btn secondary" id="btn-shuffle-all-playlists" ${allPlTracks.length ? "" : "disabled"}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>
          Shuffle All
        </button>
      </div>
    </div>
  `;
  if (!list.length) {
    html += '<div class="empty-state">No playlists yet — type a name above and tap Create, then Add artist</div>';
  } else {
    html += `<ul class="playlist-list">`;
    for (const pl of list) {
      html += `
        <li class="playlist-item" data-playlist-id="${pl.id}">
          <button type="button" class="playlist-item-main" data-open-playlist="${pl.id}">
            <span class="playlist-item-name">${escapeHtml(pl.name)}</span>
            <span class="playlist-item-meta">${pl.tracks.length} song${pl.tracks.length === 1 ? "" : "s"}</span>
          </button>
          <button type="button" class="icon-btn playlist-item-delete" data-delete-playlist="${pl.id}" aria-label="Delete playlist">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
          </button>
        </li>`;
    }
    html += `</ul>`;
  }
  panel.innerHTML = html;

  const nameInput = panel.querySelector("#new-playlist-name");
  panel.querySelector("#btn-create-playlist-cancel")?.addEventListener("click", () => {
    if (nameInput) nameInput.value = "";
    nameInput?.blur();
  });
  function submitNewPlaylist() {
    const name = nameInput?.value?.trim();
    if (!name) {
      showToast("Enter a playlist name");
      return;
    }
    try {
      const pl = createPlaylist(name);
      showToast(`Created “${pl.name}” — now Add artist`);
      playlistViewId = pl.id;
      renderPlaylistsScreen();
    } catch (e) {
      showToast(e.message || "Could not create playlist");
    }
  }
  panel.querySelector("#btn-create-playlist-confirm")?.addEventListener("click", submitNewPlaylist);
  nameInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitNewPlaylist();
    }
  });

  panel.querySelector("#btn-shuffle-all-playlists")?.addEventListener("click", () => {
    if (!allPlTracks.length) {
      showToast("No songs in any playlist yet");
      return;
    }
    const pool = sampleDiverseSongs(allPlTracks, Math.min(allPlTracks.length, 900));
    player.playShuffled(songsWithUrls(pool));
    showToast(`Shuffling ${pool.length} songs from all playlists`);
  });

  panel.querySelectorAll("[data-open-playlist]").forEach((btn) => {
    btn.addEventListener("click", () => {
      playlistViewId = btn.dataset.openPlaylist;
      renderPlaylistsScreen();
    });
  });
  panel.querySelectorAll("[data-delete-playlist]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const pl = getPlaylist(btn.dataset.deletePlaylist);
      if (!pl) return;
      if (!confirm(`Delete playlist “${pl.name}”?`)) return;
      deletePlaylist(pl.id);
      showToast("Playlist deleted");
      renderPlaylistsScreen();
    });
  });
}

function renderPlaylistDetail(id) {
  const panel = document.getElementById("playlists-content");
  const titleEl = document.getElementById("playlists-title");
  const pl = getPlaylist(id);
  if (!pl) {
    playlistViewId = null;
    renderPlaylistsScreen();
    return;
  }
  if (titleEl) titleEl.textContent = pl.name;
  const tracks = pl.tracks || [];

  const libN = getCachedSongs().length;
  panel.innerHTML = `
    <p class="library-hint">${tracks.length} song${tracks.length === 1 ? "" : "s"} · Tap <strong>Add artist</strong>, then type a name (e.g. Tom MacDonald). Collabs count too.${libN ? "" : " ⚠ Sync Library first."}</p>
    <div class="album-actions">
      <button class="quick-btn primary" id="btn-play-playlist" ${tracks.length ? "" : "disabled"}>
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        Play All
      </button>
      <button class="quick-btn secondary" id="btn-shuffle-playlist" ${tracks.length ? "" : "disabled"}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>
        Shuffle
      </button>
      <button class="quick-btn secondary" id="btn-add-artist-pl">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
        Add artist
      </button>
      <button class="quick-btn secondary" id="btn-rename-pl">Rename</button>
    </div>
    <div id="playlist-add-artist-panel" class="playlist-add-panel" hidden>
      <input type="search" id="playlist-artist-search" placeholder="Type artist name…" autocomplete="off" enterkeyhint="search" />
      <ul id="playlist-artist-results" class="playlist-artist-results"></ul>
    </div>
    <div class="section-title">Tracks</div>
    ${tracks.length ? `<ul class="song-list" id="playlist-track-list"></ul>` : '<div class="empty-state">Empty — tap Add artist and search</div>'}
  `;

  if (tracks.length) {
    const listEl = document.getElementById("playlist-track-list");
    listEl.innerHTML = tracks.map((s, i) => `
      <li class="song-item" data-song-idx="${i}" data-song-id="${s.id}">
        <span class="song-num">${i + 1}</span>
        <div class="song-info">
          <div class="song-title">${escapeHtml(s.title)}</div>
          <div class="song-sub">${escapeHtml(s.artist || "")}</div>
        </div>
        <button type="button" class="icon-btn song-remove" data-remove-track="${s.id}" aria-label="Remove">×</button>
        <span class="song-dur">${formatDuration(s.duration)}</span>
      </li>
    `).join("");

    bindListData(panel, tracks, []);
    attachSongClicks(panel, tracks);

    listEl.querySelectorAll("[data-remove-track]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        removeTrackFromPlaylist(pl.id, btn.dataset.removeTrack);
        showToast("Removed from playlist");
        renderPlaylistDetail(pl.id);
      });
    });
  }

  panel.querySelector("#btn-play-playlist")?.addEventListener("click", () => {
    if (!tracks.length) return;
    player.playAll(songsWithUrls(tracks));
  });
  panel.querySelector("#btn-shuffle-playlist")?.addEventListener("click", () => {
    if (!tracks.length) return;
    const pool = sampleDiverseSongs(tracks, Math.min(tracks.length, 900));
    player.playShuffled(songsWithUrls(pool));
  });
  panel.querySelector("#btn-rename-pl")?.addEventListener("click", () => {
    const name = prompt("Rename playlist", pl.name);
    if (!name?.trim()) return;
    try {
      renamePlaylist(pl.id, name.trim());
      renderPlaylistDetail(pl.id);
    } catch (e) {
      showToast(e.message);
    }
  });

  const addPanel = panel.querySelector("#playlist-add-artist-panel");
  const searchInput = panel.querySelector("#playlist-artist-search");
  const resultsEl = panel.querySelector("#playlist-artist-results");
  const allArtists = libraryArtists();

  panel.querySelector("#btn-add-artist-pl")?.addEventListener("click", () => {
    const show = addPanel.hidden;
    addPanel.hidden = !show;
    if (show) {
      searchInput.value = "";
      paintArtistResults("");
      searchInput.focus();
      if (!getCachedSongs().length) {
        showToast("Sync Library first (Settings) so artists can be found");
      }
    }
  });

  async function paintArtistResults(q) {
    const query = String(q || "").trim();
    let artists = filterArtistsByQuery(allArtists, query);

    // Live server search if local list empty but we have a query + API
    if (!artists.length && query.length >= 2 && api) {
      resultsEl.innerHTML = `<li class="empty-state" style="padding:0.75rem">Searching server…</li>`;
      try {
        const data = await api.search(query);
        const fromServer = (data.artists || []).map((a) => ({
          name: a.name,
          count: a.albumCount || 0,
          fromServer: true,
          artistId: a.id,
        }));
        // Also surface primary artists from song hits
        const songArtists = new Map();
        for (const s of data.songs || []) {
          const p = primaryArtistName(s.artist) || s.artist;
          if (!p) continue;
          const k = artistSearchKey(p);
          if (!songArtists.has(k)) songArtists.set(k, { name: p, count: 0, fromServer: true });
          songArtists.get(k).count++;
        }
        artists = [...fromServer, ...songArtists.values()];
        // de-dupe by key
        const seen = new Set();
        artists = artists.filter((a) => {
          const k = artistSearchKey(a.name);
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
      } catch {
        artists = [];
      }
    }

    if (!artists.length) {
      const hint = !getCachedSongs().length
        ? "No library on this phone — Settings → Sync Library, then try again"
        : query
          ? `No artists matching “${query}” — try fewer letters (e.g. tom mac)`
          : "Type an artist name to search";
      resultsEl.innerHTML = `<li class="empty-state" style="padding:0.75rem">${escapeHtml(hint)}</li>`;
      return;
    }
    resultsEl._artistOptions = artists;
    resultsEl.innerHTML = artists.map((a, i) => `
      <li>
        <button type="button" class="playlist-artist-row" data-artist-idx="${i}">
          <span class="playlist-item-name">${escapeHtml(a.name)}</span>
          <span class="playlist-item-meta">${a.count ? `${a.count} songs` : "tap to add"}${a.fromServer ? " · server" : ""}</span>
        </button>
      </li>
    `).join("");
    resultsEl.querySelectorAll("[data-artist-idx]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const idx = parseInt(btn.dataset.artistIdx, 10);
        const opt = resultsEl._artistOptions?.[idx];
        if (!opt?.name) return;
        let songs = songsByArtistName(opt.name);
        // Server fallback: pull songs via search if local match thin
        if (songs.length < 3 && api) {
          try {
            const data = await api.search(opt.name);
            const extra = (data.songs || []).filter((s) =>
              artistMatchesQuery(primaryArtistName(s.artist) || s.artist, opt.name)
              || artistMatchesQuery(s.artist, opt.name)
            );
            const byId = new Map(songs.map((s) => [s.id, s]));
            for (const s of extra) byId.set(s.id, s);
            songs = [...byId.values()];
          } catch { /* keep local */ }
        }
        if (!songs.length) {
          showToast(`No songs found for ${opt.name}`);
          return;
        }
        try {
          const pool = songs.length > 800 ? sampleDiverseSongs(songs, 800) : songs;
          const n = addTracksToPlaylist(pl.id, pool);
          showToast(n ? `Added ${n} from ${opt.name}` : `Already had those from ${opt.name}`);
          renderPlaylistDetail(pl.id);
        } catch (e) {
          showToast(e.message || "Could not add artist");
        }
      });
    });
  }

  let searchTimer;
  searchInput?.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const q = searchInput.value;
    searchTimer = setTimeout(() => paintArtistResults(q), 200);
  });
}

function openPlaylists() {
  playlistViewId = null;
  renderPlaylistsScreen();
  showScreen("screen-playlists");
}

function openSettings() {
  const cfg = loadConfig();
  const prefs = loadSettings();

  if (currentTab && currentTab !== "search") {
    backNav.rememberMainTab(currentTab);
  }

  document.getElementById("settings-server").textContent = cfg?.serverUrl || "—";
  document.getElementById("settings-user").textContent = cfg?.username || "—";
  document.getElementById("edit-server-url").value = cfg?.serverUrl || "";
  document.getElementById("edit-username").value = cfg?.username || "";
  document.getElementById("edit-password").value = cfg?.password || "";
  document.getElementById("setting-shuffle-default").checked = !!prefs.shuffleDefault;
  document.getElementById("setting-bitrate").value = String(prefs.bitrate || 320);
  document.getElementById("edit-connection-panel").hidden = true;
  document.getElementById("edit-connection-error").hidden = true;
  updateLibrarySettingsUI();
  renderBlockedSettingsList();

  showScreen("screen-settings");
}

function renderBlockedSettingsList() {
  const list = document.getElementById("blocked-songs-list");
  const countEl = document.getElementById("blocked-songs-count");
  if (!list) return;
  const blocked = getBlockedSongs().sort((a, b) =>
    String(a.title || "").localeCompare(String(b.title || ""))
  );
  if (countEl) countEl.textContent = String(blocked.length);
  if (!blocked.length) {
    list.innerHTML = `<p class="settings-hint settings-hint-muted">No blocked songs. Tap 👎 on a track to never play it on this device.</p>`;
    return;
  }
  list.innerHTML = `<ul class="blocked-list">${blocked
    .map(
      (s) => `
    <li class="blocked-item">
      <div class="blocked-info">
        <span class="blocked-title">${escapeHtml(s.title || "Unknown")}</span>
        <span class="blocked-artist">${escapeHtml(s.artist || "")}</span>
      </div>
      <button type="button" class="btn secondary blocked-unblock" data-unblock="${s.id}">Unblock</button>
    </li>`
    )
    .join("")}</ul>`;
  list.querySelectorAll("[data-unblock]").forEach((btn) => {
    btn.addEventListener("click", () => {
      unblockSong(btn.dataset.unblock);
      showToast("Unblocked");
      renderBlockedSettingsList();
      updatePlayingRating(player.current);
    });
  });
}

document.getElementById("btn-clear-blocked")?.addEventListener("click", () => {
  if (!blockedSongCount()) {
    showToast("Nothing blocked");
    return;
  }
  if (!confirm("Unblock all thumbs-down songs on this device?")) return;
  clearAllBlocked();
  renderBlockedSettingsList();
  showToast("All blocked songs cleared");
});

document.getElementById("btn-clear-liked")?.addEventListener("click", () => {
  if (!favoriteSongCount()) {
    showToast("No likes to clear");
    return;
  }
  if (!confirm("Clear all thumbs-up (liked) songs on this device?")) return;
  clearAllLiked();
  showToast("All likes cleared");
  if (document.getElementById("screen-favorites")?.classList.contains("active")) {
    renderFavorites();
  }
});

document.getElementById("btn-reset-ratings")?.addEventListener("click", () => {
  if (!confirm("Reset all likes and blocked songs on this device? Fresh start.")) return;
  clearAllRatings();
  renderBlockedSettingsList();
  updatePlayingRating(player.current);
  showToast("Ratings reset");
  if (document.getElementById("screen-favorites")?.classList.contains("active")) {
    renderFavorites();
  }
});

document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

document.getElementById("btn-settings")?.addEventListener("click", openSettings);

const DONATE_URL = "https://liberapay.com/west66/donate";
const FEEDBACK_EMAIL = "tunefriend.music@proton.me";

function openExternalLink(url) {
  try {
    if (isNativeApp() && window.Capacitor?.Plugins?.App?.openUrl) {
      window.Capacitor.Plugins.App.openUrl({ url });
      return;
    }
  } catch { /* fall through */ }
  if (url.startsWith("mailto:")) {
    window.location.href = url;
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

function feedbackMailto() {
  const ver = "2.39";
  const body = [
    "Device / Android version:",
    "TuneFriend version: " + ver,
    "",
    "What happened:",
    "",
    "What I expected:",
    "",
  ].join("\n");
  return (
    "mailto:" +
    FEEDBACK_EMAIL +
    "?subject=" +
    encodeURIComponent("TuneFriend feedback") +
    "&body=" +
    encodeURIComponent(body)
  );
}

document.getElementById("btn-feedback")?.addEventListener("click", (e) => {
  e.preventDefault();
  openExternalLink(feedbackMailto());
});
document.getElementById("btn-donate")?.addEventListener("click", (e) => {
  e.preventDefault();
  openExternalLink(DONATE_URL);
});

function isHostedWebApp() {
  if (isNativeApp()) return false;
  const h = location.hostname;
  return (
    h.endsWith(".workers.dev") ||
    h === "tunefriend.org" ||
    h === "www.tunefriend.org" ||
    (location.protocol === "https:" && h !== "localhost" && h !== "127.0.0.1")
  );
}

function looksLikeRawIpUrl(urlStr) {
  try {
    const u = new URL(urlStr.includes("://") ? urlStr : `http://${urlStr}`);
    const host = u.hostname.replace(/^\[|\]$/g, "");
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
  } catch {
    return false;
  }
}

function friendlyLoginError(err, { useProxy, serverUrl } = {}) {
  const msg = String(err?.message || err || "");
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    if (location.protocol === "https:" && /^http:/i.test(serverUrl || "")) {
      return "This site is HTTPS but your server is HTTP. Turn ON “Use built-in proxy”, or use an https:// server URL.";
    }
    if (!useProxy) {
      return "Connection blocked (CORS/network). Turn ON “Use built-in proxy” and try again.";
    }
    if (looksLikeRawIpUrl(serverUrl)) {
      return "Cloudflare cannot use a raw IP. Create DNS A record music.tunefriend.org → your IP (Proxy OFF), then use http://music.tunefriend.org:4533 with proxy ON.";
    }
    return "Could not reach the music server. Check URL, proxy, and that the server is online.";
  }
  if (/1003|raw ip|raw IP/i.test(msg)) {
    return "Cloudflare cannot use a raw IP. Use a hostname (e.g. http://music.tunefriend.org:4533) with proxy ON.";
  }
  return msg || "Could not connect. Check URL and credentials.";
}

els.loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.loginError.hidden = true;
  els.loginBtn.disabled = true;
  els.loginBtn.textContent = "Connecting…";

  // On Cloudflare HTTPS, proxy is required for HTTP music servers / CORS
  const proxyEl = document.getElementById("use-proxy");
  if (isHostedWebApp() && proxyEl) proxyEl.checked = true;

  const config = {
    serverUrl: document.getElementById("server-url").value.trim(),
    username: document.getElementById("username").value,
    password: document.getElementById("password").value,
    useProxy: document.getElementById("use-proxy").checked,
  };

  try {
    if (isHostedWebApp() && looksLikeRawIpUrl(config.serverUrl)) {
      throw new Error(
        "Cloudflare cannot connect to a raw IP. In Cloudflare → DNS add: music → A → your server IP, Proxy OFF (grey cloud). Then Server URL: http://music.tunefriend.org:4533"
      );
    }
    const testApi = new SubsonicAPI(config);
    await testApi.ping();
    api = testApi;
    saveConfig(config);
    player.resolveSong = enrichSong;
    setupMediaSession(player, () => api);
    showScreen("screen-main");
    showBottomDock(true);
    await initLibraryCache();
    await restorePlayback();
    switchTab("home");
  } catch (err) {
    els.loginError.textContent = friendlyLoginError(err, config);
    els.loginError.hidden = false;
  } finally {
    els.loginBtn.disabled = false;
    els.loginBtn.textContent = "Connect";
  }
});

document.getElementById("btn-favorites").addEventListener("click", openFavorites);
document.getElementById("btn-playlists")?.addEventListener("click", openPlaylists);

onFavoritesChange(() => {
  updatePlayingFavorite(player.current);
  if (document.getElementById("screen-favorites")?.classList.contains("active")) {
    renderFavorites();
  }
});

onPlaylistsChange(() => {
  if (document.getElementById("screen-playlists")?.classList.contains("active")) {
    renderPlaylistsScreen();
  }
  if (document.getElementById("screen-favorites")?.classList.contains("active")) {
    renderFavorites();
  }
});

document.getElementById("btn-sync-library").addEventListener("click", async () => {
  const btn = document.getElementById("btn-sync-library");
  if (!api) return;
  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = "Syncing…";
  try {
    const result = await syncLibrary(api, {
      onProgress: (msg) => { btn.textContent = `Syncing… ${msg}`; },
    });
    updateLibrarySettingsUI();
    const songPart = result.songCount ? `, ${result.songCount} songs` : "";
    let toast = `Synced ${result.albumCount} albums${songPart}`;
    if (result.expectedSongCount && result.songCount < result.expectedSongCount * 0.95) {
      toast += ` (${result.expectedSongCount} on server — tap Sync again if low)`;
    }
    showToast(toast);
    if (currentTab === "albums") tabRenderers.albums();
    if (currentTab === "songs") tabRenderers.songs();
  } catch (e) {
    showToast(e.message || "Sync failed");
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
});

document.getElementById("btn-edit-connection").addEventListener("click", () => {
  const panel = document.getElementById("edit-connection-panel");
  panel.hidden = !panel.hidden;
});

document.getElementById("setting-shuffle-default").addEventListener("change", (e) => {
  saveSettings({ shuffleDefault: e.target.checked });
  player.shuffle = e.target.checked;
});

document.getElementById("setting-bitrate").addEventListener("change", (e) => {
  saveSettings({ bitrate: parseInt(e.target.value, 10) });
  showToast("Quality updated — applies to next song");
});


document.getElementById("btn-save-connection").addEventListener("click", async () => {
  const errEl = document.getElementById("edit-connection-error");
  errEl.hidden = true;

  const config = {
    serverUrl: document.getElementById("edit-server-url").value,
    username: document.getElementById("edit-username").value,
    password: document.getElementById("edit-password").value,
    useProxy: !isNativeApp() && document.getElementById("use-proxy")?.checked,
  };

  try {
    const testApi = new SubsonicAPI(config);
    await testApi.ping();
    api = testApi;
    saveConfig(config);
    document.getElementById("settings-server").textContent = config.serverUrl;
    document.getElementById("settings-user").textContent = config.username;
    document.getElementById("edit-connection-panel").hidden = true;
    showToast("Connected successfully");
  } catch (err) {
    errEl.textContent = err.message || "Could not connect";
    errEl.hidden = false;
  }
});
document.getElementById("btn-disconnect").addEventListener("click", () => {
  clearConfig();
  clearLibraryCache();
  clearPlaybackSession();
  api = null;
  player.queue = [];
  player.index = -1;
  els.audio.src = "";
  els.nowPlaying.classList.add("hidden");
  showBottomDock(false);
  showScreen("screen-login");
});

function setupNativeUI() {
  if (isNativeApp()) {
    const proxyRow = document.querySelector(".checkbox-row");
    if (proxyRow) proxyRow.hidden = true;
    document.getElementById("use-proxy").checked = false;
    return;
  }
  // Browser on Cloudflare / HTTPS: keep proxy on by default
  if (isHostedWebApp()) {
    const proxy = document.getElementById("use-proxy");
    if (proxy) proxy.checked = true;
  }
}

function enrichSong(song, { transcode = false } = {}) {
  const useTranscode = transcode || !isNativeApp();
  return {
    ...song,
    streamUrl: api.streamUrl(song.id, { transcode: useTranscode }),
    coverArtUrl: song.coverArt ? api.coverArtUrl(song.coverArt, 512) : "",
  };
}

async function restorePlayback() {
  const restored = await player.restoreSession(enrichSong);
  if (restored) {
    playerUI.updateUI();
    highlightPlaying();
    updatePlayingFavorite(player.current);
  }
}

// adb / chrome://inspect automation
window.__tuneFriendFavoriteMyMix = () => rebuildMyMixFavorites();
window.__tuneFriendRebuildFavorites = () => rebuildMyMixFavorites();

async function init() {
  setupNativeUI();
  player.shuffle = loadSettings().shuffleDefault;
  const config = loadConfig();
  if (config) {
    document.getElementById("server-url").value = config.serverUrl || "";
    document.getElementById("username").value = config.username || "";
    document.getElementById("password").value = config.password || "";
    document.getElementById("use-proxy").checked = config.useProxy !== false;
    try {
      api = new SubsonicAPI(config);
      await api.ping();
      player.resolveSong = enrichSong;
      setupMediaSession(player, () => api);
      showScreen("screen-main");
      showBottomDock(true);
      await initLibraryCache();
      await restorePlayback();
      switchTab("home");
      return;
    } catch {
      clearConfig();
    }
  }
  showScreen("screen-login");
}

let syncNativeTimer = null;
function scheduleNativeSync() {
  if (!api) return;
  clearTimeout(syncNativeTimer);
  syncNativeTimer = setTimeout(() => player.syncFromNative?.(), 800);
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") scheduleNativeSync();
});
if (isNativeApp()) {
  import("@capacitor/app").then(({ App }) => {
    App.addListener("appStateChange", ({ isActive }) => {
      if (isActive) scheduleNativeSync();
    });
  }).catch(() => {});
}

if ("serviceWorker" in navigator && !isNativeApp()) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
} else if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()));
}

init();