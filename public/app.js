const state = {
  user: null,
  entries: [],
  notes: [],
  reminders: [],
  currentView: 'home',
};

const qs = (s) => document.querySelector(s);
const dashboard = qs('#dashboard');
const authView = qs('#authView');
const bottomNav = qs('#bottomNav');

const api = async (url, opts = {}) => {
  const response = await fetch(url, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...opts });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
};

function setTheme(theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  localStorage.setItem('theme', theme);
  qs('#themeToggle').textContent = theme === 'dark' ? '☀️' : '🌙';
}

function showToast(text) { alert(text); }

function formatDate(iso) { return new Date(iso).toLocaleString(); }

async function loadAll() {
  const [entries, notes, reminders] = await Promise.all([
    api('/api/entries'),
    api('/api/notes'),
    api('/api/reminders'),
  ]);
  state.entries = entries.items;
  state.notes = notes.items;
  state.reminders = reminders.items;
  renderHome(); renderCalendar(); renderReminders(); renderProfile();
}

function viewSwitcher(target) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === target));
  document.querySelectorAll('#bottomNav button').forEach((b) => b.classList.toggle('active', b.dataset.target === target));
  state.currentView = target;
  if (target === 'new-entry') renderEditor();
}

function bindSwipe(card, id) {
  let x0 = null;
  card.addEventListener('touchstart', (e) => { x0 = e.changedTouches[0].screenX; });
  card.addEventListener('touchend', (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].screenX - x0;
    if (dx < -60) card.classList.add('swiped');
    if (dx > 30) card.classList.remove('swiped');
  });
}

function renderHome() {
  const home = qs('#home');
  home.innerHTML = `<section class="card"><h2>Today</h2><p class="small">Streak loading...</p><div id="entriesWrap"></div></section>
  <section class="card"><h3>Quick Notes</h3><div id="notesWrap"></div><form id="newNote"><textarea id="quickNoteBody" placeholder="Capture a quick thought..."></textarea><button class="primary">Add note</button></form></section>`;

  api('/api/streak').then((d) => { home.querySelector('.small').textContent = `Current writing streak: ${d.streak} day(s)`; }).catch(() => {});

  const entriesWrap = qs('#entriesWrap');
  state.entries.slice(0, 10).forEach((e) => {
    const card = document.createElement('article');
    card.className = 'card entry-card';
    card.innerHTML = `<h3>${e.title} ${e.mood || ''}</h3><p class="small">${formatDate(e.created_at)}</p><div class="entry-content">${e.content_html.slice(0, 180)}...</div>
      <p>${(e.tags || '').split(',').filter(Boolean).map((t) => `<span class='tag'>${t.trim()}</span>`).join('')}</p>
      <div class='row'><button class='secondary editBtn'>Edit</button><button class='ghost-btn delBtn'>Delete</button></div>`;
    bindSwipe(card, e.id);
    card.querySelector('.delBtn').onclick = async () => { await api(`/api/entries/${e.id}`, { method: 'DELETE' }); await loadAll(); };
    card.querySelector('.editBtn').onclick = () => { renderEditor(e); viewSwitcher('new-entry'); };
    entriesWrap.appendChild(card);
  });

  const notesWrap = qs('#notesWrap');
  state.notes.forEach((n) => {
    const node = document.createElement('div');
    node.className = 'list-item';
    node.innerHTML = `<span>${n.pinned ? '📌' : ''} ${n.body}</span><div><button data-id='${n.id}' class='secondary pinBtn'>Pin</button><button data-id='${n.id}' class='ghost-btn noteDel'>Del</button></div>`;
    notesWrap.appendChild(node);
  });
  notesWrap.querySelectorAll('.pinBtn').forEach((b) => b.onclick = async () => {
    const note = state.notes.find((n) => n.id === Number(b.dataset.id));
    await api(`/api/notes/${note.id}`, { method: 'PUT', body: JSON.stringify({ body: note.body, pinned: !note.pinned }) });
    await loadAll();
  });
  notesWrap.querySelectorAll('.noteDel').forEach((b) => b.onclick = async () => { await api(`/api/notes/${b.dataset.id}`, { method: 'DELETE' }); await loadAll(); });

  qs('#newNote').onsubmit = async (e) => {
    e.preventDefault();
    await api('/api/notes', { method: 'POST', body: JSON.stringify({ body: qs('#quickNoteBody').value }) });
    qs('#quickNoteBody').value = '';
    await loadAll();
  };
}

function renderEditor(editing = null) {
  const host = qs('#new-entry');
  host.innerHTML = `<section class='card'>
  <h2>${editing ? 'Edit entry' : 'New entry'}</h2>
  <input id='entryTitle' placeholder='Title' value="${editing?.title || ''}" />
  <input id='entryDate' type='datetime-local' value='${new Date(editing?.created_at || Date.now()).toISOString().slice(0,16)}' />
  <input id='entryTags' placeholder='tags, events' value='${editing?.tags || ''}' />
  <select id='entryMood'>${['😌','😊','😔','😠','🤩'].map((m) => `<option ${editing?.mood===m?'selected':''}>${m}</option>`).join('')}</select>
  <div class='toolbar'>
    <button data-cmd='bold' type='button'>B</button><button data-cmd='italic' type='button'>I</button><button data-cmd='underline' type='button'>U</button>
    <button data-cmd='insertUnorderedList' type='button'>• List</button><button data-cmd='formatBlock' data-value='blockquote' type='button'>Quote</button><button data-cmd='hiliteColor' data-value='yellow' type='button'>Highlight</button>
  </div>
  <div id='entryContent' class='editor' contenteditable='true'>${editing?.content_html || localStorage.getItem('draft') || '<p>Write your day...</p>'}</div>
  <input id='entryPhoto' type='file' accept='image/*' capture='environment' />
  <div class='row'><button id='saveEntry' class='primary'>${editing ? 'Update' : 'Save entry'}</button><button id='aiAssist' class='secondary' type='button'>AI Assist</button></div>
  <div class='row'><select id='tone'><option>Simple</option><option>Emotional</option><option>Reflective</option><option>Motivational</option></select><button id='applyAi' class='ghost-btn' type='button'>Apply Tone</button></div>
  <p class='small' id='autosaveLabel'>Autosave ready.</p>
  </section>`;

  host.querySelectorAll('.toolbar button').forEach((btn) => btn.onclick = () => document.execCommand(btn.dataset.cmd, false, btn.dataset.value || null));

  let timer;
  const content = qs('#entryContent');
  content.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      localStorage.setItem('draft', content.innerHTML);
      qs('#autosaveLabel').textContent = `Autosaved at ${new Date().toLocaleTimeString()}`;
    }, 600);
  });

  qs('#aiAssist').onclick = async () => {
    const resp = await api('/api/ai/assist', { method: 'POST', body: JSON.stringify({ content: content.innerText, tone: qs('#tone').value }) });
    showToast(`Mood detected: ${resp.mood}\nSuggested title: ${resp.title}\nTakeaway: ${resp.takeaway}`);
  };
  qs('#applyAi').onclick = async () => {
    const resp = await api('/api/ai/assist', { method: 'POST', body: JSON.stringify({ content: content.innerText, tone: qs('#tone').value }) });
    content.innerText = resp.corrected;
    qs('#entryTitle').value = qs('#entryTitle').value || resp.title;
  };

  qs('#saveEntry').onclick = async () => {
    const fd = new FormData();
    fd.append('title', qs('#entryTitle').value);
    fd.append('entryDate', new Date(qs('#entryDate').value).toISOString());
    fd.append('tags', qs('#entryTags').value);
    fd.append('mood', qs('#entryMood').value);
    fd.append('contentHtml', content.innerHTML);
    const file = qs('#entryPhoto').files[0];
    if (file) fd.append('photo', file);
    if (editing) {
      await fetch(`/api/entries/${editing.id}`, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        title: qs('#entryTitle').value, entryDate: new Date(qs('#entryDate').value).toISOString(), tags: qs('#entryTags').value, mood: qs('#entryMood').value, contentHtml: content.innerHTML,
      }) }).then((r) => r.ok ? r : Promise.reject(new Error('Update failed')));
    } else {
      await fetch('/api/entries', { method: 'POST', credentials: 'include', body: fd }).then((r) => r.ok ? r : Promise.reject(new Error('Save failed')));
    }
    localStorage.removeItem('draft');
    await loadAll();
    viewSwitcher('home');
  };
}

function renderCalendar() {
  const host = qs('#calendar');
  host.innerHTML = `<section class='card'><h2>Search & Calendar</h2><div class='row'><input id='query' placeholder='Keyword' /><input id='dateSearch' type='date' /></div>
  <div class='row'><input id='monthSearch' type='number' min='1' max='12' placeholder='Month' /><input id='yearSearch' type='number' min='2000' max='2100' placeholder='Year' /><button id='searchBtn' class='primary'>Search</button></div>
  <div id='calendarResults'></div></section>`;

  qs('#searchBtn').onclick = async () => {
    const p = new URLSearchParams();
    if (qs('#query').value) p.set('q', qs('#query').value);
    if (qs('#dateSearch').value) p.set('date', qs('#dateSearch').value);
    if (qs('#monthSearch').value && qs('#yearSearch').value) { p.set('month', qs('#monthSearch').value); p.set('year', qs('#yearSearch').value); }
    const data = await api(`/api/entries?${p.toString()}`);
    qs('#calendarResults').innerHTML = data.items.map((e) => `<article class='entry-card card'><h3>${e.title}</h3><p class='small'>${formatDate(e.created_at)} ${e.mood}</p></article>`).join('') || '<p>No results</p>';
  };
}

function renderReminders() {
  const host = qs('#reminders');
  host.innerHTML = `<section class='card'><h2>Reminders</h2>
  <form id='reminderForm'><input id='remTitle' placeholder='Reminder title' required /><input id='remAt' type='datetime-local' required />
  <select id='repeatMode'><option value='none'>No repeat</option><option value='daily'>Daily</option><option value='weekly'>Weekly</option></select>
  <label><input type='checkbox' id='dailyReflection' /> Daily reflection</label><button class='primary'>Save reminder</button></form>
  <div id='reminderList'></div></section>`;

  qs('#reminderForm').onsubmit = async (e) => {
    e.preventDefault();
    await api('/api/reminders', {
      method: 'POST',
      body: JSON.stringify({ title: qs('#remTitle').value, remindAt: new Date(qs('#remAt').value).toISOString(), repeatMode: qs('#repeatMode').value, dailyReflection: qs('#dailyReflection').checked }),
    });
    await loadAll();
  };

  const list = qs('#reminderList');
  state.reminders.forEach((r) => {
    const node = document.createElement('div');
    node.className = 'list-item';
    node.innerHTML = `<span>${r.is_done ? '✅' : '⏰'} ${r.title} - ${formatDate(r.remind_at)}</span><button class='ghost-btn' data-id='${r.id}'>Delete</button>`;
    list.appendChild(node);
  });
  list.querySelectorAll('button').forEach((b) => b.onclick = async () => { await api(`/api/reminders/${b.dataset.id}`, { method: 'DELETE' }); await loadAll(); });
}

function renderProfile() {
  const host = qs('#profile');
  host.innerHTML = `<section class='card'><h2>Profile</h2><p>${state.user.displayName} (${state.user.email})</p>
  <div class='row'><button id='exportTxt' class='secondary'>Export TXT</button><button id='exportPdf' class='secondary'>Export PDF</button></div>
  <div class='row'><button id='backupBtn' class='ghost-btn'>Backup JSON</button><input id='restoreInput' type='file' accept='application/json' /></div>
  <button id='logoutBtn' class='primary'>Logout</button></section>`;
  qs('#exportTxt').onclick = () => window.open('/api/export/txt', '_blank');
  qs('#exportPdf').onclick = () => window.open('/api/export/pdf', '_blank');
  qs('#backupBtn').onclick = async () => {
    const data = await api('/api/backup');
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'diary-backup.json'; a.click();
  };
  qs('#restoreInput').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    await api('/api/restore', { method: 'POST', body: text });
    await loadAll();
  };
  qs('#logoutBtn').onclick = async () => { await api('/api/auth/logout', { method: 'POST' }); location.reload(); };
}

async function bootstrap() {
  setTheme(localStorage.getItem('theme') || 'light');
  qs('#themeToggle').onclick = () => setTheme(document.documentElement.classList.contains('dark') ? 'light' : 'dark');

  bottomNav.querySelectorAll('button').forEach((b) => b.onclick = () => viewSwitcher(b.dataset.target));

  qs('#authForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = { email: qs('#email').value, password: qs('#password').value };
      const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify(payload) });
      state.user = data.user;
      authView.classList.add('hidden'); dashboard.classList.remove('hidden'); bottomNav.classList.remove('hidden');
      await loadAll(); renderEditor();
    } catch (err) { showToast(err.message); }
  };

  qs('#registerBtn').onclick = async () => {
    try {
      const data = await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email: qs('#email').value, password: qs('#password').value, displayName: qs('#displayName').value || 'Diary User' }),
      });
      state.user = data.user;
      authView.classList.add('hidden'); dashboard.classList.remove('hidden'); bottomNav.classList.remove('hidden');
      await loadAll(); renderEditor();
    } catch (err) { showToast(err.message); }
  };

  try {
    const data = await api('/api/auth/me');
    state.user = data.user;
    authView.classList.add('hidden'); dashboard.classList.remove('hidden'); bottomNav.classList.remove('hidden');
    await loadAll(); renderEditor();
  } catch {
    authView.classList.remove('hidden');
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => null);
  }

  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
}

bootstrap();
