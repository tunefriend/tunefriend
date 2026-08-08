/*
 * TuneFriend
 * Copyright (C) 2026 James
 *
 * One-tap shuffle of Liked tracks (synced for Android Auto).
 */

package com.tunefriend.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.widget.RemoteViews;

public class QuickPlayWidget extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        updateAll(context, appWidgetManager, appWidgetIds);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (intent != null && "com.tunefriend.app.quick.SHUFFLE".equals(intent.getAction())) {
            Intent i = PlaybackWidgetUpdater.serviceIntent(
                context, MusicPlaybackService.ACTION_SHUFFLE_LIKED);
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(i);
                } else {
                    context.startService(i);
                }
            } catch (Exception ignored) {}
            AppWidgetManager mgr = AppWidgetManager.getInstance(context);
            int[] ids = mgr.getAppWidgetIds(
                new android.content.ComponentName(context, QuickPlayWidget.class));
            updateAll(context, mgr, ids);
        }
    }

    static void updateAll(Context context, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) {
            mgr.updateAppWidget(id, buildViews(context));
        }
    }

    private static RemoteViews buildViews(Context context) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_quick_play);
        int liked = AutoLibraryStore.likedCount(context);
        views.setTextViewText(R.id.widget_quick_subtitle,
            liked > 0 ? liked + " liked · tap to shuffle" : "Like songs in app first");

        Intent shuffle = new Intent(context, QuickPlayWidget.class);
        shuffle.setAction("com.tunefriend.app.quick.SHUFFLE");
        PendingIntent shufflePi = PendingIntent.getBroadcast(context, 400, shuffle,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widget_quick_root, shufflePi);
        views.setOnClickPendingIntent(R.id.widget_quick_btn, shufflePi);
        return views;
    }
}
