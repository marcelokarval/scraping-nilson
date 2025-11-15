import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { promises as fs } from 'fs';
import path from 'path';
import axios from 'axios';
import { sha256String } from '../../utils/hash';
import ProcessedStore from '../../lib/processed_store';
import { logger } from '../../utils/logger';
import { NH_CONFIG, NH_LOCATION_MANAGER, NH_WEBHOOK_CATEGORIES, NH_COUNTIES } from './config';

export interface NHForeclosureCase {
  // Identificação
  caseNumber: string;
  docketNumber?: string;
  
  // Propriedade (Fase 1 - Busca inicial)
  propertyAddress: string;
  propertyCity?: string;
  propertyState?: string;
  propertyZip?: string;
  
  // Proprietário (Fase 1)
  ownerFirstName: string;
  ownerLastName: string;
  ownerFullName: string;
  mailingAddress?: string;
  
  // Processo (Fase 1)
  filingDate: string;
  court?: string;
  county: string;
  status: string;
  
  // Dados Enriquecidos (Fase 2)
  enrichedData?: {
    propertyValue?: number;
    assessedValue?: number;
    mortgageAmount?: number;
    mortgageDate?: string;
    lenderInfo?: string;
    propertyDetails?: {
      yearBuilt?: number;
      lotSize?: string;
      buildingStyle?: string;
      rooms?: number;
      units?: number;
    };
    ownershipHistory?: Array<{
      date: string;
      owner: string;
      salePrice?: number;
    }>;
    taxInfo?: {
      lastTaxYear?: number;
      taxAmount?: number;
      taxStatus?: string;
    };
  };
  
  // Metadados
  extractedDate: string;
  sourceUrl: string;
  enrichmentUrl?: string;
  enrichmentCompleted: boolean;
  enrichmentNote?: string;
  phase1Completed: boolean;
  phase2Completed: boolean;
}

export interface ParsedAddress {
  fullAddress: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

export class NHForeclosureRunner {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private enrichmentBrowser: Browser | null = null;
  private enrichmentContext: BrowserContext | null = null;
  private enrichmentPage: Page | null = null;
  private processedStore = ProcessedStore;

  constructor(private options: { 
    headless?: boolean; 
    daysBack?: number;
    county?: string;
    enrichmentEnabled?: boolean;
  } = {}) {
    // ProcessedStore será inicializado no método initialize()
  }

  async initialize(): Promise<void> {
    logger.info('Iniciando NH Foreclosure Runner (Duas Fases)');
    
    // Inicializar ProcessedStore
    await this.processedStore.init(
      NH_LOCATION_MANAGER.getProcessedCasesPath('foreclosure')
    );
    
    // Inicializar browser para fase 1 (busca inicial)
    this.browser = await chromium.launch({
      headless: this.options.headless ?? false,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    this.context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 768 }
    });

    this.page = await this.context.newPage();

    // Inicializar browser para fase 2 (enriquecimento) se habilitado
    if (this.options.enrichmentEnabled !== false) {
      await this.initializeEnrichmentBrowser();
    }
  }

  private async initializeEnrichmentBrowser(): Promise<void> {
    logger.info('Inicializando browser para enriquecimento de dados');
    
    this.enrichmentBrowser = await chromium.launch({
      headless: this.options.headless ?? false,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    this.enrichmentContext = await this.enrichmentBrowser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 768 }
    });

    this.enrichmentPage = await this.enrichmentContext.newPage();
  }

  async run(): Promise<void> {
    try {
      await this.initialize();
      
      logger.info('🔍 FASE 1: Busca inicial de propriedades (estilo MassCourts)');
      const initialCases = await this.phase1_InitialSearch();
      
      logger.info({ count: initialCases.length }, 'Cases encontrados na Fase 1');
      
      if (this.options.enrichmentEnabled !== false && initialCases.length > 0) {
        logger.info('💎 FASE 2: Enriquecimento de dados (site secundário)');
        await this.phase2_DataEnrichment(initialCases);
      }
      
      logger.info('✅ NH Foreclosure Runner concluído');
      
    } catch (error) {
      logger.error('Erro durante execução do NH Foreclosure Runner:', error);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  private async phase1_InitialSearch(): Promise<NHForeclosureCase[]> {
    if (!this.page) throw new Error('Page not initialized');

    // Verificar se deve usar modo de simulação
    const useSimulation = NH_CONFIG.searchPhases.phase1.simulationMode;
    
    if (useSimulation) {
      logger.info('🎭 Usando modo de simulação para Fase 1 (foco no teste do RegGrid)');
      return this.generateSimulatedCases();
    }

    logger.info('Iniciando busca inicial no site Landmark Auction (replicando MA)');
    
    try {
      // Navegar para o Landmark Auction (mesmo site do MA)
      await this.page.goto(NH_CONFIG.urls.primarySearch, { 
        waitUntil: 'networkidle',
        timeout: 15000
      });

      logger.info('Página do Landmark Auction carregada');

      // Aguardar página carregar conteúdo dinâmico
      await this.page.waitForTimeout(2000);

      // Auto-scroll para disparar lazy loading
      await this.autoScroll(this.page);

      // Extrair casos usando mesma estratégia do MA
      const cases = await this.extractLandmarkListings();
      
      // Filtrar apenas casos do NH (deve conter especificamente ", NH" no endereço)
      const nhCases = cases.filter(caseItem => {
        const address = caseItem.propertyAddress || '';
        // Apenas aceitar endereços que contenham ", NH" especificamente
        const hasNHState = address.includes(', NH');
        if (!hasNHState) {
          logger.debug({ address, caseNumber: caseItem.caseNumber }, 'Case filtrado: não contém ", NH"');
        }
        return hasNHState;
      });

      logger.info({ 
        total: cases.length, 
        nhFiltered: nhCases.length 
      }, 'Cases extraídos e filtrados para NH');
      
      // Processar cada caso individualmente
      for (const caseData of nhCases) {
        await this.processPhase1Case(caseData);
      }

      return nhCases;

    } catch (error) {
      logger.warn({ error: error.message }, 'Erro na busca real, fallback para simulação');
      return this.generateSimulatedCases();
    }
  }

  public generateSimulatedCases(): NHForeclosureCase[] {
    logger.info('📝 Gerando casos simulados para teste do RegGrid');
    
    const simulatedCases: NHForeclosureCase[] = [
      {
        caseNumber: 'NH-SIM-001',
        docketNumber: 'SIM-FORE-001',
        propertyAddress: '123 Main Street, Manchester, NH 03101',
        propertyCity: 'Manchester',
        propertyState: 'NH',
        propertyZip: '03101',
        ownerFirstName: 'John',
        ownerLastName: 'Smith',
        ownerFullName: 'John Smith',
        mailingAddress: '123 Main Street, Manchester, NH 03101',
        filingDate: new Date().toISOString(),
        court: 'Hillsborough County Superior Court',
        county: 'Hillsborough',
        status: 'Active',
        extractedDate: new Date().toISOString(),
        sourceUrl: 'simulated_nh_case',
        enrichmentCompleted: false,
        phase1Completed: true,
        phase2Completed: false
      },
      {
        caseNumber: 'NH-SIM-002',
        docketNumber: 'SIM-FORE-002',
        propertyAddress: '456 Elm Street, Nashua, NH 03060',
        propertyCity: 'Nashua',
        propertyState: 'NH',
        propertyZip: '03060',
        ownerFirstName: 'Jane',
        ownerLastName: 'Doe',
        ownerFullName: 'Jane Doe',
        mailingAddress: '456 Elm Street, Nashua, NH 03060',
        filingDate: new Date().toISOString(),
        court: 'Hillsborough County Superior Court',
        county: 'Hillsborough',
        status: 'Active',
        extractedDate: new Date().toISOString(),
        sourceUrl: 'simulated_nh_case',
        enrichmentCompleted: false,
        phase1Completed: true,
        phase2Completed: false
      },
      {
        caseNumber: 'NH-SIM-003',
        docketNumber: 'SIM-FORE-003',
        propertyAddress: '789 Oak Avenue, Concord, NH 03301',
        propertyCity: 'Concord',
        propertyState: 'NH',
        propertyZip: '03301',
        ownerFirstName: 'Robert',
        ownerLastName: 'Johnson',
        ownerFullName: 'Robert Johnson',
        mailingAddress: '789 Oak Avenue, Concord, NH 03301',
        filingDate: new Date().toISOString(),
        court: 'Merrimack County Superior Court',
        county: 'Merrimack',
        status: 'Active',
        extractedDate: new Date().toISOString(),
        sourceUrl: 'simulated_nh_case',
        enrichmentCompleted: false,
        phase1Completed: true,
        phase2Completed: false
      }
    ];

    logger.info({ count: simulatedCases.length }, 'Casos simulados gerados para teste do RegGrid');
    return simulatedCases;
  }

  private async configureSearchFilters(): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');

    logger.info('Configurando filtros de busca para NH');
    
    // Aguardar elementos de busca carregarem
    await this.page.waitForSelector('form, .search-form, input[type="search"]', { timeout: 10000 });

    // Configurar filtro de data
    const daysBack = this.options.daysBack ?? NH_CONFIG.searchPhases.phase1.defaultDaysBack;
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    const dateRange = `${this.formatDate(startDate)} - ${this.formatDate(endDate)}`;
    logger.info({ daysBack, dateRange }, 'Aplicando filtro de datas');

    // Tentar preencher campos de data (nomes podem variar)
    const dateFields = ['startDate', 'fromDate', 'dateFrom', 'start_date'];
    const endDateFields = ['endDate', 'toDate', 'dateTo', 'end_date'];

    for (const field of dateFields) {
      const element = this.page.locator(`[name="${field}"], #${field}`);
      if (await element.count() > 0) {
        await element.fill(this.formatDate(startDate));
        break;
      }
    }

    for (const field of endDateFields) {
      const element = this.page.locator(`[name="${field}"], #${field}`);
      if (await element.count() > 0) {
        await element.fill(this.formatDate(endDate));
        break;
      }
    }

    // Selecionar tipo de documento se disponível
    const documentTypeSelect = this.page.locator('select[name*="document"], select[name*="type"], select[name*="category"]');
    if (await documentTypeSelect.count() > 0) {
      try {
        await documentTypeSelect.selectOption({ label: 'Foreclosure' });
      } catch {
        try {
          await documentTypeSelect.selectOption({ label: 'Real Property' });
        } catch {
          logger.info('Não foi possível selecionar tipo de documento específico');
        }
      }
    }

    // Submeter busca
    const submitButton = this.page.locator('button[type="submit"], input[type="submit"], .search-button');
    if (await submitButton.count() > 0) {
      logger.info('Submetendo formulário de busca');
      await submitButton.click();
      await this.page.waitForLoadState('networkidle');
    }
  }

  private async configureLandmarkSearchFilters(): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');

    logger.info('Configurando filtros de busca para Landmark Auction');
    
    try {
      // Aguardar elementos de busca carregarem específicos do Landmark Auction
      await this.page.waitForSelector('input, select, form', { timeout: 10000 });

      // Buscar por seção de foreclosures/leilões
      const foreclosureSelectors = [
        'a[href*="foreclosure"]',
        'a[href*="auction"]', 
        'nav a[href*="sale"]',
        '.menu a[href*="foreclosure"]',
        '.nav a[href*="foreclosure"]'
      ];

      for (const selector of foreclosureSelectors) {
        const link = this.page.locator(selector);
        if (await link.count() > 0) {
          logger.info({ selector }, 'Link de foreclosure encontrado');
          await link.first().click();
          await this.page.waitForLoadState('networkidle');
          break;
        }
      }

      // Configurar filtros de estado/região para NH
      const stateSelectors = [
        'select[name*="state"]',
        'select[name*="location"]',
        'select[name*="region"]',
        '#state-select',
        '.state-filter'
      ];

      for (const selector of stateSelectors) {
        const stateField = this.page.locator(selector);
        if (await stateField.count() > 0) {
          try {
            await stateField.selectOption({ label: 'New Hampshire' });
            logger.info('Estado NH selecionado');
            break;
          } catch {
            try {
              await stateField.selectOption('NH');
              logger.info('Estado NH selecionado (código)');
              break;
            } catch {
              logger.info('Não foi possível selecionar estado NH automaticamente');
            }
          }
        }
      }

      // Configurar filtro de data se disponível
      const daysBack = this.options.daysBack ?? NH_CONFIG.searchPhases.phase1.defaultDaysBack;
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - daysBack);

      // Tentar preencher campos de data
      const dateFields = [
        'input[name*="date"]',
        'input[type="date"]',
        '.date-picker input'
      ];

      for (const selector of dateFields) {
        const dateField = this.page.locator(selector);
        if (await dateField.count() > 0) {
          try {
            await dateField.fill(this.formatDate(startDate));
            break;
          } catch {
            logger.info('Campo de data encontrado mas não preenchível');
          }
        }
      }

      // Submeter busca
      const submitSelectors = [
        'button[type="submit"]',
        'input[type="submit"]', 
        '.search-button',
        '.btn-search',
        'button:has-text("Search")',
        'button:has-text("Find")'
      ];

      for (const selector of submitSelectors) {
        const submitButton = this.page.locator(selector);
        if (await submitButton.count() > 0) {
          logger.info({ selector }, 'Botão de busca encontrado');
          await submitButton.click();
          await this.page.waitForLoadState('networkidle');
          break;
        }
      }

    } catch (error) {
      logger.warn({ error: error.message }, 'Erro ao configurar filtros Landmark Auction');
    }
  }

  private async extractInitialCases(): Promise<NHForeclosureCase[]> {
    if (!this.page) throw new Error('Page not initialized');

    logger.info('Extraindo cases da página de resultados');

    // Aguardar resultados carregarem
    await this.page.waitForSelector('table, .results, .case-list, .no-results', { timeout: 10000 });

    // Verificar se há resultados
    const hasResults = await this.checkForResults();
    
    if (!hasResults) {
      logger.info('Nenhum case encontrado no período especificado');
      return [];
    }

    // Extrair dados dos resultados
    const cases: NHForeclosureCase[] = [];
    
    // Tentar diferentes padrões de estrutura de resultados
    const resultRows = await this.page.locator('table tr, .result-item, .case-row').all();
    
    for (let i = 1; i < resultRows.length; i++) { // Skip header se for tabela
      const row = resultRows[i];
      
      try {
        const caseData = await this.extractCaseFromRow(row);
        if (caseData) {
          cases.push(caseData);
        }
      } catch (error) {
        logger.error(`Erro ao processar row ${i}:`, error);
      }
    }

    return cases;
  }

  private async checkForResults(): Promise<boolean> {
    if (!this.page) return false;

    const noResultsTexts = [
      'no results', 'no cases found', 'no records', 
      'não encontrado', 'nenhum resultado'
    ];

    const pageContent = await this.page.textContent('body') || '';
    
    for (const text of noResultsTexts) {
      if (pageContent.toLowerCase().includes(text)) {
        return false;
      }
    }

    // Verificar se há pelo menos uma linha de dados além do header
    const dataRows = await this.page.locator('table tr:not(:first-child), .result-item, .case-row').count();
    return dataRows > 0;
  }

  private async extractCaseFromRow(row: any): Promise<NHForeclosureCase | null> {
    try {
      const rowText = await row.textContent() || '';
      
      // Verificar se é case relevante de foreclosure
      if (!this.isForeclosureCase(rowText)) {
        return null;
      }

      // Extrair células ou elementos de dados
      const cells = await row.locator('td, .data-cell, .field').all();
      
      if (cells.length < 3) {
        logger.warn('Row com células insuficientes, pulando');
        return null;
      }

      // Extrair dados básicos (estrutura pode variar)
      const caseNumber = await this.extractCaseNumber(cells, rowText);
      const ownerName = await this.extractOwnerName(cells, rowText);
      const propertyAddress = await this.extractPropertyAddress(cells, rowText);
      const filingDate = await this.extractFilingDate(cells, rowText);

      if (!caseNumber || !ownerName) {
        logger.warn('Dados obrigatórios ausentes, pulando case');
        return null;
      }

      return {
        caseNumber,
        propertyAddress: propertyAddress || 'Address to be determined',
        ownerFirstName: this.extractFirstName(ownerName),
        ownerLastName: this.extractLastName(ownerName),
        ownerFullName: ownerName.trim(),
        filingDate: this.standardizeDate(filingDate),
        county: this.options.county || 'Unknown',
        status: 'Pre-Foreclosure',
        extractedDate: new Date().toISOString(),
        sourceUrl: this.page?.url() || '',
        enrichmentCompleted: false,
        phase1Completed: false,
        phase2Completed: false
      };
    } catch (error) {
      logger.error('Erro ao extrair case da row:', error);
      return null;
    }
  }

  private isForeclosureCase(text: string): boolean {
    const foreclosureTerms = [
      'foreclosure', 'mortgage', 'real property', 
      'property', 'lien', 'deed'
    ];
    
    const lowerText = text.toLowerCase();
    return foreclosureTerms.some(term => lowerText.includes(term));
  }

  private async extractCaseNumber(cells: any[], rowText: string): Promise<string> {
    // Tentar extrair de diferentes células
    for (const cell of cells) {
      const text = await cell.textContent() || '';
      const match = text.match(/\d{2,4}[-\s]?\w+[-\s]?\d+/);
      if (match) return match[0];
    }
    
    // Fallback: procurar no texto completo da row
    const match = rowText.match(/\d{2,4}[-\s]?\w+[-\s]?\d+/);
    return match ? match[0] : '';
  }

  private async extractOwnerName(cells: any[], rowText: string): Promise<string> {
    // Procurar por célula que parece conter nome (mais de 2 palavras, sem números)
    for (const cell of cells) {
      const text = (await cell.textContent() || '').trim();
      if (this.looksLikeName(text)) return text;
    }
    
    return '';
  }

  private async extractPropertyAddress(cells: any[], rowText: string): Promise<string> {
    // Procurar por célula que parece conter endereço
    for (const cell of cells) {
      const text = (await cell.textContent() || '').trim();
      if (this.looksLikeAddress(text)) return text;
    }
    
    return '';
  }

  private async extractFilingDate(cells: any[], rowText: string): Promise<string> {
    // Procurar por célula que parece conter data
    for (const cell of cells) {
      const text = (await cell.textContent() || '').trim();
      if (this.looksLikeDate(text)) return text;
    }
    
    return '';
  }

  private looksLikeName(text: string): boolean {
    if (!text || text.length < 3) return false;
    const words = text.split(/\s+/);
    return words.length >= 2 && words.length <= 5 && 
           !/\d/.test(text) && // Sem números
           /^[a-zA-Z\s,.'-]+$/.test(text); // Apenas letras, espaços e pontuação básica
  }

  private looksLikeAddress(text: string): boolean {
    if (!text || text.length < 5) return false;
    return /\d+\s+[A-Za-z]/.test(text) || // Número + texto
           /\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd)\b/i.test(text);
  }

  private looksLikeDate(text: string): boolean {
    if (!text) return false;
    return /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(text) || // MM/DD/YYYY
           /\d{1,2}-\d{1,2}-\d{2,4}/.test(text) || // MM-DD-YYYY
           /\d{4}-\d{1,2}-\d{1,2}/.test(text); // YYYY-MM-DD
  }

  private async extractLandmarkCases(): Promise<NHForeclosureCase[]> {
    if (!this.page) throw new Error('Page not initialized');

    logger.info('Extraindo cases do Landmark Auction');

    try {
      // Aguardar resultados carregarem específicos do Landmark Auction
      await this.page.waitForSelector('table, .property-list, .auction-list, .results, .no-results', { timeout: 10000 });

      // Verificar se há resultados
      const noResultsSelectors = [
        '.no-results',
        '.no-properties',
        '.no-auctions',
        ':has-text("No properties found")',
        ':has-text("No auctions found")'
      ];

      for (const selector of noResultsSelectors) {
        if (await this.page.locator(selector).count() > 0) {
          logger.info('Nenhum resultado encontrado no Landmark Auction');
          return [];
        }
      }

      const cases: NHForeclosureCase[] = [];

      // Buscar por diferentes estruturas de listagem
      const listingSelectors = [
        'table tbody tr',
        '.property-item',
        '.auction-item',
        '.listing-item',
        '.result-item'
      ];

      for (const selector of listingSelectors) {
        const items = this.page.locator(selector);
        const count = await items.count();
        
        if (count > 0) {
          logger.info({ selector, count }, 'Items encontrados no Landmark Auction');
          
          for (let i = 0; i < Math.min(count, 50); i++) { // Limitar a 50 resultados
            try {
              const item = items.nth(i);
              const itemText = await item.textContent() || '';
              
              // Extrair informações básicas do item
              const address = this.extractAddressFromText(itemText);
              const auctionDate = this.extractDateFromText(itemText);
              
              if (address) {
                const caseNumber = `NH-LANDMARK-${Date.now()}-${i}`;
                
                const caseData: NHForeclosureCase = {
                  caseNumber,
                  docketNumber: caseNumber,
                  propertyAddress: address,
                  propertyCity: this.extractCityFromAddress(address),
                  propertyState: 'NH',
                  propertyZip: this.extractZipFromAddress(address),
                  ownerFirstName: '',
                  ownerLastName: '',
                  ownerFullName: 'TBD via RegGrid',
                  mailingAddress: address,
                  filingDate: auctionDate || new Date().toISOString(),
                  court: 'Landmark Auction',
                  county: 'TBD',
                  status: 'Active',
                  extractedDate: new Date().toISOString(),
                  sourceUrl: this.page.url(),
                  enrichmentCompleted: false,
                  phase1Completed: true,
                  phase2Completed: false
                };

                cases.push(caseData);
                logger.info({ address, caseNumber }, 'Case extraído do Landmark Auction');
              }
            } catch (error) {
              logger.warn({ index: i, error: error.message }, 'Erro ao extrair item do Landmark Auction');
            }
          }
          break; // Usar apenas o primeiro seletor que funcionar
        }
      }

      logger.info({ count: cases.length }, 'Cases extraídos do Landmark Auction');
      return cases;

    } catch (error) {
      logger.error({ error: error.message }, 'Erro ao extrair cases do Landmark Auction');
      return [];
    }
  }

  private extractAddressFromText(text: string): string {
    // Regex para endereços completos incluindo estado
    const addressPatterns = [
      // Endereço completo com estado e CEP: "123 Main St, Manchester, NH 03101"
      /\d+\s+[A-Za-z\s]+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Way|Court|Ct|Place|Pl)[^,]*,\s*[A-Za-z\s]+,\s*[A-Z]{2}(?:\s+\d{5})?/i,
      // Endereço com estado: "123 Main St, Manchester, NH"
      /\d+\s+[A-Za-z\s]+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Way|Court|Ct|Place|Pl)[^,]*,\s*[A-Za-z\s]+,\s*NH/i,
      // Endereço básico com vírgula: "123 Main St, Manchester"
      /\d+\s+[A-Za-z\s]+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Way|Court|Ct|Place|Pl)[^,]*,\s*[A-Za-z\s]+/i,
      // Endereço com rua: "123 Main St"
      /\d+\s+[A-Za-z\s]+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Way|Court|Ct|Place|Pl)/i,
      // Qualquer padrão de endereço com vírgulas
      /\d+\s+[A-Za-z\s]+(?:,\s*[A-Za-z\s]+){1,2}/,
      // Padrão básico de número + texto
      /\d+\s+[A-Za-z][A-Za-z\s]+/
    ];

    for (const pattern of addressPatterns) {
      const match = text.match(pattern);
      if (match) {
        return match[0].trim();
      }
    }
    
    return '';
  }

  private extractCityFromAddress(address: string): string {
    const parts = address.split(',');
    if (parts.length >= 2) {
      return parts[parts.length - 2].trim();
    }
    return 'TBD';
  }

  private extractZipFromAddress(address: string): string {
    const zipMatch = address.match(/\b\d{5}(-\d{4})?\b/);
    return zipMatch ? zipMatch[0] : '';
  }

  private extractDateFromText(text: string): string {
    const datePatterns = [
      /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/,
      /\b\d{1,2}-\d{1,2}-\d{2,4}\b/,
      /\b\d{4}-\d{1,2}-\d{1,2}\b/,
      /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/i
    ];

    for (const pattern of datePatterns) {
      const match = text.match(pattern);
      if (match) {
        try {
          return new Date(match[0]).toISOString();
        } catch {
          continue;
        }
      }
    }
    
    return '';
  }

  private async autoScroll(page: Page): Promise<void> {
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        let total = 0;
        const distance = 500;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          total += distance;
          if (total >= scrollHeight - window.innerHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 200);
        // Fallback timeout
        setTimeout(() => {
          clearInterval(timer);
          resolve();
        }, 5000);
      });
    });
  }

  private async extractLandmarkListings(): Promise<NHForeclosureCase[]> {
    if (!this.page) throw new Error('Page not initialized');

    logger.info('Extraindo listings do Landmark Auction (estilo MA)');

    try {
      // Extrair listings com múltiplos seletores (abordagem resiliente como MA)
      const rawListings = await this.page.$$eval(
        'div.auction-listing, li.listing, .property-card, .listing-item, article, .auction-item, .listing-card, .property-listing, .search-result, tr, .row, .property-row',
        (nodes) => {
          return nodes.map((n) => {
            const text = n.textContent || '';
            const get = (sel: string) => {
              const el = n.querySelector(sel);
              return el ? (el.textContent || '').trim() : null;
            };

            // Extrair campos comuns com mais seletores
            const property_address = get('.address') || 
                                   get('.property-address') || 
                                   get('h3') || 
                                   get('h2') || 
                                   get('.location') ||
                                   get('td') ||
                                   get('.addr') ||
                                   null;
            const auction_date = get('.date') || get('.auction-date') || null;
            const time = get('.time') || get('.auction-time') || null;
            const status = get('.status') || get('.badge') || null;

            return {
              raw: text,
              property_address,
              auction_date,
              auction_time: time,
              status,
            };
          });
        }
      );

      logger.info({ raw_listings: rawListings.length }, 'Listings brutas extraídas');

      // Converter para formato NHForeclosureCase
      const cases: NHForeclosureCase[] = [];
      
      for (let i = 0; i < rawListings.length; i++) {
        const listing = rawListings[i];
        
        if (!listing.property_address && listing.raw) {
          // Extrair endereço do texto bruto se não encontrado
          listing.property_address = this.extractAddressFromText(listing.raw);
          logger.debug({ raw: listing.raw.substring(0, 200), extracted: listing.property_address }, 'Endereço extraído do texto bruto');
        }

        if (listing.property_address) {
          logger.debug({ original: listing.property_address }, 'Endereço encontrado para processamento');
          // Parse do endereço
          const parsedAddr = this.parsePropertyAddress(listing.property_address);
          
          // Criar caseNumber com endereço para facilitar identificação
          const addressForCase = (parsedAddr.fullAddress || listing.property_address)
            .replace(/[^\w\s-]/g, '') // Remove caracteres especiais
            .replace(/\s+/g, '-') // Substitui espaços por hífens
            .substring(0, 50); // Limita tamanho
          
          const caseNumber = `NH-LANDMARK-${addressForCase}-${Date.now()}-${i}`;
          
          const caseData: NHForeclosureCase = {
            caseNumber,
            docketNumber: caseNumber,
            propertyAddress: parsedAddr.fullAddress || listing.property_address,
            propertyCity: parsedAddr.city || 'TBD',
            propertyState: parsedAddr.state || 'NH',
            propertyZip: parsedAddr.zip || '',
            ownerFirstName: '',
            ownerLastName: '',
            ownerFullName: 'TBD via RegGrid',
            mailingAddress: parsedAddr.fullAddress || listing.property_address,
            filingDate: this.parseDateString(listing.auction_date) || new Date().toISOString(),
            court: 'Landmark Auction',
            county: 'TBD',
            status: listing.status || 'Active',
            extractedDate: new Date().toISOString(),
            sourceUrl: this.page.url(),
            enrichmentCompleted: false,
            phase1Completed: true,
            phase2Completed: false
          };

          cases.push(caseData);
        }
      }

      logger.info({ count: cases.length }, 'Cases convertidos para formato NH');
      return cases;

    } catch (error) {
      logger.error({ error: error.message }, 'Erro ao extrair listings do Landmark Auction');
      return [];
    }
  }

  private parsePropertyAddress(address: string): ParsedAddress {
    if (!address) return { fullAddress: null, street: null, city: null, state: null, zip: null };

    // Regex para endereço completo
    const fullMatch = address.match(/^(.+?),\s*([^,]+),\s*([A-Z]{2})\s*(\d{5}(?:-\d{4})?)?\s*$/);
    if (fullMatch) {
      return {
        fullAddress: address,
        street: fullMatch[1].trim(),
        city: fullMatch[2].trim(),
        state: fullMatch[3],
        zip: fullMatch[4] || null
      };
    }

    // Tentar extrair estado
    const stateMatch = address.match(/\b([A-Z]{2})\b/);
    const zipMatch = address.match(/\b(\d{5}(?:-\d{4})?)\b/);

    return {
      fullAddress: address,
      street: address.split(',')[0]?.trim() || null,
      city: 'TBD',
      state: stateMatch ? stateMatch[1] : 'NH',
      zip: zipMatch ? zipMatch[1] : null
    };
  }

  private parseDateString(dateStr: string | null): string | null {
    if (!dateStr) return null;
    
    try {
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        return date.toISOString();
      }
    } catch {
      // Ignore parse errors
    }
    
    return null;
  }

  private async processPhase1Case(caseData: NHForeclosureCase): Promise<void> {
    const { caseNumber } = caseData;
    
    logger.info({ caseNumber }, 'Processando case Fase 1');

    // Verificar se já foi processado
    const isNew = !await this.processedStore.isProcessed(caseNumber);
    const sendType = isNew ? 'new' : 'update';

    logger.info({ caseNumber, sendType }, `Processando caso Fase 1 (${sendType})`);

    try {
      // Marcar fase 1 como completa
      caseData.phase1Completed = true;

      // Salvar metadados da Fase 1
      await this.saveCaseMetadata(caseData, 'phase1');

      // Marcar como processado
      await this.processedStore.markProcessed(caseNumber, { 
        caseNumber, 
        processed_at: new Date().toISOString(),
        source: 'NH_Foreclosure_Phase1'
      });

      logger.info({ case_number: caseNumber }, 'Case Fase 1 processado com sucesso');

    } catch (error) {
      logger.error({ caseNumber }, 'Erro ao processar case Fase 1:', error);
    }
  }

  private async phase2_DataEnrichment(cases: NHForeclosureCase[]): Promise<void> {
    if (!this.enrichmentPage) {
      logger.error('Enrichment page not initialized');
      return;
    }

    logger.info({ count: cases.length }, 'Iniciando enriquecimento de dados via RegGrid');

    // Navegar para RegGrid e aguardar carregamento completo
    logger.info('Navegando para RegGrid:', NH_CONFIG.urls.enrichmentSite);
    
    await this.enrichmentPage.goto(NH_CONFIG.urls.enrichmentSite, { 
      waitUntil: 'networkidle',
      timeout: 30000
    });

    // Aguardar interface do RegGrid carregar completamente
    await this.enrichmentPage.waitForTimeout(5000);
    
    // Aguardar elementos específicos do RegGrid aparecerem
    try {
      await this.enrichmentPage.waitForSelector('input, .search', { timeout: 10000 });
      logger.info('RegGrid carregado com sucesso');
    } catch (error) {
      logger.warn('Elementos de busca do RegGrid não encontrados rapidamente, continuando...');
    }

    for (const caseData of cases) {
      await this.enrichSingleCase(caseData);
      // Pequena pausa entre casos para evitar sobrecarga
      await this.enrichmentPage.waitForTimeout(2000);
    }
  }

  private async enrichSingleCase(caseData: NHForeclosureCase): Promise<void> {
    if (!this.enrichmentPage) return;

    const { caseNumber, propertyAddress } = caseData;
    
    logger.info({ caseNumber, propertyAddress }, 'Enriquecendo dados do case via RegGrid');

    try {
      // Verificar se temos endereço válido
      if (!propertyAddress || propertyAddress.length < 5) {
        logger.warn({ caseNumber }, 'Endereço não disponível ou muito curto para busca');
        caseData.enrichmentNote = 'Endereço indisponível para enriquecimento';
        await this.sendWebhook(caseData, 'basic');
        return;
      }

      // Buscar propriedade no RegGrid
      await this.searchPropertyForEnrichment(propertyAddress);
      
      // Aguardar resultados carregarem
      await this.enrichmentPage.waitForTimeout(3000);
      
      // Extrair dados enriquecidos
      const enrichedData = await this.extractEnrichmentData();
      
      // Verificar se conseguimos dados úteis
      const hasValidData = Object.keys(enrichedData).length > 0 && 
                          Object.values(enrichedData).some(value => value !== undefined && value !== null && value !== '');

      if (hasValidData) {
        // Adicionar dados enriquecidos ao case
        caseData.enrichedData = enrichedData;
        caseData.enrichmentUrl = this.enrichmentPage.url();
        caseData.enrichmentCompleted = true;
        caseData.phase2Completed = true;

        logger.info({ 
          case_number: caseNumber, 
          enrichedKeys: Object.keys(enrichedData),
          dataCount: Object.keys(enrichedData).length 
        }, 'Dados enriquecidos extraídos com sucesso');

        // Enviar webhook com dados completos
        await this.sendWebhook(caseData, 'enriched');
      } else {
        logger.warn({ caseNumber }, 'Nenhum dado útil encontrado no RegGrid');
        caseData.enrichmentNote = 'RegGrid não retornou dados úteis';
        await this.sendWebhook(caseData, 'basic');
      }

      // Salvar metadados completos
      await this.saveCaseMetadata(caseData, 'complete');

      logger.info({ case_number: caseNumber }, 'Case processado completamente');

    } catch (error) {
      logger.error({ caseNumber, error: error.message }, 'Erro ao enriquecer case via RegGrid');
      
      // Adicionar nota de erro
      caseData.enrichmentNote = `Erro no enriquecimento: ${error.message}`;
      
      // Enviar webhook mesmo sem enriquecimento
      await this.sendWebhook(caseData, 'basic');
    }
  }

  private async searchPropertyForEnrichment(address: string): Promise<void> {
    if (!this.enrichmentPage || !address) return;

    logger.info({ address }, 'Buscando propriedade no RegGrid para enriquecimento');

    try {
      // Preparar endereço para busca na URL (apenas número + rua, sem estado/CEP)
      const addressParts = address.split(',');
      const streetAddress = addressParts[0]?.trim(); // Apenas "23 Gay Ave"
      
      if (!streetAddress) {
        logger.warn('Endereço inválido para busca');
        return;
      }

      // Codificar o endereço para URL
      const encodedAddress = encodeURIComponent(streetAddress);
      const searchUrl = `https://app.regrid.com/search?query=${encodedAddress}&context=false&map_id=`;
      
      logger.info({ streetAddress, searchUrl }, 'Navegando para URL de busca do RegGrid');

      // Navegar para a URL de busca direta
      await this.enrichmentPage.goto(searchUrl);
      await this.enrichmentPage.waitForLoadState('networkidle');
      
      // Aguardar resultados de busca aparecerem
      logger.info('Aguardando resultados de busca aparecerem...');
      await this.enrichmentPage.waitForTimeout(3000);

      // Procurar por resultados na página
      const searchResultSelectors = [
        '.search-result',
        '.result-item',
        '[class*="result"]',
        '[class*="search-item"]',
        '.property-result',
        '[data-testid*="result"]',
        '.address-result',
        'div[role="listitem"]',
        '.list-item',
        'a[href*="property"]',
        '.search-results .item',
        '.results-list .item'
      ];

      let resultsFound = false;
      for (const selector of searchResultSelectors) {
        const results = this.enrichmentPage.locator(selector);
        const count = await results.count();
        
        if (count > 0) {
          logger.info({ selector, count }, 'Resultados de busca encontrados');
          resultsFound = true;
          
          // Tentar selecionar o melhor resultado baseado em similaridade
          await this.selectBestSearchResult(results, address);
          break;
        }
      }

      if (!resultsFound) {
        logger.warn('Nenhum resultado encontrado na página de busca');
        
        // Fazer análise da página para entender o que está disponível
        const pageAnalysis = await this.enrichmentPage.evaluate(() => {
          const allElements = document.querySelectorAll('div, a, span, li');
          const relevantElements: any[] = [];
          
          allElements.forEach((el, idx) => {
            const htmlEl = el as HTMLElement;
            const text = htmlEl.textContent?.toLowerCase() || '';
            const className = htmlEl.className || '';
            
            // Procurar por elementos que mencionem endereços ou termos relacionados
            const hasAddressTerms = text.includes('gay') || text.includes('avenue') || 
                                   text.includes('street') || text.includes('nh') ||
                                   text.includes('hillsboro') || text.includes('property') ||
                                   text.includes('address') || text.includes('search') ||
                                   text.includes('result');
            
            const isClickable = htmlEl.tagName === 'A' || htmlEl.tagName === 'BUTTON' ||
                               htmlEl.onclick || className.includes('clickable') ||
                               className.includes('link') || className.includes('result');
            
            if (hasAddressTerms && htmlEl.offsetParent !== null) {
              relevantElements.push({
                index: idx,
                text: text.substring(0, 200),
                className: className,
                tagName: htmlEl.tagName,
                isClickable,
                hasAddressTerms
              });
            }
          });
          
          return relevantElements.slice(0, 10);
        });
        
        logger.debug('Análise da página de busca:', pageAnalysis);
        return;
      }

      // Extrair dados do RegGrid...
      logger.info('Aguardando painel de detalhes carregar...');
      await this.enrichmentPage.waitForTimeout(4000);
      
    } catch (error) {
      logger.error({ error: error.message }, 'Erro ao buscar propriedade no RegGrid');
    }
  }

  private async selectBestSearchResult(results: any, searchAddress: string): Promise<void> {
    if (!this.enrichmentPage) return;

    try {
      const count = await results.count();
      logger.info({ count }, 'Analisando resultados de busca');

      // Extrair textos de todas as sugestões para comparar similaridade
      const suggestions: { element: any, text: string, similarity: number }[] = [];
      
      for (let i = 0; i < Math.min(count, 10); i++) { // Limitar a 10 resultados
        try {
          const element = results.nth(i);
          const text = (await element.textContent()) || '';
          const similarity = this.calculateSimilarity(searchAddress, text);
          
          suggestions.push({ element, text, similarity });
          logger.debug({ 
            index: i, 
            text: text.substring(0, 100), 
            similarity: similarity.toFixed(2) 
          }, 'Resultado analisado');
        } catch (error) {
          logger.warn({ index: i, error: error.message }, 'Erro ao analisar resultado');
        }
      }
      
      // Ordenar por similaridade (maior primeiro)
      suggestions.sort((a, b) => b.similarity - a.similarity);
      
      if (suggestions.length > 0) {
        const bestMatch = suggestions[0];
        logger.info({ 
          selectedText: bestMatch.text.substring(0, 100),
          similarity: bestMatch.similarity.toFixed(2),
          searchAddress 
        }, 'Melhor resultado selecionado por similaridade');
        
        // Clicar no melhor resultado com múltiplas tentativas
        try {
          await bestMatch.element.scrollIntoViewIfNeeded();
          await this.enrichmentPage.waitForTimeout(500);
          
          // Capturar URL atual antes do clique
          const currentUrl = this.enrichmentPage.url();
          logger.info({ currentUrl }, 'URL antes do clique');
          
          // Tentar clique normal primeiro
          await bestMatch.element.click();
          logger.info('Resultado clicado com sucesso');
          
          // Aguardar redirecionamento para nova página
          logger.info('Aguardando redirecionamento para página de detalhes...');
          
          try {
            // Aguardar mudança na URL (redirecionamento)
            await this.enrichmentPage.waitForFunction(
              (initialUrl) => window.location.href !== initialUrl,
              currentUrl,
              { timeout: 10000 }
            );
            
            const newUrl = this.enrichmentPage.url();
            logger.info({ newUrl }, 'Redirecionamento detectado');
            
          } catch (redirectError) {
            logger.warn('Redirecionamento não detectado, continuando...');
          }
          
          // Aguardar carregamento da nova página
          await this.enrichmentPage.waitForLoadState('networkidle');
          await this.enrichmentPage.waitForTimeout(4000);
          
          logger.info('Página de detalhes carregada, iniciando extração...');
          return;
          
        } catch (clickError) {
          logger.warn({ error: clickError.message }, 'Clique normal falhou, tentando force click');
          try {
            // Capturar URL atual antes do clique forçado
            const currentUrl = this.enrichmentPage.url();
            
            // Tentar force click se o clique normal falhar
            await bestMatch.element.click({ force: true });
            logger.info('Resultado clicado com force');
            
            // Aguardar redirecionamento após force click
            try {
              await this.enrichmentPage.waitForFunction(
                (initialUrl) => window.location.href !== initialUrl,
                currentUrl,
                { timeout: 10000 }
              );
              
              const newUrl = this.enrichmentPage.url();
              logger.info({ newUrl }, 'Redirecionamento detectado após force click');
              
            } catch (redirectError) {
              logger.warn('Redirecionamento não detectado após force click');
            }
            
            // Aguardar carregamento da nova página
            await this.enrichmentPage.waitForLoadState('networkidle');
            await this.enrichmentPage.waitForTimeout(4000);
            
            logger.info('Página de detalhes carregada após force click');
            return;
            
          } catch (forceClickError) {
            logger.error({ error: forceClickError.message }, 'Ambos os tipos de clique falharam');
            return;
          }
        }
      }

      logger.warn('Nenhum resultado válido encontrado para clique');

    } catch (error) {
      logger.warn({ error: error.message }, 'Erro ao selecionar resultado da busca');
    }
  }

  private calculateSimilarity(address1: string, address2: string): number {
    // Normalizar endereços para comparação
    const normalize = (addr: string) => {
      return addr
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ') // Remove pontuação
        .replace(/\s+/g, ' ')     // Normaliza espaços
        .trim();
    };

    const norm1 = normalize(address1);
    const norm2 = normalize(address2);

    // Extrair número da casa e nome da rua
    const extractHouseAndStreet = (addr: string) => {
      const words = addr.split(' ');
      const houseNumber = words[0];
      const streetName = words.slice(1, -2).join(' '); // Remove city, state
      return { houseNumber, streetName };
    };

    const addr1Parts = extractHouseAndStreet(norm1);
    const addr2Parts = extractHouseAndStreet(norm2);

    let similarity = 0;

    // Comparar número da casa (peso alto)
    if (addr1Parts.houseNumber === addr2Parts.houseNumber) {
      similarity += 0.4;
    }

    // Comparar nome da rua (peso alto)
    if (addr1Parts.streetName && addr2Parts.streetName) {
      if (addr1Parts.streetName === addr2Parts.streetName || 
          addr1Parts.streetName.includes(addr2Parts.streetName) ||
          addr2Parts.streetName.includes(addr1Parts.streetName)) {
        similarity += 0.4;
      }
    }

    // Bonus forte para NH (peso decisivo)
    if (norm2.includes(' nh') || norm2.includes('new hampshire')) {
      similarity += 0.3;
    }

    // Penalizar outros estados
    if (norm2.includes(' ma') || norm2.includes(' vt') || norm2.includes(' me')) {
      similarity -= 0.2;
    }
    
    return Math.max(0, Math.min(similarity, 1.0));
  }

  private async extractEnrichmentData(): Promise<any> {
    if (!this.enrichmentPage) return {};

    try {
      logger.info('Extraindo dados do RegGrid...');

      // Aguardar carregamento completo da página de detalhes
      await this.enrichmentPage.waitForLoadState('networkidle');
      await this.enrichmentPage.waitForTimeout(3000);

      const currentUrl = this.enrichmentPage.url();
      logger.info({ currentUrl }, 'Extraindo dados da URL atual');

      // Fazer análise geral da página para encontrar dados estruturados
      const pageAnalysis = await this.enrichmentPage.evaluate(() => {
        const allElements = document.querySelectorAll('div, span, td, th, p, label, h1, h2, h3');
        const relevantData: any[] = [];
        
        allElements.forEach((el) => {
          const htmlEl = el as HTMLElement;
          const text = htmlEl.textContent?.trim() || '';
          const className = htmlEl.className || '';
          
          // Procurar por dados de propriedade relevantes
          if (text && htmlEl.offsetParent !== null && text.length > 2) {
            // Dados de endereço
            if (text.match(/\d+\s+\w+\s+(st|street|ave|avenue|rd|road|ln|lane|dr|drive|way|blvd|boulevard)/i)) {
              relevantData.push({ type: 'address', text, className });
            }
            
            // Dados de propriedade
            if (text.match(/(owner|assessed|value|tax|acre|sqft|year|built|lot|parcel|land)/i)) {
              relevantData.push({ type: 'property_info', text, className });
            }
            
            // Valores monetários
            if (text.match(/\$[\d,]+/)) {
              relevantData.push({ type: 'financial', text, className });
            }
            
            // Coordenadas ou IDs de parcela
            if (text.match(/\d{2,}[-_:]\d+|\d+\.\d+\.\d+/)) {
              relevantData.push({ type: 'parcel_id', text, className });
            }
            
            // Dados demográficos/características
            if (text.match(/(bedroom|bathroom|garage|basement|stories|sq|ft|acres)/i)) {
              relevantData.push({ type: 'property_features', text, className });
            }
            
            // Nomes próprios (possíveis proprietários)
            if (text.match(/^[A-Z][A-Z\s]+[A-Z]$/) && text.length < 50) {
              relevantData.push({ type: 'owner_name', text, className });
            }
          }
        });
        
        return {
          relevantData: relevantData.slice(0, 30), // Limitar a 30 itens mais relevantes
          pageTitle: document.title,
          url: window.location.href,
          totalElements: allElements.length
        };
      });
      
      logger.info({ 
        relevantDataCount: pageAnalysis.relevantData.length,
        pageTitle: pageAnalysis.pageTitle,
        url: pageAnalysis.url,
        totalElements: pageAnalysis.totalElements
      }, 'Análise da página de detalhes');
      
      if (pageAnalysis.relevantData.length > 0) {
        logger.debug('Dados relevantes encontrados:', pageAnalysis.relevantData);
        return {
          source: 'regrid_page_analysis',
          data: pageAnalysis.relevantData,
          url: pageAnalysis.url,
          pageTitle: pageAnalysis.pageTitle,
          extractedAt: new Date().toISOString(),
          totalElements: pageAnalysis.totalElements
        };
      }

      // Se não encontrou dados estruturados, tentar extrair texto geral
      const bodyContent = await this.enrichmentPage.textContent('body') || '';
      logger.warn({ contentLength: bodyContent.length }, 'Dados estruturados não encontrados, usando conteúdo geral');
      
      if (bodyContent.length > 100) {
        return this.extractDataFromText(bodyContent);
      }

      // Se chegou até aqui, não encontrou dados úteis
      logger.warn('Nenhum dado útil encontrado na página');
      return {};

    } catch (error) {
      logger.error({ error: error.message }, 'Erro ao extrair dados do RegGrid');
      return {};
    }
  }

  private async extractRegGridStructuredData(): Promise<any> {
    if (!this.enrichmentPage) return {};

    const enrichedData: any = {};

    try {
      // Extrair valor da propriedade
      const valueSelectors = [
        '[data-testid*="value"]',
        '.property-value', 
        '.assessed-value',
        '.market-value'
      ];
      
      for (const selector of valueSelectors) {
        const element = this.enrichmentPage.locator(selector);
        if (await element.count() > 0) {
          const text = await element.textContent();
          const value = this.extractCurrencyValue(text || '');
          if (value) {
            enrichedData.propertyValue = value;
            break;
          }
        }
      }

      // Extrair informações do lote
      const lotSelectors = [
        '[data-testid*="lot"]',
        '.lot-size',
        '.acreage',
        '.square-feet'
      ];

      for (const selector of lotSelectors) {
        const element = this.enrichmentPage.locator(selector);
        if (await element.count() > 0) {
          const text = await element.textContent();
          if (text) {
            enrichedData.lotSize = text.trim();
            break;
          }
        }
      }

      // Extrair ano de construção
      const yearSelectors = [
        '[data-testid*="year"]',
        '.year-built',
        '.built-year'
      ];

      for (const selector of yearSelectors) {
        const element = this.enrichmentPage.locator(selector);
        if (await element.count() > 0) {
          const text = await element.textContent();
          const year = this.extractYear(text || '');
          if (year) {
            enrichedData.yearBuilt = year;
            break;
          }
        }
      }

      // Extrair informações do proprietário
      const ownerSelectors = [
        '[data-testid*="owner"]',
        '.owner-name',
        '.property-owner'
      ];

      for (const selector of ownerSelectors) {
        const element = this.enrichmentPage.locator(selector);
        if (await element.count() > 0) {
          const text = await element.textContent();
          if (text) {
            enrichedData.ownerInfo = text.trim();
            break;
          }
        }
      }

      return enrichedData;

    } catch (error) {
      logger.error({ error: error.message }, 'Erro ao extrair dados estruturados do RegGrid');
      return {};
    }
  }

  private extractDataFromText(content: string): any {
    const enrichedData: any = {
      propertyValue: this.extractCurrencyValue(content),
      yearBuilt: this.extractYear(content),
      lotSize: this.extractTextValue(content, ['lot size', 'acreage', 'sq ft', 'square feet']),
      buildingStyle: this.extractTextValue(content, ['style', 'type', 'building type']),
      ownerInfo: this.extractTextValue(content, ['owner', 'property owner']),
      taxInfo: this.extractTextValue(content, ['tax', 'assessment', 'assessed'])
    };

    return enrichedData;
  }

  private extractCurrencyValue(content: string): number | undefined {
    const currencyRegex = /\$[\d,]+/g;
    const matches = content.match(currencyRegex);
    if (matches && matches.length > 0) {
      const value = parseFloat(matches[0].replace(/[\$,]/g, ''));
      if (!isNaN(value)) return value;
    }
    return undefined;
  }

  private extractYear(content: string): number | undefined {
    const yearRegex = /\b(19|20)\d{2}\b/g;
    const matches = content.match(yearRegex);
    if (matches && matches.length > 0) {
      const year = parseInt(matches[0]);
      if (year >= 1800 && year <= new Date().getFullYear()) {
        return year;
      }
    }
    return undefined;
  }

  private extractNumericValue(content: string, keywords: string[]): number | undefined {
    for (const keyword of keywords) {
      const regex = new RegExp(`${keyword}[:\\s]*\\$?([\\d,]+)`, 'i');
      const match = content.match(regex);
      if (match) {
        const value = parseFloat(match[1].replace(/,/g, ''));
        if (!isNaN(value)) return value;
      }
    }
    return undefined;
  }

  private extractTextValue(content: string, keywords: string[]): string | undefined {
    for (const keyword of keywords) {
      const regex = new RegExp(`${keyword}[:\\s]*([^\\n\\r]{5,50})`, 'i');
      const match = content.match(regex);
      if (match) return match[1].trim();
    }
    return undefined;
  }

  private async saveCaseMetadata(caseData: NHForeclosureCase, phase: 'phase1' | 'complete'): Promise<void> {
    try {
      const caseDir = path.join(
        NH_LOCATION_MANAGER.getDataDir('Foreclosure'),
        caseData.county || 'Unknown',
        'cases',
        caseData.caseNumber
      );
      
      await fs.mkdir(caseDir, { recursive: true });
      
      const filename = phase === 'phase1' ? 'metadata_phase1.json' : 'metadata_complete.json';
      const metadataPath = path.join(caseDir, filename);
      await fs.writeFile(metadataPath, JSON.stringify(caseData, null, 2));
      
      logger.info({ metadataPath, phase }, 'Metadata salvo');
    } catch (error) {
      logger.error('Erro ao salvar metadata:', error);
    }
  }

  private async sendWebhook(caseData: NHForeclosureCase, type: 'basic' | 'enriched'): Promise<void> {
    const webhookUrl = process.env.WEBHOOK_URL || 'https://n8n.arthuragrelli.com/webhook/scraping';
    
    try {
      const address = caseData.propertyAddress || 'UNKNOWN';
      const normalized = this.processedStore.normalizeKey(address);
      
      // Calculate content hash for change detection
      const contentKey = JSON.stringify({
        propertyAddress: caseData.propertyAddress,
        ownerFullName: caseData.ownerFullName,
        filingDate: caseData.filingDate,
        status: caseData.status,
        enrichedData: caseData.enrichedData
      });
      const contentHash = sha256String(contentKey);
      
      // Check if this address was already processed
      const wasProcessed = await this.processedStore.isProcessed(normalized);
      const existingData = this.processedStore.data[normalized];
      const lastHash = existingData?.source || '';
      
      let sendType: 'new' | 'update' | 'skip' = 'new';
      
      if (wasProcessed) {
        if (lastHash === contentHash) {
          sendType = 'skip';
          logger.info({ case: caseData.caseNumber }, 'Sem mudanças, webhook ignorado');
          return;
        } else {
          sendType = 'update';
        }
      }

      const webhookData = {
        id: `NH_${caseData.caseNumber}_${Date.now()}`,
        source: {
          system: 'NH_Foreclosure',
          scraped_from: caseData.sourceUrl,
          retrieved_at: new Date().toISOString(),
          version: 'v1',
        },
        category: NH_WEBHOOK_CATEGORIES.FORECLOSURE, // foreclosure_nh
        sendType,
        hasPdf: false,
        enrichmentLevel: type,
        foreclosure: {
          case_number: caseData.caseNumber,
          docket_number: caseData.docketNumber,
          property_address: caseData.propertyAddress,
          property_city: caseData.propertyCity,
          property_state: caseData.propertyState,
          property_zip: caseData.propertyZip,
          owner_name: caseData.ownerFullName,
          owner_first_name: caseData.ownerFirstName,
          owner_last_name: caseData.ownerLastName,
          mailing_address: caseData.mailingAddress,
          filing_date: caseData.filingDate,
          court: caseData.court,
          county: caseData.county,
          status: caseData.status,
          extracted_date: caseData.extractedDate,
          enriched_data: caseData.enrichedData,
          phase1_completed: caseData.phase1Completed,
          phase2_completed: caseData.phase2Completed
        }
      };

      const response = await axios.post(webhookUrl, webhookData, {
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.status === 200) {
        // Update processed store with new hash
        await this.processedStore.markProcessed(normalized, {
          processed_at: new Date().toISOString(),
          caseNumber: caseData.caseNumber,
          city: caseData.propertyCity,
          source: contentHash
        });
        logger.info({ 
          case: caseData.caseNumber, 
          type: sendType,
          status: response.status 
        }, 'Webhook enviado com sucesso');
      } else {
        logger.warn({ 
          case: caseData.caseNumber, 
          status: response.status 
        }, 'Webhook retornou status não-OK');
      }
      
    } catch (error) {
      logger.error({ 
        case: caseData.caseNumber, 
        error: error.message 
      }, 'Erro ao enviar webhook');
    }
  }

  // Métodos utilitários
  private formatDate(date: Date): string {
    return date.toLocaleDateString('en-US'); // MM/DD/YYYY
  }

  private standardizeDate(dateStr: string): string {
    try {
      const date = new Date(dateStr);
      return date.toISOString().split('T')[0]; // YYYY-MM-DD
    } catch {
      return dateStr;
    }
  }

  private extractFirstName(fullName: string): string {
    const parts = fullName.trim().split(/\s+/);
    return parts[0] || '';
  }

  private extractLastName(fullName: string): string {
    const parts = fullName.trim().split(/\s+/);
    return parts.slice(1).join(' ') || '';
  }

  async cleanup(): Promise<void> {
    if (this.context) await this.context.close();
    if (this.browser) await this.browser.close();
    if (this.enrichmentContext) await this.enrichmentContext.close();
    if (this.enrichmentBrowser) await this.enrichmentBrowser.close();
    logger.info('NH Foreclosure Runner finalizado');
  }

  async close(): Promise<void> {
    await this.cleanup();
  }
}

export default NHForeclosureRunner;