#!/usr/bin/env ts-node
// Script Executor Interativo para Massachusetts (MassCourts)
// Consolida todos os runners MA em uma interface unificada

import { ProbateRunner, HOARunner, PreForeclosureRunner, ForeclosureRunner } from './index';
import { MA_DEFAULT_OPTIONS } from './config';
import { createInterface } from 'readline';
import { logger } from '../../utils/logger';
import path from 'path';
import fs from 'fs';

interface MenuOption {
  key: string;
  description: string;
  action: () => Promise<void>;
}

class MARunnerExecutor {
  private rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  constructor() {
    // Configurar ambiente padrão
    process.env.PLAYWRIGHT_HEADLESS = process.env.PLAYWRIGHT_HEADLESS || 'false';
  }

  private async showMenu(): Promise<void> {
    console.log('\n' + '='.repeat(60));
    console.log('🏛️  MASSACHUSETTS COURTS SCRAPER - EXECUTOR MANUAL');
    console.log('='.repeat(60));
    console.log('');
    console.log('📋 Escolha uma opção:');
    console.log('');
    console.log('  1️⃣  - Executar TODOS os scrapers (Probate + HOA + Pre-Foreclosure + Foreclosure)');
    console.log('  2️⃣  - Executar Pre-Foreclosure apenas');
    console.log('  3️⃣  - Executar HOA apenas');
    console.log('  4️⃣  - Executar Probate apenas');
    console.log('  5️⃣  - Executar Foreclosure apenas');
    console.log('');
    console.log('  ⚙️  - Configurações avançadas:');
    console.log('  6️⃣  - Executar com modo headless (sem interface gráfica)');
    console.log('  7️⃣  - Executar com configurações personalizadas');
    console.log('');
    console.log('  0️⃣  - Sair');
    console.log('');
    console.log('='.repeat(60));
  }

  private async getInput(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(prompt, (answer) => {
        resolve(answer.trim());
      });
    });
  }

  private async runAllScrapers(): Promise<void> {
    console.log('\n🚀 Iniciando TODOS os scrapers de Massachusetts...\n');
    
    const runners = [
      { name: 'Probate', runner: new ProbateRunner(), options: { ...MA_DEFAULT_OPTIONS, departmentContains: 'PF_DEPT' } },
      { name: 'HOA', runner: new HOARunner(), options: { ...MA_DEFAULT_OPTIONS, departmentContains: 'SC_DEPT', caseCd: 'RP                            ', statCd: 'O                             ', ptyCd: null } },
      { name: 'Pre-Foreclosure', runner: new PreForeclosureRunner(), options: { ...MA_DEFAULT_OPTIONS, departmentContains: 'SC_DEPT', caseCd: 'RP                            ', statCd: 'O                             ', ptyCd: null } },
      { name: 'Foreclosure', runner: new ForeclosureRunner(), options: { ...MA_DEFAULT_OPTIONS, stateFilter: 'MA' } }
    ];

    for (const { name, runner, options } of runners) {
      try {
        console.log(`\n📊 Iniciando ${name}...`);
        await runner.init();
        await runner.run(options);
        console.log(`✅ ${name} concluído com sucesso!`);
        await runner.close();
      } catch (error) {
        console.error(`❌ Erro no ${name}:`, error);
        await runner.close();
      }
    }
  }

  private async runPreForeclosure(): Promise<void> {
    console.log('\n🚀 Iniciando Pre-Foreclosure Runner (MassCourts)...\n');
    const runner = new PreForeclosureRunner();
    
    try {
      await runner.init();
      await runner.run({
        ...MA_DEFAULT_OPTIONS,
        departmentContains: 'SC_DEPT',
        caseCd: 'RP                            ',
        statCd: 'O                             ',
        ptyCd: null
      });
      console.log('\n✅ Scraping de Pre-Foreclosure concluído com sucesso!');
      await runner.close();
    } catch (error) {
      console.error('❌ Erro durante scraping Pre-Foreclosure:', error);
      await runner.close();
      throw error;
    }
  }

  private async runHOA(): Promise<void> {
    console.log('\n🚀 Iniciando HOA Runner (MassCourts)...\n');
    const runner = new HOARunner();
    
    try {
      await runner.init();
      await runner.run({
        ...MA_DEFAULT_OPTIONS,
        departmentContains: 'SC_DEPT',
        caseCd: 'RP                            ',
        statCd: 'O                             ',
        ptyCd: null
      });
      console.log('\n✅ Scraping de HOA concluído com sucesso!');
      await runner.close();
    } catch (error) {
      console.error('❌ Erro durante scraping HOA:', error);
      await runner.close();
      throw error;
    }
  }

  private async runProbate(): Promise<void> {
    console.log('\n🚀 Iniciando Probate Runner (MassCourts)...\n');
    const runner = new ProbateRunner();
    
    try {
      await runner.init();
      await runner.run({
        ...MA_DEFAULT_OPTIONS,
        departmentContains: 'PF_DEPT'
      });
      console.log('\n✅ Scraping de Probate concluído com sucesso!');
      await runner.close();
    } catch (error) {
      console.error('❌ Erro durante scraping Probate:', error);
      await runner.close();
      throw error;
    }
  }

  private async runForeclosure(): Promise<void> {
    console.log('\n🚀 Iniciando Foreclosure Runner (Landmark Auction)...\n');
    const runner = new ForeclosureRunner();
    
    try {
      await runner.init();
      await runner.run({
        ...MA_DEFAULT_OPTIONS,
        stateFilter: 'MA',
        enableEnrichment: true,
        forceReenrichment: false  // Set to true to force re-enrichment of already processed cases
      });
      console.log('\n✅ Scraping de Foreclosure concluído com sucesso!');
      await runner.close();
    } catch (error) {
      console.error('❌ Erro durante scraping Foreclosure:', error);
      await runner.close();
      throw error;
    }
  }

  private async runWithHeadless(): Promise<void> {
    console.log('\n⚙️ Configurando modo headless...\n');
    process.env.PLAYWRIGHT_HEADLESS = 'true';
    
    const choice = await this.getInput('Qual scraper executar em modo headless? (1=Todos, 2=Pre-Foreclosure, 3=HOA, 4=Probate, 5=Foreclosure): ');
    
    switch (choice) {
      case '1': await this.runAllScrapers(); break;
      case '2': await this.runPreForeclosure(); break;
      case '3': await this.runHOA(); break;
      case '4': await this.runProbate(); break;
      case '5': await this.runForeclosure(); break;
      default: console.log('❌ Opção inválida!'); break;
    }
    
    // Restaurar configuração
    process.env.PLAYWRIGHT_HEADLESS = 'false';
  }

  private async runWithCustomConfig(): Promise<void> {
    console.log('\n⚙️ Configurações personalizadas:\n');
    
    const headless = await this.getInput('Modo headless? (s/n) [n]: ') || 'n';
    const daysBack = await this.getInput(`Dias para voltar na busca [${MA_DEFAULT_OPTIONS.daysBack}]: `) || MA_DEFAULT_OPTIONS.daysBack?.toString() || '7';
    const department = await this.getInput('Departamento específico (deixe vazio para padrão): ');
    
    process.env.PLAYWRIGHT_HEADLESS = headless.toLowerCase() === 's' ? 'true' : 'false';
    
    const customOptions = {
      daysBack: parseInt(daysBack),
      ...(department && { departmentContains: department })
    };
    
    console.log('\n📋 Configurações aplicadas:', customOptions);
    
    const choice = await this.getInput('\nQual scraper executar? (1=Todos, 2=Pre-Foreclosure, 3=HOA, 4=Probate, 5=Foreclosure): ');
    
    // Aqui você poderia implementar a lógica com as configurações personalizadas
    switch (choice) {
      case '1': await this.runAllScrapers(); break;
      case '2': await this.runPreForeclosure(); break;
      case '3': await this.runHOA(); break;
      case '4': await this.runProbate(); break;
      case '5': await this.runForeclosure(); break;
      default: console.log('❌ Opção inválida!'); break;
    }
  }

  async start(): Promise<void> {
    console.log('🔄 Iniciando Massachusetts Courts Scraper...');
    
    while (true) {
      await this.showMenu();
      const choice = await this.getInput('👉 Digite sua escolha: ');

      try {
        switch (choice) {
          case '1':
            await this.runAllScrapers();
            break;
          case '2':
            await this.runPreForeclosure();
            break;
          case '3':
            await this.runHOA();
            break;
          case '4':
            await this.runProbate();
            break;
          case '5':
            await this.runForeclosure();
            break;
          case '6':
            await this.runWithHeadless();
            break;
          case '7':
            await this.runWithCustomConfig();
            break;
          case '0':
            console.log('\n👋 Encerrando executor...');
            this.rl.close();
            return;
          default:
            console.log('\n❌ Opção inválida! Por favor, escolha uma opção válida.');
            break;
        }
        
        if (choice !== '0') {
          const continuar = await this.getInput('\n🔄 Pressione Enter para voltar ao menu principal ou digite "sair" para encerrar: ');
          if (continuar.toLowerCase() === 'sair') {
            console.log('\n👋 Encerrando executor...');
            this.rl.close();
            return;
          }
        }
        
      } catch (error) {
        console.error('\n💥 Erro durante execução:', error);
        const continuar = await this.getInput('\n🔄 Pressione Enter para voltar ao menu principal: ');
      }
    }
  }

  close(): void {
    this.rl.close();
  }
}

// Executar se chamado diretamente
async function main() {
  const executor = new MARunnerExecutor();
  
  // Capturar Ctrl+C para limpeza
  process.on('SIGINT', () => {
    console.log('\n\n🛑 Interrompido pelo usuário...');
    executor.close();
    process.exit(0);
  });
  
  try {
    await executor.start();
  } catch (error) {
    console.error('💥 Erro fatal:', error);
    executor.close();
    process.exit(1);
  }
}

// Executar se este arquivo for chamado diretamente
if (require.main === module) {
  main();
}

export default MARunnerExecutor;