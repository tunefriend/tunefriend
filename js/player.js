import { formatDuration, isNativeApp } from "./api.js";
import { fetchStreamUrl, revokeBlobUrl } from "./native-http.js";
import {
  canUseNativePlayer, getNativePlugin, nativePlay, nativePause, nativeResume, nativeStop,
  nativeGetStatus, nativeSeekTo,
  onNativeEnded, onNativeError, onNativePrepared,
} from "./native-player-bridge.js";

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
    this.onError = null;

    audioEl.addEventListener("ended", () => { if (!this.useNative()) this.next(); });
    audioEl.addEventListener("timeupdate", () => { if (!this.useNative()) this.onStateChange?.(); });
    audioEl.addEventListener("play", () => { if (!this.useNative()) this.onStateChange?.(); });
    audioEl.addEventListener("pause", () => { if (!this.useNative()) this.onStateChange?.(); });
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
    onNativeEnded(() => this.next());
    onNativeError((msg) => this.onError?.(msg));
    onNativePrepared(() => {
      this._nativePlaying = true;
      this.onStateChange?.();
    });
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
    return this.play(songs, 0, { shuffle: true });
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
      this.onStateChange?.();
      return;
    }
    if (this.isPlaying) this.audio.pause();
    else this.audio.play().catch(() => {});
  }

  next() {
    if (this.queue.length === 0) return;
    if (this.shuffle) {
      this.index = Math.floor(Math.random() * this.queue.length);
    } else if (this.index < this.queue.length - 1) {
      this.index++;
    } else if (this.repeat) {
      this.index = 0;
    } else {
      return;
    }
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
    const target = ratio * d;
    if (this.useNative()) {
      this._nativePosition = target;
      await nativeSeekTo(target);
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
    const song = this.current;
    if (!song) return;

    this._duration = song.duration || 0;
    this._nativePlaying = false;
    this._nativePosition = 0;

    try {
      this.onLoading?.(true);

      if (this.useNative()) {
        this._ensureNativeListeners();
        // Stop HTML audio so it doesn't compete
        this.audio.pause();
        this.audio.removeAttribute("src");
        await nativePlay(song);
        this.onTrackChange?.(song);
        this._startNativeTick();
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
    } catch (e) {
      this.onError?.(e.message || "Could not load stream");
    } finally {
      this.onLoading?.(false);
    }
  }

  _startNativeTick() {
    clearInterval(this._tickTimer);
    this._tickTimer = setInterval(async () => {
      try {
        const status = await nativeGetStatus();
        this._nativePosition = status.position || 0;
        if (status.duration > 0) this._duration = status.duration;
        this._nativePlaying = status.playing;
        this.onStateChange?.();
      } catch {
        this.onStateChange?.();
      }
    }, 500);
  }

  async stop() {
    clearInterval(this._tickTimer);
    if (this.useNative()) await nativeStop();
    this._nativePlaying = false;
    revokeBlobUrl(this._blobUrl);
    this._blobUrl = null;
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

  player.onTrackChange = updateUI;
  player.onStateChange = updateUI;

  npPlay.addEventListener("click", () => player.toggle());
  btnPlay.addEventListener("click", () => player.toggle());
  btnPrev.addEventListener("click", () => player.prev());
  btnNext.addEventListener("click", () => player.next());
  btnShuffle.addEventListener("click", () => { player.shuffle = !player.shuffle; updateUI(); });
  btnRepeat.addEventListener("click", () => { player.repeat = !player.repeat; updateUI(); });

  npExpand.addEventListener("click", () => showScreen("screen-player"));
  btnClosePlayer.addEventListener("click", () => showScreen("screen-main"));

  let seeking = false;
  progress.addEventListener("input", () => {
    seeking = true;
    const d = player.getDuration();
    if (d) {
      const t = (progress.value / 100) * d;
      timeCurrent.textContent = formatDuration(t);
    }
  });
  progress.addEventListener("change", () => {
    player.seek(progress.value / 100);
    seeking = false;
  });

  function showScreen(id) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    document.getElementById(id)?.classList.add("active");
  }

  window.addEventListener("resize", updateDockHeight);
  updateDockHeight();

  return { updateUI, showNowPlaying, updateDockHeight };
}