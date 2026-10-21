import {User} from "@/models/User";
import {request} from "@/lib/apiClient";
import {ChatRoom} from "@/models/chat/ChatRoom";
import {AxiosResponse} from "axios";
import {ChatRoomWithMessages} from "@/models/chat/ChatRoomWithMessages";
import {NewChatRoomRequest} from "@/models/chat/NewChatRoomRequest";
import {ChatMessage} from "@/models/chat/ChatMessage";

// the chats-with-messages list is paginated on /api/v2; everything else stays on the v1 base
const V2_BASE = (process.env.NEXT_PUBLIC_API_URL ?? "/api/v1").replace("/v1", "/v2");

export const chatApi = {
    fetchChatRooms: (idOrEmail?: string): Promise<AxiosResponse<ChatRoom[]>> =>
        (request<ChatRoom[]>(`/chats/rooms/${idOrEmail ?? ''}`)),


    /**
     * Current user will be added at api if absent.
     * If chat room already exists, returns existing one
     * */
    createChatRoom: (chatRoomRequest: NewChatRoomRequest): Promise<AxiosResponse<ChatRoom>> =>
        (request<ChatRoom>(`/chats/rooms`, {method: 'POST', data: chatRoomRequest})),

    fetchRelatedUsers: (): Promise<AxiosResponse<User[]>> =>
        (request<User[]>(`/users/related`)),

    /** Uploads an already-encrypted media file; only the chat's participants can download it. */
    uploadChatFile: (chatId: string, encryptedFile: Blob): Promise<AxiosResponse<{ fileId: string }>> => {
        const formData = new FormData();
        formData.set("file", encryptedFile, "blob");
        return request<{ fileId: string }>(`/chats/rooms/${chatId}/files`, {method: 'POST', data: formData});
    },

    downloadChatFile: (chatId: string, fileId: string): Promise<AxiosResponse<ArrayBuffer>> =>
        (request<ArrayBuffer>(`/chats/rooms/${chatId}/files/${fileId}`, {responseType: 'arraybuffer'})),

    fetchChats: (userId?: string): Promise<AxiosResponse<ChatRoomWithMessages[]>> =>
        (request<ChatRoomWithMessages[]>(`/chats/${userId ?? ''}`)),

    /** One page of chat rooms with their messages, newest conversation first. The urgent payload for the chat list. */
    fetchChatsPaged: (page: number, size: number, userId?: string): Promise<AxiosResponse<ChatRoomWithMessages[]>> =>
        (request<ChatRoomWithMessages[]>(`/chats/${userId ?? ''}`, {baseURL: V2_BASE, params: {page, size}})),

    /** Messages of a single chat (encrypted); used to reload just the open chat after a reconnect. */
    fetchChatMessages: (chatId: string): Promise<AxiosResponse<ChatMessage[]>> =>
        (request<ChatMessage[]>(`/chats/rooms/${chatId}/messages`)),

    countNewMessages: (chatId: string): Promise<AxiosResponse<{ count: number }>> =>
        (request<{ count: number }>(`/chats/rooms/${chatId}/messages/count`)),
    getChatParticipantKeys: (chatId: string): Promise<AxiosResponse<Record<string, string>>> =>
        (request<Record<string, string>>(`/chats/rooms/${chatId}/keys`)),

    /** Unread count for every room the user is in, keyed by chatId. One request instead of one per chat. */
    fetchUnreadCounts: (): Promise<AxiosResponse<Record<string, number>>> =>
        (request<Record<string, number>>(`/chats/rooms/unread-counts`)),
    /** Participant public keys for every room the user is in, keyed by chatId. One request instead of one per chat. */
    fetchAllChatKeys: (): Promise<AxiosResponse<Record<string, Record<string, string>>>> =>
        (request<Record<string, Record<string, string>>>(`/chats/rooms/keys`)),
};
