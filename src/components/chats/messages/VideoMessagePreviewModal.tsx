import React, {Ref, useEffect, useRef} from "react";
import {createPortal} from "react-dom";
import {Lock, Send, X} from "lucide-react";
import {formatDuration} from "@/components/chats/messages/EncryptedMediaPlayer";

interface VideoMessagePreviewModalProps {
    videoPreviewRef: Ref<HTMLVideoElement>;
    elapsedSeconds: number;
    maxSeconds: number;
    onCancel: () => void;
    onSend: () => void;
}

/**
 * Full-screen camera preview while a video message records: a round "video note" with a progress ring
 * that fills up to the time limit. Rendered into <body> so the chat input's overflow can't clip it.
 */
export const VideoMessagePreviewModal: React.FC<VideoMessagePreviewModalProps> = ({
                                                                                      videoPreviewRef,
                                                                                      elapsedSeconds,
                                                                                      maxSeconds,
                                                                                      onCancel,
                                                                                      onSend
                                                                                  }) => {
    const onCancelRef = useRef(onCancel);
    useEffect(() => {
        onCancelRef.current = onCancel;
    }, [onCancel]);

    // Escape cancels, and the page behind doesn't scroll while the preview is open
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") onCancelRef.current();
        };
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.body.style.overflow = previousOverflow;
            document.removeEventListener("keydown", onKeyDown);
        };
    }, []);

    const progress = Math.min(1, elapsedSeconds / maxSeconds);
    const almostOut = maxSeconds - elapsedSeconds <= 10;

    return createPortal(
        <div
            role="dialog"
            aria-modal="true"
            aria-label="Recording a video message"
            className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85 backdrop-blur-md px-4 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
        >
            {/* Timer */}
            <div className="mb-6 flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-sm font-medium text-white">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse"/>
                <span className="tabular-nums">{formatDuration(elapsedSeconds)}</span>
                <span className={`tabular-nums ${almostOut ? "text-amber-300" : "text-white/50"}`}>
                    / {formatDuration(maxSeconds)}
                </span>
            </div>

            {/* Round preview with a progress ring */}
            <div className="relative aspect-square w-[min(72vw,320px)]">
                <svg viewBox="0 0 100 100" className="absolute -inset-2.5 h-[calc(100%+1.25rem)] w-[calc(100%+1.25rem)] -rotate-90">
                    <circle cx="50" cy="50" r="48.5" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5"/>
                    <circle
                        cx="50" cy="50" r="48.5" fill="none"
                        stroke={almostOut ? "#fbbf24" : "#ef4444"}
                        strokeWidth="1.5" strokeLinecap="round"
                        pathLength={100} strokeDasharray="100" strokeDashoffset={100 - progress * 100}
                        className="transition-[stroke-dashoffset] duration-300 ease-linear"
                    />
                </svg>
                {/* mirrored, like a selfie camera */}
                <video
                    ref={videoPreviewRef}
                    autoPlay
                    muted
                    playsInline
                    className="h-full w-full -scale-x-100 rounded-full bg-gray-900 object-cover shadow-2xl"
                />
            </div>

            <p className="mt-6 flex items-center gap-1.5 text-xs text-white/60">
                <Lock size={12}/>
                End-to-end encrypted
            </p>

            {/* Controls: large touch targets for mobile */}
            <div className="mt-8 flex items-center gap-12">
                <button
                    onClick={onCancel}
                    aria-label="Cancel recording"
                    title="Cancel (Esc)"
                    className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 active:scale-95"
                >
                    <X size={24}/>
                </button>
                <button
                    onClick={onSend}
                    aria-label="Send video message"
                    title="Send"
                    className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg shadow-blue-600/40 transition hover:bg-blue-500 active:scale-95"
                >
                    <Send size={26}/>
                </button>
            </div>
        </div>,
        document.body
    );
}
