/*
 * TuneFriend
 * Copyright (C) 2026 James
 *
 * Compact 2x1 widget: track line + play/pause + next.
 */

package com.tunefriend.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.widget.RemoteViews;

public class MiniPlayerWidget extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        updateAll(context, appWidgetManager, appWidgetIds);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (intent != null && intent.getAction() != null
                && intent.getAction().startsWith("com.tunefriend.app.mini.")) {
            String action = intent.getAction().substring("com.tunefriend.app.mini.".length());
            startServiceAction(context, action);
            AppWidgetManager mgr = AppWidgetManager.getInstance(context);
            int[] ids = mgr.getAppWidgetIds(
                new android.content.ComponentName(context, MiniPlayerWidget.class));
            updateAll(context, mgr, ids);
        }
    }

    static void updateAll(Context context, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) {
            mgr.updateAppWidget(id, buildViews(context));
        }
    }

    private static RemoteViews buildViews(Context context) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_mini_player);
        String title = PlaybackWidgetStore.title(context);
        String artist = PlaybackWidgetStore.artist(context);
        boolean playing = PlaybackWidgetStore.playing(context);

        String line;
        if (title == null || title.isEmpty()) {
            line = "TuneFriend";
        } else if (artist != null && !artist.isEmpty()) {
            line = title + " · " + artist;
        } else {
            line = title;
        }
        views.setTextViewText(R.id.widget_mini_title, line);
        views.setImageViewResource(
            R.id.widget_mini_play,
            playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play
        );

        views.setOnClickPendingIntent(R.id.widget_mini_root, openApp(context, 300));
        views.setOnClickPendingIntent(R.id.widget_mini_play,
            widgetAction(context, MusicPlaybackService.ACTION_TOGGLE, 301));
        views.setOnClickPendingIntent(R.id.widget_mini_next,
            widgetAction(context, MusicPlaybackService.ACTION_NEXT, 302));
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
        Intent i = new Intent(context, MiniPlayerWidget.class);
        i.setAction("com.tunefriend.app.mini." + serviceAction);
        return PendingIntent.getBroadcast(context, req, i,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void startServiceAction(Context context, String action) {
        Intent i = PlaybackWidgetUpdater.serviceIntent(context, action);
        try {
            if (MusicPlaybackService.isAlive()) {
                context.startService(i);
            } else if (MusicPlaybackService.ACTION_TOGGLE.equals(action)
                    || MusicPlaybackService.ACTION_RESUME.equals(action)) {
                Intent shuffle = PlaybackWidgetUpdater.serviceIntent(
                    context, MusicPlaybackService.ACTION_SHUFFLE_LIKED);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(shuffle);
                } else {
                    context.startService(shuffle);
                }
            }
        } catch (Exception ignored) {}
    }
}
