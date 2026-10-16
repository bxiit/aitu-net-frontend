"use client";

import React, { RefObject, useEffect, useRef, useState } from "react";
import { DecryptedMessage, MessageType, ChatMessageStatus } from "@/models/chat/ChatMessage";
import { InputMessageBarComponent } from "@/components/chats/InputMessageBarComponent";
import { ChatRoom, ChatRoomType } from "@/models/chat/ChatRoom";
import { useAuth } from "@/context/AuthProvider";
import { useIsMobile } from "@/hooks/useIsMobile";
import { Loading } from "@/components/Loading";
import { Client, Message } from "@stomp/stompjs";
import AudioCall from "@/components/chats/messages/AudioCallComponent";
import { EncryptedMediaPlayer } from "@/components/chats/messages/EncryptedMediaPlayer";
import { ChatRoomDetails } from "@/components/chats/ChatRoomDetails";
import { defaultPfp } from "../../../public/modules/defaultPfp";
import {
    ArrowLeft,
    MessageCircle,
    MoreVertical,
    Sparkles,
    Users,
    Video,
    Wifi,
    WifiOff,
    Shield,
    Lock,
    Key,
    Check,
    CheckCheck,
    Clock
} from "lucide-react";

// ===== ЧИСТЫЙ E2E ИНТЕРФЕЙС =====
interface ChatWindowComponentProps {
    chatMessages: DecryptedMessage[];
    chatRoom: ChatRoom;
    stompClientRef: RefObject<Client | null>;
    currentChatId: string;
    selectChat: (chatId: string) => Promise<void>;
    handleSendMessage: (messageText: string, messageType?: MessageType) => Promise<void>;
}


interface MessageProps {
    message: DecryptedMessage;
    isOwn: boolean;
}

// Утилита для безопасного форматирования времени
const formatMessageTime = (createdAt: Date | string): string => {
    try {
        const date = createdAt instanceof Date ? createdAt : new Date(createdAt);

        // Проверяем что дата валидна
        if (isNaN(date.getTime())) {
            return 'Invalid date';
        }

        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (error) {
        console.error('Error formatting message time:', error);
        return 'Time error';
    }
};

// Текстовое сообщение
const TextMessage: React.FC<MessageProps> = ({ message, isOwn }) => {
    return (
        <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'} mb-3`}>
            <div
                className={`max-w-xs lg:max-w-md px-4 py-2 rounded-2xl relative group transition-all duration-200 hover:shadow-lg ${
                    isOwn
                        ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white'
                        : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white'
                }`}
            >
                {/* E2E Badge */}
                <div className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <Lock size={8} className="text-white" />
                </div>

                {/* Message Content */}
                <p className="text-sm whitespace-pre-wrap break-words">
                    {message.content}
                </p>

                {/* Message Footer */}
                <div className={`flex items-center justify-end mt-1 space-x-1 text-xs ${
                    isOwn ? 'text-blue-100' : 'text-gray-500 dark:text-gray-400'
                }`}>
                    <span>{formatMessageTime(message.createdAt)}</span>
                    {isOwn && (
                        <div className="ml-1">
                            {message.status === ChatMessageStatus.DELIVERED && (
                                <Check size={12} className="text-blue-200" />
                            )}
                            {message.status === ChatMessageStatus.RECEIVED && (
                                <CheckCheck size={12} className="text-green-300" />
                            )}
                            {!message.status && (
                                <Clock size={12} className="text-blue-200 animate-pulse" />
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// Голосовое / видео сообщение: the content is an encrypted-file reference, played by EncryptedMediaPlayer
const MediaMessage: React.FC<MessageProps & { kind: "audio" | "video" }> = ({ message, isOwn, kind }) => {
    const footer = (onBubble: boolean) => (
        <div className={`flex items-center justify-end mt-1 space-x-1 text-xs ${
            onBubble && isOwn ? 'text-blue-100' : 'text-gray-500 dark:text-gray-400'
        }`}>
            <Lock size={10} />
            <span>{formatMessageTime(message.createdAt)}</span>
            {isOwn && message.status === ChatMessageStatus.DELIVERED && <Check size={12} />}
            {isOwn && message.status === ChatMessageStatus.RECEIVED && <CheckCheck size={12} className="text-green-500" />}
        </div>
    );

    // video notes stand on their own, without a bubble
    if (kind === "video") {
        return (
            <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'} mb-3`}>
                <div className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'}`}>
                    <EncryptedMediaPlayer chatId={message.chatId} content={message.content} kind="video" own={isOwn} />
                    {footer(false)}
                </div>
            </div>
        );
    }

    return (
        <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'} mb-3`}>
            <div
                className={`max-w-xs lg:max-w-md px-3 py-2.5 rounded-2xl relative transition-all duration-200 hover:shadow-lg ${
                    isOwn
                        ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-br-md'
                        : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white rounded-bl-md'
                }`}
            >
                <EncryptedMediaPlayer chatId={message.chatId} content={message.content} kind="audio" own={isOwn} />
                {footer(true)}
            </div>
        </div>
    );
};

const AudioMessage: React.FC<MessageProps> = (props) => <MediaMessage {...props} kind="audio" />;

const VideoMessage: React.FC<MessageProps> = (props) => <MediaMessage {...props} kind="video" />;

const SystemMessage: React.FC<MessageProps> = ({ message }) => {
    return (
        <div className="flex justify-center mb-3">
            <div className="px-3 py-1 bg-gray-100 dark:bg-gray-800 rounded-full text-xs text-gray-500 dark:text-gray-400 flex items-center space-x-1">
                <Users size={12} />
                <span>{message.content}</span>
            </div>
        </div>
    );
};

// ===== ПОЛНЫЙ РЕНДЕРЕР СООБЩЕНИЙ E2E =====
const E2EMessageRenderer = (currentUserId: string) => {
    const createMessageProps = (message: DecryptedMessage): MessageProps => ({
        message,
        isOwn: message.senderId === currentUserId
    });

    return {
        [MessageType.MESSAGE_TEXT]: (message: DecryptedMessage) => (
            <TextMessage {...createMessageProps(message)} />
        ),
        [MessageType.MESSAGE_AUDIO]: (message: DecryptedMessage) => (
            <AudioMessage {...createMessageProps(message)} />
        ),
        [MessageType.MESSAGE_VIDEO]: (message: DecryptedMessage) => (
            <VideoMessage {...createMessageProps(message)} />
        ),
        [MessageType.JOIN]: (message: DecryptedMessage) => (
            <SystemMessage {...createMessageProps(message)} />
        ),
        [MessageType.LEAVE]: (message: DecryptedMessage) => (
            <SystemMessage {...createMessageProps(message)} />
        ),
    } as const;
};

// ===== ГЛАВНЫЙ КОМПОНЕНТ =====
type ConnectionStatus = "OFFLINE" | "ONLINE";

interface StatusMessage {
    status: ConnectionStatus;
}

export const ChatWindowComponent = ({
                                        chatRoom,
                                        chatMessages,
                                        stompClientRef,
                                        currentChatId,
                                        handleSendMessage,
                                        selectChat
                                    }: ChatWindowComponentProps) => {
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const { user } = useAuth();
    const isMobile = useIsMobile();
    const [chatDetailsOpen, setChatDetailsOpen] = useState<boolean>(false);
    const [connStatus, setConnStatus] = useState<ConnectionStatus | undefined>(undefined);
    const [isScrolledUp, setIsScrolledUp] = useState(false);
    const [isEncrypting, setIsEncrypting] = useState(false);
    const messagesContainerRef = useRef<HTMLDivElement>(null);

    // E2E Message Renderer
    const messageRenderer = E2EMessageRenderer(user?.id || '');

    if (!user) {
        return <Loading />;
    }

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({
            behavior: "smooth",
            inline: "nearest",
            block: "end"
        });
    };

    const handleScroll = () => {
        if (messagesContainerRef.current) {
            const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
            const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
            setIsScrolledUp(!isNearBottom);
        }
    };

    useEffect(() => {
        if (!currentChatId) return;

        let destination: string;
        if (chatRoom.chatRoomType === ChatRoomType.ONE_TO_ONE) {
            const companion = chatRoom.participants.find(participant => participant.id !== user.id);
            if (!companion) {
                throw new Error("Companion not present in one to one chat room");
            }

            setConnStatus(companion.connected ? "ONLINE" : "OFFLINE");
            destination = `/user/${companion.id}/queue/status`;
            subscribeForStatus(destination);
        }

        return () => {
            if (destination && stompClientRef.current) {
                stompClientRef.current.unsubscribe(destination);
            }
        };
    }, [currentChatId, chatRoom, user.id, stompClientRef]);

    useEffect(() => {
        scrollToBottom();
    }, [chatMessages]);

    function subscribeForStatus(destination: string) {
        stompClientRef.current?.subscribe(destination, onStatusReceived);
    }

    function onStatusReceived(message: Message) {
        const statusMessage: StatusMessage = JSON.parse(message.body);
        setConnStatus(statusMessage.status);
    }

    // Render message using E2E renderer
    function displayChatMessage(message: DecryptedMessage) {
        const renderer = messageRenderer[message.type as keyof typeof messageRenderer];
        return renderer ? renderer(message) : (
            <div className="flex justify-center mb-3">
                <div className="px-3 py-1 bg-red-100 dark:bg-red-900/30 rounded-full text-xs text-red-600 dark:text-red-400 flex items-center space-x-1">
                    <span>⚠️ Unsupported message type: {message.type}</span>
                </div>
            </div>
        );
    }

    const handleSendMessageWrapper = async (messageText: string, messageType: MessageType = MessageType.MESSAGE_TEXT) => {
        if (!messageText.trim()) return;

        try {
            setIsEncrypting(true);
            await handleSendMessage(messageText, messageType);
        } catch (error) {
            console.error('❌ Failed to send message:', error);
        } finally {
            setIsEncrypting(false);
        }
    };

    const getStatusColor = () => {
        switch (connStatus) {
            case "ONLINE":
                return "bg-green-500 shadow-green-500/50";
            case "OFFLINE":
                return "bg-gray-400 shadow-gray-400/50";
            default:
                return "bg-yellow-400 shadow-yellow-400/50 animate-pulse";
        }
    };

    const getStatusText = () => {
        switch (connStatus) {
            case "ONLINE":
                return "Online";
            case "OFFLINE":
                return "Offline";
            default:
                return "Connecting...";
        }
    };

    const getChatDisplayName = (): string => {
        if (chatRoom.title) {
            return chatRoom.title;
        }

        if (chatRoom.chatRoomType === ChatRoomType.ONE_TO_ONE) {
            const companion = chatRoom.participants.find(p => p.id !== user.id);
            return companion?.username || companion?.email || 'Unknown User';
        }

        return 'Group Chat';
    };

    const companion = chatRoom.participants.find(p => p.id !== user.id);
    const chatDisplayName = getChatDisplayName();

    return (
        <main className="flex-1 flex flex-col h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50/30 dark:from-gray-900 dark:via-gray-900 dark:to-indigo-950/30 w-full relative overflow-hidden">
            {/* Animated Background */}
            <div className="absolute inset-0 opacity-20">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-100/30 via-purple-100/30 to-pink-100/30 dark:from-blue-900/10 dark:via-purple-900/10 dark:to-pink-900/10"/>
                <div className="absolute inset-0" style={{
                    backgroundImage: `
                        radial-gradient(circle at 25% 25%, rgba(59, 130, 246, 0.1) 0%, transparent 50%),
                        radial-gradient(circle at 75% 75%, rgba(168, 85, 247, 0.1) 0%, transparent 50%),
                        radial-gradient(circle at 50% 100%, rgba(34, 197, 94, 0.1) 0%, transparent 50%)
                    `,
                    backgroundSize: '100px 100px'
                }}/>
            </div>

            {/* Mobile Back Button */}
            {isMobile && (
                <div className="p-4 bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm border-b border-gray-200/50 dark:border-gray-700/50">
                    <button
                        onClick={() => selectChat("")}
                        className="flex items-center space-x-2 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors duration-200 group"
                    >
                        <ArrowLeft size={20} className="group-hover:-translate-x-1 transition-transform duration-200"/>
                        <span className="font-medium">Back to chats</span>
                    </button>
                </div>
            )}

            {/* Chat Room Details Modal */}
            {chatDetailsOpen && (
                <ChatRoomDetails
                    chatRoom={chatRoom}
                    setIsChatDetailsOpen={setChatDetailsOpen}
                />
            )}

            {/* Header */}
            <header className="relative bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl border-b border-gray-200/50 dark:border-gray-700/50 shadow-sm">
                <div className="absolute inset-0 bg-gradient-to-r from-blue-500/5 via-purple-500/5 to-green-500/5"/>
                <div className="relative p-4 flex items-center justify-between">
                    <button
                        onClick={() => setChatDetailsOpen(true)}
                        className="flex items-center space-x-3 hover:bg-gray-100/50 dark:hover:bg-gray-800/50 rounded-xl p-2 -m-2 transition-all duration-200 group"
                    >
                        {/* Avatar with E2E Badge */}
                        <div className="relative">
                            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-100 to-purple-100 dark:from-blue-900 dark:to-purple-900 flex items-center justify-center overflow-hidden ring-2 ring-white dark:ring-gray-800 shadow-lg">
                                <img
                                    src={companion?.avatar?.location || user.avatar?.location || defaultPfp}
                                    alt="Profile"
                                    className="w-full h-full object-cover"
                                    onError={(e) => {
                                        e.currentTarget.style.display = 'none';
                                    }}
                                />
                                <Users
                                    size={20}
                                    className="text-blue-600 dark:text-blue-400"
                                    style={{display: (companion?.avatar?.location || user.avatar?.location) ? 'none' : 'block'}}
                                />
                            </div>

                            {/* Status + E2E */}
                            <div className="absolute -bottom-1 -right-1 flex items-center">
                                <div className={`w-4 h-4 rounded-full border-2 border-white dark:border-gray-900 shadow-lg ${getStatusColor()}`}>
                                    {connStatus === "ONLINE" && (
                                        <div className="absolute inset-0 rounded-full bg-green-500 animate-ping opacity-75"/>
                                    )}
                                </div>
                                <div className="w-3 h-3 bg-green-600 rounded-full border border-white dark:border-gray-900 flex items-center justify-center ml-1 shadow-sm">
                                    <Lock size={6} className="text-white" />
                                </div>
                            </div>
                        </div>

                        {/* Chat Info */}
                        <div className="flex-1 min-w-0">
                            <h2 className="text-lg font-bold text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors duration-200 truncate">
                                {chatDisplayName}
                            </h2>
                            <div className="flex items-center space-x-2">
                                {connStatus && (
                                    <>
                                        {connStatus === "ONLINE" ? (
                                            <Wifi size={12} className="text-green-500"/>
                                        ) : (
                                            <WifiOff size={12} className="text-gray-400"/>
                                        )}
                                        <p className={`text-sm font-medium ${
                                            connStatus === "ONLINE"
                                                ? "text-green-600 dark:text-green-400"
                                                : "text-gray-500 dark:text-gray-400"
                                        }`}>
                                            {getStatusText()}
                                        </p>
                                        <span className="text-gray-300 dark:text-gray-600">•</span>
                                    </>
                                )}

                                <div className="flex items-center space-x-1">
                                    <Shield size={12} className="text-green-600 dark:text-green-400" />
                                    <span className="text-sm text-green-600 dark:text-green-400 font-medium">
                                        End-to-end encrypted
                                    </span>
                                </div>
                            </div>
                        </div>
                    </button>

                    {/* Action Buttons */}
                    <div className="flex items-center space-x-2">
                        {isEncrypting && (
                            <div className="flex items-center space-x-1 px-3 py-1.5 bg-blue-100 dark:bg-blue-900/30 rounded-full">
                                <Key size={12} className="text-blue-600 dark:text-blue-400 animate-pulse" />
                                <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                                    Encrypting...
                                </span>
                            </div>
                        )}

                        {stompClientRef && stompClientRef.current && companion && (
                            <AudioCall
                                stompClient={stompClientRef.current}
                                localUserId={user.id}
                                remoteUserId={companion.id}
                            />
                        )}

                        <button className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors duration-200 group">
                            <Video size={20} className="text-gray-600 dark:text-gray-400 group-hover:text-blue-600 dark:group-hover:text-blue-400"/>
                        </button>

                        <button className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors duration-200 group">
                            <MoreVertical size={20} className="text-gray-600 dark:text-gray-400 group-hover:text-blue-600 dark:group-hover:text-blue-400"/>
                        </button>
                    </div>
                </div>
            </header>

            {/* Messages Container */}
            <div
                ref={messagesContainerRef}
                onScroll={handleScroll}
                className="flex-1 overflow-y-auto p-4 relative z-10 scroll-smooth"
                style={{
                    scrollbarWidth: 'thin',
                    scrollbarColor: 'rgba(59, 130, 246, 0.3) transparent'
                }}
            >
                {chatMessages && chatMessages.length > 0 ? (
                    <>
                        {chatMessages.map((message, index) => (
                            <div
                                key={message.id}
                                className="animate-fade-in"
                                style={{
                                    animationDelay: `${index * 50}ms`,
                                    animationFillMode: 'both'
                                }}
                            >
                                {displayChatMessage(message)}
                            </div>
                        ))}
                        <div ref={messagesEndRef}/>
                    </>
                ) : (
                    <EmptyState chatRoomTitle={chatDisplayName}/>
                )}
            </div>

            {/* Scroll to Bottom Button */}
            {isScrolledUp && (
                <button
                    onClick={scrollToBottom}
                    className="absolute bottom-32 right-6 w-12 h-12 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg hover:shadow-xl transition-all duration-200 flex items-center justify-center z-20 animate-bounce"
                >
                    <ArrowLeft size={20} className="rotate-90"/>
                </button>
            )}

            {/* Input Bar */}
            <div className="relative bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl border-t border-gray-200/50 dark:border-gray-700/50">
                <div className="absolute inset-0 bg-gradient-to-r from-blue-500/5 via-purple-500/5 to-green-500/5"/>

                {/* E2E Notice */}
                <div className="px-4 py-2 bg-green-50 dark:bg-green-900/10 border-b border-green-200 dark:border-green-800/30">
                    <div className="flex items-center justify-center space-x-2 text-sm">
                        <Lock size={14} className="text-green-600 dark:text-green-400" />
                        <span className="text-green-700 dark:text-green-300 font-medium">
                            Messages are end-to-end encrypted. Only you and {chatDisplayName} can read them.
                        </span>
                    </div>
                </div>

                <div className="relative">
                    <InputMessageBarComponent
                        title={chatDisplayName}
                        handleSendMessage={handleSendMessageWrapper}
                        chatId={chatRoom.chatId}
                        isEncrypting={isEncrypting}
                    />
                </div>
            </div>
        </main>
    );
};

// Empty State
const EmptyState: React.FC<{ chatRoomTitle: string }> = ({ chatRoomTitle }) => (
    <div className="flex items-center justify-center h-full">
        <div className="text-center max-w-md mx-auto px-6">
            <div className="relative mb-6">
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-100 via-purple-100 to-green-100 dark:from-blue-900/30 dark:via-purple-900/30 dark:to-green-900/30 flex items-center justify-center mx-auto shadow-lg">
                    <MessageCircle size={32} className="text-blue-600 dark:text-blue-400"/>
                </div>

                <div className="absolute -top-2 -right-2 w-8 h-8 bg-green-500 rounded-full flex items-center justify-center shadow-lg">
                    <Lock size={16} className="text-white" />
                </div>

                <div className="absolute -bottom-2 -left-2">
                    <Sparkles size={12} className="text-pink-500 animate-pulse" style={{animationDelay: '1s'}}/>
                </div>
            </div>

            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-3">
                Start your encrypted conversation
            </h3>
            <p className="text-gray-600 dark:text-gray-400 mb-4 leading-relaxed">
                Send your first message to <span className="font-semibold text-blue-600 dark:text-blue-400">{chatRoomTitle}</span> and begin your secure chat.
            </p>

            <div className="flex items-center justify-center space-x-2 mb-6 p-3 bg-green-50 dark:bg-green-900/10 rounded-lg border border-green-200 dark:border-green-800/30">
                <Shield size={16} className="text-green-600 dark:text-green-400" />
                <span className="text-sm text-green-700 dark:text-green-300 font-medium">
                    All messages are end-to-end encrypted
                </span>
            </div>

            <div className="flex flex-wrap gap-2 justify-center">
                <span className="px-4 py-2 bg-gradient-to-r from-blue-100 to-purple-100 dark:from-blue-900/30 dark:to-purple-900/30 text-blue-700 dark:text-blue-300 rounded-full text-sm font-medium">
                    👋 Say hello
                </span>
                <span className="px-4 py-2 bg-gradient-to-r from-purple-100 to-green-100 dark:from-purple-900/30 dark:to-green-900/30 text-purple-700 dark:text-purple-300 rounded-full text-sm font-medium">
                    🔒 Share securely
                </span>
            </div>
        </div>
    </div>
);

// CSS Animations
const styles = `
@keyframes fade-in {
    from {
        opacity: 0;
        transform: translateY(10px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

.animate-fade-in {
    animation: fade-in 0.3s ease-out;
}

.overflow-y-auto::-webkit-scrollbar {
    width: 6px;
}

.overflow-y-auto::-webkit-scrollbar-track {
    background: transparent;
}

.overflow-y-auto::-webkit-scrollbar-thumb {
    background: rgba(59, 130, 246, 0.3);
    border-radius: 3px;
}

.overflow-y-auto::-webkit-scrollbar-thumb:hover {
    background: rgba(59, 130, 246, 0.5);
}
`;