const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Resolve path to storage (respecting NAS vs Local)
const useNasFlag = process.env.USE_NAS;
const nasRoot = process.env.NAS_BASE_PATH || '/app/storage';
const whatsappAuthPath = useNasFlag === 'true'
    ? path.join(nasRoot, 'whatsapp_auth')
    : path.join(process.cwd(), 'whatsapp_auth');

if (!fs.existsSync(whatsappAuthPath)) {
    fs.mkdirSync(whatsappAuthPath, { recursive: true });
}

// ── Kill orphaned Chrome processes holding locks on session folder ───────────
const killOrphanedChrome = (sessionId) => {
    try {
        const targetPattern = `session-${sessionId}`;
        console.log(`[WhatsApp] 🔍 Checking for orphaned Chrome processes locking session: ${sessionId}`);
        if (process.platform === 'win32') {
            const psScript = `Get-CimInstance Win32_Process -Filter "name = 'chrome.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${targetPattern}') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
            const encodedScript = Buffer.from(psScript, 'utf16le').toString('base64');
            execSync(`powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encodedScript}`, { stdio: 'ignore' });
        } else {
            execSync(`pkill -9 -f "${targetPattern}"`, { stdio: 'ignore' });
        }
    } catch (e) {
        // Silently ignore if no matching process found or permission issue
    }
};

// ── Clean stale Chrome lock files (RECURSIVE) ───────────────────────────────
// Chrome leaves SingletonLock files when a Docker container is killed/restarted.
// These locks are stored inside nested subdirectories of the Chrome profile.
// We recursively walk the entire session folder to find and delete them all.
const LOCK_FILES = ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'DevToolsActivePort', 'LOCK', 'LOCK.lock'];

const deleteLockFilesIn = (dir) => {
    if (!fs.existsSync(dir)) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.forEach(entry => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            deleteLockFilesIn(fullPath); // recurse into subdirectories
        } else if (LOCK_FILES.includes(entry.name)) {
            try {
                fs.unlinkSync(fullPath);
                console.log(`[WhatsApp] 🧹 Deleted lock file: ${fullPath}`);
            } catch (err) {
                // Ignore EBUSY or ENOENT errors when cleaning stale locks
            }
        }
    });
};

const cleanChromeLock = (sessionId) => {
    killOrphanedChrome(sessionId);
    const sessionPath = path.join(whatsappAuthPath, `session-${sessionId}`);
    console.log(`[WhatsApp] 🧹 Scanning for stale Chrome locks in: ${sessionPath}`);
    deleteLockFilesIn(sessionPath);
};
// ───────────────────────────────────────────────────────────────────

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

// Clear safety fallback timer
const clearInitTimer = (sessionId) => {
    if (initializeTimers.has(sessionId)) {
        clearTimeout(initializeTimers.get(sessionId));
        initializeTimers.delete(sessionId);
    }
};

// Gracefully destroy all clients on server shutdown or restart
const destroyAll = async () => {
    console.log('[WhatsApp] 🛑 Destroying all active WhatsApp clients...');
    for (const [sessionId, client] of clients.entries()) {
        try {
            await client.destroy();
            console.log(`[WhatsApp] Closed client ${sessionId}`);
        } catch (e) {
            console.error(`[WhatsApp] Error destroying client ${sessionId}:`, e.message);
        }
    }
    clients.clear();
    clientStatus.clear();
    clientQrs.clear();
};

// Register graceful shutdown listeners
const handleGracefulShutdown = async (signal) => {
    console.log(`[WhatsApp] Received ${signal}. Closing browser instances...`);
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

// Initialize a specific session with automatic retries
const initialize = async (sessionId = 'system_default', attempt = 1, maxAttempts = 3) => {
    if (clients.has(sessionId)) {
        const status = clientStatus.get(sessionId);
        if (status === 'initializing' || status === 'ready' || status === 'qr') {
            console.log(`[WhatsApp] Session ${sessionId} is already ${status}.`);
            return;
        }
        // Clean up old instance if disconnected to release Chrome locks
        const oldClient = clients.get(sessionId);
        clients.delete(sessionId);
        if (oldClient) {
            try {
                await oldClient.destroy();
            } catch (e) {}
        }
    }

    console.log(`[WhatsApp] Initializing WhatsApp Client for session: ${sessionId} (attempt ${attempt}/${maxAttempts})`);
    logToFile(`Initializing session: ${sessionId} (attempt ${attempt}/${maxAttempts})`);

    // 🧹 Always clean stale Chrome lock files before starting
    cleanChromeLock(sessionId);

    clientStatus.set(sessionId, 'initializing');
    clientQrs.delete(sessionId);

    // Clear existing timer if any
    clearInitTimer(sessionId);

    // Set 300-second (5 minute) fallback safety timeout
    const fallbackTimer = setTimeout(async () => {
        if (clientStatus.get(sessionId) === 'initializing') {
            console.warn(`[WhatsApp] ⏱️ Session ${sessionId} initialization timed out after 300s. Resetting status to disconnected.`);
            logToFile(`Session ${sessionId} initialization timed out after 300s`);
            clientStatus.set(sessionId, 'disconnected');
            const stuckClient = clients.get(sessionId);
            if (stuckClient) {
                clients.delete(sessionId);
                try {
                    await stuckClient.destroy();
                } catch (err) {
                    console.error(`[WhatsApp] Error destroying timed-out client ${sessionId}:`, err.message);
                }
            }
        }
        initializeTimers.delete(sessionId);
    }, 300000);
    initializeTimers.set(sessionId, fallbackTimer);

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
                '--ignore-profile-dir-locked',   // force-ignore stale lock files
                '--disable-features=IsolateOrigins,site-per-process',
                '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
            ]
        },
        webVersionCache: {
            type: 'local'
        }
    });

    // Save client instance immediately
    clients.set(sessionId, client);

    client.on('qr', (qr) => {
        clearInitTimer(sessionId);
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
        clearInitTimer(sessionId);
        console.log(`[WhatsApp] Session ${sessionId} is READY!`);
        logToFile(`Session ${sessionId} is READY`);
        clientStatus.set(sessionId, 'ready');
        clientQrs.delete(sessionId);
    });

    client.on('auth_failure', msg => {
        clearInitTimer(sessionId);
        console.error(`[WhatsApp] Session ${sessionId} Auth failure:`, msg);
        logToFile(`Session ${sessionId} Auth failure`, { message: msg });
        clientStatus.set(sessionId, 'disconnected');
        clientQrs.delete(sessionId);
    });

    client.on('disconnected', (reason) => {
        clearInitTimer(sessionId);
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

    client.initialize().catch(async (err) => {
        clearInitTimer(sessionId);
        console.error(`[WhatsApp] Session ${sessionId} initialization error (attempt ${attempt}/${maxAttempts}):`, err.message);
        
        // Clean up stuck client instance safely
        clients.delete(sessionId);
        try { await client.destroy(); } catch (e) {}

        if (attempt < maxAttempts) {
            console.log(`[WhatsApp] ⏳ Retrying session ${sessionId} in 3 seconds...`);
            setTimeout(() => {
                initialize(sessionId, attempt + 1, maxAttempts);
            }, 3000);
        } else {
            clientStatus.set(sessionId, 'disconnected');
            clientQrs.delete(sessionId);
            console.error(`[WhatsApp] ❌ Session ${sessionId} failed to initialize after ${maxAttempts} attempts.`);
        }
    });
};

// Disconnect a session and clean up its filesystem credentials
const disconnect = async (sessionId) => {
    console.log(`[WhatsApp] Disconnecting session: ${sessionId}`);
    logToFile(`Disconnecting session: ${sessionId}`);
    
    clearInitTimer(sessionId);
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

    // Give process brief moment to release handles before deleting files
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Delete session files on explicit disconnect
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
    console.log('[WhatsApp] 🚀 Starting all sessions — cleaning stale locks first...');

    // Pre-clean ALL session lock files before any initialization
    // This is critical on Docker container restarts
    try {
        if (fs.existsSync(whatsappAuthPath)) {
            const files = fs.readdirSync(whatsappAuthPath);
            files.forEach(file => {
                if (file.startsWith('session-')) {
                    const sessionId = file.replace('session-', '');
                    cleanChromeLock(sessionId);
                }
            });
        }
    } catch (e) {
        console.warn('[WhatsApp] Pre-clean warning:', e.message);
    }

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

        // 1. Try to resolve the URL locally (handles NAS vs Local paths)
        let localPath = null;
        if (fileUrl) {
            let relativePath = fileUrl.trim();
            if (relativePath.startsWith('http://') || relativePath.startsWith('https://')) {
                try {
                    const urlObj = new URL(relativePath);
                    relativePath = urlObj.pathname;
                } catch (e) {
                    console.error('[WhatsApp] Failed to parse URL:', relativePath);
                }
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
            
            // Fallback if not found yet
            if ((!localPath || !fs.existsSync(localPath)) && relativePath.startsWith('/api/')) {
                localPath = path.join(process.cwd(), relativePath.replace('/api/', ''));
            }
        }
        
        // 2. Load the media (prioritize direct filesystem access to bypass network loopback issues)
        if (localPath && fs.existsSync(localPath)) {
            console.log(`[WhatsApp] Resolving media locally from path: ${localPath}`);
            media = MessageMedia.fromFilePath(localPath);
        } else if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
            media = await MessageMedia.fromUrl(fileUrl);
        } else {
            let cleanedPath = fileUrl;
            if (!cleanedPath.includes(':') && !cleanedPath.startsWith('/') && !cleanedPath.startsWith('\\')) {
                 cleanedPath = path.join(__dirname, '../../', fileUrl);
            }
            if (fs.existsSync(cleanedPath)) {
                media = MessageMedia.fromFilePath(cleanedPath);
            } else {
                throw new Error(`Local file not found at: ${cleanedPath} (Tried localPath: ${localPath})`);
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
    return {
        activeSessionsCount: sessions.filter(s => s.isReady).length,
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
