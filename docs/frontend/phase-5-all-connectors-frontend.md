# All Connectors — Frontend Integration Guide

**Status:** Implemented  
**Auth:** JWT Bearer on every endpoint below  
**Base URL:** `VITE_API_URL` (e.g. `http://localhost:3000` or your Render URL)

This doc covers **every source filter** in the UI: All, Gmail, Slack, GitHub, VS Code, Chrome, Calendar, Notion, Drive, Photos, Manual.

---

## 1) How sources work (important)

| Source | How data gets in | Frontend action |
|---|---|---|
| **GitHub** | Token connect + sync | Connect PAT → Sync |
| **Gmail / Calendar / Drive** | Google OAuth access token + sync | Paste Google access token → Sync |
| **Slack** | Slack bot/user token + sync | Paste token → Sync |
| **Notion** | Notion integration token + sync | Paste token → Sync |
| **VS Code / Chrome / Photos** | Extension / collector **pushes** events | Enable connect → extension calls ingest |
| **Manual** | Always on | Add note form |
| **All** | Filter only | `GET /events` with no `source` |

Filters in the UI map to `source` query on events / replay.

---

## 2) Endpoints overview

| Method | Path | Purpose |
|---|---|---|
| GET | `/connectors` | Catalog + connection status for **all** sources |
| GET | `/connectors/catalog` | Static catalog only |
| GET | `/connectors/:source/status` | One source status |
| POST | `/connectors/:source/connect` | Connect / enable source |
| POST | `/connectors/:source/sync` | Pull remote data → events |
| DELETE | `/connectors/:source` | Disconnect |
| POST | `/connectors/ingest` | Extension / collector batch push |
| POST | `/connectors/manual/note` | Quick manual note |
| GET | `/events?source=` | Filter timeline data by source |
| GET | `/timeline/replay?date&timezone` | Day replay (all sources unless filtered later) |

Legacy GitHub routes still work:

- `POST /connectors/github/connect`
- `POST /connectors/github/sync`
- `GET /connectors/github/status`

Prefer the unified `/connectors` API for new UI.

---

## 3) Connect page — recommended flow

1. On load: `GET /connectors`  
2. Render each card from the response (`name`, `mode`, `connected`, `accountLabel`, `syncSupported`, `ingestSupported`)  
3. Connect button → `POST /connectors/:source/connect`  
4. Sync button (if `syncSupported`) → `POST /connectors/:source/sync`  
5. For extension sources: show “Install extension / waiting for ingest”  
6. Manual: form → `POST /connectors/manual/note`

---

## 4) `GET /connectors` response shape

Each item:

| Field | Meaning |
|---|---|
| `source` | `gmail` \| `slack` \| `github` \| … |
| `name` | Display name |
| `mode` | `token` \| `oauth` \| `extension` \| `ingest` \| `manual` |
| `description` | Help text |
| `syncSupported` | Show Sync button |
| `ingestSupported` | Can receive pushed events |
| `connectFields` | e.g. `["accessToken"]` |
| `connected` | boolean |
| `accountLabel` | e.g. `@user` / email |
| `lastSyncedAt` | ISO or null |

---

## 5) Connect request / response

### `POST /connectors/:source/connect`

**Headers:** `Authorization: Bearer <token>`

**Body (token/oauth sources):**

```
{
  "accessToken": "...",
  "refreshToken": "...",   // optional (Google)
  "apiKey": "...",         // optional alternate
  "accountLabel": "..."    // optional
}
```

**Body (extension sources — vscode / chrome):**

```
{
  "accountLabel": "My laptop VS Code"
}
```

**GitHub:** same as before — `accessToken` = classic PAT with `repo` scope.

**Response:**

```
{ "connected": true, "source": "notion", "accountLabel": "..." }
```

---

## 6) Sync request / response

### `POST /connectors/:source/sync`

**Body:** empty `{}`

**Response:**

```
{
  "synced": 12,
  "skipped": 3,
  "updated": 1,
  "source": "gmail"
}
```

Extension/manual sources return a message that sync is not used — use ingest instead.

---

## 7) Ingest (VS Code, Chrome, Photos, local collectors)

### `POST /connectors/ingest`

```
{
  "source": "vscode",
  "events": [
    {
      "type": "file_edit",
      "title": "Edited src/App.tsx",
      "content": "Saved file",
      "occurredAt": "2026-07-20T12:00:00.000Z",
      "projectId": "my-app",
      "sourceEventId": "vscode-edit-123",
      "tags": ["vscode"],
      "metadata": { "file": "src/App.tsx" }
    }
  ]
}
```

**Chrome example `source`:** `chrome`, `type`: `browse`  
**Photos example `source`:** `photos`, `type`: `photo`

**Response:**

```
{ "source": "vscode", "synced": 1, "skipped": 0, "updated": 0 }
```

---

## 8) Manual note

### `POST /connectors/manual/note`

```
{
  "title": "Decided on IANA timezones",
  "content": "Store UTC, display local",
  "projectId": "ai-time-machine",
  "tags": ["decision"]
}
```

Creates an event with `source: "manual"`, `type: "note"`.

---

## 9) Filtering the UI (source chips)

| Chip | API |
|---|---|
| All | `GET /events` (no source) |
| Github | `GET /events?source=github` |
| Gmail | `GET /events?source=gmail` |
| … | `GET /events?source=<chip>` |

Replay stays:

```
GET /timeline/replay?date=YYYY-MM-DD&timezone=Asia/Kolkata
```

(Optional later: add `source` query to replay — not required for MVP filters if you filter client-side from `events`.)

---

## 10) Per-source frontend checklist

### GitHub ✅
- [ ] Connect classic PAT (`repo` scope)
- [ ] Sync
- [ ] Show commit **title/content** (message), newest first

### Manual ✅
- [ ] “Add note” form → `/connectors/manual/note`
- [ ] Chip filters `source=manual`

### VS Code / Chrome ✅ (ingest path)
- [ ] Connect (enable) card
- [ ] Document extension install
- [ ] Extension uses JWT + `/connectors/ingest`

### Notion / Slack ✅ (token sync)
- [ ] Token input → connect → sync
- [ ] Handle empty sync (scopes / channel) gracefully

### Gmail / Calendar / Drive ⚠️ (token sync)
- [ ] Need a **Google OAuth access token** with proper scopes  
- [ ] Full browser OAuth popup is a later frontend task  
- [ ] For now: paste access token from OAuth Playground / your OAuth app

### Photos
- [ ] Prefer ingest from mobile/local collector  
- [ ] Sync not supported yet

---

## 11) Session / headers (same as Phase 4)

```
Authorization: Bearer <accessToken>
Content-Type: application/json
```

On `401` → clear session → `/app/login`.

---

## 12) Errors to handle in UI

| Status | Meaning |
|---|---|
| 400 | Bad token / missing fields / API provider error |
| 401 | JWT expired |
| 404 | Source not connected before sync |
| 409 | Duplicate email on signup (auth) |

---

## 13) Suggested Connect screen UI map

| Card | Primary CTA | Secondary CTA |
|---|---|---|
| GitHub | Connect token | Sync now |
| Gmail | Connect Google token | Sync |
| Slack | Connect token | Sync |
| Notion | Connect token | Sync |
| Calendar | Connect Google token | Sync |
| Drive | Connect Google token | Sync |
| VS Code | Enable | “Waiting for extension” |
| Chrome | Enable | “Waiting for extension” |
| Photos | Enable | Ingest from app |
| Manual | Add note | — |

---

## 14) What is NOT full OAuth yet

Browser-based Google/Slack OAuth consent screens are **not** implemented in this backend pass.

What **is** implemented:

- Unified connector status API for all chips  
- Token connect + sync for GitHub, Notion, Slack, Gmail, Calendar, Drive  
- Extension ingest for VS Code / Chrome / Photos  
- Manual notes  
- Encrypted credential storage  

Next frontend iteration: OAuth redirect flows that obtain `accessToken` / `refreshToken`, then call the same `connect` endpoints.

---

## 15) Quick test order for frontend

1. Login → store JWT  
2. `GET /connectors` → render all cards  
3. GitHub connect + sync → filter Github  
4. Manual note → filter Manual  
5. (Optional) Notion/Slack token connect + sync  
6. POST ingest sample vscode event → filter Vscode  

That’s the complete frontend contract for **all** source chips in one place.
