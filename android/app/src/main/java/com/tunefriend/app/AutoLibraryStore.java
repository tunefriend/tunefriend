/*
 * TuneFriend
 * Copyright (C) 2026 James
 *
 * SharedPreferences store for Android Auto browse content (Liked songs).
 * The WebView app syncs thumbs-up tracks here via BackgroundMusicPlugin.
 */

package com.tunefriend.app;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

public final class AutoLibraryStore {
    private static final String PREFS = "tunefriend_auto_library";
    private static final String KEY_LIKED = "liked_json";

    private AutoLibraryStore() {}

    public static class LikedTrack {
        public String trackId = "";
        public String title = "";
        public String artist = "";
        public String artworkUrl = "";
        public String url = "";
    }

    public static void saveLikedJson(Context ctx, String json) {
        if (ctx == null) return;
        SharedPreferences prefs = ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        prefs.edit().putString(KEY_LIKED, json != null ? json : "[]").apply();
        MusicPlaybackService.notifyLikedChanged();
    }

    public static List<LikedTrack> loadLiked(Context ctx) {
        List<LikedTrack> out = new ArrayList<>();
        if (ctx == null) return out;
        SharedPreferences prefs = ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String json = prefs.getString(KEY_LIKED, "[]");
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
                if (t.url.isEmpty()) continue; // Auto needs a playable stream URL
                out.add(t);
            }
        } catch (Exception ignored) {}
        return out;
    }

    public static int likedCount(Context ctx) {
        return loadLiked(ctx).size();
    }
}
