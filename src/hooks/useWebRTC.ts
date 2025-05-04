import { useEffect, useRef, useState, useCallback } from 'react';
import getWebsocketUrl from '../utils/websocketUtils';

// define types for peer connection states
type PeerConnectionState =
  | 'new'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'failed'
  | 'closed';

// define types for peer connection info
interface PeerConnection {
  id: string;
  connection: RTCPeerConnection;
  videoStream?: MediaStream;
}

// define types for WebRTC hook return value
interface UseWebRTCReturn {
  localStream: MediaStream | null;
  peerStreams: Map<string, MediaStream>;
  isConnected: boolean;
  clientId: string | null;
  startLocalVideo: () => Promise<void>;
  stopLocalVideo: () => void;
}

// WebRTC configuration with public STUN servers
const configuration: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

// main hook for WebRTC video connections
export function useWebRTC(roomId: string): UseWebRTCReturn {
  // state for local stream
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  // map of peer streams by peer id
  const [peerStreams, setPeerStreams] = useState<Map<string, MediaStream>>(
    new Map()
  );
  // websocket connection status
  const [isConnected, setIsConnected] = useState<boolean>(false);
  // client id assigned by the server
  const [clientId, setClientId] = useState<string | null>(null);

  // refs to maintain state without triggering rerenders
  const socketRef = useRef<WebSocket | null>(null);
  const peerConnectionsRef = useRef<Map<string, PeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);

  // function to start local video stream
  const startLocalVideo = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      // store stream in state and ref
      setLocalStream(stream);
      localStreamRef.current = stream;

      // add tracks to all existing peer connections
      for (const [peerId, peer] of peerConnectionsRef.current) {
        stream.getTracks().forEach((track) => {
          peer.connection.addTrack(track, stream);
        });

        // recreate offer with new tracks for each peer
        createOffer(peerId);
      }
    } catch (error) {
      console.error('[webrtc] error accessing media devices:', error);
    }
  }, []);

  // function to stop local video stream
  const stopLocalVideo = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      setLocalStream(null);
      localStreamRef.current = null;
    }
  }, []);

  // create or get an existing peer connection
  const getPeerConnection = useCallback((peerId: string): RTCPeerConnection => {
    if (peerConnectionsRef.current.has(peerId)) {
      return peerConnectionsRef.current.get(peerId)!.connection;
    }

    // create a new peer connection
    const peerConnection = new RTCPeerConnection(configuration);

    // add local stream tracks to the connection
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        peerConnection.addTrack(track, localStreamRef.current!);
      });
    }

    // handle ice candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate && socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(
          JSON.stringify({
            type: 'ice-candidate',
            peerId,
            data: event.candidate,
          })
        );
      }
    };

    // handle connection state changes
    peerConnection.onconnectionstatechange = () => {
      const state = peerConnection.connectionState as PeerConnectionState;
      console.log(`[webrtc] connection state with peer ${peerId}: ${state}`);

      if (
        state === 'disconnected' ||
        state === 'failed' ||
        state === 'closed'
      ) {
        // clean up connection
        peerConnectionsRef.current.delete(peerId);
        setPeerStreams((prev) => {
          const newStreams = new Map(prev);
          newStreams.delete(peerId);
          return newStreams;
        });
      }
    };

    // handle incoming tracks
    peerConnection.ontrack = (event) => {
      console.log(`[webrtc] received track from peer ${peerId}`);
      if (event.streams && event.streams[0]) {
        const peerStream = event.streams[0];

        // store the stream in our map
        setPeerStreams((prev) => {
          const newStreams = new Map(prev);
          newStreams.set(peerId, peerStream);
          return newStreams;
        });

        // update peer connection object
        const peer = peerConnectionsRef.current.get(peerId);
        if (peer) {
          peer.videoStream = peerStream;
        }
      }
    };

    // store the connection in our map
    peerConnectionsRef.current.set(peerId, {
      id: peerId,
      connection: peerConnection,
    });

    return peerConnection;
  }, []);

  // create and send offer
  const createOffer = useCallback(
    async (peerId: string) => {
      try {
        const peerConnection = getPeerConnection(peerId);
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        // send the offer if socket is connected
        if (socketRef.current?.readyState === WebSocket.OPEN) {
          socketRef.current.send(
            JSON.stringify({
              type: 'video-offer',
              peerId,
              data: offer,
            })
          );
        }
      } catch (error) {
        console.error(
          `[webrtc] error creating offer for peer ${peerId}:`,
          error
        );
      }
    },
    [getPeerConnection]
  );

  // handle incoming offer
  const handleOffer = useCallback(
    async (peerId: string, offer: RTCSessionDescriptionInit) => {
      try {
        const peerConnection = getPeerConnection(peerId);
        await peerConnection.setRemoteDescription(
          new RTCSessionDescription(offer)
        );

        // create and send answer
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        // send the answer if socket is connected
        if (socketRef.current?.readyState === WebSocket.OPEN) {
          socketRef.current.send(
            JSON.stringify({
              type: 'video-answer',
              peerId,
              data: answer,
            })
          );
        }
      } catch (error) {
        console.error(
          `[webrtc] error handling offer from peer ${peerId}:`,
          error
        );
      }
    },
    [getPeerConnection]
  );

  // handle incoming answer
  const handleAnswer = useCallback(
    async (peerId: string, answer: RTCSessionDescriptionInit) => {
      try {
        const peerConnection = getPeerConnection(peerId);
        await peerConnection.setRemoteDescription(
          new RTCSessionDescription(answer)
        );
      } catch (error) {
        console.error(
          `[webrtc] error handling answer from peer ${peerId}:`,
          error
        );
      }
    },
    [getPeerConnection]
  );

  // handle incoming ice candidates
  const handleIceCandidate = useCallback(
    (peerId: string, candidate: RTCIceCandidateInit) => {
      try {
        const peerConnection = getPeerConnection(peerId);
        peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.error(
          `[webrtc] error adding ice candidate from peer ${peerId}:`,
          error
        );
      }
    },
    [getPeerConnection]
  );

  // handle websocket messages
  const handleMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const message = JSON.parse(event.data);

        if (message.type === 'connection') {
          // server assigned us a client id
          setClientId(message.clientId);
          setIsConnected(true);

          // join the video room
          if (socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send(
              JSON.stringify({
                type: 'join-video-room',
                roomId,
              })
            );
          }
        } else if (message.type === 'new-peer') {
          console.log(`[webrtc] new peer joined: ${message.peerId}`);
          // create an offer for the new peer
          createOffer(message.peerId);
        } else if (message.type === 'existing-peers') {
          console.log(`[webrtc] found existing peers: ${message.peerIds}`);
          // create offers for all existing peers
          if (message.peerIds && message.peerIds.length > 0) {
            // small delay to ensure both sides are ready
            setTimeout(() => {
              message.peerIds.forEach((peerId: string) => {
                createOffer(peerId);
              });
            }, 1000);
          }
        } else if (message.type === 'peer-left') {
          console.log(`[webrtc] peer left: ${message.peerId}`);

          // clean up peer connection
          const peer = peerConnectionsRef.current.get(message.peerId);
          if (peer) {
            peer.connection.close();
            peerConnectionsRef.current.delete(message.peerId);
          }

          // remove peer stream
          setPeerStreams((prev) => {
            const newStreams = new Map(prev);
            newStreams.delete(message.peerId);
            return newStreams;
          });
        } else if (message.type === 'video-offer') {
          console.log(`[webrtc] received offer from peer: ${message.peerId}`);
          handleOffer(message.peerId, message.data);
        } else if (message.type === 'video-answer') {
          console.log(`[webrtc] received answer from peer: ${message.peerId}`);
          handleAnswer(message.peerId, message.data);
        } else if (message.type === 'ice-candidate') {
          handleIceCandidate(message.peerId, message.data);
        }
      } catch (error) {
        console.error('[webrtc] error handling websocket message:', error);
      }
    },
    [roomId, createOffer, handleOffer, handleAnswer, handleIceCandidate]
  );

  // initialize websocket connection
  useEffect(() => {
    // connect to websocket server
    const wsUrl = getWebsocketUrl();
    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    // set up event handlers
    socket.onopen = () => {
      console.log('[webrtc] websocket connection established');
    };

    socket.onmessage = handleMessage;

    socket.onerror = (error) => {
      console.error('[webrtc] websocket error:', error);
    };

    socket.onclose = () => {
      console.log('[webrtc] websocket connection closed');
      setIsConnected(false);
    };

    // cleanup function
    return () => {
      // leave the video room
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({
            type: 'leave-video-room',
            roomId,
          })
        );
      }

      // close all peer connections
      for (const [, peer] of peerConnectionsRef.current) {
        peer.connection.close();
      }
      peerConnectionsRef.current.clear();

      // stop local stream
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
      }

      // close socket
      socket.close();
    };
  }, [roomId, handleMessage]);

  return {
    localStream,
    peerStreams,
    isConnected,
    clientId,
    startLocalVideo,
    stopLocalVideo,
  };
}
