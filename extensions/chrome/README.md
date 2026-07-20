# Chrome Extension — How to use

This extension pushes browse events to:

`POST /connectors/ingest` with `source: "chrome"`.

## 1) Load the extension

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select this folder:
   `Backend-data/extensions/chrome`
4. Click **Details** → **Extension options**

## 2) Configure

1. **API URL** — your backend, e.g. `http://localhost:3000` or your Render URL  
2. **Access token** — JWT from the web app:
   - Open AI Time Machine web app
   - DevTools → Application → Local Storage → copy `atm_accessToken`
3. Click **Save** (this also calls `/connectors/chrome/connect`)

## 3) Use it

- Browse normal websites → events are pushed automatically on page load
- Or click the extension icon → **Push current tab now**
- In the web app → filter **Chrome** → you should see browse events

## 4) Event shape sent

```json
{
  "source": "chrome",
  "events": [
    {
      "type": "browse",
      "title": "Page title",
      "content": "https://example.com",
      "occurredAt": "2026-07-20T12:00:00.000Z",
      "sourceEventId": "chrome-123-...",
      "tags": ["chrome", "browse"]
    }
  ]
}
```

## Notes

- `chrome://` pages are skipped
- JWT expires in 7 days — paste a new token when login expires
- Backend must allow your origin / accept the request (extension uses host permissions)
