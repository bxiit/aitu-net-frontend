import {request} from "@/lib/apiClient";
import {User} from "@/models/User";
import {AxiosResponse} from "axios";
import {NewUserRequest} from "@/models/NewUserRequest";

export const authApi = {
    register: (userRegData: NewUserRequest) =>
        request<User>('/auth/register', {method: 'POST', data: userRegData}),

    login: async (userData: { email: string; password: string }): Promise<AxiosResponse<{ token: string }>> =>
        await request<{ token: string }>('/auth/login', {method: 'POST', data: userData}),

    getUser: async (): Promise<AxiosResponse<User>> =>
        await request<User>('/auth/me'),

    logout: () => request('/auth/logout', {method: 'POST'}),

    forgotPassword: async (email: string) => {
        await request('/auth/forgot', {method: 'GET', params: {email}})
    },

    recoverPassword: async (token: string, password: string) => {
        await request('/auth/recover', {method: 'PATCH', params: {token, password}})
    },
    getEncryptedPrivateKey: async (): Promise<AxiosResponse<{
        encryptedKey: string;
        salt: string;
        iv: string; }>> =>
        await request<{
            encryptedKey: string;
            salt: string;
            iv: string;
        }>('/auth/encrypted-private-key', {method: 'GET'}),

    /** For accounts created before end-to-end encryption: the server accepts this only while it has no keys. */
    setUpKeys: (keys: {
        publicKey: string;
        encryptedPrivateKeyDto: { encryptedKey: string; salt: string; iv: string };
    }) => request<void>('/auth/keys', {method: 'POST', data: keys}),
};