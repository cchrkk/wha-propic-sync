import { readFile, writeFile, unlink } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SYNC_STATE_PATH = path.join(__dirname, '../sync-state.json');

const loadSyncState = async () => {
  try {
    const data = await readFile(SYNC_STATE_PATH, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
};

const saveSyncState = async (syncedIds) => {
  await writeFile(SYNC_STATE_PATH, JSON.stringify({ syncedIds }));
};

const clearSyncState = async () => {
  await unlink(SYNC_STATE_PATH).catch(() => {});
};

const getPrimaryPhone = (person) => {
  return person.phoneNumbers?.find((phone) => phone.value)?.value ?? null;
};

const getDisplayName = (person) => {
  return person.names?.[0]?.displayName || 'Contatto senza nome';
};

const fetchWithTimeout = async (url, timeoutMs = 15000) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
};

const formatWhatsAppJid = (phoneNumber) => {
  const cleaned = phoneNumber.replace(/[^0-9+]/g, '');
  if (!cleaned) return null;
  if (cleaned.startsWith('+')) {
    return `${cleaned.slice(1)}@s.whatsapp.net`;
  }
  const defaultCode = (process.env.DEFAULT_COUNTRY_CODE || '+39').replace(/[^0-9]/g, '');
  return `${defaultCode}${cleaned}@s.whatsapp.net`;
};

const loadAllContacts = async (peopleService) => {
  const allContacts = [];
  let nextPageToken;

  do {
    const response = await peopleService.people.connections.list({
      resourceName: 'people/me',
      pageSize: 200,
      personFields: 'names,phoneNumbers',
      pageToken: nextPageToken
    });

    allContacts.push(...(response.data.connections || []));
    nextPageToken = response.data.nextPageToken;
  } while (nextPageToken);

  return allContacts
    .map((person) => ({
      resourceName: person.resourceName,
      name: getDisplayName(person),
      phone: getPrimaryPhone(person)
    }))
    .filter((contact) => contact.phone);
};

export const listContactsPreview = async ({ peopleService, whatsappSocket }) => {
  const contacts = await loadAllContacts(peopleService);
  const preview = [];
  let photosFound = 0;

  for (const contact of contacts) {
    const jid = formatWhatsAppJid(contact.phone);
    if (!jid) {
      preview.push({ ...contact, status: 'invalid-phone' });
      continue;
    }

    let profileUrl = null;
    try {
      profileUrl = await Promise.race([
        whatsappSocket.profilePictureUrl(jid, 'image'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 30000))
      ]);
    } catch {}
    const status = profileUrl ? 'photo-available' : 'no-photo';
    if (status === 'photo-available') {
      photosFound += 1;
    }

    preview.push({
      ...contact,
      jid,
      status,
      profileUrl: status === 'photo-available' ? profileUrl : null
    });
  }

  return {
    totalContacts: contacts.length,
    contactsWithPhoto: photosFound,
    preview
  };
};

export const syncContactProfilePhotos = async ({ peopleService, whatsappSocket }, onProgress = () => {}) => {
  const contacts = await loadAllContacts(peopleService);
  const savedState = await loadSyncState();
  const syncedIds = new Set(savedState?.syncedIds || []);
  const resumed = syncedIds.size > 0;

  const report = {
    totalContacts: contacts.length,
    updated: 0,
    skippedNoPhoto: 0,
    skippedInvalidPhone: 0,
    skippedAlreadySynced: resumed ? syncedIds.size : 0,
    errors: []
  };

  onProgress({ current: 0, total: contacts.length, message: resumed ? `Ripresa da ${syncedIds.size}/${contacts.length}...` : 'Inizializzazione sincronizzazione...' });

  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];

    if (syncedIds.has(contact.resourceName)) {
      onProgress({ current: i + 1, total: contacts.length, message: `Elaborato ${i + 1}/${contacts.length}: già sincronizzato` });
      continue;
    }

    const jid = formatWhatsAppJid(contact.phone);
    if (!jid) {
      report.skippedInvalidPhone += 1;
      onProgress({ current: i + 1, total: contacts.length, message: `Elaborato ${i + 1}/${contacts.length}: numero non valido` });
      continue;
    }

    let profileImageUrl = null;
    try {
      profileImageUrl = await Promise.race([
        whatsappSocket.profilePictureUrl(jid, 'image'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 30000))
      ]);
    } catch (err) {
      console.warn(`Timeout/n errore profilePictureUrl per ${contact.name} (${jid}): ${err.message}`);
    }
    if (!profileImageUrl) {
      report.skippedNoPhoto += 1;
      onProgress({ current: i + 1, total: contacts.length, message: `Elaborato ${i + 1}/${contacts.length}: nessuna foto` });
      continue;
    }

    console.log(`Sincronizzazione contatto ${i + 1}/${contacts.length}: ${contact.name} (${contact.phone})`);

    try {
      const imageResponse = await fetchWithTimeout(profileImageUrl, Number(process.env.PROFILE_FETCH_TIMEOUT_MS || 15000));
      if (!imageResponse.ok) {
        report.errors.push({ contact: contact.name, reason: `Download fallito ${imageResponse.status}` });
        onProgress({ current: i + 1, total: contacts.length, message: `Elaborato ${i + 1}/${contacts.length}: errore download` });
        continue;
      }

      const imageBuffer = await imageResponse.arrayBuffer();
      const photoBytes = Buffer.from(imageBuffer).toString('base64');
      await peopleService.people.updateContactPhoto({
        resourceName: contact.resourceName,
        requestBody: { photoBytes }
      });
      report.updated += 1;
      syncedIds.add(contact.resourceName);
      await saveSyncState([...syncedIds]);
      onProgress({ current: i + 1, total: contacts.length, message: `Elaborato ${i + 1}/${contacts.length}: aggiornato ${report.updated}` });
    } catch (error) {
      const errorMessage = error.name === 'AbortError'
        ? `Timeout download ${profileImageUrl}`
        : error.message || 'Errore aggiornamento foto';
      console.error(`Errore contatto ${i + 1}/${contacts.length} (${contact.name}):`, errorMessage);
      report.errors.push({ contact: contact.name, reason: errorMessage });
      onProgress({ current: i + 1, total: contacts.length, message: `Elaborato ${i + 1}/${contacts.length}: errore aggiornamento` });
    }
  }

  await clearSyncState();
  onProgress({ current: contacts.length, total: contacts.length, message: 'Sincronizzazione completata' });
  return report;
};
