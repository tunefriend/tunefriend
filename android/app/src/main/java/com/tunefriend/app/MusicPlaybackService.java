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
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.support.v4.media.MediaBrowserCompat;
import android.support.v4.media.MediaDescriptionCompat;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.media.MediaBrowserServiceCompat;
import androidx.media.app.NotificationCompat.MediaStyle;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Background music + Android Auto / MediaBrowser support.
 * Auto connects via MediaBrowserService and browses Queue / Liked.
 */
public class MusicPlaybackService extends MediaBrowserServiceCompat {
    public static final String CHANNEL_ID = "tunefriend_music";
    public static final int NOTIFICATION_ID = 1001;

    // Android Auto / MediaBrowser browse tree
    public static final String MEDIA_ROOT = "root";
    public static final String MEDIA_QUEUE = "queue";
    public static final String MEDIA_LIKED = "liked";
    public static final String MEDIA_ID_QUEUE_PREFIX = "queue:";
    public static final String MEDIA_ID_LIKED_PREFIX = "liked:";

    public static final String ACTION_PLAY = "PLAY";
    public static final String ACTION_PAUSE = "PAUSE";
    public static final String ACTION_RESUME = "RESUME";
    public static final String ACTION_STOP = "STOP";
    public static final String ACTION_PREVIOUS = "PREVIOUS";
    public static final String ACTION_NEXT = "NEXT";
    public static final String ACTION_SET_NEXT = "SET_NEXT";
    /** Re-check focus + restart stalled stream (screen on / app resume / widget). */
    public static final String ACTION_ENSURE_PLAYING = "ENSURE_PLAYING";
    public static final String ACTION_TOGGLE = "TOGGLE";
    public static final String ACTION_SHUFFLE_LIKED = "SHUFFLE_LIKED";
    public static final String ACTION_THUMBS_UP = "THUMBS_UP";
    public static final String ACTION_THUMBS_DOWN = "THUMBS_DOWN";

    private static PlaybackCallback callback;
    private static MediaControlCallback mediaControlCallback;
    private static MusicPlaybackService instance;

    private MediaPlayer mediaPlayer;
    private MediaSessionCompat mediaSession;
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private AudioManager audioManager;
    private AudioFocusRequest audioFocusRequest;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private BroadcastReceiver screenOnReceiver;

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
    private boolean userPaused = false;
    private boolean wantsToPlay = false;
    private String currentUrl = "";
    private int pendingSeekMs = 0;
    private long lastResumeAt = 0;
    private int errorSkipCount = 0;
    private int reloadAttemptCount = 0;
    private int lastProgressPosMs = -1;
    private long lastProgressAt = 0;

    // Faster recovery: Doze + network streams stall without frequent checks.
    private static final long RESUME_WATCHDOG_MS = 8000;
    private static final long PLAYBACK_HEALTH_MS = 12000;
    private static final long STALL_POSITION_MS = 8000;
    private static final long FOCUS_RESUME_DELAY_MS = 400;
    private final Runnable resumeWatchdog = this::runResumeWatchdog;
    private final Runnable playbackHealthCheck = this::runPlaybackHealthCheck;
    private final Runnable deferredFocusResume = this::tryResumeAfterFocus;

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
    private final ArrayList<String> recentArtists = new ArrayList<>();
    private final ArrayList<String> recentTrackIds = new ArrayList<>();
    private static final int RECENT_ARTIST_COOLDOWN = 10;
    private static final int RECENT_TRACK_MEMORY = 60;

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

    public static boolean wantsToPlay() {
        return instance != null && instance.wantsToPlay;
    }

    /** True while the media service process object exists (may be paused). */
    public static boolean isAlive() {
        return instance != null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        audioManager = (AudioManager) getSystemService(AUDIO_SERVICE);
        createNotificationChannel();
        initMediaSession();
        registerScreenOnReceiver();
    }

    private void registerScreenOnReceiver() {
        if (screenOnReceiver != null) return;
        screenOnReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (intent == null) return;
                String action = intent.getAction();
                if (Intent.ACTION_SCREEN_ON.equals(action)
                        || Intent.ACTION_USER_PRESENT.equals(action)) {
                    mainHandler.post(() -> ensurePlaying("screen_on"));
                }
            }
        };
        IntentFilter filter = new IntentFilter();
        filter.addAction(Intent.ACTION_SCREEN_ON);
        filter.addAction(Intent.ACTION_USER_PRESENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(screenOnReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(screenOnReceiver, filter);
        }
    }

    private void unregisterScreenOnReceiver() {
        if (screenOnReceiver == null) return;
        try {
            unregisterReceiver(screenOnReceiver);
        } catch (Exception ignored) {}
        screenOnReceiver = null;
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
                userPaused = false;
                wantsToPlay = true;
                resume();
            }

            @Override
            public void onPause() {
                pauseFromUser();
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

            @Override
            public void onPlayFromMediaId(String mediaId, Bundle extras) {
                playFromMediaId(mediaId);
            }
        });
        mediaSession.setActive(true);
        setSessionToken(mediaSession.getSessionToken());
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
                pauseFromUser();
                break;
            case ACTION_RESUME:
                userPaused = false;
                wantsToPlay = true;
                resume();
                break;
            case ACTION_TOGGLE:
                if (wantsToPlay && isPlayingNow()) {
                    pauseFromUser();
                } else {
                    userPaused = false;
                    wantsToPlay = true;
                    ensurePlaying("toggle");
                }
                break;
            case ACTION_ENSURE_PLAYING:
                ensurePlaying("intent");
                break;
            case ACTION_SHUFFLE_LIKED:
                shuffleLikedTracks();
                break;
            case ACTION_THUMBS_UP:
                rateCurrentTrack("up");
                break;
            case ACTION_THUMBS_DOWN:
                rateCurrentTrack("down");
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

    /** Widget / lock-screen thumbs for the current track. */
    private void rateCurrentTrack(String action) {
        if (currentTrackId == null || currentTrackId.isEmpty()) {
            PlaybackWidgetUpdater.updateAll(this);
            return;
        }
        String prev = WidgetRatingStore.ratingFor(this, currentTrackId);
        WidgetRatingStore.queueRating(
            this,
            currentTrackId,
            currentTitle,
            currentArtist,
            currentArtworkUrl,
            currentUrl,
            action
        );
        // Keep Auto / Shuffle Liked in sync when thumbing up without opening the app
        if ("up".equals(action)) {
            if ("up".equals(prev)) {
                AutoLibraryStore.removeLikedTrack(this, currentTrackId);
            } else {
                AutoLibraryStore.LikedTrack t = new AutoLibraryStore.LikedTrack();
                t.trackId = currentTrackId;
                t.title = currentTitle;
                t.artist = currentArtist;
                t.artworkUrl = currentArtworkUrl;
                t.url = currentUrl;
                AutoLibraryStore.upsertLikedTrack(this, t);
            }
        } else if ("down".equals(action)) {
            AutoLibraryStore.removeLikedTrack(this, currentTrackId);
            // Skip so the blocked song doesn't keep playing
            if (!"down".equals(prev)) {
                if (!advanceToNextTrack()) {
                    dispatchSkipNext();
                }
            }
        }
        PlaybackWidgetUpdater.updateAll(this);
    }

    /**
     * Heal silent stalls after Doze / screen-off / app background.
     * Opening the app used to be the only reliable kick — this runs the same path
     * from screen-on, MainActivity onResume, health checks, and widgets.
     */
    private void ensurePlaying(String reason) {
        if (userPaused || !wantsToPlay) {
            PlaybackWidgetUpdater.updateAll(this);
            return;
        }
        // Focus can be quietly lost overnight; re-request before starting audio.
        if (!hasAudioFocus) {
            requestAudioFocus();
        }
        acquireWakeLock();
        acquireWifiLock();
        if (mediaSession != null && !mediaSession.isActive()) {
            mediaSession.setActive(true);
        }
        if (isPrepared && mediaPlayer != null) {
            if (isPlaybackStalled()) {
                reloadAttemptCount = 0;
                reloadCurrentTrackAt(getPositionMs());
            } else {
                recoverPlayback();
            }
            schedulePlaybackHealthCheck();
        } else if (currentUrl != null && !currentUrl.isEmpty()) {
            reloadAttemptCount = 0;
            reloadCurrentTrackAt(Math.max(0, getPositionMs()));
        }
        PlaybackWidgetUpdater.updateAll(this);
    }

    private void shuffleLikedTracks() {
        List<AutoLibraryStore.LikedTrack> liked = AutoLibraryStore.loadLiked(this);
        if (liked == null || liked.isEmpty()) {
            // If we were started as FGS from a widget, post a short notification then stop.
            currentTitle = "No liked songs";
            currentArtist = "👍 tracks in TuneFriend first";
            wantsToPlay = false;
            startForegroundNow(buildNotification(false));
            PlaybackWidgetUpdater.updateAll(this);
            mainHandler.postDelayed(() -> {
                try {
                    stopForeground(STOP_FOREGROUND_REMOVE);
                    stopSelf();
                } catch (Exception ignored) {}
            }, 2500);
            return;
        }
        ArrayList<TrackInfo> tracks = new ArrayList<>();
        for (AutoLibraryStore.LikedTrack t : liked) {
            if (t == null || t.url == null || t.url.isEmpty()) continue;
            TrackInfo info = new TrackInfo();
            info.url = t.url;
            info.title = t.title != null ? t.title : "";
            info.artist = t.artist != null ? t.artist : "";
            info.artworkUrl = t.artworkUrl != null ? t.artworkUrl : "";
            info.trackId = t.trackId != null ? t.trackId : "";
            tracks.add(info);
        }
        if (tracks.isEmpty()) {
            currentTitle = "No stream URLs";
            currentArtist = "Open app and re-sync Liked";
            wantsToPlay = false;
            startForegroundNow(buildNotification(false));
            PlaybackWidgetUpdater.updateAll(this);
            mainHandler.postDelayed(() -> {
                try {
                    stopForeground(STOP_FOREGROUND_REMOVE);
                    stopSelf();
                } catch (Exception ignored) {}
            }, 2500);
            return;
        }
        // Fisher–Yates shuffle
        for (int i = tracks.size() - 1; i > 0; i--) {
            int j = random.nextInt(i + 1);
            TrackInfo tmp = tracks.get(i);
            tracks.set(i, tracks.get(j));
            tracks.set(j, tmp);
        }
        playQueue.clear();
        playQueue.addAll(tracks);
        queueIndex = 0;
        queueShuffle = true;
        queueRepeat = true;
        recentArtists.clear();
        recentTrackIds.clear();
        TrackInfo first = tracks.get(0);
        play(first.url, first.title, first.artist, first.artworkUrl, first.trackId,
            null, "", "", "", "");
        refreshLegacyNextFromQueue();
        notifyBrowseTreeChanged();
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
            notifyBrowseTreeChanged();
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

    private String artistKey(TrackInfo t) {
        if (t == null || t.artist == null) return "unknown";
        return t.artist.trim().toLowerCase();
    }

    private void rememberPlayed(TrackInfo t) {
        if (t == null) return;
        if (t.trackId != null && !t.trackId.isEmpty()) {
            recentTrackIds.add(t.trackId);
            while (recentTrackIds.size() > RECENT_TRACK_MEMORY) recentTrackIds.remove(0);
        }
        String a = artistKey(t);
        recentArtists.add(a);
        while (recentArtists.size() > RECENT_ARTIST_COOLDOWN) recentArtists.remove(0);
    }

    private int computeNextQueueIndex() {
        if (playQueue.isEmpty()) return -1;
        if (queueShuffle) {
            if (playQueue.size() == 1) return queueRepeat ? 0 : -1;
            String currentArtist = queueIndex >= 0 && queueIndex < playQueue.size()
                ? artistKey(playQueue.get(queueIndex)) : "";

            ArrayList<Integer> preferred = new ArrayList<>();
            ArrayList<Integer> ok = new ArrayList<>();
            ArrayList<Integer> fallback = new ArrayList<>();

            for (int i = 0; i < playQueue.size(); i++) {
                if (i == queueIndex) continue;
                TrackInfo t = playQueue.get(i);
                if (t.trackId != null && !t.trackId.isEmpty() && recentTrackIds.contains(t.trackId)) {
                    continue;
                }
                String a = artistKey(t);
                if (!a.equals(currentArtist) && !recentArtists.contains(a)) {
                    preferred.add(i);
                } else if (!a.equals(currentArtist)) {
                    ok.add(i);
                } else {
                    fallback.add(i);
                }
            }

            ArrayList<Integer> pool = !preferred.isEmpty() ? preferred
                : !ok.isEmpty() ? ok
                : !fallback.isEmpty() ? fallback
                : null;
            if (pool == null || pool.isEmpty()) {
                int idx;
                int guard = 0;
                do {
                    idx = random.nextInt(playQueue.size());
                    guard++;
                } while (idx == queueIndex && playQueue.size() > 1 && guard < 12);
                return idx;
            }
            return pool.get(random.nextInt(pool.size()));
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
            rememberPlayed(track);
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
        currentUrl = url;
        currentTitle = title != null ? title : "TuneFriend";
        currentArtist = artist != null ? artist : "";
        currentArtworkUrl = artworkUrl != null ? artworkUrl : "";
        currentTrackId = trackId != null ? trackId : "";
        currentAlbumArt = null;
        isPaused = false;
        isPrepared = false;
        userPaused = false;
        wantsToPlay = true;
        reloadAttemptCount = 0;
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
        acquireWifiLock();
        requestAudioFocus();
        lastProgressPosMs = -1;
        lastProgressAt = SystemClock.elapsedRealtime();

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
                errorSkipCount = 0;
                reloadAttemptCount = 0;
                userPaused = false;
                lastProgressPosMs = -1;
                lastProgressAt = SystemClock.elapsedRealtime();
                if (pendingSeekMs > 0) {
                    try {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                            mp.seekTo((long) pendingSeekMs, MediaPlayer.SEEK_CLOSEST_SYNC);
                        } else {
                            mp.seekTo(pendingSeekMs);
                        }
                    } catch (Exception ignored) {}
                    pendingSeekMs = 0;
                }
                if (wantsToPlay) {
                    if (!hasAudioFocus) requestAudioFocus();
                    mp.start();
                    isPaused = false;
                }
                cancelResumeWatchdog();
                schedulePlaybackHealthCheck();
                updatePlaybackState(wantsToPlay && mp.isPlaying());
                updateNotification(wantsToPlay && mp.isPlaying());
                PlaybackWidgetUpdater.updateAll(MusicPlaybackService.this);
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
                int savedPos = getPositionMs();
                releasePlayer();
                if (wantsToPlay && reloadAttemptCount < 2 && currentUrl != null && !currentUrl.isEmpty()) {
                    reloadAttemptCount++;
                    reloadCurrentTrackAt(savedPos);
                    return true;
                }
                if (errorSkipCount < 3 && advanceToNextTrack()) {
                    errorSkipCount++;
                    return true;
                }
                errorSkipCount = 0;
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
        long now = SystemClock.elapsedRealtime();
        switch (focusChange) {
            case AudioManager.AUDIOFOCUS_LOSS:
                // Call, another music app, etc. — stay paused until system grants focus again.
                if (!userPaused) {
                    shouldResumeAfterFocus = wantsToPlay && isPrepared;
                    pauseForInterruption();
                }
                hasAudioFocus = false;
                cancelResumeWatchdog();
                cancelPlaybackHealthCheck();
                break;
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK:
                // Reels / short video / notification — do NOT re-steal focus on a timer.
                if (now - lastResumeAt < 1200) return;
                hasAudioFocus = false;
                if (!userPaused) {
                    shouldResumeAfterFocus = wantsToPlay && isPrepared;
                    pauseForInterruption();
                }
                cancelResumeWatchdog();
                cancelPlaybackHealthCheck();
                break;
            case AudioManager.AUDIOFOCUS_GAIN:
                hasAudioFocus = true;
                mainHandler.removeCallbacks(deferredFocusResume);
                mainHandler.postDelayed(deferredFocusResume, FOCUS_RESUME_DELAY_MS);
                break;
            default:
                break;
        }
    }

    private boolean isPlayingNow() {
        return mediaPlayer != null && mediaPlayer.isPlaying();
    }

    private void tryResumeAfterFocus() {
        if (userPaused) {
            shouldResumeAfterFocus = false;
            return;
        }
        // Only resume when the system gave focus back (calls / Reels ended).
        if (!hasAudioFocus) {
            shouldResumeAfterFocus = shouldResumeAfterFocus || wantsToPlay;
            return;
        }
        if (shouldResumeAfterFocus || (wantsToPlay && !isPlayingNow()) || isPlaybackStalled()) {
            lastResumeAt = SystemClock.elapsedRealtime();
            ensurePlaying("focus_gain");
            if (isPlayingNow()) schedulePlaybackHealthCheck();
        }
        shouldResumeAfterFocus = false;
    }

    private void scheduleResumeWatchdog() {
        if (userPaused || !wantsToPlay || !isPrepared) return;
        mainHandler.removeCallbacks(resumeWatchdog);
        mainHandler.postDelayed(resumeWatchdog, RESUME_WATCHDOG_MS);
    }

    private void cancelResumeWatchdog() {
        mainHandler.removeCallbacks(resumeWatchdog);
    }

    private void schedulePlaybackHealthCheck() {
        if (userPaused || !wantsToPlay) return;
        mainHandler.removeCallbacks(playbackHealthCheck);
        mainHandler.postDelayed(playbackHealthCheck, PLAYBACK_HEALTH_MS);
    }

    private void cancelPlaybackHealthCheck() {
        mainHandler.removeCallbacks(playbackHealthCheck);
    }

    /** True when MediaPlayer reports playing (or prepared) but position is frozen — common after Doze. */
    private boolean isPlaybackStalled() {
        if (userPaused || !wantsToPlay || !isPrepared || mediaPlayer == null) return false;
        int pos;
        try {
            pos = mediaPlayer.getCurrentPosition();
        } catch (Exception e) {
            return true;
        }
        long now = SystemClock.elapsedRealtime();
        if (lastProgressPosMs < 0) {
            lastProgressPosMs = pos;
            lastProgressAt = now;
            return false;
        }
        if (pos > lastProgressPosMs + 400) {
            lastProgressPosMs = pos;
            lastProgressAt = now;
            return false;
        }
        // Near end of track — not a stall
        try {
            int dur = mediaPlayer.getDuration();
            if (dur > 0 && pos >= dur - 1500) return false;
        } catch (Exception ignored) {}
        return (now - lastProgressAt) >= STALL_POSITION_MS;
    }

    private void noteProgressIfAdvancing() {
        if (!isPrepared || mediaPlayer == null) return;
        try {
            int pos = mediaPlayer.getCurrentPosition();
            if (lastProgressPosMs < 0 || pos > lastProgressPosMs + 400) {
                lastProgressPosMs = pos;
                lastProgressAt = SystemClock.elapsedRealtime();
            }
        } catch (Exception ignored) {}
    }

    private void runResumeWatchdog() {
        if (userPaused || !wantsToPlay || !isPrepared) {
            cancelResumeWatchdog();
            return;
        }
        if (!hasAudioFocus) {
            requestAudioFocus();
        }
        // If another app still owns focus after re-request, don't fight a call.
        if (!hasAudioFocus) {
            scheduleResumeWatchdog();
            return;
        }
        if (!isPlayingNow() || isPlaybackStalled()) {
            lastResumeAt = SystemClock.elapsedRealtime();
            if (isPlaybackStalled()) {
                reloadAttemptCount = 0;
                reloadCurrentTrackAt(getPositionMs());
            } else {
                recoverPlayback();
            }
        }
        if (isPlayingNow() && !isPlaybackStalled()) {
            cancelResumeWatchdog();
            return;
        }
        scheduleResumeWatchdog();
    }

    private void runPlaybackHealthCheck() {
        if (userPaused || !wantsToPlay) {
            cancelPlaybackHealthCheck();
            return;
        }
        if (!hasAudioFocus) {
            requestAudioFocus();
        }
        // Keep the FGS alive and re-acquire locks while we still want audio.
        acquireWakeLock();
        acquireWifiLock();
        noteProgressIfAdvancing();

        if (!isPrepared && currentUrl != null && !currentUrl.isEmpty()) {
            reloadAttemptCount = 0;
            reloadCurrentTrackAt(0);
            schedulePlaybackHealthCheck();
            return;
        }

        if (isPlaybackStalled()) {
            reloadAttemptCount = 0;
            reloadCurrentTrackAt(getPositionMs());
        } else if (hasAudioFocus && !isPlayingNow()) {
            recoverPlayback();
        } else if (!hasAudioFocus) {
            // Wait for focus; still reschedule so we recover after a call ends overnight.
            scheduleResumeWatchdog();
        } else {
            noteProgressIfAdvancing();
        }
        schedulePlaybackHealthCheck();
    }

    private void recoverPlayback() {
        if (userPaused || !wantsToPlay) return;
        if (!hasAudioFocus) {
            requestAudioFocus();
            if (!hasAudioFocus) return;
        }
        acquireWakeLock();
        acquireWifiLock();
        if (mediaPlayer != null && isPrepared) {
            try {
                if (isPaused || !isPlayingNow()) {
                    mediaPlayer.start();
                    isPaused = false;
                    lastResumeAt = SystemClock.elapsedRealtime();
                    lastProgressPosMs = -1;
                    lastProgressAt = SystemClock.elapsedRealtime();
                }
            } catch (Exception ignored) {}
            if (isPlayingNow()) {
                cancelResumeWatchdog();
                updatePlaybackState(true);
                updateNotification(true);
                PlaybackWidgetUpdater.updateAll(this);
                return;
            }
        }
        if (reloadAttemptCount < 2 && currentUrl != null && !currentUrl.isEmpty()) {
            reloadAttemptCount++;
            reloadCurrentTrackAt(getPositionMs());
            return;
        }
        // Stream likely dead (expired URL / network) — skip forward so a long session keeps going.
        reloadAttemptCount = 0;
        if (advanceToNextTrack()) {
            errorSkipCount++;
        }
    }

    private void reloadCurrentTrackAt(int positionMs) {
        if (currentUrl == null || currentUrl.isEmpty()) return;
        pendingSeekMs = Math.max(0, positionMs);
        play(
            currentUrl,
            currentTitle,
            currentArtist,
            currentArtworkUrl,
            currentTrackId,
            nextUrl,
            nextTitle,
            nextArtist,
            nextArtworkUrl,
            nextTrackId
        );
    }

    private void pauseForInterruption() {
        if (mediaPlayer != null && mediaPlayer.isPlaying()) {
            mediaPlayer.pause();
            isPaused = true;
            updatePlaybackState(false);
            updateNotification(false);
            PlaybackWidgetUpdater.updateAll(this);
        } else if (mediaPlayer != null && isPrepared) {
            isPaused = true;
            updatePlaybackState(false);
            updateNotification(false);
            PlaybackWidgetUpdater.updateAll(this);
        }
    }

    private void pauseFromUser() {
        userPaused = true;
        wantsToPlay = false;
        shouldResumeAfterFocus = false;
        cancelResumeWatchdog();
        cancelPlaybackHealthCheck();
        pauseForInterruption();
        PlaybackWidgetUpdater.updateAll(this);
    }

    private void resume() {
        if (userPaused) return;
        userPaused = false;
        wantsToPlay = true;
        ensurePlaying("resume");
    }

    private void stopPlayback() {
        userPaused = true;
        wantsToPlay = false;
        shouldResumeAfterFocus = false;
        cancelResumeWatchdog();
        cancelPlaybackHealthCheck();
        mainHandler.removeCallbacks(deferredFocusResume);
        releasePlayer();
        abandonAudioFocus();
        releaseWakeLock();
        releaseWifiLock();
        if (mediaSession != null) {
            mediaSession.setActive(false);
        }
        PlaybackWidgetUpdater.updateAll(this);
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
            // 4h max — health check re-acquires while wantsToPlay
            wakeLock.acquire(4 * 60 * 60 * 1000L);
        }
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
    }

    /** Keep Wi‑Fi radio up so Subsonic streams don't die when the screen is off. */
    private void acquireWifiLock() {
        if (wifiLock == null) {
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wm != null) {
                int mode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                    ? WifiManager.WIFI_MODE_FULL_LOW_LATENCY
                    : WifiManager.WIFI_MODE_FULL_HIGH_PERF;
                wifiLock = wm.createWifiLock(mode, "TuneFriend::MusicWifiLock");
                wifiLock.setReferenceCounted(false);
            }
        }
        if (wifiLock != null && !wifiLock.isHeld()) {
            try {
                wifiLock.acquire();
            } catch (Exception ignored) {}
        }
    }

    private void releaseWifiLock() {
        if (wifiLock != null && wifiLock.isHeld()) {
            try {
                wifiLock.release();
            } catch (Exception ignored) {}
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
            PlaybackStateCompat.ACTION_SEEK_TO |
            PlaybackStateCompat.ACTION_PLAY_FROM_MEDIA_ID;

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
        PlaybackWidgetStore.save(
            this,
            currentTitle,
            currentArtist,
            currentArtworkUrl,
            currentTrackId,
            playing,
            wantsToPlay && !userPaused
        );
        PlaybackWidgetUpdater.updateAll(this);
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
        // Bring existing task forward without showing over the lock screen.
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP
            | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
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
        unregisterScreenOnReceiver();
        cancelResumeWatchdog();
        cancelPlaybackHealthCheck();
        mainHandler.removeCallbacks(deferredFocusResume);
        releasePlayer();
        abandonAudioFocus();
        releaseWakeLock();
        releaseWifiLock();
        if (mediaSession != null) {
            mediaSession.release();
            mediaSession = null;
        }
        super.onDestroy();
    }

    /** Public helpers for home screen widgets. */
    public static String widgetTitle() {
        return instance != null ? instance.currentTitle : "";
    }

    public static String widgetArtist() {
        return instance != null ? instance.currentArtist : "";
    }

    public static boolean widgetPlaying() {
        return instance != null && instance.isPlayingNow();
    }

    public static boolean widgetWantsPlay() {
        return instance != null && instance.wantsToPlay && !instance.userPaused;
    }

    @Override
    public IBinder onBind(Intent intent) {
        // MediaBrowserServiceCompat handles browser binds; fall through for others.
        IBinder binder = super.onBind(intent);
        return binder;
    }

    // ── Android Auto / MediaBrowser ──────────────────────────────────────────

    @Override
    public BrowserRoot onGetRoot(@NonNull String clientPackageName, int clientUid,
                                 @Nullable Bundle rootHints) {
        // Allow Android Auto, AAOS, and system UI to browse.
        return new BrowserRoot(MEDIA_ROOT, null);
    }

    @Override
    public void onLoadChildren(@NonNull String parentId,
                               @NonNull Result<List<MediaBrowserCompat.MediaItem>> result) {
        List<MediaBrowserCompat.MediaItem> items = new ArrayList<>();
        if (MEDIA_ROOT.equals(parentId)) {
            items.add(browsableItem(MEDIA_QUEUE, "Play queue",
                playQueue.isEmpty() ? "Start music in TuneFriend first" : playQueue.size() + " tracks"));
            int likedCount = AutoLibraryStore.likedCount(this);
            items.add(browsableItem(MEDIA_LIKED, "Liked",
                likedCount == 0 ? "Thumbs-up songs from the phone app" : likedCount + " tracks"));
        } else if (MEDIA_QUEUE.equals(parentId)) {
            if (playQueue.isEmpty()) {
                items.add(browsableItem("empty_queue", "Queue empty",
                    "Open TuneFriend on your phone and play or shuffle music"));
            } else {
                for (int i = 0; i < playQueue.size(); i++) {
                    TrackInfo t = playQueue.get(i);
                    String title = t.title != null && !t.title.isEmpty() ? t.title : "Track " + (i + 1);
                    String subtitle = t.artist != null ? t.artist : "";
                    if (i == queueIndex) subtitle = "▶ " + subtitle;
                    items.add(playableItem(MEDIA_ID_QUEUE_PREFIX + i, title, subtitle, t.artworkUrl));
                }
            }
        } else if (MEDIA_LIKED.equals(parentId)) {
            List<AutoLibraryStore.LikedTrack> liked = AutoLibraryStore.loadLiked(this);
            if (liked.isEmpty()) {
                items.add(browsableItem("empty_liked", "No liked songs",
                    "Tap 👍 in TuneFriend to add songs here"));
            } else {
                for (int i = 0; i < liked.size(); i++) {
                    AutoLibraryStore.LikedTrack t = liked.get(i);
                    items.add(playableItem(MEDIA_ID_LIKED_PREFIX + i, t.title, t.artist, t.artworkUrl));
                }
            }
        }
        result.sendResult(items);
    }

    private MediaBrowserCompat.MediaItem browsableItem(String id, String title, String subtitle) {
        MediaDescriptionCompat desc = new MediaDescriptionCompat.Builder()
            .setMediaId(id)
            .setTitle(title)
            .setSubtitle(subtitle)
            .build();
        return new MediaBrowserCompat.MediaItem(desc, MediaBrowserCompat.MediaItem.FLAG_BROWSABLE);
    }

    private MediaBrowserCompat.MediaItem playableItem(String id, String title, String subtitle, String artUrl) {
        MediaDescriptionCompat.Builder b = new MediaDescriptionCompat.Builder()
            .setMediaId(id)
            .setTitle(title)
            .setSubtitle(subtitle);
        if (artUrl != null && !artUrl.isEmpty()) {
            try {
                b.setIconUri(android.net.Uri.parse(artUrl));
            } catch (Exception ignored) {}
        }
        return new MediaBrowserCompat.MediaItem(b.build(), MediaBrowserCompat.MediaItem.FLAG_PLAYABLE);
    }

    private void playFromMediaId(String mediaId) {
        if (mediaId == null) return;
        if (mediaId.startsWith(MEDIA_ID_QUEUE_PREFIX)) {
            try {
                int idx = Integer.parseInt(mediaId.substring(MEDIA_ID_QUEUE_PREFIX.length()));
                if (idx >= 0 && idx < playQueue.size()) {
                    TrackInfo t = playQueue.get(idx);
                    queueIndex = idx;
                    rememberPlayed(t);
                    play(t.url, t.title, t.artist, t.artworkUrl, t.trackId, null, "", "", "", "");
                    refreshLegacyNextFromQueue();
                    if (callback != null) callback.onTrackAdvanced(t.trackId);
                    return;
                }
            } catch (Exception ignored) {}
        }
        if (mediaId.startsWith(MEDIA_ID_LIKED_PREFIX)) {
            try {
                int idx = Integer.parseInt(mediaId.substring(MEDIA_ID_LIKED_PREFIX.length()));
                List<AutoLibraryStore.LikedTrack> liked = AutoLibraryStore.loadLiked(this);
                if (idx >= 0 && idx < liked.size()) {
                    // Build a queue from all liked tracks with stream URLs and play from idx
                    playQueue.clear();
                    for (AutoLibraryStore.LikedTrack lt : liked) {
                        if (lt.url == null || lt.url.isEmpty()) continue;
                        TrackInfo t = new TrackInfo();
                        t.url = lt.url;
                        t.title = lt.title;
                        t.artist = lt.artist;
                        t.artworkUrl = lt.artworkUrl;
                        t.trackId = lt.trackId;
                        playQueue.add(t);
                    }
                    // Remap index if some lacked URLs
                    int playIdx = 0;
                    String wantId = liked.get(idx).trackId;
                    for (int i = 0; i < playQueue.size(); i++) {
                        if (wantId != null && wantId.equals(playQueue.get(i).trackId)) {
                            playIdx = i;
                            break;
                        }
                    }
                    if (!playQueue.isEmpty()) {
                        queueIndex = playIdx;
                        queueShuffle = false;
                        TrackInfo t = playQueue.get(playIdx);
                        rememberPlayed(t);
                        play(t.url, t.title, t.artist, t.artworkUrl, t.trackId, null, "", "", "", "");
                        refreshLegacyNextFromQueue();
                        notifyBrowseTreeChanged();
                        if (callback != null) callback.onTrackAdvanced(t.trackId);
                    }
                }
            } catch (Exception ignored) {}
        }
    }

    private void notifyBrowseTreeChanged() {
        try {
            notifyChildrenChanged(MEDIA_ROOT);
            notifyChildrenChanged(MEDIA_QUEUE);
            notifyChildrenChanged(MEDIA_LIKED);
        } catch (Exception ignored) {}
    }

    /** Called when the phone app updates Liked tracks for Auto. */
    public static void notifyLikedChanged() {
        if (instance != null) {
            instance.notifyBrowseTreeChanged();
        }
    }
}