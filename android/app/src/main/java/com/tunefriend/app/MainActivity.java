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

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int REQ_POST_NOTIFICATIONS = 4401;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BackgroundMusicPlugin.class);
        super.onCreate(savedInstanceState);

        // Never draw over the lock screen or turn the display on for media — pocket
        // presses were opening the full UI over the lock screen and skipping tracks.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(false);
            setTurnScreenOn(false);
        }
        getWindow().clearFlags(
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
        );

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                dispatchBackToWeb();
            }
        });

        ensurePlaybackPermissions();
    }

    @Override
    public void onStart() {
        super.onStart();
        configureWebView();
    }

    /**
     * Overnight play needs a visible media notification + battery exemption.
     * GrapheneOS / stock Android often default these off for new installs.
     */
    private void ensurePlaybackPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(
                    this,
                    new String[]{ Manifest.permission.POST_NOTIFICATIONS },
                    REQ_POST_NOTIFICATIONS
                );
            }
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            if (pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
                try {
                    Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                    intent.setData(Uri.parse("package:" + getPackageName()));
                    startActivity(intent);
                } catch (Exception ignored) {
                    // User can still set Unrestricted manually in App info → Battery
                }
            }
        }
    }

    private void configureWebView() {
        WebView webView = getBridge().getWebView();
        if (webView == null) return;

        WebSettings settings = webView.getSettings();
        settings.setMediaPlaybackRequiresUserGesture(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }
    }

    private void dispatchBackToWeb() {
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView == null) {
            moveTaskToBack(true);
            return;
        }
        webView.post(() -> webView.evaluateJavascript(
            "Boolean(window.__tuneFriendBack && window.__tuneFriendBack())",
            value -> runOnUiThread(() -> {
                if (value == null || !value.contains("true")) {
                    moveTaskToBack(true);
                }
            })
        ));
    }
}