# TuneFriend

Stream music from a friend's self-hosted Subsonic server (Navidrome, Airsonic, Gonic, etc.) on Android.

## Share with friends (right now)

**Easiest:** Send them the APK file (`TuneFriend-v6.apk`). They install it and enter your server URL + login.

**Better for updates:** Publish releases on GitHub — friends download the latest APK from the Releases page.

**Best long-term:** Submit to [F-Droid](https://f-droid.org/) so friends install and get updates like any other app (see below).

## What friends need from you

If you're hosting the music server, give them:

1. **Server URL** — e.g. `http://your-ip:4533` or `https://music.yourdomain.com`
2. **Username** and **password** (create an account for them in Navidrome)

They do **not** need your computer running — only your music server.

## Build from source

Requirements: Node.js 18+, JDK 21, Android SDK.

```bash
cd tunefriend
npm install
npm run build:apk
```

APK output: `android/app/build/outputs/apk/debug/app-debug.apk`


## License

GNU General Public License v3.0 or later — see [LICENSE](LICENSE).

If you modify TuneFriend and distribute it (including sharing a modified APK), you must provide the source code for your version under the same license.
