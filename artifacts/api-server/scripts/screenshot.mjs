import puppeteer from 'puppeteer';

const BROWSER_PATH = '/home/kasperkal1970/.cache/puppeteer/chrome/linux-150.0.7871.24/chrome-linux64/chrome';
const URL = 'http://localhost:8080';

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: BROWSER_PATH,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 15000 });
  await page.waitForTimeout(2000);

  // 1. Empty chat mode
  await page.screenshot({ path: '/tmp/Infinity-1-empty.png' });
  console.log('1/4 Empty chat screenshot saved');

  // 2. Type and send a message
  const ta = await page.$('textarea');
  if (ta) {
    await ta.type('Hello!', { delay: 20 });
    const buttons = await page.$$('button');
    for (const btn of buttons) {
      const html = await btn.evaluate(el => el.innerHTML);
      if (html && html.includes('SEND')) {
        await btn.click();
        break;
      }
    }
    await page.waitForTimeout(8000);
    await page.screenshot({ path: '/tmp/Infinity-2-chat-message.png' });
    console.log('2/4 Chat with message screenshot saved');
  }

  // 3. Switch to voice mode
  const buttons = await page.$$('button');
  for (const btn of buttons) {
    const html = await btn.evaluate(el => el.innerHTML);
    if (html && html.includes('VOICE')) {
      await btn.click();
      await page.waitForTimeout(500);
      break;
    }
  }
  await page.screenshot({ path: '/tmp/Infinity-3-voice-mode.png' });
  console.log('3/4 Voice mode screenshot saved');

  // 4. Open sidebar
  const menuBtn = await page.$('button[aria-label="Open history"]');
  if (menuBtn) {
    await menuBtn.click();
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: '/tmp/Infinity-4-sidebar.png' });
  console.log('4/4 Sidebar screenshot saved');

  await browser.close();
  console.log('All screenshots taken!');
}

main().catch(err => { console.error(err); process.exit(1); });
