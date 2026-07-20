chrome.storage.sync.get(['apiUrl', 'token'], (data) => {
  const info = document.getElementById('info');
  if (!data.token) {
    info.textContent = 'Not configured. Open Settings and paste JWT.';
  } else {
    info.textContent = `API: ${data.apiUrl || 'http://localhost:3000'}`;
  }
});

document.getElementById('openSettings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById('syncNow').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || tab.url.startsWith('chrome://')) {
    document.getElementById('info').textContent = 'Open a normal website tab first.';
    return;
  }
  chrome.runtime.sendMessage({ type: 'PUSH_TAB', tab }, (res) => {
    document.getElementById('info').textContent = res?.ok
      ? 'Pushed current tab.'
      : `Failed: ${res?.error || 'unknown'}`;
  });
});
