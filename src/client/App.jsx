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
    open: 'Connected',
    qr: 'QR Required',
    connecting: 'Connecting',
    disconnected: 'Disconnected'
  }[status] || 'Unknown';
  return <span className={`badge badge-${status}`}>{label}</span>;
};

export default function App() {
  const [googleAuthorized, setGoogleAuthorized] = useState(false);
  const [whatsappState, setWhatsappState] = useState({ status: 'disconnected', qrDataUrl: null });
  const [preview, setPreview] = useState(null);
  const [syncProgress, setSyncProgress] = useState(null);

  useEffect(() => {
    refreshStatus();
    const interval = setInterval(refreshStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let interval;
    if (loading && message === 'Eseguo la sincronizzazione...') {
      interval = setInterval(async () => {
        try {
          const progress = await fetchJson('/api/sync/progress');
          setSyncProgress(progress);
          if (progress.current >= progress.total && progress.total > 0) {
            setSyncProgress(null);
          }
        } catch (error) {
          console.error('Errore nel progresso:', error);
        }
      }, 1000);
    } else {
      setSyncProgress(null);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [loading, message]);

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
      setMessage('Open the Google page and complete authorization. Then return here and refresh the status.');
    } catch (error) {
      setMessage(error.message);
    }
  };

  const handleConnectWhatsApp = async () => {
    setLoading(true);
    setMessage('Opening WhatsApp connection...');
    try {
      const result = await fetchJson('/api/whatsapp/connect', { method: 'POST' });
      setWhatsappState(result);
      setMessage('WhatsApp connection started. Scan the QR code if required.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePreview = async () => {
    setLoading(true);
    setMessage('Calculating sync preview...');
    try {
      const result = await fetchJson('/api/preview', { method: 'POST' });
      setPreview(result);
      setReport(null);
      setMessage('Preview ready. Review the contacts and proceed with synchronization.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    setLoading(true);
    setMessage('Starting synchronization...');
    try {
      const result = await fetchJson('/api/sync', { method: 'POST' });
      setReport(result);
      setMessage('Synchronization completed.');
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
        <p>Sync WhatsApp profile pictures to Google Contacts.</p>
      </header>

      <section className="panel">
        <h2>Status</h2>
        <div className="status-row">
          <div>
            <strong>Google:</strong> {googleAuthorized ? 'Authorized' : 'Not authorized'}
          </div>
          <div>
            <strong>WhatsApp:</strong> <StatusBadge status={whatsappState.status} />
          </div>
        </div>
        {whatsappState.qrDataUrl && (
          <div className="qr-panel">
            <p>Scan the QR code with WhatsApp to authorize the connection.</p>
            <img src={whatsappState.qrDataUrl} alt="WhatsApp QR" />
          </div>
        )}
      </section>

      <section className="panel actions">
        <button disabled={loading || googleAuthorized} onClick={handleGoogleAuth}>
          Authorize Google
        </button>
        <button disabled={loading || !googleAuthorized} onClick={handleConnectWhatsApp}>
          Connect WhatsApp
        </button>
        <button disabled={loading || whatsappState.status !== 'open'} onClick={handlePreview}>
          Preview Sync
        </button>
        <button disabled={loading || whatsappState.status !== 'open'} onClick={handleSync}>
          Start Sync
        </button>
      </section>

      {message && <section className="panel message"><p>{syncProgress ? syncProgress.message : message}</p></section>}

      {preview && (
        <section className="panel preview">
          <h2>Preview</h2>
          <p>
            Total contacts: {preview.totalContacts} · Contacts with photos to update: {' '}
            {preview.contactsWithPhoto}
          </p>
          <div className="preview-list">
            {preview.preview.slice(0, 100).map((item) => (
              <div key={`${item.phone}-${item.status}`} className="preview-item">
                <div>
                  <strong>{item.name}</strong>
                  <div>{item.phone}</div>
                </div>
                <span>{item.status === 'photo-available' ? '✓ Photo available' : item.status === 'no-photo' ? 'No photo' : 'Invalid number'}</span>
              </div>
            ))}
            {preview.preview.length > 100 && <p>... and {preview.preview.length - 100} more contacts</p>}
          </div>
        </section>
      )}

      {report && (
        <section className="panel report">
          <h2>Final Report</h2>
          <ul>
            <li>Contacts processed: {report.totalContacts}</li>
            <li>Photos updated: {report.updated}</li>
            <li>Skipped no photo: {report.skippedNoPhoto}</li>
            <li>Skipped invalid phone: {report.skippedInvalidPhone}</li>
            <li>Errors: {report.errors.length}</li>
          </ul>
          {report.errors.length > 0 && (
            <div className="errors">
              <h3>Error Details</h3>
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
