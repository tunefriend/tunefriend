/*
 * TuneFriend
 * Copyright (C) 2026 James
 *
 * SharedPreferences snapshot for home-screen widgets when the service is idle.
 */

package com.tunefriend.app;

import android.content.Context;
import android.content.SharedPreferences;

public final class PlaybackWidgetStore {
    private static final String PREFS = "tunefriend_widget";
    private static final String KEY_TITLE = "title";
    private static final String KEY_ARTIST = "artist";
    private static final String KEY_ARTWORK = "artwork";
    private static final String KEY_TRACK_ID = "trackId";
    private static final String KEY_PLAYING = "playing";
    private static final String KEY_WANTS = "wantsPlay";

    private PlaybackWidgetStore() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static void save(Context ctx, String title, String artist, String artworkUrl,
                            String trackId, boolean playing, boolean wantsPlay) {
        if (ctx == null) return;
        prefs(ctx).edit()
            .putString(KEY_TITLE, title != null ? title : "")
            .putString(KEY_ARTIST, artist != null ? artist : "")
            .putString(KEY_ARTWORK, artworkUrl != null ? artworkUrl : "")
            .putString(KEY_TRACK_ID, trackId != null ? trackId : "")
            .putBoolean(KEY_PLAYING, playing)
            .putBoolean(KEY_WANTS, wantsPlay)
            .apply();
    }

    public static String title(Context ctx) {
        String live = MusicPlaybackService.widgetTitle();
        if (live != null && !live.isEmpty()) return live;
        return prefs(ctx).getString(KEY_TITLE, "");
    }

    public static String artist(Context ctx) {
        String live = MusicPlaybackService.widgetArtist();
        if (live != null && !live.isEmpty()) return live;
        return prefs(ctx).getString(KEY_ARTIST, "");
    }

    public static boolean playing(Context ctx) {
        if (MusicPlaybackService.isAlive()) return MusicPlaybackService.widgetPlaying();
        return prefs(ctx).getBoolean(KEY_PLAYING, false);
    }

    public static boolean wantsPlay(Context ctx) {
        if (MusicPlaybackService.isAlive()) return MusicPlaybackService.widgetWantsPlay();
        return prefs(ctx).getBoolean(KEY_WANTS, false);
    }

    public static String trackId(Context ctx) {
        String live = MusicPlaybackService.getCurrentTrackId();
        if (live != null && !live.isEmpty()) return live;
        return prefs(ctx).getString(KEY_TRACK_ID, "");
    }
}
