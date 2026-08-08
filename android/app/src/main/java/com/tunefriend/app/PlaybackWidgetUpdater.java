/*
 * TuneFriend
 * Copyright (C) 2026 James
 */

package com.tunefriend.app;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;

public final class PlaybackWidgetUpdater {
    private PlaybackWidgetUpdater() {}

    public static void updateAll(Context ctx) {
        if (ctx == null) return;
        Context app = ctx.getApplicationContext();
        try {
            AppWidgetManager mgr = AppWidgetManager.getInstance(app);
            int[] nowPlaying = mgr.getAppWidgetIds(new ComponentName(app, NowPlayingWidget.class));
            if (nowPlaying.length > 0) {
                NowPlayingWidget.updateAll(app, mgr, nowPlaying);
            }
            int[] mini = mgr.getAppWidgetIds(new ComponentName(app, MiniPlayerWidget.class));
            if (mini.length > 0) {
                MiniPlayerWidget.updateAll(app, mgr, mini);
            }
            int[] quick = mgr.getAppWidgetIds(new ComponentName(app, QuickPlayWidget.class));
            if (quick.length > 0) {
                QuickPlayWidget.updateAll(app, mgr, quick);
            }
        } catch (Exception ignored) {}
    }

    public static Intent serviceIntent(Context ctx, String action) {
        Intent i = new Intent(ctx, MusicPlaybackService.class);
        i.setAction(action);
        return i;
    }
}
