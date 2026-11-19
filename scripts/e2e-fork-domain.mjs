import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const playwrightPath = process.env.PLAYWRIGHT_PATH || '/Users/coco/Workspace/e2e-tester/tools/node_modules/playwright/index.mjs';
const { chromium } = await import(playwrightPath);
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEST = process.env.DEST || path.join(ROOT, 'public-fork-domain');
const OUT = process.env.E2E_OUT || path.join(ROOT, '..', 'hellotas-domain-20261116');
const DOMAIN = 'ictfutureintas.com';
const ORIGIN = `https://${DOMAIN}`;
const shots = path.join(OUT, 'shots');
fs.mkdirSync(shots, { recursive: true });

const results = [];
const rec = (ok, name, extra = {}) => {
  results.push({ ok, name, ...extra });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra.detail ? ' — ' + extra.detail : ''}`);
};

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close((err) => err ? reject(err) : resolve(port));
    });
    s.on('error', reject);
  });
}

function waitForPort(port, timeoutMs = 8000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const sock = net.connect({ host: '127.0.0.1', port }, () => {
        sock.end();
        resolve();
      });
      sock.on('error', () => {
        if (Date.now() - start > timeoutMs) reject(new Error(`timeout waiting for 127.0.0.1:${port}`));
        else setTimeout(tryOnce, 50);
      });
    };
    tryOnce();
  });
}

async function startServer(rootDir) {
  const port = await freePort();
  const child = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
    cwd: rootDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const errChunks = [];
  child.stderr.on('data', (b) => errChunks.push(b));
  child.on('exit', (code) => {
    if (code && code !== 0) errChunks.push(Buffer.from(`http.server exited ${code}`));
  });
  try {
    await waitForPort(port);
  } catch (e) {
    child.kill('SIGTERM');
    throw new Error(`${e.message}: ${Buffer.concat(errChunks).toString()}`);
  }
  return { port, child };
}

async function attachRoutes(context, port) {
  const prefix = `${ORIGIN}/`;
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    if (!url.startsWith(prefix) && url !== ORIGIN && url !== `${ORIGIN}/`) {
      return route.continue();
    }
    const u = new URL(url);
    let pathname = u.pathname || '/';
    const tryLocal = async (pathname) => fetch(`http://127.0.0.1:${port}${pathname}${u.search}`, { redirect: 'manual' });
    try {
      let res = await tryLocal(pathname);
      // Directory URLs without a trailing slash 301 to http://127.0.0.1 on the
      // local server; follow that internally so the browser never leaves the
      // simulated https://ictfutureintas.com origin.
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (loc) {
          const dest = new URL(loc, `http://127.0.0.1:${port}${pathname}`);
          res = await tryLocal(dest.pathname);
        }
      }
      const status = res.status;
      const headers = {};
      res.headers.forEach((v, k) => {
        const key = k.toLowerCase();
        if (key === 'transfer-encoding' || key === 'connection') return;
        if (key === 'location') {
          const loc = new URL(v, local);
          // Keep directory redirects on the simulated domain.
          headers[k] = `${ORIGIN}${loc.pathname}${loc.search}`;
          return;
        }
        headers[k] = v;
      });
      const body = Buffer.from(await res.arrayBuffer());
      await route.fulfill({ status, headers, body });
    } catch (err) {
      await route.fulfill({ status: 502, body: String(err) });
    }
  });
}

async function ready(page) {
  try { await page.waitForLoadState('load', { timeout: 15000 }); } catch {}
  await page.evaluate(async () => {
    try { if (document.fonts) await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 3000))]); } catch {}
    await Promise.race([
      Promise.all([...document.images].map((img) => img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; setTimeout(r, 4000); }))),
      new Promise((r) => setTimeout(r, 5000)),
    ]);
  });
  await page.waitForTimeout(120);
}

async function openMobileNav(page, width) {
  if (width >= 1440) return;
  const open = await page.evaluate(() => {
    const m = document.querySelector('.mobile-menu');
    return m && !m.hasAttribute('hidden') && getComputedStyle(m).display !== 'none';
  });
  if (!open) {
    await page.locator('.nav-toggle').click();
    await page.locator('.mobile-menu a').first().waitFor({ state: 'visible', timeout: 5000 });
  }
}

function classifyUrl(raw, pageUrl) {
  if (!raw || raw.startsWith('data:') || raw.startsWith('mailto:') || raw.startsWith('javascript:') || raw.startsWith('#')) {
    return { kind: 'other', raw };
  }
  let abs;
  try { abs = new URL(raw, pageUrl).href; } catch { return { kind: 'invalid', raw }; }
  const u = new URL(abs);
  if (u.hostname === DOMAIN) return { kind: 'internal-abs', raw, abs, path: u.pathname };
  if (raw.startsWith('/') && !raw.startsWith('//')) return { kind: 'internal-rel', raw, abs, path: raw };
  return { kind: 'external', raw, abs, host: u.hostname };
}

const langs = {
  en: {
    home: `${ORIGIN}/`,
    events: `${ORIGIN}/events/`,
    step3: `${ORIGIN}/journey/step-3/`,
    community: 'Tasmania Community',
    ict: 'ICT Industry',
    eventsH1: 'ICT Events Archive & Student Voices',
    step3H1: 'Find Your Community',
    search: 'hackathon',
  },
  zh: {
    home: `${ORIGIN}/zh/`,
    events: `${ORIGIN}/zh/events/`,
    step3: `${ORIGIN}/zh/journey/step-3/`,
    community: '塔斯马尼亚社区',
    ict: 'ICT 行业',
    eventsH1: 'ICT活动档案与学生心声',
    step3H1: '找到你的社群',
    search: 'hackathon',
  },
  ne: {
    home: `${ORIGIN}/ne/`,
    events: `${ORIGIN}/ne/events/`,
    step3: `${ORIGIN}/ne/journey/step-3/`,
    community: 'तस्मानिया समुदाय',
    ict: 'ICT उद्योग',
    eventsH1: 'ICT कार्यक्रम संग्रह र विद्यार्थीहरूको आवाज',
    step3H1: 'आफ्नो समुदाय भेट्नुहोस्',
    search: 'hackathon',
  },
};

// Static output checks (sitemap, CNAME, leftover paths) before the browser.
const cname = fs.readFileSync(path.join(DEST, 'CNAME'), 'utf8').trim();
rec(cname === DOMAIN, 'CNAME is ictfutureintas.com', { detail: cname });
rec(fs.existsSync(path.join(DEST, '.nojekyll')), '.nojekyll present');

function scanFiles() {
  const leftover = [];
  const sitemapBad = [];
  const absNew = [];
  const knownSource = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.(html|xml|txt|json|css|js)$/i.test(name)) {
        const text = fs.readFileSync(p, 'utf8');
        const rel = path.relative(DEST, p);
        if (text.includes(DOMAIN)) absNew.push(rel);
        const re = /https?:\/\/(?:weiluoyan|yunkou)\.github\.io\/hellotas[^"' \t<]*/g;
        let m;
        while ((m = re.exec(text))) {
          knownSource.push({ file: rel, url: m[0] });
        }
        const re2 = /(?:href|src)=(?:["']?)(\/hellotas\/[^"' >]*)/g;
        while ((m = re2.exec(text))) leftover.push({ file: rel, url: m[1] });
        if (rel.endsWith('sitemap.xml')) {
          const locs = [...text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((x) => x[1]);
          for (const loc of locs) {
            if (loc.includes('/hellotas') || loc.includes('github.io') || !loc.startsWith(ORIGIN + '/')) {
              sitemapBad.push({ file: rel, loc });
            }
          }
        }
      }
    }
  };
  walk(DEST);
  return { leftover, sitemapBad, absNew, knownSource };
}

const scanned = scanFiles();
rec(scanned.leftover.length === 0, 'build has no root-relative /hellotas/ href/src', { detail: JSON.stringify(scanned.leftover.slice(0, 5)) });
rec(scanned.sitemapBad.length === 0, 'sitemaps use https://ictfutureintas.com/ only', { detail: JSON.stringify(scanned.sitemapBad.slice(0, 5)) });
rec(scanned.absNew.length > 0, 'build contains new-domain absolute URLs', { detail: String(scanned.absNew.length) });
const unexpectedSource = scanned.knownSource.filter((x) => !x.file.includes('events/2025/edcat/'));
rec(unexpectedSource.length === 0, 'github.io/hellotas only remains as EDCAT source citation', { detail: unexpectedSource.length ? JSON.stringify(unexpectedSource.slice(0, 3)) : `${scanned.knownSource.length} edcat citation(s)` });

const { port, child: server } = await startServer(DEST);
console.log(`local server 127.0.0.1:${port} (routed as ${ORIGIN})`);

const browser = await chromium.launch({ headless: true });

try {
  for (const lang of ['en', 'zh', 'ne']) {
    const cfg = langs[lang];
    for (const w of [1440, 390, 360]) {
      const h = w >= 1440 ? 900 : 844;
      const tag = `${lang}@${w}`;
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
      await attachRoutes(ctx, port);
      const page = await ctx.newPage();

      const resp = await page.goto(cfg.home, { waitUntil: 'domcontentloaded', timeout: 30000 });
      rec(!!(resp && resp.ok()), `${tag} home HTTP`, { detail: `${resp && resp.status()} ${page.url()}` });
      rec(page.url() === cfg.home, `${tag} home URL is root-domain path`, { detail: page.url() });
      await ready(page);

      const overflow = await page.evaluate(() => ({ c: document.documentElement.clientWidth, s: document.documentElement.scrollWidth }));
      rec(overflow.s <= overflow.c + 1, `${tag} no horizontal overflow`, { detail: `${overflow.s}<=${overflow.c}` });

      const typo = await page.evaluate((pageUrl, domain) => {
        const nodes = [...document.querySelectorAll('a[href], img[src], link[href], script[src]')];
        const items = nodes.map((el) => {
          const raw = el.getAttribute('href') || el.getAttribute('src') || '';
          return { tag: el.tagName, raw };
        });
        const canon = document.querySelector('link[rel="canonical"]')?.href || null;
        const hrefLang = [...document.querySelectorAll('link[rel="alternate"][hreflang]')].map((l) => ({ lang: l.getAttribute('hreflang'), href: l.href }));
        return { items, canon, hrefLang, origin: location.origin, path: location.pathname };
      }, page.url());

      rec(typo.origin === ORIGIN, `${tag} location.origin is simulated domain`, { detail: typo.origin });
      // Upstream now emits canonical + hreflang; --baseURL must keep them on the
      // fork singular domain, never the official plural site or /hellotas/.
      rec(typo.canon === page.url(), `${tag} canonical is the current singular-domain URL`, { detail: String(typo.canon) });
      rec(!String(typo.canon || '').includes('ictfuturesintas.com') && !String(typo.canon || '').includes('/hellotas'), `${tag} canonical is not the official plural domain or /hellotas/`, { detail: String(typo.canon) });
      rec(typo.hrefLang.length === 4, `${tag} hreflang tags present`, { detail: String(typo.hrefLang.length) });
      const hrefLangBad = typo.hrefLang.filter((l) => !l.href.startsWith(`${ORIGIN}/`) && l.href !== ORIGIN && l.href !== `${ORIGIN}/`);
      rec(hrefLangBad.length === 0, `${tag} hreflang hrefs stay on the singular domain`, { detail: JSON.stringify(hrefLangBad) });
      rec(typo.hrefLang.every((l) => !l.href.includes('ictfuturesintas.com') && !l.href.includes('/hellotas')), `${tag} hreflang hrefs are not the official plural domain or /hellotas/`);

      const badInternal = [];
      for (const item of typo.items) {
        const c = classifyUrl(item.raw, page.url());
        if (c.kind === 'internal-rel' || c.kind === 'internal-abs') {
          if ((c.path && c.path.startsWith('/hellotas/')) || (c.abs && c.abs.includes('/hellotas/')) || (c.abs && c.abs.includes('github.io/hellotas'))) {
            badInternal.push(item.raw);
          }
        }
      }
      rec(badInternal.length === 0, `${tag} in-page links/resources have no /hellotas/ prefix`, { detail: badInternal.slice(0, 5).join(' | ') });

      const cssOk = await page.evaluate(() => {
        const link = document.querySelector('link[rel="stylesheet"][href*="custom."]');
        if (!link) return { ok: false, href: null, loaded: false };
        const href = link.href;
        return { ok: href.includes('/css/custom.') && !href.includes('/hellotas/'), href, loaded: !!link.sheet };
      });
      rec(!!cssOk.ok && !!cssOk.loaded, `${tag} fingerprinted CSS loads from root path`, { detail: cssOk.href });

      if (w === 1440 || w === 390) {
        await page.screenshot({ path: path.join(shots, `after-${lang}-${w}-home.png`) });
      }

      // Language switch (desktop, or after opening picker)
      if (w === 1440) {
        await page.locator('details.lang-picker summary').click();
        const targetLang = lang === 'en' ? 'zh' : 'en';
        const targetUrl = langs[targetLang].home;
        const label = targetLang === 'zh' ? '简体中文' : 'English';
        await page.locator('.lang-menu a', { hasText: label }).click();
        await ready(page);
        rec(page.url() === targetUrl, `${tag} language switch to ${targetLang} stays on new domain`, { detail: page.url() });
        rec(!page.url().includes('/hellotas/'), `${tag} language switch URL has no /hellotas/`);
        await page.goto(cfg.home, { waitUntil: 'domcontentloaded' });
        await ready(page);
      }

      // Tasmania Community -> step 3
      await openMobileNav(page, w);
      const commSel = w >= 1440 ? page.locator('.nav-links a', { hasText: cfg.community }) : page.locator('.mobile-menu a', { hasText: cfg.community });
      await commSel.click();
      await ready(page);
      rec(page.url() === cfg.step3, `${tag} Tasmania Community -> step-3`, { detail: page.url() });
      const stepH1 = (await page.locator('h1').first().innerText()).trim();
      rec(stepH1 === cfg.step3H1, `${tag} step-3 h1`, { detail: stepH1 });
      if (w === 1440) await page.screenshot({ path: path.join(shots, `after-${lang}-step3.png`) });

      // ICT Industry -> events
      await page.goto(cfg.home, { waitUntil: 'domcontentloaded' });
      await ready(page);
      await openMobileNav(page, w);
      const ictSel = w >= 1440 ? page.locator('.nav-links a', { hasText: cfg.ict }) : page.locator('.mobile-menu a', { hasText: cfg.ict });
      await ictSel.click();
      await ready(page);
      rec(page.url() === cfg.events, `${tag} ICT Industry -> events`, { detail: page.url() });
      const evH1 = (await page.locator('h1').first().innerText()).trim();
      rec(evH1 === cfg.eventsH1, `${tag} events h1`, { detail: evH1 });
      const cardsAll = await page.locator('article.event-card').count();
      rec(cardsAll >= 5, `${tag} events cards present`, { detail: String(cardsAll) });
      if (w === 1440) await page.screenshot({ path: path.join(shots, `after-${lang}-events.png`) });

      // Year filter
      const year2026 = page.locator('.year-tab[data-year="2026"]');
      rec(await year2026.count() === 1, `${tag} year 2026 tab present`);
      await year2026.click();
      await page.waitForTimeout(200);
      const vis = await page.evaluate(() => {
        const years = [...document.querySelectorAll('.events-year')].map((el) => ({
          year: el.getAttribute('data-year'),
          hidden: el.hidden || getComputedStyle(el).display === 'none',
          cards: el.querySelectorAll('article.event-card').length,
        }));
        return years;
      });
      rec(vis.some((y) => y.year === '2026' && !y.hidden && y.cards > 0), `${tag} year filter shows 2026 cards`, { detail: JSON.stringify(vis) });
      rec(vis.filter((y) => y.year !== '2026').every((y) => y.hidden), `${tag} year filter hides other years`);

      // Reset year to all, then search
      await page.locator('.year-tab[data-year="all"]').click();
      await page.waitForTimeout(150);
      await page.locator('.events-search-input').fill(cfg.search);
      await page.waitForTimeout(250);
      const searchState = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('article.event-card')];
        const visible = cards.filter((c) => !c.hidden && getComputedStyle(c).display !== 'none');
        return { total: cards.length, visible: visible.length, href: visible[0]?.querySelector('h3 a')?.getAttribute('href') || null };
      });
      rec(searchState.visible >= 1 && searchState.visible < searchState.total, `${tag} search filters cards`, { detail: JSON.stringify(searchState) });

      // Open a visible detail page and go back
      const detailLink = page.locator('article.event-card:visible h3 a').first();
      const href = await detailLink.getAttribute('href');
      rec(!!href && href.startsWith('/') && !href.includes('/hellotas/'), `${tag} event detail href is root-relative`, { detail: href });
      await detailLink.click();
      await ready(page);
      rec(page.url().startsWith(cfg.events) && page.url() !== cfg.events, `${tag} event detail on new domain`, { detail: page.url() });
      rec(!page.url().includes('/hellotas/'), `${tag} event detail URL has no /hellotas/`);
      await page.locator('a.back-link').click();
      await ready(page);
      rec(page.url() === cfg.events, `${tag} event detail back returns to events list`, { detail: page.url() });

      await ctx.close();
    }
  }
} finally {
  await browser.close();
  server.kill('SIGTERM');
}

const failed = results.filter((r) => !r.ok);
const summary = { total: results.length, passed: results.length - failed.length, failed: failed.length, failures: failed };
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'e2e-results.json'), JSON.stringify({ summary, results }, null, 2));
fs.writeFileSync(path.join(OUT, 'e2e.log'), results.map((r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ' — ' + r.detail : ''}`).join('\n') + `\n\n==== SUMMARY ====\n${JSON.stringify(summary, null, 2)}\n`);
console.log('\n==== SUMMARY ====');
console.log(JSON.stringify(summary, null, 2));
if (failed.length) process.exit(1);
