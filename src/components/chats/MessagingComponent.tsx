"use client";

import {useChat} from "@/hooks/useChat";
import {ChatRoomsComponent} from "@/components/chats/ChatRoomsComponent";
import {ChatWindowComponent} from "@/components/chats/ChatWindowComponent";
import {MessageType} from "@/models/chat/ChatMessage";
import {useIsMobile} from "@/hooks/useIsMobile";
import {Loading} from "@/components/Loading";

export default function MessagingComponent() {
    const {chatRooms, chatRoomMessages, currentChatId, connected, newMessagesCount, selectChat, sendMessage, loadMoreChats, hasMoreChats} = useChat()
    const isMobile = useIsMobile()

    if (!connected)
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
        <div
            className="bg-white dark:bg-gray-900 shadow rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 h-[calc(100vh-9.5rem)]">
            <div className="flex h-full flex-col md:flex-row">
                {isMobile ? ((!currentChatId || !chatRooms.has(currentChatId)) && (
                    <div className="flex flex-1">
                        <ChatRoomsComponent chatRooms={chatRooms} selectChat={selectChat} newMessagesCount={newMessagesCount} selectedChatId={currentChatId} loadMoreChats={loadMoreChats} hasMoreChats={hasMoreChats}/>
                    </div>
                )) : (
                    <div className="md:flex">
                        <ChatRoomsComponent chatRooms={chatRooms} selectChat={selectChat} newMessagesCount={newMessagesCount} selectedChatId={currentChatId} loadMoreChats={loadMoreChats} hasMoreChats={hasMoreChats}/>
                    </div>
                )}

                {/* Chat Window */}
                {currentChatId && chatRooms.has(currentChatId) && (
                    <div className="flex flex-1">
                        <ChatWindowComponent
                            chatMessages={chatRoomMessages.get(currentChatId) || []}
                            chatRoom={chatRooms.get(currentChatId)!}
                            handleSendMessage={handleSendMessage}
                            selectChat={selectChat}
                            currentChatId={currentChatId}
                        />
                    </div>
                )}
            </div>
        </div>
    )
}
