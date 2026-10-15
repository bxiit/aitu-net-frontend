import React, {useEffect, useMemo, useState} from "react";
import {AlertCircle, Loader2, Play} from "lucide-react";
import {downloadAndDecryptMedia, parseMediaAttachment} from "@/service/ChatMediaService";

interface EncryptedMediaPlayerProps {
    chatId: string;
    content: string; // the decrypted message text, a MediaAttachment as JSON
    kind: "audio" | "video";
}

export const formatDuration = (seconds: number): string =>
    `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** Downloads and decrypts the file only when the user presses play, so opening a chat stays cheap. */
export const EncryptedMediaPlayer: React.FC<EncryptedMediaPlayerProps> = ({chatId, content, kind}) => {
    const attachment = useMemo(() => parseMediaAttachment(content), [content]);
    const [objectUrl, setObjectUrl] = useState<string | null>(null);
    const [state, setState] = useState<"idle" | "loading" | "error">("idle");

    useEffect(() => () => {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
    }, [objectUrl]);

    if (!attachment) {
        return (
            <p className="text-xs italic opacity-80">
                Sent before media encryption, can&apos;t be played
            </p>
        );
    }

    const load = async (e: React.MouseEvent) => {
        e.stopPropagation();
        setState("loading");
        try {
            const media = await downloadAndDecryptMedia(chatId, attachment);
            setObjectUrl(URL.createObjectURL(media));
            setState("idle");
        } catch (error) {
            console.error("Failed to load media message:", error);
            setState("error");
        }
    };

    if (objectUrl) {
        return kind === "audio"
            ? <audio controls autoPlay src={objectUrl} className="w-60 max-w-full" onClick={e => e.stopPropagation()}/>
            : <video controls autoPlay playsInline src={objectUrl} className="w-64 max-w-full rounded-lg"
                     onClick={e => e.stopPropagation()}/>;
    }

    return (
        <button
            onClick={load}
            disabled={state === "loading"}
            className="flex items-center gap-2 px-3 py-2 rounded-full bg-black/10 dark:bg-white/10 hover:bg-black/20 dark:hover:bg-white/20 text-sm disabled:cursor-wait"
        >
            {state === "loading" ? <Loader2 size={16} className="animate-spin"/>
                : state === "error" ? <AlertCircle size={16}/>
                    : <Play size={16}/>}
            <span>
                {state === "loading" ? "Decrypting…"
                    : state === "error" ? "Couldn't load, retry"
                        : formatDuration(attachment.durationSeconds)}
            </span>
        </button>
    );
};
