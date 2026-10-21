import { useEffect, useRef, useState } from "react";
import { ChatMessage, ChatMessageStatus, DecryptedMessage, MessageType } from "@/models/chat/ChatMessage";
import { Message } from "@stomp/stompjs";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthProvider";
import { api } from "@/lib";
import { ChatRoom } from "@/models/chat/ChatRoom";
import { ChatRoomWithMessages } from "@/models/chat/ChatRoomWithMessages";
import { WSMessage, WSMessageType } from "@/models/chat/WSMessage";
import { getStrategy, StrategyDeps } from "@/strategies/chat/registry";
import { E2EEncryptionService } from "@/service/E2EEncryptionService";
import { useStomp } from "@/context/StompProvider";

// how many chat rooms (with their messages) to load per page. The first page is what renders urgently.
const CHAT_PAGE_SIZE = 20

export function useChat() {
    const { user } = useAuth()
    const searchParams = useSearchParams()
    const { client, connected, connectionEpoch } = useStomp()

    const [chatRooms, setChatRooms] = useState<Map<string, ChatRoom>>(new Map())
    const [chatRoomMessages, setChatRoomMessages] = useState<Map<string, DecryptedMessage[]>>(new Map())
    const [currentChatId, setCurrentChatId] = useState<string>("")

    const [participantKeys, setParticipantKeys] = useState<Map<string, Record<string, string>>>(new Map())

    const [newMessagesCount, setNewMessagesCount] = useState<Map<string, number>>(new Map())

    // chat-list pagination: page 0 loads urgently, later pages append on demand
    const [hasMoreChats, setHasMoreChats] = useState(false)
    const chatPageRef = useRef(0)
    const hasMoreChatsRef = useRef(false)
    const loadingMoreRef = useRef(false)

    // onConnected/onMessageReceived are registered once per WebSocket connection, so they would keep the
    // state from that render forever; they read current state through these refs instead.
    const chatRoomsRef = useRef(chatRooms)
    const participantKeysRef = useRef(participantKeys)
    const currentChatIdRef = useRef(currentChatId)
    useEffect(() => { chatRoomsRef.current = chatRooms }, [chatRooms])
    useEffect(() => { participantKeysRef.current = participantKeys }, [participantKeys])
    useEffect(() => { currentChatIdRef.current = currentChatId }, [currentChatId])

    const encryptionService = E2EEncryptionService.getInstance()

    // true once the first connect has loaded everything; later connects are reconnects and refresh cheaply
    const hasInitializedRef = useRef(false)

    // the connection is owned by StompProvider; react to it here. Runs on connect and on every reconnect
    // (connectionEpoch bumps), re-subscribing on the new session.
    useEffect(() => {
        if (!client || !connected || !user) return

        encryptionService.initialize()
        const subscription = client.subscribe('/user/queue/messages', onMessageReceived)
        void onConnected()

        return () => {
            try {
                subscription.unsubscribe()
            } catch {
                // the connection may already be gone on teardown
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [client, connected, connectionEpoch, user?.id])

    // Unread counts come from the server once per room; after that they're kept up to date locally
    // (incremented in onMessageReceived, reset by markChatAsRead and MESSAGES_READ).
    const countedRoomsRef = useRef<Set<string>>(new Set())
    // One request per chat's keys, shared by concurrent callers (history load, selectChat, sendMessage)
    const keyRequestsRef = useRef<Map<string, Promise<Record<string, string>>>>(new Map())

    useEffect(() => {
        const uncounted = [...chatRooms.keys()].filter(chatId => !countedRoomsRef.current.has(chatId))
        if (uncounted.length === 0) return
        uncounted.forEach(chatId => countedRoomsRef.current.add(chatId))

        // One request for every uncounted chat's badge instead of one count call per chat. The endpoint returns
        // every room's unread count; rooms with none are absent, so default those to 0.
        api.chat.fetchUnreadCounts()
            .then(response => {
                const counts = response.data
                setNewMessagesCount(prev => {
                    const newState = new Map(prev)
                    uncounted.forEach(chatId => newState.set(chatId, counts[chatId] ?? 0))
                    return newState
                })
            })
            .catch(error => {
                console.error('Failed to load unread counts:', error)
                // let a later render retry the ones we couldn't load
                uncounted.forEach(chatId => countedRoomsRef.current.delete(chatId))
            })
    }, [chatRooms])

    const onConnected = async () => {
        if (!user) return
        console.log("🔌 Connected to WebSocket")

        if (!hasInitializedRef.current) {
            hasInitializedRef.current = true

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
            return
        }

        // Reconnect: don't reload and re-decrypt every chat's history. Refresh the room list and unread counts
        // (cheap, and catches messages missed while offline), and reload only the chat currently open.
        console.log("♻️ Reconnected, refreshing")
        countedRoomsRef.current.clear()
        await fetchAndSetChatRooms(user.id)
        const openChat = currentChatIdRef.current
        if (openChat) {
            await reloadChatMessages(openChat)
        }
    }

    const reloadChatMessages = async (chatId: string) => {
        try {
            if (!participantKeysRef.current.has(chatId)) {
                await loadChatParticipantKeys(chatId)
            }
            const encrypted = (await api.chat.fetchChatMessages(chatId)).data
            const decrypted: DecryptedMessage[] = []
            for (const message of encrypted) {
                try {
                    decrypted.push(await decryptReceivedMessage(message))
                } catch (error) {
                    console.error('Failed to decrypt message on reload:', error)
                }
            }
            setChatRoomMessages(prev => {
                const newMessages = new Map(prev)
                newMessages.set(chatId, decrypted)
                return newMessages
            })
        } catch (error) {
            console.error('Failed to reload chat messages:', error)
        }
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
                if (isOpenAndVisible(encryptedMessage.chatId)) {
                    // arrived in the chat being looked at: it's read right away
                    markChatAsRead(encryptedMessage.chatId)
                } else {
                    setNewMessagesCount(prev => {
                        const newState = new Map(prev)
                        newState.set(encryptedMessage.chatId, (newState.get(encryptedMessage.chatId) ?? 0) + 1)
                        return newState
                    })
                }
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
        } else if (messageObject.type === WSMessageType.MESSAGES_READ) {
            const { chatId, readerId, messageIds } = messageObject.message
            if (readerId === user?.id) {
                // read in another tab or device
                setUnreadCount(chatId, 0)
            } else {
                const read = new Set(messageIds)
                setChatRoomMessages(prev => {
                    const messages = prev.get(chatId)
                    if (!messages) return prev
                    const newMessages = new Map(prev)
                    newMessages.set(chatId, messages.map(m =>
                        read.has(m.id) ? { ...m, status: ChatMessageStatus.RECEIVED } : m))
                    return newMessages
                })
            }
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
            client?.publish({
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

    const decryptChatMessages = async (chat: ChatRoomWithMessages): Promise<DecryptedMessage[]> => {
        const decrypted: DecryptedMessage[] = []
        for (const encryptedMessage of chat.messages) {
            try {
                decrypted.push(await decryptReceivedMessage(encryptedMessage))
            } catch (error) {
                console.error('Failed to decrypt historical message:', error)
            }
        }
        return decrypted
    }

    // Loads the first page of chat rooms with messages and renders it urgently: the room list is shown as soon as
    // the page arrives, messages decrypt right after, and the "other things" (participant keys, unread counts)
    // load asynchronously without blocking any of that.
    const fetchAndSetChats = async (userId?: string): Promise<Map<string, ChatRoom>> => {
        try {
            const chats: ChatRoomWithMessages[] = (await api.chat.fetchChatsPaged(0, CHAT_PAGE_SIZE, userId)).data
            const rooms = new Map(chats.map(chat => [chat.chatRoom.chatId, chat.chatRoom]))

            // render the room list right away, before decrypting anything
            setChatRooms(rooms)
            chatPageRef.current = 1
            hasMoreChatsRef.current = chats.length === CHAT_PAGE_SIZE
            setHasMoreChats(hasMoreChatsRef.current)

            // keys (for sending) load in the background in one request, concurrently with decryption below;
            // unread counts load via the effect that reacts to chatRooms. Neither blocks the chat list.
            void preloadAllParticipantKeys()

            const decryptedMessagesMap = new Map<string, DecryptedMessage[]>()
            for (const chat of chats) {
                decryptedMessagesMap.set(chat.chatRoom.chatId, await decryptChatMessages(chat))
            }
            setChatRoomMessages(decryptedMessagesMap)

            return rooms
        } catch (error) {
            console.error('Failed to fetch chats:', error)
            return new Map()
        }
    }

    // Appends the next page of chats. Keys were already warmed for every room by the initial bulk preload, and the
    // unread-count effect reacts to the growing room list, so loading more only needs the rooms and their messages.
    const loadMoreChats = async () => {
        if (loadingMoreRef.current || !hasMoreChatsRef.current || !user) return
        loadingMoreRef.current = true
        try {
            const page = chatPageRef.current
            const chats: ChatRoomWithMessages[] = (await api.chat.fetchChatsPaged(page, CHAT_PAGE_SIZE, user.id)).data
            if (chats.length > 0) {
                setChatRooms(prev => {
                    const next = new Map(prev)
                    for (const chat of chats) if (!next.has(chat.chatRoom.chatId)) next.set(chat.chatRoom.chatId, chat.chatRoom)
                    return next
                })
                const decryptedByChat = new Map<string, DecryptedMessage[]>()
                for (const chat of chats) decryptedByChat.set(chat.chatRoom.chatId, await decryptChatMessages(chat))
                setChatRoomMessages(prev => {
                    const next = new Map(prev)
                    for (const [chatId, messages] of decryptedByChat) if (!next.has(chatId)) next.set(chatId, messages)
                    return next
                })
                chatPageRef.current = page + 1
            }
            hasMoreChatsRef.current = chats.length === CHAT_PAGE_SIZE
            setHasMoreChats(hasMoreChatsRef.current)
        } catch (error) {
            console.error('Failed to load more chats:', error)
        } finally {
            loadingMoreRef.current = false
        }
    }

    // Warms every chat's participant keys in a single request instead of one /keys call per chat. Keys are only
    // needed to *send* (decryption uses the reader's own private key), so this just primes the cache; a room
    // whose participant has no key yet is omitted and loaded lazily (surfacing the 409) when first used.
    const preloadAllParticipantKeys = async () => {
        try {
            const allKeys = (await api.chat.fetchAllChatKeys()).data
            const entries = Object.entries(allKeys)
            if (entries.length === 0) return
            setParticipantKeys(prev => {
                const next = new Map(prev)
                for (const [chatId, keys] of entries) next.set(chatId, keys)
                return next
            })
            // keep the ref and the in-flight-request cache in sync now, so callers this tick skip the per-chat fetch
            for (const [chatId, keys] of entries) {
                participantKeysRef.current.set(chatId, keys)
                keyRequestsRef.current.set(chatId, Promise.resolve(keys))
            }
        } catch (error) {
            console.error('Failed to bulk-load participant keys:', error)
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
        currentChatIdRef.current = chatId
        markChatAsRead(chatId)

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

    const setUnreadCount = (chatId: string, count: number) => {
        setNewMessagesCount(prev => {
            if ((prev.get(chatId) ?? 0) === count) return prev
            const newState = new Map(prev)
            newState.set(chatId, count)
            return newState
        })
    }

    const isOpenAndVisible = (chatId: string) =>
        currentChatIdRef.current === chatId && document.visibilityState === 'visible'

    // A chat counts as read while it's open and the page is visible: on opening it, when a message arrives
    // in it, and when the user comes back to the tab. The server marks all of it read for this user only.
    const markChatAsRead = (chatId: string) => {
        if (!chatId || document.visibilityState !== 'visible') return
        setUnreadCount(chatId, 0)
        if (client?.connected) {
            client.publish({
                destination: '/app/chat/read',
                body: JSON.stringify({ chatId })
            })
        }
    }

    useEffect(() => {
        const onVisible = () => {
            if (document.visibilityState === 'visible' && currentChatIdRef.current) {
                markChatAsRead(currentChatIdRef.current)
            }
        }
        document.addEventListener('visibilitychange', onVisible)
        return () => document.removeEventListener('visibilitychange', onVisible)
    }, [])

    return {
        chatRooms,
        chatRoomMessages,
        currentChatId,
        newMessagesCount,

        selectChat,
        sendMessage,
        connected,

        loadMoreChats,
        hasMoreChats,
    }
}