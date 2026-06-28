/*
 * TuneFriend
 * Copyright (C) 2026 James
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

const SETTINGS_KEY = "tunefriend_settings";

const DEFAULTS = {
  shuffleDefault: false,
  bitrate: 320,
};

export function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY)) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...loadSettings(), ...settings }));
}

export const BITRATE_OPTIONS = [
  { value: 128, label: "Low (128 kbps)" },
  { value: 192, label: "Medium (192 kbps)" },
  { value: 320, label: "High (320 kbps)" },
];