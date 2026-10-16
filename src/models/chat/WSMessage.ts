import {ChatMessage} from "@/models/chat/ChatMessage";
import {ChatRoom} from "@/models/chat/ChatRoom";

export type WSMessage = |
    {
        type: WSMessageType.CHAT_MESSAGE;
        message: ChatMessage
    }
    |
    {
        type: WSMessageType.CHAT_ROOM;
        message: ChatRoom
    }
    |
    {
        // readerId read messageIds in chatId: the sender's ticks turn double, or (readerId = me) another of
        // my sessions read the chat
        type: WSMessageType.MESSAGES_READ;
        message: { chatId: string; readerId: string; messageIds: string[] }
    }

export enum WSMessageType {
    CHAT_MESSAGE = "CHAT_MESSAGE",
    CHAT_ROOM = "CHAT_ROOM",
    MESSAGES_READ = "MESSAGES_READ"
}