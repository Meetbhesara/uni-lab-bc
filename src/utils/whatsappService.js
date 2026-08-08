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
        logger: pino({ level: 'info' }), 
        printQRInTerminal: false,
        auth: state,
        markOnlineOnConnect: false
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
                // Remove folder if logged out
                if (fs.existsSync(sessionFolder)) {
                    fs.rmSync(sessionFolder, { recursive: true, force: true });
                }
            }
        } else if (connection === 'open') {
            clearInitTimer(sessionId);
            console.log(`[WhatsApp] Session ${sessionId} is READY!`);
            logToFile(`Session ${sessionId} is READY`);
            clientStatus.set(sessionId, 'ready');
            clientQrs.delete(sessionId);
            notifyStatusChange(sessionId, 'ready');
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
            fs.rmSync(sessionFolder, { recursive: true, force: true });
            console.log(`[WhatsApp] Removed credential folder: ${sessionFolder}`);
        } catch (err) {
            console.error(`Failed to delete session folder: ${sessionFolder}`, err.message);
        }
    }
};

const initializeAll = async () => {
    console.log('[WhatsApp] Starting all configured sessions...');
    
    await initialize('system_default', 1, 3);

    // Admin sessions are now stored via MultiFileAuthState in different folders in whatsappAuthPath just in case
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

    // 1. Initialize system_default
    initialize('system_default');

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

const sendWhatsapp = async (phone, message, adminId = null, isOtp = false) => {
    const { sock, id } = resolveClient(adminId, isOtp);
    const status = clientStatus.get(id);

    if (!sock || status !== 'ready') {
        logToFile(`sendWhatsapp Failed - Session ${id} not ready`, { phone, status });
        throw new Error(`WhatsApp client session "${id}" is not ready yet!`);
    }

    console.log(`[WhatsApp] Sending via session: ${id} to phone: ${phone}`);
    logToFile(`Sending via session: ${id} to: ${phone}`, { message });

    const targetJid = formatPhoneForBaileys(phone);
    try {
        const [result] = await sock.onWhatsApp(targetJid);
        if (!result || !result.exists) {
            console.log(`[WhatsApp] Phone ${phone} is not on WhatsApp.`);
        }
        
        const sendResult = await sock.sendMessage(targetJid, { text: message });
        logToFile(`Message sent successfully from session ${id} to ${targetJid}`);
        return sendResult;
    } catch (e) {
        console.error(`[WhatsApp] Failed to send message from session ${id}:`, e);
        logToFile(`Error sending from session ${id} to ${targetJid}`, { error: e.message });
        throw new Error(e.message || "Failed to send WhatsApp message.");
    }
};

const sendWhatsappMedia = async (phone, fileUrl, caption, adminId = null) => {
    const { sock, id } = resolveClient(adminId, false);
    const status = clientStatus.get(id);

    if (!sock || status !== 'ready') {
        logToFile(`sendWhatsappMedia Failed - Session ${id} not ready`, { phone, fileUrl, status });
        throw new Error(`WhatsApp client session "${id}" is not ready yet!`);
    }

    console.log(`[WhatsApp] Sending media via session: ${id} to: ${phone}`);
    logToFile(`Sending media via session: ${id} to: ${phone}`, { fileUrl, caption });

    const targetJid = formatPhoneForBaileys(phone);
    try {
        const isPdf = fileUrl.toLowerCase().includes('.pdf');
        
        // Resolve URL locally (respecting NAS vs Local)
        let localPath = null;
        if (fileUrl) {
            let relativePath = fileUrl.trim();
            if (relativePath.startsWith('http://') || relativePath.startsWith('https://')) {
                try {
                    const urlObj = new URL(relativePath);
                    relativePath = urlObj.pathname;
                } catch (e) {}
            }
            try { relativePath = decodeURIComponent(relativePath); } catch (e) {}
            relativePath = relativePath.replace(/\\/g, '/');

            const useNas = process.env.USE_NAS === 'true';
            const nasRoot = process.env.NAS_BASE_PATH || '/app/storage';
            const localRoot = process.env.LOCAL_BASE_PATH || './uploads';

            if (relativePath.includes('/uploads/')) {
                const subPathParts = relativePath.split('/uploads/');
                const subPath = subPathParts[subPathParts.length - 1];
                if (useNas) {
                    localPath = path.join(nasRoot, subPath);
                } else {
                    const baseDir = path.isAbsolute(localRoot) ? localRoot : path.join(process.cwd(), localRoot);
                    localPath = path.join(baseDir, subPath);
                }
            }
            if ((!localPath || !fs.existsSync(localPath)) && relativePath.startsWith('/api/')) {
                localPath = path.join(process.cwd(), relativePath.replace('/api/', ''));
            }
        }
        
        let messagePayload = {};

        if (localPath && fs.existsSync(localPath)) {
            console.log(`[WhatsApp] Resolving media locally from path: ${localPath}`);
            const buffer = fs.readFileSync(localPath);
            const fileName = path.basename(localPath);
            if (isPdf) {
                messagePayload = { document: buffer, mimetype: 'application/pdf', fileName, caption };
            } else {
                messagePayload = { image: buffer, caption };
            }
        } else if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
            if (isPdf) {
                messagePayload = { document: { url: fileUrl }, mimetype: 'application/pdf', caption };
            } else {
                messagePayload = { image: { url: fileUrl }, caption };
            }
        } else {
            let cleanedPath = fileUrl;
            if (!cleanedPath.includes(':') && !cleanedPath.startsWith('/') && !cleanedPath.startsWith('\\')) {
                 cleanedPath = path.join(__dirname, '../../', fileUrl);
            }
            if (fs.existsSync(cleanedPath)) {
                const buffer = fs.readFileSync(cleanedPath);
                const fileName = path.basename(cleanedPath);
                if (isPdf) {
                    messagePayload = { document: buffer, mimetype: 'application/pdf', fileName, caption };
                } else {
                    messagePayload = { image: buffer, caption };
                }
            } else {
                throw new Error(`Local file not found at: ${cleanedPath} (Tried localPath: ${localPath})`);
            }
        }

        const sendResult = await sock.sendMessage(targetJid, messagePayload);
        logToFile(`Media sent successfully from session ${id}`);
        return sendResult;
    } catch (e) {
        console.error(`[WhatsApp] Failed to send media from session ${id}:`, e.message);
        logToFile(`Error sending media from session ${id} to ${targetJid}`, { error: e.message });
        throw e;
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
            sessionId,
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
