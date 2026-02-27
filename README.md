# Diary3

Production-ready mobile-first private diary app with secure authentication, diary entries, reminders, notes, export, backup/restore, and AI writing assistant tools.

## Stack
- Frontend: Vanilla JS SPA (mobile-first, PWA)
- Backend: Node.js + Express
- DB: SQLite
- Auth: Password hash (bcrypt) + secure cookie session

## Run
```bash
npm install
npm start
```
Open `http://localhost:3000`.

## Features
- Register / login / logout
- Private user-isolated diary CRUD
- Rich text editor + auto-save draft
- Mood / tags / events / photo uploads
- Search by keyword/date/month/year/tag + calendar/timeline APIs
- Quick notes with pinning
- Reminders with repeat options + daily reflection flag
- AI writer tools: correction, tone rewrite, summary, mood, title, takeaway
- Export TXT / PDF
- Backup / restore JSON
- PWA offline cache + install manifest

## Security defaults
- `helmet` security headers
- Rate-limited auth endpoints
- Sanitized HTML storage
- Password hashing (`bcryptjs`, cost 12)
- Auth-required API protection and per-user data filtering

## Database schema
Defined in `db.js`:
- `users`
- `entries`
- `entry_versions`
- `notes`
- `reminders`

## Deployment notes
- Set `SESSION_SECRET` env var in production
- Replace SQLite with managed SQL if scaling beyond single-node
- Place app behind HTTPS reverse proxy (Nginx/Cloudflare/etc)
