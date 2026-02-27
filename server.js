const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const dayjs = require('dayjs');
const multer = require('multer');
const sanitizeHtml = require('sanitize-html');
const PDFDocument = require('pdfkit');
const { v4: uuidv4 } = require('uuid');
const { initDb } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

const upload = multer({
  storage: multer.diskStorage({
    destination: (_, __, cb) => cb(null, path.join(__dirname, 'public/uploads')),
    filename: (_, file, cb) => cb(null, `${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false }));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-session-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 },
  })
);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  message: { error: 'Too many attempts, please wait.' },
});

let db;

const cleanHtml = (html) =>
  sanitizeHtml(html || '', {
    allowedTags: ['b', 'i', 'u', 'strong', 'em', 'p', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote', 'mark', 'br'],
    allowedAttributes: {},
  });

const requireAuth = (req, res, next) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

function deriveMood(text) {
  const sample = (text || '').toLowerCase();
  if (/(grateful|happy|great|love|excited)/.test(sample)) return '😊';
  if (/(sad|tired|low|cry|down)/.test(sample)) return '😔';
  if (/(angry|frustrated|annoyed)/.test(sample)) return '😠';
  return '😌';
}

function aiAssist(content, tone) {
  const base = content.replace(/\s+/g, ' ').trim();
  const sentence = base ? `${base}.` : '';
  const toned = {
    Simple: sentence,
    Emotional: `Today felt meaningful. ${sentence}`,
    Reflective: `Looking back, ${sentence}`,
    Motivational: `I can keep growing. ${sentence}`,
  }[tone] || sentence;
  const words = base.split(' ').filter(Boolean);
  return {
    corrected: toned.replace(/\bi\b/g, 'I'),
    summary: words.slice(0, 30).join(' ') || 'No content to summarize yet.',
    mood: deriveMood(base),
    title: words.slice(0, 6).join(' ') || 'Untitled Reflection',
    takeaway: words.slice(-8).join(' ') || 'Write one step for tomorrow.',
  };
}

app.use('/api/auth', authLimiter);

app.post('/api/auth/register', async (req, res) => {
  const { email, password, displayName } = req.body;
  if (!email || !password || !displayName || password.length < 8) {
    return res.status(400).json({ error: 'Invalid registration payload.' });
  }
  try {
    const hash = await bcrypt.hash(password, 12);
    const createdAt = new Date().toISOString();
    const result = await db.run(
      'INSERT INTO users (email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?)',
      [email.toLowerCase(), displayName.trim(), hash, createdAt]
    );
    req.session.userId = result.lastID;
    res.json({ ok: true, user: { id: result.lastID, email, displayName } });
  } catch (error) {
    res.status(409).json({ error: 'Email already exists.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await db.get('SELECT * FROM users WHERE email = ?', [String(email || '').toLowerCase()]);
  if (!user) return res.status(401).json({ error: 'Invalid credentials.' });
  const ok = await bcrypt.compare(password || '', user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials.' });
  req.session.userId = user.id;
  res.json({ ok: true, user: { id: user.id, email: user.email, displayName: user.display_name } });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  const user = await db.get('SELECT id,email,display_name FROM users WHERE id = ?', [req.session.userId]);
  res.json({ user: { id: user.id, email: user.email, displayName: user.display_name } });
});

app.post('/api/entries', requireAuth, upload.single('photo'), async (req, res) => {
  const now = new Date().toISOString();
  const html = cleanHtml(req.body.contentHtml);
  const text = sanitizeHtml(html, { allowedTags: [] });
  const result = await db.run(
    `INSERT INTO entries (user_id,title,content_html,content_text,mood,tags,event_label,created_at,updated_at,photo_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      req.session.userId,
      req.body.title || 'Untitled',
      html,
      text,
      req.body.mood || '😌',
      req.body.tags || '',
      req.body.eventLabel || '',
      req.body.entryDate || now,
      now,
      req.file ? `/uploads/${req.file.filename}` : null,
    ]
  );
  res.json({ ok: true, id: result.lastID });
});

app.get('/api/entries', requireAuth, async (req, res) => {
  const { q, date, month, year, tag } = req.query;
  const clauses = ['user_id = ?'];
  const params = [req.session.userId];
  if (q) {
    clauses.push('(title LIKE ? OR content_text LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  if (date) {
    clauses.push('date(created_at) = date(?)');
    params.push(date);
  }
  if (month && year) {
    clauses.push("strftime('%m', created_at) = ? AND strftime('%Y', created_at) = ?");
    params.push(String(month).padStart(2, '0'), String(year));
  }
  if (tag) {
    clauses.push('tags LIKE ?');
    params.push(`%${tag}%`);
  }

  const rows = await db.all(
    `SELECT * FROM entries WHERE ${clauses.join(' AND ')} ORDER BY datetime(created_at) DESC`,
    params
  );
  res.json({ items: rows });
});

app.put('/api/entries/:id', requireAuth, async (req, res) => {
  const entry = await db.get('SELECT * FROM entries WHERE id = ? AND user_id = ?', [req.params.id, req.session.userId]);
  if (!entry) return res.status(404).json({ error: 'Not found' });
  await db.run('INSERT INTO entry_versions (entry_id, snapshot_html, snapshot_text, saved_at) VALUES (?, ?, ?, ?)', [
    entry.id,
    entry.content_html,
    entry.content_text,
    new Date().toISOString(),
  ]);

  const html = cleanHtml(req.body.contentHtml || entry.content_html);
  const text = sanitizeHtml(html, { allowedTags: [] });
  await db.run(
    `UPDATE entries SET title=?, content_html=?, content_text=?, mood=?, tags=?, event_label=?, updated_at=?, created_at=? WHERE id=? AND user_id=?`,
    [
      req.body.title || entry.title,
      html,
      text,
      req.body.mood || entry.mood,
      req.body.tags || entry.tags,
      req.body.eventLabel || entry.event_label,
      new Date().toISOString(),
      req.body.entryDate || entry.created_at,
      req.params.id,
      req.session.userId,
    ]
  );
  res.json({ ok: true });
});

app.delete('/api/entries/:id', requireAuth, async (req, res) => {
  await db.run('DELETE FROM entries WHERE id = ? AND user_id = ?', [req.params.id, req.session.userId]);
  res.json({ ok: true });
});

app.get('/api/calendar', requireAuth, async (req, res) => {
  const items = await db.all(
    `SELECT date(created_at) as day, count(*) as count, group_concat(mood,' ') as moods
     FROM entries WHERE user_id = ? GROUP BY date(created_at) ORDER BY day DESC`,
    [req.session.userId]
  );
  res.json({ items });
});

app.get('/api/timeline', requireAuth, async (req, res) => {
  const items = await db.all(
    `SELECT id,title,created_at,event_label,mood FROM entries WHERE user_id = ? ORDER BY datetime(created_at) DESC`,
    [req.session.userId]
  );
  res.json({ items });
});

app.get('/api/notes', requireAuth, async (req, res) => {
  const notes = await db.all('SELECT * FROM notes WHERE user_id = ? ORDER BY pinned DESC, datetime(updated_at) DESC', [req.session.userId]);
  res.json({ items: notes });
});

app.post('/api/notes', requireAuth, async (req, res) => {
  const now = new Date().toISOString();
  const result = await db.run('INSERT INTO notes (user_id,body,pinned,created_at,updated_at) VALUES (?, ?, ?, ?, ?)', [
    req.session.userId,
    req.body.body || '',
    req.body.pinned ? 1 : 0,
    now,
    now,
  ]);
  res.json({ ok: true, id: result.lastID });
});

app.put('/api/notes/:id', requireAuth, async (req, res) => {
  await db.run('UPDATE notes SET body=?, pinned=?, updated_at=? WHERE id=? AND user_id=?', [
    req.body.body || '',
    req.body.pinned ? 1 : 0,
    new Date().toISOString(),
    req.params.id,
    req.session.userId,
  ]);
  res.json({ ok: true });
});

app.delete('/api/notes/:id', requireAuth, async (req, res) => {
  await db.run('DELETE FROM notes WHERE id = ? AND user_id = ?', [req.params.id, req.session.userId]);
  res.json({ ok: true });
});

app.get('/api/reminders', requireAuth, async (req, res) => {
  const items = await db.all('SELECT * FROM reminders WHERE user_id = ? ORDER BY datetime(remind_at)', [req.session.userId]);
  res.json({ items });
});

app.post('/api/reminders', requireAuth, async (req, res) => {
  const result = await db.run(
    `INSERT INTO reminders (user_id,title,remind_at,repeat_mode,link_type,link_id,daily_reflection,created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      req.session.userId,
      req.body.title,
      req.body.remindAt,
      req.body.repeatMode || 'none',
      req.body.linkType || null,
      req.body.linkId || null,
      req.body.dailyReflection ? 1 : 0,
      new Date().toISOString(),
    ]
  );
  res.json({ ok: true, id: result.lastID });
});

app.put('/api/reminders/:id', requireAuth, async (req, res) => {
  await db.run(
    'UPDATE reminders SET title=?, remind_at=?, repeat_mode=?, is_done=? WHERE id=? AND user_id=?',
    [req.body.title, req.body.remindAt, req.body.repeatMode || 'none', req.body.isDone ? 1 : 0, req.params.id, req.session.userId]
  );
  res.json({ ok: true });
});

app.delete('/api/reminders/:id', requireAuth, async (req, res) => {
  await db.run('DELETE FROM reminders WHERE id=? AND user_id=?', [req.params.id, req.session.userId]);
  res.json({ ok: true });
});

app.get('/api/analytics/mood', requireAuth, async (req, res) => {
  const rows = await db.all('SELECT mood, count(*) as count FROM entries WHERE user_id=? GROUP BY mood', [req.session.userId]);
  res.json({ items: rows });
});

app.get('/api/streak', requireAuth, async (req, res) => {
  const rows = await db.all('SELECT date(created_at) as d FROM entries WHERE user_id=? GROUP BY date(created_at) ORDER BY d DESC', [req.session.userId]);
  let streak = 0;
  let cursor = dayjs();
  for (const row of rows) {
    if (dayjs(row.d).isSame(cursor, 'day')) {
      streak += 1;
      cursor = cursor.subtract(1, 'day');
    } else if (dayjs(row.d).isSame(cursor.subtract(1, 'day'), 'day') && streak === 0) {
      streak += 1;
      cursor = cursor.subtract(2, 'day');
    } else {
      break;
    }
  }
  res.json({ streak });
});

app.post('/api/ai/assist', requireAuth, async (req, res) => {
  const { content, tone } = req.body;
  const response = aiAssist(content || '', tone || 'Simple');
  res.json(response);
});

app.get('/api/export/txt', requireAuth, async (req, res) => {
  const entries = await db.all('SELECT * FROM entries WHERE user_id = ? ORDER BY datetime(created_at)', [req.session.userId]);
  const text = entries
    .map((e) => `# ${e.title}\n${e.created_at}\nMood: ${e.mood}\nTags: ${e.tags || '-'}\n\n${e.content_text}\n`)
    .join('\n-------------------\n');
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', 'attachment; filename="diary-export.txt"');
  res.send(text);
});

app.get('/api/export/pdf', requireAuth, async (req, res) => {
  const entries = await db.all('SELECT * FROM entries WHERE user_id = ? ORDER BY datetime(created_at)', [req.session.userId]);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="diary-export.pdf"');
  const doc = new PDFDocument();
  doc.pipe(res);
  doc.fontSize(18).text('Diary Export', { underline: true });
  doc.moveDown();
  entries.forEach((e) => {
    doc.fontSize(14).text(`${e.title} (${dayjs(e.created_at).format('YYYY-MM-DD HH:mm')})`);
    doc.fontSize(11).fillColor('#666').text(`Mood ${e.mood} | Tags ${e.tags || '-'}`);
    doc.fillColor('#111').text(e.content_text);
    doc.moveDown();
  });
  doc.end();
});

app.get('/api/backup', requireAuth, async (req, res) => {
  const [entries, notes, reminders] = await Promise.all([
    db.all('SELECT * FROM entries WHERE user_id=?', [req.session.userId]),
    db.all('SELECT * FROM notes WHERE user_id=?', [req.session.userId]),
    db.all('SELECT * FROM reminders WHERE user_id=?', [req.session.userId]),
  ]);
  res.json({ entries, notes, reminders });
});

app.post('/api/restore', requireAuth, async (req, res) => {
  const payload = req.body || {};
  await db.run('DELETE FROM entries WHERE user_id=?', [req.session.userId]);
  await db.run('DELETE FROM notes WHERE user_id=?', [req.session.userId]);
  await db.run('DELETE FROM reminders WHERE user_id=?', [req.session.userId]);
  for (const e of payload.entries || []) {
    await db.run(
      `INSERT INTO entries (user_id,title,content_html,content_text,mood,tags,event_label,created_at,updated_at,photo_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.session.userId, e.title, e.content_html, e.content_text, e.mood, e.tags, e.event_label, e.created_at, e.updated_at, e.photo_path]
    );
  }
  for (const n of payload.notes || []) {
    await db.run('INSERT INTO notes (user_id,body,pinned,created_at,updated_at) VALUES (?, ?, ?, ?, ?)', [
      req.session.userId,
      n.body,
      n.pinned ? 1 : 0,
      n.created_at,
      n.updated_at,
    ]);
  }
  for (const r of payload.reminders || []) {
    await db.run(
      'INSERT INTO reminders (user_id,title,remind_at,repeat_mode,link_type,link_id,daily_reflection,is_done,created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [req.session.userId, r.title, r.remind_at, r.repeat_mode, r.link_type, r.link_id, r.daily_reflection ? 1 : 0, r.is_done ? 1 : 0, r.created_at]
    );
  }
  res.json({ ok: true });
});

app.get('/api/health', (_, res) => res.json({ ok: true }));

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'public/index.html')));

(async () => {
  db = await initDb();
  if (!fs.existsSync(path.join(__dirname, 'public/uploads'))) {
    fs.mkdirSync(path.join(__dirname, 'public/uploads'), { recursive: true });
  }
  app.listen(PORT, () => console.log(`Diary app running on http://localhost:${PORT}`));
})();
