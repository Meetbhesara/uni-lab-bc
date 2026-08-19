const puppeteer = require('puppeteer');

let browserInstance = null;
let browserPromise = null;

/**
 * Returns a shared, singleton Puppeteer browser instance.
 * Automatically re-launches Chromium if disconnected or crashed.
 */
const getBrowser = async () => {
    if (browserInstance && browserInstance.isConnected()) {
        return browserInstance;
    }

    if (browserPromise) {
        return browserPromise;
    }

    browserPromise = (async () => {
        try {
            console.log('[pdfGenerator] Launching shared Puppeteer browser instance...');
            const browser = await puppeteer.launch({
                headless: 'new',
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu',
                    '--disable-speech-api',
                    '--disable-background-networking',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-breakpad',
                    '--disable-component-extensions-with-background-pages',
                    '--disable-extensions',
                    '--disable-ipc-flooding-protection',
                    '--disable-renderer-backgrounding',
                    '--disable-sync'
                ]
            });

            browser.on('disconnected', () => {
                console.warn('[pdfGenerator] Shared browser instance disconnected. Resetting...');
                browserInstance = null;
                browserPromise = null;
            });

            browserInstance = browser;
            console.log('[pdfGenerator] Shared browser instance ready.');
            return browser;
        } catch (err) {
            console.error('[pdfGenerator] Failed to launch Puppeteer browser:', err);
            browserPromise = null;
            throw err;
        }
    })();

    return browserPromise;
};

/**
 * High-performance PDF generation from HTML string.
 * Uses shared browser tab pool and smart image load detection.
 *
 * @param {string} htmlContent - Pre-rendered HTML markup
 * @param {string} outputPath - Absolute path to save the generated PDF file
 * @param {object} [options] - PDF formatting options
 */
const generatePDFFromHTML = async (htmlContent, outputPath, options = {}) => {
    const startTime = Date.now();
    let page = null;
    try {
        const browser = await getBrowser();
        page = await browser.newPage();

        // 1. Set page content rapidly
        await page.setContent(htmlContent, {
            waitUntil: options.waitUntil || 'domcontentloaded',
            timeout: options.timeout || 10000
        });

        // 2. Wait for images to load if needed (0ms if already loaded, max 1.5s timeout)
        await page.evaluate(() => {
            return Promise.race([
                Promise.all(
                    Array.from(document.images)
                        .filter(img => !img.complete)
                        .map(img => new Promise(resolve => {
                            img.onload = resolve;
                            img.onerror = resolve;
                        }))
                ),
                new Promise(resolve => setTimeout(resolve, 1500))
            ]);
        }).catch(() => {});

        // 3. Render PDF
        const pdfOptions = {
            path: outputPath,
            format: options.format || 'A4',
            printBackground: options.printBackground !== false,
            preferCSSPageSize: options.preferCSSPageSize !== false,
            margin: options.margin || undefined
        };

        await page.pdf(pdfOptions);
        const duration = Date.now() - startTime;
        console.log(`[pdfGenerator] PDF generated successfully in ${duration}ms at: ${outputPath}`);
        return outputPath;
    } catch (error) {
        console.error('[pdfGenerator] Error generating PDF from HTML:', error);
        throw error;
    } finally {
        if (page) {
            await page.close().catch(() => {});
        }
    }
};

module.exports = {
    getBrowser,
    generatePDFFromHTML
};
