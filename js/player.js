/*
 * TuneFriend
 * Copyright (C) 2026 James
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { formatDuration, isNativeApp } from "./api.js";
import { fetchStreamUrl, revokeBlobUrl } from "./native-http.js";
import {
  canUseNativePlayer, getNativePlugin, nativePlay, nativePause, nativeResume, nativeStop,
  nativeGetStatus, nativeSeekTo, nativeSetNextTrack, nativeClearNextTrack,
  onNativeEnded, onNativeError, onNativePrepared,
  onNativeSkipNext, onNativeSkipPrevious, onNativeTrackAdvanced,
} from "./native-player-bridge.js";
import { savePlaybackSession, loadPlaybackSession, clearPlaybackSession } from "./session.js";

export class Player {
  constructor(audioEl) {
    this.audio = audioEl;
    this.queue = [];
    this.index = -1;
    this.shuffle = false;
    this.repeat = false;
    this.onTrackChange = null;
    this.onStateChange = null;
    this.onLoading = null;
    this._blobUrl = null;
    this._nativePlaying = false;
    this._nativePosition = 0;
    this._duration = 0;
    this._tickTimer = null;
    this._nativeListenersSet = false;
    this._pendingNextIndex = -1;
    this._saveTimer = null;
    this._lastErrorAt = 0;
    this._seekHoldUntil = 0;
    this._startPaused = false;
    this._restorePosition = 0;
    this._loadingNative = false;
    this._recoveringNative = false;
    this._lastSyncAt = 0;
    this._tickUnprepared = 0;
    this._tickMs = 500;
    this._loadGen = 0;
    this._lastLoadAt = 0;
    this._preparingNext = false;
    this._errorTrackId = "";
    this._errorRetries = 0;
    this.resolveSong = null;
    this.onError = null;
    this.onPlaybackOk = null;

    audioEl.addEventListener("ended", () => { if (!this.useNative()) this.next(); });
    audioEl.addEventListener("timeupdate", () => {
      if (!this.useNative()) {
        this._scheduleSaveSession();
        this.onStateChange?.();
      }
    });
    audioEl.addEventListener("play", () => { if (!this.useNative()) this.onStateChange?.(); });
    audioEl.addEventListener("pause", () => {
      if (!this.useNative()) {
        this._saveSession();
        this.onStateChange?.();
      }
    });
    audioEl.addEventListener("error", () => {
      if (this.useNative()) return;
      const code = audioEl.error?.code;
      const msg = code === 4 ? "Unsupported format" : code === 2 ? "Network error" : "Playback failed";
      this.onError?.(msg);
      this.onStateChange?.();
    });
  }

  useNative() {
    return isNativeApp() && canUseNativePlayer();
  }

  _ensureNativeListeners() {
    if (this._nativeListenersSet) return;
    if (!getNativePlugin()) return;
    this._nativeListenersSet = true;
    onNativeEnded(() => {
      this._nativePlaying = false;
      if (this._advanceIndex()) {
        this._loadCurrent();
        return;
      }
      this._saveSession();
      this.onStateChange?.();
    });
    onNativeTrackAdvanced((trackId) => this._onNativeTrackAdvanced(trackId));
    onNativeError((msg) => this._handleNativeError(msg));
    onNativePrepared(async () => {
      this._loadingNative = false;
      this._errorTrackId = "";
      this._errorRetries = 0;
      if (this._startPaused) {
        const pos = this._restorePosition || 0;
        if (pos > 0) {
          await nativeSeekTo(pos);
          this._nativePosition = pos;
        }
        await nativePause();
        this._nativePlaying = false;
        this._startPaused = false;
        this._restorePosition = 0;
        this.onPlaybackOk?.();
        this.onStateChange?.();
        return;
      }
      this._nativePlaying = true;
      this.onPlaybackOk?.();
      this.onStateChange?.();
    });
    onNativeSkipNext(() => this.next());
    onNativeSkipPrevious(() => this.prev());
  }

  _freshSong(song) {
    if (!song) return song;
    const fresh = this.resolveSong ? this.resolveSong(song) : song;
    const idx = this.queue.findIndex((s) => String(s.id) === String(fresh.id));
    if (idx >= 0) this.queue[idx] = fresh;
    return fresh;
  }

  _nativeQueueOptions() {
    const slice = this.queue.slice(this.index, this.index + 40).map((s) => this._freshSong(s));
    return {
      queue: slice,
      index: 0,
      shuffle: this.shuffle,
      repeat: this.repeat,
    };
  }

  _canAutoRecover() {
    if (this._loadingNative || this._recoveringNative) return false;
    return Date.now() - this._lastLoadAt > 4000;
  }

  async _handleNativeError(msg) {
    const now = Date.now();
    if (this._loadingNative || this._recoveringNative) return;
    if (now - this._lastErrorAt < 2500) return;
    this._lastErrorAt = now;
    if (!this.current) {
      this.onError?.(msg);
      return;
    }
    const trackId = String(this.current.id);
    if (trackId === this._errorTrackId) {
      this._errorRetries++;
    } else {
      this._errorTrackId = trackId;
      this._errorRetries = 1;
    }
    this._recoveringNative = true;
    try {
      this._nativePlaying = false;
      await nativeStop();
      if (this._errorRetries >= 2 && this._advanceIndex()) {
        this._errorTrackId = "";
        this._errorRetries = 0;
        await this._loadCurrent();
        return;
      }
      await this._loadCurrent();
    } catch {
      this.onError?.(msg);
    } finally {
      this._recoveringNative = false;
    }
  }

  _shuffleCopy(songs) {
    const copy = [...songs];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  _computeNextIndex() {
    if (this.queue.length === 0) return -1;
    if (this.shuffle) {
      if (this.queue.length === 1) return -1;
      let idx;
      do {
        idx = Math.floor(Math.random() * this.queue.length);
      } while (idx === this.index);
      return idx;
    }
    if (this.index < this.queue.length - 1) return this.index + 1;
    if (this.repeat) return 0;
    return -1;
  }

  _advanceIndex() {
    if (this.queue.length === 0) return false;
    if (this._pendingNextIndex >= 0) {
      this.index = this._pendingNextIndex;
      this._pendingNextIndex = -1;
      return true;
    }
    const nextIdx = this._computeNextIndex();
    if (nextIdx < 0) return false;
    this.index = nextIdx;
    return true;
  }

  async _prepareNativeNext() {
    if (!this.useNative() || !this.current || this._preparingNext) return;
    this._preparingNext = true;
    try {
      this._pendingNextIndex = this._computeNextIndex();
      const nextSong = this._pendingNextIndex >= 0
        ? this._freshSong(this.queue[this._pendingNextIndex])
        : null;
      const current = this._freshSong(this.current);
      if (nextSong) await nativeSetNextTrack(nextSong, this._nativeQueueOptions());
      else await nativeSetNextTrack(current, this._nativeQueueOptions());
    } catch {
      // Native queue still advances in the background service.
    } finally {
      this._preparingNext = false;
    }
  }

  _onNativeTrackAdvanced(trackId) {
    if (trackId) {
      const idx = this.queue.findIndex((s) => String(s.id) === String(trackId));
      if (idx >= 0) this.index = idx;
      else if (this._pendingNextIndex >= 0) this.index = this._pendingNextIndex;
    } else if (this._pendingNextIndex >= 0) {
      this.index = this._pendingNextIndex;
    }
    this._pendingNextIndex = -1;
    this._duration = this.current?.duration || 0;
    this._nativePosition = 0;
    this._nativePlaying = true;
    this._errorTrackId = "";
    this._errorRetries = 0;
    this.onPlaybackOk?.();
    this.onTrackChange?.(this.current);
    this._prepareNativeNext();
    this._saveSession();
    this.onStateChange?.();
  }

  async syncFromNative() {
    if (!this.useNative()) return;
    const now = Date.now();
    if (now - this._lastSyncAt < 3000) return;
    this._lastSyncAt = now;
    try {
      const status = await nativeGetStatus();
      const session = loadPlaybackSession();
      if (status.trackId && this.queue.length) {
        const idx = this.queue.findIndex((s) => String(s.id) === String(status.trackId));
        if (idx >= 0 && idx !== this.index) {
          this.index = idx;
          this.onTrackChange?.(this.current);
        }
      }
      this._nativePosition = status.position || 0;
      if (status.duration > 0) this._duration = status.duration;
      this._nativePlaying = !!status.playing;
      if (!status.prepared && !status.playing && this.current && this._canAutoRecover()) {
        await this._handleNativeError("Playback error");
        return;
      }
      const shouldResume = status.prepared && !status.playing
        && session?.wasPlaying
        && this._canAutoRecover();
      if (shouldResume) {
        try {
          await nativeResume();
          const after = await nativeGetStatus();
          this._nativePlaying = !!after.playing;
        } catch {
          // Service may have been stopped by the system.
        }
      }
      if (status.prepared || status.playing || this._nativePlaying) {
        await this._prepareNativeNext();
      }
      this._saveSession();
      this.onPlaybackOk?.();
      this.onStateChange?.();
    } catch {
      this.onStateChange?.();
    }
  }

  _scheduleSaveSession() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._saveSession(), 2000);
  }

  _saveSession() {
    if (!this.current || this.index < 0) return;
    savePlaybackSession({
      queue: this.queue,
      index: this.index,
      position: this.getCurrentTime(),
      shuffle: this.shuffle,
      repeat: this.repeat,
      wasPlaying: this.isPlaying,
    });
  }

  async restoreSession(enrichSong) {
    const session = loadPlaybackSession();
    if (!session?.queue?.length || session.index < 0) return false;

    try {
      this.queue = session.queue.map(enrichSong);
    } catch {
      clearPlaybackSession();
      return false;
    }
    this.shuffle = session.shuffle;
    this.repeat = session.repeat;

    try {
      this.onLoading?.(true);
      if (this.useNative()) {
        this._ensureNativeListeners();
        let status = { position: 0, duration: 0, playing: false, trackId: "" };
        try {
          status = await nativeGetStatus();
        } catch {
          clearPlaybackSession();
          return false;
        }
        if (status.trackId || status.playing) {
          const idx = status.trackId
            ? this.queue.findIndex((s) => String(s.id) === String(status.trackId))
            : -1;
          this.index = idx >= 0 ? idx : Math.min(session.index, this.queue.length - 1);
          this._duration = status.duration || this.current?.duration || 0;
          this._nativePosition = status.position || session.position || 0;
          if (status.playing) {
            try { await nativePause(); } catch { /* service may be gone */ }
          }
          this._nativePlaying = false;
          try {
            await this._prepareNativeNext();
          } catch {
            clearPlaybackSession();
            return false;
          }
          this._startNativeTick();
          this.onTrackChange?.(this.current);
          this._saveSession();
          this.onStateChange?.();
          return true;
        }
      }

      this.index = Math.min(session.index, this.queue.length - 1);
      this._duration = this.current?.duration || 0;
      this._nativePosition = session.position || 0;
      this.onTrackChange?.(this.current);

      if (this.useNative()) {
        this._pendingNextIndex = this._computeNextIndex();
        const nextSong = this._pendingNextIndex >= 0 ? this.queue[this._pendingNextIndex] : null;
        this._restorePosition = session.position || 0;
        this._startPaused = true;
        await nativePlay(this.current, nextSong, this._nativeQueueOptions());
        this._startNativeTick();
      } else {
        revokeBlobUrl(this._blobUrl);
        this._blobUrl = null;
        this.audio.pause();
        this.audio.removeAttribute("src");
        if (isNativeApp()) {
          this._blobUrl = await fetchStreamUrl(this.current.streamUrl);
          this.audio.src = this._blobUrl;
        } else {
          this.audio.src = this.current.streamUrl;
        }
        this.audio.load();
        if (session.position > 0) this.audio.currentTime = session.position;
        this.audio.pause();
      }
      this._saveSession();
      this.onStateChange?.();
      return true;
    } catch {
      clearPlaybackSession();
      this.queue = [];
      this.index = -1;
      return false;
    } finally {
      this._loadingNative = false;
      this.onLoading?.(false);
    }
  }

  get current() {
    return this.index >= 0 ? this.queue[this.index] : null;
  }

  get isPlaying() {
    return this.useNative() ? this._nativePlaying : !this.audio.paused && !this.audio.ended;
  }

  playQueue(songs, startIndex = 0) {
    this.queue = songs;
    this.index = startIndex;
    return this._loadCurrent();
  }

  async play(songs, index = 0, { shuffle = false } = {}) {
    this.shuffle = shuffle;
    await this.playQueue(songs, index);
    if (!this.useNative()) {
      try {
        await this.audio.play();
      } catch {
        this.onError?.("Tap play to start");
      }
    }
  }

  async playAll(songs) {
    return this.play(songs, 0, { shuffle: false });
  }

  async playShuffled(songs) {
    if (!songs.length) return;
    const shuffled = this._shuffleCopy(songs);
    return this.play(shuffled, 0, { shuffle: false });
  }

  toggle() {
    if (!this.current) return;
    if (this.useNative()) {
      if (this._nativePlaying) {
        nativePause();
        this._nativePlaying = false;
      } else {
        nativeResume();
        this._nativePlaying = true;
      }
      this._saveSession();
      this.onStateChange?.();
      return;
    }
    if (this.isPlaying) this.audio.pause();
    else this.audio.play().catch(() => {});
  }

  next() {
    if (!this._advanceIndex()) return;
    this._loadCurrent().then(() => {
      if (!this.useNative()) this.audio.play().catch(() => {});
    });
  }

  prev() {
    if (this.useNative() && this._nativePosition > 3) {
      this.seek(0);
      return;
    }
    if (!this.useNative() && this.audio.currentTime > 3) {
      this.audio.currentTime = 0;
      return;
    }
    if (this.index > 0) {
      this.index--;
      this._loadCurrent().then(() => {
        if (!this.useNative()) this.audio.play().catch(() => {});
      });
    }
  }

  async seek(ratio) {
    const d = this.getDuration();
    if (!d) return;
    const target = Math.max(0, Math.min(ratio * d, d - 0.5));
    if (this.useNative()) {
      this._seekHoldUntil = Date.now() + 2000;
      this._nativePosition = target;
      try {
        await nativeSeekTo(target);
        const status = await nativeGetStatus();
        if (status.position > 0) this._nativePosition = status.position;
      } catch {
        this.onError?.("Could not seek");
      }
      this._saveSession();
      this.onStateChange?.();
      return;
    }
    if (this.audio.duration) {
      this.audio.currentTime = target;
    }
  }

  getCurrentTime() {
    if (this.useNative()) return this._nativePosition;
    return this.audio.currentTime || 0;
  }

  getDuration() {
    if (this.useNative()) {
      return this._duration || this.current?.duration || 0;
    }
    return this.audio.duration || this.current?.duration || 0;
  }

  async _loadCurrent() {
    if (!this.current) return;
    const loadGen = ++this._loadGen;
    const song = this._freshSong(this.current);
    if (loadGen !== this._loadGen) return;

    this._duration = song.duration || 0;
    this._nativePlaying = false;
    this._nativePosition = 0;
    this._lastLoadAt = Date.now();

    try {
      this.onLoading?.(true);

      if (this.useNative()) {
        this._ensureNativeListeners();
        this._loadingNative = true;
        this.audio.pause();
        this.audio.removeAttribute("src");
        this._pendingNextIndex = this._computeNextIndex();
        const nextSong = this._pendingNextIndex >= 0
          ? this._freshSong(this.queue[this._pendingNextIndex])
          : null;
        await nativePlay(song, nextSong, this._nativeQueueOptions());
        if (loadGen !== this._loadGen) return;
        this.onTrackChange?.(song);
        this._startNativeTick();
        this._saveSession();
        return;
      }

      revokeBlobUrl(this._blobUrl);
      this._blobUrl = null;
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio.load();

      if (isNativeApp()) {
        this._blobUrl = await fetchStreamUrl(song.streamUrl);
        this.audio.src = this._blobUrl;
      } else {
        this.audio.src = song.streamUrl;
      }
      this.audio.load();
      this.onTrackChange?.(song);
      this._saveSession();
    } catch (e) {
      this._loadingNative = false;
      this.onError?.(e.message || "Could not load stream");
    } finally {
      this.onLoading?.(false);
    }
  }

  _startNativeTick() {
    clearInterval(this._tickTimer);
    this._tickUnprepared = 0;
    this._tickMs = 500;
    const tick = async () => {
      if (!this.useNative() || !this.current) return;
      try {
        const status = await nativeGetStatus();
        if (!status.prepared && !status.playing) {
          this._tickUnprepared++;
          if (this._tickUnprepared >= 6 && this._tickMs < 2000) {
            this._tickMs = 2000;
            clearInterval(this._tickTimer);
            this._tickTimer = setInterval(tick, this._tickMs);
          }
          return;
        }
        this._tickUnprepared = 0;
        if (this._tickMs > 500) {
          this._tickMs = 500;
          clearInterval(this._tickTimer);
          this._tickTimer = setInterval(tick, this._tickMs);
        }
        if (Date.now() >= this._seekHoldUntil) {
          this._nativePosition = status.position || 0;
        }
        if (status.duration > 0) this._duration = status.duration;
        this._nativePlaying = status.playing;
        this._scheduleSaveSession();
        this.onStateChange?.();
      } catch {
        this.onStateChange?.();
      }
    };
    this._tickTimer = setInterval(tick, this._tickMs);
  }

  async stop() {
    clearInterval(this._tickTimer);
    clearTimeout(this._saveTimer);
    if (this.useNative()) await nativeStop();
    this._nativePlaying = false;
    revokeBlobUrl(this._blobUrl);
    this._blobUrl = null;
    clearPlaybackSession();
  }
}

export function bindPlayerUI(player, getApi, els) {
  const {
    nowPlaying, npArt, npTitle, npArtist, npPlay, npIconPlay, npIconPause,
    playerScreen, playerArt, playerTitle, playerArtist, playerAlbum,
    progress, timeCurrent, timeTotal, btnPlay, iconPlay, iconPause,
    btnPrev, btnNext, btnShuffle, btnRepeat, btnClosePlayer, npExpand,
    content,
  } = els;

  function showNowPlaying(show) {
    nowPlaying.classList.toggle("hidden", !show);
    requestAnimationFrame(updateDockHeight);
  }

  function updateDockHeight() {
    const dock = document.getElementById("bottom-dock");
    if (!dock || dock.classList.contains("hidden")) {
      document.documentElement.style.setProperty("--dock-h", "0px");
      return;
    }
    document.documentElement.style.setProperty("--dock-h", `${dock.offsetHeight}px`);
  }

  function updateUI() {
    const song = player.current;
    const playing = player.isPlaying;

    if (song) {
      showNowPlaying(true);
      const api = getApi();
      const artUrl = api && song.coverArt ? api.coverArtUrl(song.coverArt, 200) : "";
      npTitle.textContent = song.title;
      npArtist.textContent = song.artist;
      playerTitle.textContent = song.title;
      playerArtist.textContent = song.artist;
      playerAlbum.textContent = song.album || "";
      if (artUrl) {
        npArt.src = artUrl;
        playerArt.src = artUrl;
      }
    }

    npIconPlay.hidden = playing;
    npIconPause.hidden = !playing;
    iconPlay.hidden = playing;
    iconPause.hidden = !playing;

    const t = player.getCurrentTime();
    const d = player.getDuration();
    timeCurrent.textContent = formatDuration(t);
    timeTotal.textContent = formatDuration(d);
    progress.value = d ? (t / d) * 100 : 0;

    btnShuffle.style.color = player.shuffle ? "var(--accent)" : "";
    btnRepeat.style.color = player.repeat ? "var(--accent)" : "";
  }

  let uiSeeking = false;

  const _origTrackChange = player.onTrackChange;
  player.onTrackChange = (song) => {
    _origTrackChange?.(song);
    if (!uiSeeking) updateUI();
  };

  player.onStateChange = () => {
    if (!uiSeeking) updateUI();
  };

  npPlay.addEventListener("click", () => player.toggle());
  btnPlay.addEventListener("click", () => player.toggle());
  btnPrev.addEventListener("click", () => player.prev());
  btnNext.addEventListener("click", () => player.next());
  btnShuffle.addEventListener("click", () => {
    player.shuffle = !player.shuffle;
    player._prepareNativeNext?.();
    player._saveSession?.();
    updateUI();
  });
  btnRepeat.addEventListener("click", () => {
    player.repeat = !player.repeat;
    player._prepareNativeNext?.();
    player._saveSession?.();
    updateUI();
  });

  npExpand.addEventListener("click", () => showScreen("screen-player"));
  let seekCommitting = false;
  async function commitSeek() {
    if (!uiSeeking || seekCommitting) return;
    seekCommitting = true;
    uiSeeking = false;
    await player.seek(progress.value / 100);
    updateUI();
    setTimeout(() => { seekCommitting = false; }, 150);
  }

  progress.addEventListener("pointerdown", () => { uiSeeking = true; });
  progress.addEventListener("touchstart", () => { uiSeeking = true; }, { passive: true });
  progress.addEventListener("input", () => {
    uiSeeking = true;
    const d = player.getDuration();
    if (d) {
      const t = (progress.value / 100) * d;
      timeCurrent.textContent = formatDuration(t);
    }
  });
  progress.addEventListener("change", commitSeek);
  progress.addEventListener("pointerup", commitSeek);
  progress.addEventListener("touchend", commitSeek);

  function showScreen(id) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    document.getElementById(id)?.classList.add("active");
  }

  window.addEventListener("resize", updateDockHeight);
  updateDockHeight();

  return { updateUI, showNowPlaying, updateDockHeight };
}