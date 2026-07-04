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
import java.util.ArrayList;
import java.util.Random;
import org.json.JSONArray;
import org.json.JSONObject;

public class MusicPlaybackService extends Service {
    public static final String CHANNEL_ID = "tunefriend_music";
    public static final int NOTIFICATION_ID = 1001;

    public static final String ACTION_PLAY = "PLAY";
    public static final String ACTION_PAUSE = "PAUSE";
    public static final String ACTION_RESUME = "RESUME";
    public static final String ACTION_STOP = "STOP";
    public static final String ACTION_PREVIOUS = "PREVIOUS";
    public static final String ACTION_NEXT = "NEXT";
    public static final String ACTION_SET_NEXT = "SET_NEXT";

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
    private String currentTrackId = "";
    private Bitmap currentAlbumArt = null;
    private boolean isPaused = false;

    private String nextUrl = null;
    private String nextTitle = "";
    private String nextArtist = "";
    private String nextArtworkUrl = "";
    private String nextTrackId = "";
    private boolean isPrepared = false;
    private boolean releasingPlayer = false;
    private boolean shouldResumeAfterFocus = false;
    private boolean hasAudioFocus = false;

    private static class TrackInfo {
        String url;
        String title;
        String artist;
        String artworkUrl;
        String trackId;
    }

    private final ArrayList<TrackInfo> playQueue = new ArrayList<>();
    private int queueIndex = -1;
    private boolean queueShuffle = false;
    private boolean queueRepeat = false;
    private final Random random = new Random();

    public interface PlaybackCallback {
        void onPrepared();
        void onEnded();
        void onTrackAdvanced(String trackId);
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

    private static String pendingQueueJson = null;
    private static int pendingQueueIndex = 0;
    private static boolean pendingQueueShuffle = false;
    private static boolean pendingQueueRepeat = false;

    public static synchronized void setQueueState(String json, int index, boolean shuffle, boolean repeat) {
        pendingQueueJson = json;
        pendingQueueIndex = index;
        pendingQueueShuffle = shuffle;
        pendingQueueRepeat = repeat;
    }

    public static int getPositionMs() {
        if (instance == null || instance.mediaPlayer == null || !instance.isPrepared) return 0;
        try {
            return instance.mediaPlayer.getCurrentPosition();
        } catch (Exception e) {
            return 0;
        }
    }

    public static int getDurationMs() {
        if (instance == null || instance.mediaPlayer == null || !instance.isPrepared) return 0;
        try {
            int d = instance.mediaPlayer.getDuration();
            return d > 0 ? d : 0;
        } catch (Exception e) {
            return 0;
        }
    }

    public static boolean isCurrentlyPlaying() {
        if (instance == null || instance.mediaPlayer == null || !instance.isPrepared) return false;
        try {
            return instance.mediaPlayer.isPlaying();
        } catch (Exception e) {
            return false;
        }
    }

    public static String getCurrentTrackId() {
        return instance != null ? instance.currentTrackId : "";
    }

    public static void seekToMs(int ms) {
        if (instance == null || instance.mediaPlayer == null || !instance.isPrepared) return;
        try {
            int target = Math.max(0, ms);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                instance.mediaPlayer.seekTo((long) target, MediaPlayer.SEEK_CLOSEST_SYNC);
            } else {
                instance.mediaPlayer.seekTo(target);
            }
            instance.updatePlaybackState(!instance.isPaused);
        } catch (Exception ignored) {}
    }

    public static boolean isPrepared() {
        return instance != null && instance.isPrepared;
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
                if (!advanceToNextTrack()) {
                    dispatchSkipNext();
                }
            }

            @Override
            public void onSkipToPrevious() {
                if (getPositionMs() > 3000) {
                    seekToMs(0);
                } else {
                    dispatchSkipPrevious();
                }
            }

            @Override
            public void onSeekTo(long pos) {
                seekToMs((int) pos);
            }
        });
        mediaSession.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || intent.getAction() == null) return START_STICKY;

        switch (intent.getAction()) {
            case ACTION_PLAY:
                applyQueueFromIntent(intent);
                play(
                    intent.getStringExtra("url"),
                    intent.getStringExtra("title"),
                    intent.getStringExtra("artist"),
                    intent.getStringExtra("artworkUrl"),
                    intent.getStringExtra("trackId"),
                    intent.getStringExtra("nextUrl"),
                    intent.getStringExtra("nextTitle"),
                    intent.getStringExtra("nextArtist"),
                    intent.getStringExtra("nextArtworkUrl"),
                    intent.getStringExtra("nextTrackId")
                );
                break;
            case ACTION_SET_NEXT:
                applyQueueFromIntent(intent);
                setNextTrackInfo(
                    intent.getStringExtra("nextUrl"),
                    intent.getStringExtra("nextTitle"),
                    intent.getStringExtra("nextArtist"),
                    intent.getStringExtra("nextArtworkUrl"),
                    intent.getStringExtra("nextTrackId")
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
                if (getPositionMs() > 3000) {
                    seekToMs(0);
                } else {
                    dispatchSkipPrevious();
                }
                break;
            case ACTION_NEXT:
                if (!advanceToNextTrack()) {
                    dispatchSkipNext();
                }
                break;
        }
        return START_STICKY;
    }

    private void setNextTrackInfo(String url, String title, String artist, String artworkUrl, String trackId) {
        nextUrl = url;
        nextTitle = title != null ? title : "";
        nextArtist = artist != null ? artist : "";
        nextArtworkUrl = artworkUrl != null ? artworkUrl : "";
        nextTrackId = trackId != null ? trackId : "";
    }

    private void applyQueueFromIntent(Intent intent) {
        String queueJson = pendingQueueJson;
        if (queueJson == null || queueJson.isEmpty()) {
            if (intent == null) return;
            queueJson = intent.getStringExtra("queueJson");
        }
        if (queueJson == null || queueJson.isEmpty()) return;
        try {
            JSONArray arr = new JSONArray(queueJson);
            playQueue.clear();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject obj = arr.getJSONObject(i);
                TrackInfo track = new TrackInfo();
                track.url = obj.optString("url", "");
                track.title = obj.optString("title", "");
                track.artist = obj.optString("artist", "");
                track.artworkUrl = obj.optString("artworkUrl", "");
                track.trackId = obj.optString("trackId", "");
                if (!track.url.isEmpty()) playQueue.add(track);
            }
            if (pendingQueueJson != null) {
                queueIndex = Math.max(0, Math.min(pendingQueueIndex, playQueue.size() - 1));
                queueShuffle = pendingQueueShuffle;
                queueRepeat = pendingQueueRepeat;
            } else if (intent != null) {
                if (intent.hasExtra("queueIndex")) {
                    int idx = intent.getIntExtra("queueIndex", 0);
                    if (idx >= 0 && idx < playQueue.size()) queueIndex = idx;
                }
                if (intent.hasExtra("shuffle")) {
                    queueShuffle = intent.getBooleanExtra("shuffle", false);
                }
                if (intent.hasExtra("repeat")) {
                    queueRepeat = intent.getBooleanExtra("repeat", false);
                }
            }
            String trackId = intent != null ? intent.getStringExtra("trackId") : currentTrackId;
            syncQueueIndexToCurrentTrack(trackId);
            refreshLegacyNextFromQueue();
            pendingQueueJson = null;
        } catch (Exception ignored) {}
    }

    private void syncQueueIndexToCurrentTrack(String trackId) {
        if (trackId == null || trackId.isEmpty() || playQueue.isEmpty()) return;
        for (int i = 0; i < playQueue.size(); i++) {
            if (trackId.equals(playQueue.get(i).trackId)) {
                queueIndex = i;
                return;
            }
        }
    }

    private int computeNextQueueIndex() {
        if (playQueue.isEmpty()) return -1;
        if (queueShuffle) {
            if (playQueue.size() == 1) return queueRepeat ? 0 : -1;
            int idx;
            int guard = 0;
            do {
                idx = random.nextInt(playQueue.size());
                guard++;
            } while (idx == queueIndex && playQueue.size() > 1 && guard < 12);
            return idx;
        }
        if (queueIndex < playQueue.size() - 1) return queueIndex + 1;
        if (queueRepeat) return 0;
        return -1;
    }

    private void refreshLegacyNextFromQueue() {
        int nextIdx = computeNextQueueIndex();
        if (nextIdx < 0) {
            setNextTrackInfo(null, "", "", "", "");
            return;
        }
        TrackInfo next = playQueue.get(nextIdx);
        setNextTrackInfo(next.url, next.title, next.artist, next.artworkUrl, next.trackId);
    }

    private boolean advanceToNextTrack() {
        int nextIdx = computeNextQueueIndex();
        if (nextIdx >= 0 && !playQueue.isEmpty()) {
            TrackInfo track = playQueue.get(nextIdx);
            queueIndex = nextIdx;
            setNextTrackInfo(null, "", "", "", "");
            play(track.url, track.title, track.artist, track.artworkUrl, track.trackId,
                null, "", "", "", "");
            refreshLegacyNextFromQueue();
            if (callback != null) callback.onTrackAdvanced(track.trackId);
            return true;
        }

        if (nextUrl != null && !nextUrl.isEmpty()) {
            String url = nextUrl;
            String title = nextTitle;
            String artist = nextArtist;
            String artworkUrl = nextArtworkUrl;
            String trackId = nextTrackId;
            setNextTrackInfo(null, "", "", "", "");
            play(url, title, artist, artworkUrl, trackId, null, "", "", "", "");
            if (callback != null) callback.onTrackAdvanced(trackId);
            return true;
        }
        return false;
    }

    private void play(String url, String title, String artist, String artworkUrl, String trackId,
                      String nextUrl, String nextTitle, String nextArtist, String nextArtworkUrl, String nextTrackId) {
        if (url == null || url.isEmpty()) return;
        currentTitle = title != null ? title : "TuneFriend";
        currentArtist = artist != null ? artist : "";
        currentArtworkUrl = artworkUrl != null ? artworkUrl : "";
        currentTrackId = trackId != null ? trackId : "";
        currentAlbumArt = null;
        isPaused = false;
        isPrepared = false;
        syncQueueIndexToCurrentTrack(currentTrackId);
        if (nextUrl != null && !nextUrl.isEmpty()) {
            setNextTrackInfo(nextUrl, nextTitle, nextArtist, nextArtworkUrl, nextTrackId);
        } else {
            refreshLegacyNextFromQueue();
        }

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
                isPrepared = true;
                mp.start();
                isPaused = false;
                updatePlaybackState(true);
                updateNotification(true);
                if (callback != null) callback.onPrepared();
            });
            mediaPlayer.setOnCompletionListener(mp -> {
                isPrepared = false;
                if (!advanceToNextTrack() && callback != null) {
                    callback.onEnded();
                }
            });
            mediaPlayer.setOnErrorListener((mp, what, extra) -> {
                if (releasingPlayer) return true;
                isPrepared = false;
                releasePlayer();
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
        if (audioManager == null || hasAudioFocus) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (audioFocusRequest != null) {
                audioManager.abandonAudioFocusRequest(audioFocusRequest);
            }
            audioFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(
                    new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build()
                )
                .setAcceptsDelayedFocusGain(true)
                .setOnAudioFocusChangeListener(this::handleAudioFocusChange)
                .build();
            int result = audioManager.requestAudioFocus(audioFocusRequest);
            hasAudioFocus = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        } else {
            int result = audioManager.requestAudioFocus(
                this::handleAudioFocusChange,
                AudioManager.STREAM_MUSIC,
                AudioManager.AUDIOFOCUS_GAIN
            );
            hasAudioFocus = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        }
    }

    private void abandonAudioFocus() {
        if (audioManager == null || !hasAudioFocus) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && audioFocusRequest != null) {
            audioManager.abandonAudioFocusRequest(audioFocusRequest);
            audioFocusRequest = null;
        } else if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            audioManager.abandonAudioFocus(this::handleAudioFocusChange);
        }
        hasAudioFocus = false;
    }

    private void handleAudioFocusChange(int focusChange) {
        switch (focusChange) {
            case AudioManager.AUDIOFOCUS_LOSS:
                shouldResumeAfterFocus = !isPaused && mediaPlayer != null && mediaPlayer.isPlaying();
                pause();
                hasAudioFocus = false;
                break;
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK:
                shouldResumeAfterFocus = !isPaused && mediaPlayer != null && mediaPlayer.isPlaying();
                pause();
                break;
            case AudioManager.AUDIOFOCUS_GAIN:
                hasAudioFocus = true;
                if (shouldResumeAfterFocus && isPaused && isPrepared) {
                    resume();
                }
                shouldResumeAfterFocus = false;
                break;
            default:
                break;
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
        if (mediaPlayer == null) return;
        releasingPlayer = true;
        isPrepared = false;
        MediaPlayer old = mediaPlayer;
        mediaPlayer = null;
        try {
            old.setOnErrorListener(null);
            old.setOnCompletionListener(null);
            old.setOnPreparedListener(null);
            if (old.isPlaying()) old.stop();
            old.reset();
            old.release();
        } catch (Exception ignored) {}
        releasingPlayer = false;
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
            wakeLock.acquire();
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