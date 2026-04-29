import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion, useMultiFileAuthState } from '@whiskeysockets/baileys';
import pino from 'pino';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const authFolder = `${__dirname}/../whatsapp-session`;
let sock = null;
let connectionState = 'disconnected';
let lastQr = null;

export const startWhatsApp = async ({ onQr } = {}) => {
  console.log('Inizio connessione WhatsApp...');
  if (sock && connectionState === 'open') {
    console.log('WhatsApp socket già connesso.');
    return sock;
  }

  const { state, saveCreds } = await useMultiFileAuthState(authFolder);
  const { version } = await fetchLatestBaileysVersion();

  connectionState = 'connecting';
  const socket = makeWASocket({
    logger: pino({ level: process.env.WHATSAPP_LOG_LEVEL || 'info' }),
    printQRInTerminal: false,
    auth: state,
    version
  });

  socket.ev.on('creds.update', async (creds) => {
    try {
      await saveCreds(creds);
      console.log('Credenziali WhatsApp aggiornate.');
    } catch (saveError) {
      console.error('Errore salvataggio credenziali WhatsApp:', saveError);
    }
  });

  socket.ev.on('connection.update', async (update) => {
    console.log('WhatsApp connection.update:', JSON.stringify(update));

    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      lastQr = qr;
      connectionState = 'qr';
      if (typeof onQr === 'function') {
        onQr(qr);
      }
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const statusReason = lastDisconnect?.error?.output?.payload?.message || lastDisconnect?.error?.message;
      console.error('WhatsApp connection closed:', statusCode, statusReason);
      if (statusCode === DisconnectReason.loggedOut) {
        connectionState = 'disconnected';
        sock = null;
        console.log('Sessione WhatsApp disconnessa (logout).');
      } else {
        connectionState = 'disconnected';
      }
    }

    if (connection === 'open') {
      connectionState = 'open';
      lastQr = null;
      console.log('WhatsApp connesso correttamente.');
    }
  });

  sock = socket;
  return sock;
};

export const getWhatsAppState = () => ({
  status: connectionState,
  qr: lastQr
});

export const getWhatsAppSocket = () => sock;

export const getProfilePictureUrl = async (sock, jid) => {
  try {
    return await sock.profilePictureUrl(jid, 'image');
  } catch {
    return null;
  }
};

export const toWhatsAppId = (phone) => {
  const cleaned = phone.replace(/[^0-9+]/g, '');
  if (!cleaned) return null;
  if (cleaned.startsWith('+')) {
    return `${cleaned.slice(1)}@s.whatsapp.net`;
  }

  const defaultCode = process.env.DEFAULT_COUNTRY_CODE?.replace(/[^0-9]/g, '');
  const normalized = defaultCode ? `${defaultCode}${cleaned}` : cleaned;
  return `${normalized}@s.whatsapp.net`;
};
