## TuneFriend v2.14

Fixes overnight playback getting stuck with "Playback error" after waking the phone.

### Changes

- **Queue no longer bundled with play commands** — queue is sent via a separate `setQueue` call so Android never chokes on oversized binder transactions
- **Auto-recovery** — if the native player enters a bad state (common after long background playback), the app stops and reloads the current track instead of requiring manual shuffle/next taps
- **Smarter status polling** — stops hammering `getDuration` on an unprepared MediaPlayer (the log spam you saw at 15:27)
- **Debounced resume sync** — opening the app after sleep no longer floods the player with redundant queue updates

### Install

Download **TuneFriend-v2.14.apk** below, install on Android (replaces v2.13), connect to your Navidrome/Subsonic server.

If music still stops overnight, confirm **Settings → Apps → TuneFriend → Battery → Unrestricted** on your Pixel.