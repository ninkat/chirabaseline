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
  });
});
