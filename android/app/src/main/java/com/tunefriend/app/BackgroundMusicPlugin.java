/*
 * TuneFriend
 * Copyright (C) 2026 James
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

package com.tunefriend.app;

import android.content.Intent;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "BackgroundMusic")
public class BackgroundMusicPlugin extends Plugin {

    @Override
    public void load() {
        MusicPlaybackService.setCallback(new MusicPlaybackService.PlaybackCallback() {
            @Override
            public void onPrepared() {
                notifyListeners("prepared", new JSObject());
            }

            @Override
            public void onEnded() {
                notifyListeners("ended", new JSObject());
            }

            @Override
            public void onTrackAdvanced(String trackId) {
                JSObject data = new JSObject();
                data.put("trackId", trackId != null ? trackId : "");
                notifyListeners("trackAdvanced", data);
            }

            @Override
            public void onError(String message) {
                JSObject data = new JSObject();
                data.put("message", message);
                notifyListeners("error", data);
            }
        });

        MusicPlaybackService.setMediaControlCallback(new MusicPlaybackService.MediaControlCallback() {
            @Override
            public void onSkipToNext() {
                notifyListeners("skipNext", new JSObject());
            }

            @Override
            public void onSkipToPrevious() {
                notifyListeners("skipPrevious", new JSObject());
            }
        });
    }

    @PluginMethod
    public void play(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            call.reject("Missing url");
            return;
        }

        Intent intent = new Intent(getContext(), MusicPlaybackService.class);
        intent.setAction(MusicPlaybackService.ACTION_PLAY);
        intent.putExtra("url", url);
        intent.putExtra("title", call.getString("title", ""));
        intent.putExtra("artist", call.getString("artist", ""));
        intent.putExtra("artworkUrl", call.getString("artworkUrl", ""));
        intent.putExtra("trackId", call.getString("trackId", ""));
        intent.putExtra("nextUrl", call.getString("nextUrl", ""));
        intent.putExtra("nextTitle", call.getString("nextTitle", ""));
        intent.putExtra("nextArtist", call.getString("nextArtist", ""));
        intent.putExtra("nextArtworkUrl", call.getString("nextArtworkUrl", ""));
        intent.putExtra("nextTrackId", call.getString("nextTrackId", ""));
        putModeExtras(intent, call);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(intent);
        } else {
            getContext().startService(intent);
        }
        call.resolve();
    }

    @PluginMethod
    public void setNextTrack(PluginCall call) {
        String nextUrl = call.getString("nextUrl");
        if (nextUrl == null || nextUrl.isEmpty()) {
            call.resolve();
            return;
        }

        Intent intent = new Intent(getContext(), MusicPlaybackService.class);
        intent.setAction(MusicPlaybackService.ACTION_SET_NEXT);
        intent.putExtra("nextUrl", nextUrl);
        intent.putExtra("nextTitle", call.getString("nextTitle", ""));
        intent.putExtra("nextArtist", call.getString("nextArtist", ""));
        intent.putExtra("nextArtworkUrl", call.getString("nextArtworkUrl", ""));
        intent.putExtra("nextTrackId", call.getString("nextTrackId", ""));
        putModeExtras(intent, call);
        getContext().startService(intent);
        call.resolve();
    }

    @PluginMethod
    public void setQueue(PluginCall call) {
        String queueJson = call.getString("queueJson");
        if (queueJson == null || queueJson.isEmpty()) {
            call.resolve();
            return;
        }
        int queueIndex = call.getInt("queueIndex", 0);
        boolean shuffle = call.getBoolean("shuffle", false);
        boolean repeat = call.getBoolean("repeat", false);
        MusicPlaybackService.setQueueState(queueJson, queueIndex, shuffle, repeat);
        call.resolve();
    }

    private void putModeExtras(Intent intent, PluginCall call) {
        JSObject data = call.getData();
        if (data == null) return;
        if (data.has("shuffle")) intent.putExtra("shuffle", call.getBoolean("shuffle", false));
        if (data.has("repeat")) intent.putExtra("repeat", call.getBoolean("repeat", false));
    }

    @PluginMethod
    public void clearNextTrack(PluginCall call) {
        Intent intent = new Intent(getContext(), MusicPlaybackService.class);
        intent.setAction(MusicPlaybackService.ACTION_SET_NEXT);
        intent.putExtra("nextUrl", "");
        getContext().startService(intent);
        call.resolve();
    }

    @PluginMethod
    public void pause(PluginCall call) {
        Intent intent = new Intent(getContext(), MusicPlaybackService.class);
        intent.setAction(MusicPlaybackService.ACTION_PAUSE);
        getContext().startService(intent);
        call.resolve();
    }

    @PluginMethod
    public void resume(PluginCall call) {
        Intent intent = new Intent(getContext(), MusicPlaybackService.class);
        intent.setAction(MusicPlaybackService.ACTION_RESUME);
        getContext().startService(intent);
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent intent = new Intent(getContext(), MusicPlaybackService.class);
        intent.setAction(MusicPlaybackService.ACTION_STOP);
        getContext().startService(intent);
        call.resolve();
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        boolean prepared = MusicPlaybackService.isPrepared();
        JSObject ret = new JSObject();
        ret.put("prepared", prepared);
        ret.put("position", prepared ? MusicPlaybackService.getPositionMs() / 1000.0 : 0);
        ret.put("duration", prepared ? MusicPlaybackService.getDurationMs() / 1000.0 : 0);
        ret.put("playing", MusicPlaybackService.isCurrentlyPlaying());
        ret.put("wantsPlaying", MusicPlaybackService.wantsToPlay());
        ret.put("trackId", MusicPlaybackService.getCurrentTrackId());
        call.resolve(ret);
    }

    @PluginMethod
    public void seekTo(PluginCall call) {
        Double position = call.getDouble("position");
        if (position == null) {
            call.reject("Missing position");
            return;
        }
        MusicPlaybackService.seekToMs((int) (position * 1000));
        call.resolve();
    }
}