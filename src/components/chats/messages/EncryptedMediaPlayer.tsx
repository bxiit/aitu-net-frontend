import React, {useEffect, useMemo, useRef, useState} from "react";
import {Loader2, Pause, Play, RotateCcw} from "lucide-react";
import {downloadAndDecryptMedia, MediaAttachment, parseMediaAttachment} from "@/service/ChatMediaService";

interface EncryptedMediaPlayerProps {
    chatId: string;
    content: string; // the decrypted message text, a MediaAttachment as JSON
    kind: "audio" | "video";
    own: boolean;    // inside the sender's own (blue) bubble
}

export const formatDuration = (seconds: number): string => {
    const whole = Math.max(0, Math.floor(seconds));
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

const WAVEFORM_BARS = 36;
const PLAY_EVENT = "chat-media-play";

/** Stable bars shown before the audio is decrypted, so every voice message doesn't look the same. */
function placeholderPeaks(seed: string): number[] {
    let hash = 2166136261;
    for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return Array.from({length: WAVEFORM_BARS}, () => {
        hash = Math.imul(hash ^ (hash >>> 15), 2246822507);
        hash ^= hash >>> 13;
        return 0.25 + ((hash >>> 0) % 1000) / 1000 * 0.55;
    });
}

/** The real waveform: RMS loudness per bar, normalised. null if the browser can't decode the format. */
async function computePeaks(media: Blob): Promise<number[] | null> {
    const context = new AudioContext();
    try {
        const samples = (await context.decodeAudioData(await media.arrayBuffer())).getChannelData(0);
        const size = Math.max(1, Math.floor(samples.length / WAVEFORM_BARS));
        const peaks = Array.from({length: WAVEFORM_BARS}, (_, bar) => {
            let sum = 0;
            for (let i = bar * size; i < (bar + 1) * size && i < samples.length; i++) sum += samples[i] * samples[i];
            return Math.sqrt(sum / size);
        });
        const loudest = Math.max(...peaks) || 1;
        return peaks.map(peak => 0.12 + 0.88 * peak / loudest);
    } catch {
        return null;
    } finally {
        void context.close();
    }
}

/**
 * Downloads and decrypts on first play, then drives an <audio>/<video> element. Recorded WebM has no
 * duration in its metadata, so progress uses the duration stored in the encrypted message instead.
 */
function useEncryptedPlayback<T extends HTMLMediaElement>(chatId: string, attachment: MediaAttachment) {
    const mediaRef = useRef<T>(null);
    const [src, setSrc] = useState<string | null>(null);
    const [blob, setBlob] = useState<Blob | null>(null);
    const [state, setState] = useState<"idle" | "loading" | "error">("idle");
    const [playing, setPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const playWhenReady = useRef(false);

    useEffect(() => () => {
        if (src) URL.revokeObjectURL(src);
    }, [src]);

    // Only one voice/video message plays at a time
    useEffect(() => {
        const onOtherPlay = (e: Event) => {
            if ((e as CustomEvent).detail !== mediaRef.current) mediaRef.current?.pause();
        };
        window.addEventListener(PLAY_EVENT, onOtherPlay);
        return () => window.removeEventListener(PLAY_EVENT, onOtherPlay);
    }, []);

    // Start playing once the decrypted source is attached
    useEffect(() => {
        if (src && playWhenReady.current) {
            playWhenReady.current = false;
            void mediaRef.current?.play().catch(() => undefined);
        }
    }, [src]);

    const toggle = async (e?: React.MouseEvent) => {
        e?.stopPropagation();
        const media = mediaRef.current;
        if (src && media) {
            if (media.paused) await media.play().catch(() => undefined);
            else media.pause();
            return;
        }
        if (state === "loading") return;
        setState("loading");
        try {
            const decrypted = await downloadAndDecryptMedia(chatId, attachment);
            playWhenReady.current = true;
            setBlob(decrypted);
            setSrc(URL.createObjectURL(decrypted));
            setState("idle");
        } catch (error) {
            console.error("Failed to load media message:", error);
            setState("error");
        }
    };

    const seek = (ratio: number) => {
        const media = mediaRef.current;
        if (!media || !src) return;
        media.currentTime = ratio * attachment.durationSeconds;
        setCurrentTime(media.currentTime);
    };

    const mediaProps = {
        ref: mediaRef,
        src: src ?? undefined,
        preload: "auto" as const,
        onPlay: () => {
            setPlaying(true);
            window.dispatchEvent(new CustomEvent(PLAY_EVENT, {detail: mediaRef.current}));
        },
        onPause: () => setPlaying(false),
        onTimeUpdate: () => setCurrentTime(mediaRef.current?.currentTime ?? 0),
        onEnded: () => {
            setPlaying(false);
            setCurrentTime(0);
        },
    };

    const duration = attachment.durationSeconds;
    const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;
    return {src, blob, state, playing, currentTime, duration, progress, toggle, seek, mediaProps};
}

const PlaybackIcon: React.FC<{ state: "idle" | "loading" | "error"; playing: boolean; size: number }> = ({state, playing, size}) =>
    state === "loading" ? <Loader2 size={size} className="animate-spin"/>
        : state === "error" ? <RotateCcw size={size}/>
            : playing ? <Pause size={size} fill="currentColor"/>
                : <Play size={size} fill="currentColor" className="ml-0.5"/>;

const VoiceMessagePlayer: React.FC<{ chatId: string; attachment: MediaAttachment; own: boolean }> = ({chatId, attachment, own}) => {
    const playback = useEncryptedPlayback<HTMLAudioElement>(chatId, attachment);
    const [peaks, setPeaks] = useState(() => placeholderPeaks(attachment.fileId));

    useEffect(() => {
        if (playback.blob) computePeaks(playback.blob).then(real => real && setPeaks(real));
    }, [playback.blob]);

    const onWaveformClick = (e: React.MouseEvent<HTMLDivElement>) => {
        e.stopPropagation();
        if (!playback.src) return void playback.toggle();
        const box = e.currentTarget.getBoundingClientRect();
        playback.seek(Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)));
    };

    const showElapsed = playback.playing || playback.currentTime > 0;

    return (
        <div className="flex w-64 max-w-full items-center gap-3">
            <button
                onClick={playback.toggle}
                aria-label={playback.playing ? "Pause voice message" : "Play voice message"}
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition active:scale-95 ${
                    own ? "bg-white text-blue-600 hover:bg-blue-50" : "bg-blue-500 text-white hover:bg-blue-600"
                }`}
            >
                <PlaybackIcon state={playback.state} playing={playback.playing} size={18}/>
            </button>

            <div className="min-w-0 flex-1">
                <div
                    role="slider"
                    aria-label="Voice message position"
                    aria-valuemin={0}
                    aria-valuemax={Math.round(playback.duration)}
                    aria-valuenow={Math.round(playback.currentTime)}
                    onClick={onWaveformClick}
                    className="flex h-7 cursor-pointer items-center gap-[2px]"
                >
                    {peaks.map((peak, i) => {
                        const played = (i + 0.5) / peaks.length <= playback.progress;
                        return (
                            <span
                                key={i}
                                className={`flex-1 rounded-full transition-colors duration-150 ${
                                    own
                                        ? played ? "bg-white" : "bg-white/40"
                                        : played ? "bg-blue-500" : "bg-gray-300 dark:bg-gray-600"
                                }`}
                                style={{height: `${Math.round(peak * 100)}%`}}
                            />
                        );
                    })}
                </div>
                <div className={`mt-1 text-xs tabular-nums ${own ? "text-blue-100" : "text-gray-500 dark:text-gray-400"}`}>
                    {playback.state === "error"
                        ? "Couldn't load, tap to retry"
                        : showElapsed
                            ? `${formatDuration(playback.currentTime)} / ${formatDuration(playback.duration)}`
                            : formatDuration(playback.duration)}
                </div>
            </div>

            {playback.src && <audio {...playback.mediaProps} className="hidden"/>}
        </div>
    );
};

/** Round "video note", like the recording preview, with a progress ring. */
const VideoNotePlayer: React.FC<{ chatId: string; attachment: MediaAttachment }> = ({chatId, attachment}) => {
    const playback = useEncryptedPlayback<HTMLVideoElement>(chatId, attachment);
    const remaining = playback.duration - playback.currentTime;

    return (
        <div className="relative aspect-square w-[min(60vw,240px)]">
            {playback.src && (
                <svg viewBox="0 0 100 100" className="pointer-events-none absolute -inset-1.5 h-[calc(100%+0.75rem)] w-[calc(100%+0.75rem)] -rotate-90">
                    <circle cx="50" cy="50" r="49" fill="none" stroke="currentColor" strokeWidth="1.5"
                            className="text-gray-200 dark:text-gray-700"/>
                    <circle cx="50" cy="50" r="49" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
                            pathLength={100} strokeDasharray="100" strokeDashoffset={100 - playback.progress * 100}
                            className="text-blue-500 transition-[stroke-dashoffset] duration-200 ease-linear"/>
                </svg>
            )}

            {playback.src ? (
                <video {...playback.mediaProps} playsInline onClick={playback.toggle}
                       className="h-full w-full cursor-pointer rounded-full bg-black object-cover shadow-md"/>
            ) : (
                <div onClick={playback.toggle}
                     className="h-full w-full cursor-pointer rounded-full bg-gradient-to-br from-slate-600 to-slate-900 shadow-md"/>
            )}

            {!playback.playing && (
                <button
                    onClick={playback.toggle}
                    aria-label="Play video message"
                    className="absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm transition hover:bg-black/60 active:scale-95"
                >
                    <PlaybackIcon state={playback.state} playing={false} size={24}/>
                </button>
            )}

            <span className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-2 py-0.5 text-xs tabular-nums text-white">
                {playback.state === "error" ? "Tap to retry" : formatDuration(playback.playing || playback.currentTime > 0 ? remaining : playback.duration)}
            </span>
        </div>
    );
};

/** Voice and video messages. Downloads and decrypts only when played, so opening a chat stays cheap. */
export const EncryptedMediaPlayer: React.FC<EncryptedMediaPlayerProps> = ({chatId, content, kind, own}) => {
    const attachment = useMemo(() => parseMediaAttachment(content), [content]);

    if (!attachment) {
        return (
            <p className="text-xs italic opacity-80">
                Sent before media encryption, can&apos;t be played
            </p>
        );
    }
    return kind === "audio"
        ? <VoiceMessagePlayer chatId={chatId} attachment={attachment} own={own}/>
        : <VideoNotePlayer chatId={chatId} attachment={attachment}/>;
};
