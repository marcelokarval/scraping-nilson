// Massachusetts (MassCourts) specific configuration and types

import { BaseRunOptions, StateRunnerConfig } from '../base_runner';

export interface MARunOptions extends BaseRunOptions {
  divisionStartAfterValue?: string;
  divisionStartAfterName?: string;
  divisionStartFromValue?: string;
  divisionStartFromName?: string;
  divisionAllowList?: string[];
  departmentContains?: string;
  caseCd?: string;
  statCd?: string;
  ptyCd?: string | null;
}

export const MA_CONFIG: StateRunnerConfig = {
  state: 'MA',
  stateName: 'Massachusetts',
  baseUrl: 'https://www.masscourts.org',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
};

// Massachusetts specific default options
export const MA_DEFAULT_OPTIONS: Partial<MARunOptions> = {
  daysBack: 5, // 0 = busca apenas hoje, >0 = busca X dias atrás
  headless: false,
  sendWebhook: true
};

// Massachusetts specific court departments
export const MA_DEPARTMENTS = {
  PROBATE: 'PF_DEPT',
  HOA: 'SC_DEPT',
  PRE_FORECLOSURE: 'SC_DEPT', // Same as HOA but different case codes
  FORECLOSURE: 'LANDMARK_AUCTION' // Different site altogether
} as const;

// Massachusetts specific case codes
export const MA_CASE_CODES = {
  HOA: 'RP                            ',
  PRE_FORECLOSURE: 'RP                            ', // Same as HOA but different logic
  PROBATE: null // Probate doesn't use specific case codes
} as const;

// Massachusetts specific status codes
export const MA_STATUS_CODES = {
  OPEN: 'O                             ',
  CLOSED: 'C                             '
} as const;

// Massachusetts specific webhook categories
export const MA_WEBHOOK_CATEGORIES = {
  PROBATE: 'Probate',
  HOA: 'HOA',
  PRE_FORECLOSURE: 'Pre-Foreclosure',
  FORECLOSURE: 'Foreclosure'
} as const;