/*
 * TuneFriend
 * Copyright (C) 2026 James
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { isNativeApp } from "./api.js";

let plugin = null;
let listeners = {
  ended: [],
  error: [],
  prepared: [],
  skipNext: [],
  skipPrevious: [],
  trackAdvanced: [],
};
let wired = false;

function wirePlugin(p) {
  if (!p || wired) return;
  wired = true;
  p.addListener("ended", () => listeners.ended.forEach((fn) => fn()));
  p.addListener("error", (e) => listeners.error.forEach((fn) => fn(e?.message || "Playback error")));
  p.addListener("prepared", () => listeners.prepared.forEach((fn) => fn()));
  p.addListener("skipNext", () => listeners.skipNext.forEach((fn) => fn()));
  p.addListener("skipPrevious", () => listeners.skipPrevious.forEach((fn) => fn()));
  p.addListener("trackAdvanced", (e) => listeners.trackAdvanced.forEach((fn) => fn(e?.trackId || "")));
}

export function getNativePlugin() {
  if (!isNativeApp()) return null;
  if (plugin) return plugin;

  const cap = window.Capacitor;
  if (!cap) return null;

  if (typeof cap.registerPlugin === "function") {
    plugin = cap.registerPlugin("BackgroundMusic");
  } else {
    plugin = cap.Plugins?.BackgroundMusic ?? null;
  }

  wirePlugin(plugin);
  return plugin;
}

export function canUseNativePlayer() {
  return !!getNativePlugin();
}

export function onNativeEnded(fn) { listeners.ended.push(fn); }
export function onNativeError(fn) { listeners.error.push(fn); }
export function onNativePrepared(fn) { listeners.prepared.push(fn); }
export function onNativeSkipNext(fn) { listeners.skipNext.push(fn); }
export function onNativeSkipPrevious(fn) { listeners.skipPrevious.push(fn); }
export function onNativeTrackAdvanced(fn) { listeners.trackAdvanced.push(fn); }

function trackPayload(song) {
  return {
    url: song.streamUrl,
    title: song.title || "",
    artist: song.artist || "",
    artworkUrl: song.coverArtUrl || "",
    trackId: String(song.id || ""),
  };
}

const MAX_NATIVE_QUEUE = 40;

function queueSlice(queue, index) {
  const start = Math.max(0, index);
  return queue.slice(start, start + MAX_NATIVE_QUEUE);
}

export async function nativeSetQueue(queue, { index = 0, shuffle = false, repeat = false } = {}) {
  const p = getNativePlugin();
  if (!p?.setQueue || !queue?.length) return;
  const slice = queueSlice(queue, index);
  await p.setQueue({
    queueJson: JSON.stringify(slice.map(trackPayload)),
    queueIndex: 0,
    shuffle,
    repeat,
  });
}

export async function nativePlay(song, nextSong = null, options = {}) {
  const p = getNativePlugin();
  if (!p) throw new Error("Native player unavailable — reinstall latest APK");
  if (options.queue?.length) {
    await nativeSetQueue(options.queue, options);
  }
  const payload = trackPayload(song);
  if (nextSong) {
    const next = trackPayload(nextSong);
    payload.nextUrl = next.url;
    payload.nextTitle = next.title;
    payload.nextArtist = next.artist;
    payload.nextArtworkUrl = next.artworkUrl;
    payload.nextTrackId = next.trackId;
  }
  if (options.shuffle != null) payload.shuffle = options.shuffle;
  if (options.repeat != null) payload.repeat = options.repeat;
  await p.play(payload);
}

export async function nativeSetNextTrack(song, options = {}) {
  const p = getNativePlugin();
  if (!p?.setNextTrack || !song) return;
  if (options.queue?.length) {
    await nativeSetQueue(options.queue, options);
  }
  const next = trackPayload(song);
  const payload = {
    nextUrl: next.url,
    nextTitle: next.title,
    nextArtist: next.artist,
    nextArtworkUrl: next.artworkUrl,
    nextTrackId: next.trackId,
  };
  if (options.shuffle != null) payload.shuffle = options.shuffle;
  if (options.repeat != null) payload.repeat = options.repeat;
  await p.setNextTrack(payload);
}

export async function nativeClearNextTrack() {
  await getNativePlugin()?.clearNextTrack?.();
}

export async function nativePause() {
  await getNativePlugin()?.pause();
}

export async function nativeResume() {
  await getNativePlugin()?.resume();
}

export async function nativeStop() {
  await getNativePlugin()?.stop();
}

export async function nativeGetStatus() {
  const p = getNativePlugin();
  if (!p?.getStatus) return { position: 0, duration: 0, playing: false, trackId: "", prepared: false };
  return p.getStatus();
}

export async function nativeSeekTo(seconds) {
  await getNativePlugin()?.seekTo({ position: seconds });
}