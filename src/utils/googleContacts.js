/**
 * Google Contacts Utility
 * Automatically saves new enquiries and user registrations to Google Contacts.
 * Deduplication check: Verifies if phone number already exists before adding.
 */

const { google } = require('googleapis');

const getOAuth2Client = () => {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REFRESH_TOKEN) {
        return null;
    }

    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        'https://developers.google.com/oauthplayground'
    );

    oauth2Client.setCredentials({
        refresh_token: process.env.GOOGLE_REFRESH_TOKEN
    });

    return oauth2Client;
};

/**
 * Extracts last 10 digits from any formatted phone string
 */
const getLast10Digits = (phone) => {
    const digits = (phone || '').toString().replace(/\D/g, '');
    return digits.length >= 10 ? digits.slice(-10) : digits;
};

/**
 * Checks if a contact with the given phone number already exists in Google Contacts
 * @param {Object} peopleService 
 * @param {string} phone 
 * @returns {Promise<Object|null>} Returns contact info if found, null otherwise
 */
const checkContactExistsInGoogle = async (peopleService, phone) => {
    const last10 = getLast10Digits(phone);
    if (!last10 || last10.length < 6) return null;

    // Search variations: 10-digit, +91 prefixed, and raw input
    const queries = Array.from(new Set([
        last10,
        '+91' + last10,
        (phone || '').toString().trim()
    ])).filter(Boolean);

    for (const q of queries) {
        try {
            const res = await peopleService.people.searchContacts({
                query: q,
                readMask: 'names,phoneNumbers'
            });

            if (res.data && res.data.results && res.data.results.length > 0) {
                for (const item of res.data.results) {
                    const person = item.person;
                    if (person && Array.isArray(person.phoneNumbers)) {
                        for (const p of person.phoneNumbers) {
                            if (p && p.value && getLast10Digits(p.value) === last10) {
                                const name = (person.names && person.names[0] && person.names[0].displayName) || 'Unnamed Contact';
                                return {
                                    exists: true,
                                    name,
                                    phone: p.value
                                };
                            }
                        }
                    }
                }
            }
        } catch (searchErr) {
            // Suppress search query syntax errors and try next query variant
        }
    }

    return null;
};

/**
 * Add a new contact to Google Contacts with deduplication check & full logging.
 * @param {Object} params
 * @param {string} params.name      - User's full name / contact person / company
 * @param {string} params.phone     - User's phone number
 * @param {string} [params.email]   - User's email (optional)
 * @param {string} [params.company] - User's company name (optional)
 * @param {string} [params.source]  - Source of contact (e.g. 'Product Enquiry', 'Quotation', 'Registration')
 */
const addToGoogleContacts = async ({ name, phone, email, company, source = 'Enquiry' }) => {
    const cleanPhone = (phone || '').toString().trim();
    if (!cleanPhone) {
        console.log(`[Google Contacts] ⚠️ No phone number provided for "${name || 'Unknown'}" (${source}). Skipped.`);
        return { success: false, reason: 'No phone number' };
    }

    const auth = getOAuth2Client();
    if (!auth) {
        console.warn(`[Google Contacts] ⚠️ Google OAuth credentials missing in .env. Skipped sync for "${name}".`);
        return { success: false, reason: 'Missing credentials' };
    }

    const peopleService = google.people({ version: 'v1', auth });

    try {
        console.log(`[Google Contacts] 🔍 Checking if phone "${cleanPhone}" exists in Google Contacts (${source})...`);

        // 1. Check if contact already exists in Google Contacts
        const existing = await checkContactExistsInGoogle(peopleService, cleanPhone);

        if (existing) {
            console.log(`[Google Contacts] ⏭️ SKIPPED: Phone "${cleanPhone}" ALREADY EXISTS in Google Contacts as "${existing.name}" (${existing.phone}). Duplicate NOT added.`);
            return {
                success: true,
                added: false,
                reason: 'Already exists in Google Contacts',
                existing
            };
        }

        // 2. If NOT in Google Contacts, create new contact
        console.log(`[Google Contacts] ➕ Phone "${cleanPhone}" not found in Google Contacts. Adding new contact: "${name}" [Source: ${source}, Company: "${company || 'N/A'}"]...`);

        const contactBody = {
            names: [{ givenName: name || 'Enquiry Client' }],
            phoneNumbers: [{ value: cleanPhone, type: 'mobile' }],
        };

        if (email && !email.includes('@noemail.com')) {
            contactBody.emailAddresses = [{ value: email.trim(), type: 'work' }];
        }

        if (company) {
            contactBody.organizations = [{ name: company.trim(), type: 'work' }];
        }

        const createRes = await peopleService.people.createContact({ requestBody: contactBody });

        console.log(`[Google Contacts] ✅ SUCCESS: Contact created in Google Contacts for "${name}" (${cleanPhone})! [Resource: ${createRes.data.resourceName || 'created'}]`);
        return {
            success: true,
            added: true,
            contact: createRes.data
        };
    } catch (err) {
        console.error(`[Google Contacts] ❌ ERROR syncing "${name}" (${cleanPhone}):`, err.message);
        return {
            success: false,
            error: err.message
        };
    }
};

module.exports = {
    addToGoogleContacts,
    checkContactExistsInGoogle,
    getLast10Digits
};
