## TuneFriend v2.23

Fixes overnight playback stalls where music stopped silently (no audio-focus events) and only recovered after skipping to the next track.

### Changes
- **Native playback health monitor** — every 30s, if playback was intended but MediaPlayer is idle, auto-restart or reload the current stream at the saved position
- **Zombie-state recovery** — handles the case where `isPaused` is false but nothing is actually playing (the v2.22 watchdog missed this)
- **Focus resume uses `wantsToPlay`** — opening the app after a silent stall triggers recovery even when the player was not actively playing at focus-loss time
- **JS sync on app open** — if `nativeResume()` fails, reload the current track with a fresh URL instead of requiring a manual skip

Download **TuneFriend-v2.23.apk** below.