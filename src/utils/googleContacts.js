/**
 * Google Contacts Utility
 * Automatically saves new user registrations as contacts in the central Gmail account.
 */

const { google } = require('googleapis');

const getOAuth2Client = () => {
    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        'http://localhost:3333/oauth2callback'
    );

    oauth2Client.setCredentials({
        refresh_token: process.env.GOOGLE_REFRESH_TOKEN
    });

    return oauth2Client;
};

/**
 * Add a new contact to the central Gmail account.
 * @param {Object} params
 * @param {string} params.name      - User's full name
 * @param {string} params.phone     - User's phone number
 * @param {string} [params.email]   - User's email (optional)
 * @param {string} [params.company] - User's company name (optional)
 */
const addToGoogleContacts = async ({ name, phone, email, company }) => {
    try {
        const auth = getOAuth2Client();
        const peopleService = google.people({ version: 'v1', auth });

        const contactBody = {
            names: [{ givenName: name || 'Unknown' }],
            phoneNumbers: [{ value: phone, type: 'mobile' }],
        };

        if (email && !email.includes('@noemail.com')) {
            contactBody.emailAddresses = [{ value: email, type: 'work' }];
        }

        if (company) {
            contactBody.organizations = [{ name: company, type: 'work' }];
        }

        await peopleService.people.createContact({ requestBody: contactBody });

        console.log(`✅ Google Contact saved: ${name} (${phone})`);
        return true;
    } catch (err) {
        // Log error but don't block user registration
        console.error('⚠️ Google Contacts sync failed (non-critical):', err.message);
        return false;
    }
};

module.exports = { addToGoogleContacts };
