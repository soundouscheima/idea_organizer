const path = require('path');
const puppeteer = require('puppeteer-core');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PAGE = 'file:///' + path.join(__dirname, 'index.html').replace(/\\/g, '/');

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
  await page.goto(PAGE, { waitUntil: 'networkidle0', timeout: 45000 });
  await new Promise((r) => setTimeout(r, 600));

  await page.evaluate(() => {
    const M = window.Mulhim;
    M.App.createNote({ title: 'Beta', returnContent: false });
    const a = M.App.createNote({ title: 'Alpha' });
    window.__alphaId = a.id;
  });
  await new Promise((r) => setTimeout(r, 500)); // let openEditor settle

  await page.evaluate(() => {
    const body = document.getElementById('editorBody');
    body.innerHTML = '<p>See [[Beta]] for details</p>';
    window.__after_set = body.innerHTML;
    body.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 1200));

  const info = await page.evaluate(async () => {
    const M = window.Mulhim;
    const stored = await M.DB.getContent(window.__alphaId);
    return {
      after_set: window.__after_set,
      bodyNow: document.getElementById('editorBody').innerHTML,
      linksNow: document.querySelectorAll('#editorBody .internal-link').length,
      stored: stored.slice(0, 300),
      lastSaved: window.Mulhim.App._lastSavedHtml,
    };
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });