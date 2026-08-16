const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  
  const page = await browser.newPage();
  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
  page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));
  
  try {
    console.log('Navigating to http://localhost:5173...');
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle0', timeout: 30000 });
    
    console.log('Page loaded, title:', await page.title());
    console.log('URL:', page.url());
    
    // Check for the main app elements
    const bodyText = await page.evaluate(() => document.body.innerText);
    console.log('Body text length:', bodyText.length);
    console.log('First 500 chars:', bodyText.substring(0, 500));
    
    // Take screenshot
    await page.screenshot({ path: '/tmp/frontend-screenshot.png', fullPage: true });
    console.log('Screenshot saved to /tmp/frontend-screenshot.png');
    
    // Check for key UI elements
    const hasChat = await page.$('.chat-composer-input, [data-chat-composer], textarea') !== null;
    console.log('Has chat composer:', hasChat);
    
    const hasSidebar = await page.$('.chat-sidebar, [data-sidebar]') !== null;
    console.log('Has sidebar:', hasSidebar);
    
    const hasPlusButton = await page.$('button[aria-label*="plus" i], button:has-text("+")') !== null;
    console.log('Has plus button:', hasPlusButton);
    
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await browser.close();
  }
})();
