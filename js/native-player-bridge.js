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
let listeners = { ended: [], error: [], prepared: [] };
let wired = false;

function wirePlugin(p) {
  if (!p || wired) return;
  wired = true;
  p.addListener("ended", () => listeners.ended.forEach((fn) => fn()));
  p.addListener("error", (e) => listeners.error.forEach((fn) => fn(e?.message || "Playback error")));
  p.addListener("prepared", () => listeners.prepared.forEach((fn) => fn()));
}

export function getNativePlugin() {
  if (!isNativeApp()) return null;
  if (plugin) return plugin;

  const cap = window.Capacitor;
  if (!cap) return null;

  // Required: register the local Android plugin on the JS side
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

export async function nativePlay(song) {
  const p = getNativePlugin();
  if (!p) throw new Error("Native player unavailable — reinstall latest APK");
  await p.play({
    url: song.streamUrl,
    title: song.title || "",
    artist: song.artist || "",
  });
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
  if (!p?.getStatus) return { position: 0, duration: 0, playing: false };
  return p.getStatus();
}

export async function nativeSeekTo(seconds) {
  await getNativePlugin()?.seekTo({ position: seconds });
}