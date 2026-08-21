/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import {
    ChannelStore,
    MediaEngineStore,
    SelectedChannelStore,
    SoundboardStore,
    UserSettingsProtoStore,
    UserStore
} from "@webpack/common";

const logger = new Logger("EntranceSounds");
const SOUNDBOARD_CDN = "https://cdn.discordapp.com/soundboard-sounds";
const MAX_SOUND_SECONDS = 20;

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

interface MixerState {
    disposed: boolean;
    context: AudioContext;
    inputStream: MediaStream;
    outputStream: MediaStream;
    input: MediaStreamAudioSourceNode;
    micGain: GainNode;
    limiter: DynamicsCompressorNode;
    outputTrack: MediaStreamTrack;
    stopOutput: () => void;
}

interface ActiveSound {
    source: AudioBufferSourceNode;
    gain: GainNode;
}

let mixer: MixerState | null = null;
let activeSound: ActiveSound | null = null;
let transmittingSound = false;
let lastVoiceChannelId: string | undefined;

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

function syncSoundTransmission() {
    if (!mixer || !transmittingSound) return;

    if (MediaEngineStore.isSelfDeaf()) stopEntranceSound();
}

function beginSoundTransmission() {
    if (transmittingSound) return;
    transmittingSound = true;
    MediaEngineStore.addChangeListener(syncSoundTransmission);
    syncSoundTransmission();
}

function finishSoundTransmission() {
    if (!transmittingSound) return;
    transmittingSound = false;
    MediaEngineStore.removeChangeListener(syncSoundTransmission);
}

function stopEntranceSound() {
    const sound = activeSound;
    activeSound = null;

    if (sound) {
        sound.source.onended = null;
        try {
            sound.source.stop();
        } catch { }
        sound.source.disconnect();
        sound.gain.disconnect();
    }

    finishSoundTransmission();
}

function disposeMixer(state: MixerState) {
    if (state.disposed) return;
    state.disposed = true;

    if (mixer === state) mixer = null;
    stopEntranceSound();

    state.input.disconnect();
    state.micGain.disconnect();
    state.limiter.disconnect();
    state.stopOutput();
    state.inputStream.getTracks().forEach(track => track.stop());
    void state.context.close();
}

function connectMixer(stream?: MediaStream): MediaStream | undefined {
    if (mixer && mixer.inputStream === stream) return mixer.outputStream;
    if (!stream) return;
    if (stream.getAudioTracks().length === 0) return stream;
    if (mixer) disposeMixer(mixer);

    const context = new AudioContext();
    const input = context.createMediaStreamSource(stream);
    const micGain = context.createGain();
    const limiter = context.createDynamicsCompressor();
    const destination = context.createMediaStreamDestination();
    const outputStream = destination.stream;
    const outputTrack = destination.stream.getAudioTracks()[0];
    const stopOutput = outputTrack.stop.bind(outputTrack);

    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    micGain.gain.value = 0;

    input.connect(micGain).connect(limiter).connect(destination);

    const state: MixerState = {
        disposed: false,
        context,
        inputStream: stream,
        outputStream,
        input,
        micGain,
        limiter,
        outputTrack,
        stopOutput
    };

    outputTrack.stop = () => disposeMixer(state);
    mixer = state;
    return outputStream;
}

function setMicSpeaking(stream: MediaStream | undefined, speaking: boolean) {
    if (mixer && stream?.getTracks().includes(mixer.outputTrack)) {
        mixer.micGain.gain.value = speaking ? 1 : 0;
    }
}

async function playMixedSound(sound: SoundboardSound, channelId: string) {
    const response = await fetch(`${SOUNDBOARD_CDN}/${sound.soundId}`);
    if (!response.ok) throw new Error(`Sound download failed with ${response.status}`);

    const state = mixer;
    if (!state || SelectedChannelStore.getVoiceChannelId() !== channelId) return;

    const buffer = await state.context.decodeAudioData(await response.arrayBuffer());
    if (mixer !== state || SelectedChannelStore.getVoiceChannelId() !== channelId) return;

    stopEntranceSound();
    await state.context.resume();

    const source = state.context.createBufferSource();
    const gain = state.context.createGain();
    const volume = Number.isFinite(sound.volume) ? sound.volume! : 1;

    gain.gain.value = Math.max(0, Math.min(1, volume));
    source.buffer = buffer;
    source.connect(gain).connect(state.limiter);

    const playing = { source, gain };
    activeSound = playing;
    source.onended = () => {
        if (activeSound !== playing) return;
        activeSound = null;
        source.disconnect();
        gain.disconnect();
        finishSoundTransmission();
    };

    beginSoundTransmission();
    source.start(0, 0, Math.min(buffer.duration, MAX_SOUND_SECONDS));
}

async function playEntranceSound() {
    try {
        const channelId = SelectedChannelStore.getVoiceChannelId();
        const selection = selectedJoinSound();
        if (!channelId || !selection) return;

        const sound = SoundboardStore.getSound(selection.guildId, selection.soundId);
        if (sound?.available) await playMixedSound(sound, channelId);
    } catch (error) {
        logger.error("Failed to play entrance sound", error);
        stopEntranceSound();
    }
}

function shouldMixSoundboardSound(request: SoundboardRequest, channelId: string) {
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
        if (sound) await playMixedSound(sound, channelId);
    } catch (error) {
        logger.error("Failed to play soundboard sound", error);
        stopEntranceSound();
    }
}

function onSelectedChannelChange() {
    const voiceChannelId = SelectedChannelStore.getVoiceChannelId();
    if (voiceChannelId !== lastVoiceChannelId) stopEntranceSound();
    lastVoiceChannelId = voiceChannelId;
}

export default definePlugin({
    name: "EntranceSounds",
    description: "Unlocks Discord's native Entrance Sounds picker and plays cross-server sounds through voice.",
    tags: ["Voice", "Fun"],
    authors: [{ name: "itsmeares", id: 0n }],

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
            find: "setupVoiceActivity(",
            replacement: {
                match: /setupVoiceActivity\((\i)\)\{let\{threshold:(\i)\}=\1;/,
                replace: "$&$2=$1.autoThreshold?Math.max($2??-40,-40):$2;"
            }
        },
        {
            find: /\[\i\.\i\.NATIVE,\i\.\i\.WEBRTC\]\.find\(\i=>\i\(\i\)\.supported\(\)\)/,
            replacement: {
                match: /\[(\i\.\i)\.NATIVE,\1\.WEBRTC\](?=\.find\()/,
                replace: "[$1.WEBRTC,$1.NATIVE]"
            }
        },
        {
            find: '"MediaEngineWebRTC"',
            replacement: [
                {
                    match: /this\.audio\.stream\?\.getAudioTracks\(\)/,
                    replace: "$self.connectMixer(this.audio.stream)?.getAudioTracks()"
                },
                {
                    match: /handleInputSpeaking=(\i)=>\{/,
                    replace: "$&$self.setMicSpeaking(this.input.stream,$1),"
                }
            ]
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
                replace: (_, request, channelId, body) => `$self.shouldMixSoundboardSound(${body},${channelId})?$self.playSoundboardSound(${body},${channelId}):${request}`
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

    connectMixer,
    setMicSpeaking,
    playEntranceSound,
    playSoundboardSound,
    shouldMixSoundboardSound,

    start() {
        lastVoiceChannelId = SelectedChannelStore.getVoiceChannelId();
        SelectedChannelStore.addChangeListener(onSelectedChannelChange);
    },

    stop() {
        SelectedChannelStore.removeChangeListener(onSelectedChannelChange);
        if (mixer) disposeMixer(mixer);
        lastVoiceChannelId = undefined;
    }
});
