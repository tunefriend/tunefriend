export function setupMediaSession(player, getApi) {
  if (!("mediaSession" in navigator)) return;

  navigator.mediaSession.setActionHandler("play", () => player.audio.play().catch(() => {}));
  navigator.mediaSession.setActionHandler("pause", () => player.audio.pause());
  navigator.mediaSession.setActionHandler("previoustrack", () => player.prev());
  navigator.mediaSession.setActionHandler("nexttrack", () => player.next());
  navigator.mediaSession.setActionHandler("seekto", (details) => {
    if (details.seekTime != null && player.audio.duration) {
      player.audio.currentTime = details.seekTime;
    }
  });

  player.onTrackChange = ((orig) => (song) => {
    orig?.(song);
    if (!song) return;
    const api = getApi();
    const artwork = api && song.coverArt
      ? [{ src: api.coverArtUrl(song.coverArt, 512), sizes: "512x512", type: "image/jpeg" }]
      : [];
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.title,
      artist: song.artist,
      album: song.album || "",
      artwork,
    });
    navigator.mediaSession.playbackState = player.isPlaying ? "playing" : "paused";
  })(player.onTrackChange);

  player.onStateChange = ((orig) => () => {
    orig?.();
    navigator.mediaSession.playbackState = player.isPlaying ? "playing" : "paused";
  })(player.onStateChange);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && player.isPlaying) {
      player.audio.play().catch(() => {});
    }
  });
}