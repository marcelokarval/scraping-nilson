// Massachusetts runners barrel export
// This allows clean imports like: import { ProbateRunner, HOARunner } from './runners/MA'

export { ProbateRunner } from './probate_runner';
export { HOARunner } from './hoa_runner';
export { PreForeclosureRunner } from './pre_foreclosure_runner';
export { ForeclosureRunner } from './foreclosure_runner';

export * from './config';

// Export the interactive executor
export { default as MARunnerExecutor } from './executor';

// Re-export location manager for convenience
export { default as LocationPathManager } from '../../utils/location_manager';

// Legacy orchestrator - keeping for backwards compatibility
import fs from 'fs';
import path from 'path';
import { logger } from '../../utils/logger';

interface SequenceConfig {
  name: string;
  options?: Record<string, any>;
  actions?: Record<string, any>;
}

// Coordinates multiple MassCourts scrapers - cada um abre/fecha sua própria janela
export class MassCourtsOrchestrator {
  private sequences: SequenceConfig[] = [];
  private readonly sequenceConfigPath: string;

  constructor(sequenceConfigPath = path.join(process.cwd(), 'config', 'sequences.json')) {
    this.sequenceConfigPath = sequenceConfigPath;
  }

  async init() {
    await this.loadSequences();
  }

  async run() {
    if (!this.sequences.length) {
      await this.loadSequences();
    }

    for (const seq of this.sequences) {
      const name = seq?.name || 'probate';
      logger.info({ sequence: name }, 'Starting MassCourts sequence');
      try {
        switch (name) {
          case 'probate':
            await this.runProbate(seq);
            break;
          case 'pre_foreclosure':
            await this.runPreForeclosure(seq);
            break;
          case 'hoa':
            await this.runHoa(seq);
            break;
          case 'foreclosure':
            await this.runForeclosure(seq);
            break;
          default:
            logger.warn({ name }, 'Unknown sequence name; skipping');
        }
      } catch (e) {
        logger.error({ name, error: e }, 'Sequence execution failed');
      }
      logger.info({ sequence: name }, 'Sequence completed - context closed');
    }
    
    logger.info('All sequences completed');
  }

  async close() {
    // Nada a fazer - cada runner fecha seu próprio contexto após run()
    logger.info('Orchestrator closed');
  }

  private async runProbate(seq: SequenceConfig) {
    const { ProbateRunner } = await import('./probate_runner');
    const runner = new ProbateRunner();
    try {
      await runner.init();
      await runner.run(seq.options || {});
    } finally {
      await runner.close();
    }
  }

  private async runPreForeclosure(seq: SequenceConfig) {
    const { PreForeclosureRunner } = await import('./pre_foreclosure_runner');
    const runner = new PreForeclosureRunner();
    try {
      await runner.init();
      await runner.run(seq.options || {});
    } finally {
      await runner.close();
    }
  }

  private async runHoa(seq: SequenceConfig) {
    const { HOARunner } = await import('./hoa_runner');
    const runner = new HOARunner();
    try {
      await runner.init();
      await runner.run(seq.options || {});
    } finally {
      await runner.close();
    }
  }

  private async runForeclosure(seq: SequenceConfig) {
    const { ForeclosureRunner } = await import('./foreclosure_runner');
    const runner = new ForeclosureRunner();
    try {
      await runner.init();
      await runner.run(seq.options || {});
    } finally {
      await runner.close();
    }
  }

  private async loadSequences() {
    try {
      if (!fs.existsSync(this.sequenceConfigPath)) {
        logger.warn({ sequenceConfigPath: this.sequenceConfigPath }, 'Sequences config missing; defaulting to probate only');
        this.sequences = [{ name: 'probate' }];
        return;
      }
      const raw = fs.readFileSync(this.sequenceConfigPath, 'utf8');
      const parsed = JSON.parse(raw || '{}');
      const sequences = Array.isArray(parsed.sequences) ? parsed.sequences : [];
      this.sequences = sequences.length ? sequences : [{ name: 'probate' }];
    } catch (e) {
      logger.warn({ error: e }, 'Failed to load sequences config; defaulting to probate only');
      this.sequences = [{ name: 'probate' }];
    }
  }
}

export default MassCourtsOrchestrator;

// Export function to run all sequences
export async function runMassCourtsSequences(sequenceConfigPath?: string) {
  const orchestrator = new MassCourtsOrchestrator(sequenceConfigPath);
  try {
    await orchestrator.init();
    await orchestrator.run();
  } finally {
    await orchestrator.close();
  }
}
