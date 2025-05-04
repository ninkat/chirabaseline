import { WebSocketServer, WebSocket } from 'ws';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';

const PORT = process.env.WS_PORT ? parseInt(process.env.WS_PORT, 10) : 8080;
// certificate paths matching the gencert.sh script
const SSL_CERT_PATH = process.env.SSL_CERT_PATH || './certificates/cert.pem';
const SSL_KEY_PATH = process.env.SSL_KEY_PATH || './certificates/key.pem';

// store rooms and their clients
const rooms = new Map<string, Set<WebSocket>>();
// store the topics that clients are subscribed to
const topics = new Map<WebSocket, Set<string>>();
// store video connection rooms and their clients
const videoRooms = new Map<string, Set<WebSocket>>();
// store client ids to sockets for video connections
const clients = new Map<string, WebSocket>();

// create https server
const httpsServer = https.createServer({
  cert: fs.readFileSync(path.resolve(SSL_CERT_PATH)),
  key: fs.readFileSync(path.resolve(SSL_KEY_PATH)),
});

// create websocket server attached to https server
const wss = new WebSocketServer({ server: httpsServer });

httpsServer.listen(PORT, '0.0.0.0', () => {
  console.log(
    `[signaling] secure websocket signaling server running on port ${PORT}`
  );
});

// websocket connection handler
wss.on('connection', (ws: WebSocket) => {
  // initialize client's topics set
  topics.set(ws, new Set());

  // assign a unique id to this client
  const clientId = Math.random().toString(36).substring(2, 15);
  clients.set(clientId, ws);

  // send the client its id
  ws.send(
    JSON.stringify({
      type: 'connection',
      clientId,
    })
  );

  ws.on('message', (msg) => {
    try {
      const message = JSON.parse(msg.toString());

      // handle y-webrtc signaling messages
      if (message.type === 'publish') {
        const { topic, data } = message;
        if (!topic) return;

        // add client to the room
        if (!rooms.has(topic)) {
          rooms.set(topic, new Set());
        }
        rooms.get(topic)!.add(ws);
        topics.get(ws)!.add(topic);

        // broadcast the message to all other clients in the room
        for (const client of rooms.get(topic)!) {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(
              JSON.stringify({
                type: 'publish',
                topic,
                data,
              })
            );
          }
        }
      } else if (message.type === 'subscribe') {
        const { topic } = message;
        if (!topic) return;

        // add client to the room
        if (!rooms.has(topic)) {
          rooms.set(topic, new Set());
        }
        rooms.get(topic)!.add(ws);
        topics.get(ws)!.add(topic);

        // acknowledge subscription
        ws.send(
          JSON.stringify({
            type: 'subscribe',
            topic,
          })
        );
      } else if (message.type === 'unsubscribe') {
        const { topic } = message;
        if (!topic) return;

        // remove client from the room
        if (rooms.has(topic)) {
          rooms.get(topic)!.delete(ws);
        }
        topics.get(ws)!.delete(topic);
      }
      // handle webrtc video signaling messages
      else if (message.type === 'join-video-room') {
        const { roomId } = message;

        // create room if it doesn't exist
        if (!videoRooms.has(roomId)) {
          videoRooms.set(roomId, new Set());
        }

        const room = videoRooms.get(roomId)!;

        // add this client to the room
        room.add(ws);

        // notify this client about existing peers
        const peers = Array.from(room).filter((client) => client !== ws);
        if (peers.length > 0) {
          ws.send(
            JSON.stringify({
              type: 'existing-peers',
              peerIds: Array.from(peers)
                .map((peer) => {
                  // find clientId for this peer
                  for (const [id, socket] of clients.entries()) {
                    if (socket === peer) return id;
                  }
                  return null;
                })
                .filter(Boolean),
            })
          );
        }

        // notify room that a new peer joined
        for (const client of room) {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(
              JSON.stringify({
                type: 'new-peer',
                peerId: clientId,
              })
            );
          }
        }
      } else if (message.type === 'leave-video-room') {
        const { roomId } = message;

        if (videoRooms.has(roomId)) {
          const room = videoRooms.get(roomId)!;
          room.delete(ws);

          // notify others that peer left
          for (const client of room) {
            if (client.readyState === WebSocket.OPEN) {
              client.send(
                JSON.stringify({
                  type: 'peer-left',
                  peerId: clientId,
                })
              );
            }
          }
        }
      } else if (
        message.type === 'video-offer' ||
        message.type === 'video-answer' ||
        message.type === 'ice-candidate'
      ) {
        // forward these messages to the specific peer
        const { peerId, data } = message;
        const targetPeer = clients.get(peerId);

        if (targetPeer && targetPeer.readyState === WebSocket.OPEN) {
          targetPeer.send(
            JSON.stringify({
              type: message.type,
              peerId: clientId, // who the message is from
              data: data,
            })
          );
        }
      }
    } catch (err) {
      console.error('[signaling] failed to parse message:', err);
    }
  });

  // clean up on disconnect
  ws.on('close', () => {
    // remove client from all rooms it was in
    const clientTopics = topics.get(ws);
    if (clientTopics) {
      for (const topic of clientTopics) {
        if (rooms.has(topic)) {
          rooms.get(topic)!.delete(ws);
        }
      }
    }

    // remove client's topics
    topics.delete(ws);

    // notify all video rooms that this client left
    for (const room of videoRooms.values()) {
      if (room.has(ws)) {
        room.delete(ws);

        // notify others in room
        for (const client of room) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(
              JSON.stringify({
                type: 'peer-left',
                peerId: clientId,
              })
            );
          }
        }
      }
    }

    // remove from clients map
    for (const [id, socket] of clients.entries()) {
      if (socket === ws) {
        clients.delete(id);
        break;
      }
    }
  });
});
