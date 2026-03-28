const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

let client;
let isReady = false;

const initialize = () => {
    console.log('Initializing WhatsApp Client...');
    client = new Client({
        authStrategy: new LocalAuth({ dataPath: './whatsapp_auth' }),
        puppeteer: {
            handleSIGINT: false,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
    });

    client.on('qr', (qr) => {
        console.log('\n--- WHATSAPP QR CODE ---');
        qrcode.generate(qr, { small: true });
        console.log('Scan the QR code above with your WhatsApp app on your phone to connect!\n');
    });

    client.on('ready', () => {
        console.log('WhatsApp Web Client is READY!');
        isReady = true;
    });

    client.on('auth_failure', msg => {
        console.error('WhatsApp Auth failure:', msg);
    });

    client.initialize();
};

const fs = require('fs');
const path = require('path');

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

const sendWhatsapp = async (phone, message) => {
    if (!isReady) {
        logToFile("sendWhatsapp Failed - Client NOT READY", { phone });
        throw new Error("WhatsApp client is not ready yet!");
    }
    
    console.log(`[WhatsApp] Preparing to send text to: ${phone}`);
    logToFile(`Preparing to send text to: ${phone}`, { message });

    let cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.startsWith('0')) cleanPhone = cleanPhone.substring(1);
    if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone; 

    let targetId = `${cleanPhone}@c.us`;
    try {
        console.log(`[WhatsApp] Sending message to: ${targetId}`);
        console.log(`[WhatsApp] Sending message to: ${targetId}`);
        const result = await client.sendMessage(targetId, message);
        logToFile(`Message sent successfully to ${targetId}`);
        return result;
    } catch (e) {
        console.error(`[WhatsApp] Failed to send text:`, e);
        logToFile(`Exception caught sending text to ${cleanPhone}:`, { error: e.message, stack: e.stack });
        throw new Error(e.message || "Failed to send WhatsApp message.");
    }
};

const sendWhatsappMedia = async (phone, fileUrl, caption) => {
    if (!isReady) {
        logToFile("sendWhatsappMedia Failed - Client NOT READY", { phone, fileUrl });
        throw new Error("WhatsApp client is not ready yet!");
    }
    
    console.log(`[WhatsApp] Preparing to send media to: ${phone}, file: ${fileUrl}`);
    logToFile(`Preparing to send media to: ${phone}`, { fileUrl, caption });

    let cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.startsWith('0')) cleanPhone = cleanPhone.substring(1);
    if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;

    let targetId = `${cleanPhone}@c.us`;
    try {
        const isPdf = fileUrl.toLowerCase().includes('.pdf');
        let media;

        if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
            logToFile(`Fetching via URL: ${fileUrl}`);
            media = await MessageMedia.fromUrl(fileUrl);
        } else {
            const fs = require('fs');
            const path = require('path');
            let cleanedPath = fileUrl;
            
            if (!cleanedPath.includes(':') && !cleanedPath.startsWith('/') && !cleanedPath.startsWith('\\')) {
                 cleanedPath = path.join(__dirname, '../../', fileUrl);
            }
            
            logToFile(`Fetching via Local Path: ${cleanedPath}`);
            if (fs.existsSync(cleanedPath)) {
                media = MessageMedia.fromFilePath(cleanedPath);
                console.log(`[WhatsApp] Loaded media from local path: ${cleanedPath}`);
                logToFile(`Successfully loaded Local Path media`);
            } else {
                logToFile(`Local file NOT FOUND at path: ${cleanedPath}`);
                throw new Error(`Local file not found at: ${cleanedPath}`);
            }
        }

        console.log(`[WhatsApp] Sending media file to: ${targetId} (isPdf: ${isPdf})`);
        logToFile(`Sending media block...`);
        const result = await client.sendMessage(targetId, media, { 
            caption: caption,
            sendMediaAsDocument: isPdf 
        });
        logToFile(`Media sent successfully.`);
        return result;
    } catch (e) {
        console.error("[WhatsApp] Media send caught error:", e.message);
        logToFile(`Exception caught sending media to ${cleanPhone}:`, { error: e.message, stack: e.stack });
        throw e;
    }
};

module.exports = { initialize, sendWhatsapp, sendWhatsappMedia, logToFile, isReady: () => isReady };
