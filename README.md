# TuneFriend

Stream music from a friend's self-hosted Subsonic server (Navidrome, Airsonic, Gonic, etc.) on Android.

**Latest release:** [v2.25](https://github.com/tunefriend/tunefriend/releases/latest)

**F-Droid:** [com.tunefriend.app](https://f-droid.org/en/packages/com.tunefriend.app/)

## Install

1. Prefer **[F-Droid](https://f-droid.org/en/packages/com.tunefriend.app/)** for automatic updates, or download the APK from [GitHub Releases](https://github.com/tunefriend/tunefriend/releases/latest)
2. Install on Android (allow installs from unknown sources if prompted)
3. Enter your friend's server URL, username, and password
4. **Settings → Sync Library** once (Wi‑Fi recommended for first sync) — then Songs, Albums, Genres, and Shuffle All use your full library

> **Note:** GitHub and F-Droid builds are **release-signed**. If you previously installed an old **debug** APK, uninstall it first, then install the release build.

## Share with friends

- Send them the [latest release](https://github.com/tunefriend/tunefriend/releases/latest), or
- Point them at the [F-Droid listing](https://f-droid.org/en/packages/com.tunefriend.app/)

## Contact

Questions or feedback: **[tunefriend.music@proton.me](mailto:tunefriend.music@proton.me)**

## What friends need from you

If you're hosting the music server, give them:

1. **Server URL** — e.g. `http://your-ip:4533` or `https://music.yourdomain.com`
2. **Username** and **password** (create an account for them in Navidrome)

They do **not** need your computer running — only your music server.

## Features

- Browse **Home**, **Songs**, **Albums**, **Genres** (and decades), and **Search**
- **Shuffle All** with artist-aware diversity for large libraries
- **Favorites** and **Settings** in the top bar
- **Background playback** with lock screen / notification controls
- Library sync for 50k+ song collections (search3 fast path)

## Build from source

Requirements: Node.js 18+, JDK 21, Android SDK.

```bash
git clone https://github.com/tunefriend/tunefriend.git
cd tunefriend
npm install
npm run build:apk
```

Release APK (with `android/keystore.properties` configured):

`android/app/build/outputs/apk/release/app-release.apk`

Debug APK: `npm run build:apk:debug`

## License

GNU General Public License v3.0 or later — see [LICENSE](LICENSE).

If you modify TuneFriend and distribute it (including sharing a modified APK), you must provide the source code for your version under the same license.
