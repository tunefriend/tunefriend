/*
 * TuneFriend — AcoustID / Chromaprint song identify
 * Copyright (C) 2026 James — GPL-3.0-or-later
 */

import { isNativeApp } from "./api.js";
import { loadSettings } from "./settings.js";

/** Free AcoustID application key — register at https://acoustid.org/new-application */
const DEFAULT_ACOUSTID_CLIENT = ""; // filled via Settings or Worker proxy

function getIdentifyPlugin() {
  if (!isNativeApp()) return null;
  const cap = window.Capacitor;
  return cap?.Plugins?.AudioIdentify
    || (cap?.registerPlugin && cap.registerPlugin("AudioIdentify"))
    || null;
}

export function canIdentifyNative() {
  return !!getIdentifyPlugin()?.fingerprintMic;
}

/**
 * Record mic → Chromaprint fingerprint (native plugin).
 * @returns {{ fingerprint: string, duration: number }}
 */
export async function fingerprintFromMic() {
  const plugin = getIdentifyPlugin();
  if (!plugin?.fingerprintMic) {
    throw new Error("Identify needs the Android app (not available in this browser yet)");
  }
  return plugin.fingerprintMic();
}

function acoustidProxyBases() {
  const bases = [];
  try {
    const origin = window.location?.origin;
    if (origin && origin !== "null" && !origin.startsWith("capacitor:") && !origin.startsWith("file:")) {
      bases.push(origin);
    }
  } catch {
    /* ignore */
  }
  // Native app / file:// — use public Worker so the key can stay server-side
  bases.push("https://tunefriend.org");
  return [...new Set(bases)];
}

/**
 * Lookup fingerprint on AcoustID (MusicBrainz-linked, open service).
 * Tries /api/acoustid proxy (local or tunefriend.org), then direct with Settings key.
 */
export async function lookupAcoustId(fingerprint, duration) {
  const settings = loadSettings();
  const client = (settings.acoustidClient || DEFAULT_ACOUSTID_CLIENT || "").trim();
  const durationStr = String(Math.round(duration) || 1);

  for (const base of acoustidProxyBases()) {
    try {
      const proxyUrl = new URL("/api/acoustid", base);
      proxyUrl.searchParams.set("fingerprint", fingerprint);
      proxyUrl.searchParams.set("duration", durationStr);
      if (client) proxyUrl.searchParams.set("client", client);
      const res = await fetch(proxyUrl.toString());
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.status === "ok") {
        return parseAcoustIdResponse(data);
      }
      // Proxy has no key configured — try next base / direct
      if (data.error && /no client|missing client|not configured/i.test(String(data.error))) {
        continue;
      }
      if (res.ok && data.status === "error") {
        throw new Error(data.error?.message || data.message || "AcoustID lookup failed");
      }
    } catch (e) {
      if (e?.message && /AcoustID lookup failed|invalid/i.test(e.message)) throw e;
      /* proxy unavailable — try next */
    }
  }

  if (!client) {
    throw new Error(
      "Add a free AcoustID API key in Settings (acoustid.org/new-application), or use the website which can proxy lookups."
    );
  }

  const url = new URL("https://api.acoustid.org/v2/lookup");
  url.searchParams.set("client", client);
  url.searchParams.set("meta", "recordings+releasegroups+compress");
  url.searchParams.set("fingerprint", fingerprint);
  url.searchParams.set("duration", durationStr);

  const res = await fetch(url.toString());
  const data = await res.json();
  if (data.status !== "ok") {
    throw new Error(data.error?.message || data.message || "AcoustID lookup failed");
  }
  return parseAcoustIdResponse(data);
}

function parseAcoustIdResponse(data) {
  const results = Array.isArray(data.results) ? data.results : [];
  const matches = [];
  for (const r of results) {
    const score = r.score || 0;
    const recordings = Array.isArray(r.recordings) ? r.recordings : [];
    for (const rec of recordings) {
      const title = rec.title || "Unknown title";
      const artists = (rec.artists || []).map((a) => a.name).filter(Boolean);
      const artist = artists.join(", ") || "Unknown artist";
      matches.push({
        title,
        artist,
        score,
        recordingId: rec.id || "",
      });
    }
  }
  // Prefer higher score, unique title+artist
  matches.sort((a, b) => b.score - a.score);
  const seen = new Set();
  return matches.filter((m) => {
    const k = (m.title + "|" + m.artist).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Find songs in the local library cache matching identified title/artist.
 */
export function matchInLibrary(songs, { title, artist }) {
  if (!songs?.length) return [];
  const t = normalize(title);
  const a = normalize(artist);
  if (!t) return [];

  const scored = [];
  for (const s of songs) {
    const st = normalize(s.title);
    const sa = normalize(s.artist);
    let score = 0;
    if (st === t) score += 5;
    else if (st.includes(t) || t.includes(st)) score += 3;
    else continue;

    if (a) {
      if (sa === a) score += 4;
      else if (sa.includes(a) || a.includes(sa)) score += 2;
      else if (a.split(/\s+/).filter((w) => w.length > 2).every((w) => sa.includes(w))) score += 1;
      else score -= 1;
    }
    if (score >= 3) scored.push({ song: s, score });
  }
  scored.sort((x, y) => y.score - x.score);
  return scored.map((x) => x.song);
}

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
