/**
 * SSE (Server-Sent Events) Manager
 * -----------------------------------
 * Keeps a registry of all connected browser clients.
 * Any controller can call `broadcast(event, data)` to push
 * a real-time update to every connected browser — no polling needed.
 */

const clients = new Map(); // clientId -> res

let clientIdCounter = 0;

/**
 * Register a new SSE client connection.
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
const addClient = (req, res) => {
    const id = ++clientIdCounter;

    // Required SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering if behind proxy
    res.flushHeaders();

    // Send a welcome heartbeat so the browser knows the connection is live
    res.write(`event: connected\ndata: ${JSON.stringify({ clientId: id })}\n\n`);

    clients.set(id, res);
    console.log(`[SSE] Client #${id} connected. Total: ${clients.size}`);

    // Remove client when they disconnect (tab close, navigation, etc.)
    req.on('close', () => {
        clients.delete(id);
        console.log(`[SSE] Client #${id} disconnected. Total: ${clients.size}`);
    });
};

/**
 * Broadcast an event to ALL connected browser clients.
 * @param {string} event - Event name (e.g. 'schedule-updated', 'expense-added')
 * @param {object} [data]  - Optional JSON payload
 */
const broadcast = (event, data = {}) => {
    if (clients.size === 0) return;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    clients.forEach((res, id) => {
        try {
            res.write(payload);
        } catch (err) {
            // Client already gone
            clients.delete(id);
        }
    });
    console.log(`[SSE] Broadcast "${event}" to ${clients.size} client(s)`);
};

/**
 * Periodic heartbeat to keep connections alive through proxies / firewalls
 * (some proxies kill idle HTTP connections after 30-60 s).
 */
setInterval(() => {
    if (clients.size === 0) return;
    const ping = `: heartbeat\n\n`; // comment line — browsers ignore it
    clients.forEach((res, id) => {
        try { res.write(ping); } catch { clients.delete(id); }
    });
}, 25000); // every 25 seconds

module.exports = { addClient, broadcast };
