const apiUrlEl = document.getElementById('apiUrl');
const tokenEl = document.getElementById('token');
const statusEl = document.getElementById('status');

chrome.storage.sync.get(['apiUrl', 'token'], (data) => {
  apiUrlEl.value = data.apiUrl || 'http://localhost:3000';
  tokenEl.value = data.token || '';
});

document.getElementById('save').addEventListener('click', async () => {
  const apiUrl = apiUrlEl.value.trim().replace(/\/$/, '');
  const token = tokenEl.value.trim();
  await chrome.storage.sync.set({ apiUrl, token });

  // Enable Chrome connector on backend
  try {
    const res = await fetch(`${apiUrl}/connectors/chrome/connect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ accountLabel: 'Chrome device' }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      statusEl.textContent = `Saved locally, but connect failed: ${body.message || res.status}`;
      return;
    }
    statusEl.textContent = 'Saved. Chrome connector enabled. Browse tabs to sync.';
  } catch (e) {
    statusEl.textContent = `Saved locally. Connect call failed: ${e.message}`;
  }
});
