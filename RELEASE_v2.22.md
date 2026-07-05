## TuneFriend v2.22

Fix overnight playback stopping when audio focus is lost and never returned.

### Changes

- **Resume watchdog** — if playback pauses due to a notification or system sound, the native player retries every 30 seconds without opening the app
- **Smarter focus handling** — distinguishes user pause vs system interruption; ignores focus flicker right after resume
- **Deferred resume** — waits briefly after focus returns to avoid pause/resume fighting on wake

### Install

Download **TuneFriend-v2.22.apk** below.