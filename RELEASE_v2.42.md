## TuneFriend v2.42

### Security
- **Password no longer stored in cleartext** in localStorage
- Android: EncryptedSharedPreferences + Android Keystore (`SecureStorage` plugin)
- Web: AES-GCM with non-extractable key in IndexedDB
- One-time migration from old `tunefriend_config` blob
- Android Auto liked-library store encrypted; backup rules exclude secret prefs

### Notes
- First open after upgrade migrates your login automatically
- Disconnect clears secure storage

Download **TuneFriend-v2.42.apk** below.
