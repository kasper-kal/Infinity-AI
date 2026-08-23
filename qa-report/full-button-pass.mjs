import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const url = process.env.infinity-ai_QA_URL || 'http://localhost:21662/';
const outDir = process.env.infinity-ai_QA_OUT || './qa-report/full-button-pass';
mkdirSync(outDir, { recursive: true });
const chromiumPath = process.env.CHROMIUM_PATH || execFileSync('sh', ['-lc', 'command -v chromium'], { encoding: 'utf8' }).trim();
const browser = await puppeteer.launch({
  headless: true,
  executablePath: chromiumPath,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--mute-audio', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  defaultViewport: { width: 1440, height: 900 },
});

const results = [];
const screenshots = [];
const errors = [];
const protectedActions = [];
let shotNo = 0;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function normalize(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
function isVisible(element) {
  const r = element.getBoundingClientRect();
  const s = getComputedStyle(element);
  return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
}
function actionClass(item) {
  const s = `${item.text} ${item.aria} ${item.title}`.toLowerCase();
  if (/api key|secret|disconnect|remove key|delete key|revoke/.test(s)) return 'protected-api-key';
  if (/clear all|delete all|delete conversation|remove conversation|discard/.test(s)) return 'protected-destructive';
  if (/connect gmail|connect spotify|oauth|sign in|authorize/.test(s)) return 'oauth';
  if (/attach|upload|file|image|photo|snapshot|screen share|camera/.test(s)) return 'media';
  return 'normal';
}

async function screenshot(page, label) {
  shotNo += 1;
  const file = `${String(shotNo).padStart(4, '0')}-${label}`.replace(/[^a-z0-9._-]+/gi, '-').slice(0, 130) + '.png';
  await page.screenshot({ path: `${outDir}/${file}`, fullPage: false }).catch(() => {});
  screenshots.push(file);
  return file;
}

function attach(page, flow) {
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${flow}] console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${flow}] pageerror: ${e.message}`));
  page.on('dialog', async (dialog) => {
    results.push({ flow, kind: 'dialog', type: dialog.type(), message: dialog.message(), outcome: 'dismissed-to-protect-data' });
    await dialog.dismiss().catch(() => {});
  });
  page.on('popup', async (popup) => {
    const popupUrl = popup.url();
    await wait(1200);
    const file = await screenshot(popup, `${flow}-external-login`).catch(() => null);
    results.push({ flow, kind: 'popup', url: popupUrl, screenshot: file, outcome: 'opened-without-login-then-closed' });
    await popup.close().catch(() => {});
  });
}

async function fresh(flow) {
  const page = await browser.newPage();
  attach(page, flow);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await wait(1600);
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await wait(1200);
  return page;
}

async function inventory(page) {
  return page.evaluate(() => [...document.querySelectorAll('button,[role="button"],[role="tab"]')].map((el, index) => {
    const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    const item = {
      index,
      text,
      aria: el.getAttribute('aria-label') || '',
      title: el.getAttribute('title') || '',
      id: el.id || '',
      tag: el.tagName,
      disabled: Boolean(el.disabled) || el.getAttribute('aria-disabled') === 'true',
      visible: r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden',
      className: String(el.className || '').slice(0, 140),
    };
    item.signature = [item.tag, item.id, item.aria, item.title, item.text, item.className].join('|');
    return item;
  }).filter((x) => x.visible && !x.disabled));
}

async function clickSignature(page, item) {
  const outcome = await page.evaluate((target) => {
    const elements = [...document.querySelectorAll('button,[role="button"],[role="tab"]')];
    const el = elements.find((candidate) => {
      const r = candidate.getBoundingClientRect(); const s = getComputedStyle(candidate);
      const text = (candidate.innerText || candidate.textContent || '').replace(/\s+/g, ' ').trim();
      const value = [candidate.tagName, candidate.id || '', candidate.getAttribute('aria-label') || '', candidate.getAttribute('title') || '', text, String(candidate.className || '').slice(0, 140)].join('|');
      return value === target.signature && r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && !candidate.disabled;
    });
    if (!el) return { ok: false, reason: 'not-found-after-rescan' };
    el.scrollIntoView({ block: 'center', inline: 'center' });
    el.click();
    return { ok: true };
  }, item);
  await wait(450);
  return outcome;
}

async function clickTarget(page, flow, item, mode = actionClass(item)) {
  const file = await screenshot(page, `${flow}-before-${item.text || item.aria || item.title || 'button'}`);
  if (mode === 'protected-api-key') {
    protectedActions.push({ flow, item, reason: 'API-key/secret action not activated' });
    results.push({ flow, kind: 'button', item, mode, outcome: 'protected-not-pressed', before: file });
    return;
  }
  const outcome = await clickSignature(page, item);
  const after = await screenshot(page, `${flow}-after-${item.text || item.aria || item.title || 'button'}`);
  results.push({ flow, kind: 'button', item, mode, outcome, before: file, after });
}

async function setupChat(page, flow) {
  const controls = await inventory(page);
  const back = controls.find((x) => x.aria === 'Back to chat' || x.title === 'Back to chat');
  if (back) { await clickSignature(page, back); await wait(300); }
}
async function clickLabel(page, label) {
  const controls = await inventory(page);
  const target = controls.find((x) => x.text === label || x.text.includes(label) || x.aria === label || x.title === label);
  if (!target) return false;
  return (await clickSignature(page, target)).ok;
}
async function clickId(page, id) {
  const controls = await inventory(page); const target = controls.find((x) => x.id === id);
  if (!target) return false; return (await clickSignature(page, target)).ok;
}

async function sweep(flow, setup = async () => {}, options = {}) {
  const page = await fresh(flow);
  await setup(page);
  await wait(400);
  const seen = new Set();
  const max = options.max || 80;
  for (let i = 0; i < max; i++) {
    const controls = await inventory(page);
    const target = controls.find((x) => !seen.has(x.signature) && !(options.skip?.(x)));
    if (!target) break;
    seen.add(target.signature);
    await clickTarget(page, flow, target);
    if (options.recover) await options.recover(page, target);
  }
  results.push({ flow, kind: 'summary', uniqueControlsSeen: seen.size, finalControls: (await inventory(page)).length });
  await page.close();
}

// Top-level and modal surfaces. Destructive confirmations are dismissed by the dialog handler.
await sweep('voice-home');
await sweep('chat-home', setupChat);
await sweep('plus-menu', async (page) => { await setupChat(page); await clickId(page, 'plus-menu-button'); });
await sweep('command-palette', async (page) => { await setupChat(page); await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control'); await wait(300); });
await sweep('sidebar', async (page) => { await setupChat(page); await clickLabel(page, 'Open history'); });
await sweep('research', async (page) => { await setupChat(page); await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control'); await wait(300); await clickLabel(page, 'Deep Research'); });
await sweep('gem', async (page) => { await setupChat(page); await clickId(page, 'plus-menu-button'); await clickLabel(page, 'New Gem'); });
await sweep('studios', async (page) => { await setupChat(page); await clickId(page, 'plus-menu-button'); await clickLabel(page, 'All Studios'); });
await sweep('design-studio', async (page) => { await setupChat(page); await clickId(page, 'plus-menu-button'); await clickLabel(page, 'Design Studio'); });
await sweep('music-studio', async (page) => { await setupChat(page); await clickId(page, 'plus-menu-button'); await clickLabel(page, 'Music Studio'); });
await sweep('data-lab', async (page) => { await setupChat(page); await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.press('k'); await page.keyboard.up('Control'); await wait(300); await clickLabel(page, 'Data Lab'); });
await sweep('camera', async (page) => { await setupChat(page); await clickLabel(page, 'Camera mode'); });
await sweep('agent', async (page) => { await setupChat(page); await clickLabel(page, 'Agent'); });
await sweep('browser', async (page) => { await setupChat(page); await clickLabel(page, 'Browser'); });

// Settings home and each subview are independently fresh so navigation does not hide later controls.
const settingsLabels = ['Personalization', 'Memory', 'Language', 'Gmail', 'Spotify', 'Accent color', 'Web search & data', 'LLM keys', 'About'];
for (const label of settingsLabels) {
  const key = label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  await sweep(`settings-${key}`, async (page) => {
    await setupChat(page); await clickLabel(page, 'Menu'); await clickLabel(page, 'Settings'); await wait(300); await clickLabel(page, label);
  }, { max: 70 });
}

// Dedicated OAuth entry assertions: open provider login without entering credentials or authorizing.
for (const provider of ['Gmail', 'Spotify']) {
  const flow = `oauth-${provider.toLowerCase()}`;
  const page = await fresh(flow);
  await setupChat(page); await clickLabel(page, 'Menu'); await clickLabel(page, 'Settings'); await wait(300); await clickLabel(page, provider); await wait(300);
  const controls = await inventory(page); const connect = controls.find((x) => /connect/i.test(x.text));
  if (connect) await clickTarget(page, flow, connect, 'oauth');
  else results.push({ flow, kind: 'expected-control', target: `Connect ${provider}`, outcome: 'not-found' });
  await wait(1800); await page.close();
}

// Final reset: use the visible Clear all flow, open its confirmation, then confirm only here.
const resetFlow = 'final-app-reset';
const resetPage = await fresh(resetFlow);
await setupChat(resetPage); await clickLabel(resetPage, 'Open history'); await wait(400);
const resetControls = await inventory(resetPage);
const clear = resetControls.find((x) => /clear all/i.test(`${x.text} ${x.aria} ${x.title}`));
if (clear) {
  await clickTarget(resetPage, resetFlow, clear, 'normal');
  await wait(300);
  const confirmControls = await inventory(resetPage);
  const confirm = confirmControls.find((x) => /clear all|delete all|confirm/i.test(`${x.text} ${x.aria} ${x.title}`) && !/cancel/i.test(`${x.text} ${x.aria} ${x.title}`));
  if (confirm) {
    const outcome = await clickSignature(resetPage, confirm);
    await wait(1000);
    results.push({ flow: resetFlow, kind: 'reset-confirmation', item: confirm, outcome, result: 'chat-reset-requested-through-ui' });
    await screenshot(resetPage, 'final-reset-complete');
  } else results.push({ flow: resetFlow, kind: 'reset-confirmation', outcome: 'confirmation-control-not-found' });
} else results.push({ flow: resetFlow, kind: 'reset', outcome: 'clear-all-control-not-found' });
await resetPage.close();

const report = {
  url, chromiumPath, screenshotCount: shotNo, screenshots,
  results, protectedActions, errors: [...new Set(errors)],
  counts: {
    buttonAttempts: results.filter((x) => x.kind === 'button').length,
    successfulButtonActivations: results.filter((x) => x.kind === 'button' && x.outcome?.ok).length,
    failedButtonActivations: results.filter((x) => x.kind === 'button' && x.outcome && !x.outcome.ok).length,
    protectedApiKeyActions: protectedActions.length,
    oauthPopups: results.filter((x) => x.kind === 'popup').length,
    dialogsDismissed: results.filter((x) => x.kind === 'dialog').length,
  },
};
writeFileSync(`${outDir}/full-button-pass-report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ counts: report.counts, screenshotCount: report.screenshotCount, errors: report.errors.slice(0, 30), reset: results.filter((x) => x.flow === resetFlow) }, null, 2));
await browser.close();
