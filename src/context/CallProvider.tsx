"use client";

import {createContext, ReactNode, useContext, useEffect, useReducer, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {useStomp} from "@/context/StompProvider";
import {api} from "@/lib";
import {Mic, MicOff, Phone, PhoneOff, Video as VideoIcon, VideoOff} from "lucide-react";

export type CallMedia = "audio" | "video";

type Signal =
    | { type: "CALL_OFFER"; sdp: RTCSessionDescriptionInit; senderId: string; media: CallMedia }
    | { type: "CALL_ANSWER"; sdp: RTCSessionDescriptionInit; senderId: string }
    | { type: "ICE_CANDIDATE"; candidate: RTCIceCandidateInit; senderId: string }
    | { type: "CALL_HANGUP"; senderId: string };

type Phase = "idle" | "outgoing" | "incoming" | "in-call";

const ICE_CONFIG: RTCConfiguration = {iceServers: [{urls: "stun:stun.l.google.com:19302"}]};

interface CallContextValue {
    /** Place a call. No-op if a call is already in progress. */
    startCall: (remoteUserId: string, remoteName: string, media: CallMedia) => void;
    /** True while any call is ringing/connecting/connected, so call buttons can disable themselves. */
    busy: boolean;
}

const CallContext = createContext<CallContextValue | null>(null);

export function useCall(): CallContextValue {
    const context = useContext(CallContext);
    if (!context) throw new Error("useCall must be used within a CallProvider");
    return context;
}

/**
 * App-level WebRTC calling. One signaling subscription for the whole app (owned by StompProvider), so a call
 * rings on any page. Media (audio/video), the ringing offer and the in-call overlay all live here.
 */
export function CallProvider({children}: { children: ReactNode }) {
    const {client, connected, connectionEpoch} = useStomp();
    const [phase, setPhase] = useState<Phase>("idle");
    const [media, setMedia] = useState<CallMedia>("audio");
    const [peerName, setPeerName] = useState("");
    const [micOn, setMicOn] = useState(true);
    const [camOn, setCamOn] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [, attachTick] = useReducer(x => x + 1, 0);

    const pcRef = useRef<RTCPeerConnection | null>(null);
    const localStreamRef = useRef<MediaStream | null>(null);
    const remoteStreamRef = useRef<MediaStream | null>(null);
    const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
    const incomingOfferRef = useRef<{ sdp: RTCSessionDescriptionInit; media: CallMedia } | null>(null);
    const peerIdRef = useRef<string | null>(null); // the other party of the current/pending call
    const phaseRef = useRef<Phase>("idle");
    phaseRef.current = phase;
    // userId -> display name, for naming an incoming caller; filled from the user's chats on (re)connect
    const namesRef = useRef<Map<string, string>>(new Map());

    const localVideoRef = useRef<HTMLVideoElement>(null);
    const remoteVideoRef = useRef<HTMLVideoElement>(null);
    const remoteAudioRef = useRef<HTMLAudioElement>(null);

    const publish = (to: string, payload: object) =>
        client?.publish({destination: `/app/signaling/${to}`, body: JSON.stringify(payload)});

    // one signaling subscription for the whole app, re-established on every (re)connect.
    // connectionEpoch bumps once the client is connected, so this re-runs then; guard against the
    // pre-connection render where subscribe() would throw "no underlying STOMP connection".
    useEffect(() => {
        if (!client || !connected) return;

        // build a caller-name lookup from the user's chats (lightweight: rooms only, no messages)
        api.chat.fetchChatRooms().then(response => {
            const names = new Map<string, string>();
            for (const room of response.data) {
                for (const participant of room.participants) {
                    names.set(participant.id, participant.username || participant.email || "Unknown");
                }
            }
            namesRef.current = names;
        }).catch(() => undefined);

        const subscription = client.subscribe("/user/queue/signaling", message => {
            void onSignal(JSON.parse(message.body) as Signal);
        });
        return () => {
            try {
                subscription.unsubscribe();
            } catch {
                // the connection may already be gone on teardown
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [client, connected, connectionEpoch]);

    useEffect(() => cleanup, []);

    // (re)attach streams to their elements whenever they change or the overlay mounts
    useEffect(() => {
        if (remoteVideoRef.current && remoteStreamRef.current) remoteVideoRef.current.srcObject = remoteStreamRef.current;
        if (remoteAudioRef.current && remoteStreamRef.current) remoteAudioRef.current.srcObject = remoteStreamRef.current;
        if (localVideoRef.current && localStreamRef.current) localVideoRef.current.srcObject = localStreamRef.current;
    });

    async function onSignal(signal: Signal) {
        try {
            switch (signal.type) {
                case "CALL_OFFER": {
                    if (phaseRef.current !== "idle") {
                        publish(signal.senderId, {type: "CALL_HANGUP"}); // busy
                        return;
                    }
                    peerIdRef.current = signal.senderId;
                    incomingOfferRef.current = {sdp: signal.sdp, media: signal.media};
                    setPeerName(namesRef.current.get(signal.senderId) || "Unknown");
                    setMedia(signal.media);
                    setError(null);
                    setPhase("incoming"); // ring — do NOT auto-answer
                    break;
                }
                case "CALL_ANSWER": {
                    if (signal.senderId !== peerIdRef.current) return;
                    const pc = pcRef.current;
                    if (pc && pc.signalingState === "have-local-offer") {
                        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
                        await drainPendingIce();
                        setPhase("in-call");
                    }
                    break;
                }
                case "ICE_CANDIDATE": {
                    if (signal.senderId !== peerIdRef.current) return;
                    const pc = pcRef.current;
                    if (pc?.remoteDescription?.type) await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
                    else pendingIceRef.current.push(signal.candidate);
                    break;
                }
                case "CALL_HANGUP": {
                    if (signal.senderId !== peerIdRef.current) return;
                    endCall(false); // remote ended / rejected / busy
                    break;
                }
            }
        } catch (e) {
            console.error("Signal handling failed:", e);
        }
    }

    function createPeer(): RTCPeerConnection {
        const pc = new RTCPeerConnection(ICE_CONFIG);
        pc.onicecandidate = event => {
            if (event.candidate && peerIdRef.current) {
                publish(peerIdRef.current, {type: "ICE_CANDIDATE", candidate: event.candidate});
            }
        };
        pc.ontrack = event => {
            remoteStreamRef.current = event.streams[0];
            attachTick();
        };
        pc.onconnectionstatechange = () => {
            if (pc.connectionState === "failed") {
                setError("Connection lost");
                endCall(true);
            }
        };
        pcRef.current = pc;
        return pc;
    }

    async function getLocalMedia(kind: CallMedia): Promise<MediaStream> {
        if (!navigator.mediaDevices?.getUserMedia) {
            throw new DeviceError(window.isSecureContext ? "Calls aren't supported in this browser" : "Calls require HTTPS");
        }
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {echoCancellation: true, noiseSuppression: true, autoGainControl: true},
            video: kind === "video" ? {width: {ideal: 1280}, height: {ideal: 720}, facingMode: "user"} : false,
        });
        localStreamRef.current = stream;
        setMicOn(true);
        setCamOn(kind === "video");
        return stream;
    }

    async function drainPendingIce() {
        const pc = pcRef.current;
        if (!pc) return;
        for (const candidate of pendingIceRef.current) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.error(e));
        }
        pendingIceRef.current = [];
    }

    async function startCall(remoteUserId: string, remoteName: string, kind: CallMedia) {
        if (phaseRef.current !== "idle") return;
        peerIdRef.current = remoteUserId;
        setPeerName(remoteName);
        setMedia(kind);
        setError(null);
        try {
            const stream = await getLocalMedia(kind);
            const pc = createPeer();
            stream.getTracks().forEach(track => pc.addTrack(track, stream));
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            publish(remoteUserId, {type: "CALL_OFFER", sdp: offer, media: kind});
            setPhase("outgoing");
        } catch (e) {
            handleMediaError(e);
            cleanup();
        }
    }

    async function acceptCall() {
        const offer = incomingOfferRef.current;
        const peerId = peerIdRef.current;
        if (!offer || !peerId) return;
        try {
            setError(null);
            const stream = await getLocalMedia(offer.media);
            const pc = createPeer();
            await pc.setRemoteDescription(new RTCSessionDescription(offer.sdp));
            stream.getTracks().forEach(track => pc.addTrack(track, stream));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await drainPendingIce();
            publish(peerId, {type: "CALL_ANSWER", sdp: answer});
            incomingOfferRef.current = null;
            setPhase("in-call");
        } catch (e) {
            handleMediaError(e);
            rejectCall();
        }
    }

    function rejectCall() {
        if (peerIdRef.current) publish(peerIdRef.current, {type: "CALL_HANGUP"});
        cleanup();
    }

    function endCall(notifyRemote: boolean) {
        if (notifyRemote && peerIdRef.current) publish(peerIdRef.current, {type: "CALL_HANGUP"});
        cleanup();
    }

    function cleanup() {
        pcRef.current?.close();
        pcRef.current = null;
        localStreamRef.current?.getTracks().forEach(t => t.stop());
        localStreamRef.current = null;
        remoteStreamRef.current = null;
        pendingIceRef.current = [];
        incomingOfferRef.current = null;
        peerIdRef.current = null;
        setPhase("idle");
    }

    function toggleMic() {
        const track = localStreamRef.current?.getAudioTracks()[0];
        if (track) {
            track.enabled = !track.enabled;
            setMicOn(track.enabled);
        }
    }

    function toggleCam() {
        const track = localStreamRef.current?.getVideoTracks()[0];
        if (track) {
            track.enabled = !track.enabled;
            setCamOn(track.enabled);
        }
    }

    function handleMediaError(e: unknown) {
        if (e instanceof DeviceError) setError(e.message);
        else if (e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "NotFoundError"))
            setError("No camera/microphone access");
        else setError("Couldn't start the call");
        console.error("Call media error:", e);
    }

    const isVideo = media === "video";

    return (
        <CallContext.Provider value={{startCall, busy: phase !== "idle"}}>
            {children}

            {phase !== "idle" && createPortal(
                <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-gray-900/95 text-white backdrop-blur-sm px-4">
                    {phase === "in-call" && isVideo && (
                        <video ref={remoteVideoRef} autoPlay playsInline
                               className="absolute inset-0 h-full w-full bg-black object-contain"/>
                    )}
                    <audio ref={remoteAudioRef} autoPlay/>

                    {!(phase === "in-call" && isVideo) && (
                        <div className="relative z-10 flex flex-col items-center">
                            <div className="flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-4xl font-semibold shadow-lg">
                                {(peerName || "?").charAt(0).toUpperCase()}
                            </div>
                            <h2 className="mt-5 text-2xl font-semibold">{peerName || "Unknown"}</h2>
                            <p className="mt-1 text-sm text-white/70">
                                {error ? error
                                    : phase === "incoming" ? `Incoming ${media} call…`
                                        : phase === "outgoing" ? "Calling…"
                                            : `${isVideo ? "Video" : "Audio"} call in progress`}
                            </p>
                        </div>
                    )}

                    {isVideo && phase !== "incoming" && (
                        <video ref={localVideoRef} autoPlay muted playsInline
                               className="absolute bottom-28 right-4 z-20 aspect-video w-40 -scale-x-100 rounded-xl border border-white/20 bg-black object-cover shadow-xl sm:w-56"/>
                    )}

                    <div className="absolute bottom-10 z-30 flex items-center gap-5">
                        {phase === "incoming" ? (
                            <>
                                <button onClick={rejectCall} aria-label="Reject call"
                                        className="flex h-16 w-16 items-center justify-center rounded-full bg-red-600 shadow-lg transition hover:bg-red-700 active:scale-95">
                                    <PhoneOff size={26}/>
                                </button>
                                <button onClick={acceptCall} aria-label="Accept call"
                                        className="flex h-16 w-16 items-center justify-center rounded-full bg-green-600 shadow-lg transition hover:bg-green-700 active:scale-95">
                                    <Phone size={26}/>
                                </button>
                            </>
                        ) : (
                            <>
                                {phase === "in-call" && (
                                    <button onClick={toggleMic} aria-label={micOn ? "Mute microphone" : "Unmute microphone"}
                                            className={`flex h-14 w-14 items-center justify-center rounded-full transition active:scale-95 ${micOn ? "bg-white/15 hover:bg-white/25" : "bg-white text-gray-900"}`}>
                                        {micOn ? <Mic size={22}/> : <MicOff size={22}/>}
                                    </button>
                                )}
                                {phase === "in-call" && isVideo && (
                                    <button onClick={toggleCam} aria-label={camOn ? "Turn camera off" : "Turn camera on"}
                                            className={`flex h-14 w-14 items-center justify-center rounded-full transition active:scale-95 ${camOn ? "bg-white/15 hover:bg-white/25" : "bg-white text-gray-900"}`}>
                                        {camOn ? <VideoIcon size={22}/> : <VideoOff size={22}/>}
                                    </button>
                                )}
                                <button onClick={() => endCall(true)} aria-label="End call"
                                        className="flex h-16 w-16 items-center justify-center rounded-full bg-red-600 shadow-lg transition hover:bg-red-700 active:scale-95">
                                    <PhoneOff size={26}/>
                                </button>
                            </>
                        )}
                    </div>
                </div>,
                document.body
            )}
        </CallContext.Provider>
    );
}

// distinguishes "no device access / not secure" (a message we show) from unexpected errors
class DeviceError extends Error {}
