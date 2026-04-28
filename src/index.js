import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { authorizeGoogle, getAuthUrl, exchangeCodeForTokens, getPeopleService, hasSavedGoogleTokens } from './google-auth.js';
import { startWhatsApp, getWhatsAppState, getWhatsAppSocket } from './whatsapp-client.js';
import { listContactsPreview, syncContactProfilePhotos } from './contact-sync.js';
import qrcode from 'qrcode';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;

let syncProgress = null;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../dist'), {
  setHeaders: (res, path) => {
    if (path.endsWith('.js') || path.endsWith('.css') || path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.get('/api/google/status', async (_req, res) => {
  const authorized = await hasSavedGoogleTokens();
  res.json({ authorized });
});

app.get('/api/google/url', async (_req, res) => {
  const authUrl = getAuthUrl();
  res.json({ authUrl });
});

app.get('/oauth2callback', async (req, res) => {
  const code = req.query.code;
  if (!code) {
    res.status(400).send('Codice mancante.');
    return;
  }
  try {
    await exchangeCodeForTokens(code);
    res.redirect('/');
  } catch (err) {
    console.error('Errore callback Google:', err);
    res.status(500).send('Impossibile completare l\'autenticazione Google.');
  }
});

app.get('/api/whatsapp/status', async (_req, res) => {
  const state = getWhatsAppState();
  if (state.qr) {
    state.qrDataUrl = await qrcode.toDataURL(state.qr);
  }
  res.json(state);
});

app.post('/api/whatsapp/connect', async (_req, res) => {
  try {
    await startWhatsApp();
    const state = getWhatsAppState();
    if (state.qr) {
      const qrDataUrl = await qrcode.toDataURL(state.qr);
      return res.json({ ...state, qrDataUrl });
    }
    return res.json(state);
  } catch (err) {
    console.error('Errore connessione WhatsApp:', err);
    res.status(500).json({ error: err.message || 'Errore WhatsApp' });
  }
});

app.post('/api/preview', async (_req, res) => {
  try {
    const auth = await authorizeGoogle();
    const peopleService = getPeopleService(auth);
    const whatsappSocket = getWhatsAppSocket();
    if (!whatsappSocket) {
      return res.status(400).json({ error: 'WhatsApp non connesso' });
    }
    const preview = await listContactsPreview({ peopleService, whatsappSocket });
    res.json(preview);
  } catch (err) {
    console.error('Errore anteprima:', err);
    res.status(500).json({ error: err.message || 'Errore anteprima' });
  }
});

app.post('/api/sync', async (_req, res) => {
  try {
    const auth = await authorizeGoogle();
    const peopleService = getPeopleService(auth);
    const whatsappSocket = getWhatsAppSocket();
    if (!whatsappSocket) {
      return res.status(400).json({ error: 'WhatsApp non connesso' });
    }
    syncProgress = { current: 0, total: 0, message: 'Inizializzazione...' };
    const report = await syncContactProfilePhotos({ peopleService, whatsappSocket }, (progress) => {
      syncProgress = progress;
    });
    syncProgress = null;
    res.json(report);
  } catch (err) {
    console.error('Errore sincronizzazione:', err);
    syncProgress = null;
    res.status(500).json({ error: err.message || 'Errore sincronizzazione' });
  }
});

app.get('/api/sync/progress', (_req, res) => {
  res.json(syncProgress || { current: 0, total: 0, message: 'Nessuna sincronizzazione in corso' });
});

app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, '../dist/index.html');
  if (req.method === 'GET' && req.accepts('html') && res.sendFile) {
    return res.sendFile(indexPath);
  }
  res.status(404).json({ error: 'Route non trovata' });
});

app.listen(PORT, () => {
  console.log(`Server avviato su http://localhost:${PORT}`);
});
