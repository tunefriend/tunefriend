/*
 * TuneFriend
 * Copyright (C) 2026 James
 *
 * Tier-1 home widget: title, artist, transport, thumbs up/down.
 */

package com.tunefriend.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.widget.RemoteViews;

public class NowPlayingWidget extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        updateAll(context, appWidgetManager, appWidgetIds);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (intent != null && intent.getAction() != null
                && intent.getAction().startsWith("com.tunefriend.app.widget.")) {
            String action = intent.getAction().substring("com.tunefriend.app.widget.".length());
            startServiceAction(context, action);
            AppWidgetManager mgr = AppWidgetManager.getInstance(context);
            int[] ids = mgr.getAppWidgetIds(
                new android.content.ComponentName(context, NowPlayingWidget.class));
            updateAll(context, mgr, ids);
        }
    }

    static void updateAll(Context context, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) {
            mgr.updateAppWidget(id, buildViews(context));
        }
    }

    private static RemoteViews buildViews(Context context) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_now_playing);
        String title = PlaybackWidgetStore.title(context);
        String artist = PlaybackWidgetStore.artist(context);
        boolean playing = PlaybackWidgetStore.playing(context);
        String trackId = MusicPlaybackService.getCurrentTrackId();
        if (trackId == null || trackId.isEmpty()) {
            trackId = PlaybackWidgetStore.trackId(context);
        }
        String rating = WidgetRatingStore.ratingFor(context, trackId);

        if (title == null || title.isEmpty()) title = "TuneFriend";
        if (artist == null || artist.isEmpty()) artist = playing ? "Playing" : "Not playing";

        views.setTextViewText(R.id.widget_np_title, title);
        views.setTextViewText(R.id.widget_np_artist, artist);
        views.setImageViewResource(
            R.id.widget_np_play,
            playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play
        );

        // Active thumbs: 👍 green-blue, 👎 warm red; inactive muted
        int upColor = "up".equals(rating) ? 0xFF5BDC8A : 0xFF8A8A9A;
        int downColor = "down".equals(rating) ? 0xFFFF6B6B : 0xFF8A8A9A;
        views.setInt(R.id.widget_np_thumb_up, "setColorFilter", upColor);
        views.setInt(R.id.widget_np_thumb_down, "setColorFilter", downColor);

        views.setOnClickPendingIntent(R.id.widget_np_root, openApp(context, 200));
        views.setOnClickPendingIntent(R.id.widget_np_prev,
            widgetAction(context, MusicPlaybackService.ACTION_PREVIOUS, 201));
        views.setOnClickPendingIntent(R.id.widget_np_play,
            widgetAction(context, MusicPlaybackService.ACTION_TOGGLE, 202));
        views.setOnClickPendingIntent(R.id.widget_np_next,
            widgetAction(context, MusicPlaybackService.ACTION_NEXT, 203));
        views.setOnClickPendingIntent(R.id.widget_np_thumb_up,
            widgetAction(context, MusicPlaybackService.ACTION_THUMBS_UP, 204));
        views.setOnClickPendingIntent(R.id.widget_np_thumb_down,
            widgetAction(context, MusicPlaybackService.ACTION_THUMBS_DOWN, 205));
        return views;
    }

    private static PendingIntent openApp(Context context, int req) {
        Intent i = new Intent(context, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP
            | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        return PendingIntent.getActivity(context, req, i,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent widgetAction(Context context, String serviceAction, int req) {
        Intent i = new Intent(context, NowPlayingWidget.class);
        i.setAction("com.tunefriend.app.widget." + serviceAction);
        return PendingIntent.getBroadcast(context, req, i,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void startServiceAction(Context context, String action) {
        Intent i = PlaybackWidgetUpdater.serviceIntent(context, action);
        try {
            if (MusicPlaybackService.isAlive()) {
                context.startService(i);
            } else if (MusicPlaybackService.ACTION_SHUFFLE_LIKED.equals(action)
                    || MusicPlaybackService.ACTION_PLAY.equals(action)) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(i);
                } else {
                    context.startService(i);
                }
            } else if (MusicPlaybackService.ACTION_TOGGLE.equals(action)
                    || MusicPlaybackService.ACTION_RESUME.equals(action)
                    || MusicPlaybackService.ACTION_ENSURE_PLAYING.equals(action)) {
                Intent shuffle = PlaybackWidgetUpdater.serviceIntent(
                    context, MusicPlaybackService.ACTION_SHUFFLE_LIKED);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(shuffle);
                } else {
                    context.startService(shuffle);
                }
            } else if (MusicPlaybackService.ACTION_THUMBS_UP.equals(action)
                    || MusicPlaybackService.ACTION_THUMBS_DOWN.equals(action)) {
                // Need a live session to know the current track
                if (MusicPlaybackService.isAlive()) {
                    context.startService(i);
                }
            }
        } catch (Exception ignored) {}
    }
}
