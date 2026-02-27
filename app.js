const STORAGE_KEY = "calmDiaryData_v1";
const DRAFT_KEY = "calmDiaryDraft_v1";

const state = {
  entries: [],
  notes: [],
  reminders: [],
  settings: { darkMode: false },
  draftPhotos: [],
};

const byId = (id) => document.getElementById(id);
const escapeHtml = (str = "") => str.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function init() {
  loadState();
  setupDateAndSelectors();
  setupNav();
  setupEntryEditor();
  setupSearch();
  setupNotes();
  setupReminders();
  setupSettings();
  renderAll();
  registerPWA();
  startReminderTicker();
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) Object.assign(state, JSON.parse(raw));
  document.documentElement.classList.toggle("dark", !!state.settings.darkMode);

  const draft = localStorage.getItem(DRAFT_KEY);
  if (draft) {
    const parsed = JSON.parse(draft);
    byId("entryDate").value = parsed.date || new Date().toISOString().slice(0, 10);
    byId("entryTitle").value = parsed.title || "";
    byId("entryContent").innerHTML = parsed.content || "";
    state.draftPhotos = parsed.photos || [];
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    entries: state.entries,
    notes: state.notes,
    reminders: state.reminders,
    settings: state.settings,
  }));
}

function setupDateAndSelectors() {
  byId("todayLabel").textContent = new Date().toDateString();
  if (!byId("entryDate").value) byId("entryDate").value = new Date().toISOString().slice(0, 10);

  const monthSelect = byId("searchMonth");
  const yearSelect = byId("searchYear");
  for (let m = 1; m <= 12; m++) {
    monthSelect.insertAdjacentHTML("beforeend", `<option value="${m}">${String(m).padStart(2, "0")}</option>`);
  }
  const currentYear = new Date().getFullYear();
  for (let y = currentYear - 15; y <= currentYear + 1; y++) {
    yearSelect.insertAdjacentHTML("beforeend", `<option value="${y}">${y}</option>`);
  }
}

function setupNav() {
  document.querySelectorAll(".bottom-nav button").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
      byId(btn.dataset.view).classList.add("active");
      document.querySelectorAll(".bottom-nav button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });
}

function setupEntryEditor() {
  document.querySelectorAll("[data-cmd]").forEach((b) => {
    b.addEventListener("click", () => document.execCommand(b.dataset.cmd, false, null));
  });

  const autosave = debounce(() => {
    const draft = {
      date: byId("entryDate").value,
      title: autoFixText(byId("entryTitle").value.trim()),
      content: autoFixHtml(byId("entryContent").innerHTML),
      photos: state.draftPhotos,
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    byId("autosaveStatus").textContent = `Draft auto-saved at ${new Date().toLocaleTimeString()}`;
  }, 500);

  ["entryDate", "entryTitle"].forEach((id) => byId(id).addEventListener("input", autosave));
  byId("entryContent").addEventListener("input", () => {
    byId("entryContent").setAttribute("spellcheck", "true");
    autosave();
  });

  byId("entryPhotos").addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    const compressed = await Promise.all(files.map(compressImage));
    state.draftPhotos.push(...compressed.filter(Boolean));
    renderDraftPhotos();
    autosave();
  });

  byId("entryForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const entry = {
      id: crypto.randomUUID(),
      date: byId("entryDate").value,
      title: autoFixText(byId("entryTitle").value),
      content: autoFixHtml(byId("entryContent").innerHTML),
      photos: [...state.draftPhotos],
      createdAt: Date.now(),
    };
    state.entries.unshift(entry);
    saveState();
    clearDraft();
    renderEntries();
    alert("Diary entry saved 🌿");
  });

  renderDraftPhotos();
}

function autoFixText(text) {
  return text
    .replace(/\s+/g, " ")
    .replace(/\bi\b/g, "I")
    .replace(/\.\s+([a-z])/g, (_, l) => `. ${l.toUpperCase()}`)
    .trim();
}

function autoFixHtml(html) {
  return autoFixText(html)
    .replace(/\n{2,}/g, "<p></p>")
    .replace(/\n/g, "<br>");
}

function clearDraft() {
  byId("entryTitle").value = "";
  byId("entryContent").innerHTML = "";
  state.draftPhotos = [];
  byId("entryPhotos").value = "";
  localStorage.removeItem(DRAFT_KEY);
  renderDraftPhotos();
}

function renderDraftPhotos() {
  byId("photoPreview").innerHTML = state.draftPhotos.map((p) => `<img src="${p}" alt="draft" />`).join("");
}

function setupSearch() {
  byId("runSearch").addEventListener("click", renderSearchResults);
}

function renderEntries() {
  const list = byId("entryList");
  list.innerHTML = "";
  state.entries.slice(0, 10).forEach((entry) => list.appendChild(makeEntryCard(entry)));
}

function renderSearchResults() {
  const keyword = byId("searchKeyword").value.toLowerCase().trim();
  const from = byId("searchFrom").value;
  const to = byId("searchTo").value;
  const month = byId("searchMonth").value;
  const year = byId("searchYear").value;

  const results = state.entries.filter((e) => {
    const date = new Date(e.date);
    const matchedKeyword = !keyword || `${e.title} ${e.content}`.toLowerCase().includes(keyword);
    const matchedFrom = !from || e.date >= from;
    const matchedTo = !to || e.date <= to;
    const matchedMonth = !month || date.getMonth() + 1 === Number(month);
    const matchedYear = !year || date.getFullYear() === Number(year);
    return matchedKeyword && matchedFrom && matchedTo && matchedMonth && matchedYear;
  });

  const target = byId("searchResults");
  target.innerHTML = results.length ? "" : "<p>No entries matched your filters.</p>";
  results.forEach((entry) => target.appendChild(makeEntryCard(entry)));
}

function makeEntryCard(entry) {
  const card = byId("cardTemplate").content.firstElementChild.cloneNode(true);
  card.innerHTML = `
    <h3>${escapeHtml(entry.title)}</h3>
    <div class="meta">${escapeHtml(entry.date)}</div>
    <div>${entry.content}</div>
    ${(entry.photos || []).map((p) => `<img src="${p}" alt="Diary photo">`).join("")}
  `;
  return card;
}

function setupNotes() {
  byId("saveNote").addEventListener("click", () => {
    const note = {
      id: crypto.randomUUID(),
      title: byId("noteTitle").value.trim() || "Untitled",
      text: byId("noteText").value.trim(),
      tags: byId("noteTags").value.split(",").map((t) => t.trim()).filter(Boolean),
      createdAt: Date.now(),
    };
    state.notes.unshift(note);
    byId("noteTitle").value = "";
    byId("noteText").value = "";
    byId("noteTags").value = "";
    saveState();
    renderNotes();
  });
  byId("noteSearch").addEventListener("input", renderNotes);
}

function renderNotes() {
  const q = byId("noteSearch").value.toLowerCase().trim();
  const list = byId("noteList");
  list.innerHTML = "";
  state.notes
    .filter((n) => !q || `${n.title} ${n.text} ${(n.tags || []).join(" ")}`.toLowerCase().includes(q))
    .forEach((n) => {
      const card = byId("cardTemplate").content.firstElementChild.cloneNode(true);
      card.innerHTML = `
        <h3 contenteditable="true" data-edit-note="title" data-id="${n.id}">${escapeHtml(n.title)}</h3>
        <p contenteditable="true" data-edit-note="text" data-id="${n.id}">${escapeHtml(n.text)}</p>
        <div class="meta">Tags: ${(n.tags || []).map(escapeHtml).join(", ")}</div>
        <div class="actions"><button data-delete-note="${n.id}">Delete</button></div>
      `;
      list.appendChild(card);
    });

  list.querySelectorAll("[data-delete-note]").forEach((b) => b.addEventListener("click", () => {
    state.notes = state.notes.filter((n) => n.id !== b.dataset.deleteNote);
    saveState();
    renderNotes();
  }));

  list.querySelectorAll("[data-edit-note]").forEach((el) => el.addEventListener("blur", () => {
    const note = state.notes.find((n) => n.id === el.dataset.id);
    if (!note) return;
    note[el.dataset.editNote] = el.textContent.trim();
    saveState();
  }));
}

function setupReminders() {
  byId("saveReminder").addEventListener("click", () => {
    const at = byId("reminderTime").value;
    if (!at) return alert("Please choose date and time");
    state.reminders.push({
      id: crypto.randomUUID(),
      title: byId("reminderTitle").value.trim() || "Reminder",
      description: byId("reminderDesc").value.trim(),
      at,
      notified: false,
    });
    saveState();
    renderReminders();
  });

  byId("notifyPermission").addEventListener("click", async () => {
    if (!("Notification" in window)) return alert("Notifications not supported in this browser.");
    const permission = await Notification.requestPermission();
    alert(`Notification permission: ${permission}`);
  });
}

function renderReminders() {
  const list = byId("reminderList");
  const sorted = [...state.reminders].sort((a, b) => a.at.localeCompare(b.at));
  list.innerHTML = "";
  sorted.forEach((r) => {
    const card = byId("cardTemplate").content.firstElementChild.cloneNode(true);
    card.innerHTML = `
      <h3>${escapeHtml(r.title)}</h3>
      <div class="meta">${new Date(r.at).toLocaleString()}</div>
      <p>${escapeHtml(r.description || "")}</p>
      <div class="actions"><button data-delete-reminder="${r.id}">Delete</button></div>
    `;
    list.appendChild(card);
  });
  list.querySelectorAll("[data-delete-reminder]").forEach((b) => b.addEventListener("click", () => {
    state.reminders = state.reminders.filter((r) => r.id !== b.dataset.deleteReminder);
    saveState();
    renderReminders();
  }));

  const grouped = {};
  sorted.forEach((r) => {
    const day = r.at.slice(0, 10);
    grouped[day] = (grouped[day] || 0) + 1;
  });
  byId("calendarView").innerHTML = Object.keys(grouped).sort().map((day) => `<div class="day">${day}: ${grouped[day]} reminder(s)</div>`).join("");
}

function startReminderTicker() {
  setInterval(() => {
    const now = Date.now();
    let changed = false;
    state.reminders.forEach((r) => {
      if (!r.notified && new Date(r.at).getTime() <= now) {
        changed = true;
        r.notified = true;
        if ("Notification" in window && Notification.permission === "granted") {
          new Notification(r.title, { body: r.description || "Reminder" });
        }
      }
    });
    if (changed) saveState();
  }, 15000);
}

function setupSettings() {
  byId("darkModeToggle").checked = !!state.settings.darkMode;
  byId("darkModeToggle").addEventListener("change", () => {
    state.settings.darkMode = byId("darkModeToggle").checked;
    document.documentElement.classList.toggle("dark", state.settings.darkMode);
    saveState();
  });

  byId("exportJson").addEventListener("click", () => {
    download("calm-diary-backup.json", JSON.stringify(state, null, 2), "application/json");
  });

  byId("exportText").addEventListener("click", () => {
    const text = state.entries
      .map((e) => `# ${e.date} - ${e.title}\n${stripHtml(e.content)}\n`)
      .join("\n");
    download("calm-diary.txt", text, "text/plain");
  });

  byId("exportPdf").addEventListener("click", () => window.print());

  byId("restoreFile").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const data = JSON.parse(await file.text());
    if (!confirm("Restore backup and replace current data?")) return;
    state.entries = data.entries || [];
    state.notes = data.notes || [];
    state.reminders = data.reminders || [];
    state.settings = data.settings || { darkMode: false };
    saveState();
    renderAll();
  });

  byId("clearData").addEventListener("click", () => {
    if (!confirm("Are you sure you want to delete all diary data? This cannot be undone.")) return;
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(DRAFT_KEY);
    location.reload();
  });
}

function renderAll() {
  renderEntries();
  renderNotes();
  renderReminders();
  renderSearchResults();
}

function download(name, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function stripHtml(html) {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent || "";
}

function debounce(fn, delay) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}

function compressImage(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxW = 1280;
        const scale = Math.min(1, maxW / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.78));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function registerPWA() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(console.error);
  }
}

window.addEventListener("DOMContentLoaded", init);
