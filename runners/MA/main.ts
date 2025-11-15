#!/usr/bin/env ts-node
// Massachusetts System Main Entry Point
// Decide entre executar scheduler automático ou modo interativo

import { startMassachusettsScheduler } from './scheduler';
import MARunnerExecutor from './executor';
import { MA_DEFAULT_OPTIONS } from './config';
import { logger } from '../../utils/logger';

async function main() {
  const runnerMode = MA_DEFAULT_OPTIONS.runnerMode || 'interactive';
  
  logger.info('🏛️ Massachusetts Court System Scraper');
  logger.info(`🔧 Modo configurado: ${runnerMode}`);
  
  if (runnerMode === 'interactive') {
    // Modo interativo - executar o menu tradicional
    logger.info('💬 Iniciando modo interativo...');
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
      logger.error('💥 Erro fatal no modo interativo:', error);
      executor.close();
      process.exit(1);
    }
  } else {
    // Modo automatizado - executar o scheduler
    logger.info('🤖 Iniciando modo automatizado com scheduler...');
    
    try {
      const scheduler = await startMassachusettsScheduler();
      
      // Capturar Ctrl+C para limpeza
      process.on('SIGINT', async () => {
        console.log('\n\n🛑 Interrompido pelo usuário...');
        await scheduler.stop();
        process.exit(0);
      });
      
      // Manter o processo rodando
      process.on('uncaughtException', (error) => {
        logger.error('💥 Erro não capturado:', error);
      });
      
      process.on('unhandledRejection', (reason) => {
        logger.error('💥 Promise rejeitada:', reason);
      });
      
    } catch (error) {
      logger.error('💥 Erro fatal no scheduler:', error);
      process.exit(1);
    }
  }
}

// Verificar se está sendo executado diretamente
if (require.main === module) {
  main().catch(error => {
    logger.error('💥 Erro fatal na inicialização:', error);
    process.exit(1);
  });
}

export { main };