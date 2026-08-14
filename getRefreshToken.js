/**
 * ONE-TIME SCRIPT — Run this once to get your Google refresh token.
 * This opens a browser for you to authorize with your central Gmail account.
 * After running, copy the GOOGLE_REFRESH_TOKEN value into your .env file.
 *
 * Usage:
 *   node getRefreshToken.js
 *
 * Then open: http://localhost:3333 in your browser
 */

const http = require('http');
const url = require('url');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:3333/oauth2callback';

// Scopes needed for Google Contacts (People API)
const SCOPES = [
    'https://www.googleapis.com/auth/contacts',
    'https://www.googleapis.com/auth/contacts.other.readonly'
].join(' ');

// Build the Google Auth URL
const authUrl =
    `https://accounts.google.com/o/oauth2/v2/auth` +
    `?client_id=${encodeURIComponent(CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&access_type=offline` +
    `&prompt=consent`;

// Simple HTTP server to catch the OAuth callback
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);

    if (parsedUrl.pathname === '/') {
        // Homepage — redirect to Google
        res.writeHead(302, { Location: authUrl });
        res.end();
        return;
    }

    if (parsedUrl.pathname === '/oauth2callback') {
        const code = parsedUrl.query.code;

        if (!code) {
            res.writeHead(400);
            res.end('No authorization code found in URL.');
            return;
        }

        try {
            // Exchange code for tokens
            const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    code,
                    client_id: CLIENT_ID,
                    client_secret: CLIENT_SECRET,
                    redirect_uri: REDIRECT_URI,
                    grant_type: 'authorization_code'
                })
            });

            const tokens = await tokenResponse.json();

            if (tokens.error) {
                res.writeHead(400);
                res.end(`<h2>Error: ${tokens.error_description || tokens.error}</h2>`);
                return;
            }

            const html = `
<!DOCTYPE html>
<html>
<head><title>Refresh Token</title>
<style>
  body { font-family: Arial, sans-serif; padding: 40px; background: #f0fdf4; }
  h1 { color: #16a34a; }
  .box { background: #fff; border: 2px solid #16a34a; border-radius: 8px; padding: 20px; margin-top: 20px; }
  .token { background: #f1f5f9; padding: 15px; border-radius: 4px; word-break: break-all; font-family: monospace; font-size: 13px; }
  .instruction { background: #fefce8; border: 1px solid #facc15; padding: 15px; border-radius: 4px; margin-top: 20px; }
</style>
</head>
<body>
  <h1>✅ Authorization Successful!</h1>
  <div class="box">
    <p><strong>Copy this into your <code>.env</code> file in <code>uni-bc</code>:</strong></p>
    <div class="token">GOOGLE_CLIENT_ID=${CLIENT_ID}<br>GOOGLE_CLIENT_SECRET=${CLIENT_SECRET}<br>GOOGLE_REFRESH_TOKEN=${tokens.refresh_token || 'NOT_RETURNED_USE_ACCESS_TOKEN'}</div>
  </div>
  <div class="instruction">
    <strong>⚠️ Important:</strong><br>
    ${!tokens.refresh_token ? '<span style="color:red">Refresh token was NOT returned. You may need to go to <a href="https://myaccount.google.com/permissions" target="_blank">Google Account Permissions</a>, remove this app, and run this script again to force a new refresh token.</span>' : 'Refresh token received successfully! Add the values above to your .env file.'}
  </div>
  <p>You can now close this tab and stop the script (Ctrl+C).</p>
  <hr/>
  <p style="font-size:12px;color:#888">Full token response (for reference): <br><pre>${JSON.stringify(tokens, null, 2)}</pre></p>
</body>
</html>`;

            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(html);

            // Print to console too
            console.log('\n✅ SUCCESS! Add these to your .env file:\n');
            console.log(`GOOGLE_CLIENT_ID=${CLIENT_ID}`);
            console.log(`GOOGLE_CLIENT_SECRET=${CLIENT_SECRET}`);
            console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
            console.log('\nYou can now stop this script with Ctrl+C\n');

        } catch (err) {
            res.writeHead(500);
            res.end(`Error exchanging code: ${err.message}`);
        }
        return;
    }

    res.writeHead(404);
    res.end('Not found');
});

server.listen(3333, () => {
    console.log('\n🚀 Token generator running!');
    console.log('👉 Open this URL in your browser:\n');
    console.log('   http://localhost:3333\n');
    console.log('Make sure you sign in with your CENTRAL Gmail account (the one where you want contacts stored).\n');
});
