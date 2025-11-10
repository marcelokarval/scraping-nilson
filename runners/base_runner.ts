// Base interfaces and types for all state runners

export interface BaseRunOptions {
  headless?: boolean;
  daysBack?: number;
  sendWebhook?: boolean;
  webhookUrl?: string;
}

export interface StateRunnerConfig {
  state: string;
  stateName: string;
  baseUrl?: string;
  userDataDir?: string;
  userAgent?: string;
}

export interface CaseRecord {
  caseNumber: string;
  processed: boolean;
  timestamp?: string;
  [key: string]: any;
}

export interface RunnerResult {
  success: boolean;
  processedCount: number;
  failedCount: number;
  skippedCount: number;
  errors?: string[];
}

export abstract class BaseStateRunner {
  protected config: StateRunnerConfig;
  protected locationManager?: any; // Will be typed properly when location_manager is imported
  
  constructor(config: StateRunnerConfig) {
    this.config = config;
  }

  abstract init(options?: BaseRunOptions): Promise<void>;
  abstract run(options?: BaseRunOptions): Promise<RunnerResult>;
  abstract close(): Promise<void>;
  abstract retrySkippedCases(): Promise<void>;

  protected abstract setupBrowser(options?: BaseRunOptions): Promise<void>;
  protected abstract navigateToMainPage(): Promise<void>;
  protected abstract extractCases(options?: BaseRunOptions): Promise<CaseRecord[]>;
  protected abstract processCases(cases: CaseRecord[]): Promise<RunnerResult>;

  getConfig(): StateRunnerConfig {
    return { ...this.config };
  }
}