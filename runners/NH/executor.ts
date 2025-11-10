import * as readline from 'readline';
import { NHForeclosureRunner, NH_CONFIG, NH_COUNTIES } from './index';
import { logger } from '../../utils/logger';

export interface NHExecutorOptions {
  headless?: boolean;
  daysBack?: number;
  county?: string;
  enrichmentEnabled?: boolean;
  customConfig?: boolean;
}

export class NHRunnerExecutor {
  private rl: readline.Interface;
  private options: NHExecutorOptions = {
    headless: false,
    daysBack: 1,
    county: 'All Counties',
    enrichmentEnabled: true
  };

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  async start(): Promise<void> {
    console.log('\n🔄 Iniciando New Hampshire Courts Scraper...\n');
    await this.showMenu();
  }

  private async showMenu(): Promise<void> {
    console.log('============================================================');
    console.log('🏔️  NEW HAMPSHIRE COURTS SCRAPER - EXECUTOR MANUAL');
    console.log('============================================================\n');
    console.log('📋 Escolha uma opção:\n');
    console.log('  1️⃣  - Executar Foreclosure (Duas Fases)');
    console.log('  2️⃣  - Executar apenas Fase 1 (Busca inicial)');
    console.log('  3️⃣  - Executar apenas Fase 2 (Enriquecimento)');
    console.log('  🧪 - TESTE REGRID:');
    console.log('  4️⃣  - Testar apenas RegGrid com casos simulados');
    console.log('  5️⃣  - Executar HOA (Em desenvolvimento)');
    console.log('  6️⃣  - Executar Probate (Em desenvolvimento)\n');
    console.log('  ⚙️  - Configurações avançadas:');
    console.log('  7️⃣  - Executar com modo headless (sem interface gráfica)');
    console.log('  8️⃣  - Executar com configurações personalizadas');
    console.log('  9️⃣  - Selecionar condado específico do New Hampshire');
    console.log('  🔍 - Ver configurações atuais\n');
    console.log('  0️⃣  - Sair\n');
    console.log('============================================================');

    const choice = await this.askQuestion('👉 Digite sua escolha: ');
    await this.handleMenuChoice(choice.trim());
  }

  private async handleMenuChoice(choice: string): Promise<void> {
    switch (choice) {
      case '1':
        await this.runForeclosureComplete();
        break;
      case '2':
        await this.runForeclosurePhase1Only();
        break;
      case '3':
        await this.runForeclosurePhase2Only();
        break;
      case '4':
        await this.testRegGridOnly();
        break;
      case '5':
        console.log('🚧 HOA Runner em desenvolvimento...');
        await this.continuePrompt();
        break;
      case '6':
        console.log('🚧 Probate Runner em desenvolvimento...');
        await this.continuePrompt();
        break;
      case '7':
        await this.configureHeadlessMode();
        break;
      case '8':
        await this.configureCustomSettings();
        break;
      case '9':
        await this.configureCounty();
        break;
      case 'c':
      case 'C':
      case '🔍':
        await this.showCurrentSettings();
        break;
      case '0':
        await this.exit();
        return;
      default:
        console.log('❌ Opção inválida. Tente novamente.\n');
        await this.showMenu();
    }
  }

  private async runForeclosureComplete(): Promise<void> {
    try {
      console.log('\n🏔️ Iniciando Foreclosure NH - DUAS FASES...\n');
      console.log('🔍 Fase 1: Busca inicial (estilo MassCourts)');
      console.log('💎 Fase 2: Enriquecimento de dados (site secundário)\n');
      
      const runner = new NHForeclosureRunner({
        ...this.options,
        enrichmentEnabled: true
      });
      await runner.run();
      
      console.log('✅ Foreclosure NH (duas fases) concluído com sucesso!\n');
    } catch (error) {
      console.error('❌ Erro durante execução do Foreclosure NH:', error);
      logger.error('Erro no NH Foreclosure Runner (completo):', error);
    }
    
    try {
      await this.continuePrompt();
    } catch (error) {
      // Ignorar erros de readline fechado
      if (error.code === 'ERR_USE_AFTER_CLOSE') {
        logger.info('Interface encerrada após execução.');
        return;
      }
      throw error;
    }
  }

  private async runForeclosurePhase1Only(): Promise<void> {
    try {
      console.log('\n🔍 Iniciando Foreclosure NH - APENAS FASE 1...\n');
      console.log('📊 Busca inicial de propriedades (estilo MassCourts)');
      console.log('⚠️  Enriquecimento de dados DESABILITADO\n');
      
      const runner = new NHForeclosureRunner({
        ...this.options,
        enrichmentEnabled: false
      });
      await runner.run();
      
      console.log('✅ Foreclosure NH (Fase 1) concluído com sucesso!\n');
    } catch (error) {
      console.error('❌ Erro durante execução da Fase 1:', error);
      logger.error('Erro no NH Foreclosure Runner (Fase 1):', error);
    }
    
    try {
      await this.continuePrompt();
    } catch (error) {
      // Ignorar erros de readline fechado
      if (error.code === 'ERR_USE_AFTER_CLOSE') {
        logger.info('Interface encerrada após execução.');
        return;
      }
      throw error;
    }
  }

  private async runForeclosurePhase2Only(): Promise<void> {
    console.log('\n💎 Fase 2 (apenas enriquecimento) ainda não implementada isoladamente.\n');
    console.log('🔧 Para executar apenas enriquecimento, use a opção 1 com casos já processados.\n');
    await this.continuePrompt();
  }

  private async testRegGridOnly(): Promise<void> {
    try {
      console.log('\n🧪 TESTE REGRID - New Hampshire...\n');
      console.log('🎯 Testando apenas o RegGrid com casos simulados');
      console.log('🔗 URL: https://app.regrid.com/us/nh#\n');
      
      console.log('📝 Casos simulados que serão testados:');
      console.log('   • 123 Main Street, Manchester, NH 03101');
      console.log('   • 456 Elm Street, Nashua, NH 03060');
      console.log('   • 789 Oak Avenue, Concord, NH 03301\n');
      
      const continueTest = await this.askQuestion('Continuar com o teste do RegGrid? (S/n): ');
      if (continueTest.toLowerCase().startsWith('n')) {
        await this.showMenu();
        return;
      }

      const runner = new NHForeclosureRunner({
        ...this.options,
        enrichmentEnabled: true
      });
      
      // Inicializar apenas o que é necessário para o RegGrid
      await runner.initialize();
      
      // Gerar casos simulados e executar apenas a Fase 2
      console.log('🚀 Iniciando teste do RegGrid...\n');
      const simulatedCases = runner.generateSimulatedCases();
      await (runner as any).phase2_DataEnrichment(simulatedCases);
      
      console.log('✅ Teste do RegGrid concluído!\n');
      await runner.cleanup();
      
    } catch (error) {
      console.error('❌ Erro durante teste do RegGrid:', error);
      logger.error('Erro no teste do RegGrid:', error);
    }
    
    await this.continuePrompt();
  }

  private async configureHeadlessMode(): Promise<void> {
    console.log('\n⚙️ Configurando modo headless...\n');
    
    const headlessChoice = await this.askQuestion('Executar sem interface gráfica? (s/N): ');
    this.options.headless = headlessChoice.toLowerCase().startsWith('s');
    
    console.log(`✅ Modo headless: ${this.options.headless ? 'ATIVADO' : 'DESATIVADO'}\n`);
    await this.showMenu();
  }

  private async configureCustomSettings(): Promise<void> {
    console.log('\n⚙️ Configurações personalizadas...\n');
    
    // Configurar dias para busca
    const daysInput = await this.askQuestion(`Dias para buscar (atual: ${this.options.daysBack}): `);
    if (daysInput.trim()) {
      const days = parseInt(daysInput.trim());
      if (!isNaN(days) && days > 0) {
        this.options.daysBack = days;
      }
    }
    
    // Configurar modo headless
    const headlessChoice = await this.askQuestion(`Modo headless (atual: ${this.options.headless ? 'SIM' : 'NÃO'}) [s/N]: `);
    if (headlessChoice.trim()) {
      this.options.headless = headlessChoice.toLowerCase().startsWith('s');
    }

    // Configurar enriquecimento
    const enrichmentChoice = await this.askQuestion(`Habilitar enriquecimento de dados (atual: ${this.options.enrichmentEnabled ? 'SIM' : 'NÃO'}) [s/N]: `);
    if (enrichmentChoice.trim()) {
      this.options.enrichmentEnabled = enrichmentChoice.toLowerCase().startsWith('s');
    }
    
    console.log('✅ Configurações atualizadas!\n');
    await this.showMenu();
  }

  private async configureCounty(): Promise<void> {
    console.log('\n🏔️ Seleção de Condado - New Hampshire...\n');
    
    console.log('Condados disponíveis:');
    NH_COUNTIES.forEach((county, index) => {
      console.log(`  ${index + 1}. ${county} County`);
    });
    console.log(`  ${NH_COUNTIES.length + 1}. All Counties (todos)\n`);
    
    const countyInput = await this.askQuestion(`Digite o nome do condado (atual: ${this.options.county}) ou Enter para manter: `);
    
    if (countyInput.trim()) {
      const selectedCounty = countyInput.trim();
      
      if (NH_COUNTIES.includes(selectedCounty as any) || selectedCounty.toLowerCase() === 'all' || selectedCounty.toLowerCase() === 'all counties') {
        this.options.county = selectedCounty;
        console.log(`✅ Condado selecionado: ${selectedCounty}\n`);
      } else {
        console.log(`❌ Condado inválido. Mantendo: ${this.options.county}\n`);
      }
    }
    
    await this.showMenu();
  }

  private async showCurrentSettings(): Promise<void> {
    console.log('\n📊 Configurações atuais:\n');
    console.log(`🔧 Estado: ${NH_CONFIG.name}`);
    console.log(`🌐 Site Principal: ${NH_CONFIG.urls.primarySearch}`);
    console.log(`💎 Site Enriquecimento: ${NH_CONFIG.urls.enrichmentSite}`);
    console.log(`📅 Dias para buscar: ${this.options.daysBack}`);
    console.log(`🏔️  Condado: ${this.options.county}`);
    console.log(`👁️  Modo headless: ${this.options.headless ? 'ATIVADO' : 'DESATIVADO'}`);
    console.log(`💎 Enriquecimento: ${this.options.enrichmentEnabled ? 'HABILITADO' : 'DESABILITADO'}`);
    console.log(`🎯 Webhook Suffix: ${NH_CONFIG.webhookSuffixes.foreclosure}`);
    console.log('\n📋 Fases do Processo:');
    console.log(`  🔍 Fase 1: ${NH_CONFIG.searchPhases.phase1.name}`);
    console.log(`  💎 Fase 2: ${NH_CONFIG.searchPhases.phase2.name}`);
    console.log('\n');
    
    await this.continuePrompt();
  }

  private async continuePrompt(): Promise<void> {
    try {
      await this.askQuestion('Pressione Enter para continuar...');
      await this.showMenu();
    } catch (error) {
      // Tratar caso o readline tenha sido fechado
      if (error.code === 'ERR_USE_AFTER_CLOSE') {
        logger.info('Interface foi encerrada, finalizando executor.');
        return;
      }
      throw error;
    }
  }

  private async askQuestion(question: string): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        this.rl.question(question, (answer) => {
          resolve(answer);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async exit(): Promise<void> {
    console.log('\n👋 Encerrando New Hampshire Courts Scraper...\n');
    this.close();
    process.exit(0);
  }

  close(): void {
    if (this.rl) {
      this.rl.close();
    }
  }
}

// Execução direta quando chamado como script
if (require.main === module) {
  const executor = new NHRunnerExecutor();
  
  executor.start().catch((error) => {
    console.error('❌ Erro fatal no executor:', error);
    logger.error('Erro fatal no NH Executor:', error);
    process.exit(1);
  });
  
  // Lidar com sinais de interrupção
  process.on('SIGINT', async () => {
    console.log('\n\n🛑 Interrupção detectada. Encerrando...');
    executor.close();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    console.log('\n\n🛑 Término solicitado. Encerrando...');
    executor.close();
    process.exit(0);
  });
}

export default NHRunnerExecutor;