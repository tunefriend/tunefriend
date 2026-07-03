# TuneFriend

Stream music from a friend's self-hosted Subsonic server (Navidrome, Airsonic, Gonic, etc.) on Android.

**Latest release:** [v2.16](https://github.com/tunefriend/tunefriend/releases/latest)

## Install

1. Download **[TuneFriend-v2.16.apk](https://github.com/tunefriend/tunefriend/releases/latest)** from Releases
2. Install on Android (allow installs from unknown sources if prompted)
3. Enter your friend's server URL, username, and password
4. Optional: **Settings → Sync Library** for the full album list

## Share with friends

- **Right now:** Send them the [latest release](https://github.com/tunefriend/tunefriend/releases/latest)
- **Coming soon:** [F-Droid listing](https://gitlab.com/fdroid/fdroiddata/-/merge_requests/41558) (pending review)

## Contact

Questions or feedback: **[tunefriend.music@proton.me](mailto:tunefriend.music@proton.me)**

## What friends need from you

If you're hosting the music server, give them:

1. **Server URL** — e.g. `http://your-ip:4533` or `https://music.yourdomain.com`
2. **Username** and **password** (create an account for them in Navidrome)

They do **not** need your computer running — only your music server.

## Features

- Browse **Home**, **Songs**, **Albums**, and **Search**
- **Shuffle All** and favorites
- **Background playback** with lock screen controls
- **Settings** in the bottom bar — server, quality, sync library

## Build from source

Requirements: Node.js 18+, JDK 21, Android SDK.

```bash
git clone https://github.com/tunefriend/tunefriend.git
cd tunefriend
npm install
npm run build:apk
```

APK output: `android/app/build/outputs/apk/debug/app-debug.apk`

## License

GNU General Public License v3.0 or later — see [LICENSE](LICENSE).

If you modify TuneFriend and distribute it (including sharing a modified APK), you must provide the source code for your version under the same license.