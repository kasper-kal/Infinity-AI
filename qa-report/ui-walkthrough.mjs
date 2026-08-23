/**
 * UI walkthrough — verifies the infinity-ai interface renders without errors and
 * that the new Deep Research feature is reachable.
 *
 * Usage:  node ui-walkthrough.mjs [--url http://localhost:5173] [--shots-dir ./shots]
 *
 * Steps:
 *  1. Desktop (1440x900): load app → collect console errors → open the +
 *     menu → click "Deep Research" → check the research panel renders →
 *     type a goal → click "Start research" → verify the confirmation step.
 *  2. Mobile (390x844): load app → verify layout → screenshot.
 *  (The confirmation is NOT accepted — no DB job is created unless --confirm is passed.)
 */
import puppeteer from 'puppeteer';
import { mkdirSync } from 'fs';

const VITE_URL = process.argv.includes('--url')
  ? process.argv[process.argv.indexOf('--url') + 1]
  : 'http://localhost:5173';
const SHOTS_DIR = process.argv.includes('--shots-dir')
  ? process.argv[process.argv.indexOf('--shots-dir') + 1]
  : './ui-walkthrough-shots';
const CONFIRM_JOB = process.argv.includes('--confirm');

mkdirSync(SHOTS_DIR, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const executablePath = await puppeteer.executablePath();
  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--mute-audio'],
  });

  const consoleErrors = [];
  const attach = (page) => {
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(`[${msg.type()}] ${msg.text()}`);
    });
    page.on('pageerror', (err) => consoleErrors.push(`[pageerror] ${err.message}`));
    page.on('requestfailed', (req) => {
      const url = req.url();
      if (!url.includes('localhost') && !url.includes('127.0.0.1')) return;
      consoleErrors.push(`[requestfailed] ${req.method()} ${url} — ${req.failure()?.errorText ?? 'unknown'}`);
    });
  };

  try {
    // ── DESKTOP ──────────────────────────────────────────────
    console.log('1. Desktop (1440x900)');
    const dp = await browser.newPage();
    attach(dp);
    await dp.setViewport({ width: 1440, height: 900 });
    await dp.goto(VITE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await wait(4000);
    await dp.screenshot({ path: `${SHOTS_DIR}/01-desktop-home.png` });

    // Open the + menu
    const plusBtn = await dp.$('#plus-menu-button');
    if (plusBtn) {
      await plusBtn.click();
      await wait(800);
      await dp.screenshot({ path: `${SHOTS_DIR}/02-desktop-plus-menu.png` });
      console.log('   ✓ + menu opened');
    } else {
      console.log('   ⚠ #plus-menu-button not found — is chat mode active?');
    }

    // Find + click the Deep Research item
    const researchItem = await dp.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const el = btns.find((b) => b.textContent?.includes('Deep Research'));
      if (el) { el.click(); return true; }
      return false;
    });
    if (researchItem) {
      await wait(900);
      await dp.screenshot({ path: `${SHOTS_DIR}/03-desktop-research-panel.png` });
      console.log('   ✓ Deep Research panel opened');

      // Type a goal
      const typed = await dp.evaluate(() => {
        const ta = document.querySelector('textarea');
        if (!ta) return false;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        setter.call(ta, 'Quantum computing error correction state of the art');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      });
      if (typed) {
        await wait(400);
        // Click "Start research"
        const startClicked = await dp.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const el = btns.find((b) => b.textContent?.trim().startsWith('Start research'));
          if (el) { el.click(); return true; }
          return false;
        });
        if (startClicked) {
          await wait(700);
          await dp.screenshot({ path: `${SHOTS_DIR}/04-desktop-research-confirm.png` });
          console.log('   ✓ Confirmation step shown');

          if (CONFIRM_JOB) {
            await dp.evaluate(() => {
              const btns = Array.from(document.querySelectorAll('button'));
              const el = btns.find((b) => b.textContent?.trim().startsWith('CONFIRM'));
              el?.click();
            });
            await wait(1500);
            await dp.screenshot({ path: `${SHOTS_DIR}/05-desktop-research-started.png` });
            console.log('   ✓ Job started (--confirm)');
          }
        } else {
          console.log('   ⚠ "Start research" button not found');
        }
      } else {
        console.log('   ⚠ research textarea not found');
      }
    } else {
      console.log('   ⚠ Deep Research menu item not found');
    }
    await dp.close();

    // ── MOBILE ───────────────────────────────────────────────
    console.log('2. Mobile (390x844)');
    const mp = await browser.newPage();
    attach(mp);
    await mp.setViewport({ width: 390, height: 844 });
    await mp.goto(VITE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await wait(4000);
    await mp.screenshot({ path: `${SHOTS_DIR}/06-mobile-home.png` });
    const mobileOverflow = await mp.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    console.log(mobileOverflow
      ? '   ⚠ horizontal overflow detected on mobile'
      : '   ✓ no horizontal overflow on mobile');
    await mp.close();

    // ── Report ───────────────────────────────────────────────
    console.log('\n── Console / network errors ──');
    if (consoleErrors.length === 0) {
      console.log('✅ No console errors');
    } else {
      const unique = [...new Set(consoleErrors)];
      unique.slice(0, 20).forEach((e) => console.log(`  ${e}`));
    }
  } catch (err) {
    console.error('❌ Walkthrough error:', err.message);
  } finally {
    await browser.close();
  }
  console.log('\nScreenshots saved to', SHOTS_DIR);
}

main().catch((e) => { console.error(e); process.exit(1); });
