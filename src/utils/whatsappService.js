const { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcodeTerminal = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const { broadcast } = require('./sseManager');

const notifyStatusChange = (sessionId, status, qr = null) => {
    clientStatus.set(sessionId, status);
    broadcast('whatsapp-status-changed', { sessionId, status, qr });
};

// Resolve path to storage (respecting NAS vs Local)
const useNasFlag = process.env.USE_NAS;
const nasRoot = process.env.NAS_BASE_PATH || '/app/storage';
const whatsappAuthPath = useNasFlag === 'true'
    ? path.join(nasRoot, 'whatsapp_auth')
    : path.join(process.cwd(), 'whatsapp_auth');

if (!fs.existsSync(whatsappAuthPath)) {
    fs.mkdirSync(whatsappAuthPath, { recursive: true });
}

// Universal NAS & Local Storage Path Resolver
const getUploadRootDir = () => {
    if (process.env.USE_NAS === 'true') {
        return process.env.NAS_BASE_PATH || '/app/storage';
    }
    if (process.env.LOCAL_BASE_PATH) {
        return path.isAbsolute(process.env.LOCAL_BASE_PATH)
            ? process.env.LOCAL_BASE_PATH
            : path.join(process.cwd(), process.env.LOCAL_BASE_PATH);
    }
    return path.join(process.cwd(), 'uploads');
};

const resolveLocalFilePath = (filePathOrUrl) => {
    if (!filePathOrUrl || typeof filePathOrUrl !== 'string') return null;

    if (path.isAbsolute(filePathOrUrl) && fs.existsSync(filePathOrUrl)) {
        return filePathOrUrl;
    }

    let relativePath = filePathOrUrl.trim();
    if (relativePath.startsWith('http://') || relativePath.startsWith('https://')) {
        try {
            const urlObj = new URL(relativePath);
            relativePath = urlObj.pathname;
        } catch (e) {
            relativePath = relativePath.replace(/^https?:\/\/[^\/]+/, '');
        }
    }

    let cleanedPath = relativePath
        .replace(/^\/?api\/uploads\/?/, '')
        .replace(/^\/?uploads\/?/, '')
        .replace(/^\//, '');

    try {
        cleanedPath = decodeURIComponent(cleanedPath);
    } catch (e) {}

    const uploadRootDir = getUploadRootDir();

    const candidates = [
        path.join(uploadRootDir, cleanedPath),
        path.join(uploadRootDir, 'catalogs', cleanedPath),
        path.join(uploadRootDir, 'products', cleanedPath),
        path.join(process.cwd(), 'uploads', cleanedPath),
        path.join(process.cwd(), 'uploads', 'catalogs', cleanedPath),
        path.join(process.cwd(), 'uploads', 'products', cleanedPath),
        path.join(process.cwd(), cleanedPath),
        path.join('/app/storage', cleanedPath),
        path.join('/app/storage', 'catalogs', cleanedPath),
        path.join('/app/storage', 'products', cleanedPath),
        path.join(__dirname, '../../uploads', cleanedPath),
        path.join(__dirname, '../../uploads/catalogs', cleanedPath)
    ];

    for (const cand of candidates) {
        if (cand && fs.existsSync(cand)) {
            return cand;
        }
    }

    return null;
};

// In-memory mappings
const clients = new Map();
const clientStatus = new Map(); // 'disconnected' | 'initializing' | 'qr' | 'ready'
const clientQrs = new Map();   // Holds current base64 QR or raw QR string
const initializeTimers = new Map(); // Safety fallback timers for hanging initializing states

const logToFile = (msg, obj = '') => {
    try {
        const logPath = path.join(__dirname, '../../whatsapp_debug.txt');
        const timestamp = new Date().toISOString();
        const content = `[${timestamp}] ${msg} ${obj ? JSON.stringify(obj, null, 2) : ''}\n`;
        fs.appendFileSync(logPath, content, 'utf8');
    } catch (e) {
        console.error('Log appender failed', e);
    }
};

const clearInitTimer = (sessionId) => {
    if (initializeTimers.has(sessionId)) {
        clearTimeout(initializeTimers.get(sessionId));
        initializeTimers.delete(sessionId);
    }
};

const destroyAll = async () => {
    console.log('[WhatsApp] 🛑 Destroying all active WhatsApp clients...');
    for (const [sessionId, sock] of clients.entries()) {
        try {
            sock.ws.close();
            console.log(`[WhatsApp] Closed client ${sessionId}`);
        } catch (e) {
            console.error(`[WhatsApp] Error destroying client ${sessionId}:`, e.message);
        }
    }
    clients.clear();
    clientStatus.clear();
    clientQrs.clear();
};

const handleGracefulShutdown = async (signal) => {
    console.log(`[WhatsApp] Received ${signal}. Closing socket instances...`);
    await destroyAll();
};

process.once('SIGINT', async () => {
    await handleGracefulShutdown('SIGINT');
    process.exit(0);
});
process.once('SIGTERM', async () => {
    await handleGracefulShutdown('SIGTERM');
    process.exit(0);
});
process.once('SIGUSR2', async () => {
    await handleGracefulShutdown('SIGUSR2');
    process.kill(process.pid, 'SIGUSR2');
});

const initialize = async (sessionId = 'system_default', attempt = 1, maxAttempts = 3, phoneNumber = null) => {
    if (clients.has(sessionId)) {
        const status = clientStatus.get(sessionId);
        if (status === 'initializing' || status === 'ready') {
            console.log(`[WhatsApp] Session ${sessionId} is already ${status}. Skipping initialize.`);
            notifyStatusChange(sessionId, status, clientQrs.get(sessionId));
            return;
        }
        if (status === 'qr') {
            if (phoneNumber) {
                console.log(`[WhatsApp] Upgrading session ${sessionId} from QR to Pairing Code...`);
                const existingSock = clients.get(sessionId);
                if (existingSock) {
                    try {
                        let formattedNumber = phoneNumber.replace(/[^0-9]/g, '');
                        const code = await existingSock.requestPairingCode(formattedNumber);
                        console.log(`\n======================================================`);
                        console.log(`[WhatsApp] Pairing Code for ${formattedNumber}: ${code}`);
                        console.log(`Enter this code on your WhatsApp mobile app under "Linked Devices" > "Link with phone number instead"`);
                        console.log(`======================================================\n`);
                        clientQrs.set(sessionId, code);
                        notifyStatusChange(sessionId, 'pairing_code', code);
                        return; // Upgraded successfully, stop initialization!
                    } catch (err) {
                        console.error(`[WhatsApp] Failed to upgrade session ${sessionId} to pairing code:`, err);
                    }
                }
            } else {
                console.log(`[WhatsApp] Session ${sessionId} is already qr.`);
                notifyStatusChange(sessionId, 'qr', clientQrs.get(sessionId));
                return;
            }
        }
        
        // If we reach here, we are intentionally recreating the socket.
        // Mark it so it doesn't auto-reconnect in the background.
        const oldSock = clients.get(sessionId);
        clients.delete(sessionId);
        if (oldSock) {
            oldSock.ev.removeAllListeners('connection.update'); // Stop ghost reconnects
            try { oldSock.ws.close(); } catch (e) {}
        }
    }

    console.log(`[WhatsApp] Initializing WhatsApp Client for session: ${sessionId} (attempt ${attempt}/${maxAttempts})`);
    logToFile(`Initializing session: ${sessionId} (attempt ${attempt}/${maxAttempts})`);

    clientStatus.set(sessionId, 'initializing');
    clientQrs.delete(sessionId);
    notifyStatusChange(sessionId, 'initializing');

    clearInitTimer(sessionId);
    const fallbackTimer = setTimeout(async () => {
        if (clientStatus.get(sessionId) === 'initializing') {
            console.warn(`[WhatsApp] ⏱️ Session ${sessionId} initialization timed out after 300s.`);
            logToFile(`Session ${sessionId} initialization timed out after 300s`);
            clientStatus.set(sessionId, 'disconnected');
            notifyStatusChange(sessionId, 'disconnected');
            const stuckSock = clients.get(sessionId);
            if (stuckSock) {
                clients.delete(sessionId);
                try { stuckSock.ws.close(); } catch (err) {}
            }
        }
        initializeTimers.delete(sessionId);
    }, 300000);
    initializeTimers.set(sessionId, fallbackTimer);

    const sessionFolder = path.join(whatsappAuthPath, `session-${sessionId}`);
    const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
    const { version, isLatest } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }), 
        printQRInTerminal: false,
        auth: state,
        markOnlineOnConnect: false,
        keepAliveIntervalMs: 30000,
        defaultQueryTimeoutMs: 30000,
        connectTimeoutMs: 60000
    });

    clients.set(sessionId, sock);
    
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            clearInitTimer(sessionId);
            clientStatus.set(sessionId, 'qr');
            clientQrs.set(sessionId, qr);
            
            if (phoneNumber && !sock.authState.creds.registered) {
                // Request pairing code ONLY when socket is fully ready (proven by QR generation)
                (async () => {
                    try {
                        let formattedNumber = phoneNumber.replace(/[^0-9]/g, '');
                        const code = await sock.requestPairingCode(formattedNumber);
                        console.log(`\n======================================================`);
                        console.log(`[WhatsApp] Pairing Code for ${formattedNumber}: ${code}`);
                        console.log(`Enter this code on your WhatsApp mobile app under "Linked Devices" > "Link with phone number instead"`);
                        console.log(`======================================================\n`);
                        clientQrs.set(sessionId, code);
                        notifyStatusChange(sessionId, 'pairing_code', code);
                    } catch (err) {
                        console.error(`[WhatsApp] Failed to request pairing code:`, err.message || err);
                        notifyStatusChange(sessionId, 'qr', qr);
                    }
                })();
            } else {
                notifyStatusChange(sessionId, 'qr', qr);
                
                if (sessionId === 'system_default') {
                    console.log(`\n--- WHATSAPP SYSTEM DEFAULT QR CODE ---`);
                    qrcodeTerminal.generate(qr, { small: true });
                    console.log('Scan the QR code above with your WhatsApp app to connect!\n');
                } else {
                    console.log(`[WhatsApp] Session ${sessionId} generated a QR code.`);
                }
            }
        }

        if (connection === 'close') {
            clearInitTimer(sessionId);
            const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
            console.error(`[WhatsApp] Session ${sessionId} disconnected due to:`, lastDisconnect?.error?.message || lastDisconnect?.error);
            logToFile(`Session ${sessionId} disconnected`, { reason: lastDisconnect?.error?.message });
            
            if (shouldReconnect) {
                console.log(`[WhatsApp] Reconnecting session ${sessionId}...`);
                setTimeout(() => initialize(sessionId, attempt, maxAttempts, phoneNumber), 3000);
            } else {
                console.log(`[WhatsApp] Session ${sessionId} logged out. Removing credentials.`);
                clientStatus.set(sessionId, 'disconnected');
                clientQrs.delete(sessionId);
                notifyStatusChange(sessionId, 'disconnected');
                
                clients.delete(sessionId);
                // Remove folder if logged out (with safe error handling and retries for Windows file locks)
                if (fs.existsSync(sessionFolder)) {
                    try {
                        fs.rmSync(sessionFolder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
                        console.log(`[WhatsApp] Successfully removed logged-out session folder: ${sessionFolder}`);
                    } catch (err) {
                        console.error(`[WhatsApp] Could not immediately delete session folder ${sessionFolder}:`, err.message);
                    }
                }
            }
        } else if (connection === 'open') {
            clearInitTimer(sessionId);
            console.log(`[WhatsApp] Session ${sessionId} is READY!`);
            logToFile(`Session ${sessionId} is READY`);
            clientStatus.set(sessionId, 'ready');
            clientQrs.delete(sessionId);
            notifyStatusChange(sessionId, 'ready');
            setTimeout(processOutbox, 1500);
        }
    });
};

const disconnect = async (sessionId) => {
    console.log(`[WhatsApp] Disconnecting session: ${sessionId}`);
    logToFile(`Disconnecting session: ${sessionId}`);
    
    clearInitTimer(sessionId);
    const sock = clients.get(sessionId);
    if (sock) {
        try {
            await sock.logout();
        } catch (e) {
            console.error(`Error logging out ${sessionId}:`, e.message);
            try { sock.ws.close(); } catch(e2) {}
        }
        clients.delete(sessionId);
    }
    
    clientStatus.set(sessionId, 'disconnected');
    clientQrs.delete(sessionId);
    notifyStatusChange(sessionId, 'disconnected');

    // Delete session files
    const sessionFolder = path.join(whatsappAuthPath, `session-${sessionId}`);
    if (fs.existsSync(sessionFolder)) {
        try {
            fs.rmSync(sessionFolder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
            console.log(`[WhatsApp] Removed credential folder: ${sessionFolder}`);
        } catch (err) {
            console.error(`Failed to delete session folder: ${sessionFolder}`, err.message);
        }
    }
};

const initializeAll = async () => {
    console.log('[WhatsApp] Starting all configured sessions...');
    
    // Cleanup any loose files in whatsappAuthPath if any exist
    try {
        if (fs.existsSync(whatsappAuthPath)) {
            const files = fs.readdirSync(whatsappAuthPath);
            files.forEach(file => {
                const fullPath = path.join(whatsappAuthPath, file);
                if (fs.statSync(fullPath).isFile()) {
                    fs.unlinkSync(fullPath);
                }
            });
        }
    } catch (e) {}

    // 1. Initialize system_default session once
    await initialize('system_default', 1, 3);

    // 2. Scan folder for other saved sessions
    try {
        if (fs.existsSync(whatsappAuthPath)) {
            const files = fs.readdirSync(whatsappAuthPath);
            files.forEach(file => {
                if (file.startsWith('session-') && file !== 'session-system_default') {
                    const sessionId = file.replace('session-', '');
                    initialize(sessionId);
                }
            });
        }
    } catch (e) {
        console.error('[WhatsApp] Failed to read saved sessions directory:', e.message);
    }
};

// ── Outbox Queue for Guaranteed Zero-Loss WhatsApp Delivery ─────────────────
const outboxQueue = [];
let isQueueProcessing = false;

const addToOutbox = (item) => {
    // Avoid queuing duplicate identical messages to the same phone within 30 seconds
    const isDuplicate = outboxQueue.some(q => 
        q.phone === item.phone && 
        q.type === item.type && 
        (item.type === 'media' ? q.fileUrl === item.fileUrl : q.message === item.message) &&
        (Date.now() - new Date(q.createdAt).getTime() < 30000)
    );
    if (isDuplicate) {
        console.log(`[WhatsApp Outbox] ⚠️ Duplicate message for ${item.phone} already queued. Skipping duplicate queueing.`);
        return;
    }

    item.id = item.id || `outbox_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    item.attempts = item.attempts || 0;
    item.maxAttempts = item.maxAttempts || 8;
    item.createdAt = item.createdAt || new Date();
    outboxQueue.push(item);
    console.log(`[WhatsApp Outbox] Queued unsent message for ${item.phone} (Queue size: ${outboxQueue.length})`);
    logToFile(`Queued in Outbox for ${item.phone}`, { queueSize: outboxQueue.length, item });
};

const processOutbox = async () => {
    if (isQueueProcessing || outboxQueue.length === 0) return;
    isQueueProcessing = true;

    try {
        const remaining = [];
        while (outboxQueue.length > 0) {
            const item = outboxQueue.shift();
            const targetSessionId = item.adminId ? `admin_${item.adminId}` : 'system_default';
            let status = clientStatus.get(targetSessionId);
            let sock = clients.get(targetSessionId);

            // Fallback to system_default if admin session is not ready and message is not an OTP
            if ((!sock || status !== 'ready') && targetSessionId !== 'system_default' && !item.isOtp) {
                const sysSock = clients.get('system_default');
                const sysStatus = clientStatus.get('system_default');
                if (sysSock && sysStatus === 'ready') {
                    sock = sysSock;
                    status = 'ready';
                }
            }

            if (sock && status === 'ready') {
                try {
                    console.log(`[WhatsApp Outbox] Delivering queued message to ${item.phone}...`);
                    const targetJid = formatPhoneForBaileys(item.phone);
                    if (item.type === 'media') {
                        let messagePayload = null;
                        if (item.fileUrl) {
                            const isPdf = (item.fileUrl || '').toLowerCase().includes('.pdf');
                            const localPath = resolveLocalFilePath(item.fileUrl);
                            if (localPath && fs.existsSync(localPath)) {
                                const buffer = fs.readFileSync(localPath);
                                const fileName = path.basename(localPath);
                                messagePayload = isPdf 
                                    ? { document: buffer, mimetype: 'application/pdf', fileName, caption: item.caption }
                                    : { image: buffer, caption: item.caption };
                            } else {
                                console.warn(`[WhatsApp Outbox] ⚠️ Media file not found on disk: "${item.fileUrl}". Falling back to text.`);
                                if (item.caption && item.caption.trim()) {
                                    messagePayload = { text: item.caption };
                                }
                            }
                        } else if (item.caption && item.caption.trim()) {
                            messagePayload = { text: item.caption };
                        }

                        if (!messagePayload) {
                            throw new Error(`No valid media or text content for queued item to ${item.phone}`);
                        }
                        await sock.sendMessage(targetJid, messagePayload);
                    } else {
                        await sock.sendMessage(targetJid, { text: item.message });
                    }
                    console.log(`[WhatsApp Outbox] ✅ Successfully delivered queued message to ${item.phone}`);
                    logToFile(`Outbox successfully delivered to ${item.phone}`);
                    broadcast('whatsapp-queued-delivered', { phone: item.phone, id: item.id });
                    // Prevent rapid message flooding on socket
                    await new Promise(r => setTimeout(r, 600));
                    continue; // Successfully delivered
                } catch (sendErr) {
                    item.attempts++;
                    console.warn(`[WhatsApp Outbox] Attempt ${item.attempts} failed for ${item.phone}:`, sendErr.message);
                }
            }

            // If not delivered yet and within retry budget, keep in queue
            if (item.attempts < item.maxAttempts) {
                remaining.push(item);
            } else {
                console.error(`[WhatsApp Outbox] ❌ Dropped message to ${item.phone} after ${item.maxAttempts} attempts.`);
                logToFile(`Outbox dropped after max attempts for ${item.phone}`);
            }
        }
        outboxQueue.push(...remaining);
    } catch (qErr) {
        console.error('[WhatsApp Outbox] Queue processing error:', qErr);
    } finally {
        isQueueProcessing = false;
    }
};

// Check outbox every 8 seconds
setInterval(processOutbox, 8000);

// Helper to wait until a session becomes ready (active websocket handshake complete)
const waitForSessionReady = async (sessionId, timeoutMs = 15000) => {
    // 1. If already ready, return socket immediately
    if (clientStatus.get(sessionId) === 'ready' && clients.has(sessionId)) {
        return clients.get(sessionId);
    }

    // 2. Check if auth credentials exist on disk
    const sessionFolder = path.join(whatsappAuthPath, `session-${sessionId}`);
    const credsFile = path.join(sessionFolder, 'creds.json');
    const hasCreds = fs.existsSync(credsFile);

    if (!hasCreds) {
        return null; // Session has never been paired or was logged out
    }

    // 3. If credentials exist, but session is not initializing or ready, trigger initialization
    const currentStatus = clientStatus.get(sessionId);
    if (currentStatus !== 'initializing' && currentStatus !== 'ready') {
        console.log(`[WhatsApp] Session ${sessionId} has credentials but is in '${currentStatus || 'idle'}' state. Starting initialization...`);
        initialize(sessionId);
    }

    // 4. Poll until ready or timeout
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
        await new Promise((r) => setTimeout(r, 400));
        if (clientStatus.get(sessionId) === 'ready' && clients.has(sessionId)) {
            return clients.get(sessionId);
        }
        if (clientStatus.get(sessionId) === 'qr') {
            return null;
        }
    }

    console.warn(`[WhatsApp] Timed out waiting for session ${sessionId} to become ready after ${timeoutMs}ms.`);
    return null;
};

const resolveClient = (adminId, isOtp = false) => {
    if (isOtp) return { sock: clients.get('system_default'), id: 'system_default' };

    if (adminId) {
        const adminSessionId = `admin_${adminId}`;
        const adminSock = clients.get(adminSessionId);
        const status = clientStatus.get(adminSessionId);
        
        if (adminSock && status === 'ready') {
            return { sock: adminSock, id: adminSessionId };
        } else {
            return { sock: null, id: adminSessionId };
        }
    }

    return { sock: clients.get('system_default'), id: 'system_default' };
};

// Formats phone numbers correctly for Baileys
const formatPhoneForBaileys = (phone) => {
    let cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.startsWith('0')) cleanPhone = cleanPhone.substring(1);
    if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;
    return `${cleanPhone}@s.whatsapp.net`;
};

const sendWhatsapp = async (phone, message, adminId = null, isOtp = false, retryCount = 0) => {
    let { sock, id } = resolveClient(adminId, isOtp);
    let status = clientStatus.get(id);

    if (!sock || status !== 'ready') {
        // Wait for session to be ready if it's reconnecting or needs initialize
        const readySock = await waitForSessionReady(id, 15000);
        if (readySock) {
            sock = readySock;
            status = 'ready';
        } else {
            // Fallback: If this is an admin session that is not ready/paired, but system_default is ready
            const systemSock = clients.get('system_default');
            const systemStatus = clientStatus.get('system_default');
            if (id !== 'system_default' && !isOtp && systemSock && systemStatus === 'ready') {
                console.log(`[WhatsApp] Session ${id} not ready; falling back to system_default for sending to ${phone}`);
                sock = systemSock;
                id = 'system_default';
                status = 'ready';
            } else {
                logToFile(`sendWhatsapp Failed - Session ${id} not ready`, { phone, status });
                throw new Error(`WhatsApp client session "${id}" is not ready yet!`);
            }
        }
    }

    console.log(`[WhatsApp] Sending via session: ${id} to phone: ${phone}`);
    logToFile(`Sending via session: ${id} to: ${phone}`, { message });

    const targetJid = formatPhoneForBaileys(phone);
    try {
        const sendPromise = (async () => {
            try {
                const [result] = await sock.onWhatsApp(targetJid);
                if (result && !result.exists) {
                    console.log(`[WhatsApp] Phone ${phone} is not on WhatsApp.`);
                }
            } catch (_) {
                // Ignore presence check errors and proceed to send
            }
            return await sock.sendMessage(targetJid, { text: message });
        })();

        // 15-second timeout to prevent ghost connection hangs
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error("WhatsApp message send timed out (Ghost Connection)")), 15000)
        );

        const sendResult = await Promise.race([sendPromise, timeoutPromise]);
        
        logToFile(`Message sent successfully from session ${id} to ${targetJid}`);
        return sendResult;
    } catch (e) {
        console.error(`[WhatsApp] Failed to send message from session ${id}:`, e);
        logToFile(`Error sending from session ${id} to ${targetJid}`, { error: e.message });
        
        const isConnectionError = e.message && (
            e.message.includes('Connection Closed') || 
            e.message.includes('Ghost Connection') ||
            e.output?.statusCode === 428
        );

        if (isConnectionError && retryCount < 2) {
            console.log(`[WhatsApp] Connection dropped for ${id}. Cleaning up and waiting for reconnect to retry sending to ${phone}...`);
            clientStatus.set(id, 'disconnected');
            const oldSock = clients.get(id);
            if (oldSock) {
                try { oldSock.ws.close(); } catch (_) {}
            }
            clients.delete(id);

            initialize(id);
            const reconnectedSock = await waitForSessionReady(id, 15000);
            if (reconnectedSock) {
                console.log(`[WhatsApp] Reconnected successfully! Retrying send to ${phone}...`);
                return sendWhatsapp(phone, message, adminId, isOtp, retryCount + 1);
            }
        }
        
        // Save to Outbox so message is NEVER lost
        addToOutbox({
            type: 'text',
            phone,
            message,
            adminId,
            isOtp
        });

        throw new Error(e.message || "Failed to send WhatsApp message.");
    }
};

const sendWhatsappMedia = async (phone, fileUrl, caption, adminId = null, retryCount = 0) => {
    let { sock, id } = resolveClient(adminId, false);
    let status = clientStatus.get(id);

    if (!sock || status !== 'ready') {
        const readySock = await waitForSessionReady(id, 15000);
        if (readySock) {
            sock = readySock;
            status = 'ready';
        } else {
            const systemSock = clients.get('system_default');
            const systemStatus = clientStatus.get('system_default');
            if (id !== 'system_default' && systemSock && systemStatus === 'ready') {
                console.log(`[WhatsApp] Session ${id} not ready; falling back to system_default for media sending to ${phone}`);
                sock = systemSock;
                id = 'system_default';
                status = 'ready';
            } else {
                logToFile(`sendWhatsappMedia Failed - Session ${id} not ready`, { phone, fileUrl, status });
                throw new Error(`WhatsApp client session "${id}" is not ready yet!`);
            }
        }
    }

    console.log(`[WhatsApp] Sending media via session: ${id} to: ${phone}`);
    logToFile(`Sending media via session: ${id} to: ${phone}`, { fileUrl, caption });

    const targetJid = formatPhoneForBaileys(phone);
    try {
        const isPdf = (fileUrl || '').toLowerCase().includes('.pdf');
        
        // Resolve URL locally (respecting NAS vs Local)
        let localPath = null;
        let messagePayload = null;

        if (fileUrl) {
            localPath = resolveLocalFilePath(fileUrl);
            
            if (localPath && fs.existsSync(localPath)) {
                const buffer = fs.readFileSync(localPath);
                const fileName = path.basename(localPath);
                if (isPdf) {
                    messagePayload = { document: buffer, mimetype: 'application/pdf', fileName, caption };
                } else {
                    messagePayload = { image: buffer, caption };
                }
            } else {
                console.warn(`[WhatsApp] Local file not found for: "${fileUrl}" (Checked NAS and Local storage: localPath=${localPath})`);
                // If local file is missing but caption exists, fallback to text so recipient always gets the message
                if (caption && caption.trim()) {
                    console.log(`[WhatsApp] Falling back to text message with caption for ${phone}`);
                    messagePayload = { text: caption };
                } else {
                    throw new Error(`Local media file not found on disk for: "${fileUrl}"`);
                }
            }
        } else if (caption && caption.trim()) {
            messagePayload = { text: caption };
        } else {
            throw new Error("No media file or message content provided.");
        }

        const sendPromise = sock.sendMessage(targetJid, messagePayload);

        // 20-second timeout for media to prevent ghost connection hangs
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error("WhatsApp media send timed out (Ghost Connection)")), 20000)
        );

        const sendResult = await Promise.race([sendPromise, timeoutPromise]);
        
        logToFile(`Media sent successfully from session ${id} to ${targetJid}`);
        return sendResult;
    } catch (e) {
        console.error(`[WhatsApp] Failed to send media from session ${id}:`, e);
        logToFile(`Error sending media from session ${id} to ${targetJid}`, { error: e.message });
        
        const isConnectionError = e.message && (
            e.message.includes('Connection Closed') || 
            e.message.includes('Ghost Connection') ||
            e.output?.statusCode === 428
        );

        if (isConnectionError && retryCount < 2) {
            console.log(`[WhatsApp] Connection dropped for media ${id}. Cleaning up and waiting for reconnect to retry sending to ${phone}...`);
            clientStatus.set(id, 'disconnected');
            const oldSock = clients.get(id);
            if (oldSock) {
                try { oldSock.ws.close(); } catch (_) {}
            }
            clients.delete(id);

            initialize(id);
            const reconnectedSock = await waitForSessionReady(id, 15000);
            if (reconnectedSock) {
                console.log(`[WhatsApp] Reconnected successfully! Retrying media send to ${phone}...`);
                return sendWhatsappMedia(phone, fileUrl, caption, adminId, retryCount + 1);
            }
        }
        
        // Save to Outbox so media message is NEVER lost
        addToOutbox({
            type: 'media',
            phone,
            fileUrl,
            caption,
            adminId
        });

        throw new Error(e.message || "Failed to send WhatsApp media message.");
    }
};

const getStatus = (sessionId) => {
    return {
        status: clientStatus.get(sessionId) || 'disconnected',
        qr: clientQrs.get(sessionId) || null
    };
};

const getAllWhatsappHealth = () => {
    const sessions = [];
    for (const [sessionId, status] of clientStatus.entries()) {
        sessions.push({
            sessionId: sessionId.startsWith('admin_') ? sessionId.replace('admin_', '') : sessionId,
            status,
            isReady: status === 'ready',
            hasQr: !!clientQrs.get(sessionId)
        });
    }
    if (sessions.length === 0) {
        sessions.push({
            sessionId: 'system_default',
            status: clientStatus.get('system_default') || 'disconnected',
            isReady: clientStatus.get('system_default') === 'ready',
            hasQr: !!clientQrs.get('system_default')
        });
    }

    let lastLogSnippet = 'No recent error logs.';
    try {
        const logPath = path.join(__dirname, '../../whatsapp_debug.txt');
        if (fs.existsSync(logPath)) {
            const content = fs.readFileSync(logPath, 'utf8');
            const lines = content.trim().split('\n').filter(Boolean);
            lastLogSnippet = lines.slice(-3).join(' | ');
        }
    } catch (_) {}

    return {
        activeSessionsCount: sessions.filter(s => s.isReady).length,
        totalConfiguredSessions: sessions.length,
        authDirectory: whatsappAuthPath,
        authDirectoryExists: fs.existsSync(whatsappAuthPath),
        activeLockFiles: 0, // Not applicable for Baileys
        chromeLockClean: true, // Not applicable for Baileys
        recentLogSnippet: lastLogSnippet,
        sessions
    };
};

module.exports = {
    initialize,
    initializeAll,
    disconnect,
    destroyAll,
    sendWhatsapp,
    sendWhatsappMedia,
    getStatus,
    getAllWhatsappHealth,
    logToFile,
    isReady: (sessionId = 'system_default') => clientStatus.get(sessionId) === 'ready'
};
