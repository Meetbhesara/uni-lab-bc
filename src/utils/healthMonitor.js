const os = require('os');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { getApiStats } = require('../middlewares/apiTracker');
const { getAllWhatsappHealth } = require('./whatsappService');

// Optional Gemini AI Integration
let GoogleGenerativeAI;
try {
    GoogleGenerativeAI = require('@google/generative-ai').GoogleGenerativeAI;
} catch (e) {
    GoogleGenerativeAI = null;
}

const formatBytes = (bytes) => {
    if (!bytes || bytes === 0) return '0 MB';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
};

const getSystemMetrics = async () => {
    // 1. Memory Metrics
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const ramUsagePercent = Math.round((usedMem / totalMem) * 100);

    const nodeMemory = process.memoryUsage();

    // 2. CPU & Uptime
    const cpus = os.cpus();
    const cpuModel = cpus && cpus.length > 0 ? cpus[0].model : 'Generic CPU';
    const cpuCores = cpus ? cpus.length : 1;
    const uptimeSeconds = Math.floor(process.uptime());
    const loadAvg = os.loadavg();

    // 3. Storage / NAS Check
    const useNas = process.env.USE_NAS === 'true';
    const nasPath = process.env.NAS_BASE_PATH || '/volume1/WORK/SURVEY';
    const uploadsPath = path.join(process.cwd(), 'uploads');
    
    let storageStatus = {
        environment: useNas ? 'Synology NAS / Docker' : 'Local Machine',
        targetPath: useNas ? nasPath : uploadsPath,
        exists: false,
        accessible: false
    };

    try {
        const checkPath = useNas ? nasPath : uploadsPath;
        storageStatus.exists = fs.existsSync(checkPath);
        if (storageStatus.exists) {
            fs.accessSync(checkPath, fs.constants.R_OK | fs.constants.W_OK);
            storageStatus.accessible = true;
        }
    } catch (e) {
        storageStatus.accessible = false;
    }

    // 4. Database Ping Latency Test
    let dbStatus = {
        state: 'Disconnected',
        connected: false,
        pingMs: null,
        host: 'Unknown'
    };

    const mongoStateMap = { 0: 'Disconnected', 1: 'Connected', 2: 'Connecting', 3: 'Disconnecting' };
    dbStatus.state = mongoStateMap[mongoose.connection.readyState] || 'Unknown';
    dbStatus.connected = mongoose.connection.readyState === 1;

    if (dbStatus.connected && mongoose.connection.db) {
        try {
            const startPing = Date.now();
            await mongoose.connection.db.admin().ping();
            dbStatus.pingMs = Date.now() - startPing;
            dbStatus.host = mongoose.connection.host || 'MongoDB Cluster';
        } catch (pingErr) {
            dbStatus.pingMs = -1;
        }
    }

    // 5. WhatsApp Health
    const whatsappHealth = getAllWhatsappHealth();

    // 6. API Performance Statistics
    const apiStats = getApiStats();

    return {
        timestamp: new Date().toISOString(),
        memory: {
            total: formatBytes(totalMem),
            free: formatBytes(freeMem),
            used: formatBytes(usedMem),
            usagePercent: ramUsagePercent,
            heapUsed: formatBytes(nodeMemory.heapUsed),
            heapTotal: formatBytes(nodeMemory.heapTotal),
            rss: formatBytes(nodeMemory.rss)
        },
        system: {
            platform: process.platform,
            arch: process.arch,
            cpuModel,
            cpuCores,
            uptimeSeconds,
            loadAvg
        },
        storage: storageStatus,
        database: dbStatus,
        whatsapp: whatsappHealth,
        apiPerformance: apiStats
    };
};

// Generate AI Diagnostics & Optimization Advice
const generateAiDiagnostics = async (metrics) => {
    const apiKey = process.env.GEMINI_API_KEY;

    // A. Use Gemini AI if key is available
    if (apiKey && GoogleGenerativeAI) {
        try {
            const genAI = new GoogleGenerativeAI(apiKey);
            // Try newest model gemini-3.6-flash with fallbacks
            const modelNames = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-2.0-flash", "gemini-flash-latest"];
            let responseText = null;

            for (const mName of modelNames) {
                try {
                    const model = genAI.getGenerativeModel({ model: mName });
                    const prompt = `Analyze this live server and backend API performance telemetry:
${JSON.stringify(metrics, null, 2)}

Provide a concise, professional diagnostic report formatted cleanly in markdown:
1. Overall Health Score (e.g. 95% Optimal)
2. Immediate Speed & Indexing Recommendations
3. Memory / Storage / NAS Optimization Tips
4. WhatsApp Connection Health Note`;

                    const result = await model.generateContent(prompt);
                    responseText = result.response.text();
                    if (responseText) break;
                } catch (mErr) {
                    // try next model name
                }
            }

            if (responseText) {
                return {
                    mode: 'Gemini AI Live Analysis',
                    recommendations: responseText
                };
            }
        } catch (err) {
            console.error('Gemini AI Query Failed, falling back to Rule Engine', err.message);
        }
    }

    // B. Smart Built-in Rule Engine (Offline Fallback)
    const suggestions = [];

    // RAM check
    if (metrics.memory.usagePercent > 85) {
        suggestions.push(`🔴 **High RAM Usage (${metrics.memory.usagePercent}%)**: Server memory is under pressure. Consider restarting the process or upgrading server RAM.`);
    } else {
        suggestions.push(`🟢 **Memory Optimal (${metrics.memory.usagePercent}%)**: RAM allocation is healthy (${metrics.memory.used} used of ${metrics.memory.total}).`);
    }

    // Database Ping check
    if (metrics.database.pingMs > 200) {
        suggestions.push(`🟡 **Database Latency (${metrics.database.pingMs}ms)**: MongoDB ping latency is high. Verify network closeness to MongoDB cluster.`);
    } else if (metrics.database.connected) {
        suggestions.push(`🟢 **Database Latency (${metrics.database.pingMs || 10}ms)**: MongoDB connection is fast and healthy.`);
    } else {
        suggestions.push(`🔴 **Database Disconnected**: Server cannot reach MongoDB.`);
    }

    // Slow API check
    if (metrics.apiPerformance.slowRoutes && metrics.apiPerformance.slowRoutes.length > 0) {
        const topSlow = metrics.apiPerformance.slowRoutes.slice(0, 3).map(r => `\`${r.method} ${r.path}\` (${r.avgMs}ms)`).join(', ');
        suggestions.push(`🔴 **Slow APIs Detected**: Routes exceeding 400ms target: ${topSlow}. Add MongoDB compound indexes or use \`.lean()\` to speed them up.`);
    } else {
        suggestions.push(`🟢 **API Speed Optimal**: All tracked routes are responding under fast threshold benchmarks.`);
    }

    // WhatsApp check
    if (metrics.whatsapp.activeSessionsCount > 0) {
        suggestions.push(`🟢 **WhatsApp Active**: ${metrics.whatsapp.activeSessionsCount} active session(s) online & ready.`);
    } else {
        suggestions.push(`🟡 **WhatsApp Disconnected / Idle**: Session system_default is not in 'ready' state. Open WhatsApp Settings to link QR code if needed.`);
    }

    // Storage / NAS check
    if (metrics.storage.environment.includes('NAS')) {
        suggestions.push(`📁 **Synology NAS Active**: Mapping to volume \`${metrics.storage.targetPath}\` is ${metrics.storage.accessible ? 'accessible & writeable' : 'not writable'}.`);
    } else {
        suggestions.push(`📁 **Local Storage Active**: Storage path \`${metrics.storage.targetPath}\` is operating normally.`);
    }

    return {
        mode: 'Automated System Rule Engine',
        recommendations: suggestions.join('\n\n')
    };
};

module.exports = { getSystemMetrics, generateAiDiagnostics };
