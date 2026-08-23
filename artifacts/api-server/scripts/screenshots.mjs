import { chromium } from 'playwright';

const URL = 'http://localhost:8080';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  // 1. Empty chat welcome screen
  await page.goto(URL, { waitUntil: 'networkidle0' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/Infinity-1-empty-welcome.png' });
  console.log('1/6 Welcome screen');

  // 2. Chat mode welcome screen
  const toggleChat = page.locator('button[title*="Switch to voice"]');
  if (await toggleChat.count() > 0) {
    await toggleChat.click();
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: '/tmp/Infinity-2-chat-welcome.png' });
  console.log('2/6 Chat welcome screen');

  // 3. Send a message
  const textarea = page.locator('textarea');
  await textarea.fill('Hello!');
  await textarea.press('Enter');
  await page.waitForTimeout(8000);
  await page.screenshot({ path: '/tmp/Infinity-3-chat-with-response.png' });
  console.log('3/6 Chat with response');

  // 4. Open + menu
  const plusBtn = page.locator('button[title="Attach, camera, or search"], button:has(svg.lucide-plus)');
  if (await plusBtn.count() > 0) {
    await plusBtn.click();
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: '/tmp/Infinity-4-plus-menu.png' });
  console.log('4/6 Plus menu open');

  // Close plus menu
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // 5. Send image request
  await textarea.fill('Draw me a cat');
  await textarea.press('Enter');
  await page.waitForTimeout(4000);
  await page.screenshot({ path: '/tmp/Infinity-5-image-confirm.png' });
  console.log('5/6 Image confirmation card');

  // 6. Send screen share request
  await page.waitForTimeout(1000);
  // Clear and send new message
  const textarea2 = page.locator('textarea');
  await textarea2.fill('Start screen sharing');
  await textarea2.press('Enter');
  await page.waitForTimeout(4000);
  await page.screenshot({ path: '/tmp/Infinity-6-screen-share-card.png' });
  console.log('6/6 Screen share confirmation card');

  await browser.close();
  console.log('\nAll screenshots in /tmp/Infinity-*.png');
}

main().catch(err => { console.error(err); process.exit(1); });
