const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

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

// Initialize a specific session
const initialize = (sessionId = 'system_default') => {
    if (clients.has(sessionId)) {
        const status = clientStatus.get(sessionId);
        if (status === 'initializing' || status === 'ready' || status === 'qr') {
            console.log(`[WhatsApp] Session ${sessionId} is already ${status}.`);
            return;
        }
    }

    console.log(`[WhatsApp] Initializing WhatsApp Client for session: ${sessionId}`);
    logToFile(`Initializing session: ${sessionId}`);
    
    clientStatus.set(sessionId, 'initializing');
    clientQrs.delete(sessionId);

    const client = new Client({
        authStrategy: new LocalAuth({ 
            clientId: sessionId, 
            dataPath: whatsappAuthPath 
        }),
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-zygote',
                '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
            ]
        },
        webVersionCache: {
            type: 'remote',
            remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
            strict: false
        }
    });

    client.on('qr', (qr) => {
        clientStatus.set(sessionId, 'qr');
        clientQrs.set(sessionId, qr);
        if (sessionId === 'system_default') {
            console.log(`\n--- WHATSAPP SYSTEM DEFAULT QR CODE ---`);
            qrcodeTerminal.generate(qr, { small: true });
            console.log('Scan the QR code above with your WhatsApp app to connect!\n');
        } else {
            console.log(`[WhatsApp] Session ${sessionId} generated a QR code.`);
        }
    });

    client.on('ready', () => {
        console.log(`[WhatsApp] Session ${sessionId} is READY!`);
        logToFile(`Session ${sessionId} is READY`);
        clientStatus.set(sessionId, 'ready');
        clientQrs.delete(sessionId);
    });

    client.on('auth_failure', msg => {
        console.error(`[WhatsApp] Session ${sessionId} Auth failure:`, msg);
        logToFile(`Session ${sessionId} Auth failure`, { message: msg });
        clientStatus.set(sessionId, 'disconnected');
        clientQrs.delete(sessionId);
    });

    client.on('disconnected', (reason) => {
        console.error(`[WhatsApp] Session ${sessionId} disconnected:`, reason);
        logToFile(`Session ${sessionId} disconnected`, { reason });
        clientStatus.set(sessionId, 'disconnected');
        clientQrs.delete(sessionId);

        // Attempt automatic restart if it is system_default
        if (sessionId === 'system_default') {
            console.log('Attempting to re-initialize system default client...');
            client.destroy().then(() => {
                initialize('system_default');
            }).catch(err => {
                console.error('Error destroying system default client:', err);
                initialize('system_default');
            });
        } else {
            client.destroy().catch(() => {});
            clients.delete(sessionId);
        }
    });

    client.initialize().catch(err => {
        console.error(`[WhatsApp] Session ${sessionId} initialization error:`, err.message);
        clientStatus.set(sessionId, 'disconnected');
    });

    clients.set(sessionId, client);
};

// Disconnect a session and clean up its filesystem credentials
const disconnect = async (sessionId) => {
    console.log(`[WhatsApp] Disconnecting session: ${sessionId}`);
    logToFile(`Disconnecting session: ${sessionId}`);
    
    const client = clients.get(sessionId);
    if (client) {
        try {
            await client.destroy();
        } catch (e) {
            console.error(`Error destroying client ${sessionId}:`, e.message);
        }
        clients.delete(sessionId);
    }
    
    clientStatus.set(sessionId, 'disconnected');
    clientQrs.delete(sessionId);

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

// Scan directory and boot all stored sessions
const initializeAll = () => {
    // 1. Initialize system_default
    initialize('system_default');

    // 2. Scan folder for other saved sessions
    try {
        if (fs.existsSync(whatsappAuthPath)) {
            const files = fs.readdirSync(whatsappAuthPath);
            files.forEach(file => {
                if (file.startsWith('session-')) {
                    const sessionId = file.replace('session-', '');
                    if (sessionId !== 'system_default') {
                        initialize(sessionId);
                    }
                }
            });
        }
    } catch (e) {
        console.error('[WhatsApp] Failed to read saved sessions directory:', e.message);
    }
};

// Resolve which client to use based on target and OTP rules
const resolveClient = (adminId, isOtp = false) => {
    if (isOtp) {
        return { client: clients.get('system_default'), id: 'system_default' };
    }

    if (adminId) {
        const adminSessionId = `admin_${adminId}`;
        const adminClient = clients.get(adminSessionId);
        const status = clientStatus.get(adminSessionId);
        
        if (adminClient && status === 'ready') {
            return { client: adminClient, id: adminSessionId };
        } else {
            // Strictly fail admin messages if the admin session is not ready, do not fallback to system_default
            return { client: null, id: adminSessionId };
        }
    }

    // Only use system_default when there is no admin context (e.g., system level actions)
    return { client: clients.get('system_default'), id: 'system_default' };
};

const sendWhatsapp = async (phone, message, adminId = null, isOtp = false) => {
    const { client, id } = resolveClient(adminId, isOtp);
    const status = clientStatus.get(id);

    if (!client || status !== 'ready') {
        logToFile(`sendWhatsapp Failed - Session ${id} not ready`, { phone, status });
        throw new Error(`WhatsApp client session "${id}" is not ready yet!`);
    }

    console.log(`[WhatsApp] Sending via session: ${id} to phone: ${phone}`);
    logToFile(`Sending via session: ${id} to: ${phone}`, { message });

    let cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.startsWith('0')) cleanPhone = cleanPhone.substring(1);
    if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;

    const targetId = `${cleanPhone}@c.us`;
    try {
        const result = await client.sendMessage(targetId, message);
        logToFile(`Message sent successfully from session ${id} to ${targetId}`);
        return result;
    } catch (e) {
        console.error(`[WhatsApp] Failed to send message from session ${id}:`, e);
        logToFile(`Error sending from session ${id} to ${cleanPhone}`, { error: e.message });
        
        if (e.message && e.message.includes('detached Frame')) {
            console.error(`[WhatsApp] Detached frame in session ${id}. Destroying client...`);
            clientStatus.set(id, 'disconnected');
            client.destroy().then(() => initialize(id)).catch(() => initialize(id));
        }
        
        throw new Error(e.message || "Failed to send WhatsApp message.");
    }
};

const sendWhatsappMedia = async (phone, fileUrl, caption, adminId = null) => {
    const { client, id } = resolveClient(adminId, false);
    const status = clientStatus.get(id);

    if (!client || status !== 'ready') {
        logToFile(`sendWhatsappMedia Failed - Session ${id} not ready`, { phone, fileUrl, status });
        throw new Error(`WhatsApp client session "${id}" is not ready yet!`);
    }

    console.log(`[WhatsApp] Sending media via session: ${id} to: ${phone}`);
    logToFile(`Sending media via session: ${id} to: ${phone}`, { fileUrl, caption });

    let cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.startsWith('0')) cleanPhone = cleanPhone.substring(1);
    if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;

    const targetId = `${cleanPhone}@c.us`;
    try {
        const isPdf = fileUrl.toLowerCase().includes('.pdf');
        let media;

        if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
            media = await MessageMedia.fromUrl(fileUrl);
        } else {
            let cleanedPath = fileUrl;
            if (!cleanedPath.includes(':') && !cleanedPath.startsWith('/') && !cleanedPath.startsWith('\\')) {
                 cleanedPath = path.join(__dirname, '../../', fileUrl);
            }
            if (fs.existsSync(cleanedPath)) {
                media = MessageMedia.fromFilePath(cleanedPath);
            } else {
                throw new Error(`Local file not found at: ${cleanedPath}`);
            }
        }

        const result = await client.sendMessage(targetId, media, { 
            caption: caption,
            sendMediaAsDocument: isPdf 
        });
        logToFile(`Media sent successfully from session ${id}`);
        return result;
    } catch (e) {
        console.error(`[WhatsApp] Failed to send media from session ${id}:`, e.message);
        logToFile(`Error sending media from session ${id} to ${cleanPhone}`, { error: e.message });
        
        if (e.message && e.message.includes('detached Frame')) {
            console.error(`[WhatsApp] Detached frame in session ${id}. Destroying client...`);
            clientStatus.set(id, 'disconnected');
            client.destroy().then(() => initialize(id)).catch(() => initialize(id));
        }
        
        throw e;
    }
};

const getStatus = (sessionId) => {
    return {
        status: clientStatus.get(sessionId) || 'disconnected',
        qr: clientQrs.get(sessionId) || null
    };
};

module.exports = {
    initialize,
    initializeAll,
    disconnect,
    sendWhatsapp,
    sendWhatsappMedia,
    getStatus,
    logToFile,
    isReady: (sessionId = 'system_default') => clientStatus.get(sessionId) === 'ready'
};
