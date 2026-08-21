/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BrowserWindow, IpcMainInvokeEvent } from "electron";

const SOUNDBOARD_CDN = "https://cdn.discordapp.com/soundboard-sounds";
const MAX_SOUND_SECONDS = 20;
const CAPTURE_START_DELAY_MS = 500;

interface PlaybackResult {
    ok: boolean;
    error?: string;
}

let playerWindow: BrowserWindow | undefined;

async function getPlayerWindow() {
    if (playerWindow && !playerWindow.isDestroyed()) return playerWindow;

    playerWindow = new BrowserWindow({
        show: false,
        skipTaskbar: true,
        webPreferences: {
            autoplayPolicy: "no-user-gesture-required",
            backgroundThrottling: false
        }
    });
    await playerWindow.loadURL("data:text/html,<title>EntranceSounds</title>");
    return playerWindow;
}

export async function getPlayerPid(_event: IpcMainInvokeEvent) {
    return (await getPlayerWindow()).webContents.getOSProcessId();
}

export async function playSound(_event: IpcMainInvokeEvent, soundId: string, volume: number) {
    if (!/^\d+$/.test(soundId)) return { ok: false, error: "Invalid sound id" };
    volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1;

    const player = await getPlayerWindow();
    const result = await player.webContents.executeJavaScript(`(async () => {
        try {
            globalThis.__entranceSound?.stop();

            const response = await fetch(${JSON.stringify(`${SOUNDBOARD_CDN}/${soundId}`)});
            if (!response.ok) return { ok: false, error: "Sound download failed with " + response.status };

            const context = globalThis.__entranceContext ??= new AudioContext();
            const buffer = await context.decodeAudioData(await response.arrayBuffer());
            const source = context.createBufferSource();
            const gain = context.createGain();

            gain.gain.value = ${volume};
            source.buffer = buffer;
            source.connect(gain).connect(context.destination);
            globalThis.__entranceSound = source;

            await context.resume();
            await new Promise(resolve => setTimeout(resolve, ${CAPTURE_START_DELAY_MS}));
            return await new Promise(resolve => {
                source.onended = () => {
                    if (globalThis.__entranceSound === source) globalThis.__entranceSound = null;
                    resolve({ ok: true });
                };
                source.start(0, 0, Math.min(buffer.duration, ${MAX_SOUND_SECONDS}));
            });
        } catch (error) {
            return { ok: false, error: String(error) };
        }
    })()`) as PlaybackResult;

    return result;
}

export async function stopSound(_event: IpcMainInvokeEvent) {
    if (playerWindow && !playerWindow.isDestroyed()) {
        await playerWindow.webContents.executeJavaScript("globalThis.__entranceSound?.stop(); globalThis.__entranceSound = null;");
    }
}
