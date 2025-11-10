// Massachusetts Automated Scheduler - Execução contínua baseada em RUNNER_MODE
import MARunnerExecutor from './executor';
import { MA_DEFAULT_OPTIONS } from './config';
import { logger } from '../../utils/logger';

export class MassachusettsScheduler {
  private executor: MARunnerExecutor;
  private runnerMode: string;
  private scheduleHour: number;
  private isRunning = false;

  constructor() {
    this.executor = new MARunnerExecutor();
    this.runnerMode = MA_DEFAULT_OPTIONS.runnerMode || 'interactive';
    this.scheduleHour = MA_DEFAULT_OPTIONS.scheduleHour || 9;
  }

  async start() {
    logger.info(`🤖 Massachusetts Scheduler iniciado`);
    logger.info(`📅 Modo: ${this.runnerMode}`);
    logger.info(`⏰ Horário programado: ${this.scheduleHour}:00`);

    // Se for modo interativo, execuar o menu normal
    if (this.runnerMode === 'interactive') {
      logger.info('💬 Modo interativo - iniciando menu...');
      return await this.executor.start();
    }

    // Modo automatizado - executar imediatamente na primeira vez
    logger.info('🔄 Modo automatizado - executando imediatamente...');
    await this.executeRunner();

    // Configurar execução diária no horário programado
    this.scheduleDaily();
  }

  private async executeRunner() {
    if (this.isRunning) {
      logger.warn('⚠️ Execução já em andamento - pulando...');
      return;
    }

    this.isRunning = true;
    logger.info(`🚀 Iniciando execução automática - Modo: ${this.runnerMode}`);
    
    try {
      switch (this.runnerMode) {
        case '1':
        case 'all':
          logger.info('📋 Executando TODOS os scrapers...');
          await this.executor.executeAllScrapers();
          break;
          
        case '2':
        case 'preforeclosure':
          logger.info('⚠️ Executando Pre-Foreclosure apenas...');
          await this.executor.executePreForeclosure();
          break;
          
        case '3':
        case 'hoa':
          logger.info('🏘️ Executando HOA apenas...');
          await this.executor.executeHOA();
          break;
          
        case '4':  
        case 'probate':
          logger.info('⚖️ Executando Probate apenas...');
          await this.executor.executeProbate();
          break;
          
        case '5':
        case 'foreclosure':
          logger.info('🏠 Executando Foreclosure apenas...');
          await this.executor.executeForeclosure();
          break;
          
        default:
          logger.error(`❌ Modo inválido: ${this.runnerMode}`);
          logger.info('💡 Modos válidos: 1|2|3|4|5|all|preforeclosure|hoa|probate|foreclosure|interactive');
          return;
      }
      
      logger.info(`✅ Execução automática concluída - Modo: ${this.runnerMode}`);
      
    } catch (error) {
      logger.error(`❌ Erro na execução automática:`, error);
    } finally {
      this.isRunning = false;
    }
  }

  private scheduleDaily() {
    const now = new Date();
    const scheduledTime = new Date();
    scheduledTime.setHours(this.scheduleHour, 0, 0, 0);

    // Se o horário já passou hoje, agendar para amanhã
    if (scheduledTime <= now) {
      scheduledTime.setDate(scheduledTime.getDate() + 1);
    }

    const msUntilNext = scheduledTime.getTime() - now.getTime();
    const hoursUntilNext = Math.round(msUntilNext / (1000 * 60 * 60));

    logger.info(`⏳ Próxima execução agendada para: ${scheduledTime.toLocaleString('pt-BR')} (em ${hoursUntilNext}h)`);

    setTimeout(() => {
      this.executeRunner();
      // Re-agendar para o próximo dia
      setInterval(() => {
        this.executeRunner();
      }, 24 * 60 * 60 * 1000); // 24 horas
    }, msUntilNext);
  }

  private getRunnerDescription(): string {
    const descriptions = {
      '1': 'Todos os scrapers',
      'all': 'Todos os scrapers',
      '2': 'Pre-Foreclosure apenas',
      'preforeclosure': 'Pre-Foreclosure apenas',
      '3': 'HOA apenas', 
      'hoa': 'HOA apenas',
      '4': 'Probate apenas',
      'probate': 'Probate apenas',
      '5': 'Foreclosure apenas',
      'foreclosure': 'Foreclosure apenas',
      'interactive': 'Menu interativo'
    };
    
    return descriptions[this.runnerMode as keyof typeof descriptions] || 'Modo desconhecido';
  }

  async stop() {
    logger.info('🛑 Parando Massachusetts Scheduler...');
    // Implementar lógica de parada se necessário
  }
}

// Função para uso direto
export async function startMassachusettsScheduler() {
  const scheduler = new MassachusettsScheduler();
  await scheduler.start();
  return scheduler;
}