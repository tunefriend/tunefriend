/*
 * TuneFriend
 * Copyright (C) 2026 James
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

const SESSION_KEY = "tunefriend_playback_session";

function stripSong(song) {
  if (!song) return null;
  const { streamUrl, coverArtUrl, ...rest } = song;
  return rest;
}

const MAX_SAVED_QUEUE = 100;

export function savePlaybackSession({ queue, index, position, shuffle, repeat, wasPlaying }) {
  if (!queue?.length || index < 0) {
    localStorage.removeItem(SESSION_KEY);
    return;
  }
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      queue: queue.slice(0, MAX_SAVED_QUEUE).map(stripSong),
      index,
      position: Math.max(0, position || 0),
      shuffle: !!shuffle,
      repeat: !!repeat,
      wasPlaying: !!wasPlaying,
      savedAt: Date.now(),
    }));
  } catch {
    // Storage full — ignore
  }
}

export function loadPlaybackSession() {
  try {
    const data = JSON.parse(localStorage.getItem(SESSION_KEY));
    if (!data?.queue?.length || data.index < 0) return null;
    return data;
  } catch {
    return null;
  }
}

export function clearPlaybackSession() {
  localStorage.removeItem(SESSION_KEY);
}