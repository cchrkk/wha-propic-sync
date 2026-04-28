import { useEffect, useState } from 'react';

const fetchJson = async (url, options = {}) => {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Errore nella richiesta.');
  }
  return data;
};

const StatusBadge = ({ status }) => {
  const label = {
    open: 'Connesso',
    qr: 'QR richiesto',
    connecting: 'Connessione in corso',
    disconnected: 'Disconnesso'
  }[status] || 'Sconosciuto';
  return <span className={`badge badge-${status}`}>{label}</span>;
};

export default function App() {
  const [googleAuthorized, setGoogleAuthorized] = useState(false);
  const [whatsappState, setWhatsappState] = useState({ status: 'disconnected', qrDataUrl: null });
  const [preview, setPreview] = useState(null);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    refreshStatus();
    const interval = setInterval(refreshStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const refreshStatus = async () => {
    try {
      const [google, whatsapp] = await Promise.all([
        fetchJson('/api/google/status'),
        fetchJson('/api/whatsapp/status')
      ]);
      setGoogleAuthorized(google.authorized);
      setWhatsappState(whatsapp);
    } catch (error) {
      console.error(error);
    }
  };

  const handleGoogleAuth = async () => {
    try {
      const { authUrl } = await fetchJson('/api/google/url');
      window.open(authUrl, '_blank');
      setMessage('Apri la pagina Google e completa l\'autorizzazione. Poi torna qui e aggiorna lo stato.');
    } catch (error) {
      setMessage(error.message);
    }
  };

  const handleConnectWhatsApp = async () => {
    setLoading(true);
    setMessage('Apro la connessione a WhatsApp...');
    try {
      const result = await fetchJson('/api/whatsapp/connect', { method: 'POST' });
      setWhatsappState(result);
      setMessage('Connessione WhatsApp avviata. Scansiona il QR se richiesto.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePreview = async () => {
    setLoading(true);
    setMessage('Calcolo l\'anteprima di sincronizzazione...');
    try {
      const result = await fetchJson('/api/preview', { method: 'POST' });
      setPreview(result);
      setReport(null);
      setMessage('Anteprima pronta. Verifica i contatti e procedi con la sincronizzazione.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    setLoading(true);
    setMessage('Eseguo la sincronizzazione...');
    try {
      const result = await fetchJson('/api/sync', { method: 'POST' });
      setReport(result);
      setMessage('Sincronizzazione completata.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="app-shell">
      <header>
        <h1>WHA Propic Sync</h1>
        <p>Sincronizza le foto profilo WhatsApp sui contatti Google.</p>
      </header>

      <section className="panel">
        <h2>Stato</h2>
        <div className="status-row">
          <div>
            <strong>Google:</strong> {googleAuthorized ? 'Autorizzato' : 'Non autorizzato'}
          </div>
          <div>
            <strong>WhatsApp:</strong> <StatusBadge status={whatsappState.status} />
          </div>
        </div>
        {whatsappState.qrDataUrl && (
          <div className="qr-panel">
            <p>Scansiona il QR con WhatsApp per autorizzare la connessione.</p>
            <img src={whatsappState.qrDataUrl} alt="WhatsApp QR" />
          </div>
        )}
      </section>

      <section className="panel actions">
        <button disabled={loading || googleAuthorized} onClick={handleGoogleAuth}>
          Autorizza Google
        </button>
        <button disabled={loading || !googleAuthorized} onClick={handleConnectWhatsApp}>
          Connetti WhatsApp
        </button>
        <button disabled={loading || whatsappState.status !== 'open'} onClick={handlePreview}>
          Anteprima sincronizzazione
        </button>
        <button disabled={loading || whatsappState.status !== 'open'} onClick={handleSync}>
          Avvia sincronizzazione
        </button>
      </section>

      {message && <section className="panel message"><p>{message}</p></section>}

      {preview && (
        <section className="panel preview">
          <h2>Anteprima</h2>
          <p>
            Contatti totali: {preview.totalContacts} · Contatti con foto da aggiornare:{' '}
            {preview.contactsWithPhoto}
          </p>
          <div className="preview-list">
            {preview.preview.map((item) => (
              <div key={`${item.phone}-${item.status}`} className="preview-item">
                <div>
                  <strong>{item.name}</strong>
                  <div>{item.phone}</div>
                </div>
                <span>{item.status === 'photo-available' ? '✓ Foto disponibile' : item.status === 'no-photo' ? 'No foto' : 'Numero non valido'}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {report && (
        <section className="panel report">
          <h2>Report finale</h2>
          <ul>
            <li>Contatti elaborati: {report.totalContacts}</li>
            <li>Foto aggiornate: {report.updated}</li>
            <li>Saltati senza foto WhatsApp: {report.skippedNoPhoto}</li>
            <li>Saltati numeri non validi: {report.skippedInvalidPhone}</li>
            <li>Errori: {report.errors.length}</li>
          </ul>
          {report.errors.length > 0 && (
            <div className="errors">
              <h3>Dettagli errori</h3>
              <ul>
                {report.errors.map((error, index) => (
                  <li key={index}>{error.contact}: {error.reason}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
