import path from 'path';
import fs from 'fs';
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import LocationPathManager from '../../utils/location_manager';
import processedStore from '../../lib/processed_store';
import axios from 'axios';

const paTimestamp = () => new Date().toISOString();
const paLog = (...args: any[]) => { console.log(`${paTimestamp()} PA:`, ...args); };
const paWarn = (...args: any[]) => { console.warn(`${paTimestamp()} PA:`, ...args); };
const paError = (...args: any[]) => { console.error(`${paTimestamp()} PA:`, ...args); };

export default class PARunnerV1 {
  baseDataDir: string;
  dataDir: string;
  processedPath: string;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private locationManager: LocationPathManager;
  captchaWebhook = process.env.PA_CAPTCHA_WEBHOOK || '';
  useCaptchaWebhook = (process.env.PA_USE_WEBHOOK || 'true') === 'true';

  constructor(locationCode: string = 'PA') {
    this.locationManager = new LocationPathManager(locationCode);
    this.baseDataDir = this.locationManager.getDataDir('Foreclosure');
    this.dataDir = path.join(this.baseDataDir, 'cases');
    this.processedPath = this.locationManager.getProcessedCasesPath('foreclosure');
    if (!fs.existsSync(this.baseDataDir)) fs.mkdirSync(this.baseDataDir, { recursive: true });
    if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
    try { processedStore.init(this.processedPath); } catch (err) { paWarn('processed store init failed', err); }
  }

  private ensurePageOpen(page: Page) { if (!page || (page.isClosed && page.isClosed())) throw new Error('Playwright page is closed'); }

  private async safeGoto(page: Page, url: string, opts: any = {}, retries = 2) {
    for (let i = 0; i <= retries; i++) {
      this.ensurePageOpen(page);
      try { await page.goto(url, { waitUntil: opts.waitUntil || 'networkidle', timeout: opts.timeout || 30000 }); return; } catch (err) { if (i === retries) throw err; await page.waitForTimeout(500 + i * 300); }
    }
  }

  private async findFirstSelector(pageOrElement: Page | any, selectors: string[]) {
    for (const sel of selectors) { try { const el = await pageOrElement.$(sel); if (el) return { el, sel }; } catch (e) {} }
    return null;
  }

  async login(page: Page) {
    paLog('starting login sequence');
    const user = process.env.PA_USER || '';
    const pass = process.env.PA_PASS || '';
    const captchaSelectors = ['img[src*="BotDetect"]', 'img[id*="imgCaptcha"]', 'img[src*="captcha"]'];
    const captchaInputSelectors = ['input[name="captchaText"]', 'input#ctl00_ContentPlaceHolder1_txtCaptcha', 'input[name*="captcha"]', 'input[type="text"]'];

    while (true) {
      try {
        const u = await this.findFirstSelector(page, ['input[name="UserID"]', 'input#ctl00_ContentPlaceHolder1_txtUserID', 'input[type="text"]']);
        const p = await this.findFirstSelector(page, ['input[name="Password"]', 'input#ctl00_ContentPlaceHolder1_txtPassword', 'input[type="password"]']);
        if (u) { try { await u.el.fill(user); } catch (e) {} }
        await page.waitForTimeout(1000);
        if (p) { try { await p.el.fill(pass); } catch (e) {} }
        await page.waitForTimeout(1000);
      } catch (e) { paWarn('fill credentials failed', e); }

      const captchaEl = (await this.findFirstSelector(page, captchaSelectors))?.el;
      if (captchaEl && this.useCaptchaWebhook && this.captchaWebhook) {
        try {
          const raw = await captchaEl.screenshot({ type: 'png' });
          try { fs.writeFileSync(path.join(process.cwd(), 'data', 'PA', 'captcha_last.png'), raw); } catch (e) {}
          await page.waitForTimeout(1000);
          try {
            const b64 = raw.toString('base64');
            const resp = await axios.post(this.captchaWebhook, { image: b64, pageUrl: page.url() }, { timeout: 120000 });
            let solved: string | null = null;
            if (resp && resp.data) {
              if (typeof resp.data === 'string') solved = resp.data;
              else if (typeof resp.data.answer === 'string') solved = resp.data.answer;
              else if (typeof resp.data.text === 'string') solved = resp.data.text;
            }
            if (solved) {
              const captchaInput = (await this.findFirstSelector(page, captchaInputSelectors))?.el;
              if (captchaInput) { try { await captchaInput.fill(String(solved)); } catch (e) {} }
            }
          } catch (err) { paWarn('webhook request failed', err && err.message ? err.message : err); }
        } catch (e) { paWarn('captcha screenshot failed', e && e.message ? e.message : e); }
      }

      try {
        const submitBtn = (await this.findFirstSelector(page, ['#btnLoginClient', 'input#btnLoginClient', 'button:has-text("Login")', 'input[type="submit"]']))?.el;
        if (submitBtn) { try { await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle', timeout: 7000 }), submitBtn.click()]); } catch (e) { paWarn('submit click failed', e && e.message ? e.message : e); } }
        else { try { await page.$eval('form', (f: any) => (f as HTMLFormElement).submit()); } catch (e) {} }
      } catch (e) { paWarn('submit failed', e && e.message ? e.message : e); }

      await page.waitForTimeout(1000);
      try {
        const signed = await page.$('li#liSignedInAsName, li:has-text("Signed in As")');
        if (signed) { paLog('login appears successful'); break; }
        const bodyText = await page.$eval('body', b => (b as HTMLElement).innerText).catch(() => '');
        if (bodyText && (bodyText.indexOf('Last Login DateTime') !== -1 || bodyText.indexOf('PLEASE NOTE') !== -1 || bodyText.indexOf('Signed in As') !== -1)) { paLog('login successful via text fallback'); break; }
      } catch (e) {}

      paLog('login not successful, retrying...');
      await page.waitForTimeout(1000);
    }

    paLog('login() finished');
  }

  private async extractCaseDetailsFromPage(page: Page) {
    const out: any = { docketNumber: null, docketEntries: [], documentUrls: [], complaintUrl: null };
    try {
      const h = await page.$('h1') || await page.$('h2'); if (h) out.docketNumber = (await h.innerText()).trim();
      const table = await page.$('#DocketEntries');
      if (table) {
        const rows = await table.$$('tbody tr');
        for (const r of rows) {
          try {
            const tds = await r.$$('td');
            const filingDate = tds[0] ? (await tds[0].innerText()).trim() : '';
            const docketType = tds[1] ? (await tds[1].innerText()).trim() : '';
            const docketText = tds[2] ? (await tds[2].innerText()).trim() : '';
            let docUrl: string | null = null;
            try { const a = await r.$('a'); if (a) { const href = await a.getAttribute('href'); if (href) docUrl = new URL(href, page.url()).toString(); } } catch (e) {}
            out.docketEntries.push({ filingDate, docketType, docketText, documentUrl: docUrl });
            if (/complaint/i.test(docketType) || /complaint/i.test(docketText)) { if (docUrl) out.complaintUrl = docUrl; }
          } catch (e) { continue; }
        }
      }
      const all = await page.$$eval('a[href]', as => as.map(a => (a as HTMLAnchorElement).href)).catch(() => [] as string[]);
      for (const l of all) if (l && l.toLowerCase().includes('.pdf')) out.documentUrls.push(l);
      out.documentUrls = Array.from(new Set(out.documentUrls));
    } catch (e) { paWarn('extractCaseDetailsFromPage failed', e && e.message ? e.message : e); }
    return out;
  }

  async collectAndProcessCases() {
    paLog('collectAndProcessCases starting');
    const details: any[] = [];
    const headless = process.env.PLAYWRIGHT_HEADLESS === 'true';
    const userAgent = process.env.USER_AGENT || 'Mozilla/5.0';
    const startUrl = 'https://dcr.alleghenycounty.us/Civil/LoginSearch.aspx';

    try {
      this.browser = await chromium.launch({ headless, args: ['--no-sandbox'] });
      this.context = await this.browser.newContext({ userAgent, viewport: { width: 1280, height: 900 } });
      const page = await this.context.newPage();
      await this.safeGoto(page, startUrl, {});
      await page.waitForTimeout(400);
      await this.login(page);

      // navigate to Search Case Filings By Date
      try {
        const search = await this.findFirstSelector(page, ['a:has-text("Case Search")', 'a[href*="CaseSearchByCaseNumber"]']); if (search) { try { await page.click(search.sel); await page.waitForTimeout(200); } catch (e) {} }
        const byDate = await this.findFirstSelector(page, ['a:has-text("Search Case Filings By Date")', 'a[href*="CaseSearchByDate"]']); if (byDate) { try { await page.click(byDate.sel); await page.waitForTimeout(200); } catch (e) {} }
        try { await page.click('#reportrange').catch(() => {}); await page.waitForTimeout(120); await page.click('li[data-range-key="Last 30 Days"], li:has-text("Last 30 Days")').catch(() => {}); await page.waitForTimeout(80); } catch (e) {}
        try { await page.selectOption('#ContentPlaceHolder1_drpdwnCourtType', 'MG').catch(() => {}); await page.waitForTimeout(80); } catch (e) {}
        try { await page.selectOption('#ContentPlaceHolder1_drpdwnCaseType', 'MF').catch(() => {}); await page.waitForTimeout(80); } catch (e) {}
        try { await page.click('#ContentPlaceHolder1_btnSearch, input#ContentPlaceHolder1_btnSearch').catch(() => {}); await page.waitForTimeout(250); paLog('search submitted'); } catch (e) { paWarn('search submit failed', e && e.message ? e.message : e); }
      } catch (e) { paWarn('navigation to date search failed', e && e.message ? e.message : e); }

      while (true) {
        let anchors: Array<{ href: string; el: any; text: string; casenumber?: string }> = [];
        try {
          const mgHandles = await page.$$(`#AllRecordsBase tbody tr td:nth-child(2) a[casenumber^=\\"MG-\\"]`);
          if (mgHandles && mgHandles.length > 0) {
            paLog('found MG anchors ->', mgHandles.length);
            for (const h of mgHandles) { try { const href = (await h.getAttribute('href')) || ''; const text = (await h.innerText()) || ''; const cn = (await h.getAttribute('casenumber')) || ''; if (!href) continue; anchors.push({ href: new URL(href, page.url()).toString(), el: h, text: text.trim(), casenumber: cn.trim() }); } catch (e) { continue; } }
          } else {
            const handles = await page.$$('a[href]');
            for (const h of handles) { try { const href = (await h.getAttribute('href')) || ''; const text = (await h.innerText()) || ''; const cn = (await h.getAttribute('casenumber')) || ''; if (!href) continue; const isMG = cn && /^MG-\\\\d+/i.test(cn.trim()); const isCase = isMG || /CaseSearchByCaseNumber|CaseSearchByDate|CaseSearchByCaseNumber/i.test(href) || /^[0-9].*$/i.test(text.trim()); if (isCase) anchors.push({ href: new URL(href, page.url()).toString(), el: h, text: text.trim(), casenumber: cn.trim() }); } catch (e) { continue; } }
            paLog('found generic anchors ->', anchors.length);
          }
        } catch (e) { paWarn('anchor collection failed', e && e.message ? e.message : e); anchors = []; }

        for (const a of anchors) {
          try {
            paLog('opening case link ->', a.casenumber || a.text || a.href);
            let popup: Page | null = null;
            try { const [p] = await Promise.all([ page.waitForEvent('popup', { timeout: 15000 }), a.el.click({ button: 'left' }) ]); popup = p as Page; paLog('popup opened for', a.casenumber || a.href); } catch (err) { paWarn('popup not opened by clicking anchor; skipping', a.href, err && err.message ? err.message : err); popup = null; }
            if (!popup) continue;
            try { await popup.waitForLoadState('networkidle', { timeout: 15000 }); } catch (e) {}
            const item = await this.extractCaseDetailsFromPage(popup);
            item.source = a.href; if (a.casenumber) item.caseNumber = a.casenumber;
            const docket = (item.docketNumber || item.caseNumber || `case-${Date.now()}`).replace(/[\\/:*?\"<>|\\s]/g, '_');
            const caseDir = path.join(this.dataDir, docket); if (!fs.existsSync(caseDir)) fs.mkdirSync(caseDir, { recursive: true }); fs.writeFileSync(path.join(caseDir, 'case_detail.json'), JSON.stringify(item, null, 2), 'utf8');

            if (item.complaintUrl) {
              const pdfPath = path.join(caseDir, `${docket}_complaint.pdf`);
              if (!fs.existsSync(pdfPath)) {
                try { const resp = await axios.get(item.complaintUrl, { responseType: 'arraybuffer', timeout: 120000 }); fs.writeFileSync(pdfPath, resp.data); paLog('downloaded complaint PDF via complaintUrl for', docket); } catch (e) { paWarn('axios complaint download failed', e && e.message ? e.message : e); }
              }
            } else {
              try {
                const rows = await popup.$$('#DocketEntries tbody tr');
                for (const row of rows) {
                  try {
                    const dTypeHandle = await row.$('td:nth-child(2)');
                    const dTypeText = dTypeHandle ? (await dTypeHandle.innerText()).trim() : '';
                    if (/complaint/i.test(dTypeText)) {
                      const anchor = await row.$('a');
                      if (anchor) {
                        try {
                          const [pdfPage] = await Promise.all([ this.context!.waitForEvent('page', { timeout: 15000 }), anchor.click({ button: 'left' }) ]);
                          await pdfPage.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
                          const pdfUrl = pdfPage.url();
                          const pdfPath = path.join(caseDir, `${docket}_complaint.pdf`);
                          try { const resp = await axios.get(pdfUrl, { responseType: 'arraybuffer', timeout: 120000 }); fs.writeFileSync(pdfPath, resp.data); paLog('downloaded complaint PDF for', docket); } catch (e) { paWarn('download from pdfPage failed', e && e.message ? e.message : e); }
                          try { await pdfPage.close(); } catch (e) {}
                        } catch (clickErr) { paWarn('clicking complaint anchor failed', clickErr && clickErr.message ? clickErr.message : clickErr); }
                      }
                      break;
                    }
                  } catch (inner) { continue; }
                }
              } catch (e) { /* ignore */ }
            }

            details.push(item);
            try { await popup.close(); } catch (e) {}
            await page.waitForTimeout(120);
          } catch (e) { paWarn('error processing anchor', a.href, e && e.message ? e.message : e); }
        }

        try { const nextButton = await page.$('a[rel="next"], a.next, button.next, a:has-text("Next")'); if (nextButton) { const clicked = await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle', timeout: 10000 }), nextButton.click()]).then(() => true).catch(() => false); if (clicked) { await page.waitForTimeout(400); continue; } } } catch (e) { paWarn('pagination click failed', e && e.message ? e.message : e); }
        break;
      }

      try { if (page && !(page as any).isClosed?.()) await page.close(); } catch (e) {}
      try { if (this.context) await this.context.close(); } catch (e) {}
      try { if (this.browser) await this.browser.close(); } catch (e) {}
      this.context = null; this.browser = null;
      return details;
    } catch (err) {
      paError('collectAndProcessCases failed', err && err.message ? err.message : err);
      try { if (this.context) await this.context.close(); } catch (e) {}
      try { if (this.browser) await this.browser.close(); } catch (e) {}
      this.context = null; this.browser = null;
      return details;
    }
  }

  async downloadAllComplaintPDFs(details: any[]) { paLog('downloadAllComplaintPDFs (stub)'); }
  async extractAllPDFTexts() { paLog('extractAllPDFTexts (stub)'); }
  async sendWebhooksInBatches() { paLog('sendWebhooksInBatches (stub)'); }

  async enrichAllWithVGSI(details: any[]) { paLog('enrichAllWithVGSI (stub) - enrichment not implemented'); return details; }

  async run() {
    paLog('runner starting');
    const details = await this.collectAndProcessCases();
    const enriched = await this.enrichAllWithVGSI(details || []);
    await this.downloadAllComplaintPDFs(enriched);
    await this.extractAllPDFTexts();
    await this.sendWebhooksInBatches();
    paLog('runner finished');
  }
}
import path from 'path';
import fs from 'fs';
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import LocationPathManager from '../../utils/location_manager';
import processedStore from '../../lib/processed_store';
import axios from 'axios';

const paTimestamp = () => new Date().toISOString();
const paLog = (...args: any[]) => { console.log(`${paTimestamp()} PA:`, ...args); };
const paWarn = (...args: any[]) => { console.warn(`${paTimestamp()} PA:`, ...args); };
const paError = (...args: any[]) => { console.error(`${paTimestamp()} PA:`, ...args); };

export default class PARunnerV1 {
  baseDataDir: string;
  dataDir: string;
  processedPath: string;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private locationManager: LocationPathManager;
  captchaWebhook = process.env.PA_CAPTCHA_WEBHOOK || '';
  useCaptchaWebhook = (process.env.PA_USE_WEBHOOK || 'true') === 'true';

  constructor(locationCode: string = 'PA') {
    this.locationManager = new LocationPathManager(locationCode);
    this.baseDataDir = this.locationManager.getDataDir('Foreclosure');
    this.dataDir = path.join(this.baseDataDir, 'cases');
    this.processedPath = this.locationManager.getProcessedCasesPath('foreclosure');
    if (!fs.existsSync(this.baseDataDir)) fs.mkdirSync(this.baseDataDir, { recursive: true });
    if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
    try { processedStore.init(this.processedPath); } catch (err) { paWarn('processed store init failed', err); }
  }

  private ensurePageOpen(page: Page) { if (!page || (page.isClosed && page.isClosed())) throw new Error('Playwright page is closed'); }

  private async safeGoto(page: Page, url: string, opts: any = {}, retries = 2) {
    for (let i = 0; i <= retries; i++) {
      this.ensurePageOpen(page);
      try { await page.goto(url, { waitUntil: opts.waitUntil || 'networkidle', timeout: opts.timeout || 30000 }); return; } catch (err) { if (i === retries) throw err; await page.waitForTimeout(500 + i * 300); }
    }
  }

  private async findFirstSelector(pageOrElement: Page | any, selectors: string[]) {
    for (const sel of selectors) { try { const el = await pageOrElement.$(sel); if (el) return { el, sel }; } catch (e) {} }
    return null;
  }

  async login(page: Page) {
    paLog('starting login sequence');
    const user = process.env.PA_USER || '';
    const pass = process.env.PA_PASS || '';
    const captchaSelectors = ['img[src*="BotDetect"]', 'img[id*="imgCaptcha"]', 'img[src*="captcha"]'];
    const captchaInputSelectors = ['input[name="captchaText"]', 'input#ctl00_ContentPlaceHolder1_txtCaptcha', 'input[name*="captcha"]', 'input[type="text"]'];

    while (true) {
      try {
        const u = await this.findFirstSelector(page, ['input[name="UserID"]', 'input#ctl00_ContentPlaceHolder1_txtUserID', 'input[type="text"]']);
        const p = await this.findFirstSelector(page, ['input[name="Password"]', 'input#ctl00_ContentPlaceHolder1_txtPassword', 'input[type="password"]']);
        if (u) { try { await u.el.fill(user); } catch (e) {} }
        await page.waitForTimeout(1000);
        if (p) { try { await p.el.fill(pass); } catch (e) {} }
        await page.waitForTimeout(1000);
      } catch (e) { paWarn('fill credentials failed', e); }

      const captchaEl = (await this.findFirstSelector(page, captchaSelectors))?.el;
      if (captchaEl && this.useCaptchaWebhook && this.captchaWebhook) {
        try {
          const raw = await captchaEl.screenshot({ type: 'png' });
          try { fs.writeFileSync(path.join(process.cwd(), 'data', 'PA', 'captcha_last.png'), raw); } catch (e) {}
          await page.waitForTimeout(1000);
          try {
            const b64 = raw.toString('base64');
            const resp = await axios.post(this.captchaWebhook, { image: b64, pageUrl: page.url() }, { timeout: 120000 });
            let solved: string | null = null;
            if (resp && resp.data) {
              if (typeof resp.data === 'string') solved = resp.data;
              else if (typeof resp.data.answer === 'string') solved = resp.data.answer;
              else if (typeof resp.data.text === 'string') solved = resp.data.text;
            }
            if (solved) {
              const captchaInput = (await this.findFirstSelector(page, captchaInputSelectors))?.el;
              if (captchaInput) { try { await captchaInput.fill(String(solved)); } catch (e) {} }
            }
          } catch (err) { paWarn('webhook request failed', err && err.message ? err.message : err); }
        } catch (e) { paWarn('captcha screenshot failed', e && e.message ? e.message : e); }
      }

      try {
        const submitBtn = (await this.findFirstSelector(page, ['#btnLoginClient', 'input#btnLoginClient', 'button:has-text("Login")', 'input[type="submit"]']))?.el;
        if (submitBtn) { try { await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle', timeout: 7000 }), submitBtn.click()]); } catch (e) { paWarn('submit click failed', e && e.message ? e.message : e); } }
        else { try { await page.$eval('form', (f: any) => (f as HTMLFormElement).submit()); } catch (e) {} }
      } catch (e) { paWarn('submit failed', e && e.message ? e.message : e); }

      await page.waitForTimeout(1000);
      try {
        const signed = await page.$('li#liSignedInAsName, li:has-text("Signed in As")');
        if (signed) { paLog('login appears successful'); break; }
        const bodyText = await page.$eval('body', b => (b as HTMLElement).innerText).catch(() => '');
        if (bodyText && (bodyText.indexOf('Last Login DateTime') !== -1 || bodyText.indexOf('PLEASE NOTE') !== -1 || bodyText.indexOf('Signed in As') !== -1)) { paLog('login successful via text fallback'); break; }
      } catch (e) {}

      paLog('login not successful, retrying...');
      await page.waitForTimeout(1000);
    }

    paLog('login() finished');
  }

  private async extractCaseDetailsFromPage(page: Page) {
    const out: any = { docketNumber: null, docketEntries: [], documentUrls: [], complaintUrl: null };
    try {
      const h = await page.$('h1') || await page.$('h2'); if (h) out.docketNumber = (await h.innerText()).trim();
      const table = await page.$('#DocketEntries');
      if (table) {
        const rows = await table.$$('tbody tr');
        for (const r of rows) {
          try {
            const tds = await r.$$('td');
            const filingDate = tds[0] ? (await tds[0].innerText()).trim() : '';
            const docketType = tds[1] ? (await tds[1].innerText()).trim() : '';
            const docketText = tds[2] ? (await tds[2].innerText()).trim() : '';
            let docUrl: string | null = null;
            try { const a = await r.$('a'); if (a) { const href = await a.getAttribute('href'); if (href) docUrl = new URL(href, page.url()).toString(); } } catch (e) {}
            out.docketEntries.push({ filingDate, docketType, docketText, documentUrl: docUrl });
            if (/complaint/i.test(docketType) || /complaint/i.test(docketText)) { if (docUrl) out.complaintUrl = docUrl; }
          } catch (e) { continue; }
        }
      }
      const all = await page.$$eval('a[href]', as => as.map(a => (a as HTMLAnchorElement).href)).catch(() => [] as string[]);
      for (const l of all) if (l && l.toLowerCase().includes('.pdf')) out.documentUrls.push(l);
      out.documentUrls = Array.from(new Set(out.documentUrls));
    } catch (e) { paWarn('extractCaseDetailsFromPage failed', e && e.message ? e.message : e); }
    return out;
  }

  async collectAndProcessCases() {
    paLog('collectAndProcessCases starting');
    const details: any[] = [];
    const headless = process.env.PLAYWRIGHT_HEADLESS === 'true';
    const userAgent = process.env.USER_AGENT || 'Mozilla/5.0';
    const startUrl = 'https://dcr.alleghenycounty.us/Civil/LoginSearch.aspx';

    try {
      this.browser = await chromium.launch({ headless, args: ['--no-sandbox'] });
      this.context = await this.browser.newContext({ userAgent, viewport: { width: 1280, height: 900 } });
      const page = await this.context.newPage();
      await this.safeGoto(page, startUrl, {});
      await page.waitForTimeout(400);
      await this.login(page);

      // navigate to Search Case Filings By Date
      try {
        const search = await this.findFirstSelector(page, ['a:has-text("Case Search")', 'a[href*="CaseSearchByCaseNumber"]']); if (search) { try { await page.click(search.sel); await page.waitForTimeout(200); } catch (e) {} }
        const byDate = await this.findFirstSelector(page, ['a:has-text("Search Case Filings By Date")', 'a[href*="CaseSearchByDate"]']); if (byDate) { try { await page.click(byDate.sel); await page.waitForTimeout(200); } catch (e) {} }
        try { await page.click('#reportrange').catch(() => {}); await page.waitForTimeout(120); await page.click('li[data-range-key="Last 30 Days"], li:has-text("Last 30 Days")').catch(() => {}); await page.waitForTimeout(80); } catch (e) {}
        try { await page.selectOption('#ContentPlaceHolder1_drpdwnCourtType', 'MG').catch(() => {}); await page.waitForTimeout(80); } catch (e) {}
        try { await page.selectOption('#ContentPlaceHolder1_drpdwnCaseType', 'MF').catch(() => {}); await page.waitForTimeout(80); } catch (e) {}
        try { await page.click('#ContentPlaceHolder1_btnSearch, input#ContentPlaceHolder1_btnSearch').catch(() => {}); await page.waitForTimeout(250); paLog('search submitted'); } catch (e) { paWarn('search submit failed', e && e.message ? e.message : e); }
      } catch (e) { paWarn('navigation to date search failed', e && e.message ? e.message : e); }

      while (true) {
        let anchors: Array<{ href: string; el: any; text: string; casenumber?: string }> = [];
        try {
          const mgHandles = await page.$$(`#AllRecordsBase tbody tr td:nth-child(2) a[casenumber^=\\"MG-\\"]`);
          if (mgHandles && mgHandles.length > 0) {
            paLog('found MG anchors ->', mgHandles.length);
            for (const h of mgHandles) { try { const href = (await h.getAttribute('href')) || ''; const text = (await h.innerText()) || ''; const cn = (await h.getAttribute('casenumber')) || ''; if (!href) continue; anchors.push({ href: new URL(href, page.url()).toString(), el: h, text: text.trim(), casenumber: cn.trim() }); } catch (e) { continue; } }
          } else {
            const handles = await page.$$('a[href]');
            for (const h of handles) { try { const href = (await h.getAttribute('href')) || ''; const text = (await h.innerText()) || ''; const cn = (await h.getAttribute('casenumber')) || ''; if (!href) continue; const isMG = cn && /^MG-\\\\d+/i.test(cn.trim()); const isCase = isMG || /CaseSearchByCaseNumber|CaseSearchByDate|CaseSearchByCaseNumber/i.test(href) || /^[0-9].*$/i.test(text.trim()); if (isCase) anchors.push({ href: new URL(href, page.url()).toString(), el: h, text: text.trim(), casenumber: cn.trim() }); } catch (e) { continue; } }
            paLog('found generic anchors ->', anchors.length);
          }
        } catch (e) { paWarn('anchor collection failed', e && e.message ? e.message : e); anchors = []; }

        for (const a of anchors) {
          try {
            paLog('opening case link ->', a.casenumber || a.text || a.href);
            let popup: Page | null = null;
            try { const [p] = await Promise.all([ page.waitForEvent('popup', { timeout: 15000 }), a.el.click({ button: 'left' }) ]); popup = p as Page; paLog('popup opened for', a.casenumber || a.href); } catch (err) { paWarn('popup not opened by clicking anchor; skipping', a.href, err && err.message ? err.message : err); popup = null; }
            if (!popup) continue;
            try { await popup.waitForLoadState('networkidle', { timeout: 15000 }); } catch (e) {}
            const item = await this.extractCaseDetailsFromPage(popup);
            item.source = a.href; if (a.casenumber) item.caseNumber = a.casenumber;
            const docket = (item.docketNumber || item.caseNumber || `case-${Date.now()}`).replace(/[\\/:*?\"<>|\\s]/g, '_');
            const caseDir = path.join(this.dataDir, docket); if (!fs.existsSync(caseDir)) fs.mkdirSync(caseDir, { recursive: true }); fs.writeFileSync(path.join(caseDir, 'case_detail.json'), JSON.stringify(item, null, 2), 'utf8');

            if (item.complaintUrl) {
              const pdfPath = path.join(caseDir, `${docket}_complaint.pdf`);
              if (!fs.existsSync(pdfPath)) {
                try { const resp = await axios.get(item.complaintUrl, { responseType: 'arraybuffer', timeout: 120000 }); fs.writeFileSync(pdfPath, resp.data); paLog('downloaded complaint PDF via complaintUrl for', docket); } catch (e) { paWarn('axios complaint download failed', e && e.message ? e.message : e); }
              }
            } else {
              try {
                const rows = await popup.$$('#DocketEntries tbody tr');
                for (const row of rows) {
                  try {
                    const dTypeHandle = await row.$('td:nth-child(2)');
                    const dTypeText = dTypeHandle ? (await dTypeHandle.innerText()).trim() : '';
                    if (/complaint/i.test(dTypeText)) {
                      const anchor = await row.$('a');
                      if (anchor) {
                        try {
                          const [pdfPage] = await Promise.all([ this.context!.waitForEvent('page', { timeout: 15000 }), anchor.click({ button: 'left' }) ]);
                          await pdfPage.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
                          const pdfUrl = pdfPage.url();
                          const pdfPath = path.join(caseDir, `${docket}_complaint.pdf`);
                          try { const resp = await axios.get(pdfUrl, { responseType: 'arraybuffer', timeout: 120000 }); fs.writeFileSync(pdfPath, resp.data); paLog('downloaded complaint PDF for', docket); } catch (e) { paWarn('download from pdfPage failed', e && e.message ? e.message : e); }
                          try { await pdfPage.close(); } catch (e) {}
                        } catch (clickErr) { paWarn('clicking complaint anchor failed', clickErr && clickErr.message ? clickErr.message : clickErr); }
                      }
                      break;
                    }
                  } catch (inner) { continue; }
                }
              } catch (e) { /* ignore */ }
            }

            details.push(item);
            try { await popup.close(); } catch (e) {}
            await page.waitForTimeout(120);
          } catch (e) { paWarn('error processing anchor', a.href, e && e.message ? e.message : e); }
        }

        try { const nextButton = await page.$('a[rel="next"], a.next, button.next, a:has-text("Next")'); if (nextButton) { const clicked = await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle', timeout: 10000 }), nextButton.click()]).then(() => true).catch(() => false); if (clicked) { await page.waitForTimeout(400); continue; } } } catch (e) { paWarn('pagination click failed', e && e.message ? e.message : e); }
        break;
      }

      try { if (page && !(page as any).isClosed?.()) await page.close(); } catch (e) {}
      try { if (this.context) await this.context.close(); } catch (e) {}
      try { if (this.browser) await this.browser.close(); } catch (e) {}
      this.context = null; this.browser = null;
      return details;
    } catch (err) {
      paError('collectAndProcessCases failed', err && err.message ? err.message : err);
      try { if (this.context) await this.context.close(); } catch (e) {}
      try { if (this.browser) await this.browser.close(); } catch (e) {}
      this.context = null; this.browser = null;
      return details;
    }
  }

  async downloadAllComplaintPDFs(details: any[]) { paLog('downloadAllComplaintPDFs (stub)'); }
  async extractAllPDFTexts() { paLog('extractAllPDFTexts (stub)'); }
  async sendWebhooksInBatches() { paLog('sendWebhooksInBatches (stub)'); }

  async enrichAllWithVGSI(details: any[]) { paLog('enrichAllWithVGSI (stub) - enrichment not implemented'); return details; }

  async run() {
    paLog('runner starting');
    const details = await this.collectAndProcessCases();
    const enriched = await this.enrichAllWithVGSI(details || []);
    await this.downloadAllComplaintPDFs(enriched);
    await this.extractAllPDFTexts();
    await this.sendWebhooksInBatches();
    paLog('runner finished');
  }
}
        } catch (e) { paWarn('anchor collection failed', e && e.message ? e.message : e); anchors = []; }

        for (const a of anchors) {
          try {
            try { if ((page as any).isClosed && (page as any).isClosed()) { paWarn('main page closed during anchor processing'); break; } } catch (e) {}
            paLog('opening case link ->', a.casenumber || a.text || a.href);

            // click and wait for popup
            let popup: Page | null = null;
            try {
              const [p] = await Promise.all([ page.waitForEvent('popup', { timeout: 15000 }), a.el.click({ button: 'left' }) ]);
              popup = p as Page;
              paLog('popup opened for', a.casenumber || a.href);
            } catch (err) {
              paWarn('popup not opened by clicking anchor; skipping', a.href, err && err.message ? err.message : err);
              popup = null;
            }

            if (!popup) continue;
            try { await popup.waitForLoadState('networkidle', { timeout: 15000 }); } catch (e) {}

            const item = await this.extractCaseDetailsFromPage(popup);
            item.source = a.href;
            if (a.casenumber) item.caseNumber = a.casenumber;

            // save case directory and JSON
            try {
              const docket = (item.docketNumber || item.caseNumber || `case-${Date.now()}`).replace(/[\\/:*?"<>|\s]/g, '_');
              const caseDir = path.join(this.dataDir, docket);
              if (!fs.existsSync(caseDir)) fs.mkdirSync(caseDir, { recursive: true });
              const detailPath = path.join(caseDir, 'case_detail.json');
              fs.writeFileSync(detailPath, JSON.stringify(item, null, 2), 'utf8');
              paLog('wrote case_detail.json for', docket);

              // If complaintUrl found in extracted data, attempt to open and download
              if (item.complaintUrl) {
                const pdfPath = path.join(caseDir, `${docket}_complaint.pdf`);
                if (!fs.existsSync(pdfPath)) {
                  try {
                    paLog('attempting axios download for complaintUrl for', docket);
                    const resp = await axios.get(item.complaintUrl, { responseType: 'arraybuffer', timeout: 120000 });
                    fs.writeFileSync(pdfPath, resp.data);
                    paLog('downloaded complaint PDF via complaintUrl for', docket);
                  } catch (dlErr) {
                    paWarn('axios complaint download failed, will try anchor click inside popup', dlErr && dlErr.message ? dlErr.message : dlErr);
                    // try to find complaint row in popup and click anchor to open pdf page
                    try {
                      const rows = await popup.$$('#DocketEntries tbody tr');
                      for (const row of rows) {
                        try {
                          const dTypeHandle = await row.$('td:nth-child(2)');
                          const dTypeText = dTypeHandle ? (await dTypeHandle.innerText()).trim() : '';
                          if (/complaint/i.test(dTypeText)) {
                            const anchor = await row.$('a');
                            if (anchor) {
                              try {
                                paLog('clicking complaint anchor for', docket);
                                const [pdfPage] = await Promise.all([ this.context!.waitForEvent('page', { timeout: 15000 }), anchor.click({ button: 'left' }) ]);
                                await pdfPage.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
                                const pdfUrl = pdfPage.url();
                                paLog('complaint PDF opened at', pdfUrl);
                                try { const resp2 = await axios.get(pdfUrl, { responseType: 'arraybuffer', timeout: 120000 }); fs.writeFileSync(pdfPath, resp2.data); paLog('downloaded complaint PDF for', docket); } catch (e) { paWarn('download from pdfPage failed', e && e.message ? e.message : e); }
                                try { await pdfPage.close(); } catch (e) {}
                              } catch (clickErr) { paWarn('click complaint anchor failed', clickErr && clickErr.message ? clickErr.message : clickErr); }
                            }
                            break;
                          }
                        } catch (inner) { continue; }
                      }
                    } catch (e) { paWarn('error locating complaint anchor inside popup', e && e.message ? e.message : e); }
                  }
                } else { paLog('complaint PDF already exists for', docket); }
              } else {
                // try to find complaint anchor inside popup if complaintUrl wasn't picked up
                try {
                  const rows = await popup.$$('#DocketEntries tbody tr');
                  for (const row of rows) {
                    try {
                      const dTypeHandle = await row.$('td:nth-child(2)');
                      const dTypeText = dTypeHandle ? (await dTypeHandle.innerText()).trim() : '';
                      if (/complaint/i.test(dTypeText)) {
                        const anchor = await row.$('a');
                        if (anchor) {
                          try {
                            paLog('clicking complaint anchor (no complaintUrl) for', item.caseNumber || item.docketNumber || 'unknown');
                            const [pdfPage] = await Promise.all([ this.context!.waitForEvent('page', { timeout: 15000 }), anchor.click({ button: 'left' }) ]);
                            await pdfPage.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
                            const pdfUrl = pdfPage.url();
                            paLog('complaint PDF opened at', pdfUrl);
                            const docket = (item.docketNumber || item.caseNumber || `case-${Date.now()}`).replace(/[\\/:*?"<>|\s]/g, '_');
                            const caseDir = path.join(this.dataDir, docket);
                            const pdfPath = path.join(caseDir, `${docket}_complaint.pdf`);
                            try { const resp2 = await axios.get(pdfUrl, { responseType: 'arraybuffer', timeout: 120000 }); fs.writeFileSync(pdfPath, resp2.data); paLog('downloaded complaint PDF for', docket); } catch (e) { paWarn('download from pdfPage failed', e && e.message ? e.message : e); }
                            try { await pdfPage.close(); } catch (e) {}
                          } catch (clickErr) { paWarn('clicking complaint anchor failed', clickErr && clickErr.message ? clickErr.message : clickErr); }
                        }
                        break;
                      }
                    } catch (inner) { continue; }
                  }
                } catch (e) { /* ignore */ }
              }

            } catch (e) { paWarn('case save or complaint download failed', e && e.message ? e.message : e); }

            details.push(item);
            try { await popup.close(); } catch (e) {}
            await page.waitForTimeout(120);
          } catch (e) { paWarn('error processing anchor', a.href, e && e.message ? e.message : e); }
        }

        // try next page
        try {
          const nextButton = await page.$('a[rel="next"], a.next, button.next, a:has-text("Next")');
          if (nextButton) {
            const clicked = await this.safeClickWithNavigation(page, nextButton, { waitForNavigation: true, timeout: 10000 }, {});
            if (clicked) { await page.waitForTimeout(400); continue; }
          }
        } catch (e) { paWarn('pagination click failed', e && e.message ? e.message : e); }

        break; // exit while
      }

      try { if (page && !(page as any).isClosed?.()) await page.close(); } catch (e) {}
      try { if (this.context) await this.context.close(); } catch (e) {}
      try { if (this.browser) await this.browser.close(); } catch (e) {}
      this.context = null; this.browser = null;
      return details;
    } catch (err) {
      paError('collectAndProcessCases failed', err && err.message ? err.message : err);
      try { if (this.context) await this.context.close(); } catch (e) {}
      try { if (this.browser) await this.browser.close(); } catch (e) {}
      this.context = null; this.browser = null;
      return details;
    }
  }

  async downloadAllComplaintPDFs(details: any[]) { paLog('downloadAllComplaintPDFs (stub)'); }
  async extractAllPDFTexts() { paLog('extractAllPDFTexts (stub)'); }
  async sendWebhooksInBatches() { paLog('sendWebhooksInBatches (stub)'); }

  async run() {
    paLog('runner starting');
    const details = await this.collectAndProcessCases();
    const enriched = await this.enrichAllWithVGSI(details || []);
    await this.downloadAllComplaintPDFs(enriched);
    await this.extractAllPDFTexts();
    await this.sendWebhooksInBatches();
    paLog('runner finished');
  }

  async enrichAllWithVGSI(details: any[]) { paLog('enrichAllWithVGSI (stub) - enrichment not implemented'); return details; }
}
import path from 'path';
import fs from 'fs';
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import LocationPathManager from '../../utils/location_manager';
import processedStore from '../../lib/processed_store';
import axios from 'axios';
import { createCanvas, loadImage } from 'canvas';

// Simple timestamped logger helpers for PA runner
const paTimestamp = () => new Date().toISOString();
const paLog = (...args: any[]) => { console.log(`${paTimestamp()} PA:`, ...args); };
const paWarn = (...args: any[]) => { console.warn(`${paTimestamp()} PA:`, ...args); };
const paError = (...args: any[]) => { console.error(`${paTimestamp()} PA:`, ...args); };

export default class PARunnerV1 {
  baseDataDir: string;
  dataDir: string;
  processedPath: string;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private locationManager: LocationPathManager;
  // webhook to send captcha images for remote solving (optional)
  captchaWebhook = process.env.PA_CAPTCHA_WEBHOOK || '';
  useCaptchaWebhook = (process.env.PA_USE_WEBHOOK || 'true') === 'true';

  constructor(locationCode: string = 'PA') {
    this.locationManager = new LocationPathManager(locationCode);
    this.baseDataDir = this.locationManager.getDataDir('Foreclosure');
    this.dataDir = path.join(this.baseDataDir, 'cases');
    this.processedPath = this.locationManager.getProcessedCasesPath('foreclosure');

    if (!fs.existsSync(this.baseDataDir)) fs.mkdirSync(this.baseDataDir, { recursive: true });
    if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });

    try {
      processedStore.init(this.processedPath);
    } catch (err) {
      paWarn('runner: processed store init failed', err);
    }
  }

  // Helper: ensure page is still open
  private ensurePageOpen(page: Page) {
    if (!page || (page.isClosed && page.isClosed())) {
      throw new Error('Playwright page is closed');
    }
  }

  // Helper: safe goto with retries and larger default timeout
  private async safeGoto(page: Page, url: string, opts: any = {}, retries = 2) {
    for (let i = 0; i <= retries; i++) {
      this.ensurePageOpen(page);
      try {
        await page.goto(url, { waitUntil: opts.waitUntil || 'networkidle', timeout: opts.timeout || 30000 });
        return;
      } catch (err) {
        if (i === retries) throw err;
        await page.waitForTimeout(500 + i * 300);
      }
    }
  }

  // Helper: click with optional navigation wait and tolerance for timeouts
  private async safeClickWithNavigation(page: Page, el: any, navOptions: any = {}, clickOptions: any = {}) {
    this.ensurePageOpen(page);
    try {
      if (navOptions.waitForNavigation) {
        try {
          await Promise.all([page.waitForNavigation({ waitUntil: navOptions.waitUntil || 'networkidle', timeout: navOptions.timeout || 5000 }), el.click(clickOptions)]);
          return true;
        } catch (e) {
          // navigation may not happen (AJAX) — ignore and return false
          try { await page.waitForTimeout(120); } catch (e2) {}
          return false;
        }
      } else {
        await el.click(clickOptions);
        return true;
      }
    } catch (err) {
      // element may be detached or page closed — rethrow if page closed
      if (page.isClosed && page.isClosed()) throw err;
      return false;
    }
  }

  // Main: paginate result pages, click MG- case links, extract popup data, click complaint and download PDF
  async collectAndProcessCases() {
    paLog('collectAndProcessCases starting');
    const details: any[] = [];
    const headless = process.env.PLAYWRIGHT_HEADLESS === 'true';
    const userAgent = process.env.USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36';
    const startUrl = 'https://dcr.alleghenycounty.us/Civil/LoginSearch.aspx';

    try {
      this.browser = await chromium.launch({ headless, args: ['--no-sandbox'] });
      this.context = await this.browser.newContext({ userAgent, viewport: { width: 1280, height: 900 } });

      const page = await this.context.newPage();
      await this.safeGoto(page, startUrl, {});
      await page.waitForTimeout(400);

      // login
      try { await this.login(page); } catch (e) { paWarn('login failed during collect/process', e && e.message ? e.message : e); }

      // navigation to search by date (reuse selectors)
      try {
        const searchDropdown = await this.findFirstSelector(page, ['a.dropdown-toggle:has-text("Search")', 'a:has-text("Search")']);
        if (searchDropdown) { try { await page.click(searchDropdown.sel); await page.waitForTimeout(120); paLog('opened Search dropdown'); } catch (e) {} }
        const cs = await this.findFirstSelector(page, ['a:has-text("Case Search")', 'a[href*="CaseSearchByCaseNumber"]']); if (cs) { try { await page.click(cs.sel); await page.waitForTimeout(200); paLog('clicked Case Search'); } catch (e) {} }
        const byDate = await this.findFirstSelector(page, ['a:has-text("Search Case Filings By Date")', 'a[href*="CaseSearchByDate"]']); if (byDate) { try { await page.click(byDate.sel); await page.waitForTimeout(200); paLog('clicked Search Case Filings By Date'); } catch (e) {} }

        // date range and filters
        try { await page.click('#reportrange').catch(() => {}); await page.waitForTimeout(120); await page.click('li[data-range-key="Last 30 Days"], li:has-text("Last 30 Days")').catch(() => {}); await page.waitForTimeout(80); } catch (e) {}
        try { await page.selectOption('#ContentPlaceHolder1_drpdwnCourtType', 'MG').catch(() => {}); await page.waitForTimeout(80); } catch (e) {}
        try { await page.selectOption('#ContentPlaceHolder1_drpdwnCaseType', 'MF').catch(() => {}); await page.waitForTimeout(80); } catch (e) {}
        try { await page.click('#ContentPlaceHolder1_btnSearch, input#ContentPlaceHolder1_btnSearch').catch(() => {}); await page.waitForTimeout(250); paLog('search submitted'); } catch (e) { paWarn('search submit failed', e && e.message ? e.message : e); }
      } catch (e) { paWarn('navigation to date search failed', e && e.message ? e.message : e); }

      // iterate pages
      while (true) {
        // prefer MG anchors in results table
        let anchors: Array<{ href: string; el: any; text: string; casenumber?: string }> = [];
        try {
          const mgHandles = await page.$$(`#AllRecordsBase tbody tr td:nth-child(2) a[casenumber^="MG-"]`);
          if (mgHandles && mgHandles.length > 0) {
            paLog('found MG anchors ->', mgHandles.length);
            for (const h of mgHandles) {
              try { const href = (await h.getAttribute('href')) || ''; const text = (await h.innerText()) || ''; const cn = (await h.getAttribute('casenumber')) || ''; if (!href) continue; anchors.push({ href: new URL(href, page.url()).toString(), el: h, text: text.trim(), casenumber: cn.trim() }); } catch (e) { continue; }
            }
          } else {
            const handles = await page.$$('a[href]');
            for (const h of handles) {
              try { const href = (await h.getAttribute('href')) || ''; const text = (await h.innerText()) || ''; const cn = (await h.getAttribute('casenumber')) || ''; if (!href) continue; const isMG = cn && /^MG-\d+/i.test(cn.trim()); const isCase = isMG || /CaseSearchByCaseNumber|CaseSearchByDate|CaseSearchByCaseNumber/i.test(href) || /^[0-9].*$/i.test(text.trim()); if (isCase) anchors.push({ href: new URL(href, page.url()).toString(), el: h, text: text.trim(), casenumber: cn.trim() }); } catch (e) { continue; }
            }
            paLog('found generic anchors ->', anchors.length);
          }
        } catch (e) { paWarn('anchor collection failed', e && e.message ? e.message : e); anchors = []; }

        for (const a of anchors) {
          try {
            try { if ((page as any).isClosed && (page as any).isClosed()) { paWarn('main page closed during anchor processing'); break; } } catch (e) {}
            paLog('opening case link ->', a.casenumber || a.text || a.href);

            // click and wait for popup
            let popup: Page | null = null;
            try {
              const [p] = await Promise.all([ page.waitForEvent('popup', { timeout: 15000 }), a.el.click({ button: 'left' }) ]);
              popup = p as Page;
              paLog('popup opened for', a.casenumber || a.href);
            } catch (err) {
              paWarn('popup not opened by clicking anchor; skipping', a.href, err && err.message ? err.message : err);
              popup = null;
            }

            if (!popup) continue;
            try { await popup.waitForLoadState('networkidle', { timeout: 15000 }); } catch (e) {}

            const item = await this.extractCaseDetailsFromPage(popup);
            item.source = a.href;
            if (a.casenumber) item.caseNumber = a.casenumber;

            // save case directory and JSON
            try {
              const docket = (item.docketNumber || item.caseNumber || `case-${Date.now()}`).replace(/[\\/:*?"<>|\s]/g, '_');
              const caseDir = path.join(this.dataDir, docket);
              if (!fs.existsSync(caseDir)) fs.mkdirSync(caseDir, { recursive: true });
              const detailPath = path.join(caseDir, 'case_detail.json');
              fs.writeFileSync(detailPath, JSON.stringify(item, null, 2), 'utf8');
              paLog('wrote case_detail.json for', docket);

              // If complaintUrl found in extracted data, attempt to open and download
              if (item.complaintUrl) {
                const pdfPath = path.join(caseDir, `${docket}_complaint.pdf`);
                if (!fs.existsSync(pdfPath)) {
                  try {
                    paLog('attempting axios download for complaintUrl for', docket);
                    const resp = await axios.get(item.complaintUrl, { responseType: 'arraybuffer', timeout: 120000 });
                    fs.writeFileSync(pdfPath, resp.data);
                    paLog('downloaded complaint PDF via complaintUrl for', docket);
                  } catch (dlErr) {
                    paWarn('axios complaint download failed, will try anchor click inside popup', dlErr && dlErr.message ? dlErr.message : dlErr);
                    // try to find complaint row in popup and click anchor to open pdf page
                    try {
                      const rows = await popup.$$('#DocketEntries tbody tr');
                      for (const row of rows) {
                        try {
                          const dTypeHandle = await row.$('td:nth-child(2)');
                          const dTypeText = dTypeHandle ? (await dTypeHandle.innerText()).trim() : '';
                          if (/complaint/i.test(dTypeText)) {
                            const anchor = await row.$('a');
                            if (anchor) {
                              try {
                                paLog('clicking complaint anchor for', docket);
                                const [pdfPage] = await Promise.all([ this.context!.waitForEvent('page', { timeout: 15000 }), anchor.click({ button: 'left' }) ]);
                                await pdfPage.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
                                const pdfUrl = pdfPage.url();
                                paLog('complaint PDF opened at', pdfUrl);
                                try { const resp2 = await axios.get(pdfUrl, { responseType: 'arraybuffer', timeout: 120000 }); fs.writeFileSync(pdfPath, resp2.data); paLog('downloaded complaint PDF for', docket); } catch (e) { paWarn('download from pdfPage failed', e && e.message ? e.message : e); }
                                try { await pdfPage.close(); } catch (e) {}
                              } catch (clickErr) { paWarn('click complaint anchor failed', clickErr && clickErr.message ? clickErr.message : clickErr); }
                            }
                            break;
                          }
                        } catch (inner) { continue; }
                      }
                    } catch (e) { paWarn('error locating complaint anchor inside popup', e && e.message ? e.message : e); }
                  }
                } else { paLog('complaint PDF already exists for', docket); }
              } else {
                // try to find complaint anchor inside popup if complaintUrl wasn't picked up
                try {
                  const rows = await popup.$$('#DocketEntries tbody tr');
                  for (const row of rows) {
                    try {
                      const dTypeHandle = await row.$('td:nth-child(2)');
                      const dTypeText = dTypeHandle ? (await dTypeHandle.innerText()).trim() : '';
                      if (/complaint/i.test(dTypeText)) {
                        const anchor = await row.$('a');
                        if (anchor) {
                          try {
                            paLog('clicking complaint anchor (no complaintUrl) for', item.caseNumber || item.docketNumber || 'unknown');
                            const [pdfPage] = await Promise.all([ this.context!.waitForEvent('page', { timeout: 15000 }), anchor.click({ button: 'left' }) ]);
                            await pdfPage.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
                            const pdfUrl = pdfPage.url();
                            paLog('complaint PDF opened at', pdfUrl);
                            const docket = (item.docketNumber || item.caseNumber || `case-${Date.now()}`).replace(/[\\/:*?"<>|\s]/g, '_');
                            const caseDir = path.join(this.dataDir, docket);
                            const pdfPath = path.join(caseDir, `${docket}_complaint.pdf`);
                            try { const resp2 = await axios.get(pdfUrl, { responseType: 'arraybuffer', timeout: 120000 }); fs.writeFileSync(pdfPath, resp2.data); paLog('downloaded complaint PDF for', docket); } catch (e) { paWarn('download from pdfPage failed', e && e.message ? e.message : e); }
                            try { await pdfPage.close(); } catch (e) {}
                          } catch (clickErr) { paWarn('clicking complaint anchor failed', clickErr && clickErr.message ? clickErr.message : clickErr); }
                        }
                        break;
                      }
                    } catch (inner) { continue; }
                  }
                } catch (e) { /* ignore */ }
              }

            } catch (e) { paWarn('case save or complaint download failed', e && e.message ? e.message : e); }

            details.push(item);
            try { await popup.close(); } catch (e) {}
            await page.waitForTimeout(120);
          } catch (e) { paWarn('error processing anchor', a.href, e && e.message ? e.message : e); }
        }

        // try next page
        try {
          const nextButton = await page.$('a[rel="next"], a.next, button.next, a:has-text("Next")');
          if (nextButton) {
            const clicked = await this.safeClickWithNavigation(page, nextButton, { waitForNavigation: true, timeout: 10000 }, {});
            if (clicked) { await page.waitForTimeout(400); continue; }
          }
        } catch (e) { paWarn('pagination click failed', e && e.message ? e.message : e); }

        break; // exit while
      }

      try { if (page && !(page as any).isClosed?.()) await page.close(); } catch (e) {}
      try { if (this.context) await this.context.close(); } catch (e) {}
      try { if (this.browser) await this.browser.close(); } catch (e) {}
      this.context = null; this.browser = null;
      return details;
    } catch (err) {
      paError('collectAndProcessCases failed', err && err.message ? err.message : err);
      try { if (this.context) await this.context.close(); } catch (e) {}
      try { if (this.browser) await this.browser.close(); } catch (e) {}
      this.context = null; this.browser = null;
      return details;
    }
  }

      // load cookies if present
      const cookiePath = path.join(this.locationManager.getBaseDataDir(), 'session_cookies.json');
      if (fs.existsSync(cookiePath)) {
        try {
          const saved = JSON.parse(fs.readFileSync(cookiePath, 'utf8'));
          const toAdd = saved.map((c: any) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path || '/', httpOnly: !!c.httpOnly, secure: !!c.secure, expires: c.expirationDate ? Math.floor(c.expirationDate) : undefined }));
          await this.context.addCookies(toAdd);
          paLog('loaded session cookies from', cookiePath);
          } catch (e) { paWarn('failed loading session cookies', e.message || e); }
      }

      const page = await this.context.newPage();
      await this.safeGoto(page, startUrl, {});
      await page.waitForTimeout(250);

      // ensure login
      try { await this.login(page); paLog('login completed, proceeding with search/navigation'); } catch (e) { paWarn('login during collect/process failed', e.message || e); }

      // If the original page was closed (for example by manual action), abort collection
      if ((page as any).isClosed && (page as any).isClosed()) {
        paWarn('page closed after login; aborting collectAndProcessCases to avoid operating on closed page');
        try { if (this.context) await this.context.close(); } catch (e) {}
        try { if (this.browser) await this.browser.close(); } catch (e) {}
        this.context = null; this.browser = null;
        return details;
      }

      // navigate to Search By Date (reuse existing navigation logic)
      paLog('post-login: beginning navigation to Case Search (robust)');
      try {
        // ensure Search dropdown is opened if present (some UI nests Case Search under Search)
        const searchDropdown = await this.findFirstSelector(page, [
          'a.dropdown-toggle:has-text("Search")',
          'a.dropdown-toggle:has-text("Search ")',
          'a.dropdown-toggle',
          'a:has-text("Search")'
        ]);
        if (searchDropdown) {
          try {
            await page.waitForTimeout(120);
            await page.click(searchDropdown.sel);
            paLog('post-login: opened Search dropdown via selector', searchDropdown.sel);
            await page.waitForTimeout(120);
          } catch (e) {
            paWarn('post-login: opening Search dropdown failed, will continue', e.message || e);
          }
        }

        // click Case Search (prefer page.click with waitForSelector to avoid detached handles)
        const caseSearchSel = ['a:has-text("Case Search")', 'a[href*="CaseSearchByCaseNumber"]', 'a[href*="CaseSearch"]'];
        let caseSearchFound = null;
        for (const s of caseSearchSel) {
          try {
            await page.waitForSelector(s, { state: 'visible', timeout: 3000 }).then(() => { caseSearchFound = s; }).catch(() => {});
            if (caseSearchFound) break;
          } catch (e) {}
        }
        paLog('post-login: caseSearch found selector=', caseSearchFound);
        if (caseSearchFound) {
          try {
            await page.click(caseSearchFound);
            paLog('post-login: clicked Case Search via page.click');
            await page.waitForTimeout(500);
          } catch (e) { paWarn('post-login: click Case Search failed', e.message || e); }
        }

        // find and click Search Case Filings By Date
        const byDateSelCandidates = ['a:has-text("Search Case Filings By Date")', 'a[title="Search By Date"]', 'a[href*="CaseSearchByDate"]'];
        let byDateFound = null;
        for (const s of byDateSelCandidates) {
          try {
            await page.waitForSelector(s, { state: 'visible', timeout: 2000 }).then(() => { byDateFound = s; }).catch(() => {});
            if (byDateFound) break;
          } catch (e) {}
        }
        paLog('post-login: byDateLink found=', !!byDateFound, 'sel=', byDateFound);
        if (byDateFound) {
          try { await page.click(byDateFound); paLog('post-login: clicked Search Case Filings By Date'); await page.waitForTimeout(400); } catch (e) { paWarn('post-login: click Search By Date failed', e.message || e); }
        }

        // apply last 30 days and filters using resilient clicks (re-query selectors)
        try {
          try {
            await page.waitForSelector('#reportrange', { state: 'visible', timeout: 3000 });
            try { await page.click('#reportrange'); paLog('post-login: clicked reportrange'); } catch (clickErr) { paWarn('post-login: clicking reportrange failed', clickErr.message || clickErr); }
          } catch (e) {
            paLog('post-login: reportrange not visible after wait');
          }

          // last 30
          try {
            await page.waitForSelector('li[data-range-key="Last 30 Days"], li:has-text("Last 30 Days")', { state: 'visible', timeout: 2000 });
            await page.click('li[data-range-key="Last 30 Days"], li:has-text("Last 30 Days")');
            paLog('post-login: clicked Last 30 Days');
          } catch (e) {
            paLog('post-login: Last 30 Days option not visible or click failed', e.message || e);
          }

          // Apply
          try {
            await page.waitForSelector('.ranges .applyBtn, button.applyBtn:has-text("Apply"), button.applyBtn', { state: 'visible', timeout: 2000 });
            await page.click('.ranges .applyBtn, button.applyBtn:has-text("Apply"), button.applyBtn');
            paLog('post-login: clicked Apply');
          } catch (e) {
            paLog('post-login: Apply button not visible or click failed', e.message || e);
          }

          try { await page.selectOption('#ContentPlaceHolder1_drpdwnCourtType', 'MG'); paLog('post-login: selected CourtType MG'); } catch (e) { paWarn('post-login: select CourtType failed', e.message || e); }
          try { await page.selectOption('#ContentPlaceHolder1_drpdwnCaseType', 'MF'); paLog('post-login: selected CaseType MF'); } catch (e) { paWarn('post-login: select CaseType failed', e.message || e); }

          // click Search submit
          try {
            await page.waitForSelector('#ContentPlaceHolder1_btnSearch, input#ContentPlaceHolder1_btnSearch, input[value*="Search"]', { state: 'visible', timeout: 3000 });
            await page.click('#ContentPlaceHolder1_btnSearch, input#ContentPlaceHolder1_btnSearch, input[value*="Search"]');
            paLog('post-login: clicked search submit');
            await page.waitForTimeout(250);
          } catch (e) { paWarn('post-login: clicking search submit failed', e.message || e); }
        } catch (e) { paWarn('search-by-date steps failed', e.message || e); }
      } catch (e) {
        paWarn('navigation to date search failed', e.message || e);
      }

      // Iterate through result pages
      let pageIndex = 0;
      while (true) {
        pageIndex++;
        // Prefer explicit MG case anchors in the results table (column 2), then
        // fall back to a more generic anchor discovery. Capture `casenumber`.
        let anchors: Array<{ href: string; el: any; text: string; casenumber?: string }> = [];
        try {
          const mgHandles = await page.$$(`#AllRecordsBase tbody tr td:nth-child(2) a[casenumber^="MG-"]`);
          if (mgHandles && mgHandles.length > 0) {
            paLog('found MG anchors in results table ->', mgHandles.length);
            for (const h of mgHandles) {
              try {
                const href = (await h.getAttribute('href')) || '';
                const text = (await h.innerText()) || '';
                const casenumber = (await h.getAttribute('casenumber')) || '';
                if (!href) continue;
                anchors.push({ href: new URL(href, page.url()).toString(), el: h, text: text.trim(), casenumber: casenumber.trim() });
              } catch (e) { continue; }
            }
          } else {
            // fallback generic discovery
            const handles = await page.$$('a[href]');
            for (const h of handles) {
              try {
                const href = (await h.getAttribute('href')) || '';
                const text = (await h.innerText()) || '';
                const casenumber = (await h.getAttribute('casenumber')) || '';
                if (!href) continue;
                const isMG = casenumber && /^MG-\d+/i.test(casenumber.trim());
                const isCaseLink = isMG || /Case|Docket|ViewCase|CaseInfo|View\/Case|CaseSearchByCaseNumber|\/Civil\/View\/Case/i.test(href) || /^[0-9].*$/i.test(text.trim());
                if (isCaseLink) anchors.push({ href: new URL(href, page.url()).toString(), el: h, text: text.trim(), casenumber: casenumber.trim() });
              } catch (e) { continue; }
            }
            paLog('found generic anchors in page ->', anchors.length);
          }
        } catch (e) { anchors = []; paWarn('anchor collection failed', e && e.message ? e.message : e); }

        // process anchors sequentially
        for (const a of anchors) {
          try {
            // defensive abort if main page was closed by user
            try { if ((page as any).isClosed && (page as any).isClosed()) { paWarn('main page closed during anchor processing; aborting'); break; } } catch (e) {}
            paLog('opening case link ->', a.casenumber || a.text || a.href);

            // Try to open the case by clicking the link so the site opens a popup.
            // Do NOT open a new context page as fallback — the click must trigger the popup.
            let popup: Page | null = null;

            // Attempt sequence:
            // 1) scrollIntoView + element.click with popup wait (longer timeout)
            // 2) retry: dispatch click via DOM (evaluate) and wait for popup
            // 3) retry: mouse click at element bounding box and wait for popup
            const tryClickOpenPopup = async () => {
              // attempt 1
              try {
                try { await a.el.scrollIntoViewIfNeeded(); } catch (e) {}
                await a.el.hover().catch(() => {});
                const [p] = await Promise.all([
                  page.waitForEvent('popup', { timeout: 15000 }),
                  a.el.click({ button: 'left' })
                ]);
                paLog('popup opened by element.click (attempt 1) for', a.casenumber || a.href);
                return p as Page;
              } catch (err1) {
                paWarn('first click attempt did not open popup for', a.casenumber || a.href, (err1 && err1.message) ? err1.message : err1);
                // attempt 2: dispatch click via evaluate (invoke DOM click)
                try {
                  await page.waitForTimeout(200);
                  const [p2] = await Promise.all([
                    page.waitForEvent('popup', { timeout: 8000 }),
                    page.evaluate((el: HTMLElement) => { try { el.click(); } catch (e) {} }, a.el)
                  ]);
                  paLog('popup opened by evaluate click (attempt 2) for', a.casenumber || a.href);
                  return p2 as Page;
                } catch (err2) {
                  paWarn('second (evaluate) click attempt failed for', a.casenumber || a.href, (err2 && err2.message) ? err2.message : err2);
                  // attempt 3: mouse click on center of element
                  try {
                    const box = await a.el.boundingBox();
                    if (box) {
                      const x = box.x + box.width / 2;
                      const y = box.y + box.height / 2;
                      const [p3] = await Promise.all([
                        page.waitForEvent('popup', { timeout: 8000 }),
                        page.mouse.click(x, y)
                      ]);
                      paLog('popup opened by mouse.click (attempt 3) for', a.casenumber || a.href);
                      return p3 as Page;
                    }
                  } catch (err3) {
                    paWarn('third (mouse) click attempt failed for', a.casenumber || a.href, (err3 && err3.message) ? err3.message : err3);
                  }
                }
              }
              return null;
            };

            try {
              popup = await tryClickOpenPopup();
            } catch (e) {
              paWarn('error during click attempts for', a.casenumber || a.href, e && e.message ? e.message : e);
              popup = null;
            }

            if (!popup) {
              paWarn('popup not opened by clicking anchor; skipping', a.href);
              continue;
            }

            try { await popup.waitForLoadState('networkidle', { timeout: 15000 }); } catch (e) {}

            const item = await this.extractCaseDetailsFromPage(popup);
            item.source = a.href;
            if (a.casenumber) item.caseNumber = a.casenumber;
            details.push(item);

            try { await popup.close(); } catch (e) {}
            // small delay between case processing
            await page.waitForTimeout(120);
          } catch (e) {
            paWarn('error processing anchor', a.href, e.message || e);
          }
        }

        // try pagination next
        const nextButton = await page.$('a[rel="next"], a.next, button.next, a:has-text("Next"), button:has-text("Next")');
        if (nextButton) {
          try {
            const clicked = await this.safeClickWithNavigation(page, nextButton, { waitForNavigation: true, timeout: 10000 }, {});
            if (clicked) { await page.waitForTimeout(250); continue; }
            else { break; }
          } catch (e) { break; }
        }

        break;
      }

      // close page/context/browser
      try { if (page && !(page as any).isClosed?.()) await page.close(); } catch (e) {}
      try { if (this.context) await this.context.close(); } catch (e) {}
      try { if (this.browser) await this.browser.close(); } catch (e) {}
      this.context = null; this.browser = null;
      return details;
    } catch (err) {
      paError('collectAndProcessCases failed', err);
      try { if (this.context) await this.context.close(); } catch (e) {}
      try { if (this.browser) await this.browser.close(); } catch (e) {}
      this.context = null; this.browser = null;
      return details;
    }
  }

  // Helper: extract structured data from an opened case page (popup)
  private async extractCaseDetailsFromPage(page: Page) {
    const out: any = { docketNumber: null, parties: [], lastActionDate: null, docketEntries: [], documentUrls: [] };
    try {
      // try common selectors for docket/case number
      const possible = await page.$$eval('h1,h2,h3,span,div', els => els.map(e => ({ tag: e.tagName, text: (e as HTMLElement).innerText }))).catch(() => [] as any[]);
      // look for text patterns like 'Docket' or 'Case'
      for (const p of possible) {
        if (!out.docketNumber && /Docket|Case Number|Case No|Docket No/i.test(p.text || '')) {
          const m = (p.text || '').match(/(Docket|Case Number|Case No|Docket No)[:\s]*([^\n\r]+)/i);
          if (m && m[2]) { out.docketNumber = m[2].trim(); break; }
        }
      }

      // fallback: first large heading
      if (!out.docketNumber) {
        try {
          const h = await page.$('h1') || await page.$('h2');
          if (h) out.docketNumber = (await h.innerText()).trim();
        } catch (e) {}
      }

      // Parties: look for table rows or labels
      try {
        const partyEls = await page.$$eval('table tr, .party, .parties, #Parties tr', rows => rows.map(r => ({ text: (r as HTMLElement).innerText }))).catch(() => [] as any[]);
        for (const r of partyEls) {
          const t = (r.text || '').trim();
          if (t && /Plaintiff|Defendant|Mortgage|Estate|vs\.|v\.|VS\.|VS/i.test(t)) out.parties.push(t);
        }
      } catch (e) {}

      // Docket entries: find tables with Date/Description or links to documents
      try {
        const tables = await page.$$('table');
        for (const tbl of tables) {
          try {
            const headers = await tbl.$$eval('th', ths => ths.map(t => (t as HTMLElement).innerText.toLowerCase()));
            if (headers && (headers.join(' ').includes('date') && headers.join(' ').includes('description') || headers.join(' ').includes('docket')) ) {
              const rows = await tbl.$$('tr');
              for (const r of rows) {
                try {
                  const cols = await r.$$eval('td', tds => tds.map(td => (td as HTMLElement).innerText.trim()));
                  const links = await r.$$eval('a[href]', as => as.map(a => (a as HTMLAnchorElement).href));
                  if (cols && cols.length > 0 && (cols.join(' ').trim() !== '')) {
                    out.docketEntries.push({ raw: cols.join(' | '), links });
                    for (const L of links) {
                      try {
                        if (L && (/\.pdf$|Document|ViewDocument|\/Document/i.test(L) || L.toLowerCase().includes('.pdf'))) out.documentUrls.push(L);
                      } catch (e) { if (L && L.toLowerCase().includes('.pdf')) out.documentUrls.push(L); }
                    }
                  }
                } catch (e) { continue; }
              }
            }
          } catch (e) { continue; }
        }
      } catch (e) {}

      // last action/date: search for dates on page
      try {
        const bodyText = await page.$eval('body', b => (b as HTMLElement).innerText).catch(() => '');
        const dateMatch = bodyText.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
        if (dateMatch) out.lastActionDate = dateMatch[1];
      } catch (e) {}

      // document links fallback: any anchors with pdf
      try {
        const allLinks = await page.$$eval('a[href]', as => as.map(a => (a as HTMLAnchorElement).href));
        for (const l of allLinks) {
          if (l && l.toLowerCase().includes('.pdf')) out.documentUrls.push(l);
        }
      } catch (e) {}

      // dedupe arrays
      out.parties = Array.from(new Set(out.parties)).slice(0, 20);
      out.documentUrls = Array.from(new Set(out.documentUrls));
      out.docketEntries = out.docketEntries.slice(0, 500);

    } catch (e) {
      paWarn('extractCaseDetailsFromPage failed', e.message || e);
    }
    return out;
  }

  // FASE 3 - enrich with VGSI (addresses -> geocoding)
  async enrichAllWithVGSI(details: any[]) {
    paLog('enrichAllWithVGSI (stub) - enrichmentUrl=', this.enrichmentUrl);
    // Basic placeholder: log and return details. Real implementation should query
    // `this.enrichmentUrl` (or its API) to enrich address -> VGSI data.
    try {
      // Example request to check connectivity (not used for mapping yet)
      await axios.get(this.enrichmentUrl, { timeout: 5000 });
    } catch (err) {
      paWarn('enrichment site unreachable (ok for stub)', err.message || err);
    }
    return details;
  }

  // Helper: find first existing selector from candidates on a page or element
  private async findFirstSelector(pageOrElement: Page | any, selectors: string[]) {
    for (const sel of selectors) {
      try {
        const el = await pageOrElement.$(sel);
        if (el) return { el, sel };
      } catch (e) {
        // ignore
      }
    }
    return null;
  }

  // Extract a usable captcha/text solution from a webhook response object
  private extractSolution(respData: any): string | null {
    if (!respData) return null;
    if (typeof respData === 'string') return respData;
    // common direct fields
    if (typeof respData.content === 'string') return respData.content;
    if (typeof respData.answer === 'string') return respData.answer;
    if (typeof respData.text === 'string') return respData.text;
    if (typeof respData.captcha === 'string') return respData.captcha;
    if (typeof respData.solution === 'string') return respData.solution;
    if (typeof respData.result === 'string') return respData.result;

    // nested structures like { parts: [ { text: '...' } ] }
    try {
      if (respData.parts && Array.isArray(respData.parts) && respData.parts[0] && typeof respData.parts[0].text === 'string') return respData.parts[0].text;
      if (respData.content && respData.content.parts && Array.isArray(respData.content.parts) && respData.content.parts[0] && typeof respData.content.parts[0].text === 'string') return respData.content.parts[0].text;
      if (respData.data && typeof respData.data === 'string') return respData.data;
      if (respData.data && respData.data.ParsedResults && Array.isArray(respData.data.ParsedResults) && respData.data.ParsedResults[0] && respData.data.ParsedResults[0].ParsedText) return respData.data.ParsedResults[0].ParsedText;
    } catch (e) {
      // ignore
    }

    return null;
  }

  // Perform login: click login link, fill credentials, capture captcha, send to webhook and wait response
  async login(page: Page) {
    paLog('starting login sequence');
    const headless = process.env.PLAYWRIGHT_HEADLESS ? process.env.PLAYWRIGHT_HEADLESS === 'true' : false;

    // Click 'Click Here To Login' if present
    const clickHere = await page.$('text=Click Here To Login');
    if (clickHere) {
      try {
        try { await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle', timeout: 5000 }), clickHere.click()]); } catch (e) { await page.waitForTimeout(300); }
      } catch (e) {
        // ignore navigation timeout
      }
    }

    // Fixar viewport para evitar redimensionamentos inesperados
    try { await page.setViewportSize({ width: 1280, height: 900 }); } catch (e) { }

    // Wait for login form
    await page.waitForTimeout(250);

    // localizar o container do formulário de login para limitar capturas a essa área
    const formSelectors = ['form#ctl00', 'form[name="aspnetForm"]', 'form[action*="Login"]', 'form'];
    let formSel = await this.findFirstSelector(page, formSelectors);
    let formHandle: any = formSel ? formSel.el : page;

    const user = process.env.PA_USER || 'arthuragrelli';
    const pass = process.env.PA_PASS || 'Vicing@1221';

    // Fill user and pass using candidate selectors
    const userSel = await this.findFirstSelector(page, ['input[name="UserID"]', 'input[name="User ID"]', 'input#ctl00_ContentPlaceHolder1_txtUserID', 'input[type="text"]']);
    const passSel = await this.findFirstSelector(page, ['input[name="Password"]', 'input#ctl00_ContentPlaceHolder1_txtPassword', 'input[type="password"]']);

    if (userSel) {
      await userSel.el.fill(user);
    }
    if (passSel) {
      await passSel.el.fill(pass);
    }

    // Attempt loop: enforce strict ordered steps and retry indefinitely
    // Loop semantics (user requested "SEM LIMITES"):
    // 1) fill username
    // 2) fill password
    // 3) screenshot captcha (login form scope)
    // 4) send to webhook and await reply (if enabled)
    // 5) if webhook returns solution type it; else try local OCR; else manual (visible)
    // 6) submit and if still on login page restart from step 1
    let attempt = 0;

    // helper: OCR a buffer using tesseract.js
    const ocrBuffer = async (buffer: Buffer) => {
      try {
        const recognizeFn = (Tesseract as any).recognize;
        if (recognizeFn && typeof recognizeFn === 'function') {
          const res = await recognizeFn(buffer, 'eng', { logger: (m: any) => {} });
          return res && res.data ? String(res.data.text || '').trim() : null;
        }
        const createWorkerFn = (Tesseract as any).createWorker || (Tesseract as any).default?.createWorker;
        if (createWorkerFn) {
          const worker = createWorkerFn({ logger: () => {} });
          if (worker && typeof worker.load === 'function') {
            await worker.load();
            await worker.loadLanguage('eng');
            await worker.initialize('eng');
            await worker.setParameters({ tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', tessedit_pageseg_mode: '7' } as any);
            const { data } = await worker.recognize(buffer);
            await worker.terminate();
            return data && data.text ? String(data.text).trim() : null;
          }
        }
      } catch (err) {
        // ignore and return null
      }
      return null;
    };

    // preprocess captcha image: grayscale + simple threshold to improve OCR/webhook recognition
    const preprocessCaptcha = async (buffer: Buffer) => {
      try {
        const img = await loadImage(buffer);
        const w = img.width;
        const h = img.height;
        const canvas = createCanvas(w, h);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const imgData = ctx.getImageData(0, 0, w, h);
        const data = imgData.data;
        // convert to grayscale and apply threshold
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          // luminosity
          const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          // simple threshold (adaptive could be better)
          const v = l > 140 ? 255 : 0;
          data[i] = data[i + 1] = data[i + 2] = v;
          // keep alpha
        }
        ctx.putImageData(imgData, 0, 0);
        const out = canvas.toBuffer('image/png');
        return out;
      } catch (e) {
        return buffer;
      }
    };

    // extract a solution string from webhook response data (robust to different shapes)
    const extractSolutionFromWebhook = (data: any) => {
      if (!data) return null;
      if (typeof data === 'string') return data;
      if (typeof data === 'object') {
        // common fields
        if (typeof data.content === 'string') return data.content;
        if (typeof data.answer === 'string') return data.answer;
        if (typeof data.text === 'string') return data.text;
        if (typeof data.captcha === 'string') return data.captcha;
        if (data.content && typeof data.content === 'object') {
          const c = data.content;
          if (typeof c.text === 'string') return c.text;
          if (Array.isArray(c.parts) && c.parts.length) {
            // parts may contain objects with text
            for (const p of c.parts) {
              if (p && typeof p.text === 'string' && p.text.trim()) return p.text.trim();
            }
          }
        }
        // look for nested common shapes
        if (Array.isArray(data) && data.length && typeof data[0] === 'string') return data[0];
      }
      return null;
    };

    let solved: string | null = null;
    // selectors for captcha image and refresh controls
    const captchaSelectors = ['img[src*="BotDetect"]', 'img[id*="imgCaptcha"]', 'img[src*="captcha"]', 'img[alt*="captcha"]'];
    const refreshSelectors = [
      'a:has-text("Refresh")',
      'a[id*="Refresh"]',
      'button:has-text("Refresh")',
      'img[alt*="refresh"]',
      'a#ctl00_ContentPlaceHolder1_lnkRefresh',
      'img.BDC_ReloadIcon',
      '#c_loginsearch_webformscaptchalogin_ReloadIcon',
      'img[id$="ReloadIcon"]',
      'img[src*="get=reload-icon"]'
    ];
    const captchaInputSelectors = ['input[name="captchaText"]', 'input#ctl00_ContentPlaceHolder1_txtCaptcha', 'input[name*="captcha"]', 'input[type="text"]'];

    // unlimited retry loop
    while (true) {
      attempt += 1;
      // Re-evaluate form and credential fields each attempt because the page may reload
      try {
        formSel = await this.findFirstSelector(page, formSelectors);
        formHandle = formSel ? formSel.el : page;
      } catch (e) {
        formHandle = page;
      }

      // Re-fill username/password if fields are empty (page may have been reloaded)
      try {
        const userSelAttempt = await this.findFirstSelector(formHandle, ['input[name="UserID"]', 'input[name="User ID"]', 'input#ctl00_ContentPlaceHolder1_txtUserID', 'input[type="text"]']) || await this.findFirstSelector(page, ['input[name="UserID"]', 'input[name="User ID"]', 'input#ctl00_ContentPlaceHolder1_txtUserID', 'input[type="text"]']);
        const passSelAttempt = await this.findFirstSelector(formHandle, ['input[name="Password"]', 'input#ctl00_ContentPlaceHolder1_txtPassword', 'input[type="password"]']) || await this.findFirstSelector(page, ['input[name="Password"]', 'input#ctl00_ContentPlaceHolder1_txtPassword', 'input[type="password"]']);
        if (userSelAttempt) {
          try {
            const cur = await userSelAttempt.el.inputValue();
            if (!cur || String(cur).trim() === '') await userSelAttempt.el.fill(user);
          } catch (e) {
            try { if (userSelAttempt.sel) await page.$eval(userSelAttempt.sel, (el: any, v: string) => { (el as HTMLInputElement).value = v; }, user); } catch (e2) {}
          }
          // wait 1s before typing password as requested
          await page.waitForTimeout(1000);
        }
        if (passSelAttempt) {
          try {
            const curp = await passSelAttempt.el.inputValue();
            if (!curp || String(curp).trim() === '') await passSelAttempt.el.fill(pass);
          } catch (e) {
            try { if (passSelAttempt.sel) await page.$eval(passSelAttempt.sel, (el: any, v: string) => { (el as HTMLInputElement).value = v; }, pass); } catch (e2) {}
          }
          // wait 1s after password before taking captcha screenshot
          await page.waitForTimeout(1000);
        }
      } catch (e) {
        // ignore refill errors
      }

      const captchaCandidate = await this.findFirstSelector(formHandle, captchaSelectors);
      if (!captchaCandidate) {
        paLog('captcha image not found on login form (attempt', attempt, ')');
        // page may have reloaded — wait a bit and retry
        await page.waitForTimeout(250);
        continue;
      }

      // take screenshot of captcha after requested 0.5s pause
      const captchaEl = captchaCandidate.el;
      const rawBuffer = await captchaEl.screenshot({ type: 'png' });
      // save last captcha for debugging/operator (raw)
      try { fs.writeFileSync(path.join(process.cwd(), 'data', 'PA', 'captcha_last.png'), rawBuffer); } catch (e) {}
      // preprocess before sending/ocr
      const buffer = await preprocessCaptcha(rawBuffer);
      try { fs.writeFileSync(path.join(process.cwd(), 'data', 'PA', 'captcha_last_processed.png'), buffer); } catch (e) {}

      // Wait 1s after screenshot before sending to webhook (per sequence)
      await page.waitForTimeout(1000);

      // Ensure the screenshot is sent to the webhook (if enabled) on every attempt
      if (this.useCaptchaWebhook) {
        try {
          const b64 = buffer.toString('base64');
          paLog('sending captcha attempt', attempt, 'to webhook', this.captchaWebhook);
          const resp = await axios.post(this.captchaWebhook, { image: b64, filename: `pa_captcha_${attempt}.png`, pageUrl: page.url() }, { headers: { 'Content-Type': 'application/json' }, timeout: 120000 });
          if (resp && resp.data) {
            const candidate = extractSolutionFromWebhook(resp.data);
            if (candidate) {
              solved = String(candidate).trim();
              paLog('webhook returned ->', solved);
            }
          }
        } catch (err) {
          paWarn('webhook request failed on attempt', attempt, err.message || err);
        }
      }

      // If webhook didn't provide a solution, do not attempt local OCR (removed per request)
      if (!solved) {
        paLog('webhook did not return a solution on attempt', attempt);
      }

      // If local OCR produced something, we'll fill below and submit following the timing
      if (solved) {
        // Prefer the exact Captcha field provided by the user
        const targetSelectors = ['#CaptchaLoginCheck', ...captchaInputSelectors];
        const captchaInput = await this.findFirstSelector(formHandle, targetSelectors) || await this.findFirstSelector(page, targetSelectors);
        if (captchaInput) {
          try {
            await captchaInput.el.scrollIntoViewIfNeeded();
            try { await captchaInput.el.click({ force: true }); } catch (e) {}
          } catch (e) {}

          let filled = false;
          for (let f = 0; f < 3 && !filled; f++) {
            try {
              await captchaInput.el.fill(String(solved), { timeout: 5000 });
              filled = true;
            } catch (fillErr) {
              await page.waitForTimeout(120 + f * 100);
            }
          }

          if (!filled) {
            try {
              if (captchaInput.sel) {
                await page.$eval(captchaInput.sel, (el: any, v: string) => { (el as HTMLInputElement).value = v; }, String(solved));
                filled = true;
              }
            } catch (evalErr) {
              paWarn('failed to set captcha input via DOM eval', evalErr.message || evalErr);
            }
          }
        }

        // wait 1s after inserting captcha before submitting
        await page.waitForTimeout(1000);

        // try submitting within the form first using several strategies
        const submitSelectors = [
          '#btnLoginClient',
          'input#btnLoginClient',
          'input[name="btnLoginClient"]',
          'button[type="submit"]',
          'input[type="submit"]',
          'input#ctl00_ContentPlaceHolder1_btnLogin',
          'input[id$="btnLogin"]',
          'button:has-text("Login")',
          'button:has-text("Log In")',
          'input[value*="Login"]',
          'input[value*="Log In"]',
          'text=Login',
          'text=Sign In'
        ];

        let submitted = false;

        // Attempt click on submit buttons found inside form first, then page-wide
        let submitBtn = await this.findFirstSelector(formHandle, submitSelectors) || await this.findFirstSelector(page, submitSelectors);
        if (submitBtn) {
          paLog('attempting to click submit button', submitBtn.sel);
          try {
            await this.safeClickWithNavigation(page, submitBtn.el, { waitForNavigation: true, timeout: 5000 }, {});
            submitted = true;
          } catch (e) {
            paWarn('submit button click failed', e.message || e);
          }
        }

        // If no submit button or click didn't navigate, try pressing Enter on the captcha input
        if (!submitted && captchaInput && captchaInput.el) {
          try {
            paLog('attempting Enter keypress on captcha input');
            await captchaInput.el.press('Enter');
            submitted = true;
            // give time for navigation/ajax
            await page.waitForTimeout(300);
          } catch (e) {
            // ignore
          }
        }

        // As a last resort, try submitting the first form element directly
        if (!submitted) {
          try {
            paLog('trying form.submit() fallback');
            await page.$eval('form', (f: any) => (f as HTMLFormElement).submit());
            await page.waitForTimeout(300);
            submitted = true;
          } catch (e) {
            // ignore
          }
        }

        // After submit: wait 1s and check for explicit indicators
        try { await page.waitForTimeout(1000); } catch (e) {}

        let indicatorFound = false;
        try {
          // primary selector: specific li element used in the header
          const signedEl = await page.$('li#liSignedInAsName') || await page.$('li:has-text("Signed in As")') || await page.$('text=Signed in As');
          if (signedEl) {
            indicatorFound = true;
          } else {
            // fallback: search page text for other known indicators
            const bodyText = await page.$eval('body', b => (b as HTMLElement).innerText).catch(() => '');
            if (bodyText && (bodyText.indexOf('Last Login DateTime') !== -1 || bodyText.indexOf('PLEASE NOTE') !== -1 || bodyText.indexOf('Signed in As') !== -1)) {
              indicatorFound = true;
            }
          }
        } catch (e) {
          // ignore errors during detection
        }

        if (indicatorFound) {
          paLog('login appears successful after submit attempt (indicator found)');
          break;
        }

        // still on login page
        paLog('login still not successful after submit attempt', attempt);

        // clear solved to retry; do not click refresh (removed per request)
        solved = null;
        try { await page.waitForTimeout(1000); } catch (e) {}
      }

      // Do not click refresh on failure; just wait 1s then retry
      try { await page.waitForTimeout(1000); } catch (e) {}

      // continue to next attempt (infinite loop)
      continue;
    }

    // Note: with the infinite retry loop above, execution will only reach here once login
    // appears successful (we break the loop), so proceed to saving cookies below.
    // Fill captcha input if found (this block still handles a one-time solved state if reached)
    if (solved) {
      const captchaInput = await this.findFirstSelector(page, ['input[name="captchaText"]', 'input#ctl00_ContentPlaceHolder1_txtCaptcha', 'input[name*="captcha"]', 'input[type="text"]']);
      if (captchaInput) {
        try {
          await captchaInput.el.fill(String(solved));
        } catch (e) {
          try { await page.$eval(captchaInput.sel, (el: any, v: string) => { (el as HTMLInputElement).value = v; }, String(solved)); } catch (e2) { /* ignore */ }
        }

        // Try submitting
        const submitSelectors = ['#btnLoginClient', 'input#btnLoginClient', 'input[name="btnLoginClient"]', 'button[type="submit"]', 'input[type="submit"]', 'input#ctl00_ContentPlaceHolder1_btnLogin', 'input[id$="btnLogin"]', 'button:has-text("Login")', 'text=Login', 'text=Sign In'];
        const submitBtn = await this.findFirstSelector(page, submitSelectors) || await this.findFirstSelector(page, ['button[type="submit"]', 'input[type="submit"]']);
        let didSubmit = false;
        if (submitBtn) {
          try {
            paLog('final submit click ->', submitBtn.sel);
            await this.safeClickWithNavigation(page, submitBtn.el, { waitForNavigation: true, timeout: 5000 }, {});
            didSubmit = true;
          } catch (e) {
            // ignore
          }
        }

        if (!didSubmit) {
          try {
            paLog('final submit fallback - pressing Enter on captcha input');
            await captchaInput.el.press('Enter');
            await page.waitForTimeout(120);
            didSubmit = true;
          } catch (e) { /* ignore */ }
        }

        if (!didSubmit) {
          try {
            paLog('final submit fallback - form.submit()');
            await page.$eval('form', (f: any) => (f as HTMLFormElement).submit());
            await page.waitForTimeout(120);
            didSubmit = true;
          } catch (e) { /* ignore */ }
        }
      }
    }

    await page.waitForTimeout(400);

    // Ensure we're on the post-login page by checking for the 'Signed in As' element
    try {
      const signed = await page.waitForSelector('li#liSignedInAsName, li:has-text("Signed in As")', { timeout: 5000 });
      if (signed) {
        const txt = String(await signed.innerText() || '');
        if (txt.indexOf('Signed in As') === -1) throw new Error('Signed in text not present');
      }
    } catch (e) {
      paLog('did not detect "Signed in As" after login, reloading start URL to proceed');
      try {
        await page.goto('https://dcr.alleghenycounty.us/Civil/LoginSearch.aspx', { waitUntil: 'networkidle', timeout: 10000 });
        await page.waitForTimeout(500);
      } catch (e2) {
        paWarn('reload after login did not succeed', e2.message || e2);
      }
    }

    // Cookie saving removed per configuration (do not persist session cookies here)
    paLog('login() finished and returning to caller');
  }

  // Send image buffer as multipart/form-data 'file' field to webhookUrl
  // webhook uploader removed — we rely on local OCR + manual input only

  // Send image as base64 in JSON body to webhookUrl
  // webhook uploader removed

  // FASE 4 - download PDFs for NEW cases
  async collectAndProcessCases() {
    paLog('collectAndProcessCases starting');
    const details: any[] = [];
    const headless = process.env.PLAYWRIGHT_HEADLESS === 'true';
    const userAgent = process.env.USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36';
    const startUrl = 'https://dcr.alleghenycounty.us/Civil/LoginSearch.aspx';

    try {
      this.browser = await chromium.launch({ headless, args: ['--no-sandbox'] });
      this.context = await this.browser.newContext({ userAgent, viewport: { width: 1280, height: 900 } });

      const page = await this.context.newPage();
      await this.safeGoto(page, startUrl, {});
      await page.waitForTimeout(250);

      // ensure login
      try { await this.login(page); paLog('login completed, proceeding with search/navigation'); } catch (e) { paWarn('login during collect/process failed', e.message || e); }

      // If the original page was closed (for example by manual action), abort collection
      try { if ((page as any).isClosed && (page as any).isClosed()) { paWarn('page closed after login; aborting collectAndProcessCases to avoid operating on closed page'); try { if (this.context) await this.context.close(); } catch (e) {} try { if (this.browser) await this.browser.close(); } catch (e) {} this.context = null; this.browser = null; return details; } } catch (e) {}

      // navigate to Search By Date (reuse existing navigation logic)
      paLog('post-login: beginning navigation to Case Search (robust)');
      try {
        const searchDropdown = await this.findFirstSelector(page, [
          'a.dropdown-toggle:has-text("Search")',
          'a.dropdown-toggle:has-text("Search ")',
          'a.dropdown-toggle',
          'a:has-text("Search")'
        ]);
        if (searchDropdown) {
          try { await page.click(searchDropdown.sel); paLog('post-login: opened Search dropdown via selector', searchDropdown.sel); await page.waitForTimeout(120); } catch (e) { paWarn('post-login: opening Search dropdown failed', e.message || e); }
        }

        const caseSearchLink = await this.findFirstSelector(page, ['a:has-text("Case Search")', 'a[href*="CaseSearchByCaseNumber"]', 'a[href*="CaseSearch"]']);
        if (caseSearchLink) { try { await page.click(caseSearchLink.sel); paLog('post-login: clicked Case Search via page.click'); await page.waitForTimeout(250); } catch (e) { paWarn('post-login: click Case Search failed', e.message || e); } }

        const byDateLink = await this.findFirstSelector(page, ['a:has-text("Search Case Filings By Date")', 'a[title="Search By Date"]', 'a[href*="CaseSearchByDate"]']);
        if (byDateLink) { try { await page.click(byDateLink.sel); paLog('post-login: clicked Search Case Filings By Date'); await page.waitForTimeout(250); } catch (e) { paWarn('post-login: click Search By Date failed', e.message || e); } }

        // date picker interactions
        try {
          await page.waitForSelector('#reportrange', { timeout: 3000 });
          try { await page.click('#reportrange'); paLog('post-login: clicked reportrange'); } catch (e) {}
          try { await page.click('li[data-range-key="Last 30 Days"], li:has-text("Last 30 Days")'); paLog('post-login: clicked Last 30 Days'); } catch (e) {}
          try { await page.click('.ranges .applyBtn, button.applyBtn:has-text("Apply"), button.applyBtn'); paLog('post-login: clicked Apply'); } catch (e) { paLog('post-login: Apply not clickable', e && e.message ? e.message : e); }
        } catch (e) { paLog('post-login: date picker not present', e && e.message ? e.message : e); }

        try { await page.selectOption('#ContentPlaceHolder1_drpdwnCourtType', 'MG'); paLog('post-login: selected CourtType MG'); } catch (e) {}
        try { await page.selectOption('#ContentPlaceHolder1_drpdwnCaseType', 'MF'); paLog('post-login: selected CaseType MF'); } catch (e) {}

        try { await page.click('#ContentPlaceHolder1_btnSearch, input#ContentPlaceHolder1_btnSearch, input[value*="Search"]'); paLog('post-login: clicked search submit'); await page.waitForTimeout(250); } catch (e) { paWarn('post-login: clicking search submit failed', e.message || e); }
      } catch (e) { paWarn('navigation to date search failed', e.message || e); }

      // Iterate through result pages
      while (true) {
        // collect anchors (prefer MG in results table)
        let anchors: Array<{ href: string; el: any; text: string; casenumber?: string }> = [];
        try {
          const mgHandles = await page.$$(`#AllRecordsBase tbody tr td:nth-child(2) a[casenumber^="MG-"]`);
          if (mgHandles && mgHandles.length > 0) {
            for (const h of mgHandles) {
              try {
                const href = (await h.getAttribute('href')) || '';
                const text = (await h.innerText()) || '';
                const casenumber = (await h.getAttribute('casenumber')) || '';
                if (!href) continue;
                anchors.push({ href: new URL(href, page.url()).toString(), el: h, text: text.trim(), casenumber: casenumber.trim() });
              } catch (e) { continue; }
            }
          } else {
            const handles = await page.$$('a[href]');
            for (const h of handles) {
              try {
                const href = (await h.getAttribute('href')) || '';
                const text = (await h.innerText()) || '';
                const casenumber = (await h.getAttribute('casenumber')) || '';
                if (!href) continue;
                const isMG = casenumber && /^MG-\d+/i.test(casenumber.trim());
                const isCaseLink = isMG || /Case|Docket|ViewCase|CaseInfo|View\/Case|CaseSearchByCaseNumber|\/Civil\/View\/Case/i.test(href) || /^[0-9].*$/i.test(text.trim());
                if (isCaseLink) anchors.push({ href: new URL(href, page.url()).toString(), el: h, text: text.trim(), casenumber: casenumber.trim() });
              } catch (e) { continue; }
            }
          }
        } catch (e) { paWarn('anchor collection failed', e && e.message ? e.message : e); anchors = []; }

        for (const a of anchors) {
          try {
            try { if ((page as any).isClosed && (page as any).isClosed()) { paWarn('main page closed during anchor processing; aborting'); break; } } catch (e) {}
            paLog('opening case link ->', a.casenumber || a.text || a.href);

            // open popup strictly by clicking
            let popup: Page | null = null;
            try {
              const [p] = await Promise.all([
                page.waitForEvent('popup', { timeout: 15000 }),
                a.el.click({ button: 'left' })
              ]);
              popup = p as Page;
            } catch (err) {
              paWarn('popup not opened by clicking anchor; skipping', a.href, err && err.message ? err.message : err);
              popup = null;
            }

            if (!popup) continue;
            try { await popup.waitForLoadState('networkidle', { timeout: 15000 }); } catch (e) {}

            // extract details
            const item = await this.extractCaseDetailsFromPage(popup);
            item.source = a.href;
            if (a.casenumber) item.caseNumber = a.casenumber;

            // save case detail JSON
            try {
              const docket = (item.docketNumber || item.caseNumber || `case-${Date.now()}`).replace(/[\\/:*?"<>|\s]/g, '_');
              const caseDir = path.join(this.dataDir, docket);
              if (!fs.existsSync(caseDir)) fs.mkdirSync(caseDir, { recursive: true });
              const detailPath = path.join(caseDir, 'case_detail.json');
              fs.writeFileSync(detailPath, JSON.stringify(item, null, 2), 'utf8');
              paLog('wrote case_detail.json for', docket);

              // find Complaint row in popup's DocketEntries table and click its document anchor to open PDF
              if (item && item.documentUrls && item.documentUrls.length === 0) {
                // fallback: try to locate complaint row and capture anchor
                try {
                  const rows = await popup.$$('#DocketEntries tbody tr');
                  for (const row of rows) {
                    try {
                      const dTypeHandle = await row.$('td:nth-child(2)');
                      const dTypeText = dTypeHandle ? (await dTypeHandle.innerText()).trim() : '';
                      if (/complaint/i.test(dTypeText)) {
                        const anchor = await row.$('a');
                        if (anchor) {
                          // open pdf page
                          try {
                            paLog('clicking complaint anchor for', docket);
                            const [pdfPage] = await Promise.all([
                              this.context!.waitForEvent('page', { timeout: 15000 }),
                              anchor.click({ button: 'left' })
                            ]);
                            await pdfPage.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
                            const pdfUrl = pdfPage.url();
                            paLog('complaint PDF opened at', pdfUrl);
                            const pdfPath = path.join(caseDir, `${docket}_complaint.pdf`);
                            try {
                              const resp = await axios.get(pdfUrl, { responseType: 'arraybuffer', timeout: 120000 });
                              fs.writeFileSync(pdfPath, resp.data);
                              paLog('downloaded complaint PDF for', docket);
                            } catch (dlErr) {
                              paWarn('axios download failed for complaint PDF', dlErr.message || dlErr);
                              // fallback try item.complaintUrl if exists
                              if (item.complaintUrl) {
                                try { const resp2 = await axios.get(item.complaintUrl, { responseType: 'arraybuffer', timeout: 120000 }); fs.writeFileSync(pdfPath, resp2.data); paLog('downloaded complaint PDF via complaintUrl fallback for', docket); } catch (e) { paWarn('fallback complaint download failed', e && e.message ? e.message : e); }
                              }
                            }
                            try { await pdfPage.close(); } catch (e) {}
                          } catch (clickErr) { paWarn('clicking complaint anchor failed', clickErr && clickErr.message ? clickErr.message : clickErr); }
                        }
                        break;
                      }
                    } catch (inner) { continue; }
                  }
                } catch (e) { paWarn('error locating complaint anchor inside popup', e && e.message ? e.message : e); }
              }

            } catch (e) { paWarn('case save or complaint download failed', e && e.message ? e.message : e); }

            details.push(item);
            try { await popup.close(); } catch (e) {}
            await page.waitForTimeout(120);
          } catch (e) { paWarn('error processing anchor', a.href, e && e.message ? e.message : e); }
        }

        // pagination
        const nextButton = await page.$('a[rel="next"], a.next, button.next, a:has-text("Next"), button:has-text("Next")');
        if (nextButton) {
          try { const clicked = await this.safeClickWithNavigation(page, nextButton, { waitForNavigation: true, timeout: 10000 }, {}); if (clicked) { await page.waitForTimeout(400); continue; } } catch (e) { paWarn('pagination next click failed', e && e.message ? e.message : e); }
        }

        break;
      }

      try { if (page && !(page as any).isClosed?.()) await page.close(); } catch (e) {}
      try { if (this.context) await this.context.close(); } catch (e) {}
      try { if (this.browser) await this.browser.close(); } catch (e) {}
      this.context = null; this.browser = null;
      return details;
    } catch (err) {
      paError('collectAndProcessCases failed', err);
      try { if (this.context) await this.context.close(); } catch (e) {}
      try { if (this.browser) await this.browser.close(); } catch (e) {}
      this.context = null; this.browser = null;
      return details;
    }
  }

  async downloadAllComplaintPDFs(details: any[]) {
    paLog('downloadAllComplaintPDFs (stub)');
    // TODO: implement PDF downloads (only for new cases)
  }

  // FASE 5 - extract text from PDFs
  async extractAllPDFTexts() {
    paLog('extractAllPDFTexts (stub)');
    // TODO: implement text extraction (pdftotext / OCR fallback)
  }

  // FASE 6 - send webhooks in batches
  async sendWebhooksInBatches() {
    paLog('sendWebhooksInBatches (stub)');
    // TODO: implement webhook payload building and sending
  }

  // Run full pipeline
  async run() {
    paLog('runner starting');
    // collect and process cases sequentially (each case opens in a popup)
    const details = await this.collectAndProcessCases();
    const enriched = await this.enrichAllWithVGSI(details);
    await this.downloadAllComplaintPDFs(enriched);
    await this.extractAllPDFTexts();
    await this.sendWebhooksInBatches();
    paLog('runner finished');
  }
}
