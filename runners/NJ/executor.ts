import * as readline from 'readline';
import { NJForeclosureRunner, NJ_CONFIG, NJ_ESSEX_MUNICIPALITIES } from './index';
import { logger } from '../../utils/logger';

export interface NJExecutorOptions {
  headless?: boolean;
  daysBack?: number;
  municipality?: string;
  customConfig?: boolean;
}

export class NJRunnerExecutor {
  private rl: readline.Interface;
  private options: NJExecutorOptions = {
    headless: false,
    daysBack: 1,
    municipality: 'COUNTY WIDE'
  };

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  async start(): Promise<void> {
    console.log('\n🔄 Iniciando New Jersey Courts Scraper...\n');
    await this.showMenu();
  }

  private async showMenu(): Promise<void> {
    console.log('============================================================');
    console.log('🏛️  NEW JERSEY COURTS SCRAPER - EXECUTOR MANUAL');
    console.log('============================================================\n');
    console.log('📋 Escolha uma opção:\n');
    console.log('  1️⃣  - Executar Foreclosure (Essex Register)');
    console.log('  2️⃣  - Executar HOA (Em desenvolvimento)');
    console.log('  3️⃣  - Executar Probate (Em desenvolvimento)');
    console.log('  4️⃣  - Executar TODOS os scrapers disponíveis\n');
    console.log('  ⚙️  - Configurações avançadas:');
    console.log('  5️⃣  - Executar com modo headless (sem interface gráfica)');
    console.log('  6️⃣  - Executar com configurações personalizadas');
    console.log('  7️⃣  - Selecionar município específico do Essex County');
    console.log('  8️⃣  - Ver configurações atuais\n');
    console.log('  0️⃣  - Sair\n');
    console.log('============================================================');

    const choice = await this.askQuestion('👉 Digite sua escolha: ');
    await this.handleMenuChoice(choice.trim());
  }

  private async handleMenuChoice(choice: string): Promise<void> {
    switch (choice) {
      case '1':
        await this.runForeclosure();
        break;
      case '2':
        console.log('🚧 HOA Runner em desenvolvimento...');
        await this.continuePrompt();
        break;
      case '3':
        console.log('🚧 Probate Runner em desenvolvimento...');
        await this.continuePrompt();
        break;
      case '4':
        await this.runAllScrapers();
        break;
      case '5':
        await this.configureHeadlessMode();
        break;
      case '6':
        await this.configureCustomSettings();
        break;
      case '7':
        await this.configureMunicipality();
        break;
      case '8':
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

  private async runForeclosure(): Promise<void> {
    try {
      console.log('\n📊 Iniciando Foreclosure (Essex Register)...\n');
      
      const runner = new NJForeclosureRunner(this.options);
      await runner.run();
      
      console.log('✅ Foreclosure concluído com sucesso!\n');
    } catch (error) {
      console.error('❌ Erro durante execução do Foreclosure:', error);
      logger.error('Erro no Foreclosure Runner:', error);
    }
    
    await this.continuePrompt();
  }

  private async runAllScrapers(): Promise<void> {
    console.log('\n🚀 Iniciando TODOS os scrapers de New Jersey...\n');
    
    // Por enquanto apenas Foreclosure está implementado
    await this.runForeclosure();
    
    console.log('🎯 Todos os scrapers disponíveis foram executados!\n');
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
    
    console.log('✅ Configurações atualizadas!\n');
    await this.showMenu();
  }

  private async configureMunicipality(): Promise<void> {
    console.log('\n🏘️ Seleção de Município - Essex County...\n');
    
    console.log('Municípios disponíveis:');
    NJ_ESSEX_MUNICIPALITIES.forEach((municipality, index) => {
      if (municipality !== 'Please Select a Municipality') {
        console.log(`  ${index}. ${municipality}`);
      }
    });
    
    console.log('\n');
    const municipalityInput = await this.askQuestion(`Digite o nome do município (atual: ${this.options.municipality}) ou Enter para manter: `);
    
    if (municipalityInput.trim()) {
      const selectedMunicipality = municipalityInput.trim().toUpperCase();
      
      if (NJ_ESSEX_MUNICIPALITIES.includes(selectedMunicipality as any)) {
        this.options.municipality = selectedMunicipality;
        console.log(`✅ Município selecionado: ${selectedMunicipality}\n`);
      } else {
        console.log(`❌ Município inválido. Mantendo: ${this.options.municipality}\n`);
      }
    }
    
    await this.showMenu();
  }

  private async showCurrentSettings(): Promise<void> {
    console.log('\n📊 Configurações atuais:\n');
    console.log(`🔧 Estado: ${NJ_CONFIG.name}`);
    console.log(`🌐 Essex Register URL: ${NJ_CONFIG.urls.essexRegister}`);
    console.log(`📅 Dias para buscar: ${this.options.daysBack}`);
    console.log(`🏘️  Município: ${this.options.municipality}`);
    console.log(`👁️  Modo headless: ${this.options.headless ? 'ATIVADO' : 'DESATIVADO'}`);
    console.log(`📄 Document Type: ${NJ_CONFIG.search.documentType}`);
    console.log(`🎯 Webhook Suffix: ${NJ_CONFIG.webhookSuffixes.foreclosure}`);
    console.log('\n');
    
    await this.continuePrompt();
  }

  private async continuePrompt(): Promise<void> {
    await this.askQuestion('Pressione Enter para continuar...');
    await this.showMenu();
  }

  private async askQuestion(question: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(question, (answer) => {
        resolve(answer);
      });
    });
  }

  async exit(): Promise<void> {
    console.log('\n👋 Encerrando New Jersey Courts Scraper...\n');
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
  const executor = new NJRunnerExecutor();
  
  executor.start().catch((error) => {
    console.error('❌ Erro fatal no executor:', error);
    logger.error('Erro fatal no NJ Executor:', error);
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

export default NJRunnerExecutor;