// Pre-Foreclosure Runner - Cópia completa e independente do ProbateRunner
import { chromium, Browser, BrowserContext, Page, Download } from 'playwright';
import { logger } from '../../utils/logger';
import path from 'path';
import fs from 'fs';
import { sha256File } from '../../utils/hash';
import processedStore from '../../lib/processed_store';
import { upsertCaseRecord, insertFileRecord, insertExtractRecord, insertEvent, getCaseByNumber, setLastSent, getLastSentHash } from '../../db/sqlite';
import axios from 'axios';
import { sha256String } from '../../utils/hash';
import { extractPdf as callOcrService, ensureExtractAndSave } from '../../services/ocr_client';
import LocationPathManager from '../../utils/location_manager';
import { BaseRunOptions } from '../base_runner';
import { MA_DEFAULT_OPTIONS, MARunOptions } from './config';

interface PreForeclosureRunOptions extends MARunOptions {
}

export class PreForeclosureRunner {
  browser: Browser | null = null;
  context: BrowserContext | null = null;
  skippedCases: Array<any> = [];
  private runOptions: PreForeclosureRunOptions = {};
  private locationManager: LocationPathManager;
  searchRegexes: RegExp[] = [];
  baseDataDir: string;
  pdfFilenameTemplate = '{CaseNumber}_COMPLAINT.pdf';
  extractedJsonTemplate = '{CaseNumber}_complaint_extracted.json';
  txtFilename = 'complaint_pdf.txt';
  pdfUrlFilename = 'complaint_pdf_url.txt';
  webhookCategory = 'Pre-Foreclosure';
  downloadSelectors: string[] = ['a:has-text("View")', 'a.dktImage', 'a:has-text("Image")'];

  constructor(locationCode: string = 'MA') {
    this.locationManager = new LocationPathManager(locationCode);
    this.baseDataDir = this.locationManager.getDataDir('Pre-Foreclosure');
  }

  async init() {
    const headless = process.env.PLAYWRIGHT_HEADLESS === 'true';
    const baseUserDataDir = path.join(process.cwd(), 'playwright_user_data');
    let userDataDir = baseUserDataDir;
    const userAgent = process.env.USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36';
    const contextOptions: any = {
      headless,
      viewport: { width: 1280, height: 800 },
      userAgent,
      locale: 'en-US,en',
      acceptDownloads: true,
      args: ['--start-maximized'],
      slowMo: parseInt(process.env.PLAYWRIGHT_SLOWMO || '60', 10),
      ignoreDefaultArgs: ['--enable-automation']
    };
    try {
      this.context = await chromium.launchPersistentContext(userDataDir, contextOptions);
      logger.info({ userDataDir, headless }, 'Playwright context iniciado para Pre-Foreclosure');
    } catch (e) {
      logger.warn({ e }, 'Falha ao iniciar persistent context; tentando dir alternativo');
      userDataDir = `${baseUserDataDir}-${Date.now()}`;
      this.context = await chromium.launchPersistentContext(userDataDir, contextOptions);
      logger.info({ userDataDir, headless }, 'Playwright context (fallback) iniciado para Pre-Foreclosure');
    }

    // Load session cookies
    try {
      const cookiePath = path.join(process.cwd(), 'config', 'session_cookies.json');
      if (fs.existsSync(cookiePath)) {
        const raw = fs.readFileSync(cookiePath, 'utf8');
        const cookieArr = JSON.parse(raw) as Array<any>;
        const cookiesToAdd: any[] = cookieArr.map(c => {
          const cookie: any = {
            name: c.name,
            value: String(c.value || ''),
            domain: c.domain,
            path: c.path || '/',
          };
          if (c.expirationDate) cookie.expires = Math.floor(Number(c.expirationDate));
          if (typeof c.httpOnly === 'boolean') cookie.httpOnly = c.httpOnly;
          if (typeof c.secure === 'boolean') cookie.secure = c.secure;
          if (c.sameSite && (c.sameSite === 'Strict' || c.sameSite === 'Lax' || c.sameSite === 'None')) cookie.sameSite = c.sameSite;
          return cookie;
        });
        if (cookiesToAdd.length > 0) {
          await this.context.addCookies(cookiesToAdd as any);
          logger.info({ cookiePath, count: cookiesToAdd.length }, 'Session cookies adicionados ao contexto');
        }
      }
    } catch (e) {
      logger.warn({ e }, 'Falha ao carregar cookies de sessão');
    }

    // Anti-detection
    try {
      await this.context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      });
    } catch (e) {
      logger.warn({ e }, 'Falha ao adicionar init script anti-detection');
    }

    // Load config from sequences.json
    try {
      const cfgPath = path.join(process.cwd(), 'config', 'sequences.json');
      if (fs.existsSync(cfgPath)) {
        const raw = fs.readFileSync(cfgPath, 'utf8');
        const cfg = JSON.parse(raw);
        const preForeclosureSeq = cfg.sequences?.find((s: any) => s.name === 'pre_foreclosure');
        if (preForeclosureSeq && preForeclosureSeq.actions) {
          const actions = preForeclosureSeq.actions;
          if (actions.fileTerms && Array.isArray(actions.fileTerms)) {
            this.searchRegexes = actions.fileTerms.map((t: string) => {
              const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              return new RegExp('\\b' + esc + '\\b', 'i');
            });
          }
          if (actions.downloadSelectors && Array.isArray(actions.downloadSelectors)) {
            this.downloadSelectors = actions.downloadSelectors;
          }
        }
        logger.info({ cfgPath, terms: this.searchRegexes.length }, 'Pre-Foreclosure config loaded from sequences.json');
      }
    } catch (e) {
      logger.warn({ e }, 'Falha ao carregar config pre-foreclosure (silencioso)');
    }

    // Initialize processed store
    try {
      const ppath = this.locationManager.getProcessedCasesPath('pre_foreclosure');
      await processedStore.init(ppath);
      logger.info({ ppath }, 'Processed store inicializado para Pre-Foreclosure');
    } catch (e) {
      logger.warn({ e }, 'Falha inicializando processed store para Pre-Foreclosure');
    }
  }

  async _retrySkippedCases() {
    const failed: Array<any> = [];
    for (const item of this.skippedCases) {
      const { case_number, division, caseDir, pdfPath, pdfUrl, reason } = item;
      logger.info({ case_number, division, reason }, 'Retrying skipped case');
      let pdfP = pdfPath;
      try {
        if (!pdfP && pdfUrl) {
          try {
            const resp = await axios.get(pdfUrl, { responseType: 'arraybuffer', timeout: 60000 });
            const dest = path.join(caseDir, this._formatPdfFilename(case_number));
            fs.writeFileSync(dest, Buffer.from(resp.data));
            pdfP = dest;
            insertFileRecord(upsertCaseRecord(case_number, division), 'complaint', this._formatPdfFilename(case_number), sha256File(dest), fs.statSync(dest).size, dest);
            insertEvent(null, 'retry_downloaded', JSON.stringify({ case: case_number, dest }));
          } catch (e) {
            logger.warn({ e }, 'Retry download via URL failed');
          }
        }

        if (pdfP && fs.existsSync(pdfP)) {
          const outJson = path.join(caseDir, this._formatExtractedJson(case_number));
          const outTxt = path.join(caseDir, this.txtFilename);
          try {
            await ensureExtractAndSave(pdfP, outJson, outTxt);
            insertEvent(null, 'retry_extracted', JSON.stringify({ case: case_number }));
            const metaKey = JSON.stringify((fs.existsSync(path.join(caseDir, 'metadata.json')) ? JSON.parse(fs.readFileSync(path.join(caseDir, 'metadata.json'),'utf8')).docket_entries : null) || {});
            const metaHash = sha256String(metaKey);
            const caseRow = upsertCaseRecord(case_number, division);
            const txtContent = fs.existsSync(outTxt) ? fs.readFileSync(outTxt, 'utf8') : '';
            const metadataObj = fs.existsSync(path.join(caseDir, 'metadata.json')) ? JSON.parse(fs.readFileSync(path.join(caseDir, 'metadata.json'),'utf8')) : {};
            const payload = {
              Categoria: this.webhookCategory,
              Status: 'Update Case',
              Estado: 'MA',
              Cidade: division,
              'Case Number': case_number,
              'PDF TXT': txtContent,
              Metadata: metadataObj
            };
            try {
              const webhook = process.env.WEBHOOK_URL || 'https://n8n.arthuragrelli.com/webhook/scraping';
              const resp = await axios.post(webhook, payload, { timeout: 30000 });
              insertEvent(caseRow, 'webhook_retry_sent', JSON.stringify({ status: resp.status }));
              setLastSent(caseRow, metaHash, 'update');
              logger.info({ case_number }, 'Retry webhook sent');
            } catch (e) {
              insertEvent(caseRow, 'webhook_retry_failed', JSON.stringify({ error: String(e) }));
              logger.warn({ e }, 'Retry webhook failed');
              failed.push(item);
            }
          } catch (e) {
            logger.warn({ e }, 'Retry extraction failed');
            failed.push(item);
          }
        } else {
          logger.warn({ case: case_number }, 'No PDF available for retry');
          failed.push(item);
        }
      } catch (e) {
        logger.error({ e }, 'Unexpected error during retry');
        failed.push(item);
      }
    }

    if (failed.length > 0) {
      const out = this.locationManager.getFailedCasesPath('pre_foreclosure');
      fs.writeFileSync(out, JSON.stringify(failed, null, 2), 'utf8');
      logger.warn({ out, count: failed.length }, 'Some cases failed after retry - list written');
    } else {
      logger.info('All skipped cases retried successfully');
    }
  }

  async close() {
    try {
      await this.context?.close();
    } catch {}
    try { await this.browser?.close(); } catch {}
  }

  async run(options: PreForeclosureRunOptions = {}) {
    // Merge with default options from environment variables
    this.runOptions = { ...MA_DEFAULT_OPTIONS, ...options };
    if (!this.context) await this.init();
    const page = await this.context!.newPage();
    await page.goto('https://www.masscourts.org/eservices/home.page');

    logger.info('Aguardando resolução manual de CAPTCHA se necessário...');
    try {
      await page.waitForURL(/.*eservices\/search.page.*/i, { timeout: 300_000 });
      logger.info('Detectada navegação para eservices/search.page — prosseguindo');
    } catch (e) {
      try {
        await page.waitForSelector('form#searchForm, select[name="sdivCd"], select[name="sdeptCd"]', { timeout: 30_000 });
        logger.info('Seletor de busca detectado — prosseguindo');
      } catch (e2) {
        logger.warn('Timeout esperando a página de busca; continue manualmente se necessário');
      }
    }

    // Injetar banner
    try {
      await page.evaluate(() => {
        const div = document.createElement('div');
        div.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#ff9800;color:#000;padding:12px;text-align:center;font-size:16px;font-weight:bold;z-index:99999;';
        div.innerHTML = '⚠️ PRE-FORECLOSURE - NÃO FECHE ESTE NAVEGADOR! Script está processando automaticamente...';
        document.body.appendChild(div);
      });
    } catch {}

    const divisions = await this._get_divisions(page, this.runOptions.departmentContains);
    const divisionsToProcess = this._filterDivisions(divisions, this.runOptions);
    logger.info({ total: divisions.length, selecionadas: divisionsToProcess.length }, 'Encontradas divisões para processamento Pre-Foreclosure');

    for (const [division_name, division_value] of divisionsToProcess) {
      try {
        logger.info(`[PRE-FORECLOSURE] Processando divisão: ${division_name}`);
        const formUrl = page.url();
        const ok = await this._fill_search_form(page, division_value, this.runOptions.departmentContains);
        if (!ok) {
          logger.warn({ division: division_name }, 'Falha ao preencher formulário para divisão — pulando');
          await page.goto(formUrl);
          await page.waitForLoadState('networkidle');
          continue;
        }
        await page.waitForLoadState('networkidle');
        const resultsUrl = page.url();
        logger.info({ resultsUrl }, 'Página de resultados');

        const uniqueCases = await this._extract_unique_cases(page);
        if (!uniqueCases || uniqueCases.length === 0) {
          logger.info('Nenhum case encontrado nesta divisão — retornando ao formulário');
          await page.goto(formUrl);
          await page.waitForLoadState('networkidle');
          continue;
        }

        for (const caseNumber of uniqueCases) {
          logger.info({ caseNumber }, '[PRE-FORECLOSURE] Processando case');
          try {
            const norm = processedStore.normalizeKey(caseNumber);
            const already = await processedStore.isProcessed(norm).catch(() => false);
            const sendType = already ? 'update' : 'new';
            logger.info({ caseNumber, sendType }, `Processando caso (${sendType})`);

            const caseData = await this._process_case(page, caseNumber, division_name, sendType);
            if (caseData) {
              const city = this._extract_city_from_division(division_name);
              const caseDir = this._getCaseDir(city, caseNumber);
              fs.mkdirSync(caseDir, { recursive: true });
              const metadataPath = path.join(caseDir, 'metadata.json');
              fs.writeFileSync(metadataPath, JSON.stringify(caseData, null, 2), { encoding: 'utf-8' });
              logger.info({ metadataPath }, 'Metadata salvo');
              try { await processedStore.markProcessed(norm, { processed_at: new Date().toISOString(), caseNumber: caseNumber, city, source: 'pre_foreclosure' }); } catch (e) { logger.warn({ e }, 'Falha marcando case como processado'); }
            }
          } catch (e) {
            logger.error({ e }, `Erro ao processar case ${caseNumber}`);
          }
          try {
            await page.goto(resultsUrl, { timeout: 60000 }); // Aumentado para 60s
            await page.waitForLoadState('networkidle', { timeout: 30000 });
          } catch (navError) {
            logger.warn({ navError }, 'Erro ao navegar de volta aos resultados - tentando reload');
            try {
              await page.reload({ timeout: 60000 });
              await page.waitForLoadState('networkidle', { timeout: 30000 });
            } catch (reloadError) {
              logger.error({ reloadError }, 'Falha crítica na navegação - prosseguindo');
            }
          }
        }

        await page.goto(formUrl);
        await page.waitForSelector('select[name="sdeptCd"]');
        
        logger.info({ division: division_name }, '[PRE-FORECLOSURE] Divisão processada com sucesso');
        
      } catch (divisionError) {
        logger.warn({ divisionError, division: division_name }, 'Erro ao processar divisão - continuando para próxima');
        // Tentar retornar ao formulário para continuar com outras divisões
        try {
          const formUrl = page.url().replace(/\/searchresults\.page.*/, '/search.page');
          await page.goto(formUrl, { timeout: 30000 });
          await page.waitForSelector('select[name="sdeptCd"]', { timeout: 15000 });
        } catch (recoveryError) {
          logger.error({ recoveryError }, 'Falha na recuperação - tentando continuar mesmo assim');
        }
      }
    }

    // Close page and context when done
    try {
      await page.close();
      logger.info('[PRE-FORECLOSURE] Página fechada após término');
    } catch (e) {
      logger.warn({ e }, 'Erro ao fechar página Pre-Foreclosure');
    }

    if (this.skippedCases.length > 0) {
      logger.info({ count: this.skippedCases.length }, 'Tentando reprocessar skipped cases (1 retry)');
      await this._retrySkippedCases();
    }
  }

  async _get_divisions(page: Page, departmentContains?: string): Promise<Array<[string, string]>> {
    try {
      await page.waitForSelector('select[name="sdeptCd"]', { timeout: 10_000 });
      const needle = (departmentContains || 'SC_DEPT').toUpperCase();
      const deptValue = await page.$eval('select[name="sdeptCd"]', (sel: HTMLSelectElement, needleUpper: string) => {
        const opts = Array.from(sel.options);
        const found = opts.find(o => ((o.value || '') + ' ' + (o.text || '')).toUpperCase().includes(needleUpper));
        return found ? found.value : opts[0]?.value;
      }, needle).catch(() => null);
      if (deptValue) {
        await page.selectOption('select[name="sdeptCd"]', { value: deptValue });
        await page.waitForFunction(() => {
          const sel = document.querySelector('select[name="sdivCd"]') as HTMLSelectElement | null;
          return !!sel && sel.options.length > 0;
        }, { timeout: 10_000 }).catch(() => null);
        try { await page.click('select[name="sdivCd"]'); await page.waitForTimeout(300); } catch {}
      }
      await page.waitForTimeout(800);

      await page.waitForSelector('select[name="sdivCd"]', { timeout: 10_000 });
      const options = await page.$$eval('select[name="sdivCd"] option', opts =>
        opts.map(o => ({ value: (o as HTMLOptionElement).value, text: (o as HTMLOptionElement).textContent || '' }))
      );
      const divisions: Array<[string, string]> = [];
      for (const o of options) {
        const v = (o as any).value as string;
        const t = (o as any).text as string;
        if (v && v.trim() !== '' && !t.includes('Select')) divisions.push([t.trim(), v]);
      }
      return divisions;
    } catch (e) {
      logger.error({ e }, 'Erro ao obter divisões');
      return [];
    }
  }

  async _fill_search_form(page: Page, division_value: string, departmentContains?: string): Promise<boolean> {
    try {
      try {
        const needle = (departmentContains || 'SC_DEPT').toUpperCase();
        const deptValue = await page.$eval('select[name="sdeptCd"]', (sel: HTMLSelectElement, needleUpper: string) => {
          const opts = Array.from(sel.options);
          const found = opts.find(o => ((o.value || '') + ' ' + (o.text || '')).toUpperCase().includes(needleUpper));
          return found ? found.value : opts[0]?.value;
        }, needle).catch(() => null);
        if (deptValue) {
          await page.selectOption('select[name="sdeptCd"]', { value: deptValue });
          await page.waitForFunction((val) => {
            const sel = document.querySelector('select[name="sdivCd"]') as HTMLSelectElement | null;
            return !!sel && Array.from(sel.options).some(o => o.value === val);
          }, division_value, { timeout: 5000 }).catch(() => null);
        }
      } catch {}
      await page.waitForTimeout(300);
      try {
        const sdivHandle = await page.$('select[name="sdivCd"]');
        if (sdivHandle) await this._humanMoveAndClick(page, sdivHandle);
      } catch {}
      await page.selectOption('select[name="sdivCd"]', { value: division_value });
      await page.waitForLoadState('networkidle').catch(() => null);
      await page.waitForTimeout(300);

      await page.selectOption('select[name="pageSize"]', { value: '2' });
      await page.waitForLoadState('networkidle').catch(() => null);
      await page.waitForTimeout(300);

      try {
        try {
          const direct = page.locator('a:has-text("Case Type"), span:has-text("Case Type")').first();
          if (await direct.count() > 0) {
            await direct.scrollIntoViewIfNeeded();
            await direct.click({ force: true }).catch(() => null);
          }
        } catch {}
        await page.waitForTimeout(400);
        const selectors = [
          "xpath=//span[normalize-space(text())='Case Type']/parent::a",
          "xpath=//a[.//span[normalize-space(text())='Case Type']]",
          "xpath=//li[contains(@class,'tab') or contains(@class,'tab1')]//a[.//span[normalize-space(text())='Case Type']]"
        ];
        let opened = false;
        for (const sel of selectors) {
          const el = await page.$(sel);
          if (!el) continue;
          try {
            await el.scrollIntoViewIfNeeded();
            await el.click();
          } catch {
            try { await page.evaluate(e => (e as HTMLElement).click(), el); } catch {}
          }
          try {
            await page.waitForSelector('select[name="caseCd"]', { timeout: 5000 });
            opened = true;
            break;
          } catch {
            await page.waitForTimeout(1000);
            try { await page.waitForSelector('select[name="caseCd"]', { timeout: 3000 }); opened = true; break; } catch {}
          }
        }
        if (!opened) logger.warn('Aba Case Type não encontrada ou não abriu; prosseguindo');
      } catch (e) {
        logger.warn({ e }, 'Erro ao clicar na aba Case Type');
      }

      const end = new Date();
      const start = new Date();
      // Lógica de daysBack: 0 = só hoje, >0 = X dias atrás
      const daysBack = typeof this.runOptions.daysBack === 'number' 
        ? this.runOptions.daysBack 
        : parseInt(process.env.LAST_N_DAYS || '0', 10);
      
      if (daysBack === 0) {
        // Se daysBack for 0, busca apenas o dia atual (início = fim)
        start.setTime(end.getTime());
      } else {
        // Se daysBack > 0, busca X dias atrás
        start.setDate(end.getDate() - daysBack);
      }
      const fmt = (d: Date) => `${(d.getMonth()+1).toString().padStart(2,'0')}/${d.getDate().toString().padStart(2,'0')}/${d.getFullYear()}`;
      const begin = fmt(start);
      const endv = fmt(end);
      logger.info({ daysBack, dateRange: `${begin} - ${endv}` }, 'Aplicando filtro de datas');
      try {
        await page.waitForSelector('input[name="fileDateRange:dateInputBegin"]', { timeout: 5000 });
        await page.waitForSelector('input[name="fileDateRange:dateInputEnd"]', { timeout: 5000 });
        await page.evaluate((vals) => {
          const [b, e] = vals as string[];
          const a = document.querySelector('input[name="fileDateRange:dateInputBegin"]') as HTMLInputElement | null;
          const c = document.querySelector('input[name="fileDateRange:dateInputEnd"]') as HTMLInputElement | null;
          if (a) { a.value = b; a.dispatchEvent(new Event('input', { bubbles: true })); a.dispatchEvent(new Event('change', { bubbles: true })); }
          if (c) { c.value = e; c.dispatchEvent(new Event('input', { bubbles: true })); c.dispatchEvent(new Event('change', { bubbles: true })); }
        }, [begin, endv]);
        await page.waitForTimeout(300);
        const appliedBegin = await page.$eval('input[name="fileDateRange:dateInputBegin"]', (el: any) => el.value).catch(() => null);
        if (appliedBegin !== begin) {
          await page.fill('input[name="fileDateRange:dateInputBegin"]', begin).catch(() => null);
          await page.fill('input[name="fileDateRange:dateInputEnd"]', endv).catch(() => null);
        }
      } catch (e) {
        logger.warn({ e }, 'Campos de data não encontrados para preenchimento');
      }
      await page.waitForTimeout(300);

      // Case Type - usar valor das options ou fallback
      const caseCd = this.runOptions.caseCd || 'RP                            ';
      try {
        await page.waitForSelector('select[name="caseCd"]', { timeout: 5000 });
        await page.evaluate(() => {
          const sel = document.querySelector('select[name="caseCd"]') as HTMLSelectElement | null;
          if (!sel) return;
          for (const o of Array.from(sel.options)) { (o as HTMLOptionElement).selected = false; }
        });
        await page.selectOption('select[name="caseCd"]', { value: caseCd });
        await page.evaluate(() => {
          const sel = document.querySelector('select[name="caseCd"]') as HTMLSelectElement | null;
          if (sel) sel.dispatchEvent(new Event('change', { bubbles: true }));
        });
        logger.info({ caseCd }, '[PRE-FORECLOSURE] Case Type selecionado');
      } catch (e) {
        logger.warn({ e }, 'Não foi possível selecionar caseCd (case type)');
      }
      await page.waitForTimeout(200);

      // Case Status - usar valor das options ou fallback
      const statCd = this.runOptions.statCd || 'O                             ';
      try { 
        await page.selectOption('select[name="statCd"]', { value: statCd });
        logger.info({ statCd }, '[PRE-FORECLOSURE] Case Status selecionado');
      } catch {}
      await page.waitForTimeout(200);

      // Party Type - usar valor das options ou fallback
      const ptyCd = this.runOptions.ptyCd || 'DFNDT                         ';
      if (ptyCd) {
        try { 
          await page.selectOption('select[name="ptyCd"]', { value: ptyCd });
          logger.info({ ptyCd }, '[PRE-FORECLOSURE] Party Type selecionado');
        } catch {}
      }
      await page.waitForTimeout(200);

      const btn = await page.$('a[name="submitLink"], button[name="submitLink"], [name="submitLink"]');
      if (btn) {
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30_000 }).catch(() => null),
          btn.click().catch(() => null)
        ]);
      } else {
        logger.warn('Botão de Search não encontrado');
      }

      logger.info('Formulário Pre-Foreclosure preenchido e submetido');
      return true;
    } catch (e) {
      logger.error({ e }, 'Erro ao preencher formulário Pre-Foreclosure');
      try {
        const screenshot = `debug_preforeclosure_${division_value || 'div'}.png`;
        await page.screenshot({ path: screenshot, fullPage: true }).catch(() => null);
        logger.info({ screenshot }, 'Screenshot salvo para debug');
      } catch {}
      return false;
    }
  }

  async _extract_unique_cases(page: Page): Promise<string[]> {
    try {
      await page.waitForTimeout(1000);
      const caseNumbers = await page.$$eval("td[id*='cell-4'] a span", nodes => nodes.map(n => (n.textContent || '').trim()));
      const seen = new Set<string>();
      const unique: string[] = [];
      for (const c of caseNumbers) {
        if (c && c.length > 5 && !seen.has(c)) { seen.add(c); unique.push(c); }
      }
      logger.info(`[PRE-FORECLOSURE] Encontrados ${unique.length} cases únicos`);
      return unique;
    } catch (e) {
      logger.error({ e }, 'Erro ao extrair cases');
      return [];
    }
  }

  async _process_case(page: Page, case_number: string, division_name: string, sendType: string) {
    try {
      const xpath = `//span[text()="${case_number}"]/parent::a`;
      const handle = await page.$(`xpath=${xpath}`);
      if (!handle) {
        logger.warn('Link do case não encontrado');
        return null;
      }
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30_000 }).catch(() => null),
        handle.click().catch(() => null)
      ]);

      const currentUrl = page.url();
      logger.info({ currentUrl }, 'URL do case');

      const city = this._extract_city_from_division(division_name);
      const caseData = await this._extract_case_metadata(page, case_number, division_name);
      const caseId = upsertCaseRecord(case_number, division_name, caseData.case_info?.filing_date, caseData.case_info?.case_status);

      const pdfPath = await this._download_complaint_pdf(page, case_number, division_name);
      if (pdfPath) {
        caseData.complaint_pdf_path = pdfPath;
        const caseDir = this._getCaseDir(city, case_number);
        const outJson = path.join(caseDir, this._formatExtractedJson(case_number));
        const outTxt = path.join(caseDir, this.txtFilename);
        if (fs.existsSync(outJson) && fs.existsSync(outTxt)) {
          logger.info('OCR output already present, skipping OCR');
        } else {
          try {
            const { data, jsonHash, textHash, extractedText } = await callOcrService(pdfPath);
            fs.writeFileSync(outJson, JSON.stringify(data, null, 2), { encoding: 'utf-8' });
            fs.writeFileSync(outTxt, String(extractedText || ''), { encoding: 'utf-8' });
            const fileId = insertFileRecord(caseId, 'complaint_extracted_json', this._formatExtractedJson(case_number), jsonHash, Buffer.byteLength(JSON.stringify(data)), outJson);
            insertExtractRecord(caseId, fileId, jsonHash, textHash, String(extractedText || '').length, null as any);
            insertEvent(caseId, 'extracted', JSON.stringify({ pdf: pdfPath, out: outJson }));
          } catch (ocrErr) {
            logger.warn({ ocrErr }, 'OCR falhou');
          }
        }
      }

      // Send webhook
      if (!this.runOptions.sendWebhook) {
        logger.info('Webhook desabilitado nas configurações — não envia webhook');
        return caseData;
      }
      
      try {
        const caseDirCheck = this._getCaseDir(city, caseData.case_number);
        const outJsonCheck = path.join(caseDirCheck, this._formatExtractedJson(caseData.case_number));
        const outTxtCheck = path.join(caseDirCheck, this.txtFilename);
        const extractionExists = fs.existsSync(outJsonCheck);
        let extractionSuccessful = false;
        if (extractionExists) {
          try {
            const ex = JSON.parse(fs.readFileSync(outJsonCheck, 'utf8'));
            extractionSuccessful = !!(ex && (ex.extraction_successful || (ex.text_length && ex.text_length > 50) || (ex.full_text && ex.full_text.length > 50)));
          } catch (e) {
            extractionSuccessful = false;
          }
        }
        const pdfExists = pdfPath ? fs.existsSync(pdfPath) : fs.existsSync(path.join(caseDirCheck, this._formatPdfFilename(caseData.case_number)));

        if (sendType === 'new') {
          if (!pdfExists || !extractionSuccessful) {
            logger.warn({ case: caseData.case_number, pdfExists, extractionSuccessful }, 'Novo case sem PDF/extração válidos — envio SKIPPED');
            insertEvent(caseId, 'send_skipped_no_complaint', JSON.stringify({ pdfExists, extractionSuccessful }));
            const pdfUrlFile = path.join(caseDirCheck, this.pdfUrlFilename);
            const pdfUrl = fs.existsSync(pdfUrlFile) ? fs.readFileSync(pdfUrlFile, 'utf8').trim() : null;
            this.skippedCases.push({ case_number: caseData.case_number, division: division_name, caseDir: caseDirCheck, pdfPath: pdfPath || null, pdfUrl, reason: 'no_pdf_or_extraction' });
          } else {
            const txtContent = fs.existsSync(outTxtCheck) ? fs.readFileSync(outTxtCheck, 'utf8') : '';
            const metadataObj = JSON.parse(JSON.stringify(caseData));
            if (metadataObj && metadataObj.complaint_pdf_path) delete metadataObj.complaint_pdf_path;
            
            // Para novo case, incluir PDF em Base64
            const pdfBase64 = pdfPath && fs.existsSync(pdfPath) ? fs.readFileSync(pdfPath).toString('base64') : null;
            
            const sendPayload = {
              Categoria: this.webhookCategory,
              Status: 'Novo Case',
              Estado: 'MA',
              Cidade: city,
              'Case Number': caseData.case_number,
              'PDF Original': pdfBase64,
              'PDF TXT': txtContent,
              Metadata: metadataObj
            };
            try {
              const webhook = process.env.WEBHOOK_URL || 'https://n8n.arthuragrelli.com/webhook/scraping';
              const resp = await axios.post(webhook, sendPayload, { timeout: 30000 });
              const metaKey = JSON.stringify(caseData.docket_entries || caseData.case_info || {});
              const metaHash = sha256String(metaKey);
              insertEvent(caseId, 'webhook_sent', JSON.stringify({ status: resp.status }));
              setLastSent(caseId, metaHash, 'new');
              logger.info({ case: caseData.case_number, sendType: 'new' }, 'Webhook enviado');
            } catch (e) {
              insertEvent(caseId, 'webhook_failed', JSON.stringify({ error: String(e) }));
              logger.warn({ e }, 'Falha ao enviar webhook');
            }
          }
        } else if (sendType === 'update') {
          if (!extractionSuccessful) {
            logger.warn({ case: caseData.case_number, extractionSuccessful }, 'Update case com extração inválida — envio SKIPPED');
            insertEvent(caseId, 'send_skipped_no_extraction', JSON.stringify({ extractionSuccessful }));
            const pdfUrlFile = path.join(caseDirCheck, this.pdfUrlFilename);
            const pdfUrl = fs.existsSync(pdfUrlFile) ? fs.readFileSync(pdfUrlFile, 'utf8').trim() : null;
            this.skippedCases.push({ case_number: caseData.case_number, division: division_name, caseDir: caseDirCheck, pdfPath: pdfPath || null, pdfUrl, reason: 'no_extraction' });
          } else {
            const txtContent = fs.existsSync(outTxtCheck) ? fs.readFileSync(outTxtCheck, 'utf8') : '';
            const metadataObj = fs.existsSync(path.join(caseDirCheck, 'metadata.json')) ? JSON.parse(fs.readFileSync(path.join(caseDirCheck, 'metadata.json'),'utf8')) : {};
            const payload = {
              Categoria: this.webhookCategory,
              Status: 'Update Case',
              Estado: 'MA',
              Cidade: city,
              'Case Number': caseData.case_number,
              'PDF TXT': txtContent,
              Metadata: metadataObj
            };
            try {
              const webhook = process.env.WEBHOOK_URL || 'https://n8n.arthuragrelli.com/webhook/scraping';
              const resp = await axios.post(webhook, payload, { timeout: 30000 });
              const metaKey = JSON.stringify(caseData.docket_entries || caseData.case_info || {});
              const metaHash = sha256String(metaKey);
              insertEvent(caseId, 'webhook_sent', JSON.stringify({ status: resp.status }));
              setLastSent(caseId, metaHash, 'update');
              logger.info({ case: caseData.case_number, sendType: 'update' }, 'Webhook enviado');
            } catch (e) {
              insertEvent(caseId, 'webhook_failed', JSON.stringify({ error: String(e) }));
              logger.warn({ e }, 'Falha ao enviar webhook');
            }
          }
        }
      } catch (e) {
        logger.warn({ e }, 'Erro ao decidir envio de webhook');
      }

      logger.info({ case_number }, '[PRE-FORECLOSURE] Case processado');
      return caseData;
    } catch (e) {
      logger.error({ e }, `Erro ao processar case ${case_number}`);
      return null;
    }
  }

  async _extract_case_metadata(page: Page, case_number: string, division_name: string) {
    const metadata: any = {
      case_number,
      division: division_name,
      county: this._extract_city_from_division(division_name),
      scraped_at: new Date().toISOString(),
      state: 'MA',
      case_type: 'Real Property'
    };
    try {
      const pageText = await page.locator('body').innerText();
      const lines = pageText.split('\n');
      const case_info: any = {};
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].toLowerCase().trim();
        if (line.includes('filing date') || line.includes('filed')) {
          if (i + 1 < lines.length) case_info.filing_date = lines[i+1].trim();
        }
        if (line.includes('status') && i + 1 < lines.length) case_info.case_status = lines[i+1].trim();
        if (line.includes('location') && i + 1 < lines.length) case_info.location = lines[i+1].trim();
      }
      metadata.case_info = case_info;

      const parties: any = { plaintiffs: [], defendants: [] };
      for (const raw of lines) {
        const clean = raw.trim();
        const low = clean.toLowerCase();
        if ((low.includes('plaintiff') || low.includes('petitioner')) && clean.length > 5 && !low.includes('party type')) parties.plaintiffs.push(clean);
        if ((low.includes('defendant') || low.includes('respondent')) && clean.length > 5 && !low.includes('party type')) parties.defendants.push(clean);
      }
      metadata.parties = parties;

      const docket_entries: string[] = [];
      for (const raw of lines) {
        if (raw.includes('/202') || raw.includes('/201')) {
          const entry = raw.trim(); if (entry.length > 10) docket_entries.push(entry);
        }
      }
      metadata.docket_entries = docket_entries.slice(0,20);
      metadata.page_content = { full_text: pageText.slice(0,10000), text_length: pageText.length, captured_at: new Date().toISOString() };
    } catch (e) {
      logger.warn({ e }, 'Erro ao extrair metadados');
      try { metadata.raw_text = await page.locator('body').innerText().then(s => s.slice(0,5000)); } catch {}
    }
    return metadata;
  }

  async _download_complaint_pdf(page: Page, case_number: string, division_name: string): Promise<string | null> {
    try {
      const city = this._extract_city_from_division(division_name);
      const caseDir = this._getCaseDir(city, case_number);
      fs.mkdirSync(caseDir, { recursive: true });

      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1000);

      const rows = await page.$$('tr');
      const ctx = page.context();
      for (const row of rows) {
        try {
          const rowText = (await row.innerText()).trim();
          if (!rowText || !this._rowMatchesSearch(rowText)) continue;

          let view = null;
          for (const sel of (this.downloadSelectors || [])) {
            try { view = await row.$(sel); } catch (e) { view = null; }
            if (view) break;
          }
          if (!view) view = await row.$('a[title*="View"]') || await row.$('a');
          if (!view) continue;
          logger.info('[PRE-FORECLOSURE] Clicando em View Document (linha contém termo alvo)');

          const waitDownload = page.waitForEvent('download', { timeout: 30_000 }).catch(() => null);
          const waitNewPage = ctx.waitForEvent('page', { timeout: 30_000 }).catch(() => null);

          await Promise.resolve(view.click().catch(() => null));

          const [download, newPage] = await Promise.all([waitDownload, waitNewPage]);

          if (download) {
            const dest = path.join(caseDir, this._formatPdfFilename(case_number));
            await (download as Download).saveAs(dest);
            const stat = fs.statSync(dest);
            if (stat.size > 100) {
              logger.info({ dest, size: stat.size }, 'PDF baixado via download event');
              try {
                const outJson = path.join(caseDir, this._formatExtractedJson(case_number));
                const outTxt = path.join(caseDir, this.txtFilename);
                const res = await ensureExtractAndSave(dest, outJson, outTxt);
                const data = res.data || {};
                const extractedText = (res as any).extractedText || '';
                const jsonHash = sha256File(outJson);
                const textHash = sha256File(outTxt);
                const caseId = upsertCaseRecord(case_number, division_name);
                const fileId = insertFileRecord(caseId, 'complaint', this._formatPdfFilename(case_number), sha256File(dest), stat.size, dest);
                insertFileRecord(caseId, 'complaint_extracted_json', this._formatExtractedJson(case_number), jsonHash, Buffer.byteLength(JSON.stringify(data || {})), outJson);
                insertExtractRecord(caseId, fileId, jsonHash, textHash, String(extractedText || '').length, null as any);
                insertEvent(caseId, 'extracted', JSON.stringify({ pdf: dest, out: outJson }));
              } catch (ocrErr) {
                logger.warn({ ocrErr }, 'OCR falhou após download');
              }
              return dest;
            } else {
              fs.unlinkSync(dest);
              logger.warn('PDF vazio após download');
              return null;
            }
          }

          if (newPage) {
            const np = newPage as Page;
            try {
              await np.waitForLoadState('load', { timeout: 10_000 }).catch(() => null);
              const pdfUrl = np.url();
              try {
                const headers: any = { 'User-Agent': await page.evaluate(() => navigator.userAgent) };
                const resp = await ctx.request.get(pdfUrl, { headers, timeout: 60_000 });
                if (resp.ok()) {
                  const buffer = await resp.body();
                  const dest = path.join(caseDir, this._formatPdfFilename(case_number));
                  fs.writeFileSync(dest, buffer);
                  const stat = fs.statSync(dest);
                  if (stat.size > 100) {
                    logger.info({ dest, size: stat.size }, 'PDF baixado via URL da nova aba');
                    try {
                      const outJson = path.join(caseDir, this._formatExtractedJson(case_number));
                      const outTxt = path.join(caseDir, this.txtFilename);
                      const res = await ensureExtractAndSave(dest, outJson, outTxt);
                      const data = res.data || {};
                      const extractedText = (res as any).extractedText || '';
                      const jsonHash = sha256File(outJson);
                      const textHash = sha256File(outTxt);
                      const caseId = upsertCaseRecord(case_number, division_name);
                      const fileId = insertFileRecord(caseId, 'complaint', this._formatPdfFilename(case_number), sha256File(dest), stat.size, dest);
                      insertFileRecord(caseId, 'complaint_extracted_json', this._formatExtractedJson(case_number), jsonHash, Buffer.byteLength(JSON.stringify(data || {})), outJson);
                      insertExtractRecord(caseId, fileId, jsonHash, textHash, String(extractedText || '').length, null as any);
                      insertEvent(caseId, 'extracted', JSON.stringify({ pdf: dest, out: outJson }));
                    } catch (ocrErr) {
                      logger.warn({ ocrErr }, 'OCR falhou após download via nova aba');
                    }
                    return dest;
                  }
                }
              } catch (e) { logger.warn({ e }, 'Erro ao baixar via URL da nova aba'); }
            } finally {
              try { await np.close(); } catch {}
            }
          }
        } catch (e) { continue; }
      }

      const pdfHref = await page.$eval('a[href$=".pdf"]', (a: any) => a.getAttribute('href')).catch(() => null);
      if (pdfHref) {
        const url = pdfHref.startsWith('http') ? pdfHref : new URL(pdfHref, page.url()).toString();
        try {
          const resp = await page.context().request.get(url, { timeout: 60_000 });
          if (resp.ok()) {
            const buf = await resp.body();
            const dest = path.join(caseDir, this._formatPdfFilename(case_number));
            fs.writeFileSync(dest, buf);
            const stat = fs.statSync(dest);
            if (stat.size > 100) {
              try {
                const { data, jsonHash, textHash, extractedText } = await callOcrService(dest);
                const outJson = path.join(caseDir, this._formatExtractedJson(case_number));
                fs.writeFileSync(outJson, JSON.stringify(data, null, 2), { encoding: 'utf-8' });
                const outTxt = path.join(caseDir, this.txtFilename);
                fs.writeFileSync(outTxt, String(extractedText || ''), { encoding: 'utf-8' });
                const caseId = upsertCaseRecord(case_number, division_name);
                const fileId = insertFileRecord(caseId, 'complaint', this._formatPdfFilename(case_number), sha256File(dest), stat.size, dest);
                insertFileRecord(caseId, 'complaint_extracted_json', this._formatExtractedJson(case_number), jsonHash, Buffer.byteLength(JSON.stringify(data)), outJson);
                insertExtractRecord(caseId, fileId, jsonHash, textHash, String(extractedText || '').length, null as any);
                insertEvent(caseId, 'extracted', JSON.stringify({ pdf: dest, out: outJson }));
              } catch (ocrErr) {
                logger.warn({ ocrErr }, 'OCR falhou no fallback');
              }
              return dest;
            }
          }
        } catch (e) { logger.warn({ e }, 'Erro fallback download PDF'); }
      }

      logger.warn('Não foi possível baixar o PDF do COMPLAINT');
      return null;
    } catch (e) {
      logger.error({ e }, 'Erro ao baixar PDF');
      return null;
    }
  }

  _extract_city_from_division(division_name: string) {
    const clean = division_name.replace(/,/g, '').trim();
    return clean.split(' ')[0] || 'Unknown';
  }

  _getCaseDir(city: string, caseNumber: string) {
    return path.join(this.baseDataDir, city, 'cases', caseNumber);
  }

  _formatPdfFilename(caseNumber: string) {
    return this.pdfFilenameTemplate.replace('{CaseNumber}', caseNumber);
  }

  _formatExtractedJson(caseNumber: string) {
    return this.extractedJsonTemplate.replace('{CaseNumber}', caseNumber);
  }

  _rowMatchesSearch(text: string) {
    if (!text) return false;
    if (this.searchRegexes && this.searchRegexes.length > 0) return this.searchRegexes.some(r => r.test(text));
    return /\bcomplaint\b/i.test(text);
  }

  private _filterDivisions(divisions: Array<[string, string]>, options: PreForeclosureRunOptions) {
    let result = divisions.slice();
    if (options.divisionAllowList && options.divisionAllowList.length) {
      const allow = new Set(options.divisionAllowList.map(v => String(v).trim()));
      result = result.filter(([name, value]) => allow.has(value.trim()) || allow.has(name.trim())) || result;
    }

    const startFromIdx = this._findDivisionIndex(result, options.divisionStartFromValue, options.divisionStartFromName);
    if (startFromIdx >= 0) {
      result = result.slice(startFromIdx);
    } else {
      const startAfterIdx = this._findDivisionIndex(result, options.divisionStartAfterValue, options.divisionStartAfterName);
      if (startAfterIdx >= 0) {
        result = result.slice(startAfterIdx + 1);
      }
    }

    return result;
  }

  private _findDivisionIndex(divisions: Array<[string, string]>, value?: string, nameFragment?: string) {
    if (!value && !nameFragment) return -1;
    const val = value ? String(value).trim() : null;
    const fragment = nameFragment ? String(nameFragment).toLowerCase().trim() : null;
    return divisions.findIndex(([name, divisionValue]) => {
      const byValue = val ? divisionValue.trim() === val : false;
      const byName = fragment ? name.toLowerCase().includes(fragment) : false;
      return byValue || byName;
    });
  }

  _sleep(ms: number) { return new Promise<void>(res => setTimeout(res, ms)); }
  _rand(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  async _humanMoveAndClick(page: Page, handle: any) {
    try {
      const box = await handle.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: this._rand(8, 20) });
        await this._sleep(this._rand(80, 220));
        await page.mouse.down();
        await this._sleep(this._rand(50, 140));
        await page.mouse.up();
        await this._sleep(this._rand(80, 180));
        return;
      }
    } catch (e) {}
    try { await handle.click(); } catch (e) { /* ignore */ }
  }

  async _humanType(page: Page, selector: string, text: string) {
    try {
      await page.focus(selector);
      const delay = this._rand(60, 140);
      await page.type(selector, text, { delay });
      await this._sleep(this._rand(50, 120));
    } catch (e) {
      try { await page.fill(selector, text); } catch {}
    }
  }
}
