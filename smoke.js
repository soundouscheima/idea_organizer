const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync('index.html', 'utf8');

// ---------- In-memory IndexedDB mock (full API) ----------
function makeTransaction(memory) {
  const tx = { oncomplete: null, onerror: null };
  const fire = (fn, result) => {
    const req = { result, onsuccess: null, onerror: null };
    setTimeout(() => {
      if (req.onsuccess) req.onsuccess({ target: req });
      if (tx.oncomplete) tx.oncomplete();
    }, 0);
    return req;
  };
  tx.objectStore = () => ({
    put: (record) => { memory.set(record.id, record); return fire(null, record); },
    get: (id) => fire(null, memory.has(id) ? memory.get(id) : undefined),
    delete: (id) => { memory.delete(id); return fire(null, undefined); },
    getAll: () => fire(null, [...memory.values()]),
  });
  return tx;
}
const DB_MEMORY = { content: new Map() };
const mockDB = {
  objectStoreNames: { contains: (name) => name in DB_MEMORY },
  createObjectStore: (name) => (DB_MEMORY[name] = new Map()),
  transaction: (name) => makeTransaction(DB_MEMORY[name] || new Map()),
};

const mockStore = new Map();

const errors = [];
const warnings = [];

const dom = new JSDOM(html, {
  url: 'http://localhost/',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  beforeParse(window) {
    // jsdom provides its own localStorage for http://localhost; use it fresh
    window.matchMedia = () => ({ matches: false, addListener: () => {} });
    // getSelection stub
    window.getSelection = () => ({
      rangeCount: 0, removeAllRanges: () => {}, addRange: () => {},
      getRangeAt: () => ({}), collapse: () => {}, isCollapsed: true,
    });
    // execCommand stub
    window.document.execCommand = () => true;
    // URL.createObjectURL stub (jsdom doesn't implement blob URLs)
    window.URL.createObjectURL = () => 'blob:mock';
    window.URL.revokeObjectURL = () => {};
    // canvas stub
    const ctxStub = new Proxy({}, {
      get: () => (() => {}),
      set: () => true,
    });
    window.HTMLCanvasElement.prototype.getContext = () => ctxStub;
    // indexedDB mock
    function mockOpenReq() { return { onupgradeneeded: null, onsuccess: null, onerror: null, result: mockDB }; }
    window.indexedDB = {
      open: () => {
        const req = mockOpenReq();
        setTimeout(() => { if (req.onupgradeneeded) req.onupgradeneeded({ target: { result: mockDB } }); }, 0);
        setTimeout(() => { if (req.onsuccess) req.onsuccess({ target: { result: mockDB } }); }, 0);
        return req;
      },
      deleteDatabase: () => ({ onsynccomplete: null, result: undefined }),
    };
    // DOMContentLoaded already fired risk — we'll dispatch manually
    // capture errors
    window.addEventListener('error', (e) => errors.push('WINDOW ERROR: ' + e.message));
    window.onunhandledrejection = (e) => errors.push('REJECTION: ' + String(e.reason));
  },
});

const { window } = dom;
const doc = window.document;

// Evaluate scripts in order
['storage.js', 'app-core.js', 'app-features.js', 'app-pages.js', 'app-wiring.js'].forEach((f) => {
  try {
    const code = fs.readFileSync(path.join(__dirname, f), 'utf8');
    window.eval(code);
  } catch (err) {
    errors.push(`EVAL(${f}) FAILED: ${err.message}\n${err.stack}`);
  }
});

// patch DB access for test: expose mock to window.Mulhim
// replace getSelection with a slightly better one for block ops
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await sleep(100);

  // ---- Basic state loaded? ----
  const M = window.Mulhim;
  console.log('Mulhim loaded:', !!M);
  console.log('State notes count:', M.State.notes.length);

  // ---- Sidebar rendered? ----
  const noteCount = doc.getElementById('noteCount').textContent;
  console.log('Sidebar note count badge:', noteCount);

  // ---- Create a note ----
  try {
    M.App.createNote({ title: 'Test Note' });
    console.log('After create, notes:', M.State.notes.length);
  } catch (err) {
    errors.push('createNote failed: ' + err.message);
  }

  await sleep(50);

  // ---- Open editor ----
  const testNote = M.State.notes[0];
  try {
    M.App.openEditor(testNote.id);
    await sleep(50);
    console.log('Editor opened. Title value:', doc.getElementById('noteTitle').value);
  } catch (err) {
    errors.push('openEditor failed: ' + err.message);
  }

  // ---- Type content ----
  try {
    doc.getElementById('editorBody').innerHTML = 'Hello <b>World</b>';
    doc.getElementById('editorBody').dispatchEvent(new window.Event('input', { bubbles: true }));
    await sleep(500);
    console.log('Content after input saved to DB:', M.DB._db ? 'db available' : 'no db');
  } catch (err) {
    errors.push('editor input failed: ' + err.message);
  }

  // ---- Tags ----
  try {
    M.App.createTag('work', '#0984E3');
    const n = M.State.getNote(testNote.id);
    n.tags = n.tags || []; n.tags.push(M.State.tags[0].id);
    M.State.save();
    M.App.renderNoteTags();
    console.log('Tag pills rendered:', doc.querySelectorAll('.note-tag').length);
  } catch (err) {
    errors.push('tag failed: ' + err.message);
  }

  // ---- Folder creation ----
  try {
    M.State.folders.push({ id: 'f1', name: 'Projects', parentId: null, color: '#00B894', createdAt: Date.now() });
    M.State.save();
    M.App.renderSidebar();
    console.log('Folder tree items:', doc.querySelectorAll('.folder-item').length);
  } catch (err) {
    errors.push('folder failed: ' + err.message);
  }

  // ---- Search ----
  try {
    M.Features.populateSearchFilters();
    M.Features.runSearch('Hello');
    await sleep(200);
    console.log('Search results:', doc.querySelectorAll('.search-result-item').length);
  } catch (err) {
    errors.push('search failed: ' + err.message);
  }

  // ---- Dashboard ----
  try {
    M.App.renderDashboard();
    await sleep(50);
    console.log('Dashboard total notes:', doc.getElementById('dashTotalNotes').textContent);
  } catch (err) {
    errors.push('dashboard failed: ' + err.message);
  }

  // ---- Trash ----
  try {
    M.App.renderTrash();
    console.log('Trash items (expect 0):', doc.querySelectorAll('.trash-item').length);
  } catch (err) {
    errors.push('trash failed: ' + err.message);
  }

  // ---- Templates ----
  try {
    M.App.renderTemplates();
    console.log('Template cards:', doc.querySelectorAll('.template-card').length);
  } catch (err) {
    errors.push('templates failed: ' + err.message);
  }

  // ---- Calendar ----
  try {
    M.App.renderCalendar();
    console.log('Calendar days rendered:', doc.querySelectorAll('.cal-day').length - 1); // minus placeholder logic
  } catch (err) {
    errors.push('calendar failed: ' + err.message);
  }

  // ---- Focus mode ----
  try {
    M.Features.openFocusMode(testNote.id);
    await sleep(50);
    console.log('Focus mode visible:', doc.getElementById('focusMode').style.display);
    M.Features.exitFocusMode();
  } catch (err) {
    errors.push('focus mode failed: ' + err.message);
  }

  // ---- Views ----
  ['dashboard', 'tagManager', 'trash', 'templates', 'calendar', 'graph', 'notes'].forEach((v) => {
    try {
      M.App.showView(v);
      console.log('showView(' + v + ') ok');
    } catch (err) {
      errors.push('showView(' + v + ') failed: ' + err.message);
    }
  });

  // ---- Persistence ----
  try {
    const raw = window.localStorage.getItem('mulhim_data_v1');
    console.log('Persisted localStorage length (mulhim_data_v1):', raw ? raw.length : 0);
    console.log('Persisted has notes:', raw ? (JSON.parse(raw).notes || []).length : 0);
  } catch (err) {
    errors.push('localStorage check failed: ' + err.message);
  }

  // ---- Export ----
  try {
    await M.Features.exportBackup();
    console.log('exportBackup ok');
  } catch (err) {
    errors.push('export failed: ' + err.message);
  }

  console.log('\n===== RESULT =====');
  if (errors.length) {
    console.log('ERRORS (' + errors.length + '):');
    errors.forEach((e) => console.log('  ✗ ' + e));
    process.exit(1);
  } else {
    console.log('ALL SMOKE TESTS PASSED');
  }
}

main().catch((e) => {
  console.error('TEST HARNESS ERROR:', e);
  process.exit(1);
});