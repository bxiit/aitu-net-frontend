"use client";

import {createContext, ReactNode, useContext, useEffect, useState} from "react";
import {Client, ReconnectionTimeMode} from "@stomp/stompjs";
import SockJS from "sockjs-client";
import {useAuth} from "@/context/AuthProvider";

interface StompContextValue {
    client: Client | null;
    connected: boolean;
    /** Bumped on every successful (re)connect, so subscribers can re-subscribe on the new session. */
    connectionEpoch: number;
}

const StompContext = createContext<StompContextValue>({client: null, connected: false, connectionEpoch: 0});

export function useStomp(): StompContextValue {
    return useContext(StompContext);
}

const SOCKET_URL: string = process.env.NEXT_PUBLIC_WEBSOCKET_URL || "defaultWebSocketUrl";

/**
 * Owns the single app-wide WebSocket/STOMP connection. Mounted in the app shell so chat, presence and calls
 * all share one connection and keep working on any page while logged in.
 */
export function StompProvider({children}: { children: ReactNode }) {
    const {user} = useAuth();
    const [client, setClient] = useState<Client | null>(null);
    const [connected, setConnected] = useState(false);
    const [connectionEpoch, setConnectionEpoch] = useState(0);

    useEffect(() => {
        if (!user) {
            setClient(null);
            setConnected(false);
            return;
        }

        const stompClient = new Client({
            webSocketFactory: () => new SockJS(SOCKET_URL),
            // Exponential backoff from a per-client randomised base: after a server restart 10k clients don't all
            // retry on the same tick, which would hammer the server as it comes back up.
            reconnectDelay: 2000 + Math.floor(Math.random() * 4000),
            reconnectTimeMode: ReconnectionTimeMode.EXPONENTIAL,
            maxReconnectDelay: 60_000,
            connectionTimeout: 10_000,
            onConnect: () => {
                setConnected(true);
                setConnectionEpoch(epoch => epoch + 1);
            },
            onWebSocketClose: () => setConnected(false),
            onStompError: frame => console.error(`STOMP Error: ${frame.body}`),
        });

        stompClient.activate();
        setClient(stompClient);

        return () => {
            setConnected(false);
            setClient(null);
            stompClient.deactivate().catch(() => undefined);
        };
        // only reconnect when the logged-in user actually changes
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id]);

    return (
        <StompContext.Provider value={{client, connected, connectionEpoch}}>
            {children}
        </StompContext.Provider>
    );
}
