import { google } from 'googleapis';
import fs from 'fs/promises';
import path from 'path';

const TOKEN_PATH = path.resolve('tokens.json');
const SCOPES = [
  'https://www.googleapis.com/auth/contacts',
  'https://www.googleapis.com/auth/userinfo.profile'
];

const createOAuthClient = () => {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
    throw new Error('Aggiungi GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e GOOGLE_REDIRECT_URI in .env');
  }

  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
};

const loadSavedTokens = async () => {
  try {
    const content = await fs.readFile(TOKEN_PATH, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
};

const saveTokens = async (tokens) => {
  await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens, null, 2), 'utf8');
  console.log('Token Google salvati in', TOKEN_PATH);
};

export const hasSavedGoogleTokens = async () => {
  const savedTokens = await loadSavedTokens();
  return Boolean(savedTokens);
};

export const getAuthUrl = () => {
  const oAuth2Client = createOAuthClient();
  return oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES
  });
};

export const authorizeGoogle = async () => {
  const savedTokens = await loadSavedTokens();
  if (!savedTokens) {
    throw new Error('Google non autorizzato.');
  }

  const oAuth2Client = createOAuthClient();
  oAuth2Client.setCredentials(savedTokens);
  return oAuth2Client;
};

export const exchangeCodeForTokens = async (code) => {
  const oAuth2Client = createOAuthClient();
  const { tokens } = await oAuth2Client.getToken(code);
  oAuth2Client.setCredentials(tokens);
  await saveTokens(tokens);
  return oAuth2Client;
};

export const getPeopleService = (auth) => {
  return google.people({ version: 'v1', auth });
};
