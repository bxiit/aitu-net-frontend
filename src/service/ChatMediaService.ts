import {api} from "@/lib";
import {aesGcmDecryptBytes, aesGcmEncryptBytes, binaryToBytes, bytesToBinary, fromBase64, randomBytes, toBase64} from "@/lib/crypto";

/**
 * What a voice/video message carries. It is the message's text, so it is end-to-end encrypted like any
 * other message: the server stores only the encrypted file and never sees `key`.
 */
export type MediaAttachment = {
    kind: "media";
    fileId: string;
    mimeType: string;
    durationSeconds: number;
    key: string; // base64 AES-256 key for this one file
    iv: string;  // base64 AES-GCM nonce
};

/** Encrypts the recording with a fresh key, uploads the ciphertext and returns the message content to send. */
export async function encryptAndUploadMedia(chatId: string, media: Blob, durationSeconds: number): Promise<string> {
    const key = binaryToBytes(randomBytes(32));
    const iv = binaryToBytes(randomBytes(12));
    const encrypted = await aesGcmEncryptBytes(key, iv, new Uint8Array(await media.arrayBuffer()));

    const response = await api.chat.uploadChatFile(chatId, new Blob([encrypted], {type: "application/octet-stream"}));

    const attachment: MediaAttachment = {
        kind: "media",
        fileId: response.data.fileId,
        mimeType: media.type,
        durationSeconds,
        key: toBase64(bytesToBinary(key)),
        iv: toBase64(bytesToBinary(iv)),
    };
    return JSON.stringify(attachment);
}

/** null for messages that don't carry an attachment, e.g. voice messages sent before media was encrypted. */
export function parseMediaAttachment(content: string): MediaAttachment | null {
    try {
        const parsed = JSON.parse(content);
        return parsed?.kind === "media" && typeof parsed.fileId === "string" ? parsed : null;
    } catch {
        return null;
    }
}

/** Downloads and decrypts the file; throws if it was tampered with (AES-GCM authentication). */
export async function downloadAndDecryptMedia(chatId: string, attachment: MediaAttachment): Promise<Blob> {
    const response = await api.chat.downloadChatFile(chatId, attachment.fileId);
    const decrypted = await aesGcmDecryptBytes(
        binaryToBytes(fromBase64(attachment.key)),
        binaryToBytes(fromBase64(attachment.iv)),
        new Uint8Array(response.data)
    );
    return new Blob([decrypted], {type: attachment.mimeType});
}
