import { useEffect, useRef, useState } from "react";
import { ChatMessage, DecryptedMessage, MessageType } from "@/models/chat/ChatMessage";
import { Client, Message } from "@stomp/stompjs";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthProvider";
import { api } from "@/lib";
import SockJS from "sockjs-client";
import { ChatRoom } from "@/models/chat/ChatRoom";
import { ChatRoomWithMessages } from "@/models/chat/ChatRoomWithMessages";
import { WSMessage, WSMessageType } from "@/models/chat/WSMessage";
import { getStrategy, StrategyDeps } from "@/strategies/chat/registry";
import { E2EEncryptionService } from "@/service/E2EEncryptionService";

export function useChat() {
    const { user } = useAuth()
    const searchParams = useSearchParams()
    const stompClientRef = useRef<Client | null>(null)

    const [chatRooms, setChatRooms] = useState<Map<string, ChatRoom>>(new Map())
    const [chatRoomMessages, setChatRoomMessages] = useState<Map<string, DecryptedMessage[]>>(new Map())
    const [currentChatId, setCurrentChatId] = useState<string>("")

    const [participantKeys, setParticipantKeys] = useState<Map<string, Record<string, string>>>(new Map())

    const timeoutRef = useRef<NodeJS.Timeout>(null)
    const readMessagesRef = useRef<Map<string, DecryptedMessage>>(new Map())
    const [newMessagesCount, setNewMessagesCount] = useState<Map<string, number>>(new Map())

    // onConnected/onMessageReceived are registered once per WebSocket connection, so they would keep the
    // state from that render forever; they read current state through these refs instead.
    const chatRoomsRef = useRef(chatRooms)
    const participantKeysRef = useRef(participantKeys)
    useEffect(() => { chatRoomsRef.current = chatRooms }, [chatRooms])
    useEffect(() => { participantKeysRef.current = participantKeys }, [participantKeys])

    const SOCKET_URL: string = process.env.NEXT_PUBLIC_WEBSOCKET_URL || "defaultWebSocketUrl"
    const encryptionService = E2EEncryptionService.getInstance()

    useEffect(() => {
        if (!user) return

        encryptionService.initialize()

        const stompClient = new Client({
            webSocketFactory: () => new SockJS(SOCKET_URL),
            debug: console.log,
            onConnect: onConnected,
            onStompError: (frame) => console.error(`STOMP Error: ${frame.body}`),
        })

        stompClient.activate()
        stompClientRef.current = stompClient

        return () => {
            markBufferedMessagesAsRead()
            stompClient.deactivate()
                .catch(console.log)
        }
    }, [user])

    // Unread counts come from the server once per room; after that they're kept up to date locally
    // (incremented in onMessageReceived, decremented in markMessageAsRead).
    const countedRoomsRef = useRef<Set<string>>(new Set())
    // One request per chat's keys, shared by concurrent callers (history load, selectChat, sendMessage)
    const keyRequestsRef = useRef<Map<string, Promise<Record<string, string>>>>(new Map())

    useEffect(() => {
        const uncounted = [...chatRooms.keys()].filter(chatId => !countedRoomsRef.current.has(chatId))
        if (uncounted.length === 0) return
        uncounted.forEach(chatId => countedRoomsRef.current.add(chatId))

        const loadMessageCounts = async () => {
            for (const chatId of uncounted) {
                try {
                    const response = await api.chat.countNewMessages(chatId)
                    const count = response.data.count

                    setNewMessagesCount(prev => {
                        const newState = new Map(prev)
                        newState.set(chatId, count)
                        return newState
                    })
                } catch (error) {
                    console.error(`Failed to load message count for chat ${chatId}:`, error)
                }
            }
        }

        loadMessageCounts()
    }, [chatRooms])

    const onConnected = async () => {
        if (!user) return
        console.log("🔌 Connected to WebSocket")

        stompClientRef.current?.subscribe(`/user/${user.id}/queue/messages`, onMessageReceived)

        // Rooms first, so the strategy can find an existing chat instead of creating it again
        const rooms = await fetchAndSetChats(user.id)

        const deps: StrategyDeps = {
            searchParams: searchParams,
            chatRooms: rooms,
            api: api,
            pushToChatRooms: pushToChatRooms
        }

        const chatIdStrategy = getStrategy(deps)
        console.log("🎯 Chat Strategy:", chatIdStrategy.constructor.name)

        chatIdStrategy.getChatId()
            .then(chatId => {
                if (chatId) {
                    selectChat(chatId)
                }
            })
            .catch(error => {
                console.error("Strategy failed:", error)
            })
    }

    const onMessageReceived = async (message: Message) => {
        const messageObject: WSMessage = JSON.parse(message.body)

        if (messageObject.type === WSMessageType.CHAT_MESSAGE) {
            const encryptedMessage: ChatMessage = messageObject.message
            console.log('🔒 Received encrypted message for chat:', encryptedMessage.chatId)

            if (!chatRoomsRef.current.has(encryptedMessage.chatId)) {
                // a new chat: its unread count (including this message) comes from the server
                fetchAndSetChatRooms()
            } else if (encryptedMessage.senderId !== user?.id) {
                setNewMessagesCount(prev => {
                    const newState = new Map(prev)
                    newState.set(encryptedMessage.chatId, (newState.get(encryptedMessage.chatId) ?? 0) + 1)
                    return newState
                })
            }

            try {
                const decryptedMessage = await decryptReceivedMessage(encryptedMessage)
                addDecryptedMessageToChat(decryptedMessage)

                console.log('✅ Message decrypted successfully')
            } catch (error) {
                console.error('❌ Failed to decrypt message:', error)
            }
        } else if (messageObject.type === WSMessageType.CHAT_ROOM) {
            const chatRoom: ChatRoom = messageObject.message
            console.log("📁 New chat room created:", chatRoom.chatId)

            pushToChatRooms(chatRoom)
            await loadChatParticipantKeys(chatRoom.chatId)
        }
    }

    const sendMessage = async (
        chatId: string,
        messageText: string,
        type: MessageType = MessageType.MESSAGE_TEXT
    ): Promise<void> => {
        if (!user) {
            throw new Error('User not authenticated')
        }
        if (!messageText.trim()) {
            console.warn('Empty message text, skipping send')
            return
        }
        console.log('📤 Sending message to chat:', chatId)
        try {
            let keys = participantKeysRef.current.get(chatId)
            if (!keys) {
                console.log('🔑 Loading participant keys...')
                keys = await loadChatParticipantKeys(chatId)
            }
            console.log('🔒 Encrypting message...')
            const { encryptedContent, encryptedKeys } = await encryptionService.encryptMessage(messageText, keys)
            const chatMessage: ChatMessage = {
                chatId,
                senderId: user.id,
                encryptedContent,
                encryptedKeys,
                type,
                length: messageText.length
            }
            stompClientRef.current?.publish({
                destination: '/app/chat',
                body: JSON.stringify(chatMessage)
            })
            console.log('✅ Encrypted message sent')
        } catch (error) {
            console.error('❌ Failed to send encrypted message:', error)
            throw error
        }
    }

    const decryptReceivedMessage = async (encryptedMessage: ChatMessage): Promise<DecryptedMessage> => {
        if (!user) {
            throw new Error('User not authenticated')
        }

        const decryptedContent = await encryptionService.decryptMessage(encryptedMessage, user.id)

        return {
            id: encryptedMessage.id!,
            chatId: encryptedMessage.chatId,
            senderId: encryptedMessage.senderId,
            content: decryptedContent, // ← Расшифрованный текст
            createdAt: encryptedMessage.createdAt!,
            status: encryptedMessage.status!,
            type: encryptedMessage.type
        }
    }

    const fetchAndSetChatRooms = async (userId?: string) => {
        try {
            const response = await api.chat.fetchChatRooms(userId)
            const rooms = response.data

            console.log('📁 Loaded', rooms.length, 'chat rooms')
            setChatRooms(new Map(rooms.map(room => [room.chatId, room])))
        } catch (error) {
            console.error('Failed to fetch chat rooms:', error)
        }
    }

    const fetchAndSetChats = async (userId?: string): Promise<Map<string, ChatRoom>> => {
        try {
            console.log('Logging before fetch userId', userId)
            const response = await api.chat.fetchChats(userId)
            const chats: ChatRoomWithMessages[] = response.data
            console.log('chats logging', chats)
            console.log('💬 Loading', chats.length, 'chats with messages')

            const rooms = new Map(chats.map(chat => [chat.chatRoom.chatId, chat.chatRoom]))
            const decryptedMessagesMap = new Map<string, DecryptedMessage[]>()

            for (const chat of chats) {
                const decryptedMessages: DecryptedMessage[] = []

                if (!participantKeysRef.current.has(chat.chatRoom.chatId)) {
                    await loadChatParticipantKeys(chat.chatRoom.chatId)
                }

                for (const encryptedMessage of chat.messages) {
                    try {
                        const decryptedMessage = await decryptReceivedMessage(encryptedMessage)
                        decryptedMessages.push(decryptedMessage)
                    } catch (error) {
                        console.error('Failed to decrypt historical message:', error)
                    }
                }

                decryptedMessagesMap.set(chat.chatRoom.chatId, decryptedMessages)
            }

            setChatRooms(rooms)
            setChatRoomMessages(decryptedMessagesMap)

            console.log('✅ All messages decrypted and loaded')
            return rooms
        } catch (error) {
            console.error('Failed to fetch chats:', error)
            return new Map()
        }
    }

    const loadChatParticipantKeys = (chatId: string): Promise<Record<string, string>> => {
        const existing = keyRequestsRef.current.get(chatId)
        if (existing) return existing

        console.log('🔑 Loading keys for chat:', chatId)
        const request = api.chat.getChatParticipantKeys(chatId)
            .then(response => {
                const keys = response.data
                setParticipantKeys(prev => {
                    const newKeys = new Map(prev)
                    newKeys.set(chatId, keys)
                    return newKeys
                })
                console.log('✅ Keys loaded for', Object.keys(keys).length, 'participants')
                return keys
            })
            .catch(error => {
                // allow a retry, e.g. once a participant without keys has logged in and set them up
                keyRequestsRef.current.delete(chatId)
                console.error('❌ Failed to load participant keys:', error)
                throw error
            })
        keyRequestsRef.current.set(chatId, request)
        return request
    }

    const selectChat = async (chatId: string) => {
        console.log('🎯 Selecting chat:', chatId)

        if (!chatId) {
            setCurrentChatId("")
            return
        }

        setCurrentChatId(chatId)

        if (!participantKeysRef.current.has(chatId)) {
            console.log('🔑 Loading participant keys...')
            await loadChatParticipantKeys(chatId)
        }
        console.log(chatRoomMessages)
        const messages = chatRoomMessages.get(chatId)
        console.log(`💬 Chat ${chatId} has ${messages?.length || 0} messages`)
    }

    const pushToChatRooms = (chatRoom: ChatRoom) => {
        setChatRooms(prevChatRooms => {
            const newChatRooms = new Map(prevChatRooms)
            newChatRooms.set(chatRoom.chatId, chatRoom)
            return newChatRooms
        })
    }

    const addDecryptedMessageToChat = (message: DecryptedMessage) => {
        setChatRoomMessages(prev => {
            const newMessages = new Map(prev)
            const currentMessages = newMessages.get(message.chatId) ?? []
            newMessages.set(message.chatId, [...currentMessages, message])
            return newMessages
        })
    }

    const markMessageAsRead = async (message: DecryptedMessage): Promise<void> => {
        readMessagesRef.current.set(message.id, message)

        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current)
        }

        timeoutRef.current = setTimeout(() => {
            const messageIds = Array.from(readMessagesRef.current.keys())

            stompClientRef.current?.publish({
                destination: '/app/chat/message/status',
                body: JSON.stringify({ messageIds })
            })

            readMessagesRef.current.clear()
        }, 3000)

        setNewMessagesCount(prev => {
            const newState = new Map(prev)
            const currentCount = newState.get(message.chatId)
            if (currentCount && currentCount > 0) {
                newState.set(message.chatId, currentCount - 1)
            }
            return newState
        })
    }

    const markBufferedMessagesAsRead = () => {
        if (readMessagesRef.current.size > 0) {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current)
            }

            const messageIds = Array.from(readMessagesRef.current.keys())
            stompClientRef.current?.publish({
                destination: '/app/chat/message/status',
                body: JSON.stringify({ messageIds })
            })

            readMessagesRef.current.clear()
        }
    }

    return {
        chatRooms,
        chatRoomMessages,
        currentChatId,
        newMessagesCount,

        selectChat,
        sendMessage,
        markMessageAsRead,

        stompClientRef
    }
}