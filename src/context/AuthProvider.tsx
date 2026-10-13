"use client";

import {User} from "@/models/User";
import {createContext, ReactNode, useContext, useEffect, useState} from "react";
import {api} from "@/lib";
import {NewUserRequest} from "@/models/NewUserRequest";
import {
    aesGcmDecrypt,
    aesGcmEncrypt,
    deletePrivateKey,
    exportPrivateKeyPkcs8,
    exportPublicKeySpki,
    fromBase64,
    generateRsaKeyPair,
    importPrivateKeyPkcs8,
    loadPrivateKey,
    pbkdf2Sha256,
    PrivateKey,
    randomBytes,
    savePrivateKey,
    toBase64
} from "@/lib/crypto";

interface AuthContextType {
    user: User | null;
    loadUser: () => void;
    loginUser: (userData: { email: string; password: string }) => Promise<void>;
    logout: () => void;
    register: (userRegData: NewUserRequest) => Promise<void>;
    recoverPrivateKey: (password: string) => Promise<boolean>;
}

interface AuthProviderProps {
    children: ReactNode;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({children}: AuthProviderProps) {
    const [user, setUser] = useState<User | null>(null);

    useEffect(() => {
        loadUser()
    }, []);

    // AES-256 key derived from the password: PBKDF2-SHA256, 100k iterations
    const deriveKeyFromPassword = (password: string, salt: string): Promise<string> =>
        pbkdf2Sha256(password, salt, 100000, 32);

    // Шифрование приватного ключа паролем
    const encryptPrivateKey = async (privateKey: PrivateKey, password: string): Promise<{
        encryptedKey: string;
        salt: string;
        iv: string;
    }> => {
        // Генерируем соль и IV
        const salt = randomBytes(16);
        const iv = randomBytes(12);

        // Создаем ключ шифрования из пароля
        const encryptionKey = await deriveKeyFromPassword(password, salt);

        // Шифруем приватный ключ (PKCS#8)
        const encryptedKey = aesGcmEncrypt(encryptionKey, iv, exportPrivateKeyPkcs8(privateKey));

        return {
            encryptedKey: toBase64(encryptedKey),
            salt: toBase64(salt),
            iv: toBase64(iv)
        };
    };

    const decryptPrivateKey = async (
        encryptedData: { encryptedKey: string; salt: string; iv: string },
        password: string
    ): Promise<PrivateKey> => {
        const decryptionKey = await deriveKeyFromPassword(password, fromBase64(encryptedData.salt));

        const privateKeyDer = aesGcmDecrypt(
            decryptionKey,
            fromBase64(encryptedData.iv),
            fromBase64(encryptedData.encryptedKey)
        );

        // Импортируем дешифрованный приватный ключ
        return importPrivateKeyPkcs8(privateKeyDer);
    };

    const loginUser = async (userData: { email: string; password: string }) => {
        return api.auth.login(userData)
            .then(response => {
                if (response.status === 200) {
                    console.log("Successfully logged in")
                    loadUser()
                    recoverPrivateKey(userData.password)
                        .then(success => {
                            if (success) {
                                console.log("Private key recovered successfully");
                            } else {
                                console.log("Failed to recover private key");
                            }
                        })
                        .catch(error => console.log("Error recovering private key:", error));
                }
            })
            .catch(error => {
                console.log("Failed logging in", error.response.data)
                return Promise.reject(error.response.data)
            })
    }

    const logout = async () => {
        api.auth.logout()
            .catch(error => {
                const problemDetail: ProblemDetail = error
                throw new Error(problemDetail.detail || "Logout failed")
            })
            .finally(() => {
                setUser(null)
                // Удаляем приватный ключ из локального хранилища
                deletePrivateKey()
                console.log("Logout successful")
            })
    }

    const register = async (userRegData: NewUserRequest & { password: string }) => {
        const keyPair = await generateKeyPair();
        userRegData.publicKey = keyPair.publicKey;

        userRegData.encryptedPrivateKeyDto = await encryptPrivateKey(keyPair.privateKey, userRegData.password);

        console.log("Registering user:", userRegData);
        return api.auth.register(userRegData)
            .then(response => {
                console.log("Registration successful:", response.data);
                return savePrivateKey(keyPair.privateKey);
            })
            .catch(error => {
                return Promise.reject(error.response.data);
            })
    };

    const generateKeyPair = async (): Promise<{ privateKey: PrivateKey; publicKey: string }> => {
        const keyPair = await generateRsaKeyPair(4096);

        return {
            privateKey: keyPair.privateKey,
            publicKey: exportPublicKeySpki(keyPair.publicKey)
        };
    }

    const recoverPrivateKey = async (password: string): Promise<boolean> => {
        try {
            // Проверяем, есть ли уже ключ в локальном хранилище
            const existingKey = await loadPrivateKey();
            if (existingKey) {
                console.log("Private key already exists locally");
                return true;
            }

            const response = await api.auth.getEncryptedPrivateKey();
            if (response.status !== 200) {
                throw new Error("Failed to fetch encrypted private key from server");
            }

            const encryptedKeyData = response.data;

            const privateKey = await decryptPrivateKey(encryptedKeyData, password);

            await savePrivateKey(privateKey);

            console.log("Private key recovered and stored locally");
            return true;

        } catch (error) {
            console.error("Failed to recover private key:", error);
            return false;
        }
    };

    const loadUser = () => {
        api.auth.getUser()
            .then(response => {
                if (response.status === 200) {
                    setUser(response.data)
                } else {
                    setUser(null);
                }
            })
            .catch(error => console.log("error while load user", error))
    };

    return <AuthContext.Provider
        value={{user, loginUser, logout, register, loadUser, recoverPrivateKey}}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error("useAuth must be used within an AuthProvider");
    }

    return context;
}

