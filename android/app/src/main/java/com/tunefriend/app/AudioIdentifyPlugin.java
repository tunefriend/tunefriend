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
import android.content.pm.PackageManager;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Build;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.geecko.fpcalc.FpCalc;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import org.json.JSONObject;

/**
 * Records a short mic clip, writes WAV, runs Chromaprint (fpcalc-android),
 * returns AcoustID-compatible fingerprint + duration.
 */
@CapacitorPlugin(
    name = "AudioIdentify",
    permissions = {
        @Permission(
            alias = "microphone",
            strings = { Manifest.permission.RECORD_AUDIO }
        )
    }
)
public class AudioIdentifyPlugin extends Plugin {
    private static final int SAMPLE_RATE = 44100;
    private static final int CHANNELS = 1;
    private static final int RECORD_SECONDS = 8;

    private volatile boolean recording = false;

    @PluginMethod
    public void fingerprintMic(PluginCall call) {
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            requestPermissionForAlias("microphone", call, "micPermCallback");
            return;
        }
        runFingerprint(call);
    }

    @PermissionCallback
    private void micPermCallback(PluginCall call) {
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO)
                == PackageManager.PERMISSION_GRANTED) {
            runFingerprint(call);
        } else {
            call.reject("Microphone permission denied");
        }
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", true);
        ret.put("native", true);
        call.resolve(ret);
    }

    private void runFingerprint(PluginCall call) {
        if (recording) {
            call.reject("Already recording");
            return;
        }
        new Thread(() -> {
            recording = true;
            File wav = null;
            try {
                notifyStatus("listening");
                wav = File.createTempFile("tf_identify_", ".wav", getContext().getCacheDir());
                int samples = recordToWav(wav, RECORD_SECONDS);
                if (samples < SAMPLE_RATE) {
                    call.reject("Recording too short — try again closer to the music");
                    return;
                }
                notifyStatus("fingerprinting");
                int durationSec = Math.max(1, samples / SAMPLE_RATE);
                String[] args = new String[] {
                    "-json",
                    "-length", String.valueOf(Math.min(durationSec, RECORD_SECONDS)),
                    wav.getAbsolutePath()
                };
                String result = FpCalc.fpCalc(args);
                if (result == null || result.isEmpty()) {
                    call.reject("Could not fingerprint audio");
                    return;
                }
                JSONObject json = new JSONObject(result);
                String fingerprint = json.optString("fingerprint", "");
                int duration = json.optInt("duration", durationSec);
                if (fingerprint.isEmpty()) {
                    call.reject("Empty fingerprint");
                    return;
                }
                JSObject ret = new JSObject();
                ret.put("fingerprint", fingerprint);
                ret.put("duration", duration);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "Identify failed");
            } finally {
                recording = false;
                if (wav != null && wav.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    wav.delete();
                }
            }
        }, "TuneFriend-Identify").start();
    }

    private void notifyStatus(String status) {
        JSObject data = new JSObject();
        data.put("status", status);
        notifyListeners("identifyStatus", data);
    }

    /** @return number of PCM samples recorded */
    private int recordToWav(File outFile, int seconds) throws IOException {
        int channelConfig = AudioFormat.CHANNEL_IN_MONO;
        int audioFormat = AudioFormat.ENCODING_PCM_16BIT;
        int minBuf = AudioRecord.getMinBufferSize(SAMPLE_RATE, channelConfig, audioFormat);
        if (minBuf <= 0) minBuf = SAMPLE_RATE;

        if (ActivityCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            throw new IOException("No microphone permission");
        }

        AudioRecord recorder = new AudioRecord(
            MediaRecorder.AudioSource.MIC,
            SAMPLE_RATE,
            channelConfig,
            audioFormat,
            Math.max(minBuf, SAMPLE_RATE * 2)
        );

        if (recorder.getState() != AudioRecord.STATE_INITIALIZED) {
            recorder.release();
            throw new IOException("Microphone unavailable");
        }

        int totalSamples = SAMPLE_RATE * seconds;
        short[] buffer = new short[minBuf / 2];
        ByteBuffer pcm = ByteBuffer.allocate(totalSamples * 2);
        pcm.order(ByteOrder.LITTLE_ENDIAN);

        recorder.startRecording();
        int readSamples = 0;
        try {
            while (readSamples < totalSamples) {
                int n = recorder.read(buffer, 0, Math.min(buffer.length, totalSamples - readSamples));
                if (n < 0) break;
                for (int i = 0; i < n; i++) {
                    pcm.putShort(buffer[i]);
                }
                readSamples += n;
            }
        } finally {
            try { recorder.stop(); } catch (Exception ignored) {}
            recorder.release();
        }

        byte[] pcmBytes = new byte[pcm.position()];
        pcm.flip();
        pcm.get(pcmBytes);

        writeWav(outFile, pcmBytes, SAMPLE_RATE, CHANNELS);
        return readSamples;
    }

    private static void writeWav(File file, byte[] pcm, int sampleRate, int channels) throws IOException {
        int byteRate = sampleRate * channels * 2;
        try (FileOutputStream out = new FileOutputStream(file)) {
            // RIFF header
            out.write(new byte[] { 'R', 'I', 'F', 'F' });
            writeInt(out, 36 + pcm.length);
            out.write(new byte[] { 'W', 'A', 'V', 'E' });
            out.write(new byte[] { 'f', 'm', 't', ' ' });
            writeInt(out, 16); // PCM chunk size
            writeShort(out, (short) 1); // PCM format
            writeShort(out, (short) channels);
            writeInt(out, sampleRate);
            writeInt(out, byteRate);
            writeShort(out, (short) (channels * 2)); // block align
            writeShort(out, (short) 16); // bits
            out.write(new byte[] { 'd', 'a', 't', 'a' });
            writeInt(out, pcm.length);
            out.write(pcm);
        }
    }

    private static void writeInt(FileOutputStream out, int v) throws IOException {
        out.write(v & 0xff);
        out.write((v >> 8) & 0xff);
        out.write((v >> 16) & 0xff);
        out.write((v >> 24) & 0xff);
    }

    private static void writeShort(FileOutputStream out, short v) throws IOException {
        out.write(v & 0xff);
        out.write((v >> 8) & 0xff);
    }
}
