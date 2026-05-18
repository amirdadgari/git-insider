const jwt = require('jsonwebtoken');
let WebSocketServer;
try {
    WebSocketServer = require('ws').WebSocketServer;
} catch (_) {
    WebSocketServer = null;
}
const url = require('url');
const Database = require('../config/database');
const IndexProgress = require('./IndexProgress');

const db = new Database();
const dbReady = db.connect();

let wss = null;

function broadcast() {
    if (!wss) return;
    const payload = JSON.stringify({ type: 'status', data: IndexProgress.snapshot() });
    for (const client of wss.clients) {
        if (client.readyState === 1) {
            client.send(payload);
        }
    }
}

async function _authenticateConnection(req) {
    const parsed = url.parse(req.url || '', true);
    const token = parsed.query?.token;
    const apiKey = parsed.query?.apiKey;

    await dbReady;

    if (apiKey) {
        const tokenRecord = await db.get(
            `SELECT t.id FROM api_tokens t
             WHERE t.token = ? AND t.is_active = 1
             AND (t.expires_at IS NULL OR t.expires_at > datetime('now'))`,
            [apiKey]
        );
        if (!tokenRecord) throw new Error('Invalid API key');
        return;
    }

    if (token) {
        jwt.verify(token, process.env.JWT_SECRET);
        return;
    }

    throw new Error('Authentication required');
}

function attach(httpServer) {
    if (!WebSocketServer) {
        throw new Error('WebSocket support requires the "ws" package (npm install ws)');
    }
    wss = new WebSocketServer({ server: httpServer, path: '/ws/index-progress' });

    IndexProgress.events.on('update', broadcast);

    wss.on('connection', async (ws, req) => {
        try {
            await _authenticateConnection(req);
        } catch (err) {
            ws.close(4401, err.message || 'Unauthorized');
            return;
        }

        ws.send(JSON.stringify({ type: 'status', data: IndexProgress.snapshot() }));

        ws.on('error', () => {});
    });

    console.log('WebSocket index progress: /ws/index-progress');
}

function close() {
    if (wss) {
        wss.close();
        wss = null;
    }
}

module.exports = { attach, close, broadcast };
