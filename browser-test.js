const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PAGE = 'file:///' + path.join(__dirname, 'index.html').replace(/\\/g, '/');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();

  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push('[console] ' + msg.text());
  });
  page.on('pageerror', (err) => errors.push('[pageerror] ' + err.message));

  // Serve fonts? file:// loads Google Fonts via CDN - need internet; fallback gracefully.
  await page.setUserAgent('Mozilla/5.0 MulhimTest');
  await page.goto(PAGE, { waitUntil: 'networkidle0', timeout: 45000 }).catch((e) => console.log('goto note:', e.message));
  await new Promise((r) => setTimeout(r, 800));

  const report = {};

  report.stateLoaded = await page.evaluate(() => {
    const M = window.Mulhim;
    return !!M && M.State.notes.length >= 1;
  });

  report.welcomeNote = await page.evaluate(() => {
    const M = window.Mulhim;
    const n = M.State.notes[0];
    return n ? n.title : null;
  });

  report.cardsRendered = await page.evaluate(() =>
    document.querySelectorAll('.note-card').length
  );
  report.sidebarFolders = await page.evaluate(() =>
    document.querySelectorAll('.folder-item').length
  );

  // Create a note, write rich content with internal link + checklist
  await page.evaluate(() => {
    const M = window.Mulhim;
    const note = M.App.createNote({ title: 'Connectivity' });
    M.App.openEditor(note.id);
  });
  await new Promise((r) => setTimeout(r, 300));

  report.editorOpen = await page.evaluate(() => {
    return document.getElementById('editorView').classList.contains('active');
  });

  await page.evaluate(() => {
    const body = document.getElementById('editorBody');
    body.innerHTML =
      '<h1>Intro</h1><p>Hello <b>world</b>. Referencing [[Test Note]] here.</p><ul><li class="checklist-item"><input type="checkbox"><span>Do this</span></li><li class="checklist-item"><input type="checkbox" checked><span>Done</span></li></ul>';
    body.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 800));

  report.taskProgress = await page.evaluate(() => {
    const el = document.getElementById('taskProgress');
    return { visible: el.style.display === 'flex' || !el.classList.contains('hidden'), text: document.getElementById('progressText').textContent };
  });
  report.wordCount = await page.evaluate(() => document.getElementById('noteWordCount').textContent);
  report.internalLinkCount = await page.evaluate(() => document.querySelectorAll('#editorBody .internal-link').length);
  report.backlinksShown = await page.evaluate(() => document.getElementById('backlinksSection').style.display !== 'none');

  // Save state verifies IndexedDB content persisted
  report.idbContent = await page.evaluate(async () => {
    const note = window.Mulhim.State.notes.find((n) => n.title === 'Connectivity');
    return (await window.Mulhim.DB.getContent(note.id)).includes('Hello <b>world</b>');
  });
  report.localStorageSaved = await page.evaluate(() => {
    const raw = localStorage.getItem('mulhim_data_v1');
    return raw && raw.length > 100;
  });

  // Search highlight
  await page.evaluate(() => {
    window.Mulhim.App.showSearch();
    document.getElementById('searchInput').value = 'world';
    document.getElementById('searchInput').dispatchEvent(new Event('input', { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 600));
  report.searchResults = await page.evaluate(() => document.querySelectorAll('.search-result-item').length);
  report.searchHighlight = await page.evaluate(() => !!document.querySelector('.search-result-item .highlight'));

  // Command palette
  await page.evaluate(() => window.Mulhim.openCommandPalette());
  report.paletteOpen = await page.evaluate(() => document.getElementById('commandPalette').style.display === 'flex');
  report.paletteCommands = await page.evaluate(() => document.querySelectorAll('#commandList .command-item').length);
  await page.keyboard.press('Escape');

  // Focus mode
  await page.evaluate(() => {
    const note = window.Mulhim.State.notes.find((n) => n.title === 'Connectivity');
    window.Mulhim.Features.openFocusMode(note.id);
    window.Mulhim.Features.startPomodoro(25 * 60);
  });
  await new Promise((r) => setTimeout(r, 1100));
  report.focusVisible = await page.evaluate(() => document.getElementById('focusMode').style.display === 'flex');
  report.pomodoroTicking = await page.evaluate(() => {
    const t = document.getElementById('pomodoroTimer').textContent;
    return t !== '25:00';
  });
  await page.keyboard.press('Escape');
  report.focusExited = await page.evaluate(() => document.getElementById('focusMode').style.display === 'none');

  // Theme toggle
  report.themeDark = await page.evaluate(() => {
    window.Mulhim.App.toggleTheme();
    return document.documentElement.dataset.theme === 'dark';
  });
  report.themeLight = await page.evaluate(() => {
    window.Mulhim.App.toggleTheme();
    return document.documentElement.dataset.theme === 'light';
  });

  // RTL test
  report.rtl = await page.evaluate(() => {
    const M = window.Mulhim;
    M.State.settings.lang = 'ar';
    M.State.save();
    M.App.applySettings();
    return { dir: document.documentElement.dir, lang: document.documentElement.lang };
  });

  // Graph render doesn't throw
  report.graphOK = await page.evaluate(() => {
    try { window.Mulhim.App.renderGraph(); return true; } catch (e) { return false; }
  });

  // Trash flow
  report.trashFlow = await page.evaluate(async () => {
    const M = window.Mulhim;
    const n = M.State.notes.find((x) => x.title === 'Connectivity');
    M.App.showView('trash');
    return document.getElementById('trashView').classList.contains('active');
  });

  console.log(JSON.stringify(report, null, 2));
  console.log('\nJS ERRORS CAPTURED:', errors.length);
  errors.slice(0, 20).forEach((e) => console.log('  ✗', e));

  const failed = report.stateLoaded !== true || errors.length > 0;
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('BROWSER TEST FAILED:', e.stack || e);
  process.exit(1);
});