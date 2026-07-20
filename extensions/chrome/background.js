async function getConfig() {
  return chrome.storage.sync.get(['apiUrl', 'token']);
}

async function ingestBrowseEvent(tab) {
  const { apiUrl, token } = await getConfig();
  if (!token) throw new Error('Missing JWT — open extension Settings');

  const base = (apiUrl || 'http://localhost:3000').replace(/\/$/, '');
  const occurredAt = new Date().toISOString();
  const url = tab.url || '';
  const title = tab.title || url;

  const res = await fetch(`${base}/connectors/ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      source: 'chrome',
      events: [
        {
          type: 'browse',
          title,
          content: url,
          occurredAt,
          sourceEventId: `chrome-${tab.id || 'x'}-${Date.now()}`,
          tags: ['chrome', 'browse'],
          metadata: {
            url,
            favIconUrl: tab.favIconUrl || null,
          },
        },
      ],
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      Array.isArray(body.message) ? body.message.join(', ') : body.message || `HTTP ${res.status}`,
    );
  }
  return body;
}

// Auto-capture when you finish loading a page
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
    return;
  }
  try {
    await ingestBrowseEvent(tab);
  } catch (e) {
    console.warn('[ATM Chrome] ingest failed', e.message);
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'PUSH_TAB') {
    ingestBrowseEvent(msg.tab)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
});
