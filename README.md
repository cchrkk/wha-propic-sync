# wha-propic-sync

Sync WhatsApp profile pictures to Google Contacts.

## Installazione

1. Copia il file di esempio:
   ```bash
   cp .env.example .env
   ```
2. Crea le credenziali Google OAuth 2.0 nella Google Cloud Console e abilita la Google People API.
3. Inserisci le tue credenziali Google nel file `.env`.
4. Installa le dipendenze:
   ```bash
   npm install
   ```

## Come funziona

L'applicazione:

- avvia una login Google OAuth per ottenere accesso ai contatti;
- apre una sessione WhatsApp Web con Baileys;
- legge i numeri da Google Contacts;
- verifica se i numeri hanno una foto profilo WhatsApp;
- scarica la foto e la imposta come immagine di contatto in Google.

## Esecuzione

Per sviluppo con UI React e backend:

```bash
npm run dev
```

Per buildare il frontend e avviare il server statico:

```bash
npm run build
npm start
```

Al primo avvio ti verrà chiesto di autorizzare Google in un browser e di scansionare il QR code di WhatsApp nella web UI.

## Configurazione

Il file `.env` deve contenere almeno:

```bash
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:3000/oauth2callback
DEFAULT_COUNTRY_CODE=+39
```

## File creati

- `whatsapp-session.json`: sessione Baileys per WhatsApp;
- `tokens.json`: token Google OAuth salvati localmente.

## Note

- Assicurati che `GOOGLE_REDIRECT_URI` sia registrato nelle credenziali OAuth di Google.
- Il progetto usa `@whiskeysockets/baileys` per la connessione WhatsApp e `googleapis` per l'accesso ai contatti.
