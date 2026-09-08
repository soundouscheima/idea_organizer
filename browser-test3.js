const path = require('path');
const puppeteer = require('puppeteer-core');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PAGE = 'file:///' + path.join(__dirname, 'index.html').replace(/\\/g, '/');

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // Intercept downloads to test export
  const downloads = [];
  await page.setRequestInterception(true);
  await page.on('request', (r) => {
    if (r.resourceType() === 'document' && downloads.includes(r.url())) {
      r.abort();
      return;
    }
    r.continue();
  });

  await page.goto(PAGE, { waitUntil: 'networkidle0', timeout: 45000 });
  await new Promise((r) => setTimeout(r, 500));

  // --- Block drag reorder: create note with 3 paragraphs, drag 3rd before 1st ---
  const blockInfo = await page.evaluate(async () => {
    const M = window.Mulhim;
    const note = M.App.createNote({ title: 'Reorder' });
    await new Promise((r) => setTimeout(r, 300));
    const body = document.getElementById('editorBody');
    body.innerHTML = '<p>First</p><p>Second</p><p>Third</p>';
    body.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));

    // Simulate drag: attach handles via mouseover target, then dispatch drag events manually
    const blocks = [...body.children];
    const third = blocks[2]; // <p>Third</p>
    third.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const handle = third.querySelector('.block-handle');
    if (!handle) return { handle: false };

    const dragStart = new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() });
    handle.dispatchEvent(dragStart);
    const first = body.children[0];
    const rect = first.getBoundingClientRect();
    const before = new DragEvent('dragover', {
      bubbles: true, cancelable: true, clientY: rect.top + 1, dataTransfer: new DataTransfer(),
    });
    first.dispatchEvent(before);
    const dropEv = new DragEvent('drop', {
      bubbles: true, cancelable: true, clientY: rect.top + 1, dataTransfer: new DataTransfer(),
    });
    first.dispatchEvent(dropEv);
    await new Promise((r) => setTimeout(r, 400));

    return {
      handle: true,
      order: [...document.getElementById('editorBody').children].map((c) => c.textContent.trim()),
    };
  });

  // --- Merge two notes (needs confirm click) ---
  let mergeStarted = false;
  const mergeRes = await page.evaluate(async () => {
    const M = window.Mulhim;
    const a = M.App.createNote({ title: 'MergeA', returnContent: false });
    const b = M.App.createNote({ title: 'MergeB', returnContent: false });
    await M.DB.setContent(a.id, '<p>Content A</p>');
    await M.DB.setContent(b.id, '<p>Content B</p>');
    M.App.mergeNotes([a.id, b.id]); // fire & forget
    globalThis.__mergeIds = [a.id, b.id];
    return true;
  });
  await new Promise((r) => setTimeout(r, 300));
  await page.evaluate(() => {
    const btn = document.getElementById('confirmAction');
    btn.click();
  });
  await new Promise((r) => setTimeout(r, 600));
  const mergeInfo = await page.evaluate(async () => {
    const M = window.Mulhim;
    const [aId, bId] = globalThis.__mergeIds;
    const merged = M.State.notes.find((n) => n.title && n.title.includes('merged'));
    const mergedHtml = merged ? await M.DB.getContent(merged.id) : '';
    return {
      mergedExists: !!merged,
      containsA: mergedHtml.includes('Content A'),
      containsB: mergedHtml.includes('Content B'),
      originalsDeleted: !M.State.getNote(aId) || !!M.State.getNote(aId).deletedAt,
    };
  });

  // --- Per-note .md export (verify converter) ---
  let fileContents = await page.evaluate(async () => {
    const M = window.Mulhim;
    const n = M.App.createNote({ title: 'MD Export', returnContent: false });
    await M.DB.setContent(n.id, '<h1>Title</h1><p>Body **bold** text</p><blockquote>Quote</blockquote>');
    await M.App.openEditor(n.id);
    await new Promise((r) => setTimeout(r, 300));
    const origDownload = M.Utils.download;
    M.Utils.download = (name, content) => { M.__captured = { name, content: String(content) }; };
    M.App.exportNoteAs('md');
    await new Promise((r) => setTimeout(r, 400));
    M.Utils.download = origDownload;
    return M.__captured || null;
  });

  // --- Ctrl+N shortcut ---
  await page.evaluate(() => document.body.focus());
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyN');
  await page.keyboard.up('Control');
  await new Promise((r) => setTimeout(r, 300));
  const ctrlN = await page.evaluate(() => document.getElementById('editorView').classList.contains('active'));

  console.log(JSON.stringify({ blockInfo, mergeInfo, mdResult: fileContents, ctrlN, errors }, null, 2));

  const fail = !blockInfo.handle || blockInfo.order[0] !== 'Third' ||
    !mergeInfo.mergedExists || !mergeInfo.containsA || !mergeInfo.containsB ||
    !fileContents || !fileContents.content.includes('# Title') || !ctrlN || errors.length > 0;
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });