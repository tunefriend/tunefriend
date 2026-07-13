## TuneFriend v2.27

### Overnight playback (phone + app)
- Asks for **Notifications** (required for the media foreground service to stay alive all night)
- Prompts for **Ignore battery optimizations / Unrestricted** so Doze does not freeze the player
- Explains the overnight checklist in Settings

On your device we also found (and fixed via adb):
- Notifications were **denied**
- TuneFriend was **not** on the battery whitelist (Signal was)
- Audio focus was limited to **foreground only**

Download **TuneFriend-v2.27.apk** below.
