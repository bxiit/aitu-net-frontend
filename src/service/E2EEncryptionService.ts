import {ChatMessage} from "@/models/chat/ChatMessage";
import {
    aesGcmDecrypt,
    aesGcmEncrypt,
    DecryptionKey,
    fromBase64,
    loadPrivateKey,
    randomBytes,
    rsaOaepDecryptWith,
    rsaOaepEncryptFor,
    toBase64,
    toDecryptionKey,
    utf8Decode,
    utf8Encode
} from "@/lib/crypto";

export class E2EEncryptionService {
    private static instance: E2EEncryptionService
    private privateKey: DecryptionKey | null = null

    private constructor() {}

    static getInstance(): E2EEncryptionService {
        if (!E2EEncryptionService.instance) {
            E2EEncryptionService.instance = new E2EEncryptionService()
        }
        return E2EEncryptionService.instance
    }

    async initialize(): Promise<void> {
        try {
            const privateKey = await loadPrivateKey()
            this.privateKey = privateKey ? await toDecryptionKey(privateKey) : null
            if (!this.privateKey) {
                console.warn('Private key not found')
            }
        } catch (error) {
            console.error('Failed to load private key:', error)
        }
    }

    async encryptMessage(plainText: string, publicKeys: Record<string, string>): Promise<{
        encryptedContent: Record<string, string>
        encryptedKeys: Record<string, string>
    }> {
        const aesKey = randomBytes(32)
        const iv = randomBytes(12)
        const encryptedData = aesGcmEncrypt(aesKey, iv, utf8Encode(plainText))
        const encryptedMessageData = {
            encryptedData: toBase64(encryptedData),
            iv: toBase64(iv)
        }
        const encryptedContent: Record<string, string> = {}
        const encryptedKeys: Record<string, string> = {}
        for (const [userId, publicKeyBase64] of Object.entries(publicKeys)) {
            encryptedKeys[userId] = await this.encryptAESKeyWithRSA(aesKey, publicKeyBase64)

            encryptedContent[userId] = JSON.stringify(encryptedMessageData)
        }
        return { encryptedContent, encryptedKeys }
    }

    async decryptMessage(encryptedMessage: ChatMessage, currentUserId: string): Promise<string> {
        if (!this.privateKey) {
            throw new Error('Private key not available')
        }

        const encryptedAESKey = encryptedMessage.encryptedKeys[currentUserId]
        if (!encryptedAESKey) {
            throw new Error('No encrypted key for current user')
        }

        const aesKey = await this.decryptAESKeyWithRSA(encryptedAESKey)

        const encryptedContent = encryptedMessage.encryptedContent[currentUserId]
        if (!encryptedContent) {
            throw new Error('No encrypted content for current user')
        }

        const { encryptedData, iv } = JSON.parse(encryptedContent)

        return utf8Decode(aesGcmDecrypt(aesKey, fromBase64(iv), fromBase64(encryptedData)))
    }

    private async encryptAESKeyWithRSA(aesKey: string, publicKeyBase64: string): Promise<string> {
        return toBase64(await rsaOaepEncryptFor(publicKeyBase64, aesKey))
    }

    private async decryptAESKeyWithRSA(encryptedKeyBase64: string): Promise<string> {
        if (!this.privateKey) {
            throw new Error('Private key not available')
        }
        return rsaOaepDecryptWith(this.privateKey, fromBase64(encryptedKeyBase64))
    }
}
