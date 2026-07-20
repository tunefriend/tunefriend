/*
 * TuneFriend
 * Copyright (C) 2026 James
 *
 * Encrypted key-value storage backed by Android Keystore
 * (EncryptedSharedPreferences). Used for server password and related secrets.
 */

package com.tunefriend.app;

import android.content.Context;
import android.content.SharedPreferences;
import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "SecureStorage")
public class SecureStoragePlugin extends Plugin {
    private static final String PREFS_FILE = "tunefriend_secure_prefs";
    private SharedPreferences securePrefs;

    private SharedPreferences prefs() throws Exception {
        if (securePrefs != null) return securePrefs;
        Context ctx = getContext().getApplicationContext();
        MasterKey masterKey = new MasterKey.Builder(ctx)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build();
        securePrefs = EncryptedSharedPreferences.create(
            ctx,
            PREFS_FILE,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        );
        return securePrefs;
    }

    @PluginMethod
    public void set(PluginCall call) {
        String key = call.getString("key");
        String value = call.getString("value", "");
        if (key == null || key.isEmpty()) {
            call.reject("Missing key");
            return;
        }
        try {
            prefs().edit().putString(key, value != null ? value : "").apply();
            call.resolve();
        } catch (Exception e) {
            call.reject("SecureStorage set failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void get(PluginCall call) {
        String key = call.getString("key");
        if (key == null || key.isEmpty()) {
            call.reject("Missing key");
            return;
        }
        try {
            JSObject ret = new JSObject();
            ret.put("value", prefs().getString(key, null));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("SecureStorage get failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String key = call.getString("key");
        if (key == null || key.isEmpty()) {
            call.reject("Missing key");
            return;
        }
        try {
            prefs().edit().remove(key).apply();
            call.resolve();
        } catch (Exception e) {
            call.reject("SecureStorage remove failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void clear(PluginCall call) {
        try {
            prefs().edit().clear().apply();
            call.resolve();
        } catch (Exception e) {
            call.reject("SecureStorage clear failed: " + e.getMessage());
        }
    }
}
