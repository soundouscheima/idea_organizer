const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PAGE = 'file:///' + path.join(__dirname, 'index.html').replace(/\\/g, '/');

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push('[console] ' + msg.text()); });
  page.on('pageerror', (err) => errors.push('[pageerror] ' + err.message));
  await page.setUserAgent('Mozilla/5.0 MulhimTest');
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 900));

  const report = {};

  // 1) Focus mode live autosave
  report.focusAutosave = await page.evaluate(async () => {
    const M = window.Mulhim;
    const note = M.App.createNote({ title: 'Focus Autosave', content: '<p>initial</p>', returnContent: true });
    M.Features.openFocusMode(note.id);
    await new Promise((r) => setTimeout(r, 250));
    const body = document.getElementById('focusBody');
    body.innerHTML = '<p>typed in focus mode</p>';
    body.dispatchEvent(new Event('input', { bubbles: true }));
    // wait for debounce
    await new Promise((r) => setTimeout(r, 700));
    const html = await M.DB.getContent(note.id);
    M.Features.exitFocusMode();
    return html.includes('typed in focus mode');
  });

  // 2) Focus mode internal-link create on click
  report.focusLinkCreate = await page.evaluate(async () => {
    const M = window.Mulhim;
    const target = M.App.createNote({ title: 'Career Ideas', content: '', returnContent: true });
    const src = M.App.createNote({ title: 'Source', content: '', returnContent: true });
    M.Features.openFocusMode(src.id);
    const body = document.getElementById('focusBody');
    body.innerHTML = '<span class="internal-link" data-note="" data-title="Career Ideas">Career Ideas</span>';
    body.querySelector('.internal-link').click();
    await new Promise((r) => setTimeout(r, 300));
    return document.getElementById('editorView').classList.contains('active') &&
      document.getElementById('noteTitle').value === 'Career Ideas';
  });

  // 3) Blur toggle on cards + editor disclaimer
  report.blur = await page.evaluate(async () => {
    const M = window.Mulhim;
    const note = M.App.createNote({ title: 'Private Note', content: '<p>secret stuff</p>', returnContent: false });
    M.App.showView('notes');
    M.App.toggleNoteHide(note.id);
    const card = document.querySelector(`.note-card[data-note-id="${note.id}"]`);
    const cardBlurred = card && card.classList.contains('blurred');
    M.App.openEditor(note.id);
    await new Promise((r) => setTimeout(r, 100));
    const bannerShown = document.getElementById('hideDisclaimer') && document.getElementById('hideDisclaimer').style.display !== 'none';
    const noteHidden = M.State.getNote(note.id).hidden === true;
    // toggle back off, ensure disclaimer hides
    M.App.toggleNoteHide(note.id);
    M.App.openEditor(note.id);
    await new Promise((r) => setTimeout(r, 100));
    const bannerHidden = !document.getElementById('hideDisclaimer') || document.getElementById('hideDisclaimer').style.display === 'none';
    return { cardBlurred, bannerShown, noteHidden, bannerHidden };
  });

  // 4) Search result: single title, no duplicated markup
  report.searchLayout = await page.evaluate(async () => {
    const M = window.Mulhim;
    M.App.createNote({ title: 'Alpha Market', content: '<p>unrelated words</p>', returnContent: false });
    M.App.showSearch();
    document.getElementById('searchInput').value = 'Alpha';
    document.getElementById('searchInput').dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 500));
    const firstTitle = document.querySelector('.search-result-item .result-title');
    if (!firstTitle) return { found: false };
    return {
      found: true,
      titleText: firstTitle.textContent.trim(),
      highlightInTitle: !!firstTitle.querySelector('.highlight'),
      noDupInBody: document.querySelectorAll('.search-result-item .result-title').length === 1
    };
  });

  console.log(JSON.stringify(report, null, 2));
  console.log('JS ERRORS CAPTURED:', errors.length);
  errors.slice(0, 20).forEach((e) => console.log('  ✗', e));
  await browser.close();
  process.exit(Object.values(report).some((r) => r && (r === false || (typeof r === 'object' && Object.values(r).some((v) => v === false)))) || errors.length ? 1 : 0);
})().catch((e) => { console.error('BROWSER TEST FAILED:', e.stack || e); process.exit(1); });