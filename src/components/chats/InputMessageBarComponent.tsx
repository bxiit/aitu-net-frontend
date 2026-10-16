"use client";

import React, { useState } from "react";
import { Paperclip, Send, Smile, Lock, Key, Shield } from "lucide-react";
import { MessageType } from "@/models/chat/ChatMessage";
import { useAuth } from "@/context/AuthProvider";
import { FileMessageType, MediaRecorderComponent } from "@/components/chats/messages/MediaRecorderComponent";

// ===== ЧИСТЫЙ E2E ИНТЕРФЕЙС =====
interface InputMessageBarProps {
    handleSendMessage: (messageText: string, messageType?: MessageType) => Promise<void>;
    title: string;
    chatId: string;
    isEncrypting?: boolean;
}

export const InputMessageBarComponent: React.FC<InputMessageBarProps> = ({
                                                                             handleSendMessage,
                                                                             title,
                                                                             chatId,
                                                                             isEncrypting = false
                                                                         }) => {
    const { user } = useAuth();
    const [inputMessage, setInputMessage] = useState<string>('');
    const [isSending, setIsSending] = useState<boolean>(false);
    // the recorder that's currently recording, if any: the other one (and, for voice, the text input) is hidden
    const [recordingType, setRecordingType] = useState<FileMessageType | null>(null);
    const recordingVoice = recordingType === FileMessageType.AUDIO;

    const handleSubmitMessage = async () => {
        if (!user) return;
        if (!inputMessage.trim()) return;
        if (isSending || isEncrypting) return;

        try {
            setIsSending(true);
            await handleSendMessage(inputMessage.trim(), MessageType.MESSAGE_TEXT);
            resetInput();
        } catch (error) {
            console.error('Failed to send message:', error);
        } finally {
            setIsSending(false);
        }
    };

    const resetInput = () => {
        setInputMessage('');
    };

    const defaultIconSize = 20;
    const isButtonDisabled = !inputMessage.trim() || isSending || isEncrypting;

    return (
        <div className="p-4">
            {/* E2E Status Indicator */}
            {(isEncrypting || isSending) && (
                <div className="mb-3 flex items-center justify-center space-x-2 p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800/30">
                    <div className="flex items-center space-x-1">
                        {isEncrypting ? (
                            <>
                                <Key size={14} className="text-blue-600 dark:text-blue-400 animate-pulse" />
                                <span className="text-sm text-blue-700 dark:text-blue-300 font-medium">
                                    Encrypting message...
                                </span>
                            </>
                        ) : (
                            <>
                                <Send size={14} className="text-blue-600 dark:text-blue-400 animate-pulse" />
                                <span className="text-sm text-blue-700 dark:text-blue-300 font-medium">
                                    Sending...
                                </span>
                            </>
                        )}
                    </div>
                </div>
            )}

            <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg overflow-hidden relative">
                {!recordingVoice && (
                    <>
                        {/* File Attachment Button */}
                        <button
                            className="shrink-0 p-2 text-gray-500 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors duration-200"
                            disabled={isSending || isEncrypting}
                            title="Attach file (E2E encryption coming soon)"
                        >
                            <Paperclip size={defaultIconSize} />
                        </button>

                        {/* Message Input */}
                        <input
                            type="text"
                            className="flex-1 min-w-0 py-3 px-3 bg-transparent border-0 focus:ring-0 text-gray-900 dark:text-white placeholder-gray-500 disabled:opacity-50"
                            placeholder={`Send encrypted message to ${title}...`}
                            value={inputMessage}
                            onChange={e => setInputMessage(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSubmitMessage();
                                }
                            }}
                            disabled={isSending || isEncrypting}
                            maxLength={4000}
                        />

                        {/* Emoji Button */}
                        <button
                            className="shrink-0 p-2 text-gray-500 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors duration-200"
                            disabled={isSending || isEncrypting}
                            title="Add emoji"
                        >
                            <Smile size={defaultIconSize} />
                        </button>

                        {/* Send Button */}
                        <button
                            className={`shrink-0 p-2 ml-1 rounded-lg transition-all duration-200 flex items-center space-x-1 ${
                                isButtonDisabled
                                    ? "bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed"
                                    : "bg-blue-600 text-white hover:bg-blue-700 shadow-lg hover:shadow-xl transform hover:scale-105"
                            }`}
                            onClick={handleSubmitMessage}
                            disabled={isButtonDisabled}
                            title={
                                isEncrypting
                                    ? "Encrypting message..."
                                    : isSending
                                        ? "Sending..."
                                        : "Send encrypted message"
                            }
                        >
                            {isEncrypting ? (
                                <Key size={defaultIconSize} className="animate-pulse" />
                            ) : isSending ? (
                                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            ) : (
                                <>
                                    <Send size={defaultIconSize} />
                                    <Lock size={10} className="opacity-70" />
                                </>
                            )}
                        </button>
                    </>
                )}

                {/* Media Recording Buttons */}
                {!inputMessage.trim() && !isSending && !isEncrypting && (
                    <>
                        {recordingType !== FileMessageType.VIDEO && (
                            <div className={recordingVoice ? "min-w-0 flex-1 px-1 py-1" : "shrink-0"}>
                                <MediaRecorderComponent
                                    chatId={chatId}
                                    handleSendMessage={handleSendMessage}
                                    type={FileMessageType.AUDIO}
                                    isEncrypting={isEncrypting}
                                    disabled={isSending || isEncrypting}
                                    onRecordingChange={recording => setRecordingType(recording ? FileMessageType.AUDIO : null)}
                                />
                            </div>
                        )}
                        {!recordingVoice && (
                            <div className="shrink-0">
                                <MediaRecorderComponent
                                    chatId={chatId}
                                    handleSendMessage={handleSendMessage}
                                    type={FileMessageType.VIDEO}
                                    isEncrypting={isEncrypting}
                                    disabled={isSending || isEncrypting}
                                    onRecordingChange={recording => setRecordingType(recording ? FileMessageType.VIDEO : null)}
                                />
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Character Counter and E2E Notice */}
            <div className="mt-2 flex items-center justify-between text-xs">
                <div className="flex items-center space-x-2 text-gray-500 dark:text-gray-400">
                    <Shield size={12} className="text-green-600 dark:text-green-400" />
                    <span>End-to-end encrypted</span>
                </div>

                {inputMessage.length > 0 && (
                    <span className={`${
                        inputMessage.length > 3500
                            ? 'text-red-500'
                            : inputMessage.length > 3000
                                ? 'text-yellow-500'
                                : 'text-gray-400'
                    }`}>
                        {inputMessage.length}/4000
                    </span>
                )}
            </div>
        </div>
    );
};