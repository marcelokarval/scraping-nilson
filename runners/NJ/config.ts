import LocationPathManager from '../../utils/location_manager';

export interface NJRunOptions {
  headless?: boolean;
  daysBack?: number;
  county?: string;
}

export const NJ_CONFIG = {
  // Campos obrigatórios para BaseStateRunner
  state: 'NJ',
  stateName: 'New Jersey',
  
  // Configurações específicas de New Jersey
  location: 'NJ',
  name: 'New Jersey',
  
  // URLs principais
  urls: {
    essexRegister: 'https://press.essexregister.com/prodpress/clerk/ClerkHome.aspx?op=basic',
    registerOfDeeds: 'https://press.essexregister.com'
  },
  
  // Configurações de busca
  search: {
    defaultDaysBack: 1,
    maxDaysBack: 30,
    documentType: 'List Pending Foreclosure'
  },
  
  // Sufixos para webhooks (seguindo padrão solicitado)
  webhookSuffixes: {
    foreclosure: '_nj',
    hoa: '_nj', 
    probate: '_nj'
  },
  
  // User data directories para Playwright
  userDataDirs: {
    foreclosure: 'playwright_user_data_nj_foreclosure',
    hoa: 'playwright_user_data_nj_hoa',
    probate: 'playwright_user_data_nj_probate'
  },
  
  // Configurações de PDF e OCR
  pdf: {
    downloadEnabled: true,
    ocrEnabled: true,
    keyPages: [3], // Página 3 contém dados principais segundo tutorial
  },
  
  // Campos obrigatórios para extração
  requiredFields: [
    'instrumentNumber',
    'caseNumber', 
    'propertyAddress',
    'ownerName',
    'filingDate'
  ]
};

// New Jersey Essex County Municipalities (from actual website dropdown)
export const NJ_ESSEX_MUNICIPALITIES = [
  'Please Select a Municipality', // Default option
  'BELLEVILLE',
  'BLOOMFIELD', 
  'CALDWELL',
  'CEDAR GROVE',
  'EAST ORANGE',
  'ESSEX COUNTY',
  'ESSEX FELLS',
  'FAIRFIELD',
  'GLEN RIDGE',
  'IRVINGTON',
  'LIVINGSTON',
  'MAPLEWOOD',
  'MILLBURN',
  'MONTCLAIR',
  'NEWARK',
  'NORTH CALDWELL',
  'NUTLEY',
  'ORANGE',
  'ROSELAND',
  'SOUTH ORANGE VILLAGE',
  'VERONA',
  'WEST CALDWELL',
  'WEST ORANGE',
  'COUNTY WIDE'
] as const;

// New Jersey state-wide counties (for future expansion)
export const NJ_COUNTIES = [
  'Atlantic', 'Bergen', 'Burlington', 'Camden', 'Cape May',
  'Cumberland', 'Essex', 'Gloucester', 'Hudson', 'Hunterdon',
  'Mercer', 'Middlesex', 'Monmouth', 'Morris', 'Ocean',
  'Passaic', 'Salem', 'Somerset', 'Sussex', 'Union', 'Warren'
] as const;

// New Jersey specific court types
export const NJ_COURT_TYPES = {
  SUPERIOR: 'superior',
  MUNICIPAL: 'municipal',
  TAX: 'tax'
} as const;

// New Jersey specific webhook categories (com sufixos _nj)
export const NJ_WEBHOOK_CATEGORIES = {
  PROBATE: 'probate_nj',
  FORECLOSURE: 'foreclosure_nj',
  HOA: 'hoa_nj',
  CIVIL: 'civil_nj'
} as const;

// Instância do LocationPathManager para NJ
export const NJ_LOCATION_MANAGER = new LocationPathManager('NJ');

export default NJ_CONFIG;