import LocationPathManager from '../../utils/location_manager';

export interface NHRunOptions {
  headless?: boolean;
  daysBack?: number;
  county?: string;
  enrichmentEnabled?: boolean;
}

export const NH_CONFIG = {
  // Campos obrigatórios para BaseStateRunner
  state: 'NH',
  stateName: 'New Hampshire',
  
  // Configurações específicas de New Hampshire
  location: 'NH',
  name: 'New Hampshire',
  
  // URLs principais
  urls: {
    primarySearch: 'https://www.landmarkauction.biz/', // Site Landmark Auction para busca inicial de foreclosures NH
    enrichmentSite: 'https://app.regrid.com/us/nh#', // Site RegGrid para enriquecimento de dados
  },
  
  // Configurações de busca em duas fases
  searchPhases: {
    phase1: {
      name: 'Initial Property Search',
      site: 'landmark_auction',
      purpose: 'find_foreclosure_cases',
      defaultDaysBack: 1,
      maxDaysBack: 30,
      simulationMode: false, // Usar busca real no site NH
      simulatedCases: false
    },
    phase2: {
      name: 'Data Enrichment via RegGrid',
      site: 'regrid_property_search', 
      purpose: 'enrich_property_data_regrid',
      enabled: true,
      searchField: 'address_input_top_right',
      resultsArea: 'left_bottom_panel'
    }
  },
  
  // Sufixos para webhooks (seguindo padrão solicitado)
  webhookSuffixes: {
    foreclosure: '_nh',
    hoa: '_nh', 
    probate: '_nh'
  },
  
  // User data directories para Playwright
  userDataDirs: {
    foreclosure: 'playwright_user_data_nh_foreclosure',
    enrichment: 'playwright_user_data_nh_enrichment',
    hoa: 'playwright_user_data_nh_hoa',
    probate: 'playwright_user_data_nh_probate'
  },
  
  // Configurações de PDF e OCR
  pdf: {
    downloadEnabled: true,
    ocrEnabled: true,
    phases: ['initial', 'enrichment']
  },
  
  // Campos obrigatórios para extração
  requiredFields: {
    phase1: [
      'caseNumber',
      'propertyAddress', 
      'ownerName',
      'filingDate'
    ],
    phase2: [
      'propertyValue',
      'mortgageAmount',
      'lenderInfo',
      'propertyDetails'
    ]
  }
};

// New Hampshire specific counties
export const NH_COUNTIES = [
  'Belknap', 'Carroll', 'Cheshire', 'Coos', 'Grafton',
  'Hillsborough', 'Merrimack', 'Rockingham', 'Strafford', 'Sullivan'
] as const;

// New Hampshire specific webhook categories (com sufixos _nh)
export const NH_WEBHOOK_CATEGORIES = {
  PROBATE: 'probate_nh',
  FORECLOSURE: 'foreclosure_nh',
  HOA: 'hoa_nh',
  CIVIL: 'civil_nh'
} as const;

// Instância do LocationPathManager para NH
export const NH_LOCATION_MANAGER = new LocationPathManager('NH');

export default NH_CONFIG;