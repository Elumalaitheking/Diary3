# Calm Diary (Mobile-First, No Login)

A personal, offline-friendly diary web app designed for one user on phone or browser.

## Features

- Daily diary entries with editable date, title/event, rich text formatting (bold/italic/underline), and optional multiple photos.
- Auto-save draft while typing.
- Built-in lightweight text cleanup (spacing/capitalization) plus browser spellcheck support.
- Search by keyword/date/month/year and advanced date-range + keyword filtering.
- Separate Notes section (quick notes, learning notes, ideas) with tags, search, edit, and delete.
- Reminders with list + simple calendar grouping and browser notification support.
- Photo upload from gallery/camera + automatic image compression.
- Mobile-first calm UI and bottom navigation.
- Settings: dark mode, export (JSON/TXT/PDF via print), backup restore, clear all data.
- Local storage persistence and service-worker based offline caching.

## Tech

- Vanilla HTML/CSS/JavaScript
- LocalStorage for all data persistence
- Service worker + manifest for PWA-style install/offline behavior

## Run Locally

Because service workers require HTTP/HTTPS context, serve with a local web server:

```bash
python3 -m http.server 8080
```

Then open:

- `http://localhost:8080`

On mobile, connect from same network using your machine IP:

- `http://<your-local-ip>:8080`

## Usage Tips

1. Add entries in **Add Entry**.
2. Use formatting toolbar for diary styling.
3. Upload photos directly from phone camera/gallery.
4. Search from **Search** using keyword + date filters.
5. Save quick notes in **Notes**.
6. Add reminders in **Reminders**, then enable notifications.
7. Use **Settings** to export/backup/restore data.

## Data Storage & Privacy

- No login/authentication exists.
- All data stays in the current browser's local storage.
- Clearing browser data will remove diary content unless exported first.

