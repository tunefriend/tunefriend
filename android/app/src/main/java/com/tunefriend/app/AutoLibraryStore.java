/*
 * TuneFriend
 * Copyright (C) 2026 James
 *
 * Encrypted store for Android Auto browse content (Liked songs + stream URLs).
 * Uses EncryptedSharedPreferences so auth tokens in stream URLs are not plain text.
 */

package com.tunefriend.app;

import android.content.Context;
import android.content.SharedPreferences;
import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

public final class AutoLibraryStore {
    private static final String PREFS = "tunefriend_auto_library_secure";
    private static final String LEGACY_PREFS = "tunefriend_auto_library";
    private static final String KEY_LIKED = "liked_json";

    private static SharedPreferences securePrefs;

    private AutoLibraryStore() {}

    public static class LikedTrack {
        public String trackId = "";
        public String title = "";
        public String artist = "";
        public String artworkUrl = "";
        public String url = "";
    }

    private static SharedPreferences prefs(Context ctx) {
        if (securePrefs != null) return securePrefs;
        try {
            Context app = ctx.getApplicationContext();
            MasterKey masterKey = new MasterKey.Builder(app)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build();
            securePrefs = EncryptedSharedPreferences.create(
                app,
                PREFS,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            );
            // One-time migrate plain prefs if present
            SharedPreferences legacy = app.getSharedPreferences(LEGACY_PREFS, Context.MODE_PRIVATE);
            String old = legacy.getString(KEY_LIKED, null);
            if (old != null && !old.isEmpty() && !securePrefs.contains(KEY_LIKED)) {
                securePrefs.edit().putString(KEY_LIKED, old).apply();
                legacy.edit().clear().apply();
            }
            return securePrefs;
        } catch (Exception e) {
            // Fallback (should be rare) — still better than crashing Auto
            return ctx.getApplicationContext().getSharedPreferences(LEGACY_PREFS, Context.MODE_PRIVATE);
        }
    }

    public static void saveLikedJson(Context ctx, String json) {
        if (ctx == null) return;
        prefs(ctx).edit().putString(KEY_LIKED, json != null ? json : "[]").apply();
        MusicPlaybackService.notifyLikedChanged();
    }

    public static List<LikedTrack> loadLiked(Context ctx) {
        List<LikedTrack> out = new ArrayList<>();
        if (ctx == null) return out;
        String json = prefs(ctx).getString(KEY_LIKED, "[]");
        try {
            JSONArray arr = new JSONArray(json);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                LikedTrack t = new LikedTrack();
                t.trackId = o.optString("trackId", o.optString("id", ""));
                t.title = o.optString("title", "Unknown");
                t.artist = o.optString("artist", "");
                t.artworkUrl = o.optString("artworkUrl", "");
                t.url = o.optString("url", o.optString("streamUrl", ""));
                if (t.url.isEmpty()) continue;
                out.add(t);
            }
        } catch (Exception ignored) {}
        return out;
    }

    public static int likedCount(Context ctx) {
        return loadLiked(ctx).size();
    }
}
