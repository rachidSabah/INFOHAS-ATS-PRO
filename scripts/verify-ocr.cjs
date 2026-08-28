const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') console.log('PAGE_ERR:', m.text()); });
  page.on('pageerror', e => console.log('PAGE_PERR:', e.message));

  await page.goto('http://localhost:3100/debugocr', { waitUntil: 'networkidle' });

  const pdfPath = 'C:\\Users\\piopi\\Downloads\\zakaria nadif resume.pdf';
  await page.setInputFiles('#file', pdfPath);

  // wait for #out to contain a result (not "parsing...")
  await page.waitForFunction(() => {
    const t = document.getElementById('out')?.textContent || '';
    return t && t !== 'parsing...' && t.length > 10;
  }, { timeout: 120000 });

  const result = await page.textContent('#out');
  console.log('PARSED_RESULT:\n' + result);
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
