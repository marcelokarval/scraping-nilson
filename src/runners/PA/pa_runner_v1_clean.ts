import path from 'path';
import fs from 'fs';
import { chromium, Browser, BrowserContext, Page, Download } from 'playwright';
import { createCanvas, loadImage } from 'canvas';
declare const Tesseract: any;
import LocationPathManager from '../../utils/location_manager';
import processedStore from '../../lib/processed_store';
import axios from 'axios';
import { ensureExtractAndSave } from '../../services/ocr_client';

const paTimestamp = () => new Date().toISOString();
const paLog = (...args: any[]) => { console.log(`${paTimestamp()} PA:`, ...args); };
const paWarn = (...args: any[]) => { console.warn(`${paTimestamp()} PA:`, ...args); };
const paError = (...args: any[]) => { console.error(`${paTimestamp()} PA:`, ...args); };

interface PAConfig {
  credentials: { username: string; password: string };
  captcha: { useWebhook: boolean; webhookUrl: string };
  browser: { headless: boolean; viewport: { width: number; height: number }; userAgent: string; args: string[] };
  timeouts: any;
  search: { dateRange: string; courtType: string; caseType: string };
  selectors: any;
  output: any;
  urls: { startUrl: string };
}

interface PropertyEnrichmentData {
  raw?: string;
  
  // Informações básicas (Info Pane)
  parcel_id?: string | null;
  parcel_alt_id?: string | null;
  property_address?: string | null;
  municipality?: string | null;
  owner_name?: string | null;
  
  // General Information - Table 1
  school_district?: string | null;
  tax_code?: string | null;
  class?: string | null;
  use_code?: string | null;
  homestead?: string | null;
  farmstead?: string | null;
  clean_and_green?: string | null;
  other_abatement?: string | null;
  
  // General Information - Table 2
  neighborhood_code?: string | null;
  owner_code?: string | null;
  recording_date?: string | null;
  sale_date?: string | null;
  sale_price?: string | null;
  deed_book?: string | null;
  deed_page?: string | null;
  lot_area?: string | null;
  
  // Valores 2026 (Projected)
  future_full_land_value?: string | null;
  future_full_building_value?: string | null;
  future_full_total_value?: string | null;
  future_county_land_value?: string | null;
  future_county_building_value?: string | null;
  future_county_total_value?: string | null;
  
  // Valores 2025 (Current Year)
  current_full_land_value?: string | null;
  current_full_building_value?: string | null;
  current_full_total_value?: string | null;
  current_county_land_value?: string | null;
  current_county_building_value?: string | null;
  current_county_total_value?: string | null;
  
  // Valores 2024 (Previous Year)
  previous_full_land_value?: string | null;
  previous_full_building_value?: string | null;
  previous_full_total_value?: string | null;
  previous_county_land_value?: string | null;
  previous_county_building_value?: string | null;
  previous_county_total_value?: string | null;
  
  // Owner Mailing
  owner_mailing_address?: string | null;
  
  [key: string]: any;
}

interface EnrichmentResult {
  defendant_address: string;
  defendant_name?: string;
  search_params: {
    house_number: string;
    street_name: string;
  };
  match_score: number;
  name_match_score?: number;
  enrichment_data?: PropertyEnrichmentData;
  enriched_at: string;
  error?: string;
}

export default class PARunnerV1 {
  baseDataDir: string;
  dataDir: string;
  processedPath: string;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private locationManager: LocationPathManager;
  private config: PAConfig;
  captchaWebhook: string;
  useCaptchaWebhook: boolean;
  private isUpdateMode: boolean = false; // Flag para modo de atualização
  private casesProcessedThisRun: Set<string> = new Set(); // Casos processados nesta execução

  constructor(locationCode: string = 'PA', configPath?: string) {
    this.locationManager = new LocationPathManager(locationCode);
    this.baseDataDir = this.locationManager.getDataDir('Foreclosure');
    this.dataDir = path.join(this.baseDataDir, 'cases');
    this.processedPath = this.locationManager.getProcessedCasesPath('foreclosure');
    
    // Load config
    const defaultConfigPath = path.join(process.cwd(), 'config', 'pa_config.json');
    const cfgPath = configPath || defaultConfigPath;
    try {
      const configData = fs.readFileSync(cfgPath, 'utf8');
      this.config = JSON.parse(configData);
      paLog('loaded config from', cfgPath);
    } catch (err) {
      paWarn('failed to load config, using defaults:', err);
      this.config = {
        credentials: { username: process.env.PA_USER || '', password: process.env.PA_PASS || '' },
        captcha: { useWebhook: (process.env.PA_USE_WEBHOOK || 'true') === 'true', webhookUrl: process.env.PA_CAPTCHA_WEBHOOK || '' },
        browser: { headless: process.env.PLAYWRIGHT_HEADLESS === 'true', viewport: { width: 1280, height: 900 }, userAgent: 'Mozilla/5.0', args: ['--no-sandbox'] },
        timeouts: { navigation: 30000, captchaWebhook: 120000, credentialFill: 1000, afterScreenshot: 1000, afterSubmit: 1000, loginRetry: 1000 },
        search: { dateRange: 'Last 30 Days', courtType: 'MG', caseType: 'MF' },
        selectors: {},
        output: { dataDir: 'data/PA/cases', captchaDir: 'data/PA', caseDetailFileName: 'case_detail.json', complaintPdfPattern: '{docket}_complaint.pdf' },
        urls: { startUrl: 'https://dcr.alleghenycounty.us/Civil/LoginSearch.aspx' }
      };
    }
    
    // Allow env vars to override config
    if (process.env.PA_USER) this.config.credentials.username = process.env.PA_USER;
    if (process.env.PA_PASS) this.config.credentials.password = process.env.PA_PASS;
    if (process.env.PA_CAPTCHA_WEBHOOK) this.config.captcha.webhookUrl = process.env.PA_CAPTCHA_WEBHOOK;
    if (process.env.PA_USE_WEBHOOK !== undefined) this.config.captcha.useWebhook = process.env.PA_USE_WEBHOOK === 'true';
    if (process.env.PLAYWRIGHT_HEADLESS !== undefined) this.config.browser.headless = process.env.PLAYWRIGHT_HEADLESS === 'true';
    
    this.captchaWebhook = this.config.captcha.webhookUrl;
    this.useCaptchaWebhook = this.config.captcha.useWebhook;
    
    // Detectar modo de atualização (quando dateRange é "Today")
    this.isUpdateMode = this.config.search.dateRange === 'Today';
    if (this.isUpdateMode) {
      paLog('🔄 UPDATE MODE ENABLED - Will process existing cases for updates');
    }
    
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

  async login(page: Page) {
    paLog('starting login sequence');
    const user = this.config.credentials.username;
    const pass = this.config.credentials.password;
    const captchaSelectors = this.config.selectors?.login?.captchaImages || ['img[src*="BotDetect"]', 'img[id*="imgCaptcha"]', 'img[src*="captcha"]'];
    const captchaInputSelectors = this.config.selectors?.login?.captchaInputs || ['input[name="captchaText"]', 'input#ctl00_ContentPlaceHolder1_txtCaptcha', 'input[name*="captcha"]', 'input[type="text"]'];

    const userSelectors = this.config.selectors?.login?.userIdFields || ['input[name="UserID"]', 'input#ctl00_ContentPlaceHolder1_txtUserID', 'input[type="text"]'];
    const passSelectors = this.config.selectors?.login?.passwordFields || ['input[name="Password"]', 'input#ctl00_ContentPlaceHolder1_txtPassword', 'input[type="password"]'];
    const submitSelectors = this.config.selectors?.login?.submitButtons || ['#btnLoginClient', 'input#btnLoginClient', 'button:has-text("Login")', 'input[type="submit"]'];
    const credentialWait = this.config.timeouts?.credentialFill || 1000;

    while (true) {
      try {
        const u = await this.findFirstSelector(page, userSelectors);
        const p = await this.findFirstSelector(page, passSelectors);
        if (u) { try { await u.el.fill(user); } catch (e) {} }
        await page.waitForTimeout(credentialWait);
        if (p) { try { await p.el.fill(pass); } catch (e) {} }
        await page.waitForTimeout(credentialWait);
      } catch (e) { paWarn('fill credentials failed', e); }

      const captchaEl = (await this.findFirstSelector(page, captchaSelectors))?.el;
      if (captchaEl && this.useCaptchaWebhook && this.captchaWebhook) {
        try {
          const raw = await captchaEl.screenshot({ type: 'png' });
          const captchaDir = this.config.output?.captchaDir || 'data/PA';
          try { fs.writeFileSync(path.join(process.cwd(), captchaDir, 'captcha_last.png'), raw); } catch (e) {}
          await page.waitForTimeout(this.config.timeouts?.afterScreenshot || 1000);
          try {
            const b64 = raw.toString('base64');
            paLog('sending captcha to webhook...');
            const resp = await axios.post(this.captchaWebhook, { image: b64, pageUrl: page.url() }, { timeout: this.config.timeouts?.captchaWebhook || 120000 });
            paLog('webhook response received:', JSON.stringify(resp.data));
            let solved: string | null = null;
            if (resp && resp.data) {
              // Try multiple extraction patterns
              if (typeof resp.data === 'string') {
                solved = resp.data.trim();
              } else if (typeof resp.data === 'object') {
                // Try common response fields
                if (typeof resp.data.answer === 'string') solved = resp.data.answer;
                else if (typeof resp.data.text === 'string') solved = resp.data.text;
                else if (typeof resp.data.captcha === 'string') solved = resp.data.captcha;
                else if (typeof resp.data.solution === 'string') solved = resp.data.solution;
                else if (typeof resp.data.result === 'string') solved = resp.data.result;
                else if (resp.data.content && typeof resp.data.content === 'string') solved = resp.data.content;
                else if (resp.data.content && typeof resp.data.content === 'object') {
                  // Check nested content structure
                  if (typeof resp.data.content.text === 'string') solved = resp.data.content.text;
                  else if (Array.isArray(resp.data.content.parts) && resp.data.content.parts.length > 0) {
                    for (const part of resp.data.content.parts) {
                      if (part && typeof part.text === 'string' && part.text.trim()) {
                        solved = part.text.trim();
                        break;
                      }
                    }
                  }
                }
              }
            }
            if (solved) {
              paLog('webhook returned solution:', solved);
              const captchaInputResult = await this.findFirstSelector(page, captchaInputSelectors);
              if (captchaInputResult) {
                try {
                  // Use DOM manipulation directly - more reliable than Playwright's fill()
                  const filled = await page.$eval(captchaInputResult.sel, (input: any, value: string) => {
                    if (input) {
                      input.value = value;
                      input.dispatchEvent(new Event('input', { bubbles: true }));
                      input.dispatchEvent(new Event('change', { bubbles: true }));
                      return true;
                    }
                    return false;
                  }, String(solved));
                  if (filled) {
                    paLog('captcha solution filled into field:', captchaInputResult.sel);
                    // Wait a bit for the site to process the captcha input
                    await page.waitForTimeout(500);
                  } else {
                    paWarn('failed to set captcha value');
                  }
                } catch (e) { 
                  paWarn('failed to fill captcha input:', e); 
                } 
              } else {
                paWarn('captcha input field not found');
              }
            } else {
              paWarn('webhook did not return a valid solution. Response data:', JSON.stringify(resp.data));
            }
          } catch (err) { paWarn('webhook request failed', err && err.message ? err.message : err); }
        } catch (e) { paWarn('captcha screenshot failed', e && e.message ? e.message : e); }
      }

      try {
        const submitBtn = (await this.findFirstSelector(page, submitSelectors))?.el;
        if (submitBtn) { 
          try { 
            // Try to submit with navigation, but don't fail if navigation times out
            await Promise.race([
              page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }),
              submitBtn.click().then(() => new Promise(resolve => setTimeout(resolve, 100)))
            ]);
            paLog('submit clicked, waiting for result');
          } catch (e) { 
            paLog('submit navigation timeout (may be normal for AJAX forms)');
          }
        } else { 
          try { 
            await page.$eval('form', (f: any) => (f as HTMLFormElement).submit()); 
            paLog('form submitted via DOM');
          } catch (e) {
            paWarn('form submit via DOM failed');
          }
        }
      } catch (e) { paWarn('submit failed', e && e.message ? e.message : e); }

      await page.waitForTimeout(this.config.timeouts?.afterSubmit || 1000);
      try {
        paLog('checking for login success indicators...');
        const successSelectors = this.config.selectors?.login?.successIndicators || ['li#liSignedInAsName', 'li:has-text("Signed in As")'];
        const signed = await this.findFirstSelector(page, successSelectors);
        if (signed) { 
          paLog('login appears successful - found element:', signed.sel); 
          break; 
        }
        
        const bodyText = await page.$eval('body', b => (b as HTMLElement).innerText).catch(() => '');
        const successPatterns = this.config.selectors?.login?.successTextPatterns || ['Last Login DateTime', 'PLEASE NOTE', 'Signed in As'];
        paLog('checking body text for patterns:', successPatterns);
        
        for (const pattern of successPatterns) {
          if (bodyText && bodyText.indexOf(pattern) !== -1) {
            paLog('login successful - found text pattern:', pattern);
            break;
          }
        }
        
        // Check again if we should break
        if (bodyText && successPatterns.some(p => bodyText.indexOf(p) !== -1)) { 
          break; 
        }
        
        paLog('login indicators not found, page title:', await page.title().catch(() => 'unknown'));
      } catch (e) {
        paWarn('error checking login success:', e);
      }

      paLog('login not successful, retrying...');
      await page.waitForTimeout(this.config.timeouts?.loginRetry || 1000);
    }

    paLog('login() finished');
  }

  private async extractCaseDetailsFromPage(page: Page) {
    const out: any = {
      caseNumber: null,
      caseDescription: null,
      filingDate: null,
      filingTime: null,
      caseType: null,
      courtType: null,
      currentStatus: null,
      judge: null,
      amountInDispute: null,
      juryRequested: null,
      relatedCases: null,
      consolidatedCases: null,
      litigants: [],
      attorneys: [],
      nonLitigants: [],
      docketEntries: [],
      eventSchedule: [],
      services: [],
      complaintUrl: null
    };
    
    try {
      // Case Details - dados principais
      out.caseNumber = await page.$eval('#CaseNumber', el => el.textContent?.trim()).catch(() => null);
      out.caseDescription = await page.$eval('#CaseDesc', el => el.textContent?.trim()).catch(() => null);
      out.filingDate = await page.$eval('#fillingDate', el => el.textContent?.trim()).catch(() => null);
      out.filingTime = await page.$eval('#FilingTime', el => el.textContent?.trim()).catch(() => null);
      out.caseType = await page.$eval('#CaseType', el => el.textContent?.trim()).catch(() => null);
      out.courtType = await page.$eval('#CourtType', el => el.textContent?.trim()).catch(() => null);
      out.currentStatus = await page.$eval('#CurrentStatus', el => el.textContent?.trim()).catch(() => null);
      out.judge = await page.$eval('#Judge', el => el.textContent?.trim()).catch(() => null);
      out.amountInDispute = await page.$eval('#Amt', el => el.textContent?.trim()).catch(() => null);
      out.juryRequested = await page.$eval('#JuryRequested', el => el.textContent?.trim()).catch(() => null);
      out.relatedCases = await page.$eval('#relatedCases', el => el.textContent?.trim()).catch(() => null);
      out.consolidatedCases = await page.$eval('#consolidatedCases', el => el.textContent?.trim()).catch(() => null);
      
      // Litigants table
      try {
        const litigantRows = await page.$$('#Litigants tbody tr');
        for (const row of litigantRows) {
          const tds = await row.$$('td');
          if (tds.length >= 7) {
            out.litigants.push({
              lastName: await tds[0].innerText().catch(() => ''),
              firstName: await tds[1].innerText().catch(() => ''),
              middleName: await tds[2].innerText().catch(() => ''),
              type: await tds[3].innerText().catch(() => ''),
              address: await tds[4].innerText().catch(() => ''),
              initialService: await tds[5].innerText().catch(() => ''),
              attorney: await tds[6].innerText().catch(() => '')
            });
          }
        }
      } catch (e) { paLog('error extracting litigants'); }
      
      // Attorneys table
      try {
        const attorneyRows = await page.$$('#Attorney tbody tr');
        for (const row of attorneyRows) {
          const tds = await row.$$('td');
          if (tds.length >= 6) {
            out.attorneys.push({
              lastName: await tds[0].innerText().catch(() => ''),
              firstName: await tds[1].innerText().catch(() => ''),
              middleName: await tds[2].innerText().catch(() => ''),
              type: await tds[3].innerText().catch(() => ''),
              address: await tds[4].innerText().catch(() => ''),
              phone: await tds[5].innerText().catch(() => '')
            });
          }
        }
      } catch (e) { paLog('error extracting attorneys'); }
      
      // Docket Entries table
      try {
        const docketRows = await page.$$('#DocketEntries tbody tr');
        for (const row of docketRows) {
          const tds = await row.$$('td');
          if (tds.length >= 5) {
            const filingDate = await tds[0].innerText().catch(() => '');
            const docketType = await tds[1].innerText().catch(() => '');
            const docketText = await tds[2].innerText().catch(() => '');
            const filingParty = await tds[3].innerText().catch(() => '');
            
            let docUrl: string | null = null;
            let docText: string | null = null;
            try {
              const anchor = await tds[4].$('a');
              if (anchor) {
                const href = await anchor.getAttribute('href');
                docText = await anchor.innerText().catch(() => null);
                if (href) docUrl = new URL(href, page.url()).toString();
              }
            } catch (e) {}
            
            out.docketEntries.push({
              filingDate,
              docketType,
              docketText,
              filingParty,
              document: docText,
              documentUrl: docUrl
            });
            
            // Capturar complaint URL
            if (/complaint/i.test(docketType) && docUrl) {
              out.complaintUrl = docUrl;
            }
          }
        }
      } catch (e) { paWarn('error extracting docket entries', e && e.message ? e.message : e); }
      
      // Event Schedule table
      try {
        const eventRows = await page.$$('#EventScheduling tbody tr');
        for (const row of eventRows) {
          const tds = await row.$$('td');
          if (tds.length >= 4) {
            out.eventSchedule.push({
              event: await tds[0].innerText().catch(() => ''),
              eventDateTime: await tds[1].innerText().catch(() => ''),
              roomNumber: await tds[2].innerText().catch(() => ''),
              hearingOfficer: await tds[3].innerText().catch(() => '')
            });
          }
        }
      } catch (e) { paLog('error extracting events'); }
      
      // Services table
      try {
        const serviceRows = await page.$$('#Services tbody tr');
        for (const row of serviceRows) {
          const tds = await row.$$('td');
          if (tds.length >= 8) {
            out.services.push({
              description: await tds[0].innerText().catch(() => ''),
              name: await tds[1].innerText().catch(() => ''),
              address: await tds[2].innerText().catch(() => ''),
              personServed: await tds[3].innerText().catch(() => ''),
              servedBy: await tds[4].innerText().catch(() => ''),
              serviceDate: await tds[5].innerText().catch(() => ''),
              serviceTime: await tds[6].innerText().catch(() => ''),
              status: await tds[7].innerText().catch(() => '')
            });
          }
        }
      } catch (e) { paLog('error extracting services'); }
      
    } catch (e) { paWarn('extractCaseDetailsFromPage failed', e && e.message ? e.message : e); }
    return out;
  }

  async collectAndProcessCases() {
    paLog('collectAndProcessCases starting');
    
    // Inicializar processed store
    try {
      await processedStore.init(this.processedPath);
      paLog('processed store initialized:', this.processedPath);
    } catch (e) {
      paWarn('failed to initialize processed store:', e && e.message ? e.message : e);
    }
    
    const details: any[] = [];
    const headless = this.config.browser.headless;
    const userAgent = this.config.browser.userAgent;
    const startUrl = this.config.urls.startUrl;

    try {
      this.browser = await chromium.launch({ headless, args: this.config.browser.args });
      this.context = await this.browser.newContext({ 
        userAgent, 
        viewport: this.config.browser.viewport,
        acceptDownloads: true 
      });
      const page = await this.context.newPage();
      await this.safeGoto(page, startUrl, {});
      await page.waitForTimeout(400);
      await this.login(page);

      // navigate using the UI (strict sequential clicks) to avoid losing authenticated session
      try {
        paLog('navigating via UI: opening Search menu');
        const searchToggle = await this.findFirstSelector(page, ['a.dropdown-toggle:has-text("Search")', 'a:has-text("Search")']);
        if (searchToggle) {
          try { await page.click(searchToggle.sel); await page.waitForTimeout(500); paLog('Search dropdown opened'); } catch (e) { paWarn('clicking Search toggle failed', e && e.message ? e.message : e); }
        } else {
          paLog('Search dropdown not found, proceeding to find Case Search directly');
        }

        // Click 'Case Search' submenu
        paLog('locating Case Search submenu');
        const caseSearch = await this.findFirstSelector(page, ['a[href*="CaseSearchByCaseNumber"]', 'a:has-text("Case Search")']);
        if (caseSearch) {
          try { await page.click(caseSearch.sel); await page.waitForTimeout(800); paLog('clicked Case Search'); } catch (e) { paWarn('click Case Search failed', e && e.message ? e.message : e); }
        } else {
          paWarn('Case Search submenu not found');
        }

        // Click 'Search Case Filings By Date'
        paLog('locating Search Case Filings By Date');
        let byDateClicked = false;
        const byDate = await this.findFirstSelector(page, ['a:has-text("Search Case Filings By Date")', 'a[href*="CaseSearchByDate"]']);
        if (byDate) {
          try { 
            await page.click(byDate.sel); 
            await page.waitForTimeout(1200); 
            paLog('clicked Search Case Filings By Date'); 
            byDateClicked = true;
          } catch (e) { paWarn('click Search By Date failed', e && e.message ? e.message : e); }
        } else {
          paWarn('Search By Date link not found, will try to navigate directly');
        }

        // If click failed, try direct navigation
        if (!byDateClicked) {
          try {
            paLog('attempting direct navigation to CaseSearchByDate.aspx');
            await page.goto('https://dcr.alleghenycounty.us/Civil/View/CaseSearchByDate.aspx', { waitUntil: 'networkidle', timeout: 15000 });
            await page.waitForTimeout(1000);
            paLog('direct navigation successful');
            byDateClicked = true;
          } catch (e) { paWarn('direct navigation failed', e && e.message ? e.message : e); }
        }

        // Wait for date form to appear (ensures we are on the right page)
        const dateRangeFound = await page.waitForSelector('#reportrange', { timeout: 10000 }).catch(() => null);
        if (!dateRangeFound) { 
          paWarn('date range picker not found - may not be on Search By Date page'); 
          throw new Error('Failed to reach Search By Date page');
        }

        // Usar dateRange do config
        const dateRange = this.config.search.dateRange || 'Last 30 Days';
        paLog(`setting date range to: ${dateRange}`);
        await page.click('#reportrange').catch(() => {});
        await page.waitForTimeout(300);
        
        // Tentar selector por data-range-key ou texto
        const dateSelector = `li[data-range-key="${dateRange}"], li:has-text("${dateRange}")`;
        await page.click(dateSelector).catch(() => {
          paWarn(`failed to click date range: ${dateRange}`);
        });
        await page.waitForTimeout(300);

        // Usar courtType e caseType do config
        const courtType = this.config.search.courtType || 'MG';
        const caseType = this.config.search.caseType || 'MF';
        
        paLog(`selecting CourtType: ${courtType}`);
        await page.selectOption('#ContentPlaceHolder1_drpdwnCourtType', courtType).catch(() => {});
        await page.waitForTimeout(300);

        paLog(`selecting CaseType: ${caseType}`);
        await page.selectOption('#ContentPlaceHolder1_drpdwnCaseType', caseType).catch(() => {});
        await page.waitForTimeout(300);

        paLog('submitting search (UI click)');
        await page.click('#ContentPlaceHolder1_btnSearch, input#ContentPlaceHolder1_btnSearch').catch(() => {});
        await page.waitForTimeout(2000);
        paLog('search submitted, waiting for results');
        await page.waitForSelector('#AllRecordsBase', { timeout: 15000 }).catch(() => { paWarn('results table (#AllRecordsBase) not found after submit'); });
      } catch (e) { paWarn('navigation via UI failed', e && e.message ? e.message : e); }

      let currentPage = 1;
      let totalCasesProcessed = 0;
      
      while (true) {
        paLog(`========== PROCESSING PAGE ${currentPage} ==========`);
        
        // Verificar número da página ativa na paginação
        try {
          const activePage = await page.$eval('.pagination li.page-number.active a', el => el.textContent?.trim());
          paLog(`confirmed active page number: ${activePage}`);
        } catch (e) {
          paLog('could not determine active page number from pagination');
        }
        
        let anchors: Array<{ href: string; text: string; casenumber?: string }> = [];
        try {
          paLog('searching for MG case anchors on page:', page.url());
          
          // First check what's on the page
          const allAnchorsCount = await page.$$('a[casenumber]').then(h => h.length);
          paLog('total anchors with casenumber attribute:', allAnchorsCount);
          
          // Try to find MG case anchors in results table
          const mgHandles = await page.$$(`#AllRecordsBase tbody tr td:nth-child(2) a[casenumber^="MG-"]`);
          if (mgHandles && mgHandles.length > 0) {
            paLog('found MG case anchors in table ->', mgHandles.length);
            for (const h of mgHandles) { 
              try { 
                const href = (await h.getAttribute('href')) || ''; 
                const text = (await h.innerText()) || ''; 
                const cn = (await h.getAttribute('casenumber')) || ''; 
                if (!href) continue; 
                anchors.push({ 
                  href: new URL(href, page.url()).toString(), 
                  text: text.trim(), 
                  casenumber: cn.trim() 
                }); 
              } catch (e) { continue; } 
            }
          } else {
            // Fallback: look for anchors with MG- pattern in casenumber attribute ONLY
            const handles = await page.$$('a[casenumber]');
            paLog('no table anchors found, checking all casenumber attributes ->', handles.length);
            
            // Debug: show first few casenumbers
            if (handles.length > 0) {
              for (let i = 0; i < Math.min(5, handles.length); i++) {
                const cn = await handles[i].getAttribute('casenumber');
                paLog(`  sample casenumber[${i}]:`, cn);
              }
            }
            
            for (const h of handles) { 
              try { 
                const cn = (await h.getAttribute('casenumber')) || ''; 
                if (!cn || !cn.startsWith('MG-')) continue; // ONLY MG cases
                
                const href = (await h.getAttribute('href')) || ''; 
                const text = (await h.innerText()) || ''; 
                if (!href) continue; 
                
                anchors.push({ 
                  href: new URL(href, page.url()).toString(), 
                  text: text.trim(), 
                  casenumber: cn.trim() 
                }); 
              } catch (e) { continue; } 
            }
            paLog('found MG case anchors ->', anchors.length);
          }
        } catch (e) { paWarn('anchor collection failed', e && e.message ? e.message : e); anchors = []; }
        
        if (anchors.length === 0) {
          paLog('no MG case anchors found on this page, checking for pagination');
        }

        for (const a of anchors) {
          const caseNumber = a.casenumber || '';
          
          // Verificar se caso já foi processado ANTES de abrir popup
          if (caseNumber) {
            const isProcessed = await processedStore.isProcessed(caseNumber);
            const entry = processedStore.getEntry(caseNumber);
            
            // MODO UPDATE: Se dateRange = "Today", sempre reprocessar casos já existentes
            if (this.isUpdateMode && isProcessed && entry) {
              paLog('🔄 UPDATE MODE: reprocessing case for updates:', caseNumber);
              this.casesProcessedThisRun.add(caseNumber); // Registrar caso processado
              // Continuar para reprocessar o caso
            }
            // MODO NORMAL: Pular casos já completamente processados
            else if (isProcessed && entry && entry.pdf_downloaded && entry.case_detail_exists) {
              paLog('✓ skipping already processed case:', caseNumber);
              continue; // Pular completamente este caso
            } else if (isProcessed) {
              paLog('⚠️  case partially processed, will update:', caseNumber);
              this.casesProcessedThisRun.add(caseNumber); // Registrar caso processado
            } else {
              // Caso novo
              this.casesProcessedThisRun.add(caseNumber); // Registrar caso processado
            }
          }
          
          try {
            paLog('opening case link ->', caseNumber || a.text || a.href);
            let popup: Page | null = null;
            // Re-query the anchor handle fresh (avoid stale handles)
            let handle: any = null;
            try {
              if (a.casenumber) handle = await page.$(`a[casenumber="${a.casenumber}"]`);
              if (!handle) {
                const cand = await page.$$('a[href]');
                for (const h of cand) {
                  const hh = (await h.getAttribute('href')) || '';
                  const full = new URL(hh, page.url()).toString();
                  if (full === a.href) { handle = h; break; }
                }
              }
            } catch (e) { paWarn('re-query anchor handle failed', e && e.message ? e.message : e); }

            if (!handle) { paWarn('anchor handle not found on page, skipping', a.href); continue; }

            try {
              const newPagePromise = this.context!.waitForEvent('page', { timeout: 15000 }).catch(() => null);
              await handle.click({ button: 'left' });
              const newPage = await newPagePromise;
              if (newPage) { popup = newPage as Page; paLog('popup opened for', a.casenumber || a.href); await popup.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {}); }
              else { paWarn('popup not opened by clicking anchor; skipping', a.href); popup = null; }
            } catch (err) { paWarn('popup open attempt failed', err && err.message ? err.message : err); popup = null; }
            if (!popup) continue;
            const item = await this.extractCaseDetailsFromPage(popup);
            item.source = a.href; if (a.casenumber) item.caseNumber = a.casenumber;
            const docket = (item.docketNumber || item.caseNumber || `case-${Date.now()}`).replace(/[\\/:*?\"<>|\\s]/g, '_');
            const caseDir = path.join(this.dataDir, docket); 
            if (!fs.existsSync(caseDir)) fs.mkdirSync(caseDir, { recursive: true }); 
            fs.writeFileSync(path.join(caseDir, 'case_detail.json'), JSON.stringify(item, null, 2), 'utf8');
            
            paLog('====== INICIANDO BUSCA DE COMPLAINT PDF PARA', docket, '======');

            // SEMPRE tentar fazer download do complaint PDF
            const pdfPath = path.join(caseDir, `${docket}_complaint.pdf`);
            const pdfExists = fs.existsSync(pdfPath);
            paLog('PDF file exists?', pdfExists, 'path:', pdfPath);
            
            if (!pdfExists) {
              paLog('attempting to download complaint PDF for', docket);
              
              // Procurar a linha do complaint no docket entries
              let complaintAnchor = null;
              try {
                paLog('searching for complaint row in docket entries...');
                const rows = await popup.$$('#DocketEntries tbody tr');
                paLog(`found ${rows.length} docket entry rows`);
                
                for (const r of rows) {
                  try {
                    const dTypeHandle = await r.$('td:nth-child(2)');
                    const dTypeText = dTypeHandle ? (await dTypeHandle.innerText()).trim() : '';
                    paLog(`checking row with docket type: "${dTypeText}"`);
                    
                    if (/complaint/i.test(dTypeText)) {
                      paLog('found complaint row! searching for link...');
                      // Tentar encontrar o link na coluna de documentos (geralmente coluna 5)
                      complaintAnchor = await r.$('td:nth-child(5) a') || await r.$('a');
                      if (complaintAnchor) {
                        const href = await complaintAnchor.getAttribute('href');
                        const text = await complaintAnchor.innerText();
                        paLog('found complaint anchor:', { href, text });
                      }
                      break;
                    }
                  } catch (e) { 
                    paWarn('error checking row', e && e.message ? e.message : e);
                    continue; 
                  }
                }
              } catch (e) { 
                paWarn('error finding complaint anchor in popup', e && e.message ? e.message : e); 
              }

              // Se encontrou o anchor do complaint, pegar URL e fazer download direto
              if (complaintAnchor) {
                try {
                  const complaintHref = await complaintAnchor.getAttribute('href');
                  if (!complaintHref) {
                    paWarn('complaint anchor has no href');
                    continue;
                  }
                  
                  // Construir URL completa do PDF
                  const complaintFullUrl = new URL(complaintHref, popup.url()).toString();
                  paLog('complaint PDF URL:', complaintFullUrl);
                  
                  // Estratégia 1: Download otimizado com limpeza de memória
                  let downloaded = false;
                  try {
                    paLog('attempting download via page.evaluate fetch...');
                    
                    // Download em chunks para economizar memória
                    const pdfBuffer = await popup.evaluate(async (url) => {
                      const response = await fetch(url);
                      if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`);
                      }
                      const arrayBuffer = await response.arrayBuffer();
                      return Array.from(new Uint8Array(arrayBuffer));
                    }, complaintFullUrl);
                    
                    if (pdfBuffer && pdfBuffer.length > 2000) {
                      // Escrever direto no arquivo e limpar buffer imediatamente
                      fs.writeFileSync(pdfPath, Buffer.from(pdfBuffer));
                      const fileSize = pdfBuffer.length;
                      pdfBuffer.length = 0; // Limpar array imediatamente
                      
                      paLog('✓ complaint PDF downloaded via page.evaluate:', pdfPath, `(${fileSize} bytes)`);
                      downloaded = true;
                      
                      // Forçar liberação de memória
                      if (global.gc) global.gc();
                    } else {
                      paLog('buffer too small (likely error page):', pdfBuffer?.length || 0, 'bytes');
                    }
                  } catch (e) {
                    paLog('page.evaluate fetch failed:', e && e.message ? e.message : e);
                  }
                  
                  // Estratégia 2: Se falhou, clicar e tentar capturar download event
                  if (!downloaded) {
                    paLog('clicking complaint anchor to try download event...');
                    const ctx = this.context!;
                    const waitDownload = popup.waitForEvent('download', { timeout: 30_000 }).catch(() => null);
                    const waitNewPage = ctx.waitForEvent('page', { timeout: 30_000 }).catch(() => null);
                    
                    await complaintAnchor.click({ button: 'left' });
                    
                    const [download, newPage] = await Promise.all([waitDownload, waitNewPage]);
                  
                    if (download) {
                      paLog('PDF download event captured');
                      await (download as Download).saveAs(pdfPath);
                      const stat = fs.statSync(pdfPath);
                      paLog('✓ complaint PDF downloaded via download event:', pdfPath, `(${stat.size} bytes)`);
                      downloaded = true;
                    } else if (newPage) {
                    paLog('complaint PDF opened in new tab');
                    const np = newPage as Page;
                    try {
                      await np.waitForLoadState('load', { timeout: 10_000 }).catch(() => null);
                      await np.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => null);
                      const pdfUrl = np.url();
                      paLog('PDF tab URL:', pdfUrl);
                      
                      let downloaded = false;
                      
                      // Estratégia 1: Fazer download direto usando context.request
                      try {
                        paLog('attempting direct download from URL:', pdfUrl);
                        
                        const response = await ctx.request.get(pdfUrl);
                        if (response.ok()) {
                          const buffer = await response.body();
                          paLog(`received buffer of ${buffer.length} bytes`);
                          
                          if (buffer.length > 0) {
                            fs.writeFileSync(pdfPath, buffer);
                            paLog('✓ complaint PDF downloaded via direct fetch:', pdfPath, `(${buffer.length} bytes)`);
                            downloaded = true;
                          } else {
                            paLog('buffer is empty, will try alternative strategy');
                          }
                        } else {
                          paLog('request failed with status:', response.status());
                        }
                      } catch (e) { paLog('direct fetch failed', e && e.message ? e.message : e); }
                      
                      // Estratégia 2: Interceptar a requisição do PDF na aba usando CDP
                      if (!downloaded) {
                        try {
                          paLog('trying to intercept PDF request via CDP...');
                          const client = await np.context().newCDPSession(np);
                          await client.send('Fetch.enable', {
                            patterns: [{ urlPattern: '*', requestStage: 'Response' }]
                          });
                          
                          let pdfBuffer: Buffer | null = null;
                          client.on('Fetch.requestPaused', async (event: any) => {
                            try {
                              const response = await client.send('Fetch.getResponseBody', { requestId: event.requestId });
                              if (response && response.body) {
                                const buf = response.base64Encoded 
                                  ? Buffer.from(response.body, 'base64')
                                  : Buffer.from(response.body);
                                if (buf.length > 1000) {
                                  pdfBuffer = buf;
                                  paLog('intercepted PDF buffer:', buf.length, 'bytes');
                                }
                              }
                              await client.send('Fetch.continueRequest', { requestId: event.requestId });
                            } catch (e) {
                              await client.send('Fetch.continueRequest', { requestId: event.requestId }).catch(() => {});
                            }
                          });
                          
                          await np.reload({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
                          await np.waitForTimeout(3000);
                          
                          if (pdfBuffer && pdfBuffer.length > 0) {
                            fs.writeFileSync(pdfPath, pdfBuffer);
                            paLog('✓ complaint PDF downloaded via CDP intercept:', pdfPath, `(${pdfBuffer.length} bytes)`);
                            downloaded = true;
                          }
                          
                          await client.detach();
                        } catch (e) { paLog('CDP intercept failed', e && e.message ? e.message : e); }
                      }
                      
                        if (!downloaded) {
                          paWarn('all download strategies failed for', docket);
                        }
                      } finally { 
                        try { 
                          await np.close(); 
                          paLog('closed complaint PDF tab for', docket);
                        } catch (e) {} 
                      }
                    } else {
                      paWarn('no download or new tab opened after clicking complaint anchor');
                    }
                  } // fim do if (!downloaded)
                } catch (e) {
                  paWarn('error clicking complaint anchor', e && e.message ? e.message : e);
                }
              } else {
                paWarn('no complaint anchor found in popup for', docket);
              }
            }

            details.push(item);
            
            // Marcar caso como processado no log
            if (item.caseNumber) {
              const pdfPath = path.join(caseDir, `${docket}_complaint.pdf`);
              const pdfExists = fs.existsSync(pdfPath);
              const pdfSize = pdfExists ? fs.statSync(pdfPath).size : 0;
              
              await processedStore.markProcessed(item.caseNumber, {
                processed_at: new Date().toISOString(),
                caseNumber: item.caseNumber,
                pdf_downloaded: pdfExists && pdfSize > 3000,
                pdf_path: pdfExists ? pdfPath : undefined,
                pdf_size: pdfSize || undefined,
                case_detail_exists: true,
                case_detail_path: path.join(caseDir, 'case_detail.json'),
                last_updated: new Date().toISOString()
              });
              paLog('✓ marked case as processed:', item.caseNumber);
            }
            
            // Salvar a cada 5 cases para liberar memória mais frequentemente
            if (details.length >= 5) {
              const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
              const batchFile = path.join(this.baseDataDir, `batch_${timestamp}.json`);
              fs.writeFileSync(batchFile, JSON.stringify(details, null, 2));
              paLog(`saved batch of ${details.length} cases to ${batchFile}`);
              details.length = 0; // Limpar array completamente
              if (global.gc) global.gc(); // Forçar garbage collection
            }
            
            try { 
              await popup.close(); 
              paLog('closed case popup for', docket);
            } catch (e) { paWarn('error closing case popup', e && e.message ? e.message : e); }
            await page.waitForTimeout(120);
            
            totalCasesProcessed++;
          } catch (e) { paWarn('error processing anchor', a.href, e && e.message ? e.message : e); }
        }
        
        paLog(`page ${currentPage} completed. Total cases processed so far: ${totalCasesProcessed}`);

        // Se não encontrou nenhum caso na página atual E é a primeira página, sair
        if (anchors.length === 0 && currentPage === 1) {
          paLog('⚠ no cases found on first page - may be no cases for selected date range');
          paLog('exiting pagination loop');
          break;
        }

        // Verificar se há próxima página
        try {
          paLog('checking for pagination...');
          
          // Procurar botão "next" (›) na paginação
          const nextButton = await page.$('.pagination li.page-next a');
          
          if (nextButton) {
            // Verificar se o botão está ativo (não desabilitado)
            const parentLi = await page.$('.pagination li.page-next');
            const isDisabled = parentLi ? await parentLi.evaluate(el => el.classList.contains('disabled')) : false;
            
            if (!isDisabled) {
              paLog('next page button found, clicking to navigate...');
              
              // Clicar e aguardar navegação
              try {
                // Estratégia 1: Aguardar reload da tabela
                const oldTableHandle = await page.$('#AllRecordsBase');
                await nextButton.click();
                
                // Aguardar a tabela recarregar (o elemento deve ficar stale)
                await page.waitForTimeout(1000);
                
                // Aguardar nova tabela aparecer
                await page.waitForSelector('#AllRecordsBase', { timeout: 10000, state: 'visible' });
                await page.waitForTimeout(1500); // Aguardar JavaScript completar
                
                // Verificar se o número da página mudou
                const newActivePage = await page.$eval('.pagination li.page-number.active a', el => el.textContent?.trim()).catch(() => null);
                
                currentPage++;
                paLog(`✓ navigated to page ${currentPage} (pagination shows: ${newActivePage})`);
                continue; // Continuar loop para processar próxima página
              } catch (e) {
                paWarn('failed to navigate to next page:', e && e.message ? e.message : e);
              }
            } else {
              paLog('next button is disabled, no more pages');
            }
          } else {
            paLog('no pagination found, single page only');
          }
        } catch (e) { 
          paWarn('pagination check failed', e && e.message ? e.message : e); 
        }
        
        paLog('no more pages to process, exiting loop');
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

  async downloadAllComplaintPDFs(details: any[]) {
    paLog('========== FASE: DOWNLOAD DE COMPLAINT PDFs ==========');
    
    // Buscar todos os casos processados
    const caseDirs = fs.readdirSync(this.dataDir).filter(name => {
      const fullPath = path.join(this.dataDir, name);
      return fs.statSync(fullPath).isDirectory() && name.startsWith('MG-');
    });
    
    paLog(`found ${caseDirs.length} cases to check for PDF download`);
    
    let downloadedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < caseDirs.length; i++) {
      const caseNumber = caseDirs[i];
      const casePath = path.join(this.dataDir, caseNumber);
      const pdfPath = path.join(casePath, `${caseNumber}_COMPLAINT.pdf`);
      
      paLog(`[${i + 1}/${caseDirs.length}] checking ${caseNumber}...`);
      
      // Verificar se PDF já existe
      if (fs.existsSync(pdfPath)) {
        paLog('  ⊘ PDF already exists, skipping');
        skippedCount++;
        continue;
      }
      
      // Carregar case detail
      const caseDetailPath = path.join(casePath, 'case_detail.json');
      if (!fs.existsSync(caseDetailPath)) {
        paWarn('  case_detail.json not found, skipping');
        errorCount++;
        continue;
      }
      
      try {
        const caseDetail = JSON.parse(fs.readFileSync(caseDetailPath, 'utf8'));
        
        if (!caseDetail.complaintUrl) {
          paWarn('  no complaint URL found in case detail');
          errorCount++;
          continue;
        }
        
        paLog(`  → downloading from: ${caseDetail.complaintUrl}`);
        
        // Baixar PDF usando Playwright
        const page = await this.context.newPage();
        
        try {
          // Navegar para a URL do PDF
          const response = await page.goto(caseDetail.complaintUrl, {
            waitUntil: 'networkidle',
            timeout: 60000
          });
          
          if (!response || !response.ok()) {
            throw new Error(`Failed to load PDF: ${response?.status()}`);
          }
          
          // Aguardar o PDF carregar
          await page.waitForTimeout(2000);
          
          // Baixar o conteúdo
          const buffer = await response.body();
          
          // Salvar arquivo
          fs.writeFileSync(pdfPath, buffer);
          
          const fileSize = fs.statSync(pdfPath).size;
          paLog(`  ✓ downloaded: ${Math.round(fileSize / 1024)} KB`);
          downloadedCount++;
          
          // Atualizar processed store com download bem-sucedido
          try {
            const entry = processedStore.getEntry(caseNumber);
            if (entry) {
              await processedStore.markProcessed(caseNumber, {
                ...entry,
                pdf_downloaded: true,
                pdf_download_date: new Date().toISOString(),
                pdf_path: pdfPath,
                pdf_size: fileSize,
                last_updated: new Date().toISOString()
              });
            }
          } catch (storeError) {
            paWarn('  failed to update processed store:', storeError);
          }
          
        } catch (downloadError: any) {
          paWarn(`  failed to download PDF: ${downloadError.message}`);
          errorCount++;
          
          // Mapear erro de download no processed store
          try {
            const entry = processedStore.getEntry(caseNumber);
            if (entry) {
              await processedStore.markProcessed(caseNumber, {
                ...entry,
                pdf_downloaded: false,
                pdf_download_error: downloadError.message,
                pdf_download_error_at: new Date().toISOString(),
                last_updated: new Date().toISOString()
              });
            }
          } catch (storeError) {
            paWarn('  failed to update processed store:', storeError);
          }
          
        } finally {
          await page.close();
        }
        
      } catch (e: any) {
        paWarn(`  error processing case: ${e.message}`);
        errorCount++;
      }
      
      // Delay entre downloads
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Forçar garbage collection a cada 5 casos para liberar memória
      if ((i + 1) % 5 === 0 && global.gc) {
        global.gc();
        paLog(`  🗑️  garbage collection triggered (${i + 1}/${caseDirs.length})`);
      }
    }
    
    paLog(`========== PDF DOWNLOAD SUMMARY ==========`);
    paLog(`  ✓ Downloaded: ${downloadedCount}`);
    paLog(`  ⊘ Skipped (already exist): ${skippedCount}`);
    paLog(`  ✗ Errors: ${errorCount}`);
    paLog(`  Total processed: ${caseDirs.length}`);
    
    return downloadedCount;
  }
  
  async extractAllPDFTexts() {
    paLog('========== FASE: EXTRAÇÃO DE TEXTO DOS PDFs ==========');
    
    // Buscar todos os casos processados
    const caseDirs = fs.readdirSync(this.dataDir).filter(name => {
      const fullPath = path.join(this.dataDir, name);
      return fs.statSync(fullPath).isDirectory() && name.startsWith('MG-');
    });
    
    paLog(`found ${caseDirs.length} case directories to check for PDF extraction`);
    
    let extractedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < caseDirs.length; i++) {
      const caseDir = caseDirs[i];
      const casePath = path.join(this.dataDir, caseDir);
      const pdfPath = path.join(casePath, `${caseDir}_complaint.pdf`);
      const txtPath = path.join(casePath, `${caseDir}_extracted.txt`);
      const jsonPath = path.join(casePath, `${caseDir}_extracted.json`);
      
      // Verificar se já foi extraído
      if (fs.existsSync(txtPath)) {
        skippedCount++;
        continue;
      }
      
      // Verificar se PDF existe
      if (!fs.existsSync(pdfPath)) {
        paWarn(`PDF not found for ${caseDir}, skipping extraction`);
        errorCount++;
        continue;
      }
      
      try {
        paLog(`[${i + 1}/${caseDirs.length}] extracting text from ${caseDir}...`);
        await ensureExtractAndSave(pdfPath, jsonPath, txtPath);
        extractedCount++;
        paLog(`✓ extracted ${caseDir}`);
        
        // Atualizar processed store com extração bem-sucedida
        try {
          const entry = processedStore.getEntry(caseDir);
          if (entry) {
            const txtSize = fs.existsSync(txtPath) ? fs.statSync(txtPath).size : 0;
            await processedStore.markProcessed(caseDir, {
              ...entry,
              txt_extracted: true,
              txt_extraction_date: new Date().toISOString(),
              txt_path: txtPath,
              txt_size: txtSize,
              last_updated: new Date().toISOString()
            });
          }
        } catch (storeError) {
          paWarn('  failed to update processed store:', storeError);
        }
        
      } catch (e) {
        const errorMsg = e && e.message ? e.message : String(e);
        paWarn(`failed to extract ${caseDir}:`, errorMsg);
        errorCount++;
        
        // Mapear erro de extração no processed store
        try {
          const entry = processedStore.getEntry(caseDir);
          if (entry) {
            await processedStore.markProcessed(caseDir, {
              ...entry,
              txt_extracted: false,
              txt_extraction_error: errorMsg,
              txt_extraction_error_at: new Date().toISOString(),
              last_updated: new Date().toISOString()
            });
          }
        } catch (storeError) {
          paWarn('  failed to update processed store:', storeError);
        }
      }
      
      // Forçar GC a cada 10 extrações
      if ((i + 1) % 10 === 0 && global.gc) {
        global.gc();
      }
    }
    
    paLog(`========== EXTRACTION SUMMARY ==========`);
    paLog(`  ✓ Extracted: ${extractedCount}`);
    paLog(`  ⊘ Skipped (already extracted): ${skippedCount}`);
    paLog(`  ✗ Errors: ${errorCount}`);
    paLog(`  Total processed: ${caseDirs.length}`);
    
    return extractedCount;
  }
  
  async sendWebhooksInBatches() {
    paLog('========== FASE: ENVIO DE WEBHOOKS ==========');
    
    // Buscar todos os casos processados
    let caseDirs = fs.readdirSync(this.dataDir).filter(name => {
      const fullPath = path.join(this.dataDir, name);
      return fs.statSync(fullPath).isDirectory() && name.startsWith('MG-');
    });
    
    // No UPDATE MODE, enviar APENAS casos processados nesta execução
    if (this.isUpdateMode) {
      const casesThisRun = Array.from(this.casesProcessedThisRun);
      paLog(`🔄 UPDATE MODE: filtering to ${casesThisRun.length} cases found in today's search`);
      paLog(`   (Total cases in directory: ${caseDirs.length})`);
      caseDirs = caseDirs.filter(caseNum => this.casesProcessedThisRun.has(caseNum));
    }
    
    paLog(`found ${caseDirs.length} cases to send to webhook`);
    
    let sentCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    const webhookUrl = process.env.WEBHOOK_URL || 'https://n8n.arthuragrelli.com/webhook/scraping';
    
    for (let i = 0; i < caseDirs.length; i++) {
      const caseNumber = caseDirs[i];
      const casePath = path.join(this.dataDir, caseNumber);
      
      paLog(`[${i + 1}/${caseDirs.length}] processing ${caseNumber}...`);
      
      try {
        // Carregar dados do caso
        const caseDetailPath = path.join(casePath, 'case_detail.json');
        const enrichmentPath = path.join(casePath, 'property_enrichment.json');
        const extractedPath = path.join(casePath, `${caseNumber}_extracted.txt`);
        const pdfPath = path.join(casePath, `${caseNumber}_COMPLAINT.pdf`);
        
        if (!fs.existsSync(caseDetailPath)) {
          paWarn('case_detail.json not found, skipping:', caseNumber);
          skippedCount++;
          continue;
        }
        
        const caseDetail = JSON.parse(fs.readFileSync(caseDetailPath, 'utf8'));
        
        // Verificar se já foi enviado antes
        const entry = processedStore.getEntry(caseNumber);
        const alreadySent = entry && entry.webhook_sent;
        const sendType = alreadySent ? 'update' : 'new';
        
        // Verificar extração
        const extractionExists = fs.existsSync(extractedPath);
        let extractionSuccessful = false;
        if (extractionExists) {
          try {
            const txtContent = fs.readFileSync(extractedPath, 'utf8');
            extractionSuccessful = txtContent && txtContent.length > 50;
          } catch (e) {
            extractionSuccessful = false;
          }
        }
        const pdfExists = fs.existsSync(pdfPath);
        
        // Para casos NOVOS: exigir PDF e extração
        if (sendType === 'new') {
          if (!pdfExists || !extractionSuccessful) {
            paWarn(`  ⊘ skipping ${caseNumber} - missing PDF or extraction (pdfExists: ${pdfExists}, extractionSuccessful: ${extractionSuccessful})`);
            skippedCount++;
            continue;
          }
        }
        
        // Para casos UPDATE: apenas exigir extração
        if (sendType === 'update') {
          if (!extractionSuccessful) {
            paWarn(`  ⊘ skipping ${caseNumber} - missing extraction for update`);
            skippedCount++;
            continue;
          }
        }
        
        // Carregar PDF TXT
        const txtContent = extractionExists ? fs.readFileSync(extractedPath, 'utf8') : '';
        
        // Construir payload base
        const payload: any = {
          Categoria: 'Foreclosure',
          Status: sendType === 'new' ? 'Novo Case' : 'Update Case',
          Estado: 'PA',
          Cidade: this.extractCity(caseDetail),
          'Case Number': caseNumber,
          Source: 'alleghenycounty.us'
        };
        
        // Para casos NOVOS: incluir PDF Original em base64
        if (sendType === 'new' && pdfExists) {
          try {
            const pdfBase64 = fs.readFileSync(pdfPath).toString('base64');
            payload['PDF Original'] = pdfBase64;
            paLog('  ✓ included PDF Original (base64)');
          } catch (e) {
            paWarn('  failed to load PDF as base64:', e);
          }
        }
        
        // Incluir PDF TXT (para ambos new e update)
        payload['PDF TXT'] = txtContent;
        paLog('  ✓ included PDF TXT');
        
        // Metadata
        payload.Metadata = {
          case_number: caseDetail.caseNumber,
          case_description: caseDetail.caseDescription,
          filing_date: caseDetail.filingDate,
          case_type: caseDetail.caseType,
          current_status: caseDetail.currentStatus,
          judge: caseDetail.judge,
          amount_in_dispute: caseDetail.amountInDispute,
          litigants: caseDetail.litigants,
          attorneys: caseDetail.attorneys,
          docket_entries_count: caseDetail.docketEntries?.length || 0,
          complaint_url: caseDetail.complaintUrl
        };
        
        // Adicionar enrichment data se existir (apenas para casos novos)
        if (sendType === 'new' && fs.existsSync(enrichmentPath)) {
          try {
            const enrichment = JSON.parse(fs.readFileSync(enrichmentPath, 'utf8'));
            if (enrichment.enrichment_data && !enrichment.error && enrichment.match_score > 0) {
              payload['Enrichment Data'] = enrichment.enrichment_data;
              paLog('  ✓ included enrichment data in payload');
            }
          } catch (e) {
            paWarn('  failed to load enrichment data:', e);
          }
        }
        
        // Enviar webhook
        try {
          const response = await axios.post(webhookUrl, payload, { timeout: 30000 });
          paLog(`  ✓ webhook sent successfully (${sendType}):`, response.status);
          sentCount++;
          
          // Marcar como enviado COM SUCESSO
          if (entry) {
            await processedStore.markProcessed(caseNumber, {
              ...entry,
              webhook_sent: true,
              webhook_sent_at: new Date().toISOString(),
              webhook_error: null, // Limpar erro anterior se existir
              last_updated: new Date().toISOString()
            });
          }
        } catch (e) {
          const errorMsg = e && e.message ? e.message : String(e);
          paWarn('  failed to send webhook:', errorMsg);
          errorCount++;
          
          // Mapear erro para reenvio posterior
          if (entry) {
            await processedStore.markProcessed(caseNumber, {
              ...entry,
              webhook_sent: false, // Marcar como NÃO enviado
              webhook_error: errorMsg,
              webhook_error_at: new Date().toISOString(),
              last_updated: new Date().toISOString()
            });
          }
        }
      
      } catch (e) {
        paWarn(`failed to process ${caseNumber}:`, e && e.message ? e.message : e);
        errorCount++;
      }
      
      // Delay de 5 segundos entre webhooks para evitar sobrecarga
      await new Promise(resolve => setTimeout(resolve, 5000));
    }    paLog(`========== WEBHOOK SUMMARY ==========`);
    paLog(`  ✓ Sent: ${sentCount}`);
    paLog(`  ⊘ Skipped: ${skippedCount}`);
    paLog(`  ✗ Errors: ${errorCount}`);
    paLog(`  Total processed: ${caseDirs.length}`);
    
    return sentCount;
  }
  
  private extractCity(caseDetail: any): string {
    // Tentar extrair cidade do endereço dos defendants
    if (caseDetail.litigants && caseDetail.litigants.length > 0) {
      for (const litigant of caseDetail.litigants) {
        if (litigant.type && litigant.type.toLowerCase().includes('defendant')) {
          const address = litigant.address || '';
          // Formato típico: "1234 Street Name City PA 15000"
          const match = address.match(/\s([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s+PA\s+\d{5}/);
          if (match) return match[1];
        }
      }
    }
    return 'Unknown';
  }

  // ==================== ENRICHMENT METHODS ====================
  
  /**
   * Normaliza nome de pessoa para comparação (remove títulos, Jr, Sr, etc)
   * Exemplo: "Smith Jr. John" → "smith john"
   */
  private normalizeNameForComparison(name: string): string {
    if (!name) return '';
    
    return name
      .toLowerCase()
      .replace(/\b(jr|sr|ii|iii|iv|mr|mrs|ms|dr|prof|esq|unknown|heirs|estate|deceased)\\.?\\b/gi, '')
      .replace(/[^a-z0-9\s]/g, ' ') // Remove pontuação
      .replace(/\s+/g, ' ') // Normalizar espaços
      .trim();
  }

  /**
   * Calcula similaridade entre dois nomes (0-100%)
   * Compara palavras em comum (sobrenomes geralmente batem)
   */
  private calculateNameSimilarity(name1: string, name2: string): number {
    const norm1 = this.normalizeNameForComparison(name1);
    const norm2 = this.normalizeNameForComparison(name2);
    
    if (!norm1 || !norm2) return 0;
    
    const words1 = norm1.split(' ').filter(w => w.length > 1); // Ignorar iniciais
    const words2 = norm2.split(' ').filter(w => w.length > 1);
    
    if (words1.length === 0 || words2.length === 0) return 0;
    
    // Contar quantas palavras batem
    let matches = 0;
    for (const w1 of words1) {
      for (const w2 of words2) {
        // Match exato ou um contém o outro (ex: "Smith" em "Smithson")
        if (w1 === w2 || w1.includes(w2) || w2.includes(w1)) {
          matches++;
          break; // Não contar múltiplas vezes
        }
      }
    }
    
    // Usar o menor número de palavras como base
    const baseWords = Math.min(words1.length, words2.length);
    return baseWords > 0 ? (matches / baseWords) * 100 : 0;
  }
  
  /**
   * Normaliza números ordinais BIDIRECIONALMENTE
   * 7th → ["7th", "Seventh", "7TH"]
   * Seventh → ["Seventh", "7th", "7TH"]
   */
  private normalizeOrdinalStreetName(street: string): string[] {
    const ordinalMap: Record<string, string> = {
      '1st': 'First', '2nd': 'Second', '3rd': 'Third', '4th': 'Fourth',
      '5th': 'Fifth', '6th': 'Sixth', '7th': 'Seventh', '8th': 'Eighth',
      '9th': 'Ninth', '10th': 'Tenth', '11th': 'Eleventh', '12th': 'Twelfth',
      '13th': 'Thirteenth', '14th': 'Fourteenth', '15th': 'Fifteenth',
      '16th': 'Sixteenth', '17th': 'Seventeenth', '18th': 'Eighteenth',
      '19th': 'Nineteenth', '20th': 'Twentieth', '21st': 'Twenty-First',
      '22nd': 'Twenty-Second', '23rd': 'Twenty-Third', '24th': 'Twenty-Fourth',
      '25th': 'Twenty-Fifth', '30th': 'Thirtieth', '40th': 'Fortieth',
      '50th': 'Fiftieth', '60th': 'Sixtieth', '70th': 'Seventieth',
      '80th': 'Eightieth', '90th': 'Ninetieth', '100th': 'One Hundredth'
    };
    
    const variations: string[] = [street]; // Original sempre primeiro
    
    // Criar mapa reverso (First → 1st, Seventh → 7th, etc)
    const reverseMap: Record<string, string> = {};
    for (const [num, word] of Object.entries(ordinalMap)) {
      reverseMap[word.toLowerCase()] = num;
    }
    
    const streetLower = street.toLowerCase();
    
    // Se é numérico (7th), adicionar versão por extenso
    for (const [ordinal, written] of Object.entries(ordinalMap)) {
      const pattern = new RegExp(`\\b${ordinal}\\b`, 'gi');
      if (pattern.test(street)) {
        variations.push(street.replace(pattern, written));
        variations.push(street.replace(pattern, ordinal.toUpperCase())); // 7TH
        break;
      }
    }
    
    // Se é por extenso (Seventh), adicionar versão numérica
    for (const [written, ordinal] of Object.entries(reverseMap)) {
      const pattern = new RegExp(`\\b${written}\\b`, 'i');
      if (pattern.test(streetLower)) {
        variations.push(street.replace(pattern, ordinal));
        variations.push(street.replace(pattern, ordinal.toUpperCase())); // 7TH
        break;
      }
    }
    
    // Remover duplicatas mantendo ordem
    return [...new Set(variations)];
  }

  /**
   * Extrai número da casa e primeira palavra do nome da rua do endereço
   * Exemplo: "2547 Riddle Run Road Tarentum PA 15084" → { houseNumber: "2547", streetName: "Riddle" }
   * IMPORTANTE: Remove espaços extras que podem causar falhas na busca
   */
  private parseDefendantAddress(address: string): { houseNumber: string; streetName: string; streetVariations: string[] } | null {
    if (!address) return null;
    
    // Normalizar espaços múltiplos e trim
    const normalized = address.trim().replace(/\s+/g, ' ');
    
    // Extrair número da casa (primeiro número encontrado)
    const numberMatch = normalized.match(/^(\d+)/);
    if (!numberMatch) return null;
    
    const houseNumber = numberMatch[1].trim();
    
    // Remover número e extrair nome completo da rua (até encontrar tipo de rua + 1 palavra ou cidade)
    // Exemplo: "Fifth Avenue" ou "Dora Street" ou "Martin Luther King Boulevard"
    const withoutNumber = normalized.replace(/^\d+\s*/, '').trim();
    const streetWords = withoutNumber.split(/\s+/);
    
    // Tipos de rua conhecidos (última palavra antes da cidade)
    const streetTypes = ['STREET', 'ST', 'AVENUE', 'AVE', 'ROAD', 'RD', 'DRIVE', 'DR', 'BOULEVARD', 'BLVD', 'LANE', 'LN', 'COURT', 'CT', 'PLACE', 'PL', 'WAY', 'CIRCLE', 'CIR', 'TERRACE', 'TER', 'PARKWAY', 'PKWY'];
    
    // Cidades conhecidas do Allegheny County
    const knownCities = ['PITTSBURGH', 'MCKEESPORT', 'DUQUESNE', 'HOMESTEAD', 'VERSAILLES', 'MIFFLIN', 'WHITAKER', 'CARNEGIE', 'CORAOPOLIS', 'TARENTUM', 'BETHEL', 'PARK', 'GIBSONIA', 'ALLISON', 'WEXFORD'];
    
    const relevantWords: string[] = [];
    let foundStreetType = false;
    
    for (let i = 0; i < streetWords.length; i++) {
      const word = streetWords[i].toUpperCase();
      
      // Parar antes de códigos de estado (PA, OH) ou CEP
      if (/^[A-Z]{2}$/.test(word) && i > 0) break;
      if (/^\d{5}$/.test(word)) break;
      
      // Adicionar palavra atual
      relevantWords.push(streetWords[i]);
      
      // Se encontrou tipo de rua, parar após incluí-lo
      if (streetTypes.includes(word)) {
        foundStreetType = true;
        break;
      }
      
      // Se já tem 2+ palavras e próxima palavra é cidade, parar
      if (i < streetWords.length - 1 && relevantWords.length >= 2) {
        const nextWord = streetWords[i + 1].toUpperCase();
        if (knownCities.includes(nextWord)) {
          break;
        }
      }
      
      // Limite máximo de 3 palavras se não encontrou tipo de rua
      if (relevantWords.length >= 3 && !foundStreetType) break;
    }
    
    if (relevantWords.length === 0) return null;
    
    const streetName = relevantWords.join(' ');
    
    // Gerar variações do nome da rua com normalizações
    const streetVariations = this.generateStreetNameVariations(streetName);
    
    return { houseNumber, streetName, streetVariations };
  }
  
  /**
   * Gera variações do nome da rua com ordinais e tipos de rua normalizados
   * Exemplo: "Fifth Avenue" -> ["Fifth Avenue", "Fifth AVE", "5th Avenue", "5th AVE", "5TH AVENUE", "5TH AVE"]
   */
  private generateStreetNameVariations(streetName: string): string[] {
    const variations: string[] = [];
    
    // Mapa de tipos de rua e suas abreviações
    const streetTypeMap: Record<string, string[]> = {
      'avenue': ['Avenue', 'AVE', 'Ave'],
      'street': ['Street', 'ST', 'St'],
      'road': ['Road', 'RD', 'Rd'],
      'drive': ['Drive', 'DR', 'Dr'],
      'boulevard': ['Boulevard', 'BLVD', 'Blvd'],
      'lane': ['Lane', 'LN', 'Ln'],
      'court': ['Court', 'CT', 'Ct'],
      'place': ['Place', 'PL', 'Pl'],
      'way': ['Way', 'WAY'],
      'circle': ['Circle', 'CIR', 'Cir'],
      'terrace': ['Terrace', 'TER', 'Ter'],
      'parkway': ['Parkway', 'PKWY', 'Pkwy']
    };
    
    const words = streetName.split(/\s+/);
    const lastWord = words[words.length - 1]?.toLowerCase();
    
    // Verificar se última palavra é um tipo de rua
    let streetTypeVariations: string[] = [];
    for (const [baseType, abbrevs] of Object.entries(streetTypeMap)) {
      if (lastWord === baseType || abbrevs.some(a => a.toLowerCase() === lastWord)) {
        streetTypeVariations = abbrevs;
        break;
      }
    }
    
    // Se encontrou tipo de rua, gerar variações
    if (streetTypeVariations.length > 0) {
      const streetBase = words.slice(0, -1).join(' ');
      
      // Para cada variação do tipo de rua
      for (const streetTypeVar of streetTypeVariations) {
        // Gerar variações de ordinais para a base
        const baseVariations = this.normalizeOrdinalStreetName(streetBase);
        
        for (const baseVar of baseVariations) {
          variations.push(`${baseVar} ${streetTypeVar}`);
        }
      }
    } else {
      // Sem tipo de rua detectado, apenas normalizar ordinais
      variations.push(...this.normalizeOrdinalStreetName(streetName));
    }
    
    // Remover duplicatas preservando ordem
    return [...new Set(variations)];
  }
  
  /**
   * Registra casos que não tiveram enriquecimento bem-sucedido
   */
  private logFailedEnrichment(caseNumber: string, address: string, reason: string, searchParams?: any) {
    const logPath = path.join(this.baseDataDir, 'failed_enrichments.jsonl');
    const entry = {
      timestamp: new Date().toISOString(),
      case_number: caseNumber,
      defendant_address: address,
      reason: reason,
      search_params: searchParams || null
    };
    
    try {
      fs.appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf8');
      paLog('logged failed enrichment:', caseNumber, '-', reason);
    } catch (e) {
      paWarn('failed to write to failed_enrichments.jsonl:', e);
    }
  }

  /**
   * Normaliza endereço para comparação (remove pontuação, converte uppercase, normaliza abreviações)
   */
  private normalizeAddressForComparison(address: string): string {
    let normalized = address
      .toUpperCase()
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    
    // Normalizar abreviações comuns de rua
    const abbreviations: Record<string, string> = {
      'ST': 'STREET',
      'STR': 'STREET',
      'DR': 'DRIVE',
      'RD': 'ROAD',
      'AVE': 'AVENUE',
      'BLVD': 'BOULEVARD',
      'LN': 'LANE',
      'CT': 'COURT',
      'PL': 'PLACE',
      'TER': 'TERRACE',
      'WAY': 'WAY',
      'CIR': 'CIRCLE',
      'PKWY': 'PARKWAY'
    };
    
    // Substituir abreviações no final do endereço
    const words = normalized.split(' ');
    for (let i = 0; i < words.length; i++) {
      if (abbreviations[words[i]]) {
        words[i] = abbreviations[words[i]];
      }
    }
    
    return words.join(' ');
  }

  /**
   * Calcula similaridade entre dois endereços (0-100%)
   * Foca no número da casa e nome da rua, ignorando cidade/estado/zip
   */
  private calculateAddressSimilarity(addr1: string, addr2: string): number {
    const norm1 = this.normalizeAddressForComparison(addr1);
    const norm2 = this.normalizeAddressForComparison(addr2);
    
    // Extrair apenas a parte relevante (número + rua), ignorando cidade/estado/zip
    // Exemplo: "39 MAPLEWOOD STREET PITTSBURGH PA 15223" -> "39 MAPLEWOOD STREET"
    const extractStreetPart = (normalized: string): string => {
      const words = normalized.split(' ');
      // Pegar até encontrar um padrão de cidade/estado (PA, OH, etc) ou CEP
      const relevantWords: string[] = [];
      for (const word of words) {
        // Parar ao encontrar PA, OH, estado de 2 letras ou número de 5 dígitos (CEP)
        if (/^[A-Z]{2}$/.test(word) && word !== 'ST' && word !== 'DR') break;
        if (/^\d{5}$/.test(word)) break;
        // Parar em cidades conhecidas (incluindo multi-word cities)
        if (['PITTSBURGH', 'MCKEESPORT', 'DUQUESNE', 'HOMESTEAD', 'VERSAILLES', 'MIFFLIN', 'KENSINGTON'].includes(word)) break;
        relevantWords.push(word);
      }
      return relevantWords.join(' ');
    };
    
    const street1 = extractStreetPart(norm1);
    const street2 = extractStreetPart(norm2);
    
    const words1 = street1.split(' ').filter(w => w.length > 0);
    const words2 = street2.split(' ').filter(w => w.length > 0);
    
    // Contar matches
    let matches = 0;
    for (const w1 of words1) {
      if (words2.some(w2 => w2 === w1 || w2.includes(w1) || w1.includes(w2))) {
        matches++;
      }
    }
    
    // Usar o menor número de palavras como base (geralmente o resultado da busca tem menos info)
    const baseWords = Math.min(words1.length, words2.length);
    return baseWords > 0 ? (matches / baseWords) * 100 : 0;
  }

  /**
   * Extrai dados completos da página de detalhes da propriedade
   * Usa seletores específicos para capturar todos os campos
   */
  private async extractFullPropertyDetails(page: Page): Promise<PropertyEnrichmentData> {
    await page.waitForTimeout(1000);
    
    const detailData = await page.evaluate(() => {
      const result: any = {};
      
      // === INFO PANE (topo da página) ===
      let el = document.getElementById('MainContent_InfoPane_parcelIDLbl');
      if (el) result.parcel_id = (el.textContent || '').replace('Parcel ID:', '').trim();
      
      el = document.getElementById('MainContent_InfoPane_parcelAltIDLbl');
      if (el && el.textContent && el.textContent.trim()) result.parcel_alt_id = el.textContent.trim();
      
      el = document.getElementById('MainContent_InfoPane_addressLbl');
      if (el) result.property_address = (el.textContent || '').replace('Address:', '').trim();
      
      el = document.getElementById('MainContent_InfoPane_municipalityLbl');
      if (el) result.municipality = (el.textContent || '').replace('Municipality:', '').trim();
      
      el = document.getElementById('MainContent_InfoPane_ownerLbl');
      if (el) result.owner_name = (el.textContent || '').replace('Owner Name:', '').trim();
      
      // === GENERAL INFORMATION - TABLE 1 ===
      el = document.getElementById('MainContent_schoolDistrictLbl');
      if (el && el.textContent && el.textContent.trim()) result.school_district = el.textContent.trim();
      
      el = document.getElementById('MainContent_taxCodeLbl');
      if (el && el.textContent && el.textContent.trim()) result.tax_code = el.textContent.trim();
      
      el = document.getElementById('MainContent_classLbl');
      if (el && el.textContent && el.textContent.trim()) result.class = el.textContent.trim();
      
      el = document.getElementById('MainContent_useCodeLbl');
      if (el && el.textContent && el.textContent.trim()) result.use_code = el.textContent.trim();
      
      el = document.getElementById('MainContent_homesteadLbl');
      if (el && el.textContent && el.textContent.trim()) result.homestead = el.textContent.trim();
      
      el = document.getElementById('MainContent_farmsteadLbl');
      if (el && el.textContent && el.textContent.trim()) result.farmstead = el.textContent.trim();
      
      el = document.getElementById('MainContent_cleanLbl');
      if (el && el.textContent && el.textContent.trim()) result.clean_and_green = el.textContent.trim();
      
      el = document.getElementById('MainContent_otherAbatementLbl');
      if (el && el.textContent && el.textContent.trim()) result.other_abatement = el.textContent.trim();
      
      // === GENERAL INFORMATION - TABLE 2 ===
      el = document.getElementById('MainContent_neighborhoodCodeLbl');
      if (el && el.textContent && el.textContent.trim()) result.neighborhood_code = el.textContent.trim();
      
      el = document.getElementById('MainContent_ownerCodeLbl');
      if (el && el.textContent && el.textContent.trim()) result.owner_code = el.textContent.trim();
      
      el = document.getElementById('MainContent_recordingDateLbl');
      if (el && el.textContent && el.textContent.trim()) result.recording_date = el.textContent.trim();
      
      el = document.getElementById('MainContent_saleDateLbl');
      if (el && el.textContent && el.textContent.trim()) result.sale_date = el.textContent.trim();
      
      el = document.getElementById('MainContent_salePrice');
      if (el && el.textContent && el.textContent.trim()) result.sale_price = el.textContent.trim();
      
      el = document.getElementById('MainContent_deedBookLbl');
      if (el && el.textContent && el.textContent.trim()) result.deed_book = el.textContent.trim();
      
      el = document.getElementById('MainContent_deedPageLbl');
      if (el && el.textContent && el.textContent.trim()) result.deed_page = el.textContent.trim();
      
      el = document.getElementById('MainContent_lotAreaLbl');
      if (el && el.textContent && el.textContent.trim()) result.lot_area = el.textContent.trim();
      
      // === 2026 PROJECTED VALUES ===
      el = document.getElementById('MainContent_lblFutFullLand');
      if (el && el.textContent && el.textContent.trim()) result.future_full_land_value = el.textContent.trim();
      
      el = document.getElementById('MainContent_lblFutFullBuild');
      if (el && el.textContent && el.textContent.trim()) result.future_full_building_value = el.textContent.trim();
      
      el = document.getElementById('MainContent_lblFutFullTot');
      if (el && el.textContent && el.textContent.trim()) result.future_full_total_value = el.textContent.trim();
      
      el = document.getElementById('MainContent_lblFutCountyLand');
      if (el && el.textContent && el.textContent.trim()) result.future_county_land_value = el.textContent.trim();
      
      el = document.getElementById('MainContent_lblFutCountyBuild');
      if (el && el.textContent && el.textContent.trim()) result.future_county_building_value = el.textContent.trim();
      
      el = document.getElementById('MainContent_lblFutCountyTot');
      if (el && el.textContent && el.textContent.trim()) result.future_county_total_value = el.textContent.trim();
      
      // === 2025 CURRENT YEAR VALUES ===
      el = document.getElementById('MainContent_lblFullLand');
      if (el && el.textContent && el.textContent.trim()) result.current_full_land_value = el.textContent.trim();
      
      el = document.getElementById('MainContent_lblFullBuild');
      if (el && el.textContent && el.textContent.trim()) result.current_full_building_value = el.textContent.trim();
      
      el = document.getElementById('MainContent_lblFullTot');
      if (el && el.textContent && el.textContent.trim()) result.current_full_total_value = el.textContent.trim();
      
      el = document.getElementById('MainContent_lblCountyLand');
      if (el && el.textContent && el.textContent.trim()) result.current_county_land_value = el.textContent.trim();
      
      el = document.getElementById('MainContent_lblCountyBuild');
      if (el && el.textContent && el.textContent.trim()) result.current_county_building_value = el.textContent.trim();
      
      el = document.getElementById('MainContent_lblCountyTot');
      if (el && el.textContent && el.textContent.trim()) result.current_county_total_value = el.textContent.trim();
      
      // === 2024 PREVIOUS YEAR VALUES ===
      el = document.getElementById('MainContent_lblFullLand12');
      if (el && el.textContent && el.textContent.trim()) result.previous_full_land_value = el.textContent.trim();
      
      el = document.getElementById('MainContent_lblFullBuild12');
      if (el && el.textContent && el.textContent.trim()) result.previous_full_building_value = el.textContent.trim();
      
      el = document.getElementById('MainContent_lblFullTot12');
      if (el && el.textContent && el.textContent.trim()) result.previous_full_total_value = el.textContent.trim();
      
      el = document.getElementById('MainContent_lblCountyLand12');
      if (el && el.textContent && el.textContent.trim()) result.previous_county_land_value = el.textContent.trim();
      
      el = document.getElementById('MainContent_lblCountyBuild12');
      if (el && el.textContent && el.textContent.trim()) result.previous_county_building_value = el.textContent.trim();
      
      el = document.getElementById('MainContent_lblCountyTot12');
      if (el && el.textContent && el.textContent.trim()) result.previous_county_total_value = el.textContent.trim();
      
      // === OWNER MAILING ADDRESS ===
      el = document.getElementById('MainContent_lblOwnerMailing');
      if (el && el.textContent && el.textContent.trim()) result.owner_mailing_address = el.textContent.trim();
      
      return result;
    }).catch((err) => {
      console.error('Error extracting full details:', err);
      return {};
    });
    
    paLog(`  extracted ${Object.keys(detailData).length} fields from detail page`);
    return detailData;
  }

  /**
   * Busca dados da propriedade no site do Allegheny County
   * Tenta múltiplas variações do nome da rua
   * @param defendant Informações do defendant para comparação de nome em resultados únicos
   */
  private async searchProperty(houseNumber: string, streetVariations: string[], defendant: { firstName?: string; lastName?: string }): Promise<PropertyEnrichmentData | null> {
    if (!this.context) {
      paWarn('Context not initialized for enrichment');
      return null;
    }

    const page = await this.context.newPage();

    try {
      // Remover variações duplicadas baseado na primeira palavra
      // Ex: "7th Street", "7th ST", "7th St" → todas viram "7th" na busca
      const uniqueFirstWords = new Map<string, string>();
      for (const variation of streetVariations) {
        const firstWord = variation.split(/\s+/)[0];
        if (!uniqueFirstWords.has(firstWord)) {
          uniqueFirstWords.set(firstWord, variation);
        }
      }
      
      const uniqueVariations = Array.from(uniqueFirstWords.values());
      paLog(`unique search variations: ${uniqueVariations.length} (from ${streetVariations.length} total)`);
      
      // Tentar cada variação única do nome da rua
      for (let i = 0; i < uniqueVariations.length; i++) {
        const streetName = uniqueVariations[i];
        paLog(`[attempt ${i + 1}/${uniqueVariations.length}] searching: ${houseNumber} ${streetName}`);
        
        // Navegar para site de busca
        await page.goto('https://realestate.alleghenycounty.us/search', {
          waitUntil: 'networkidle',
          timeout: 30000
        });

        await page.waitForTimeout(1000);

        // Preencher número da casa
        try {
          await page.fill('input[name="houseNumberTxtBox"]', houseNumber);
          paLog(`  filled house number: ${houseNumber}`);
        } catch (e) {
          paWarn('  failed to fill house number:', e);
          continue; // Tentar próxima variação
        }

        await page.waitForTimeout(300);

        // Preencher nome da rua (APENAS a primeira palavra)
        // Site espera: "Dora" não "Dora Street"
        const firstWordOnly = streetName.split(/\s+/)[0];
        try {
          await page.fill('input[name="streetNameTxtBox"]', firstWordOnly);
          paLog(`  filled street name: ${firstWordOnly}`);
        } catch (e) {
          paWarn('  failed to fill street name:', e);
          continue; // Tentar próxima variação
        }

        await page.waitForTimeout(500);

        // Selecionar radio button "Address" se ainda não estiver selecionado
        try {
          const addressRadio = await page.$('#RadioButtonList1_0');
          if (addressRadio) {
            const isChecked = await addressRadio.isChecked();
            if (!isChecked) {
              await addressRadio.click();
              paLog('  selected Address radio button');
              await page.waitForTimeout(300);
            }
          }
        } catch (e) {
          paLog('  radio button already selected or not found');
        }

        // Submit via Enter no campo de rua ou formulário ASP.NET
        try {
          // Estratégia 1: Pressionar Enter no campo de rua
          await page.press('input[name="streetNameTxtBox"]', 'Enter');
          paLog('  submitted via Enter key');
        } catch (e) {
          paLog('  Enter key failed, trying form submit');
          
          // Estratégia 2: Trigger ASP.NET postback manualmente
          try {
            await page.evaluate(() => {
              // Simular ASP.NET __doPostBack
              const form = document.querySelector('form') as HTMLFormElement;
              if (form && typeof (window as any).__doPostBack === 'function') {
                (window as any).__doPostBack('', '');
              } else if (form) {
                form.submit();
              }
            });
            paLog('  submitted via ASP.NET postback');
          } catch (e2) {
            paWarn('  all submit methods failed');
            continue; // Tentar próxima variação
          }
        }

        // Aguardar resultados
        await page.waitForTimeout(2000);
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

        // NOVA LÓGICA: Verificar se já caiu direto na página de detalhes (resultado único)
        const hasDirectDetails = await page.evaluate(() => {
          const bodyText = document.body.innerText || '';
          return bodyText.includes('Parcel ID:') || bodyText.includes('Owner Name:') || bodyText.includes('General Information');
        }).catch(() => false);

        if (hasDirectDetails) {
          paLog(`  ✓ direct result detected (single match) - checking owner name similarity`);
          
          // Extrair owner name da página de detalhes
          const pageOwnerName = await page.evaluate(() => {
            // Tentar vários seletores possíveis
            let ownerName = '';
            
            // Seletor específico do InfoPane
            let el = document.getElementById('MainContent_InfoPane_ownerLbl');
            if (el) {
              ownerName = (el.textContent || '').replace('Owner Name:', '').trim();
            }
            
            // Fallback: procurar em tabelas por label "Owner Name"
            if (!ownerName) {
              const tables = Array.from(document.querySelectorAll('table'));
              for (const table of tables) {
                const rows = Array.from(table.querySelectorAll('tr'));
                for (const row of rows) {
                  const cells = Array.from(row.querySelectorAll('th, td'));
                  if (cells.length >= 2) {
                    const label = (cells[0].textContent || '').trim().toLowerCase();
                    if (label.includes('owner') && !label.includes('address')) {
                      ownerName = (cells[1].textContent || '').trim();
                      break;
                    }
                  }
                }
                if (ownerName) break;
              }
            }
            
            return ownerName;
          }).catch(() => '');

          if (pageOwnerName) {
            // Comparar com defendant name
            const defendantFullName = `${defendant.firstName || ''} ${defendant.lastName || ''}`.trim();
            const nameSimilarity = this.calculateNameSimilarity(defendantFullName, pageOwnerName);
            
            paLog(`  comparing names: "${defendantFullName}" vs "${pageOwnerName}" = ${nameSimilarity.toFixed(1)}%`);
            
            if (nameSimilarity >= 65) {
              paLog(`  ✓ name similarity ${nameSimilarity.toFixed(1)}% >= 65% - extracting full details`);
              
              // Extrair dados completos da página de detalhes usando seletores específicos
              const enrichmentData = await this.extractFullPropertyDetails(page);
              
              paLog(`  DEBUG: extracted fields - parcel_id: ${enrichmentData.parcel_id}, property_address: ${enrichmentData.property_address}, owner_name: ${enrichmentData.owner_name}`);
              
              if (enrichmentData && (enrichmentData.property_address || enrichmentData.parcel_id)) {
                paLog(`  ✓ found property data with variation: ${streetName} (direct match)`);
                await page.close();
                return enrichmentData;
              } else {
                paWarn(`  ✗ extraction returned empty data - check page structure`);
              }
            } else {
              paLog(`  ✗ name similarity ${nameSimilarity.toFixed(1)}% < 65% - skipping this result`);
            }
          } else {
            paLog(`  ⚠ could not extract owner name from direct result page`);
          }
        }

        // Lógica original: Extrair dados da página de resultados (lista)
        const enrichmentData = await this.extractPropertyData(page);
        
        // Se encontrou dados, retornar
        if (enrichmentData && enrichmentData.property_address) {
          paLog(`  ✓ found property data with variation: ${streetName}`);
          await page.close();
          return enrichmentData;
        } else {
          paLog(`  ✗ no data found with variation: ${streetName}`);
        }
        
        // Aguardar antes de tentar próxima variação
        await page.waitForTimeout(500);
      }
      
      // Se chegou aqui, nenhuma variação funcionou
      paWarn('all street name variations failed');
      await page.close();
      return null;

    } catch (error) {
      paError('error during property search:', error);
      await page.close();
      return null;
    }
  }

  /**
   * Extrai dados da página de resultados de busca OU da página de detalhes
   * Situação 1: Múltiplos resultados - retorna lista com _all_results
   * Situação 2: Resultado único - página já mostra detalhes, extrai diretamente
   */
  private async extractPropertyData(page: Page): Promise<PropertyEnrichmentData> {
    await page.waitForTimeout(1000);
    
    // Capturar raw text
    const rawText = await page.evaluate(() => document.body.innerText || '').catch(() => '');
    
    // SITUAÇÃO 1: Tentar extrair tabela de resultados (múltiplos endereços)
    const searchResults = await page.evaluate(() => {
      const results: any[] = [];
      
      // Procurar tabela de resultados (tem colunas: Parcel ID, Owner Name, Address)
      const tables = Array.from(document.querySelectorAll('table'));
      
      for (const table of tables) {
        // Verificar se é a tabela de resultados (cabeçalho tem "Parcel ID", "Owner Name", "Address")
        const headerCells = Array.from(table.querySelectorAll('thead th, tr:first-child th'));
        const headerText = headerCells.map(th => (th.textContent || '').trim().toLowerCase()).join(' ');
        
        if (headerText.includes('parcel') && headerText.includes('owner') && headerText.includes('address')) {
          // Esta é a tabela de resultados!
          const rows = Array.from(table.querySelectorAll('tbody tr, tr')).slice(1); // Pular header
          
          for (const row of rows) {
            const cells = Array.from(row.querySelectorAll('td'));
            if (cells.length >= 3) {
              const parcelLink = cells[0].querySelector('a');
              const parcelId = (cells[0].textContent || '').trim();
              const ownerName = (cells[1].textContent || '').trim();
              const address = (cells[2].textContent || '').trim();
              
              if (parcelId && ownerName && address) {
                results.push({
                  parcel_id: parcelId,
                  owner_name: ownerName,
                  property_address: address,
                  parcel_link: parcelLink ? parcelLink.getAttribute('href') : null
                });
              }
            }
          }
        }
      }
      
      return results;
    }).catch(() => []);
    
    // Se encontrou MÚLTIPLOS resultados, retornar lista para comparação
    if (searchResults.length > 1) {
      paLog(`  found ${searchResults.length} results in search table - will need to click best match`);
      const firstResult = searchResults[0];
      
      return {
        raw: rawText,
        parcel_id: firstResult.parcel_id,
        owner_name: firstResult.owner_name,
        property_address: firstResult.property_address,
        // Armazenar todos os resultados para comparação posterior
        _all_results: searchResults,
        _needs_click: true  // Flag indicando que precisa clicar
      };
    }
    
    // Se encontrou APENAS 1 resultado, pode ser tanto lista quanto detalhes diretos
    // Verificar se já estamos na página de detalhes
    const detailData = await page.evaluate(() => {
      const result: any = {};
      const tables = Array.from(document.querySelectorAll('table'));
      
      for (const table of tables) {
        const rows = Array.from(table.querySelectorAll('tr'));
        for (const row of rows) {
          const cells = Array.from(row.querySelectorAll('th, td'));
          if (cells.length >= 2) {
            const label = (cells[0].textContent || '').trim().toLowerCase();
            const value = (cells[1].textContent || '').trim();
            
            if (!value) continue;
            
            if (label.includes('owner') && !label.includes('address')) result.owner_name = result.owner_name || value;
            else if (label.includes('owner address')) result.owner_address = value;
            else if (label.includes('property address') || label.includes('location')) result.property_address = result.property_address || value;
            else if (label.includes('parcel')) result.parcel_id = result.parcel_id || value;
            else if (label.includes('assessed') || label.includes('total value')) result.assessed_value = result.assessed_value || value;
            else if (label.includes('building') || label.includes('improvement')) result.building_value = result.building_value || value;
            else if (label.includes('land value')) result.land_value = result.land_value || value;
            else if (label.includes('lot size') || label.includes('lot area')) result.lot_size = result.lot_size || value;
            else if (label.includes('year built')) result.year_built = result.year_built || value;
            else if (label.includes('sale date')) result.sale_date = result.sale_date || value;
            else if (label.includes('sale price')) result.sale_price = result.sale_price || value;
            else if (label.includes('municipality') || label.includes('city')) result.municipality = result.municipality || value;
            else if (label.includes('school')) result.school_district = result.school_district || value;
          }
        }
      }
      
      return result;
    }).catch(() => ({}));
    
    // Se temos dados detalhados (página de detalhes), retornar
    if (detailData.parcel_id && detailData.property_address) {
      paLog(`  found detailed property data (direct result)`);
      return {
        raw: rawText,
        ...detailData
      };
    }
    
    // Se temos 1 resultado na lista, retornar com flag para clicar
    if (searchResults.length === 1) {
      paLog(`  found 1 result in search table - may need to click for details`);
      return {
        raw: rawText,
        parcel_id: searchResults[0].parcel_id,
        owner_name: searchResults[0].owner_name,
        property_address: searchResults[0].property_address,
        _all_results: searchResults,
        _needs_click: true
      };
    }
    
    // Nenhum dado encontrado
    return {
      raw: rawText,
      ...detailData
    };
  }

  /**
   * Clica no link do Parcel ID e extrai TODOS os dados detalhados da página
   */
  private async clickAndExtractDetails(parcelLink: string): Promise<PropertyEnrichmentData> {
    const detailPage = await this.context.newPage();
    
    try {
      // Construir URL completa se necessário
      let fullUrl = parcelLink;
      if (!parcelLink.startsWith('http')) {
        // Garantir que tem / no início do link relativo
        const relativePath = parcelLink.startsWith('/') ? parcelLink : `/${parcelLink}`;
        fullUrl = `https://realestate.alleghenycounty.us${relativePath}`;
      }
      
      paLog(`  navigating to: ${fullUrl}`);
      await detailPage.goto(fullUrl, { waitUntil: 'networkidle', timeout: 30000 });
      await detailPage.waitForTimeout(3000); // Aumentar tempo de espera
      
      // Extrair TODOS os dados da página usando seletores específicos
      // IMPORTANTE: Não usar funções nomeadas dentro de evaluate() para evitar erro __name
      const detailData = await detailPage.evaluate(() => {
        const result: any = {};
        
        // Inline get text by ID (sem função nomeada)
        // === INFO PANE (topo da página) ===
        let el = document.getElementById('MainContent_InfoPane_parcelIDLbl');
        if (el) result.parcel_id = (el.textContent || '').replace('Parcel ID:', '').trim();
        
        el = document.getElementById('MainContent_InfoPane_parcelAltIDLbl');
        if (el && el.textContent && el.textContent.trim()) result.parcel_alt_id = el.textContent.trim();
        
        el = document.getElementById('MainContent_InfoPane_addressLbl');
        if (el) result.property_address = (el.textContent || '').replace('Address:', '').trim();
        
        el = document.getElementById('MainContent_InfoPane_municipalityLbl');
        if (el) result.municipality = (el.textContent || '').replace('Municipality:', '').trim();
        
        el = document.getElementById('MainContent_InfoPane_ownerLbl');
        if (el) result.owner_name = (el.textContent || '').replace('Owner Name:', '').trim();
        
        // === GENERAL INFORMATION - TABLE 1 ===
        el = document.getElementById('MainContent_schoolDistrictLbl');
        if (el && el.textContent && el.textContent.trim()) result.school_district = el.textContent.trim();
        
        el = document.getElementById('MainContent_taxCodeLbl');
        if (el && el.textContent && el.textContent.trim()) result.tax_code = el.textContent.trim();
        
        el = document.getElementById('MainContent_classLbl');
        if (el && el.textContent && el.textContent.trim()) result.class = el.textContent.trim();
        
        el = document.getElementById('MainContent_useCodeLbl');
        if (el && el.textContent && el.textContent.trim()) result.use_code = el.textContent.trim();
        
        el = document.getElementById('MainContent_homesteadLbl');
        if (el && el.textContent && el.textContent.trim()) result.homestead = el.textContent.trim();
        
        el = document.getElementById('MainContent_farmsteadLbl');
        if (el && el.textContent && el.textContent.trim()) result.farmstead = el.textContent.trim();
        
        el = document.getElementById('MainContent_cleanLbl');
        if (el && el.textContent && el.textContent.trim()) result.clean_and_green = el.textContent.trim();
        
        el = document.getElementById('MainContent_otherAbatementLbl');
        if (el && el.textContent && el.textContent.trim()) result.other_abatement = el.textContent.trim();
        
        // === GENERAL INFORMATION - TABLE 2 ===
        el = document.getElementById('MainContent_neighborhoodCodeLbl');
        if (el && el.textContent && el.textContent.trim()) result.neighborhood_code = el.textContent.trim();
        
        el = document.getElementById('MainContent_ownerCodeLbl');
        if (el && el.textContent && el.textContent.trim()) result.owner_code = el.textContent.trim();
        
        el = document.getElementById('MainContent_recordingDateLbl');
        if (el && el.textContent && el.textContent.trim()) result.recording_date = el.textContent.trim();
        
        el = document.getElementById('MainContent_saleDateLbl');
        if (el && el.textContent && el.textContent.trim()) result.sale_date = el.textContent.trim();
        
        el = document.getElementById('MainContent_salePrice');
        if (el && el.textContent && el.textContent.trim()) result.sale_price = el.textContent.trim();
        
        el = document.getElementById('MainContent_deedBookLbl');
        if (el && el.textContent && el.textContent.trim()) result.deed_book = el.textContent.trim();
        
        el = document.getElementById('MainContent_deedPageLbl');
        if (el && el.textContent && el.textContent.trim()) result.deed_page = el.textContent.trim();
        
        el = document.getElementById('MainContent_lotAreaLbl');
        if (el && el.textContent && el.textContent.trim()) result.lot_area = el.textContent.trim();
        
        // === 2026 PROJECTED VALUES ===
        el = document.getElementById('MainContent_lblFutFullLand');
        if (el && el.textContent && el.textContent.trim()) result.future_full_land_value = el.textContent.trim();
        
        el = document.getElementById('MainContent_lblFutFullBuild');
        if (el && el.textContent && el.textContent.trim()) result.future_full_building_value = el.textContent.trim();
        
        el = document.getElementById('MainContent_lblFutFullTot');
        if (el && el.textContent && el.textContent.trim()) result.future_full_total_value = el.textContent.trim();
        
        el = document.getElementById('MainContent_lblFutCountyLand');
        if (el && el.textContent && el.textContent.trim()) result.future_county_land_value = el.textContent.trim();
        
        el = document.getElementById('MainContent_lblFutCountyBuild');
        if (el && el.textContent && el.textContent.trim()) result.future_county_building_value = el.textContent.trim();
        
        el = document.getElementById('MainContent_lblFutCountyTot');
        if (el && el.textContent && el.textContent.trim()) result.future_county_total_value = el.textContent.trim();
        
        // === 2025 CURRENT YEAR VALUES ===
        el = document.getElementById('MainContent_lblFullLand');
        if (el && el.textContent && el.textContent.trim()) result.current_full_land_value = el.textContent.trim();
        
        el = document.getElementById('MainContent_lblFullBuild');
        if (el && el.textContent && el.textContent.trim()) result.current_full_building_value = el.textContent.trim();
        
        el = document.getElementById('MainContent_lblFullTot');
        if (el && el.textContent && el.textContent.trim()) result.current_full_total_value = el.textContent.trim();
        
        el = document.getElementById('MainContent_lblCountyLand');
        if (el && el.textContent && el.textContent.trim()) result.current_county_land_value = el.textContent.trim();
        
        el = document.getElementById('MainContent_lblCountyBuild');
        if (el && el.textContent && el.textContent.trim()) result.current_county_building_value = el.textContent.trim();
        
        el = document.getElementById('MainContent_lblCountyTot');
        if (el && el.textContent && el.textContent.trim()) result.current_county_total_value = el.textContent.trim();
        
        // === 2024 PREVIOUS YEAR VALUES ===
        el = document.getElementById('MainContent_lblFullLand12');
        if (el && el.textContent && el.textContent.trim()) result.previous_full_land_value = el.textContent.trim();
        
        el = document.getElementById('MainContent_lblFullBuild12');
        if (el && el.textContent && el.textContent.trim()) result.previous_full_building_value = el.textContent.trim();
        
        el = document.getElementById('MainContent_lblFullTot12');
        if (el && el.textContent && el.textContent.trim()) result.previous_full_total_value = el.textContent.trim();
        
        el = document.getElementById('MainContent_lblCountyLand12');
        if (el && el.textContent && el.textContent.trim()) result.previous_county_land_value = el.textContent.trim();
        
        el = document.getElementById('MainContent_lblCountyBuild12');
        if (el && el.textContent && el.textContent.trim()) result.previous_county_building_value = el.textContent.trim();
        
        el = document.getElementById('MainContent_lblCountyTot12');
        if (el && el.textContent && el.textContent.trim()) result.previous_county_total_value = el.textContent.trim();
        
        // === OWNER MAILING ADDRESS ===
        el = document.getElementById('MainContent_lblOwnerMailing');
        if (el && el.textContent && el.textContent.trim()) result.owner_mailing_address = el.textContent.trim();
        
        return result;
      }).catch((err) => {
        console.error('Error in page.evaluate:', err);
        return {};
      });
      
      paLog(`  extracted ${Object.keys(detailData).length} fields from detail page`);
      
      await detailPage.close();
      return detailData;
      
    } catch (error) {
      paWarn('  error extracting detailed data:', error);
      await detailPage.close().catch(() => {});
      return {};
    }
  }

  /**
   * Enriquece um único caso buscando dados da propriedade dos Defendants
   */
  private async enrichSingleCase(caseDir: string): Promise<EnrichmentResult | null> {
    const caseDetailPath = path.join(caseDir, 'case_detail.json');
    const enrichmentPath = path.join(caseDir, 'property_enrichment.json');
    
    // Verificar se já foi enriquecido
    if (fs.existsSync(enrichmentPath)) {
      paLog('case already enriched, skipping:', caseDir);
      return null;
    }
    
    // Ler case_detail.json
    if (!fs.existsSync(caseDetailPath)) {
      paWarn('case_detail.json not found:', caseDir);
      return null;
    }
    
    let caseDetail: any;
    try {
      const content = fs.readFileSync(caseDetailPath, 'utf8');
      caseDetail = JSON.parse(content);
    } catch (e) {
      paWarn('failed to parse case_detail.json:', caseDir, e);
      return null;
    }
    
    // Encontrar defendants
    const defendants = (caseDetail.litigants || []).filter((lit: any) => 
      lit.type && lit.type.toLowerCase().includes('defendant')
    );
    
    if (defendants.length === 0) {
      paWarn('no defendants found in case:', caseDir);
      return null;
    }
    
    // Cache de endereços já buscados neste caso (evitar buscas duplicadas)
    const searchedAddresses = new Set<string>();
    
    // Tentar enriquecer com endereço de cada defendant
    for (const defendant of defendants) {
      const address = defendant.address;
      if (!address) continue;
      
      // Normalizar endereço para comparação (remover espaços extras, uppercase)
      const normalizedAddress = address.replace(/\s+/g, ' ').trim().toUpperCase();
      
      // Se já buscamos este endereço, pular
      if (searchedAddresses.has(normalizedAddress)) {
        paLog(`skipping duplicate address: ${address}`);
        continue;
      }
      
      // Marcar endereço como buscado
      searchedAddresses.add(normalizedAddress);
      
      paLog(`attempting enrichment for defendant: ${defendant.lastName} ${defendant.firstName} - ${address}`);
      
      // Extrair número e rua
      const parsed = this.parseDefendantAddress(address);
      if (!parsed) {
        paWarn('failed to parse address:', address);
        this.logFailedEnrichment(caseDetail.caseNumber || path.basename(caseDir), address, 'failed_to_parse_address');
        continue;
      }
      
      // Buscar dados da propriedade (com múltiplas variações)
      const enrichmentData = await this.searchProperty(parsed.houseNumber, parsed.streetVariations, defendant);
      
      if (!enrichmentData || !enrichmentData.property_address) {
        paWarn('no enrichment data found for:', address);
        this.logFailedEnrichment(
          caseDetail.caseNumber || path.basename(caseDir), 
          address, 
          'no_property_data_found',
          { house_number: parsed.houseNumber, street_variations: parsed.streetVariations }
        );
        continue;
      }
      
      // Se temos múltiplos resultados, comparar todos e escolher o melhor
      let bestMatch: any | null = null;
      let bestSimilarity = 0;
      let bestNameSimilarity = 0;
      
      const allResults = (enrichmentData as any)._all_results || [enrichmentData];
      const needsClick = (enrichmentData as any)._needs_click || false;
      
      // Nome do defendant para comparação
      const defendantFullName = `${defendant.firstName || ''} ${defendant.lastName || ''}`.trim();
      
      for (const result of allResults) {
        if (!result.property_address) continue;
        
        const addressSimilarity = this.calculateAddressSimilarity(address, result.property_address);
        const nameSimilarity = result.owner_name ? this.calculateNameSimilarity(defendantFullName, result.owner_name) : 0;
        
        paLog(`  comparing: "${result.property_address}" - address: ${addressSimilarity.toFixed(1)}%, owner: "${result.owner_name || 'N/A'}" - name: ${nameSimilarity.toFixed(1)}%`);
        
        // Score combinado: endereço (peso 60%) + nome (peso 40%)
        const combinedScore = (addressSimilarity * 0.6) + (nameSimilarity * 0.4);
        
        // Se nome bate bem (>80%), dar prioridade mesmo com endereço mais baixo
        const isGoodNameMatch = nameSimilarity > 80;
        const shouldReplace = isGoodNameMatch 
          ? (nameSimilarity > bestNameSimilarity || (nameSimilarity === bestNameSimilarity && addressSimilarity > bestSimilarity))
          : (combinedScore > (bestSimilarity * 0.6 + bestNameSimilarity * 0.4));
        
        if (shouldReplace) {
          bestSimilarity = addressSimilarity;
          bestNameSimilarity = nameSimilarity;
          bestMatch = result;
        }
      }
      
      // Aceitar se: endereço >= 70% OU nome >= 80% (mesmo com endereço mais baixo)
      const hasGoodAddressMatch = bestSimilarity >= 70;
      const hasGoodNameMatch = bestNameSimilarity >= 80;
      
      if (!bestMatch || (!hasGoodAddressMatch && !hasGoodNameMatch)) {
        paWarn(`best match too low (address: ${bestSimilarity.toFixed(1)}%, name: ${bestNameSimilarity.toFixed(1)}%), skipping`);
        this.logFailedEnrichment(
          caseDetail.caseNumber || path.basename(caseDir),
          address,
          'similarity_too_low',
          {
            house_number: parsed.houseNumber,
            street_variations: parsed.streetVariations,
            defendant_name: defendantFullName,
            found_addresses: allResults.map((r: any) => `${r.property_address} (Owner: ${r.owner_name || 'N/A'})`).join('; '),
            best_address_similarity: bestSimilarity.toFixed(1) + '%',
            best_name_similarity: bestNameSimilarity.toFixed(1) + '%'
          }
        );
        continue;
      }
      
      // Match encontrado!
      const matchReason = hasGoodNameMatch ? 'name match' : 'address match';
      paLog(`✓ best match: "${bestMatch.property_address}" (${matchReason}) - address: ${bestSimilarity.toFixed(1)}%, name: ${bestNameSimilarity.toFixed(1)}%`);
      
      // Se precisa clicar no Parcel ID para obter detalhes completos
      let finalEnrichmentData: PropertyEnrichmentData = bestMatch;
      
      if (needsClick && bestMatch.parcel_link) {
        paLog(`  clicking on parcel ${bestMatch.parcel_id} to get detailed data...`);
        
        try {
          const detailedData = await this.clickAndExtractDetails(bestMatch.parcel_link);
          if (detailedData && Object.keys(detailedData).length > 3) {
            paLog(`  ✓ extracted detailed property data`);
            // Mesclar dados básicos com dados detalhados
            finalEnrichmentData = {
              ...bestMatch,
              ...detailedData,
              // Manter os dados básicos se os detalhados não tiverem
              parcel_id: detailedData.parcel_id || bestMatch.parcel_id,
              owner_name: detailedData.owner_name || bestMatch.owner_name,
              property_address: detailedData.property_address || bestMatch.property_address
            };
          }
        } catch (error) {
          paWarn('  failed to extract detailed data, using basic data:', error);
        }
      }
      
      const result: EnrichmentResult = {
        defendant_address: address,
        defendant_name: defendantFullName,
        search_params: {
          house_number: parsed.houseNumber,
          street_name: parsed.streetName
        },
        match_score: bestSimilarity,
        name_match_score: bestNameSimilarity,
        enrichment_data: finalEnrichmentData,
        enriched_at: new Date().toISOString()
      };
      
      fs.writeFileSync(enrichmentPath, JSON.stringify(result, null, 2), 'utf8');
      paLog('✓ enrichment saved:', enrichmentPath);
      
      return result;
    }
    
    // Se chegou aqui, não conseguiu enriquecer nenhum defendant
    const firstDefendant = defendants[0];
    const firstParsed = this.parseDefendantAddress(firstDefendant?.address || '');
    
    paLog('✗ no match found for any defendant');
    
    this.logFailedEnrichment(
      caseDetail.caseNumber || path.basename(caseDir),
      firstDefendant?.address || 'unknown',
      'no_match_after_all_attempts',
      {
        house_number: firstParsed?.houseNumber || '',
        street_name: firstParsed?.streetName || ''
      }
    );
    
    // NÃO criar arquivo quando não há dados - apenas registrar no log
    return {
      defendant_address: firstDefendant?.address || 'unknown',
      search_params: {
        house_number: firstParsed?.houseNumber || '',
        street_name: firstParsed?.streetName || ''
      },
      match_score: 0,
      error: 'No matching property found after all attempts',
      enriched_at: new Date().toISOString()
    };
  }

  /**
   * Fase de enriquecimento: processa todos os casos
   */
  async enrichAllCases() {
    paLog('========== FASE: ENRIQUECIMENTO DE DADOS DA PROPRIEDADE ==========');
    
    // Buscar todos os casos processados
    const caseDirs = fs.readdirSync(this.dataDir).filter(name => {
      const fullPath = path.join(this.dataDir, name);
      return fs.statSync(fullPath).isDirectory() && name.startsWith('MG-');
    });
    
    paLog(`found ${caseDirs.length} case directories to check for enrichment`);
    
    let enrichedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < caseDirs.length; i++) {
      const caseDir = caseDirs[i];
      const casePath = path.join(this.dataDir, caseDir);
      
      paLog(`[${i + 1}/${caseDirs.length}] checking ${caseDir}...`);
      
      try {
        const result = await this.enrichSingleCase(casePath);
        
        if (result === null) {
          skippedCount++;
        } else if (result.error) {
          errorCount++;
        } else {
          enrichedCount++;
          
          // Atualizar processed store com flag enrichment_done
          const caseNumber = path.basename(casePath);
          try {
            const entry = processedStore.getEntry(caseNumber);
            if (entry) {
              await processedStore.markProcessed(caseNumber, {
                ...entry,
                enrichment_done: true,
                enrichment_date: new Date().toISOString(),
                last_updated: new Date().toISOString()
              });
              paLog('✓ updated processed store with enrichment flag:', caseNumber);
            }
          } catch (e) {
            paWarn('failed to update processed store:', e);
          }
        }
      } catch (e) {
        paWarn(`failed to enrich ${caseDir}:`, e && e.message ? e.message : e);
        errorCount++;
      }
      
      // Delay entre casos para não sobrecarregar o site
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Forçar GC a cada 10 casos
      if ((i + 1) % 10 === 0 && global.gc) {
        global.gc();
      }
    }
    
    paLog(`========== ENRICHMENT SUMMARY ==========`);
    paLog(`  ✓ Enriched: ${enrichedCount}`);
    paLog(`  ⊘ Skipped (already enriched): ${skippedCount}`);
    paLog(`  ✗ Errors: ${errorCount}`);
    paLog(`  Total processed: ${caseDirs.length}`);
    
    return enrichedCount;
  }

  async run() {
    paLog('runner starting');
    
    // Fase 1: Coleta de casos
    const details = await this.collectAndProcessCases();
    
    // Fase 2: Download de PDFs
    await this.downloadAllComplaintPDFs(details || []);
    
    // Fase 3: Extração de texto
    await this.extractAllPDFTexts();
    
    // Fase 4: Enriquecimento (precisa do browser)
    try {
      // Inicializar browser para enriquecimento
      this.browser = await chromium.launch({
        headless: this.config.browser.headless,
        args: this.config.browser.args || []
      });
      
      this.context = await this.browser.newContext({
        viewport: this.config.browser.viewport,
        userAgent: this.config.browser.userAgent
      });
      
      await this.enrichAllCases();
      
    } finally {
      // Fechar browser após enriquecimento
      if (this.context) await this.context.close();
      if (this.browser) await this.browser.close();
    }
    
    // Fase 5: Envio de webhooks
    await this.sendWebhooksInBatches();
    
    paLog('runner finished');
  }
}
