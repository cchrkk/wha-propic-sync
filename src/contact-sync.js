const getPrimaryPhone = (person) => {
  return person.phoneNumbers?.find((phone) => phone.value)?.value ?? null;
};

const getDisplayName = (person) => {
  return person.names?.[0]?.displayName || 'Contatto senza nome';
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

    const profileUrl = await whatsappSocket.profilePictureUrl(jid, 'image').catch(() => null);
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
  const report = {
    totalContacts: contacts.length,
    updated: 0,
    skippedNoPhoto: 0,
    skippedInvalidPhone: 0,
    errors: []
  };

  onProgress({ current: 0, total: contacts.length, message: 'Inizializzazione sincronizzazione...' });

  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];
    const jid = formatWhatsAppJid(contact.phone);
    if (!jid) {
      report.skippedInvalidPhone += 1;
      onProgress({ current: i + 1, total: contacts.length, message: `Elaborato ${i + 1}/${contacts.length}: numero non valido` });
      continue;
    }

    const profileImageUrl = await whatsappSocket.profilePictureUrl(jid, 'image').catch(() => null);
    if (!profileImageUrl) {
      report.skippedNoPhoto += 1;
      onProgress({ current: i + 1, total: contacts.length, message: `Elaborato ${i + 1}/${contacts.length}: nessuna foto` });
      continue;
    }

    try {
      const imageResponse = await fetch(profileImageUrl);
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
      onProgress({ current: i + 1, total: contacts.length, message: `Aggiornato ${report.updated}/${contacts.length} contatti` });
    } catch (error) {
      report.errors.push({ contact: contact.name, reason: error.message || 'Errore aggiornamento foto' });
      onProgress({ current: i + 1, total: contacts.length, message: `Elaborato ${i + 1}/${contacts.length}: errore aggiornamento` });
    }
  }

  onProgress({ current: contacts.length, total: contacts.length, message: 'Sincronizzazione completata' });
  return report;
};
