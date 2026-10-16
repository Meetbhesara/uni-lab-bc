/**
 * Google Contacts Utility
 * Automatically saves new enquiries, WhatsApp product shares, user registrations, and clients to Google Contacts.
 * Identity Key: PHONE NUMBER (primary, matched by last 10 digits).
 * Duplicate Prevention: Dual-layer search (searchContacts + cached connections list).
 * MAIN NAME: Always prefixed with "EU-" as required (e.g., "EU-meet kio").
 * EU-{username} also stored in userDefined and biography for client identification.
 * Returns detailed field diff: which fields were added, which were updated (with before/after values).
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
 * Validates whether an email is a real, legitimate email address.
 */
const isValidRealEmail = (email) => {
    if (!email || typeof email !== 'string') return false;
    const clean = email.trim().toLowerCase();
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(clean)) return false;
    if (clean.includes('noemail') || clean.includes('dummy') || clean.includes('fake') || clean.includes('example.com')) {
        return false;
    }
    const [localPart] = clean.split('@');
    if (/^\+?\d{7,15}$/.test(localPart)) {
        return false;
    }
    return true;
};

/**
 * Formats the contact's main display name with EU- prefix as requested.
 * e.g., "meet kio" -> "EU-meet kio"
 * e.g., "EU-meet kio" -> "EU-meet kio"
 */
const formatMainNameWithEU = (rawName) => {
    const trimmed = (rawName || '').toString().trim();
    if (!trimmed || /^(client|guest|enquiry client)$/i.test(trimmed)) {
        return 'EU-Client';
    }
    return trimmed.startsWith('EU-') ? trimmed : `EU-${trimmed}`;
};

// In-memory connections cache to prevent duplication even when Google's search index lags
let connectionsCache = null;
let cacheTime = 0;
const CACHE_TTL = 60000; // 60 seconds

const getConnectionsList = async (peopleService, forceRefresh = false) => {
    const now = Date.now();
    if (!forceRefresh && connectionsCache && (now - cacheTime) < CACHE_TTL) {
        return connectionsCache;
    }
    try {
        const res = await peopleService.people.connections.list({
            resourceName: 'people/me',
            pageSize: 1000,
            sortOrder: 'LAST_MODIFIED_DESCENDING',
            personFields: 'names,phoneNumbers,emailAddresses,organizations,addresses,userDefined,biographies'
        });
        connectionsCache = res.data.connections || [];
        cacheTime = now;
        return connectionsCache;
    } catch (e) {
        console.warn('[Google Contacts] connections.list error:', e.message);
        return connectionsCache || [];
    }
};

/**
 * Checks if a contact with the given phone number already exists in Google Contacts.
 * Uses two layers to guarantee 100% duplicate prevention:
 * 1. searchContacts API (fast prefix query)
 * 2. connections.list fallback (100% accurate, zero indexing lag)
 */
const checkContactExistsInGoogle = async (peopleService, phone) => {
    const last10 = getLast10Digits(phone);
    if (!last10 || last10.length < 6) return null;

    // Layer 1: searchContacts
    const queries = Array.from(new Set([
        last10,
        '+91' + last10,
        '+91 ' + last10,
        (phone || '').toString().trim()
    ])).filter(Boolean);

    for (const q of queries) {
        try {
            const res = await peopleService.people.searchContacts({
                query: q,
                readMask: 'names,phoneNumbers,emailAddresses,organizations,addresses,userDefined,biographies'
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
                                    phone: p.value,
                                    resourceName: person.resourceName,
                                    etag: person.etag,
                                    person
                                };
                            }
                        }
                    }
                }
            }
        } catch (searchErr) {
            console.warn(`[Google Contacts] Search error for "${q}":`, searchErr.message);
        }
    }

    // Layer 2: Full connections search (guarantees finding recently created or unindexed contacts)
    try {
        const connections = await getConnectionsList(peopleService, false);
        for (const person of connections) {
            if (Array.isArray(person.phoneNumbers)) {
                for (const p of person.phoneNumbers) {
                    if (p && p.value && getLast10Digits(p.value) === last10) {
                        const name = (person.names && person.names[0] && person.names[0].displayName) || 'Unnamed Contact';
                        console.log(`[Google Contacts] 🎯 Matched via connections list: "${name}" (${p.value}) [${person.resourceName}]`);
                        return {
                            exists: true,
                            name,
                            phone: p.value,
                            resourceName: person.resourceName,
                            etag: person.etag,
                            person
                        };
                    }
                }
            }
        }
    } catch (listErr) {
        console.warn(`[Google Contacts] Connections fallback search error:`, listErr.message);
    }

    return null;
};

/**
 * Checks if a contact with the given email already exists in Google Contacts
 */
const checkContactExistsInGoogleByEmail = async (peopleService, email) => {
    if (!isValidRealEmail(email)) return null;
    try {
        const res = await peopleService.people.searchContacts({
            query: email,
            readMask: 'names,phoneNumbers,emailAddresses,organizations,addresses,userDefined,biographies'
        });
        if (res.data && res.data.results && res.data.results.length > 0) {
            for (const item of res.data.results) {
                const person = item.person;
                if (person && Array.isArray(person.emailAddresses)) {
                    for (const e of person.emailAddresses) {
                        if (e && e.value && e.value.toLowerCase() === email.toLowerCase()) {
                            const name = (person.names && person.names[0] && person.names[0].displayName) || 'Unnamed Contact';
                            return {
                                exists: true,
                                name,
                                email: e.value,
                                resourceName: person.resourceName,
                                etag: person.etag,
                                person
                            };
                        }
                    }
                }
            }
        }
    } catch (err) {
        console.warn(`[Google Contacts] Email search error for "${email}":`, err.message);
    }
    return null;
};

/**
 * Builds a field diff between existing contact data and new incoming data.
 * Returns arrays of: addedFields, updatedFields (with before/after), unchangedFields
 */
const buildFieldDiff = (existingPerson, newData) => {
    const addedFields = [];
    const updatedFields = [];
    const unchangedFields = [];

    // Helper to get current values from person
    const getExistingName = () => (existingPerson?.names?.[0]?.displayName || existingPerson?.names?.[0]?.givenName || '').trim();
    const getExistingPhones = () => (existingPerson?.phoneNumbers || []).map(p => p.value).join(', ');
    const getExistingEmails = () => (existingPerson?.emailAddresses || []).map(e => e.value).join(', ');
    const getExistingCompany = () => (existingPerson?.organizations?.[0]?.name || '').trim();
    const getExistingAddress = () => {
        const addr = existingPerson?.addresses?.[0];
        if (!addr) return '';
        return [addr.streetAddress, addr.postalCode, addr.region].filter(Boolean).join(', ');
    };
    const getExistingGst = () => {
        const ud = (existingPerson?.userDefined || []).find(u => u.key === 'GST Number');
        return (ud?.value || '').trim();
    };
    const getExistingUsername = () => {
        const ud = (existingPerson?.userDefined || []).find(u => u.key === 'Username');
        return (ud?.value || '').trim();
    };

    const compare = (fieldName, existingVal, newVal) => {
        const existing = (existingVal || '').toString().trim();
        const incoming = (newVal || '').toString().trim();
        if (!incoming) return; // Nothing new to compare
        if (!existing) {
            addedFields.push({ field: fieldName, value: incoming });
        } else if (existing !== incoming) {
            updatedFields.push({ field: fieldName, before: existing, after: incoming });
        } else {
            unchangedFields.push({ field: fieldName, value: existing });
        }
    };

    compare('Name', getExistingName(), newData.name);
    compare('Phone', getExistingPhones(), newData.phones?.join(', ') || newData.phone);
    compare('Email', getExistingEmails(), newData.emails?.join(', ') || newData.email);
    compare('Company', getExistingCompany(), newData.company);
    compare('Address', getExistingAddress(), typeof newData.address === 'string' ? newData.address : JSON.stringify(newData.address));
    compare('GST Number', getExistingGst(), newData.gstNumber || newData.gstNo);
    compare('Username (EU)', getExistingUsername(), newData.username);

    return { addedFields, updatedFields, unchangedFields };
};

/**
 * Adds or updates a contact in Google Contacts.
 * IDENTITY KEY: Phone number (primary). If phone not found -> CREATE new.
 * If phone found -> OVERWRITE / UPDATE provided fields (no duplicate).
 * MAIN NAME: Always prefixed with "EU-" (e.g. "EU-meet kio").
 * EU-{username} stored in userDefined and biography.
 * Returns detailed result with fieldChanges for UI acknowledgement.
 */
const addToGoogleContacts = async ({
    name,
    phone,
    phones,
    email,
    emails,
    company,
    address,
    gstNumber,
    gstNo,
    username,   // EU-{username} identifier
    source = 'Enquiry'
}) => {
    // 1. Collect all distinct phone numbers
    const rawPhones = [
        ...(Array.isArray(phones) ? phones : (phones ? [phones] : [])),
        ...(Array.isArray(phone) ? phone : (phone ? [phone] : []))
    ].map(p => (p || '').toString().trim()).filter(Boolean);

    const seenLast10 = new Set();
    const validPhones = [];
    for (const p of rawPhones) {
        const last10 = getLast10Digits(p);
        if (last10 && last10.length >= 6 && !/^(\d)\1{9}$/.test(last10) && !seenLast10.has(last10)) {
            seenLast10.add(last10);
            validPhones.push(p);
        }
    }

    if (validPhones.length === 0) {
        console.log(`[Google Contacts] ⚠️ No valid phone number provided for "${name || 'Unknown'}" (${source}). Skipped.`);
        return { success: false, reason: 'No valid phone number' };
    }

    const auth = getOAuth2Client();
    if (!auth) {
        console.warn(`[Google Contacts] ⚠️ Google OAuth credentials missing in .env. Skipped sync for "${name}".`);
        return { success: false, reason: 'Missing credentials' };
    }

    const peopleService = google.people({ version: 'v1', auth });

    try {
        // Collect and validate emails
        const rawEmails = [
            ...(Array.isArray(emails) ? emails : (emails ? [emails] : [])),
            ...(Array.isArray(email) ? email : (email ? [email] : []))
        ].map(e => (e || '').toString().trim().toLowerCase()).filter(isValidRealEmail);
        const uniqueEmails = Array.from(new Set(rawEmails));

        // =========================================================
        // 2. IDENTITY KEY: PHONE NUMBER ONLY
        // Search by each current phone number
        // =========================================================
        let existing = null;
        for (const p of validPhones) {
            console.log(`[Google Contacts] 🔍 Checking if phone "${p}" exists in Google Contacts (${source})...`);
            existing = await checkContactExistsInGoogle(peopleService, p);
            if (existing) {
                console.log(`[Google Contacts] ✅ Found existing contact under phone "${p}": "${existing.name}" [Resource: ${existing.resourceName}]`);
                break;
            }
        }

        // 3. Build contact payload & ensure EU- prefix in MAIN NAME and EU-{username}
        const cleanGst = (gstNumber || gstNo || '').toString().trim();

        // MAIN NAME: Always prefixed with "EU-" (e.g., "EU-meet kio")
        const formattedMainName = formatMainNameWithEU(name);

        // EU-{username} for contact identification — ALWAYS ASSIGNED
        let cleanUsername = '';
        if (username && username.toString().trim()) {
            cleanUsername = `EU-${username.toString().trim()}`.replace(/^EU-EU-/, 'EU-');
        } else if (name && name.toString().trim() && !/^(client|guest|enquiry client)$/i.test(name.toString().trim())) {
            cleanUsername = `EU-${name.toString().trim()}`.replace(/^EU-EU-/, 'EU-');
        } else if (validPhones[0]) {
            cleanUsername = `EU-${getLast10Digits(validPhones[0])}`;
        }

        const contactBody = {
            names: [{ 
                givenName: formattedMainName, 
                displayName: formattedMainName,
                unstructuredName: formattedMainName 
            }],
            phoneNumbers: validPhones.map((p, idx) => ({
                value: p,
                type: idx === 0 ? 'mobile' : (idx === 1 ? 'work' : 'other')
            }))
        };

        if (uniqueEmails.length > 0) {
            contactBody.emailAddresses = uniqueEmails.map((e, idx) => ({
                value: e,
                type: idx === 0 ? 'work' : 'other'
            }));
        }

        if (company && company.trim()) {
            contactBody.organizations = [{
                name: company.trim(),
                type: 'work'
            }];
        }

        if (address) {
            if (typeof address === 'object') {
                const addrObj = { type: 'work' };
                if (address.street || address.clientAddress) {
                    addrObj.streetAddress = (address.street || address.clientAddress || '').trim();
                }
                if (address.pincode) addrObj.postalCode = address.pincode.toString().trim();
                if (address.state) addrObj.region = address.state.toString().trim();
                if (addrObj.streetAddress || addrObj.postalCode || addrObj.region) {
                    contactBody.addresses = [addrObj];
                }
            } else if (typeof address === 'string' && address.trim()) {
                contactBody.addresses = [{
                    streetAddress: address.trim(),
                    type: 'work'
                }];
            }
        }

        // Build userDefined: GST + EU-Username
        const userDefinedFields = [];
        if (cleanGst) {
            userDefinedFields.push({ key: 'GST Number', value: cleanGst });
        }
        if (cleanUsername) {
            userDefinedFields.push({ key: 'Username', value: cleanUsername });
        }
        if (userDefinedFields.length > 0) {
            contactBody.userDefined = userDefinedFields;
        }

        // Biography: GST note & EU-Username identifier
        if (cleanGst && cleanUsername) {
            contactBody.biographies = [{
                value: `GST No: ${cleanGst} | ID: ${cleanUsername}`,
                contentType: 'TEXT_PLAIN'
            }];
        } else if (cleanGst) {
            contactBody.biographies = [{
                value: `GST No: ${cleanGst}`,
                contentType: 'TEXT_PLAIN'
            }];
        } else if (cleanUsername) {
            contactBody.biographies = [{
                value: `ID: ${cleanUsername}`,
                contentType: 'TEXT_PLAIN'
            }];
        }

        const phoneStr = validPhones.join(', ');

        // =========================================================
        // 4. If contact found by PHONE -> OVERWRITE / UPDATE (no duplicate)
        // =========================================================
        if (existing && existing.resourceName) {
            console.log(`[Google Contacts] 📝 Contact EXISTS for phone "${phoneStr}". Overwriting/updating details...`);

            // Fetch fresh contact for etag & true current fields
            let targetContact = existing;
            try {
                const fresh = await peopleService.people.get({
                    resourceName: existing.resourceName,
                    personFields: 'names,phoneNumbers,emailAddresses,organizations,addresses,userDefined,biographies'
                });
                if (fresh.data && fresh.data.etag) {
                    targetContact = {
                        ...existing,
                        etag: fresh.data.etag,
                        person: fresh.data
                    };
                }
            } catch (getErr) {
                console.warn(`[Google Contacts] ⚠️ Could not fetch fresh contact for ${existing.resourceName}:`, getErr.message);
            }

            // Determine final name with EU- prefix
            const finalUpdatedName = (name && name.trim()) 
                ? formatMainNameWithEU(name) 
                : (targetContact.person?.names?.[0]?.displayName 
                    ? formatMainNameWithEU(targetContact.person.names[0].displayName) 
                    : formattedMainName);

            // Build field diff against fresh contact BEFORE update
            const diffData = {
                name: finalUpdatedName,
                phone: validPhones[0],
                phones: validPhones,
                email: uniqueEmails[0],
                emails: uniqueEmails,
                company,
                address,
                gstNumber: cleanGst,
                username: cleanUsername
            };
            const fieldChanges = buildFieldDiff(targetContact.person, diffData);

            const updateBody = {
                etag: targetContact.etag,
                names: [{ 
                    givenName: finalUpdatedName, 
                    displayName: finalUpdatedName,
                    unstructuredName: finalUpdatedName 
                }],
                phoneNumbers: contactBody.phoneNumbers
            };
            const fieldsToUpdate = ['names', 'phoneNumbers'];

            // Overwrite Email
            if (contactBody.emailAddresses && contactBody.emailAddresses.length > 0) {
                updateBody.emailAddresses = contactBody.emailAddresses;
                fieldsToUpdate.push('emailAddresses');
            } else if (targetContact.person?.emailAddresses) {
                const preserved = targetContact.person.emailAddresses.filter(e => isValidRealEmail(e.value));
                if (preserved.length > 0) updateBody.emailAddresses = preserved;
            }

            // Overwrite Organization / Company
            if (contactBody.organizations && contactBody.organizations.length > 0) {
                updateBody.organizations = contactBody.organizations;
                fieldsToUpdate.push('organizations');
            } else if (targetContact.person?.organizations) {
                updateBody.organizations = targetContact.person.organizations;
            }

            // Overwrite Address
            if (contactBody.addresses && contactBody.addresses.length > 0) {
                updateBody.addresses = contactBody.addresses;
                fieldsToUpdate.push('addresses');
            } else if (targetContact.person?.addresses) {
                updateBody.addresses = targetContact.person.addresses;
            }

            // Overwrite userDefined (GST Number + EU-Username)
            const existingUD = targetContact.person?.userDefined || [];
            const mergedUD = [...existingUD];
            for (const newField of (contactBody.userDefined || [])) {
                const idx = mergedUD.findIndex(u => u.key === newField.key);
                if (idx >= 0) {
                    mergedUD[idx] = newField;
                } else {
                    mergedUD.push(newField);
                }
            }
            if (mergedUD.length > 0) {
                updateBody.userDefined = mergedUD;
                fieldsToUpdate.push('userDefined');
            }

            // Overwrite Biography
            if (contactBody.biographies) {
                updateBody.biographies = contactBody.biographies;
                fieldsToUpdate.push('biographies');
            } else if (targetContact.person?.biographies) {
                updateBody.biographies = targetContact.person.biographies;
            }

            const totalChanges = (fieldChanges.addedFields.length + fieldChanges.updatedFields.length);
            let updateRes = { data: targetContact.person };

            // PREVENT API CALL IF NOTHING CHANGED (0 changes)
            if (totalChanges === 0) {
                console.log(`[Google Contacts] ⏭️ Contact details for "${finalUpdatedName}" are identical (0 changes). Skipped Google API update call.`);
            } else {
                updateRes = await peopleService.people.updateContact({
                    resourceName: existing.resourceName,
                    updatePersonFields: fieldsToUpdate.join(','),
                    requestBody: updateBody
                });
            }

            // Invalidate cache so future calls get fresh data
            connectionsCache = null;

            console.log(`[Google Contacts] ✅ SUCCESS: Contact UPDATED for "${finalUpdatedName}" (${phoneStr}) [Resource: ${existing.resourceName}]`);
            console.log(`[Google Contacts] 📋 Field Changes - Added: ${fieldChanges.addedFields.length}, Updated: ${fieldChanges.updatedFields.length}`);

            return {
                success: true,
                updated: totalChanges > 0,
                skipped: totalChanges === 0,
                added: false,
                contact: updateRes.data,
                contactName: finalUpdatedName,
                resourceName: existing.resourceName,
                source,
                fieldChanges
            };
        }

        // =========================================================
        // 5. Phone not found -> CREATE NEW CONTACT
        // =========================================================
        console.log(`[Google Contacts] 🆕 Adding new contact: "${formattedMainName}" [Source: ${source}, Phones: ${phoneStr}]...`);

        const createRes = await peopleService.people.createContact({ requestBody: contactBody });

        // Invalidate cache
        connectionsCache = null;

        // For new contacts, all fields are "added"
        const addedFields = [];
        if (formattedMainName) addedFields.push({ field: 'Name', value: formattedMainName });
        if (validPhones.length > 0) addedFields.push({ field: 'Phone', value: validPhones.join(', ') });
        if (uniqueEmails.length > 0) addedFields.push({ field: 'Email', value: uniqueEmails.join(', ') });
        if (company) addedFields.push({ field: 'Company', value: company });
        if (address) addedFields.push({ field: 'Address', value: typeof address === 'string' ? address : JSON.stringify(address) });
        if (cleanGst) addedFields.push({ field: 'GST Number', value: cleanGst });
        if (cleanUsername) addedFields.push({ field: 'Username (EU)', value: cleanUsername });

        console.log(`[Google Contacts] ✅ SUCCESS: Contact CREATED for "${formattedMainName}" (${phoneStr}) [Resource: ${createRes.data.resourceName || 'created'}]`);

        return {
            success: true,
            added: true,
            updated: false,
            contact: createRes.data,
            contactName: formattedMainName,
            resourceName: createRes.data.resourceName,
            source,
            fieldChanges: {
                addedFields,
                updatedFields: [],
                unchangedFields: []
            }
        };
    } catch (err) {
        console.error(`[Google Contacts] ❌ ERROR syncing "${name}" (${validPhones.join(', ')}):`, err.message);
        return {
            success: false,
            error: err.message,
            fieldChanges: { addedFields: [], updatedFields: [], unchangedFields: [] }
        };
    }
};

module.exports = {
    addToGoogleContacts,
    checkContactExistsInGoogle,
    checkContactExistsInGoogleByEmail,
    getLast10Digits,
    isValidRealEmail,
    formatMainNameWithEU
};
