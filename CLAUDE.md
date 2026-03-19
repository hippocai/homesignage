# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Backend
npm start          # production
npm run dev        # development with nodemon

# Admin dashboard (Vue.js)
cd admin && npm run dev    # dev server with HMR (proxy to :3000)
cd admin && npm run build  # build to ../admin-dist/

# First-time setup
cp .env.example .env      # then edit JWT_SECRET
npm install
cd admin && npm install

# Docker
docker-compose up -d
```

Default admin credentials: `admin` / `admin123` (change immediately)

## Architecture

Three-tier system running on port 3000:

```
External Systems (HomeAssistant, etc.)
        ↓ REST API (/api/v1/)
Node.js/Express + Socket.IO (src/)
        ↓ HTTP + WebSocket
client/  — Vanilla JS display client (iOS/Android browsers)
admin-dist/ — Vue.js 3 admin dashboard (built from admin/)
```

**Static serving**: Admin at `/admin/*` (from `admin-dist/`), client at `/client/*`

## Backend Structure (`src/`)

- `index.js` — Express entry, Socket.IO init, scheduler init, default admin creation
- `config/database.js` — SQLite init + all table schemas
- `middleware/auth.js` — `authenticateJWT` (Bearer token), `authenticateApiKey` (X-API-Key header), `authenticateAny`
- `dao/` — Promise-wrapped sqlite3 DAOs; JSON fields auto-serialized/deserialized
- `services/socketService.js` — Device WS connections, room management, active emergency push on connect
- `services/schedulerService.js` — node-schedule for timed reminders (start/end events)
- `routes/` + `controllers/` — REST endpoints

## Key Design Decisions

- **Vanilla JS for display client**: Old devices (iPhones, iPads) are the target; no framework
- **Three-tier priority system**: Emergency alerts > Timed reminders > Normal scene carousel
- **Emergency alert latency**: Must be < 2 seconds end-to-end via Socket.IO
- **Offline resilience**: Display client caches last config in LocalStorage
- **SQLite**: Single file at `./data/signage.db` (Docker volume: `/app/data`)

## API Conventions

- All endpoints: `/api/v1/` prefix
- Auth: JWT via `Authorization: Bearer <token>` for admin; `X-API-Key` for external systems
- Device client uses `X-Device-Key` header (not JWT) for `/devices/:id/config`
- Success: `{ "data": ..., "message": "..." }` — Error: `{ "error": "..." }`

## Request Format Notes

Emergency alert body uses snake_case (`device_ids`) or camelCase (`deviceIds`) — controller accepts both.
Timed reminder `start_time`/`end_time` must be in `HH:MM` format.
`content` and `sound` are nested objects (not flat fields).

## WebSocket Events

| Event | Direction | Purpose |
|-------|-----------|---------|
| `config-updated` | Server→Client | Trigger config reload |
| `timed-reminder-start/end` | Server→Client | Overlay reminder on current scene |
| `emergency-alert/clear` | Server→Client | Full-screen interruption |
| `force-refresh` | Server→Client | Force page reload |

## Display Client State Machine

`INIT → LOADING → NORMAL (carousel) ↔ TIMED_REMINDER (overlay) ↔ EMERGENCY (full-screen) / OFFLINE (cached)`

Emergency always takes highest priority and interrupts everything.
