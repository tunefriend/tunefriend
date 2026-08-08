/*
 * TuneFriend
 * Copyright (C) 2026 James
 *
 * Pending thumbs from home widgets → applied in WebView favorites on next open.
 * Also caches per-track rating so the Now Playing widget can highlight 👍/👎.
 */

package com.tunefriend.app;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;

public final class WidgetRatingStore {
    private static final String PREFS = "tunefriend_widget_ratings";
    private static final String KEY_PENDING = "pending_json";
    private static final String KEY_RATINGS = "track_ratings_json"; // { trackId: "up"|"down" }

    private WidgetRatingStore() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** @param action "up" or "down" */
    public static synchronized void queueRating(
            Context ctx,
            String trackId,
            String title,
            String artist,
            String artworkUrl,
            String url,
            String action
    ) {
        if (ctx == null || trackId == null || trackId.isEmpty()) return;
        if (!"up".equals(action) && !"down".equals(action)) return;
        try {
            SharedPreferences p = prefs(ctx);
            JSONArray pending = new JSONArray(p.getString(KEY_PENDING, "[]"));
            // Collapse duplicates for same track — keep latest action only
            JSONArray next = new JSONArray();
            for (int i = 0; i < pending.length(); i++) {
                JSONObject o = pending.optJSONObject(i);
                if (o == null) continue;
                if (trackId.equals(o.optString("trackId", ""))) continue;
                next.put(o);
            }
            // Toggle semantics (same as in-app thumbs): second tap clears.
            JSONObject ratings = new JSONObject(p.getString(KEY_RATINGS, "{}"));
            String existing = ratings.optString(trackId, "");
            String finalAction;
            if (action.equals(existing)) {
                ratings.remove(trackId);
                finalAction = "none";
            } else {
                ratings.put(trackId, action);
                finalAction = action;
            }
            p.edit().putString(KEY_RATINGS, ratings.toString()).apply();

            // Queue absolute final state so JS does not double-toggle offline multi-taps
            JSONObject row = new JSONObject();
            row.put("trackId", trackId);
            row.put("title", title != null ? title : "");
            row.put("artist", artist != null ? artist : "");
            row.put("artworkUrl", artworkUrl != null ? artworkUrl : "");
            row.put("url", url != null ? url : "");
            row.put("action", finalAction); // "up" | "down" | "none"
            row.put("at", System.currentTimeMillis());
            next.put(row);
            p.edit().putString(KEY_PENDING, next.toString()).apply();
        } catch (Exception ignored) {}
    }

    public static String ratingFor(Context ctx, String trackId) {
        if (ctx == null || trackId == null || trackId.isEmpty()) return "none";
        try {
            JSONObject ratings = new JSONObject(prefs(ctx).getString(KEY_RATINGS, "{}"));
            String r = ratings.optString(trackId, "");
            if ("up".equals(r) || "down".equals(r)) return r;
        } catch (Exception ignored) {}
        return "none";
    }

    /**
     * Merge full liked-id set from the web app so the widget stays in sync.
     * likedIdsJson: ["id1","id2"]  blockedIdsJson: ["id3"]
     */
    public static void syncFromWeb(Context ctx, String likedIdsJson, String blockedIdsJson) {
        if (ctx == null) return;
        try {
            JSONObject ratings = new JSONObject();
            JSONArray liked = new JSONArray(likedIdsJson != null ? likedIdsJson : "[]");
            for (int i = 0; i < liked.length(); i++) {
                String id = liked.optString(i, "");
                if (!id.isEmpty()) ratings.put(id, "up");
            }
            JSONArray blocked = new JSONArray(blockedIdsJson != null ? blockedIdsJson : "[]");
            for (int i = 0; i < blocked.length(); i++) {
                String id = blocked.optString(i, "");
                if (!id.isEmpty()) ratings.put(id, "down");
            }
            prefs(ctx).edit().putString(KEY_RATINGS, ratings.toString()).apply();
        } catch (Exception ignored) {}
    }

    /** Drain and clear pending widget ratings for JS to apply. */
    public static synchronized String drainPendingJson(Context ctx) {
        if (ctx == null) return "[]";
        SharedPreferences p = prefs(ctx);
        String json = p.getString(KEY_PENDING, "[]");
        p.edit().putString(KEY_PENDING, "[]").apply();
        return json != null ? json : "[]";
    }
}
