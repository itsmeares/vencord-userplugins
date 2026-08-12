# vencord-userplugins

Personal Vencord user plugins maintained separately from the Vencord source tree.

## Plugins

- **CompactDMBar** — compresses Discord's friends/direct-message sidebar into an icon-first rail while preserving native navigation, avatars, unread state, status indicators, and tooltips where Discord provides them.
- **SoundboardPlus** — planned Soundboard and Entrance Sound tooling. Implementation will follow after native soundboard playback is proven against the current Discord/Vencord client.

## Development layout

Plugins live under `plugins/`. The included PowerShell helper links each plugin directory into a sibling Vencord checkout at `Vencord/src/userplugins/` without copying source files.

Expected workspace:

```text
vencord-dev/
├─ Vencord/
└─ vencord-userplugins/
```

Run `./scripts/link.ps1` from this repository after cloning both repositories. Build and inject Vencord from the Vencord checkout as usual.

## Status

This repository targets current Vencord source builds. Discord's internal UI modules change frequently, so UI plugins may need maintenance after Discord updates.
