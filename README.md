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

## Submit to F-Droid

F-Droid is a free, open-source Android app store. Good fit for TuneFriend because it's libre software with no tracking.

### Requirements

- [x] Open source license (MIT — see `LICENSE`)
- [ ] Public git repository (GitHub or GitLab)
- [ ] Tagged release (e.g. `v1.6`)
- [ ] Merge request to [fdroiddata](https://gitlab.com/fdroid/fdroiddata)

### Steps

1. **Create a GitHub repo** and push this project:
   ```bash
   git init
   git add .
   git commit -m "TuneFriend 1.6"
   git tag v1.6
   git remote add origin https://github.com/YOUR_USERNAME/tunefriend.git
   git push -u origin main --tags
   ```

2. **Fork** [fdroid/fdroiddata](https://gitlab.com/fdroid/fdroiddata) on GitLab.

3. **Add metadata** — copy `fdroid/com.tunefriend.app.yml` to `metadata/com.tunefriend.app.yml` in your fork. Update `YOUR_USERNAME` and the `SourceCode` URLs.

4. **Open a merge request** on GitLab. F-Droid volunteers review and build the app themselves.

5. **Wait** — review often takes 1–4 weeks for new apps.

### After acceptance

Friends open F-Droid, search **TuneFriend**, install. Updates arrive automatically.

## License

MIT — see [LICENSE](LICENSE).