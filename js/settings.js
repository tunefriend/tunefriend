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