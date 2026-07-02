## TuneFriend v2.13

### Performance
- **Faster tab switching** — songs and albums load in chunks instead of freezing the UI
- Tabs respond immediately; large lists fill in as you scroll
- One tap handler for big libraries (no more 9,000+ click listeners)

### Library sync (v2.10–v2.12)
- **Sync Library** saves albums and songs on your phone (Symfonium-style)
- Songs tab opens from cache after one sync — no reload every visit
- `search3` pagination + artist/year scans for full Navidrome libraries
- Tab switching cancels in-flight loads (no getting stuck on Songs)

### Playback (v2.8+)
- Background playback keeps the full queue with screen off
- Shuffle and session restore fixes
- Crash fix for large playlists on app open

### Install
Download **TuneFriend-v2.13.apk** below, install on Android, connect to your friend's Navidrome/Subsonic server, then **Settings → Sync Library** once on Wi‑Fi.