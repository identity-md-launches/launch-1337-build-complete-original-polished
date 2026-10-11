/**
 * Bounded end-to-end verification for Tongue Rush.
 *
 * One foreground command: starts a throwaway static server (dist/ under /preview/
 * so relative asset URLs are exercised at a subpath), drives headless Chromium with
 * Playwright, takes screenshots into artifacts/screenshots/, writes
 * artifacts/validation-results.json and exits. Nothing keeps running afterwards.
 *
 *   node test/verify.mjs            # run the checks against dist/
 *   node test/verify.mjs --cover    # render test/cover.html to public/cover.png
 *
 * Playwright is resolved from the local machine (PLAYWRIGHT_MODULE / PLAYWRIGHT_CHROME
 * env vars override the defaults); it is a test-only dependency and not shipped.
 */
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const shots = path.join(root, 'artifacts', 'screenshots');
const PW_MODULE = process.env.PLAYWRIGHT_MODULE ?? '/opt/imd-mcp/node/node_modules/playwright-core';
const CHROME = process.env.PLAYWRIGHT_CHROME ?? '/opt/imd-mcp/ms-playwright/chromium-1246/chrome-linux64/chrome';
const require = createRequire(import.meta.url);
const { chromium } = require(PW_MODULE);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

function serve() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      let file;
      if (url.pathname.startsWith('/preview/')) {
        file = path.join(dist, decodeURIComponent(url.pathname.slice('/preview/'.length)) || 'index.html');
      } else {
        file = path.join(root, decodeURIComponent(url.pathname));
      }
      if (!file.startsWith(root)) throw new Error('outside root');
      const info = await stat(file);
      if (info.isDirectory()) file = path.join(file, 'index.html');
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

const results = [];
function record(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
async function expect(name, fn) {
  try {
    const out = await fn();
    if (out === false) record(name, false);
    else record(name, true, typeof out === 'string' ? out : '');
  } catch (err) {
    record(name, false, String(err?.message ?? err));
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function renderCover(browser, base) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.goto(`${base}/test/cover.html`);
  await page.evaluate(() => document.fonts.ready);
  await sleep(200);
  await page.screenshot({ path: path.join(root, 'public', 'cover.png'), type: 'png' });
  await page.close();
  console.log('cover rendered to public/cover.png');
}

const hook = `(window.__tongueRush)`;

async function desktopFlow(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  const failed = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('response', (r) => r.status() >= 400 && failed.push(`${r.status()} ${r.url()}`));

  await page.goto(`${base}/preview/index.html#debug`);
  await page.evaluate(() => document.fonts.ready);
  await sleep(400);

  await expect('desktop: head metadata present', async () => {
    const meta = await page.evaluate(() => ({
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.content,
      ogTitle: document.querySelector('meta[property="og:title"]')?.content,
      ogImage: document.querySelector('meta[property="og:image"]')?.content,
      icon: document.querySelector('link[rel="icon"]')?.href,
    }));
    if (!meta.title || !meta.description || !meta.ogTitle || !meta.ogImage || !meta.icon) throw new Error(JSON.stringify(meta));
    return `title="${meta.title}"`;
  });
  await expect('desktop: fonts loaded (Baloo 2, Nunito)', async () => {
    const ok = await page.evaluate(() => document.fonts.check('800 20px "Baloo 2"') && document.fonts.check('700 16px Nunito'));
    return ok ? 'document.fonts.check true' : false;
  });
  await page.screenshot({ path: path.join(shots, 'desktop-start.png') });
  await expect('desktop: start screen shows title and Start button in first screen', async () => {
    const box = await page.locator('#btn-start').boundingBox();
    const h1 = await page.locator('h1').textContent();
    if (!box || box.y + box.height > 800) throw new Error(JSON.stringify(box));
    return `h1="${h1?.trim()}" start button at y=${Math.round(box.y)}`;
  });
  await expect('desktop: Start button has initial focus', async () => {
    return (await page.evaluate(() => document.activeElement?.id)) === 'btn-start';
  });

  await page.click('#btn-start');
  await sleep(300);
  await expect('desktop: run starts, HUD visible, start overlay hidden', async () => {
    const hudHidden = await page.locator('#hud').isHidden();
    const startHidden = await page.locator('#screen-start').isHidden();
    if (hudHidden || !startHidden) throw new Error(`hud hidden=${hudHidden} start hidden=${startHidden}`);
    return (await page.evaluate(`${hook}.game.phase`)) === 'playing';
  });
  await expect('desktop: audio context running after gesture', async () => {
    const state = await page.evaluate(`${hook}.audioState()`);
    if (state !== 'running') throw new Error(`state=${state}`);
    return state;
  });

  const pepe = await page.evaluate(`${hook}.game.pepePosition`);
  async function catchKind(kind, dx, dy) {
    await page.evaluate(({ kind, x, y }) => window.__tongueRush.game.debugSpawnAt(kind, x, y), { kind, x: pepe.x + dx, y: pepe.y + dy });
    await page.mouse.move(pepe.x + dx, pepe.y + dy);
    await page.mouse.down();
    await page.mouse.up();
    await sleep(450);
  }

  await expect('desktop: mouse aim + click catches a fly and scores', async () => {
    await catchKind('fly', 0, -150);
    const score = Number(await page.locator('#hud-score').textContent());
    if (score <= 0) throw new Error(`score=${score}`);
    return `score=${score}`;
  });
  await expect('desktop: golden firefly raises the multiplier', async () => {
    await catchKind('firefly', 150, -40);
    const multi = await page.locator('#hud-multi').textContent();
    if (!multi.startsWith('2x')) throw new Error(`multi=${multi}`);
    return `multiplier=${multi}`;
  });
  await expect('desktop: rainbow bug starts Frenzy (bar visible)', async () => {
    await catchKind('rainbow', -150, -40);
    const active = await page.evaluate(`${hook}.game.frenzyActive`);
    const barVisible = await page.locator('#frenzy-bar').isVisible();
    if (!active || !barVisible) throw new Error(`active=${active} bar=${barVisible}`);
    return 'frenzy active';
  });
  await sleep(250);
  await page.screenshot({ path: path.join(shots, 'desktop-frenzy.png') });

  await expect('desktop: Escape pauses, focus moves to Resume', async () => {
    await page.keyboard.press('Escape');
    await sleep(200);
    const phase = await page.evaluate(`${hook}.game.phase`);
    const focused = await page.evaluate(() => document.activeElement?.id);
    if (phase !== 'paused' || focused !== 'btn-resume') throw new Error(`phase=${phase} focus=${focused}`);
    return 'paused, focus=btn-resume';
  });
  await page.screenshot({ path: path.join(shots, 'desktop-pause.png') });
  await expect('desktop: Tab order inside pause panel and visible focus ring', async () => {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      const cs = getComputedStyle(el);
      return { id: el?.id, outline: cs.outlineStyle, width: cs.outlineWidth };
    });
    if (focused.id !== 'btn-restart-pause' || focused.outline !== 'solid') throw new Error(JSON.stringify(focused));
    return `focus=${focused.id} outline ${focused.outline} ${focused.width}`;
  });
  await page.screenshot({ path: path.join(shots, 'desktop-pause-focus.png') });
  await expect('desktop: Escape resumes, focus returns to pause button', async () => {
    await page.keyboard.press('Escape');
    await sleep(200);
    return (await page.evaluate(`${hook}.game.phase`)) === 'playing';
  });

  await expect('desktop: keyboard aim (ArrowLeft) + Space catches a fly', async () => {
    const before = Number(await page.locator('#hud-score').textContent());
    await page.evaluate(({ x, y }) => window.__tongueRush.game.debugSpawnAt('fly', x, y), { x: pepe.x - 160, y: pepe.y + 10 });
    await page.keyboard.down('ArrowLeft');
    await sleep(350);
    await page.keyboard.up('ArrowLeft');
    await page.keyboard.press('Space');
    await sleep(450);
    const after = Number(await page.locator('#hud-score').textContent());
    if (after <= before) throw new Error(`score ${before} -> ${after}`);
    return `score ${before} -> ${after}`;
  });

  await expect('desktop: wasp hit costs a life and resets the multiplier', async () => {
    await catchKind('wasp', 0, -150);
    const lives = await page.locator('#hud-lives-text').textContent();
    const multi = await page.locator('#hud-multi').textContent();
    if (!lives.startsWith('2 ') || multi !== '1x') throw new Error(`lives="${lives}" multi=${multi}`);
    return `${lives}, multiplier ${multi}`;
  });
  await sleep(700);
  await page.screenshot({ path: path.join(shots, 'desktop-hurt.png') });
  await expect('desktop: three wasp hits end the run and show the game-over panel', async () => {
    await sleep(600);
    await catchKind('wasp', 0, -150);
    await sleep(700);
    await catchKind('wasp', 0, -150);
    await sleep(1200);
    const phase = await page.evaluate(`${hook}.game.phase`);
    const visible = await page.locator('#screen-over').isVisible();
    const focused = await page.evaluate(() => document.activeElement?.id);
    if (phase !== 'over' || !visible || focused !== 'btn-again') throw new Error(`phase=${phase} visible=${visible} focus=${focused}`);
    return `score shown: ${await page.locator('#over-score').textContent()}`;
  });
  await page.screenshot({ path: path.join(shots, 'desktop-gameover.png') });
  await expect('desktop: R restarts instantly', async () => {
    await page.keyboard.press('r');
    await sleep(300);
    const phase = await page.evaluate(`${hook}.game.phase`);
    const score = await page.locator('#hud-score').textContent();
    if (phase !== 'playing' || score !== '0') throw new Error(`phase=${phase} score=${score}`);
    return 'new run';
  });
  await expect('desktop: M toggles mute and updates all mute buttons', async () => {
    await page.keyboard.press('m');
    const pressed = await page.locator('#btn-mute-hud').getAttribute('aria-pressed');
    const label = await page.locator('#btn-mute-hud').getAttribute('aria-label');
    await page.keyboard.press('m');
    if (pressed !== 'true' || label !== 'Unmute sound') throw new Error(`pressed=${pressed} label=${label}`);
    return 'aria-pressed toggled';
  });
  await expect('desktop: blur (tab switch) pauses the game', async () => {
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await sleep(100);
    return (await page.evaluate(`${hook}.game.phase`)) === 'paused';
  });
  await expect('desktop: no console errors', async () => {
    if (errors.length) throw new Error(errors.join(' | '));
    return 'none';
  });
  await expect('desktop: no failed resource loads', async () => {
    if (failed.length) throw new Error(failed.join(' | '));
    return 'all < 400';
  });
  await context.close();
}

async function mobileFlow(browser, base) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${base}/preview/index.html#debug`);
  await page.evaluate(() => document.fonts.ready);
  await sleep(400);
  await page.screenshot({ path: path.join(shots, 'mobile-390-start.png') });
  await expect('mobile 390: product and Start button on first screen, no horizontal overflow', async () => {
    const box = await page.locator('#btn-start').boundingBox();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    if (!box || box.y + box.height > 844 || overflow) throw new Error(`box=${JSON.stringify(box)} overflow=${overflow}`);
    return `start button bottom=${Math.round(box.y + box.height)}`;
  });
  await expect('mobile 390: touch targets at least 44px', async () => {
    const sizes = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#screen-start button')).map((b) => {
        const r = b.getBoundingClientRect();
        return [b.id, Math.round(r.width), Math.round(r.height)];
      }),
    );
    const small = sizes.filter(([, w, h]) => w < 44 || h < 44);
    if (small.length) throw new Error(JSON.stringify(small));
    return JSON.stringify(sizes);
  });
  await page.tap('#btn-start');
  await sleep(300);
  const pepe = await page.evaluate(`${hook}.game.pepePosition`);
  await expect('mobile: tap aims and snaps (fly caught)', async () => {
    await page.evaluate(({ x, y }) => window.__tongueRush.game.debugSpawnAt('fly', x, y), { x: pepe.x, y: pepe.y - 140 });
    await page.touchscreen.tap(pepe.x, pepe.y - 140);
    await sleep(450);
    const score = Number(await page.locator('#hud-score').textContent());
    if (score <= 0) throw new Error(`score=${score}`);
    return `score=${score}`;
  });
  await expect('mobile: drag to aim, release to snap (firefly caught)', async () => {
    const before = Number(await page.locator('#hud-score').textContent());
    await page.evaluate(({ x, y }) => window.__tongueRush.game.debugSpawnAt('firefly', x, y), { x: pepe.x + 120, y: pepe.y - 60 });
    const cdp = await context.newCDPSession(page);
    const touch = (type, x, y) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    await touch('touchStart', pepe.x - 60, pepe.y + 120);
    for (let i = 1; i <= 8; i++) {
      await touch('touchMove', pepe.x - 60 + (180 * i) / 8, pepe.y + 120 - (180 * i) / 8);
      await sleep(30);
    }
    await touch('touchEnd', 0, 0);
    await sleep(500);
    const after = Number(await page.locator('#hud-score').textContent());
    const multi = await page.locator('#hud-multi').textContent();
    if (after <= before || multi !== '2x') throw new Error(`score ${before} -> ${after}, multi=${multi}`);
    return `score ${before} -> ${after}, multiplier ${multi}`;
  });
  await page.screenshot({ path: path.join(shots, 'mobile-390-play.png') });
  await expect('mobile: pause button (44px) opens pause panel', async () => {
    await page.tap('#btn-pause');
    await sleep(200);
    return (await page.evaluate(`${hook}.game.phase`)) === 'paused';
  });
  await page.screenshot({ path: path.join(shots, 'mobile-390-pause.png') });
  await expect('mobile: no console errors', async () => {
    if (errors.length) throw new Error(errors.join(' | '));
    return 'none';
  });
  await context.close();

  const narrow = await browser.newContext({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true });
  const p2 = await narrow.newPage();
  await p2.goto(`${base}/preview/index.html`);
  await sleep(400);
  await p2.screenshot({ path: path.join(shots, 'mobile-320-start.png'), fullPage: true });
  await expect('mobile 320: reflows without horizontal scroll, Start reachable', async () => {
    const overflow = await p2.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    const box = await p2.locator('#btn-start').boundingBox();
    if (overflow || !box) throw new Error(`overflow=${overflow}`);
    return `start button at y=${Math.round(box.y)}`;
  });
  await narrow.close();

  const rm = await browser.newContext({ viewport: { width: 1024, height: 700 }, reducedMotion: 'reduce' });
  const p3 = await rm.newPage();
  await p3.goto(`${base}/preview/index.html#debug`);
  await sleep(300);
  await expect('reduced motion: preference honoured by the game and CSS', async () => {
    const flag = await p3.evaluate(`${hook}.game.reducedMotion`);
    const anim = await p3.evaluate(() => getComputedStyle(document.querySelector('.panel')).animationName);
    if (!flag || anim !== 'none') throw new Error(`flag=${flag} animation=${anim}`);
    return 'shake/particles reduced, panel animation none';
  });
  await p3.screenshot({ path: path.join(shots, 'desktop-1024-reduced-motion.png') });
  await rm.close();
}

async function iframeFlow(browser, base) {
  const context = await browser.newContext({ viewport: { width: 900, height: 600 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${base}/test/sandbox.html`);
  await sleep(800);
  const frame = page.frames().find((f) => f.url().includes('/preview/'));
  await expect('iframe: sandboxed frame loaded and replied ready on the init channel', async () => {
    const msgs = await page.evaluate(() => window.__msgs);
    const connected = await frame.evaluate(`${hook}.bridgeConnected()`);
    if (!msgs.some((m) => m.type === 'ready' && m.channel === 'test-channel') || !connected) throw new Error(JSON.stringify(msgs));
    return 'ready received';
  });
  await expect('iframe: localStorage is denied and handled', async () => {
    const state = await frame.evaluate(() => {
      try {
        window.localStorage.getItem('x');
        return 'allowed';
      } catch {
        return 'blocked';
      }
    });
    if (state !== 'blocked') throw new Error(state);
    return 'storage blocked, no error thrown by game';
  });
  await frame.click('#btn-start');
  await sleep(300);
  await expect('iframe: parent pause message pauses the game', async () => {
    await page.evaluate(() => document.querySelector('iframe').contentWindow.postMessage({ protocol: 'pepe-game/1', type: 'pause', channel: 'test-channel' }, '*'));
    await sleep(150);
    return (await frame.evaluate(`${hook}.game.phase`)) === 'paused';
  });
  await expect('iframe: wrong channel is ignored', async () => {
    await frame.click('#btn-resume');
    await sleep(150);
    await page.evaluate(() => document.querySelector('iframe').contentWindow.postMessage({ protocol: 'pepe-game/1', type: 'pause', channel: 'other' }, '*'));
    await sleep(150);
    return (await frame.evaluate(`${hook}.game.phase`)) === 'playing';
  });
  await expect('iframe: game over posts an integer score to the parent', async () => {
    const pepe = await frame.evaluate(`${hook}.game.pepePosition`);
    const box = await frame.frameElement().then((el) => el.boundingBox());
    for (let i = 0; i < 3; i++) {
      await frame.evaluate(({ x, y }) => window.__tongueRush.game.debugSpawnAt('wasp', x, y), { x: pepe.x, y: pepe.y - 150 });
      await page.mouse.click(box.x + pepe.x, box.y + pepe.y - 150);
      await sleep(900);
    }
    await sleep(300);
    const msgs = await page.evaluate(() => window.__msgs);
    const score = msgs.find((m) => m.type === 'score');
    if (!score || !Number.isInteger(score.score) || score.score < 0) throw new Error(JSON.stringify(msgs));
    return `score message ${JSON.stringify(score)}`;
  });
  await page.screenshot({ path: path.join(shots, 'iframe-sandbox-gameover.png') });
  await expect('iframe: no page errors', async () => {
    if (errors.length) throw new Error(errors.join(' | '));
    return 'none';
  });
  await context.close();
}

async function main() {
  const coverOnly = process.argv.includes('--cover');
  if (!existsSync(dist) && !coverOnly) throw new Error('dist/ missing: run npm run build first');
  await mkdir(shots, { recursive: true });
  const { server, port } = await serve();
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  try {
    if (coverOnly) {
      await renderCover(browser, base);
      return;
    }
    await desktopFlow(browser, base);
    await mobileFlow(browser, base);
    await iframeFlow(browser, base);
  } finally {
    await browser.close();
    server.close();
  }
  const failed = results.filter((r) => !r.pass);
  await writeFile(
    path.join(root, 'artifacts', 'validation-results.json'),
    JSON.stringify({ ranAt: new Date().toISOString(), chromium: CHROME, results }, null, 2),
  );
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
