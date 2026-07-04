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
  isSongFavorite,
  isAlbumFavorite,
  toggleSongFavorite,
  toggleAlbumFavorite,
  getFavoriteSongs,
  getFavoriteAlbums,
  favoriteHeartSvg,
  onFavoritesChange,
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

let api = null;
let currentTab = "home";
let tabRenderGen = 0;

function isTabStale(gen, tab) {
  return gen !== tabRenderGen || currentTab !== tab;
}

const LIST_CHUNK = 100;
const ALBUM_CHUNK = 60;
const TAB_TITLES = { home: "Home", songs: "Songs", albums: "Albums" };

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
  npFav: document.getElementById("np-fav"),
  btnFav: document.getElementById("btn-fav"),
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
  return songs.map((s) => ({
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
      <button class="fav-btn album-fav${isAlbumFavorite(al.id) ? " active" : ""}" data-fav-album="${al.id}" aria-label="Favorite album">${favoriteHeartSvg(isAlbumFavorite(al.id))}</button>
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
      <button class="fav-btn song-fav${isSongFavorite(s.id) ? " active" : ""}" data-fav-song="${s.id}" aria-label="Favorite song">${favoriteHeartSvg(isSongFavorite(s.id))}</button>
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

function setupContentDelegation(container) {
  if (container._delegated) return;
  container._delegated = true;
  container.addEventListener("click", (e) => {
    const favSong = e.target.closest("[data-fav-song]");
    if (favSong) {
      e.stopPropagation();
      const song = container._listSongs?.find((s) => s.id === favSong.dataset.favSong);
      if (!song) return;
      const added = toggleSongFavorite(song);
      favSong.classList.toggle("active", added);
      favSong.innerHTML = favoriteHeartSvg(added);
      showToast(added ? "Added to favorites" : "Removed from favorites");
      return;
    }
    const favAlbum = e.target.closest("[data-fav-album]");
    if (favAlbum) {
      e.stopPropagation();
      const album = container._listAlbums?.find((a) => a.id === favAlbum.dataset.favAlbum);
      if (!album) return;
      const added = toggleAlbumFavorite(album);
      favAlbum.classList.toggle("active", added);
      favAlbum.innerHTML = favoriteHeartSvg(added);
      showToast(added ? "Album favorited" : "Album unfavorited");
      return;
    }
    const albumBtn = e.target.closest("[data-album]");
    if (albumBtn) {
      openAlbum(albumBtn.dataset.album);
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

function attachAlbumClicks(container) {
  if ((container._listAlbums?.length || 0) > 30) return;
  container.querySelectorAll("[data-album]").forEach((el) => {
    el.addEventListener("click", () => openAlbum(el.dataset.album));
  });
}

function attachFavoriteHandlers(container, songs = [], albums = []) {
  if (songs.length > 30 || albums.length > 30) {
    bindListData(container, songs, albums);
    return;
  }
  const songMap = new Map(songs.map((s) => [s.id, s]));
  const albumMap = new Map(albums.map((a) => [a.id, a]));

  container.querySelectorAll("[data-fav-song]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const song = songMap.get(btn.dataset.favSong);
      if (!song) return;
      const added = toggleSongFavorite(song);
      btn.classList.toggle("active", added);
      btn.innerHTML = favoriteHeartSvg(added);
      showToast(added ? "Added to favorites" : "Removed from favorites");
    });
  });

  container.querySelectorAll("[data-fav-album]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const album = albumMap.get(btn.dataset.favAlbum);
      if (!album) return;
      const added = toggleAlbumFavorite(album);
      btn.classList.toggle("active", added);
      btn.innerHTML = favoriteHeartSvg(added);
      showToast(added ? "Album favorited" : "Album unfavorited");
    });
  });
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
  if (!id) return;
  els.content.querySelector(`.song-item[data-song-id="${id}"]`)?.classList.add("playing");
}

function updatePlayingFavorite(song) {
  const active = !!(song && isSongFavorite(song.id));
  for (const btn of [els.npFav, els.btnFav]) {
    if (!btn) continue;
    btn.disabled = !song;
    btn.classList.toggle("active", active);
    btn.innerHTML = favoriteHeartSvg(active);
  }
}

function togglePlayingFavorite() {
  const song = player.current;
  if (!song) return;
  const added = toggleSongFavorite(song);
  updatePlayingFavorite(song);
  showToast(added ? "Added to favorites" : "Removed from favorites");
}

els.npFav?.addEventListener("click", (e) => {
  e.stopPropagation();
  togglePlayingFavorite();
});
els.btnFav?.addEventListener("click", togglePlayingFavorite);

const _origTrackChange = player.onTrackChange;
player.onTrackChange = (song) => {
  _origTrackChange?.(song);
  highlightPlaying();
  updatePlayingFavorite(song);
};

function popMainToRoot() {
  backNav.setNavDepth("root");
  if (currentTab === "search") {
    switchTab(backNav.getLastMainTab() || "home");
    return;
  }
  tabRenderers[currentTab]?.();
}

const backNav = createBackNav({
  getActiveScreen: () => document.querySelector(".screen.active")?.id,
  getCurrentTab: () => currentTab,
  onBackFromPlayer: () => showScreen("screen-main"),
  onBackFromFavorites: () => showScreen("screen-main"),
  onBackFromSettings: (tab) => {
    showScreen("screen-main");
    switchTab(tab || "home", { fromBack: true });
  },
  onBackFromMainDrillDown: () => popMainToRoot(),
  onBackToHome: () => switchTab("home", { fromBack: true }),
});

async function openAlbum(id) {
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
        <button class="fav-btn detail-fav${isAlbumFavorite(album.id) ? " active" : ""}" data-fav-album="${album.id}" aria-label="Favorite album">${favoriteHeartSvg(isAlbumFavorite(album.id))}</button>
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

async function openArtist(id, name) {
  backNav.setNavDepth("artist");
  showLoading();
  els.pageTitle.textContent = name || "Artist";
  try {
    const artist = await api.getArtist(id);
    els.content.innerHTML = `
      <div class="section-title">${escapeHtml(artist.name)}</div>
      ${renderAlbumGrid(artist.albums)}
    `;
    attachAlbumClicks(els.content);
    attachFavoriteHandlers(els.content, [], artist.albums);
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
  backNav.setNavDepth("search");
  currentTab = "search";
  document.querySelectorAll(".nav-item").forEach((n) => {
    n.classList.toggle("active", n.dataset.tab === "home");
  });
  renderSearch();
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
    player.playShuffled(songsWithUrls(songs));
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

function renderSearch() {
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

  input.focus();
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) {
      results.innerHTML = "";
      return;
    }
    timer = setTimeout(async () => {
      results.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
      try {
        const data = await api.search(q);
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
        results.innerHTML = html;
        attachArtistClicks(results);
        attachAlbumClicks(results);
        attachSongClicks(results, data.songs);
        attachFavoriteHandlers(results, data.songs, data.albums);
      } catch (e) {
        results.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
      }
    }, 300);
  });
}

const tabRenderers = {
  home: renderHome,
  songs: renderSongs,
  albums: renderAlbums,
};

async function shuffleAll() {
  try {
    const songs = await api.getRandomSongs(100);
    if (!songs.length) return showToast("No songs found");
    await player.playShuffled(songsWithUrls(songs));
  } catch (e) {
    showToast(e.message);
  }
}

function switchTab(tab, { fromBack = false } = {}) {
  tabRenderGen++;
  const gen = tabRenderGen;
  if (!fromBack && tab !== "settings" && tab !== "search") backNav.rememberMainTab(tab);
  currentTab = tab;
  backNav.setNavDepth("root");
  backNav.updateMainBackButton?.();
  document.querySelectorAll(".nav-item").forEach((n) => {
    n.classList.toggle("active", n.dataset.tab === tab);
  });
  if (tab === "settings") {
    openSettings();
    return;
  }
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
  const songs = getFavoriteSongs();
  const albums = getFavoriteAlbums();

  if (!songs.length && !albums.length) {
    panel.innerHTML = '<div class="empty-state">No favorites yet — tap the heart on any song or album</div>';
    return;
  }

  let html = "";
  if (songs.length) {
    html += `
      <div class="favorites-section">
        <div class="section-title">Songs</div>
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
    html += `<div class="favorites-section"><div class="section-title">Albums</div>${renderAlbumGrid(albums)}</div>`;
  }
  panel.innerHTML = html;

  attachSongClicks(panel, songs);
  attachAlbumClicks(panel);
  attachFavoriteHandlers(panel, songs, albums);

  panel.querySelector("#btn-play-fav-songs")?.addEventListener("click", () => {
    player.playAll(songsWithUrls(songs));
  });
  panel.querySelector("#btn-shuffle-fav-songs")?.addEventListener("click", () => {
    player.playShuffled(songsWithUrls(songs));
  });
}

function openFavorites() {
  renderFavorites();
  showScreen("screen-favorites");
}

function openSettings() {
  const cfg = loadConfig();
  const prefs = loadSettings();

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

  showScreen("screen-settings");
}

document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

els.loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.loginError.hidden = true;
  els.loginBtn.disabled = true;
  els.loginBtn.textContent = "Connecting…";

  const config = {
    serverUrl: document.getElementById("server-url").value,
    username: document.getElementById("username").value,
    password: document.getElementById("password").value,
    useProxy: document.getElementById("use-proxy").checked,
  };

  try {
    const testApi = new SubsonicAPI(config);
    await testApi.ping();
    api = testApi;
    saveConfig(config);
    setupMediaSession(player, () => api);
    showScreen("screen-main");
    showBottomDock(true);
    await initLibraryCache();
    await restorePlayback();
    switchTab("home");
  } catch (err) {
    els.loginError.textContent = err.message || "Could not connect. Check URL and credentials.";
    els.loginError.hidden = false;
  } finally {
    els.loginBtn.disabled = false;
    els.loginBtn.textContent = "Connect";
  }
});

document.getElementById("btn-favorites").addEventListener("click", openFavorites);

onFavoritesChange(() => {
  updatePlayingFavorite(player.current);
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
  if (!isNativeApp()) return;
  const proxyRow = document.querySelector(".checkbox-row");
  if (proxyRow) proxyRow.hidden = true;
  document.getElementById("use-proxy").checked = false;
}

function enrichSong(song) {
  return {
    ...song,
    streamUrl: api.streamUrl(song.id, { transcode: !isNativeApp() }),
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
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !api) return;
  clearTimeout(syncNativeTimer);
  syncNativeTimer = setTimeout(() => player.syncFromNative?.(), 800);
});

if ("serviceWorker" in navigator && !isNativeApp()) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
} else if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()));
}

init();