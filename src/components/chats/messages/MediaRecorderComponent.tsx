import React, {ReactElement, useEffect, useRef, useState} from "react";
import {AlertCircle, Lock, Mic, Send, Upload, Video, X} from "lucide-react";
import {MessageType} from "@/models/chat/ChatMessage";
import {VideoMessagePreviewModal} from "@/components/chats/messages/VideoMessagePreviewModal";
import {formatDuration} from "@/components/chats/messages/EncryptedMediaPlayer";
import {encryptAndUploadMedia} from "@/service/ChatMediaService";

interface E2EMediaRecorderProps {
    chatId: string;
    type: FileMessageType;
    handleSendMessage: (messageData: string, messageType: MessageType) => Promise<void>;
    isEncrypting?: boolean;
    disabled?: boolean;
}

export enum FileMessageType {
    VIDEO = 'VIDEO',
    AUDIO = 'AUDIO'
}

type MediaTypeConfig = {
    // in order of preference; the first one the browser can record is used (Safari can't record WebM)
    mimeTypes: string[];
    recorderOptions: MediaRecorderOptions;
    constraints: MediaStreamConstraints;
    maxSeconds: number;
    messageType: MessageType;
    displayName: string;
    idleUI: ReactElement;
}

const mediaRecorderConfigRecord: Record<FileMessageType, MediaTypeConfig> = {
    [FileMessageType.AUDIO]: {
        mimeTypes: ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'],
        // mono speech: ~240 KB per minute
        recorderOptions: {audioBitsPerSecond: 32_000},
        constraints: {
            audio: {channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true}
        },
        maxSeconds: 300,
        messageType: MessageType.MESSAGE_AUDIO,
        displayName: 'Voice message',
        idleUI: (
            <span className="flex items-center gap-2">
                <Mic size={16} strokeWidth={2.5}/>
                <span className="text-xs">Voice</span>
            </span>
        ),
    },
    [FileMessageType.VIDEO]: {
        mimeTypes: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'],
        // ~11 MB per minute, well under the server's 30 MB upload limit
        recorderOptions: {videoBitsPerSecond: 1_500_000, audioBitsPerSecond: 64_000},
        constraints: {
            video: {facingMode: 'user', width: {ideal: 640}, height: {ideal: 640}},
            audio: {echoCancellation: true, noiseSuppression: true}
        },
        maxSeconds: 60,
        messageType: MessageType.MESSAGE_VIDEO,
        displayName: 'Video message',
        idleUI: (
            <span className="flex items-center gap-2">
                <Video size={16} strokeWidth={2.5}/>
                <span className="text-xs">Video</span>
            </span>
        ),
    }
}

function pickMimeType(candidates: string[]): string | undefined {
    return candidates.find(type => MediaRecorder.isTypeSupported(type));
}

export const MediaRecorderComponent: React.FC<E2EMediaRecorderProps> = ({
                                                                            chatId,
                                                                            handleSendMessage,
                                                                            type,
                                                                            isEncrypting = false,
                                                                            disabled = false
                                                                        }) => {
    const config = mediaRecorderConfigRecord[type];
    const [state, setState] = useState<'idle' | 'recording' | 'sending'>('idle');
    const [error, setError] = useState<string | null>(null);
    const [elapsedSeconds, setElapsedSeconds] = useState(0);

    const recorderRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const discardRef = useRef(false);
    const startedAtRef = useRef(0);
    const stoppedAtRef = useRef(0);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const videoPreviewRef = useRef<HTMLVideoElement>(null);

    function releaseDevices() {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
        // stopping the tracks turns the camera/microphone indicator off
        streamRef.current?.getTracks().forEach(track => track.stop());
        streamRef.current = null;
    }

    // Leaving the chat mid-recording: discard it and release the devices
    useEffect(() => () => {
        discardRef.current = true;
        if (recorderRef.current?.state === 'recording') {
            recorderRef.current.stop();
        }
        releaseDevices();
    }, []);

    // The preview <video> only exists once the modal has rendered
    useEffect(() => {
        if (state === 'recording' && videoPreviewRef.current && streamRef.current) {
            videoPreviewRef.current.srcObject = streamRef.current;
        }
    }, [state]);

    async function startRecording() {
        setError(null);
        if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
            // browsers only expose the camera/microphone on HTTPS and localhost
            setError(window.isSecureContext ? "Recording isn't supported in this browser" : 'Recording requires HTTPS');
            return;
        }

        const mimeType = pickMimeType(config.mimeTypes);
        try {
            const stream = await navigator.mediaDevices.getUserMedia(config.constraints);
            streamRef.current = stream;

            const recorder = new MediaRecorder(stream, {...config.recorderOptions, ...(mimeType ? {mimeType} : {})});
            recorderRef.current = recorder;
            chunksRef.current = [];
            discardRef.current = false;

            recorder.ondataavailable = (event: BlobEvent) => {
                if (event.data.size > 0) chunksRef.current.push(event.data);
            };
            recorder.onstop = () => void finishRecording(recorder.mimeType || mimeType || '');

            recorder.start(1000);
            startedAtRef.current = Date.now();
            setElapsedSeconds(0);
            setState('recording');

            timerRef.current = setInterval(() => {
                const seconds = Math.floor((Date.now() - startedAtRef.current) / 1000);
                setElapsedSeconds(seconds);
                if (seconds >= config.maxSeconds) stopRecording(false);
            }, 250);
        } catch (e) {
            console.error('Failed to start recording:', e);
            releaseDevices();
            setError('Could not access camera/microphone');
        }
    }

    function stopRecording(discard: boolean) {
        discardRef.current = discard;
        stoppedAtRef.current = Date.now();
        if (recorderRef.current?.state === 'recording') {
            recorderRef.current.stop(); // flushes the last chunk, then onstop -> finishRecording
        }
        releaseDevices();
    }

    async function finishRecording(mimeType: string) {
        recorderRef.current = null;
        const chunks = chunksRef.current;
        chunksRef.current = [];
        if (discardRef.current || chunks.length === 0) {
            setState('idle');
            return;
        }

        setState('sending');
        try {
            const durationSeconds = Math.max(1, Math.round((stoppedAtRef.current - startedAtRef.current) / 1000));
            const content = await encryptAndUploadMedia(chatId, new Blob(chunks, {type: mimeType}), durationSeconds);
            await handleSendMessage(content, config.messageType);
        } catch (e) {
            console.error('Failed to send media message:', e);
            setError(`Failed to send ${config.displayName.toLowerCase()}`);
        } finally {
            setState('idle');
        }
    }

    // Compact pill that takes the button's place in the input bar while a voice message records
    const voiceRecordingControls = (
        <div className="flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 py-1 pl-3 pr-1 dark:border-red-800 dark:bg-red-900/30">
            <span className="h-2 w-2 shrink-0 rounded-full bg-red-500 animate-pulse"/>
            <span className="text-sm font-medium tabular-nums text-red-700 dark:text-red-300">
                {formatDuration(elapsedSeconds)}
            </span>
            <span className="hidden text-xs tabular-nums text-red-400 sm:inline">
                / {formatDuration(config.maxSeconds)}
            </span>
            <button
                onClick={() => stopRecording(true)}
                aria-label="Cancel recording"
                title="Cancel"
                className="ml-1 flex h-8 w-8 items-center justify-center rounded-full text-red-600 transition hover:bg-red-100 dark:text-red-300 dark:hover:bg-red-800/50"
            >
                <X size={16}/>
            </button>
            <button
                onClick={() => stopRecording(false)}
                aria-label={`Send ${config.displayName.toLowerCase()}`}
                title="Send"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-red-600 text-white shadow-sm transition hover:bg-red-700 active:scale-95"
            >
                <Send size={14}/>
            </button>
        </div>
    );

    return (
        <div className="flex flex-col items-center space-y-2">
            {error && (
                <div className="flex items-center space-x-1 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded">
                    <AlertCircle size={12}/>
                    <span>{error}</span>
                </div>
            )}

            {state === 'recording' ? (
                type === FileMessageType.VIDEO ? (
                    <VideoMessagePreviewModal
                        videoPreviewRef={videoPreviewRef}
                        elapsedSeconds={elapsedSeconds}
                        maxSeconds={config.maxSeconds}
                        onCancel={() => stopRecording(true)}
                        onSend={() => stopRecording(false)}
                    />
                ) : voiceRecordingControls
            ) : (
                <button
                    onClick={startRecording}
                    disabled={disabled || isEncrypting || state === 'sending'}
                    className="relative px-3 py-2 rounded-lg font-semibold transition-all duration-300 text-xs min-w-[80px] flex items-center justify-center space-x-1 bg-gray-600 hover:bg-gray-700 text-white disabled:bg-gray-400 disabled:text-gray-600 disabled:cursor-not-allowed"
                    title={`Record ${config.displayName.toLowerCase()} (end-to-end encrypted)`}
                >
                    {state === 'sending' ? (
                        <>
                            <Upload size={16} className="animate-pulse"/>
                            <span>Sending…</span>
                        </>
                    ) : (
                        <>
                            {config.idleUI}
                            <Lock size={8} className="opacity-60"/>
                        </>
                    )}
                </button>
            )}
        </div>
    );
};
