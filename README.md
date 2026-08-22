# Vencord user plugins

This repository contains Vencord plugins that are maintained outside the main Vencord project.

These are source plugins. They do not appear in a normal Vencord installation until you build Vencord with them included.

## Plugins

- [CompactDMBar](plugins/compactDMBar/README.md) turns the Home and Friends sidebar into a narrow icon rail.
- [EntranceSounds](plugins/entranceSounds/README.md) unlocks Discord's Entrance Sound controls and lets non-Nitro users send cross-server Soundboard sounds through voice.

## Install on Windows

This guide starts from a normal Discord desktop installation. You do not need programming experience, but you will run a few commands in PowerShell.

### 1. Install the required tools

Install these first:

- [Git for Windows](https://git-scm.com/downloads/win)
- [Node.js 22 or newer](https://nodejs.org/en/download)

Open PowerShell and install the package manager used by Vencord:

```powershell
npm.cmd install --global pnpm@11.9.0
```

Close PowerShell and open it again after the installation finishes.

### 2. Download Vencord and these plugins

Paste these commands into PowerShell:

```powershell
Set-Location "$HOME\Documents"
git clone https://github.com/Vendicated/Vencord.git
git clone https://github.com/itsmeares/vencord-userplugins.git
```

This creates two folders next to each other in your Documents folder.

### 3. Copy the plugins into Vencord

```powershell
Set-Location "$HOME\Documents\vencord-userplugins"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\sync.ps1
```

> [!WARNING]
> PowerShell's execution policy helps prevent untrusted scripts from running. This command bypasses it for this one run. Only continue if you trust this repository and have not replaced or edited `scripts\sync.ps1`.

The script only replaces plugin folders that it created itself and refuses to overwrite an unrelated user plugin with the same name.

### 4. Build and install Vencord

Close Discord, then run:

```powershell
Set-Location "$HOME\Documents\Vencord"
pnpm.cmd install --frozen-lockfile
pnpm.cmd build
pnpm.cmd inject
```

The Vencord installer will open. Select your Discord version, such as Stable, PTB, or Canary, and install it. Start Discord when the installer finishes.

### 5. Enable a plugin

1. Open Discord settings.
2. Open `Vencord`, then `Plugins`.
3. Search for `CompactDMBar` or `EntranceSounds`.
4. Enable the plugin and restart Discord if asked.

## Update later

Close Discord and run the following commands whenever you want the latest plugin and Vencord changes:

```powershell
Set-Location "$HOME\Documents\vencord-userplugins"
git pull
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\sync.ps1

Set-Location "$HOME\Documents\Vencord"
git pull
pnpm.cmd install --frozen-lockfile
pnpm.cmd build
pnpm.cmd inject
```

Open Discord again after the installer finishes.

## Troubleshooting

If a plugin does not appear in Vencord settings, rerun the sync, build, and inject steps, then fully restart Discord.

Discord updates can remove a custom Vencord injection. If the plugins disappear after an update, go to the Vencord folder and run `pnpm.cmd inject` again.

For Vencord build problems, check the [official source installation guide](https://docs.vencord.dev/installing/).

## For contributors

Plugins live under `plugins/`. The sync helper copies them into `Vencord/src/userplugins/` because Vencord resolves build paths from inside its own source tree.

GitHub Actions syncs the plugins into the current Vencord `main` branch and runs a standalone build. Discord changes its internal modules often, so a plugin may need an update after Discord changes.

Vencord and user plugins are client modifications. They are not endorsed by Discord, and using client modifications is against Discord's Terms of Service. These user plugins are also not reviewed by the Vencord team.
