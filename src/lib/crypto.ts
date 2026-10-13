// Pure-JS crypto (node-forge) instead of window.crypto.subtle, which browsers only expose on HTTPS/localhost.
// Output formats match what the previous WebCrypto code produced, so existing keys and messages stay readable:
// RSA-OAEP with SHA-256 (MGF1 SHA-256), keys as SPKI / PKCS#8 DER, AES-GCM ciphertext with the 16-byte tag appended.
// All byte data is handled as forge "binary strings" (one char per byte) and exchanged as base64.
import forge from "node-forge";
import {del, get, set} from "idb-keyval";

export type PrivateKey = forge.pki.rsa.PrivateKey;
export type PublicKey = forge.pki.rsa.PublicKey;

const PRIVATE_KEY_STORE = "rsa-private-key";
const AES_GCM_TAG_BYTES = 16;

export const toBase64 = (bytes: string): string => forge.util.encode64(bytes);
export const fromBase64 = (base64: string): string => forge.util.decode64(base64);
export const randomBytes = (count: number): string => forge.random.getBytesSync(count);
export const utf8Encode = (text: string): string => forge.util.encodeUtf8(text);
export const utf8Decode = (bytes: string): string => forge.util.decodeUtf8(bytes);

// Missing from @types/node-forge
type KeyPairGenerationState = { keys: forge.pki.rsa.KeyPair | null };
const rsaSteps = forge.pki.rsa as unknown as {
    createKeyPairGenerationState(bits: number, e: number): KeyPairGenerationState;
    stepKeyPairGenerationState(state: KeyPairGenerationState, ms: number): boolean;
};

export function generateRsaKeyPair(bits = 4096): Promise<forge.pki.rsa.KeyPair> {
    return new Promise((resolve, reject) => {
        // forge's async generateKeyPair uses native WebCrypto when it exists...
        if (window.crypto?.subtle) {
            forge.pki.rsa.generateKeyPair({bits, e: 0x10001}, (err, keyPair) => err ? reject(err) : resolve(keyPair));
            return;
        }
        // ...but without it, it spawns web workers from a script URL the app doesn't serve and never settles.
        // So generate on the main thread in 50ms slices to keep the page responsive.
        const state = rsaSteps.createKeyPairGenerationState(bits, 0x10001);
        const step = () => {
            try {
                if (rsaSteps.stepKeyPairGenerationState(state, 50)) {
                    resolve(state.keys!);
                } else {
                    setTimeout(step, 0);
                }
            } catch (error) {
                reject(error);
            }
        };
        setTimeout(step, 0);
    });
}

export const exportPublicKeySpki = (publicKey: PublicKey): string =>
    toBase64(forge.asn1.toDer(forge.pki.publicKeyToAsn1(publicKey)).getBytes());

export const importPublicKeySpki = (base64: string): PublicKey =>
    forge.pki.publicKeyFromAsn1(forge.asn1.fromDer(fromBase64(base64))) as PublicKey;

export const exportPrivateKeyPkcs8 = (privateKey: PrivateKey): string =>
    forge.asn1.toDer(forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(privateKey))).getBytes();

export const importPrivateKeyPkcs8 = (der: string): PrivateKey =>
    forge.pki.privateKeyFromAsn1(forge.asn1.fromDer(der)) as PrivateKey;

const oaepSha256 = () => ({md: forge.md.sha256.create(), mgf1: {md: forge.md.sha256.create()}});

export const rsaOaepEncrypt = (publicKey: PublicKey, bytes: string): string =>
    publicKey.encrypt(bytes, "RSA-OAEP", oaepSha256());

export const rsaOaepDecrypt = (privateKey: PrivateKey, bytes: string): string =>
    privateKey.decrypt(bytes, "RSA-OAEP", oaepSha256());

export function aesGcmEncrypt(key: string, iv: string, plaintext: string): string {
    const cipher = forge.cipher.createCipher("AES-GCM", key);
    cipher.start({iv, tagLength: AES_GCM_TAG_BYTES * 8});
    cipher.update(forge.util.createBuffer(plaintext));
    cipher.finish();
    return cipher.output.getBytes() + cipher.mode.tag.getBytes();
}

export function aesGcmDecrypt(key: string, iv: string, data: string): string {
    const decipher = forge.cipher.createDecipher("AES-GCM", key);
    decipher.start({
        iv,
        tagLength: AES_GCM_TAG_BYTES * 8,
        tag: forge.util.createBuffer(data.slice(-AES_GCM_TAG_BYTES)),
    });
    decipher.update(forge.util.createBuffer(data.slice(0, -AES_GCM_TAG_BYTES)));
    if (!decipher.finish()) {
        throw new Error("AES-GCM authentication failed");
    }
    return decipher.output.getBytes();
}

// Async form so the 100k iterations don't freeze the page.
export function pbkdf2Sha256(password: string, salt: string, iterations: number, keyBytes: number): Promise<string> {
    return new Promise((resolve, reject) =>
        forge.pkcs5.pbkdf2(utf8Encode(password), salt, iterations, keyBytes, forge.md.sha256.create(),
            (err, derivedKey) => err ? reject(err) : resolve(derivedKey))
    );
}

// The private key is stored in IndexedDB as base64 PKCS#8, because forge key objects don't survive structured cloning.
export async function savePrivateKey(privateKey: PrivateKey): Promise<void> {
    await set(PRIVATE_KEY_STORE, toBase64(exportPrivateKeyPkcs8(privateKey)));
}

export async function loadPrivateKey(): Promise<PrivateKey | null> {
    const stored = await get(PRIVATE_KEY_STORE);
    if (typeof stored === "string") {
        return importPrivateKeyPkcs8(fromBase64(stored));
    }
    // Older versions stored a WebCrypto CryptoKey; convert it where WebCrypto is still available.
    // Otherwise return null so the key is recovered from the server on the next login.
    if (stored && window.crypto?.subtle) {
        try {
            const pkcs8 = new Uint8Array(await window.crypto.subtle.exportKey("pkcs8", stored as CryptoKey));
            const privateKey = importPrivateKeyPkcs8(String.fromCharCode(...pkcs8));
            await savePrivateKey(privateKey);
            return privateKey;
        } catch (error) {
            console.warn("Could not convert stored CryptoKey:", error);
        }
    }
    return null;
}

export const deletePrivateKey = (): Promise<void> => del(PRIVATE_KEY_STORE);
