/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import definePlugin, { ReporterTestable } from "@utils/types";
import { findByCodeLazy, findStoreLazy } from "@webpack";
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
const VOICE_CONNECTION_TIMEOUT_MS = 15_000;
const SPEAKING_VOICE = 1;
const RTCConnectionStore = findStoreLazy("RTCConnectionStore");
const getSoundboardVolume = findByCodeLazy(".getSetting()?.volume??100", ".getOutputVolume()/100") as (volume: number) => number;

type MediaEngine = ReturnType<typeof MediaEngineStore.getMediaEngine>;
type MediaEngineClassFactory = (type: string) => new () => MediaEngine;

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
    limiter: DynamicsCompressorNode;
    outputTrack: MediaStreamTrack;
    stopOutput: () => void;
}

interface ActiveSound {
    source: AudioBufferSourceNode;
    gain: GainNode;
}

interface LocalSample {
    stop(): void;
}

let mediaEngineClassFactory: MediaEngineClassFactory | undefined;
let webRtcEngine: MediaEngine | undefined;
let mixer: MixerState | null = null;
let activeSound: ActiveSound | null = null;
const localSamples = new Map<string, LocalSample>();
let transmittingSound = false;
let micSpeaking = false;
let lastVoiceChannelId: string | undefined;

function captureMediaEngineFactory(factory: MediaEngineClassFactory) {
    if (mediaEngineClassFactory) return;
    mediaEngineClassFactory = factory;
    if (IS_REPORTER) return;

    try {
        webRtcEngine = new (factory("WEBRTC"))();
        void webRtcEngine.fetchAsyncResources({ fetchDave: true })
            .then(() => webRtcEngine?.enable())
            .catch(error => logger.error("Failed to initialize the audio-only WebRTC engine", error));
    } catch (error) {
        logger.error("Failed to create the audio-only WebRTC engine", error);
    }
}

function getConnectionMediaEngine(context: string, nativeEngine: MediaEngine): MediaEngine {
    const voiceEngine = webRtcEngine;
    if (context !== "default" || !voiceEngine) return nativeEngine;

    return {
        connect: (...args: Parameters<MediaEngine["connect"]>) => {
            const connection = voiceEngine.connect(...args);
            const modeOptions = MediaEngineStore.getModeOptions();
            connection.setInputMode(MediaEngineStore.getMode(), {
                pttReleaseDelay: modeOptions.delay,
                vadThreshold: modeOptions.threshold
            });
            Object.assign(connection, {
                startSamplesLocalPlayback: playLocalSample,
                stopSamplesLocalPlayback: stopLocalSample,
                stopAllSamplesLocalPlayback: stopAllLocalSamples
            });
            const eventConnection = connection as typeof connection & {
                once(event: "destroy", listener: () => void): void;
            };
            eventConnection.once("destroy", () => nativeEngine.connections.delete(connection));
            nativeEngine.connections.add(connection);
            (nativeEngine as MediaEngine & {
                emit(event: "Connection", connection: ReturnType<MediaEngine["connect"]>): void;
            }).emit("Connection", connection);
            return connection;
        },
        supports: voiceEngine.supports.bind(voiceEngine)
    } as MediaEngine;
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

function waitForVoiceConnection(channelId: string) {
    if (RTCConnectionStore.isConnected() && RTCConnectionStore.getChannelId() === channelId) {
        return Promise.resolve(true);
    }

    return new Promise<boolean>(resolve => {
        const finish = (connected: boolean) => {
            clearTimeout(timeout);
            RTCConnectionStore.removeChangeListener(onChange);
            SelectedChannelStore.removeChangeListener(onChange);
            resolve(connected);
        };
        const onChange = () => {
            if (SelectedChannelStore.getVoiceChannelId() !== channelId) finish(false);
            else if (RTCConnectionStore.isConnected() && RTCConnectionStore.getChannelId() === channelId) finish(true);
        };
        const timeout = setTimeout(() => finish(false), VOICE_CONNECTION_TIMEOUT_MS);

        RTCConnectionStore.addChangeListener(onChange);
        SelectedChannelStore.addChangeListener(onChange);
        onChange();
    });
}

function syncSoundTransmission() {
    if (!mixer || !transmittingSound) return;
    if (MediaEngineStore.isSelfDeaf()) stopEntranceSound();
}

function sendSpeaking(speaking: boolean) {
    const connection = RTCConnectionStore.getRTCConnection();
    const ssrc = connection?._connection?.audioSSRC;
    if (ssrc != null) connection.sendSpeaking(speaking ? SPEAKING_VOICE : 0, ssrc);
}

function setMicSpeaking(speaking: boolean) {
    micSpeaking = speaking;
}

function getSpeaking(speaking: number) {
    return transmittingSound ? SPEAKING_VOICE : speaking;
}

function beginSoundTransmission() {
    if (transmittingSound) return;
    transmittingSound = true;
    sendSpeaking(true);
    MediaEngineStore.addChangeListener(syncSoundTransmission);
    syncSoundTransmission();
}

function finishSoundTransmission() {
    if (!transmittingSound) return;
    transmittingSound = false;
    sendSpeaking(micSpeaking);
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
    stopAllLocalSamples();

    state.input.disconnect();
    state.limiter.disconnect();
    state.stopOutput();
    state.inputStream.getTracks().forEach(track => track.stop());
    void state.context.close();
}

function playLocalSample(soundKey: string, buffer: AudioBuffer, volume: number, callback: (status: number, message?: string) => void) {
    stopLocalSample(soundKey);

    const state = mixer;
    if (!state) {
        callback(1, "Voice mixer unavailable");
        return;
    }

    const source = state.context.createBufferSource();
    const gain = state.context.createGain();
    let finished = false;

    const finish = (stop: boolean) => {
        if (finished) return;
        finished = true;
        localSamples.delete(soundKey);
        source.onended = null;
        if (stop) {
            try {
                source.stop();
            } catch { }
        }
        source.disconnect();
        gain.disconnect();
        callback(0);
    };

    gain.gain.value = volume;
    source.buffer = buffer;
    source.connect(gain).connect(state.context.destination);
    source.onended = () => finish(false);
    localSamples.set(soundKey, { stop: () => finish(true) });
    source.start(0, 0, Math.min(buffer.duration, MAX_SOUND_SECONDS));
}

function stopLocalSample(soundKey: string) {
    localSamples.get(soundKey)?.stop();
}

function stopAllLocalSamples() {
    [...localSamples.values()].forEach(sample => sample.stop());
}

function connectMixer(stream?: MediaStream): MediaStream | undefined {
    if (mixer && mixer.inputStream === stream) return mixer.outputStream;
    if (!stream) return;
    if (stream.getAudioTracks().length === 0) return stream;
    if (mixer) disposeMixer(mixer);

    const context = new AudioContext();
    const input = context.createMediaStreamSource(stream);
    const limiter = context.createDynamicsCompressor();
    const destination = context.createMediaStreamDestination();
    const outputStream = destination.stream;
    const outputTrack = destination.stream.getAudioTracks()[0];
    const stopOutput = outputTrack.stop.bind(outputTrack);

    limiter.threshold.value = -3;
    limiter.knee.value = 6;
    limiter.ratio.value = 4;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.1;
    input.connect(limiter).connect(destination);

    const state: MixerState = {
        disposed: false,
        context,
        inputStream: stream,
        outputStream,
        input,
        limiter,
        outputTrack,
        stopOutput
    };

    outputTrack.stop = () => disposeMixer(state);
    mixer = state;
    return outputStream;
}

async function playMixedSound(sound: SoundboardSound, channelId: string) {
    const response = await fetch(`${SOUNDBOARD_CDN}/${sound.soundId}`);
    if (!response.ok) throw new Error(`Sound download failed with ${response.status}`);

    const state = mixer;
    if (!state || SelectedChannelStore.getVoiceChannelId() !== channelId) return;

    const buffer = await state.context.decodeAudioData(await response.arrayBuffer());
    if (mixer !== state || SelectedChannelStore.getVoiceChannelId() !== channelId) return;
    if (!await waitForVoiceConnection(channelId)) return;
    if (mixer !== state || SelectedChannelStore.getVoiceChannelId() !== channelId) return;

    stopEntranceSound();
    await state.context.resume();

    const source = state.context.createBufferSource();
    const gain = state.context.createGain();
    const volume = Number.isFinite(sound.volume) ? sound.volume! : 1;

    gain.gain.value = getSoundboardVolume(Math.max(0, Math.min(1, volume)));
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
    if (voiceChannelId !== lastVoiceChannelId) {
        micSpeaking = false;
        stopEntranceSound();
    }
    lastVoiceChannelId = voiceChannelId;
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
                match: /return new\((\i)\((\i)\)\)(?:\(\))?/,
                replace: "return $self.captureMediaEngineFactory($1),new($1($2))"
            }
        },
        {
            find: '"MediaEngineWebRTC"',
            replacement: [
                {
                    match: /this\.videoSupported=\i\.\i;/,
                    replace: "this.videoSupported=true;"
                },
                {
                    match: /case (\i\.\i)\.VIDEO:return \i\.\i;/,
                    replace: "case $1.VIDEO:return true;"
                },
                {
                    match: /this\.audio\.stream\?\.getAudioTracks\(\)/,
                    replace: "$self.connectMixer(this.audio.stream)?.getAudioTracks()"
                },
                {
                    match: /handleInputSpeaking=(\i)=>\{/,
                    replace: "$&$self.setMicSpeaking($1),"
                }
            ]
        },
        {
            find: "shouldSendSpeaking(",
            replacement: [
                {
                    match: /(?<=shouldSendSpeaking\(\i,\i\)\{)if\(\(0,\i\.\i\)\(\)\)return!0;/,
                    replace: "return true;"
                },
                {
                    match: /sendSpeaking\((\i),(\i)\)\{/,
                    replace: "$&$1=$self.getSpeaking($1);"
                }
            ]
        },
        {
            find: "_connectMediaEngineWithEndpoint",
            replacement: {
                match: /(\i)=(\i\.\i\.getMediaEngine\(\)),(\i=\i\.\i\.getPersistentCodesEnabled\(\))/,
                replace: "$1=$self.getConnectionMediaEngine(this.context,$2),$3"
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

    captureMediaEngineFactory,
    getConnectionMediaEngine,
    connectMixer,
    getSpeaking,
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
