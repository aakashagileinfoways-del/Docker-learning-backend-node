# AI Time Machine — Documentation Index

Complete startup blueprint. Each phase ships backend + matching frontend integration doc.

---

## Product & Business

| Phase | Document                                          | Status                 |
| ----- | ------------------------------------------------- | ---------------------- |
| 1     | [Startup Bible](product/phase-1-startup-bible.md) | ✅ v1 decisions locked |

## Architecture & Design

| Phase | Document                                                               | Status         |
| ----- | ---------------------------------------------------------------------- | -------------- |
| 2     | [Technical Design (HLD/LLD)](architecture/phase-2-technical-design.md) | ✅ Implemented |
| 3     | [Database Design](database/phase-3-database-design.md)                 | ✅ Complete    |

## API

| Phase | Document                                                    | Status                                        |
| ----- | ----------------------------------------------------------- | --------------------------------------------- |
| 4     | [API Documentation](api/phase-4-api-documentation.md)       | ✅ Endpoint-by-endpoint spec (long form)      |
| 4     | [Phase 4 All-in-One Guide](api/phase-4-all-in-one-guide.md) | ✅ Runbook: flow + request/response (no code) |

## Frontend Integration

Written after each phase's backend ships. See [frontend/README.md](frontend/README.md).

| Phase | Document                                                                    | Covers                                    |
| ----- | --------------------------------------------------------------------------- | ----------------------------------------- |
| 1     | [phase-1-frontend-integration.md](frontend/phase-1-frontend-integration.md) | Signup, session                           |
| 2     | [phase-2-frontend-integration.md](frontend/phase-2-frontend-integration.md) | Timeline, GitHub                          |
| 3     | [phase-3-frontend-integration.md](frontend/phase-3-frontend-integration.md) | Data models, full API client, all screens |
| 4     | [phase-4-frontend-integration.md](frontend/phase-4-frontend-integration.md) | JWT auth, retention, breaking API changes |
| 5     | [phase-5-all-connectors-frontend.md](frontend/phase-5-all-connectors-frontend.md) | All source chips: connect / sync / ingest |

## Upcoming

| Phase | Topic                        | Status  |
| ----- | ---------------------------- | ------- |
| 5+    | AI (embeddings, RAG, memory) | Planned |
| 6     | UI/UX wireframes             | Planned |
| 7     | DevOps (Docker, K8s, CI)     | Planned |
| 8     | Investor documents           | Planned |

---

## Quick links for frontend team

```env
VITE_API_URL=http://localhost:3000
```

**Main replay endpoint:**

```http
GET /timeline/replay?userId=...&date=YYYY-MM-DD&timezone=Asia/Kolkata
```

**End-to-end flow:** Signup → Connect GitHub → Sync → Replay

Full curl examples: [phase-4-api-documentation.md](api/phase-4-api-documentation.md#appendix--end-to-end-developer-flow)

---

## Workflow

1. Lock product decisions (Phase 1)
2. Implement backend + architecture doc (Phase 2)
3. Document database + publish frontend integration (Phase 3)
4. Document every API endpoint (Phase 4)
5. Repeat for AI, UI, DevOps, Investor phases
