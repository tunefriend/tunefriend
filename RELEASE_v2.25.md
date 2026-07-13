## TuneFriend v2.25

Big quality pass for large libraries, search, shuffle, and pocket-friendly playback.

### Fixes
- **Search back stack** — Search → artist/album → Back returns to your search results (not Home)
- **Long song titles** — Now Playing controls stay on screen; titles clamp instead of shoving play/skip down
- **Shuffle diversity** — artist-spread shuffle so huge catalogs (Elvis, Cash, etc.) no longer dominate; Shuffle All draws a diverse mix from your synced library (up to ~900 tracks)
- **Background stop after a run of songs** — larger native queue window, fresh stream tokens on advance, and auto-skip when a stalled stream won’t recover
- **Screen / pocket chaos** — app no longer shows over the lock screen (`showWhenLocked` off). Media keeps playing in the notification; accidental full-UI pocket presses should stop

### New
- **Settings** moved to the top bar (next to Favorites)
- **Genres tab** — Rock, Pop, Rap/Hip-Hop, Country, Alt Rock, plus **Decades** (1950s–2020s)
- **Play All / Shuffle All** inside each genre and decade (needs a library sync for tags)

### Faster sync
- Library sync prefers Subsonic `search3` pagination (Symfonium-style) and skips the slow full album walk when search already returns a complete set
- Tip: **Settings → Sync Library** once after updating so genres/decades and diverse shuffle work best

### Install
Download **TuneFriend-v2.25.apk** below (release-signed).

**From F-Droid / older release builds:** install over the top.

**From very old debug sideloads:** uninstall first, then install (different signing key).

For overnight/background reliability on Pixel: **Settings → Apps → TuneFriend → Battery → Unrestricted**.
