"use strict";

// Everything Casefile remembers between visits, kept in this browser's localStorage.
// There is no database yet, so these stay on this device. Every read and write is guarded:
// private windows and blocked storage simply mean nothing is remembered.
const Store = (() => {
  const PREFIX = "casefile:v1:";
  const MAX_BRIEFS = 40;
  const MAX_EVENTS = 60;

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function write(key, value) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  const DEFAULT_PREFS = {
    storeName: "",
    sidebarCollapsed: false,
    reminders: { h48: true, h24: true, h6: true },
    notify: {
      new_dispute: true, deadline: true, action: true, investigation: true,
      evidence: true, approval: true, outcome: true
    }
  };

  function prefs() {
    const saved = read("prefs", {});
    return {
      storeName: typeof saved.storeName === "string" ? saved.storeName : DEFAULT_PREFS.storeName,
      sidebarCollapsed: Boolean(saved.sidebarCollapsed),
      // Which cases the app shows: "real" disputes or "sample" cases. Never both at once.
      dataset: saved.dataset === "sample" || saved.dataset === "real" ? saved.dataset : "auto",
      // Light or dark; "auto" follows the device setting.
      theme: saved.theme === "light" || saved.theme === "dark" ? saved.theme : "auto",
      reminders: Object.assign({}, DEFAULT_PREFS.reminders, saved.reminders || {}),
      notify: Object.assign({}, DEFAULT_PREFS.notify, saved.notify || {})
    };
  }
  function savePrefs(p) { return write("prefs", p); }

  // Saved investigations, newest kept when the limit is reached.
  function briefs() { return read("briefs", {}); }
  function saveBriefs(map) {
    const ids = Object.keys(map).sort((a, b) => String(map[b]._at || "").localeCompare(String(map[a]._at || "")));
    const trimmed = {};
    for (const id of ids.slice(0, MAX_BRIEFS)) trimmed[id] = map[id];
    return write("briefs", trimmed);
  }
  let pending = null;
  function saveBriefsSoon(map) {
    clearTimeout(pending);
    pending = setTimeout(() => saveBriefs(map), 400);
  }

  function overrides() { return read("overrides", {}); }
  function saveOverrides(map) { return write("overrides", map); }

  // Case activity: what the seller did in Casefile, with real timestamps.
  function activity(id) {
    const all = read("activity", {});
    return Array.isArray(all[id]) ? all[id] : [];
  }
  function log(id, type, detail) {
    const all = read("activity", {});
    const list = Array.isArray(all[id]) ? all[id] : [];
    list.push({ type, detail: detail || "", at: new Date().toISOString() });
    all[id] = list.slice(-MAX_EVENTS);
    write("activity", all);
  }

  function notifications() { return read("notifications", []); }
  function saveNotifications(list) { return write("notifications", list); }

  // What the app has already seen, so "new dispute" and "outcome" notices fire once.
  function seen() { return read("seen", null); }
  function saveSeen(map) { return write("seen", map); }

  // The last dispute list loaded from the server, shown straight away on the next visit
  // while a fresh copy loads. Ignored once it is more than a day old.
  function inbox() {
    const saved = read("inbox", null);
    if (!saved || !Array.isArray(saved.items) || !saved.at || Date.now() - saved.at > 86400000) return null;
    return saved;
  }
  function saveInbox(mode, items) { return write("inbox", { at: Date.now(), mode, items }); }

  function clearAll() {
    try {
      Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => localStorage.removeItem(k));
    } catch (e) { /* storage blocked */ }
    try { indexedDB.deleteDatabase("casefile"); } catch (e) { /* storage blocked */ }
  }

  // Investigation history: one entry per completed run, newest first, a few kept per case.
  function runs(id) {
    const all = read("runs", {});
    return Array.isArray(all[id]) ? all[id] : [];
  }
  function addRun(id, run) {
    const all = read("runs", {});
    all[id] = [run].concat(Array.isArray(all[id]) ? all[id] : []).slice(0, 5);
    if (!write("runs", all)) {
      // Storage full: keep only the newest run for this case.
      all[id] = [run];
      write("runs", all);
    }
  }

  // Internal notes: the seller's own, never sent anywhere unless they choose to include them in a reassessment.
  function notes(id) {
    const all = read("notes", {});
    return Array.isArray(all[id]) ? all[id] : [];
  }
  function addNote(id, text) {
    const all = read("notes", {});
    const list = Array.isArray(all[id]) ? all[id] : [];
    list.push({ text, at: new Date().toISOString() });
    all[id] = list.slice(-50);
    write("notes", all);
  }

  return {
    prefs, savePrefs, briefs, saveBriefs, saveBriefsSoon, overrides, saveOverrides,
    activity, log, notifications, saveNotifications, seen, saveSeen, clearAll,
    runs, addRun, notes, addNote, inbox, saveInbox
  };
})();

// Uploaded documents, kept in this browser (IndexedDB) and sent to the AI only when an investigation runs.
// Images are resized and saved as JPEG so they stay small enough to send.
const Docs = (() => {
  const MAX_IMAGE_SIDE = 1600;
  const MAX_PDF_BYTES = 2 * 1024 * 1024;
  const MAX_TEXT_BYTES = 200 * 1024;
  const MAX_PER_CASE = 8;
  const memory = []; // fallback when IndexedDB is unavailable (documents then last only until reload)
  let dbPromise = null;

  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve) => {
        // If storage is blocked or slow, carry on without it rather than leave an investigation waiting.
        const timer = setTimeout(() => resolve(null), 3000);
        const done = (value) => { clearTimeout(timer); resolve(value); };
        try {
          const req = indexedDB.open("casefile", 1);
          req.onupgradeneeded = () => {
            const store = req.result.createObjectStore("docs", { keyPath: "id" });
            store.createIndex("caseId", "caseId");
          };
          req.onsuccess = () => done(req.result);
          req.onerror = () => done(null);
          req.onblocked = () => done(null);
        } catch (e) {
          done(null);
        }
      });
    }
    return dbPromise;
  }
  function tx(mode, fn) {
    return db().then((d) => new Promise((resolve) => {
      if (!d) { resolve(fn(null)); return; }
      const t = d.transaction("docs", mode);
      const store = t.objectStore("docs");
      let result;
      Promise.resolve(fn(store)).then((r) => { result = r; });
      t.oncomplete = () => resolve(result);
      t.onerror = () => resolve(null);
    }));
  }

  async function list(caseId) {
    const d = await db();
    if (!d) return memory.filter((x) => x.caseId === caseId);
    return new Promise((resolve) => {
      const req = d.transaction("docs").objectStore("docs").index("caseId").getAll(caseId);
      req.onsuccess = () => resolve((req.result || []).sort((a, b) => a.addedAt.localeCompare(b.addedAt)));
      req.onerror = () => resolve([]);
    });
  }
  async function get(id) {
    const d = await db();
    if (!d) return memory.find((x) => x.id === id) || null;
    return new Promise((resolve) => {
      const req = d.transaction("docs").objectStore("docs").get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  }
  async function remove(id) {
    const d = await db();
    if (!d) {
      const i = memory.findIndex((x) => x.id === id);
      if (i >= 0) memory.splice(i, 1);
      return;
    }
    await tx("readwrite", (s) => s.delete(id));
  }
  async function put(doc) {
    const d = await db();
    if (!d) { memory.push(doc); return; }
    await tx("readwrite", (s) => s.put(doc));
  }

  function readAs(file, how) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error("Couldn't read " + file.name));
      if (how === "text") r.readAsText(file); else r.readAsDataURL(file);
    });
  }
  async function shrinkImage(file) {
    const url = await readAs(file, "dataurl");
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Couldn't open the image " + file.name));
      i.src = url;
    });
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.82);
  }

  // Validates and stores a file. Returns the stored document, or throws with a message for the seller.
  async function add(caseId, file, category) {
    const existing = await list(caseId);
    if (existing.length >= MAX_PER_CASE) throw new Error("A case can have up to " + MAX_PER_CASE + " documents. Remove one first.");
    const name = file.name || "Document";
    const type = (file.type || "").toLowerCase();
    const isText = type.startsWith("text/") || /\.(txt|eml|csv|md)$/i.test(name);
    const doc = {
      id: "U" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase(),
      caseId, name, category: category || "OTHER",
      addedAt: new Date().toISOString(),
      fileDate: file.lastModified ? new Date(file.lastModified).toISOString() : null
    };
    if (type.startsWith("image/")) {
      doc.kind = "image";
      doc.mediaType = "image/jpeg";
      doc.dataUrl = await shrinkImage(file);
    } else if (type === "application/pdf" || /\.pdf$/i.test(name)) {
      if (file.size > MAX_PDF_BYTES) throw new Error("PDFs can be up to 2 MB. Try printing only the pages you need.");
      doc.kind = "pdf";
      doc.mediaType = "application/pdf";
      doc.dataUrl = await readAs(file, "dataurl");
    } else if (isText) {
      if (file.size > MAX_TEXT_BYTES) throw new Error("Text files can be up to 200 KB.");
      doc.kind = "text";
      doc.text = await readAs(file, "text");
    } else {
      throw new Error("Casefile accepts photos (JPG, PNG, WebP), PDFs and text files (.txt, .eml, .csv).");
    }
    await put(doc);
    return doc;
  }

  // What gets sent with an investigation: text inline, images and PDFs as attachments.
  async function payload(caseId) {
    const docs = await list(caseId);
    return {
      documents: docs.map((d) => ({ id: d.id, name: d.name, category: d.category, date: d.fileDate || d.addedAt, kind: d.kind, text: d.kind === "text" ? d.text : null })),
      attachments: docs.filter((d) => d.kind !== "text").map((d) => ({
        id: d.id, name: d.name, category: d.category, date: d.fileDate || d.addedAt, kind: d.kind,
        media_type: d.mediaType, data: String(d.dataUrl || "").split(",")[1] || ""
      }))
    };
  }

  return { list, get, add, remove, payload, MAX_PER_CASE };
})();
