const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PAGE = 'file:///' + path.join(__dirname, 'index.html').replace(/\\/g, '/');

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(PAGE, { waitUntil: 'networkidle0', timeout: 45000 });
  await new Promise((r) => setTimeout(r, 500));

  // Setup: Alpha references [[Beta]] so Beta should have a backlink from Alpha.
  await page.evaluate(() => {
    const M = window.Mulhim;
    M.App.createNote({ title: 'Beta', returnContent: false });
    M.App.createNote({ title: 'Alpha' });
  });
  await new Promise((r) => setTimeout(r, 500));
  await page.evaluate(() => {
    const body = document.getElementById('editorBody');
    body.innerHTML = '<p>See [[Beta]] for details</p>';
    body.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 900));

  const paletteCommands = await page.evaluate(() => {
    window.Mulhim.openCommandPalette();
    return new Promise((res) => setTimeout(() => res(document.querySelectorAll('#commandList .command-item').length), 50));
  });
  await page.keyboard.press('Escape');

  // Open Beta and check backlinks
  const backlinks = await page.evaluate(async () => {
    const M = window.Mulhim;
    const beta = M.State.notes.find((n) => n.title === 'Beta');
    await M.App.openEditor(beta.id);
    await new Promise((r) => setTimeout(r, 400));
    const section = document.getElementById('backlinksSection');
    const names = [...document.querySelectorAll('#backlinksList .backlink-item')].map((el) => el.textContent.trim());
    return { shown: section.style.display !== 'none', names };
  });

  // Link click-through: click [[Beta]] in Alpha to navigate
  const linkToBeta = await page.evaluate(async () => {
    const M = window.Mulhim;
    const alpha = M.State.notes.find((n) => n.title === 'Alpha');
    await M.App.openEditor(alpha.id);
    await new Promise((r) => setTimeout(r, 300));
    const link = document.querySelector('#editorBody .internal-link');
    if (!link) return { found: false };
    link.click();
    await new Promise((r) => setTimeout(r, 300));
    return { found: true, openTitle: document.getElementById('noteTitle').value };
  });

  // Internal link [[Beta]] in Alpha content = backlink from Alpha to Beta -> verify via findAllLinks
  const linkMap = await page.evaluate(async () => {
    const M = window.Mulhim;
    const map = await M.App.findAllLinks();
    return map;
  });

  console.log(JSON.stringify({
    paletteCommands,
    backlinks,
    linkToBeta,
    linkCount: Object.keys(linkMap).length,
    errors,
  }, null, 2));

  const fail = paletteCommands < 5 || !backlinks.shown || !backlinks.names.some((n) => n.includes('Alpha')) || linkToBeta.openTitle !== 'Beta' || errors.length > 0;
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });