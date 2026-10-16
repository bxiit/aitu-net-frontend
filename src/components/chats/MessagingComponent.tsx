"use client";

import {useChat} from "@/hooks/useChat";
import {CallProvider} from "@/context/CallProvider";
import {ChatRoomsComponent} from "@/components/chats/ChatRoomsComponent";
import {ChatWindowComponent} from "@/components/chats/ChatWindowComponent";
import {MessageType} from "@/models/chat/ChatMessage";
import {useIsMobile} from "@/hooks/useIsMobile";
import {Loading} from "@/components/Loading";

export default function MessagingComponent() {
    const {chatRooms, chatRoomMessages, currentChatId, stompClientRef, newMessagesCount, selectChat, sendMessage, connectionEpoch} = useChat()
    const isMobile = useIsMobile()

    // name an incoming caller from the people in the user's chats
    const resolveName = (userId: string): string => {
        for (const room of chatRooms.values()) {
            const participant = room.participants.find(p => p.id === userId)
            if (participant) return participant.username || participant.email || "Unknown"
        }
        return "Unknown"
    }

    if (!stompClientRef.current)
        return (
            <Loading/>
        )

    const handleSendMessage = async (messageText: string, messageType: MessageType = MessageType.MESSAGE_TEXT) => {
        if (!messageText.trim()) return
        if (!currentChatId) return

        console.log(`📤 Sending message to chat: ${currentChatId}`)

        try {
            await sendMessage(currentChatId, messageText, messageType)
        } catch (error) {
            console.error('❌ Failed to send message:', error)
        }
    }

    return (
        <CallProvider stompClient={stompClientRef.current} connectionEpoch={connectionEpoch} resolveName={resolveName}>
        <div
            className="bg-white dark:bg-gray-900 shadow rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 h-[calc(100vh-9.5rem)]">
            <div className="flex h-full flex-col md:flex-row">
                {isMobile ? ((!currentChatId || !chatRooms.has(currentChatId)) && (
                    <div className="flex flex-1">
                        <ChatRoomsComponent chatRooms={chatRooms} selectChat={selectChat} newMessagesCount={newMessagesCount}/>
                    </div>
                )) : (
                    <div className="md:flex">
                        <ChatRoomsComponent chatRooms={chatRooms} selectChat={selectChat} newMessagesCount={newMessagesCount}/>
                    </div>
                )}

                {/* Chat Window */}
                {currentChatId && chatRooms.has(currentChatId) && (
                    <div className="flex flex-1">
                        <ChatWindowComponent
                            chatMessages={chatRoomMessages.get(currentChatId) || []}
                            chatRoom={chatRooms.get(currentChatId)!}
                            stompClientRef={stompClientRef}
                            handleSendMessage={handleSendMessage}
                            selectChat={selectChat}
                            currentChatId={currentChatId}
                            connectionEpoch={connectionEpoch}
                        />
                    </div>
                )}
            </div>
        </div>
        </CallProvider>
    )
}
