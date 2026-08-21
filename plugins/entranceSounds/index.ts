/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import definePlugin, { PluginNative, ReporterTestable } from "@utils/types";
import {
    ChannelStore,
    MediaEngineStore,
    SelectedChannelStore,
    SoundboardStore,
    UserSettingsProtoStore,
    UserStore
} from "@webpack/common";

const Native = VencordNative.pluginHelpers.EntranceSounds as PluginNative<typeof import("./native")>;
const logger = new Logger("EntranceSounds");
const SOUNDSHARE_FLAG = 2;
let playbackGeneration = 0;

interface JoinSound {
    guildId: string;
    soundId: string;
}

interface SoundboardRequest {
    sound_id: string;
    source_guild_id?: string;
}

interface SoundboardSound {
    soundId: string;
    volume?: number;
}

function selectedJoinSound(): JoinSound | undefined {
    const channelId = SelectedChannelStore.getVoiceChannelId();
    const guildId = channelId ? ChannelStore.getChannel(channelId)?.guild_id : undefined;
    if (!guildId) return;

    const guilds = UserSettingsProtoStore.settings.guilds?.guilds as Record<
        string,
        { joinSound?: JoinSound; }
    > | undefined;
    return guilds?.[guildId]?.joinSound ?? guilds?.["0"]?.joinSound;
}

async function playSound(sound: SoundboardSound, channelId: string) {
    if (SelectedChannelStore.getVoiceChannelId() !== channelId) return;

    const generation = ++playbackGeneration;
    const playerPid = await Native.getPlayerPid();
    MediaEngineStore.getMediaEngine().setSoundshareSource(playerPid, true, "default");

    try {
        const result = await Native.playSound(sound.soundId, sound.volume ?? 1);
        if (!result.ok) throw new Error(result.error);
    } finally {
        if (generation === playbackGeneration) stopSoundshare();
    }
}

function stopSoundshare() {
    const mediaEngine = MediaEngineStore.getMediaEngine();
    mediaEngine.setSoundshareSource(0, false, "default");
    mediaEngine.eachConnection(connection => {
        const native = connection as typeof connection & { localSpeakingFlags?: Record<string, number>; };
        const flags = native.localSpeakingFlags?.[native.userId] ?? 0;
        native.handleSpeakingFlags(native.userId, flags & ~SOUNDSHARE_FLAG, native.audioSSRC);
    }, "default");
}

function stopSound() {
    playbackGeneration++;
    stopSoundshare();
    void Native.stopSound();
}

async function playEntranceSound() {
    try {
        const channelId = SelectedChannelStore.getVoiceChannelId();
        const selection = selectedJoinSound();
        if (!channelId || !selection) return;

        const sound = SoundboardStore.getSound(selection.guildId, selection.soundId);
        if (sound?.available) await playSound(sound, channelId);
    } catch (error) {
        logger.error("Failed to play entrance sound", error);
        stopSound();
    }
}

function shouldPlaySoundboardSound(request: SoundboardRequest, channelId: string) {
    const channelGuildId = ChannelStore.getChannel(channelId)?.guild_id;
    return UserStore.getCurrentUser()?.premiumType !== 2
        && request.source_guild_id != null
        && request.source_guild_id !== channelGuildId;
}

async function playSoundboardSound(request: SoundboardRequest, channelId: string) {
    try {
        const guildId = request.source_guild_id;
        if (!guildId || SelectedChannelStore.getVoiceChannelId() !== channelId) return;

        const sound = SoundboardStore.getSound(guildId, request.sound_id);
        if (sound) await playSound(sound, channelId);
    } catch (error) {
        logger.error("Failed to play soundboard sound", error);
        stopSound();
    }
}

export default definePlugin({
    name: "EntranceSounds",
    description: "Unlocks Discord's native Entrance Sounds picker and plays cross-server sounds through voice.",
    tags: ["Voice", "Fun"],
    authors: [{ name: "itsmeares", id: 0n }],
    reporterTestable: ReporterTestable.Patches,

    patches: [
        {
            find: "canUseSoundboardEverywhere:",
            replacement: [
                {
                    match: /(?<=canUseSoundboardEverywhere:function\(\i\)\{)/,
                    replace: "return true;"
                },
                {
                    match: /(?<=canUseCustomCallSounds:function\(\i\)\{)/,
                    replace: "return true;"
                }
            ]
        },
        {
            find: 'type:"GUILD_SOUNDBOARD_SOUND_CREATE"',
            replacement: {
                match: /(?<=type:"(?:SOUNDBOARD_SOUNDS_RECEIVED|GUILD_SOUNDBOARD_SOUND_CREATE|GUILD_SOUNDBOARD_SOUND_UPDATE|GUILD_SOUNDBOARD_SOUNDS_UPDATE)".+?available:)\i\.available/g,
                replace: "true",
                // FakeNitro applies the same patch when it is enabled.
                noWarn: true
            }
        },
        {
            find: "fetchDave:",
            replacement: {
                match: /(?<=fetchAsyncResources\(\)\{let \i=\{fetchDave:)[^}]+/,
                replace: "true"
            }
        },
        {
            find: "soundshareSentSpeakingEvent",
            replacement: {
                match: /(\i\.soundshareId===\i&&\i\.soundshareSentSpeakingEvent)\|\|\i\.context!==\i\.\i\.STREAM/,
                replace: "$1"
            }
        },
        {
            find: "CUSTOM_CALL_SOUNDS(",
            replacement: {
                match: /\i\.\i\.post\(\{url:\i\.\i\.CUSTOM_CALL_SOUNDS\(\i\).*?rejectWithError:!0\}\)/,
                replace: "$self.playEntranceSound()"
            }
        },
        {
            find: "SEND_SOUNDBOARD_SOUND(",
            replacement: {
                match: /(\i\.\i\.post\(\{url:\i\.\i\.SEND_SOUNDBOARD_SOUND\((\i)\),body:(\i),signal:\i\.signal,onRequestProgress:\i,rejectWithError:!0\}\))/,
                replace: (_, request, channelId, body) => `$self.shouldPlaySoundboardSound(${body},${channelId})?$self.playSoundboardSound(${body},${channelId}):${request}`
            }
        },
        {
            find: "soundboard_floating_upsell",
            replacement: {
                match: /\i\.\i\.isPremium\(\i,\i\.\i\.TIER_2\)/g,
                replace: "true"
            }
        }
    ],

    playEntranceSound,
    playSoundboardSound,
    shouldPlaySoundboardSound,

    stop() {
        stopSound();
    }
});
