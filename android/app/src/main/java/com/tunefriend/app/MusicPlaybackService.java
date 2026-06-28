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

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import android.support.v4.media.MediaMetadataCompat;
import androidx.core.app.NotificationCompat;
import androidx.media.app.NotificationCompat.MediaStyle;
import java.net.HttpURLConnection;
import java.net.URL;

public class MusicPlaybackService extends Service {
    public static final String CHANNEL_ID = "tunefriend_music";
    public static final int NOTIFICATION_ID = 1001;

    public static final String ACTION_PLAY = "PLAY";
    public static final String ACTION_PAUSE = "PAUSE";
    public static final String ACTION_RESUME = "RESUME";
    public static final String ACTION_STOP = "STOP";
    public static final String ACTION_PREVIOUS = "PREVIOUS";
    public static final String ACTION_NEXT = "NEXT";

    private static PlaybackCallback callback;
    private static MediaControlCallback mediaControlCallback;
    private static MusicPlaybackService instance;

    private MediaPlayer mediaPlayer;
    private MediaSessionCompat mediaSession;
    private PowerManager.WakeLock wakeLock;
    private AudioManager audioManager;
    private AudioFocusRequest audioFocusRequest;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private String currentTitle = "";
    private String currentArtist = "";
    private String currentArtworkUrl = "";
    private Bitmap currentAlbumArt = null;
    private boolean isPaused = false;

    public interface PlaybackCallback {
        void onPrepared();
        void onEnded();
        void onError(String message);
    }

    public interface MediaControlCallback {
        void onSkipToNext();
        void onSkipToPrevious();
    }

    public static void setCallback(PlaybackCallback cb) {
        callback = cb;
    }

    public static void setMediaControlCallback(MediaControlCallback cb) {
        mediaControlCallback = cb;
    }

    public static int getPositionMs() {
        if (instance == null || instance.mediaPlayer == null) return 0;
        try {
            return instance.mediaPlayer.getCurrentPosition();
        } catch (Exception e) {
            return 0;
        }
    }

    public static int getDurationMs() {
        if (instance == null || instance.mediaPlayer == null) return 0;
        try {
            int d = instance.mediaPlayer.getDuration();
            return d > 0 ? d : 0;
        } catch (Exception e) {
            return 0;
        }
    }

    public static boolean isCurrentlyPlaying() {
        if (instance == null || instance.mediaPlayer == null) return false;
        try {
            return instance.mediaPlayer.isPlaying();
        } catch (Exception e) {
            return false;
        }
    }

    public static void seekToMs(int ms) {
        if (instance == null || instance.mediaPlayer == null) return;
        try {
            instance.mediaPlayer.seekTo(Math.max(0, ms));
            instance.updatePlaybackState(!instance.isPaused);
        } catch (Exception ignored) {}
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        audioManager = (AudioManager) getSystemService(AUDIO_SERVICE);
        createNotificationChannel();
        initMediaSession();
    }

    private void initMediaSession() {
        mediaSession = new MediaSessionCompat(this, "TuneFriend");
        mediaSession.setFlags(
            MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS |
            MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
        );
        mediaSession.setCallback(new MediaSessionCompat.Callback() {
            @Override
            public void onPlay() {
                resume();
            }

            @Override
            public void onPause() {
                pause();
            }

            @Override
            public void onSkipToNext() {
                dispatchSkipNext();
            }

            @Override
            public void onSkipToPrevious() {
                dispatchSkipPrevious();
            }
        });
        mediaSession.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || intent.getAction() == null) return START_STICKY;

        switch (intent.getAction()) {
            case ACTION_PLAY:
                play(
                    intent.getStringExtra("url"),
                    intent.getStringExtra("title"),
                    intent.getStringExtra("artist"),
                    intent.getStringExtra("artworkUrl")
                );
                break;
            case ACTION_PAUSE:
                pause();
                break;
            case ACTION_RESUME:
                resume();
                break;
            case ACTION_STOP:
                stopPlayback();
                break;
            case ACTION_PREVIOUS:
                dispatchSkipPrevious();
                break;
            case ACTION_NEXT:
                dispatchSkipNext();
                break;
        }
        return START_STICKY;
    }

    private void play(String url, String title, String artist, String artworkUrl) {
        if (url == null || url.isEmpty()) return;
        currentTitle = title != null ? title : "TuneFriend";
        currentArtist = artist != null ? artist : "";
        currentArtworkUrl = artworkUrl != null ? artworkUrl : "";
        currentAlbumArt = null;
        isPaused = false;

        if (mediaSession != null) {
            mediaSession.setActive(true);
        }

        updateMetadata();
        updatePlaybackState(false);
        startForegroundNow(buildNotification(false));
        loadArtworkAsync(currentArtworkUrl);

        releasePlayer();
        acquireWakeLock();
        requestAudioFocus();

        mediaPlayer = new MediaPlayer();
        mediaPlayer.setAudioAttributes(
            new AudioAttributes.Builder()
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .build()
        );
        mediaPlayer.setWakeMode(getApplicationContext(), PowerManager.PARTIAL_WAKE_LOCK);

        try {
            mediaPlayer.setDataSource(url);
            mediaPlayer.setOnPreparedListener(mp -> {
                mp.start();
                isPaused = false;
                updatePlaybackState(true);
                updateNotification(true);
                if (callback != null) callback.onPrepared();
            });
            mediaPlayer.setOnCompletionListener(mp -> {
                if (callback != null) callback.onEnded();
            });
            mediaPlayer.setOnErrorListener((mp, what, extra) -> {
                if (callback != null) callback.onError("Playback error");
                return true;
            });
            mediaPlayer.prepareAsync();
        } catch (Exception e) {
            if (callback != null) callback.onError(e.getMessage());
            stopPlayback();
        }
    }

    private void loadArtworkAsync(String artworkUrl) {
        if (artworkUrl == null || artworkUrl.isEmpty()) return;
        new Thread(() -> {
            try {
                HttpURLConnection conn = (HttpURLConnection) new URL(artworkUrl).openConnection();
                conn.setConnectTimeout(8000);
                conn.setReadTimeout(8000);
                conn.connect();
                Bitmap bitmap = BitmapFactory.decodeStream(conn.getInputStream());
                conn.disconnect();
                if (bitmap == null) return;
                mainHandler.post(() -> {
                    currentAlbumArt = bitmap;
                    updateMetadata();
                    updateNotification(!isPaused && mediaPlayer != null);
                });
            } catch (Exception ignored) {}
        }).start();
    }

    private void dispatchSkipNext() {
        if (mediaControlCallback != null) mediaControlCallback.onSkipToNext();
    }

    private void dispatchSkipPrevious() {
        if (mediaControlCallback != null) mediaControlCallback.onSkipToPrevious();
    }

    private void startForegroundNow(Notification notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private void requestAudioFocus() {
        if (audioManager == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            audioFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(
                    new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build()
                )
                .setAcceptsDelayedFocusGain(true)
                .setOnAudioFocusChangeListener(focusChange -> {
                    if (focusChange == AudioManager.AUDIOFOCUS_LOSS) {
                        pause();
                    }
                })
                .build();
            audioManager.requestAudioFocus(audioFocusRequest);
        } else {
            audioManager.requestAudioFocus(
                focusChange -> {
                    if (focusChange == AudioManager.AUDIOFOCUS_LOSS) pause();
                },
                AudioManager.STREAM_MUSIC,
                AudioManager.AUDIOFOCUS_GAIN
            );
        }
    }

    private void abandonAudioFocus() {
        if (audioManager == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && audioFocusRequest != null) {
            audioManager.abandonAudioFocusRequest(audioFocusRequest);
        }
    }

    private void pause() {
        if (mediaPlayer != null && mediaPlayer.isPlaying()) {
            mediaPlayer.pause();
            isPaused = true;
            updatePlaybackState(false);
            updateNotification(false);
        }
    }

    private void resume() {
        if (mediaPlayer != null && isPaused) {
            mediaPlayer.start();
            isPaused = false;
            updatePlaybackState(true);
            updateNotification(true);
        }
    }

    private void stopPlayback() {
        releasePlayer();
        abandonAudioFocus();
        releaseWakeLock();
        if (mediaSession != null) {
            mediaSession.setActive(false);
        }
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private void releasePlayer() {
        if (mediaPlayer != null) {
            try {
                if (mediaPlayer.isPlaying()) mediaPlayer.stop();
                mediaPlayer.release();
            } catch (Exception ignored) {}
            mediaPlayer = null;
        }
    }

    private void acquireWakeLock() {
        if (wakeLock == null) {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "TuneFriend::MusicWakeLock");
                wakeLock.setReferenceCounted(false);
            }
        }
        if (wakeLock != null && !wakeLock.isHeld()) {
            wakeLock.acquire(3 * 60 * 60 * 1000L);
        }
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
    }

    private void updateMetadata() {
        if (mediaSession == null) return;
        MediaMetadataCompat.Builder builder = new MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, currentTitle)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, currentArtist);
        if (currentAlbumArt != null) {
            builder.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, currentAlbumArt);
        }
        mediaSession.setMetadata(builder.build());
    }

    private void updatePlaybackState(boolean playing) {
        if (mediaSession == null) return;
        long actions =
            PlaybackStateCompat.ACTION_PLAY |
            PlaybackStateCompat.ACTION_PAUSE |
            PlaybackStateCompat.ACTION_PLAY_PAUSE |
            PlaybackStateCompat.ACTION_SKIP_TO_NEXT |
            PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS |
            PlaybackStateCompat.ACTION_SEEK_TO;

        int state = playing
            ? PlaybackStateCompat.STATE_PLAYING
            : PlaybackStateCompat.STATE_PAUSED;

        PlaybackStateCompat playbackState = new PlaybackStateCompat.Builder()
            .setActions(actions)
            .setState(state, getPositionMs(), playing ? 1.0f : 0.0f)
            .build();
        mediaSession.setPlaybackState(playbackState);
    }

    private void updateNotification(boolean playing) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) {
            nm.notify(NOTIFICATION_ID, buildNotification(playing));
        }
    }

    private PendingIntent actionPendingIntent(String action, int requestCode) {
        Intent intent = new Intent(this, MusicPlaybackService.class);
        intent.setAction(action);
        return PendingIntent.getService(
            this,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private Notification buildNotification(boolean playing) {
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent openPi = PendingIntent.getActivity(
            this, 0, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Action prevAction = new NotificationCompat.Action(
            android.R.drawable.ic_media_previous,
            "Previous",
            actionPendingIntent(ACTION_PREVIOUS, 1)
        );

        NotificationCompat.Action playPauseAction = new NotificationCompat.Action(
            playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
            playing ? "Pause" : "Play",
            actionPendingIntent(playing ? ACTION_PAUSE : ACTION_RESUME, 2)
        );

        NotificationCompat.Action nextAction = new NotificationCompat.Action(
            android.R.drawable.ic_media_next,
            "Next",
            actionPendingIntent(ACTION_NEXT, 3)
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(currentTitle.isEmpty() ? "TuneFriend" : currentTitle)
            .setContentText(currentArtist.isEmpty() ? "Playing music" : currentArtist)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentIntent(openPi)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .addAction(prevAction)
            .addAction(playPauseAction)
            .addAction(nextAction)
            .setStyle(
                new MediaStyle()
                    .setMediaSession(mediaSession.getSessionToken())
                    .setShowActionsInCompactView(0, 1, 2)
            );

        if (currentAlbumArt != null) {
            builder.setLargeIcon(currentAlbumArt);
        }

        return builder.build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Music Playback",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("TuneFriend background music and lock screen controls");
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(channel);
        }
    }

    @Override
    public void onDestroy() {
        if (instance == this) instance = null;
        releasePlayer();
        abandonAudioFocus();
        releaseWakeLock();
        if (mediaSession != null) {
            mediaSession.release();
            mediaSession = null;
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}