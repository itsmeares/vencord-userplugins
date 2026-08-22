# EntranceSounds

Uses Discord's native Entrance Sounds picker, global selection, and per-server overrides without requiring Nitro. Cross-server sounds are downloaded from Discord's Soundboard CDN and mixed with the microphone through Discord's bundled WebRTC media engine.

Other users hear the entrance sound as voice audio. Discord's server does not emit the native Soundboard animation or attribution for non-Nitro cross-server playback.

The plugin initializes Discord's browser DAVE implementation on desktop so the WebRTC engine can authenticate with encrypted voice channels.
