"use client";

import React, { useState, useMemo } from "react";
import { MessageCircle, Search, Users, Plus, Shield, Lock } from "lucide-react";
import Dropdown from "@/components/chats/DropDown";
import { ChatRoom } from "@/models/chat/ChatRoom";
import { useAuth } from "@/context/AuthProvider";
import { defaultPfp } from "../../../public/modules/defaultPfp";
import { Loading } from "@/components/Loading";

interface ChatRoomsComponentProps {
    selectChat: (chatId: string) => Promise<void>;
    chatRooms: Map<string, ChatRoom>;
    newMessagesCount: Map<string, number>;
    selectedChatId?: string;
    loadMoreChats?: () => Promise<void>;
    hasMoreChats?: boolean;
}

export const ChatRoomsComponent: React.FC<ChatRoomsComponentProps> = ({
                                                                          selectChat,
                                                                          chatRooms,
                                                                          newMessagesCount,
                                                                          selectedChatId,
                                                                          loadMoreChats,
                                                                          hasMoreChats
                                                                      }) => {
    const { user } = useAuth();
    const [searchQuery, setSearchQuery] = useState("");
    const [isSelectingChat, setIsSelectingChat] = useState<string | null>(null);
    const [isLoadingMore, setIsLoadingMore] = useState(false);

    const handleLoadMore = async () => {
        if (!loadMoreChats || isLoadingMore) return;
        try {
            setIsLoadingMore(true);
            await loadMoreChats();
        } finally {
            setIsLoadingMore(false);
        }
    };

    const filteredChatRooms = useMemo(() => {
        if (!chatRooms || !searchQuery.trim()) {
            return chatRooms ? [...chatRooms.values()] : [];
        }
        return [...chatRooms.values()].filter(chatRoom =>
            chatRoom.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            chatRoom.participants.some(participant =>
                participant.username?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                participant.email?.toLowerCase().includes(searchQuery.toLowerCase())
            )
        );
    }, [chatRooms, searchQuery]);

    const getChatDisplayName = (chatRoom: ChatRoom): string => {
        if (chatRoom.title) {
            return chatRoom.title;
        }

        if (chatRoom.chatRoomType === 'ONE_TO_ONE') {
            const otherParticipant = chatRoom.participants.find(p => p.id !== user?.id);
            return otherParticipant?.username || otherParticipant?.email || 'Unknown User';
        }

        const participantNames = chatRoom.participants
            .filter(p => p.id !== user?.id)
            .map(p => p.username || p.email)
            .slice(0, 2)
            .join(', ');

        return participantNames || 'Group Chat';
    };

    const getChatAvatar = (chatRoom: ChatRoom) => {
        if (chatRoom.chatRoomType === 'ONE_TO_ONE') {
            const otherParticipant = chatRoom.participants.find(p => p.id !== user?.id);
            return otherParticipant?.avatar?.location || defaultPfp;
        }
        return null;
    };

    const handleChatSelect = async (chatId: string) => {
        try {
            setIsSelectingChat(chatId);
            await selectChat(chatId);
        } catch (error) {
            console.error('❌ Failed to select chat:', error);
        } finally {
            setIsSelectingChat(null);
        }
    };

    if (!user) {
        return <Loading />;
    }

    return (
        <aside className="w-full md:w-1/4 min-w-[280px] border-r border-gray-200 dark:border-gray-700 h-full flex flex-col bg-white dark:bg-gray-900 transition-colors duration-200">
            {/* Header Section */}
            <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-gray-800 dark:to-gray-900">
                <div className="flex justify-between items-center mb-4">
                    <div className="flex items-center space-x-2">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center relative">
                            <MessageCircle size={18} className="text-white" />
                            {/* E2E Badge */}
                            <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full flex items-center justify-center">
                                <Lock size={8} className="text-white" />
                            </div>
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                                Messages
                            </h3>
                            <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center">
                                <Shield size={10} className="mr-1" />
                                End-to-End Encrypted
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center space-x-2">
                        <button
                            className="p-2 rounded-lg hover:bg-white/50 dark:hover:bg-gray-700/50 transition-colors duration-200"
                            title="New Chat"
                        >
                            <Plus size={18} className="text-gray-600 dark:text-gray-400" />
                        </button>
                        <Dropdown />
                    </div>
                </div>

                {/* Search Bar */}
                <div className="relative group">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <Search
                            size={16}
                            className="text-gray-400 group-focus-within:text-indigo-500 transition-colors duration-200"
                        />
                    </div>
                    <input
                        type="text"
                        placeholder="Search encrypted conversations..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-10 pr-4 py-3 w-full bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-gray-900 dark:text-white placeholder-gray-500 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200 shadow-sm hover:shadow-md focus:shadow-md"
                    />
                </div>
            </div>

            {/* Chat List */}
            <div className="overflow-y-auto flex-1 p-3">
                {filteredChatRooms.length > 0 ? (
                    <div className="space-y-2">
                        {filteredChatRooms.map((chatRoom: ChatRoom) => {
                            const isSelected = selectedChatId === chatRoom.chatId;
                            const isLoading = isSelectingChat === chatRoom.chatId;
                            const unreadCount = newMessagesCount.get(chatRoom.chatId) || 0;
                            const displayName = getChatDisplayName(chatRoom);
                            const avatarUrl = getChatAvatar(chatRoom);

                            return (
                                <button
                                    key={chatRoom.id}
                                    className={`w-full flex items-center p-3 rounded-xl transition-all duration-200 text-left focus:outline-none group relative overflow-hidden ${
                                        isSelected
                                            ? "bg-gradient-to-r from-indigo-100 to-purple-100 dark:from-indigo-900/30 dark:to-purple-900/30 shadow-md scale-[1.02]"
                                            : "hover:bg-gray-50 dark:hover:bg-gray-800/50 hover:shadow-sm hover:scale-[1.01]"
                                    } ${isLoading ? "opacity-75 cursor-wait" : ""}`}
                                    onClick={() => handleChatSelect(chatRoom.chatId)}
                                    disabled={isLoading}
                                >
                                    {/* Selection Indicator */}
                                    {isSelected && (
                                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-indigo-500 to-purple-500 rounded-r-full" />
                                    )}

                                    {/* Avatar */}
                                    <div className="relative mr-3 flex-shrink-0">
                                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-100 to-purple-100 dark:from-indigo-900 dark:to-purple-900 flex items-center justify-center overflow-hidden ring-2 ring-white dark:ring-gray-800 shadow-sm">
                                            {avatarUrl ? (
                                                <img
                                                    src={avatarUrl}
                                                    alt={displayName}
                                                    className="w-full h-full object-cover"
                                                    onError={(e) => {
                                                        e.currentTarget.style.display = 'none';
                                                    }}
                                                />
                                            ) : null}
                                            <Users
                                                size={20}
                                                className="text-indigo-600 dark:text-indigo-400"
                                                style={{ display: avatarUrl ? 'none' : 'block' }}
                                            />
                                        </div>

                                        {/* Loading Spinner */}
                                        {isLoading ? (
                                            <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-blue-500 rounded-full border-2 border-white dark:border-gray-900 flex items-center justify-center">
                                                <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                                            </div>
                                        ) : (
                                            /* E2E Encryption Badge */
                                            <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-green-500 rounded-full border-2 border-white dark:border-gray-900 flex items-center justify-center shadow-sm">
                                                <Lock size={8} className="text-white" />
                                            </div>
                                        )}
                                    </div>

                                    {/* Chat Info */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between mb-1">
                                            <div className="flex items-center flex-1 min-w-0">
                                                <p className={`text-sm font-semibold truncate ${
                                                    isSelected
                                                        ? "text-indigo-900 dark:text-indigo-100"
                                                        : "text-gray-900 dark:text-white"
                                                }`}>
                                                    {displayName}
                                                </p>
                                                {/* Chat Type Badge */}
                                                {chatRoom.chatRoomType === 'GROUP' && (
                                                    <span className="ml-2 px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-xs rounded-full">
                                                        {chatRoom.participants.length}
                                                    </span>
                                                )}
                                            </div>
                                            {unreadCount > 0 && (
                                                <div className="ml-2 px-2 py-1 bg-gradient-to-r from-red-500 to-pink-500 text-white text-xs font-bold rounded-full min-w-[20px] h-5 flex items-center justify-center shadow-sm animate-bounce">
                                                    {unreadCount > 99 ? "99+" : unreadCount}
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex items-center">
                                            <Shield size={10} className={`mr-1 ${
                                                isSelected
                                                    ? "text-indigo-700 dark:text-indigo-300"
                                                    : "text-gray-500 dark:text-gray-400"
                                            }`} />
                                            <p className={`text-xs truncate ${
                                                isSelected
                                                    ? "text-indigo-700 dark:text-indigo-300"
                                                    : "text-gray-500 dark:text-gray-400"
                                            }`}>
                                                {isLoading
                                                    ? "Loading encryption keys..."
                                                    : "End-to-end encrypted"
                                                }
                                            </p>
                                        </div>
                                    </div>

                                    {/* Hover Effect */}
                                    <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/5 to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-200 rounded-xl" />
                                </button>
                            );
                        })}
                    </div>
                ) : (
                    <EmptyState searchQuery={searchQuery} />
                )}

                {hasMoreChats && !searchQuery.trim() && (
                    <button
                        onClick={handleLoadMore}
                        disabled={isLoadingMore}
                        className="w-full mt-2 py-2 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg transition-colors duration-200 disabled:opacity-60 disabled:cursor-wait"
                    >
                        {isLoadingMore ? "Loading…" : "Load more"}
                    </button>
                )}
            </div>
        </aside>
    );
};

const EmptyState: React.FC<{ searchQuery: string }> = ({ searchQuery }) => (
    <div className="flex flex-col items-center justify-center h-full text-center p-6">
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-indigo-100 to-purple-100 dark:from-indigo-900/30 dark:to-purple-900/30 flex items-center justify-center mb-4 shadow-sm relative">
            {searchQuery ? (
                <Search size={28} className="text-indigo-500 dark:text-indigo-400" />
            ) : (
                <MessageCircle size={28} className="text-indigo-500 dark:text-indigo-400" />
            )}
            {/* E2E Badge on empty state */}
            <div className="absolute -top-1 -right-1 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center shadow-sm">
                <Lock size={12} className="text-white" />
            </div>
        </div>
        <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            {searchQuery ? "No matches found" : "No conversations yet"}
        </h4>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
            {searchQuery
                ? `No conversations match "${searchQuery}"`
                : "Start a new encrypted conversation"
            }
        </p>
        <div className="flex items-center justify-center text-xs text-gray-400 dark:text-gray-500">
            <Shield size={12} className="mr-1" />
            <span>All messages are end-to-end encrypted</span>
        </div>
    </div>
);
