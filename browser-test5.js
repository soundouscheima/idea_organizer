const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PAGE = 'file:///' + path.join(__dirname, 'index.html').replace(/\\/g, '/');

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(PAGE, { waitUntil: 'networkidle0', timeout: 45000 });
  await new Promise((r) => setTimeout(r, 500));

  const report = {};

  // --- i18n default is English ---
  report.langDefault = await page.evaluate(() => document.documentElement.lang);

  // --- Switch to Arabic, verify RTL + translated nav labels ---
  report.rtl = await page.evaluate(() => {
    const M = window.Mulhim;
    M.State.settings.lang = 'ar';
    M.State.save(true);
    M.App.applySettings();
    return { dir: document.documentElement.dir, lang: document.documentElement.lang };
  });
  report.arAllNotes = await page.evaluate(() => {
    const nav = document.querySelector('[data-view="notes"] span[data-i18n]');
    return nav ? nav.textContent : null;
  });
  report.arTrash = await page.evaluate(() => {
    const el = document.querySelector('[data-view="trash"] span[data-i18n]');
    return el ? el.textContent : null;
  });

  // Switch back to English for functional tests
  await page.evaluate(() => {
    const M = window.Mulhim;
    M.State.settings.lang = 'en';
    M.State.save(true);
    M.App.applySettings();
  });

  // --- Tasks view: create note with checklists, render tasks ---
  await page.evaluate(() => {
    const M = window.Mulhim;
    const note = M.App.createNote({ title: 'Task Master', returnContent: false });
    window.__taskNoteId = note.id;
  });
  await new Promise((r) => setTimeout(r, 300));
  await page.evaluate(async () => {
    const M = window.Mulhim;
    await M.DB.setContent(window.__taskNoteId,
      '<ul class="checklist"><li class="checklist-item"><input type="checkbox"><span>Buy milk</span></li>' +
      '<li class="checklist-item"><input type="checkbox" checked><span>Walk dog</span></li></ul>');
  });
  await page.evaluate(() => window.Mulhim.App.renderTasks());
  await new Promise((r) => setTimeout(r, 300));
  report.taskItems = await page.evaluate(() => document.querySelectorAll('.task-item').length);
  report.taskDone = await page.evaluate(() => document.querySelectorAll('.task-item input:checked').length);

  // --- Goals: add a goal via DOM ---
  await page.evaluate(() => {
    document.getElementById('addGoalBtn').click();
  });
  await new Promise((r) => setTimeout(r, 200));
  await page.evaluate(() => {
    document.getElementById('goalNameInput').value = 'Read 10 books';
    document.getElementById('goalTargetInput').value = '10';
    document.getElementById('goalSaveBtn').click();
  });
  await new Promise((r) => setTimeout(r, 300));
  report.goalCards = await page.evaluate(() => document.querySelectorAll('.goal-card').length);
  report.goalTitle = await page.evaluate(() => document.querySelector('.goal-title')?.textContent);

  // --- Archive view ---
  await page.evaluate(() => {
    const M = window.Mulhim;
    const n = M.State.notes.find((x) => x.title === 'Task Master');
    n.isArchived = true;
    M.State.save(true);
  });
  await page.evaluate(() => window.Mulhim.App.renderArchive());
  await new Promise((r) => setTimeout(r, 200));
  report.archiveItems = await page.evaluate(() => document.querySelectorAll('#archiveList .trash-item').length);

  // --- Recently opened ---
  await page.evaluate(() => {
    const M = window.Mulhim;
    const note = M.State.notes.find((x) => x.title === 'Welcome to Mulhim');
    note.lastOpenedAt = Date.now();
    M.State.save(true);
  });
  await page.evaluate(() => window.Mulhim.App.renderRecent());
  await new Promise((r) => setTimeout(r, 200));
  report.recentItems = await page.evaluate(() => document.querySelectorAll('#recentList .recent-item').length);

  // --- Stats ---
  await page.evaluate(() => window.Mulhim.App.renderStats());
  await new Promise((r) => setTimeout(r, 400));
  report.statsNotes = await page.evaluate(() => document.getElementById('statTotalNotes').textContent);
  report.statsTasks = await page.evaluate(() => document.getElementById('statCompletedTasks').textContent);

  // --- showView for all new views doesn't throw ---
  report.showViews = await page.evaluate(() => {
    const M = window.Mulhim;
    const out = {};
    ['tasks','goals','archive','recent','stats'].forEach((v) => {
      try { M.App.showView(v); out[v] = true; } catch (e) { out[v] = false; }
    });
    return out;
  });

  // --- Font size + accent settings apply ---
  await page.evaluate(() => {
    const M = window.Mulhim;
    M.State.settings.fontSize = 'large';
    M.State.settings.accentColor = '#0984E3';
    M.State.save(true);
    M.App.applySettings();
  });
  report.fontSize = await page.evaluate(() => document.documentElement.dataset.fontSize);
  report.accent = await page.evaluate(() => document.documentElement.dataset.accent);

  console.log('TASKS/GOALS/I18N TEST RESULTS:');
  console.log(JSON.stringify(report, null, 2));
  console.log('ERRORS:', errors.length);
  errors.slice(0, 20).forEach((e) => console.log('  ✗', e));

  const fail = report.taskItems < 2 || report.taskDone !== 1 ||
    report.goalCards < 1 || report.goalTitle !== 'Read 10 books' ||
    report.archiveItems < 1 || report.recentItems < 1 ||
    !report.showViews.tasks || !report.showViews.goals || !report.showViews.archive ||
    !report.showViews.recent || !report.showViews.stats ||
    report.rtl.dir !== 'rtl' || report.rtl.lang !== 'ar' ||
    report.fontSize !== 'large' || report.accent !== '#0984E3' ||
    errors.length > 0;

  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
