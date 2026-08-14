/*
 * TuneFriend
 * Copyright (C) 2026 James
 *
 * Download Subsonic streams to app-private storage for offline playback.
 */

package com.tunefriend.app;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "OfflineStore")
public class OfflineStorePlugin extends Plugin {
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    private File offlineDir() {
        File dir = new File(getContext().getFilesDir(), "offline");
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    private static String safeId(String id) {
        if (id == null) return "";
        return id.replaceAll("[^a-zA-Z0-9._-]", "_");
    }

    private File fileFor(String songId) {
        return new File(offlineDir(), safeId(songId) + ".audio");
    }

    @PluginMethod
    public void download(PluginCall call) {
        String songId = call.getString("songId");
        String url = call.getString("url");
        if (songId == null || songId.isEmpty() || url == null || url.isEmpty()) {
            call.reject("Missing songId or url");
            return;
        }
        io.execute(() -> {
            HttpURLConnection conn = null;
            try {
                File dest = fileFor(songId);
                File tmp = new File(dest.getAbsolutePath() + ".part");
                if (tmp.exists()) tmp.delete();

                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(30000);
                conn.setReadTimeout(120000);
                conn.setInstanceFollowRedirects(true);
                conn.connect();
                int code = conn.getResponseCode();
                if (code < 200 || code >= 300) {
                    call.reject("Download failed (" + code + ")");
                    return;
                }
                String contentType = conn.getContentType();
                if (contentType != null && contentType.contains("json")) {
                    call.reject("Server returned error instead of audio");
                    return;
                }

                long written = 0;
                try (InputStream in = conn.getInputStream();
                     FileOutputStream out = new FileOutputStream(tmp)) {
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) >= 0) {
                        out.write(buf, 0, n);
                        written += n;
                    }
                }
                if (written < 1000) {
                    tmp.delete();
                    call.reject("Empty or invalid audio");
                    return;
                }
                if (dest.exists()) dest.delete();
                if (!tmp.renameTo(dest)) {
                    // Fallback copy
                    try (InputStream in = new java.io.FileInputStream(tmp);
                         FileOutputStream out = new FileOutputStream(dest)) {
                        byte[] buf = new byte[64 * 1024];
                        int n;
                        while ((n = in.read(buf)) >= 0) out.write(buf, 0, n);
                    }
                    tmp.delete();
                }

                JSObject ret = new JSObject();
                ret.put("path", dest.getAbsolutePath());
                ret.put("size", dest.length());
                ret.put("songId", songId);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "Download error");
            } finally {
                if (conn != null) conn.disconnect();
            }
        });
    }

    @PluginMethod
    public void getPath(PluginCall call) {
        String songId = call.getString("songId");
        if (songId == null || songId.isEmpty()) {
            call.reject("Missing songId");
            return;
        }
        File f = fileFor(songId);
        JSObject ret = new JSObject();
        if (f.exists() && f.length() > 1000) {
            ret.put("path", f.getAbsolutePath());
            ret.put("size", f.length());
            ret.put("exists", true);
        } else {
            ret.put("exists", false);
            ret.put("path", "");
            ret.put("size", 0);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void delete(PluginCall call) {
        String songId = call.getString("songId");
        if (songId == null || songId.isEmpty()) {
            call.reject("Missing songId");
            return;
        }
        File f = fileFor(songId);
        boolean ok = !f.exists() || f.delete();
        File part = new File(f.getAbsolutePath() + ".part");
        if (part.exists()) part.delete();
        JSObject ret = new JSObject();
        ret.put("ok", ok);
        call.resolve(ret);
    }

    @PluginMethod
    public void list(PluginCall call) {
        File[] files = offlineDir().listFiles((dir, name) -> name.endsWith(".audio"));
        JSArray arr = new JSArray();
        long total = 0;
        if (files != null) {
            for (File f : files) {
                if (!f.isFile() || f.length() < 1000) continue;
                String name = f.getName();
                String id = name.substring(0, name.length() - ".audio".length());
                JSObject row = new JSObject();
                row.put("songId", id);
                row.put("path", f.getAbsolutePath());
                row.put("size", f.length());
                arr.put(row);
                total += f.length();
            }
        }
        JSObject ret = new JSObject();
        ret.put("files", arr);
        ret.put("totalBytes", total);
        call.resolve(ret);
    }

    @PluginMethod
    public void clearAll(PluginCall call) {
        File[] files = offlineDir().listFiles();
        int n = 0;
        if (files != null) {
            for (File f : files) {
                if (f.isFile() && f.delete()) n++;
            }
        }
        JSObject ret = new JSObject();
        ret.put("deleted", n);
        call.resolve(ret);
    }
}
