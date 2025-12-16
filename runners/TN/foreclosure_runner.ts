import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { promises as fs } from 'fs';
import path from 'path';
import ProcessedStore from '../../lib/processed_store';
import { logger } from '../../utils/logger';
import { NJ_CONFIG, NJ_LOCATION_MANAGER, NJ_WEBHOOK_CATEGORIES, NJ_ESSEX_MUNICIPALITIES } from './config';

export interface NJForeclosureCase {
  // Identificação
  caseNumber: string;          // Docket Number  
  instrumentNumber: string;    // Instrument Number
  
  // Propriedade
  propertyAddress: string;     // Endereço sendo executado
  lotNumber?: string;          // Lot Number
  blockNumber?: string;        // Block Number
  
  // Pessoa/Proprietário
  ownerFirstName: string;      // Primeiro nome
  ownerLastName: string;       // Último nome
  ownerFullName: string;       // Nome completo
  mailingAddress?: string;     // Endereço de correspondência
  
  // Financiamento
  lender?: string;             // Banco/empresa
  loanAmount?: number;         // Valor financiado
  mortgageDate?: string;       // Data do mortgage
  maturityDate?: string;       // Data vencimento
  
  // Processo
  filingDate: string;          // Data entrada sistema
  county: string;              // Condado
  status: string;              // Pre-Foreclosure
  
  // Metadados
  extractedDate: string;
  sourceUrl: string;
}

export class NJForeclosureRunner {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private processedStore = ProcessedStore;

  constructor(private options: { 
    headless?: boolean; 
    daysBack?: number;
    municipality?: string; // Opção para selecionar município específico
  } = {}) {
    // ProcessedStore será inicializado no método initialize()
  }

  async initialize(): Promise<void> {
    logger.info('Iniciando NJ Foreclosure Runner (Essex Register)');
    
    // Inicializar ProcessedStore
    await this.processedStore.init(
      NJ_LOCATION_MANAGER.getProcessedCasesPath('foreclosure')
    );
    
    this.browser = await chromium.launch({
      headless: this.options.headless ?? false,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    this.context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 768 }
    });

    this.page = await this.context.newPage();
  }

  async run(): Promise<void> {
    try {
      await this.initialize();
      await this.navigateToEssexRegister();
      await this.performSearch();
      await this.extractAndProcessCases();
    } catch (error) {
      logger.error('Erro durante execução do NJ Foreclosure Runner:', error);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  private async navigateToEssexRegister(): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');

    logger.info('Navegando para Essex Register');
    await this.page.goto(NJ_CONFIG.urls.essexRegister, { 
      waitUntil: 'networkidle' 
    });

    // Aguardar resolução de captcha manual se necessário
    logger.info('Aguardando resolução manual de CAPTCHA se necessário...');
    await this.page.waitForTimeout(3000);
  }

  private async performSearch(): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');

    logger.info('Configurando filtros de busca');
    
    // Navegar para New Jersey
    await this.page.click('text=New Jersey');
    await this.page.waitForTimeout(1000);

    // Clicar em Register of Deeds  
    await this.page.click('text=Register of Deeds');
    await this.page.waitForTimeout(2000);

    // Configurar Document Type
    logger.info({ documentType: NJ_CONFIG.search.documentType }, 'Selecionando Document Type');
    
    // Selecionar "List Pending Foreclosure"
    await this.page.selectOption('[name="documentType"]', { label: NJ_CONFIG.search.documentType });
    await this.page.waitForTimeout(500);

    // Selecionar município se especificado, senão usar "COUNTY WIDE"
    const municipalitySelect = '[name="ctl00$ContentPlaceHolder1$ddlMunTab2"]';
    if (await this.page.locator(municipalitySelect).count() > 0) {
      const municipality = this.options.municipality || 'COUNTY WIDE';
      
      // Verificar se a municipalidade é válida
      if (NJ_ESSEX_MUNICIPALITIES.includes(municipality as any)) {
        logger.info({ municipality }, 'Selecionando municipalidade específica');
        await this.page.selectOption(municipalitySelect, { value: municipality });
      } else {
        logger.info('Selecionando COUNTY WIDE para abranger todas as municipalidades');
        await this.page.selectOption(municipalitySelect, { value: 'COUNTY WIDE' });
      }
      await this.page.waitForTimeout(500);
    }

    // Configurar filtro de data
    const daysBack = this.options.daysBack ?? NJ_CONFIG.search.defaultDaysBack;
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    const dateRange = `${this.formatDate(startDate)} - ${this.formatDate(endDate)}`;
    logger.info({ daysBack, dateRange }, 'Aplicando filtro de datas');

    // Preencher campos de data (formato MM/DD/YYYY)
    await this.page.fill('[name="startDate"]', this.formatDate(startDate));
    await this.page.fill('[name="endDate"]', this.formatDate(endDate));

    // Submeter busca
    logger.info('Submetendo formulário de busca');
    await this.page.click('[type="submit"]');
    await this.page.waitForLoadState('networkidle');
  }

  private async extractAndProcessCases(): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');

    logger.info('Extraindo cases da página de resultados');

    // Aguardar resultados carregarem
    await this.page.waitForSelector('table, .results, .no-results', { timeout: 10000 });

    // Verificar se há resultados
    const hasResults = await this.page.locator('table tr').count() > 1; // Mais que header
    
    if (!hasResults) {
      logger.info('Nenhum case encontrado no período especificado');
      return;
    }

    // Extrair rows de resultados
    const rows = await this.page.locator('table tr').all();
    const cases: NJForeclosureCase[] = [];

    for (let i = 1; i < rows.length; i++) { // Skip header
      const row = rows[i];
      
      try {
        const case_data = await this.extractCaseFromRow(row);
        if (case_data) {
          cases.push(case_data);
        }
      } catch (error) {
        logger.error(`Erro ao processar row ${i}:`, error);
      }
    }

    logger.info({ count: cases.length }, 'Cases extraídos da lista');

    // Processar cada case individualmente
    for (const caseData of cases) {
      await this.processIndividualCase(caseData);
    }
  }

  private async extractCaseFromRow(row: any): Promise<NJForeclosureCase | null> {
    try {
      // Extrair dados básicos da row da tabela
      const cells = await row.locator('td').all();
      
      if (cells.length < 4) {
        logger.warn('Row com células insuficientes, pulando');
        return null;
      }

      // Extrair informações básicas (estrutura pode variar)
      const instrumentNumber = await cells[0]?.textContent() || '';
      const filingDate = await cells[1]?.textContent() || '';
      const ownerName = await cells[2]?.textContent() || '';
      
      // Verificar se é case de foreclosure
      const rowText = await row.textContent() || '';
      if (!rowText.toLowerCase().includes('foreclosure')) {
        return null;
      }

      // Extrair case number se disponível
      const caseNumber = this.extractCaseNumber(rowText);

      return {
        caseNumber: caseNumber || instrumentNumber,
        instrumentNumber,
        propertyAddress: '', // Será preenchido no processamento detalhado
        ownerFirstName: this.extractFirstName(ownerName),
        ownerLastName: this.extractLastName(ownerName), 
        ownerFullName: ownerName.trim(),
        filingDate: this.standardizeDate(filingDate),
        county: 'Essex',
        status: 'Pre-Foreclosure',
        extractedDate: new Date().toISOString(),
        sourceUrl: this.page?.url() || ''
      };
    } catch (error) {
      logger.error('Erro ao extrair case da row:', error);
      return null;
    }
  }

  private async processIndividualCase(caseData: NJForeclosureCase): Promise<void> {
    const { caseNumber } = caseData;
    
    logger.info({ caseNumber }, 'Processando case individual');

    // Verificar se já foi processado
    const isNew = !this.processedStore.isProcessed(caseNumber);
    const sendType = isNew ? 'new' : 'update';

    logger.info({ caseNumber, sendType }, `Processando caso (${sendType})`);

    try {
      // Clicar no case para ver detalhes
      await this.page?.click(`text=${caseNumber}`);
      await this.page?.waitForLoadState('networkidle');

      // Extrair dados detalhados
      const detailedData = await this.extractDetailedCaseData(caseData);

      // Fazer download do PDF se for case novo
      if (isNew) {
        await this.downloadCasePDF(detailedData);
      }

      // Salvar metadados
      await this.saveCaseMetadata(detailedData);

      // Enviar webhook
      await this.sendWebhook(detailedData, sendType);

      // Marcar como processado
      await this.processedStore.markProcessed(caseNumber, { 
        caseNumber, 
        processed_at: new Date().toISOString(),
        source: 'NJ_Foreclosure'
      });

      logger.info({ case_number: caseNumber }, 'Case processado com sucesso');

    } catch (error) {
      logger.error({ caseNumber }, 'Erro ao processar case:', error);
    }

    // Voltar para lista de resultados
    await this.page?.goBack();
    await this.page?.waitForLoadState('networkidle');
  }

  private async extractDetailedCaseData(baseData: NJForeclosureCase): Promise<NJForeclosureCase> {
    if (!this.page) return baseData;

    try {
      // Extrair informações detalhadas da página do case
      const pageContent = await this.page.textContent('body') || '';
      
      // Procurar por endereço da propriedade
      const propertyAddress = this.extractPropertyAddress(pageContent);
      
      // Procurar por informações de financiamento
      const lender = this.extractLender(pageContent);
      const loanAmount = this.extractLoanAmount(pageContent);
      
      // Procurar por lot e block numbers
      const { lotNumber, blockNumber } = this.extractLotBlock(pageContent);

      return {
        ...baseData,
        propertyAddress: propertyAddress || baseData.propertyAddress,
        lender: lender || baseData.lender,
        loanAmount: loanAmount || baseData.loanAmount,
        lotNumber: lotNumber || baseData.lotNumber,
        blockNumber: blockNumber || baseData.blockNumber
      };
    } catch (error) {
      logger.error('Erro ao extrair dados detalhados:', error);
      return baseData;
    }
  }

  private async downloadCasePDF(caseData: NJForeclosureCase): Promise<void> {
    if (!this.page) return;

    try {
      // Procurar por link de PDF/documento
      const pdfLink = this.page.locator('a[href*=".pdf"], text="View Document", text="View Image"').first();
      
      if (await pdfLink.count() > 0) {
        logger.info('Fazendo download do PDF do case');
        
        // Criar diretório do case
        const caseDir = path.join(
          NJ_LOCATION_MANAGER.getDataDir('Foreclosure'),
          'Essex',
          'cases',
          caseData.caseNumber
        );
        
        await fs.mkdir(caseDir, { recursive: true });

        // Download do PDF
        const downloadPromise = this.page.waitForEvent('download');
        await pdfLink.click();
        const download = await downloadPromise;

        const pdfPath = path.join(caseDir, `${caseData.caseNumber}_FORECLOSURE.pdf`);
        await download.saveAs(pdfPath);

        logger.info({ dest: pdfPath }, 'PDF baixado com sucesso');
      }
    } catch (error) {
      logger.error('Erro ao fazer download do PDF:', error);
    }
  }

  private async saveCaseMetadata(caseData: NJForeclosureCase): Promise<void> {
    try {
      const caseDir = path.join(
        NJ_LOCATION_MANAGER.getDataDir('Foreclosure'),
        'Essex',
        'cases',
        caseData.caseNumber
      );
      
      await fs.mkdir(caseDir, { recursive: true });
      
      const metadataPath = path.join(caseDir, 'metadata.json');
      await fs.writeFile(metadataPath, JSON.stringify(caseData, null, 2));
      
      logger.info({ metadataPath }, 'Metadata salvo');
    } catch (error) {
      logger.error('Erro ao salvar metadata:', error);
    }
  }

  private async sendWebhook(caseData: NJForeclosureCase, sendType: 'new' | 'update'): Promise<void> {
    try {
      const webhookData = {
        ...caseData,
        type: NJ_WEBHOOK_CATEGORIES.FORECLOSURE, // foreclosure_nj
        sendType,
        hasPdf: sendType === 'new'
      };

      logger.info({ case: caseData.caseNumber, sendType }, 'Webhook enviado');
      
      // TODO: Implementar envio real do webhook
      // await sendWebhook(webhookData);
      
    } catch (error) {
      logger.error('Erro ao enviar webhook:', error);
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

  private extractCaseNumber(text: string): string {
    const match = text.match(/F-?\d{2}-\d{4,}/i) || text.match(/\d{4}CV\d+/i);
    return match ? match[0] : '';
  }

  private extractFirstName(fullName: string): string {
    const parts = fullName.trim().split(/\s+/);
    return parts[0] || '';
  }

  private extractLastName(fullName: string): string {
    const parts = fullName.trim().split(/\s+/);
    return parts.slice(1).join(' ') || '';
  }

  private extractPropertyAddress(content: string): string {
    // Procurar por padrões de endereço
    const addressMatch = content.match(/\d+\s+[A-Za-z\s]+(Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd)/i);
    return addressMatch ? addressMatch[0] : '';
  }

  private extractLender(content: string): string {
    // Procurar por nomes de bancos comuns
    const lenderMatch = content.match(/(Wells Fargo|Bank of America|Chase|Citibank|US Bank|[A-Z][a-z]+\s+(Bank|Mortgage|Financial))/i);
    return lenderMatch ? lenderMatch[0] : '';
  }

  private extractLoanAmount(content: string): number | undefined {
    const amountMatch = content.match(/\$[\d,]+\.?\d*/);
    if (amountMatch) {
      const amount = parseFloat(amountMatch[0].replace(/[$,]/g, ''));
      return isNaN(amount) ? undefined : amount;
    }
    return undefined;
  }

  private extractLotBlock(content: string): { lotNumber?: string; blockNumber?: string } {
    const lotMatch = content.match(/lot\s*:?\s*(\d+)/i);
    const blockMatch = content.match(/block\s*:?\s*(\d+)/i);
    
    return {
      lotNumber: lotMatch ? lotMatch[1] : undefined,
      blockNumber: blockMatch ? blockMatch[1] : undefined
    };
  }

  async cleanup(): Promise<void> {
    if (this.context) await this.context.close();
    if (this.browser) await this.browser.close();
    logger.info('NJ Foreclosure Runner finalizado');
  }
}

export default NJForeclosureRunner;