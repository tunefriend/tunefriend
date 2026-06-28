package com.tunefriend.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;

public class MusicPlaybackService extends Service {
    public static final String CHANNEL_ID = "tunefriend_music";
    public static final int NOTIFICATION_ID = 1001;

    public static final String ACTION_PLAY = "PLAY";
    public static final String ACTION_PAUSE = "PAUSE";
    public static final String ACTION_RESUME = "RESUME";
    public static final String ACTION_STOP = "STOP";

    private static PlaybackCallback callback;
    private static MusicPlaybackService instance;

    private MediaPlayer mediaPlayer;
    private PowerManager.WakeLock wakeLock;
    private AudioManager audioManager;
    private AudioFocusRequest audioFocusRequest;
    private String currentTitle = "";
    private String currentArtist = "";
    private boolean isPaused = false;

    public interface PlaybackCallback {
        void onPrepared();
        void onEnded();
        void onError(String message);
    }

    public static void setCallback(PlaybackCallback cb) {
        callback = cb;
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
        } catch (Exception ignored) {}
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        audioManager = (AudioManager) getSystemService(AUDIO_SERVICE);
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || intent.getAction() == null) return START_STICKY;

        switch (intent.getAction()) {
            case ACTION_PLAY:
                play(
                    intent.getStringExtra("url"),
                    intent.getStringExtra("title"),
                    intent.getStringExtra("artist")
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
        }
        return START_STICKY;
    }

    private void play(String url, String title, String artist) {
        if (url == null || url.isEmpty()) return;
        currentTitle = title != null ? title : "TuneFriend";
        currentArtist = artist != null ? artist : "";
        isPaused = false;

        // Start foreground IMMEDIATELY so Android won't kill us when screen locks
        startForegroundNow(buildNotification(false));

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
            updateNotification(false);
        }
    }

    private void resume() {
        if (mediaPlayer != null && isPaused) {
            mediaPlayer.start();
            isPaused = false;
            updateNotification(true);
        }
    }

    private void stopPlayback() {
        releasePlayer();
        abandonAudioFocus();
        releaseWakeLock();
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

    private void updateNotification(boolean playing) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) {
            nm.notify(NOTIFICATION_ID, buildNotification(playing));
        }
    }

    private Notification buildNotification(boolean playing) {
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent openPi = PendingIntent.getActivity(
            this, 0, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(currentTitle.isEmpty() ? "TuneFriend" : currentTitle)
            .setContentText(currentArtist.isEmpty() ? "Playing music" : currentArtist)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentIntent(openPi)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Music Playback",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("TuneFriend background music");
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
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}