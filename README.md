# vencord-userplugins

Personal Vencord user plugins maintained separately from the Vencord source tree.

## Plugins

- **CompactDMBar** — compresses Discord's friends/direct-message sidebar into an icon-first rail while preserving native navigation, avatars, unread state, status indicators, and tooltips where Discord provides them.
- **SoundboardPlus** — planned Soundboard and Entrance Sound tooling. Implementation will follow after native soundboard playback is proven against the current Discord/Vencord client.

## Development layout

Plugins live under `plugins/`. The PowerShell sync helper copies managed plugin directories into a sibling Vencord checkout at `Vencord/src/userplugins/`.

Expected workspace:

```text
vencord-dev/
├─ Vencord/
└─ vencord-userplugins/
```

Run `./scripts/sync.ps1` from this repository after cloning both repositories. The helper only replaces plugin directories that it previously created; it refuses to overwrite unrelated userplugins.

A copy is used instead of a symlink/junction because Vencord's current esbuild path aliases are resolved from source files inside the Vencord tree. After pulling or editing plugin source, rerun the sync helper before rebuilding Vencord.

## Validation

GitHub Actions copies the plugins into the current Vencord `main` source tree and runs a standalone Vencord build. This catches module-resolution and TypeScript/bundling failures before live Discord testing.

## Status

This repository targets current Vencord source builds. Discord's internal UI modules change frequently, so UI plugins may need maintenance after Discord updates.
