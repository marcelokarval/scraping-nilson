import path from 'path';

export interface LocationConfig {
  code: string;
  name: string;
  dataDir: string;
}

export const LOCATIONS: Record<string, LocationConfig> = {
  MA: {
    code: 'MA',
    name: 'Massachusetts',
    dataDir: 'MA'
  },
  NJ: {
    code: 'NJ',
    name: 'New Jersey',
    dataDir: 'NJ'
  },
  NH: {
    code: 'NH',
    name: 'New Hampshire',
    dataDir: 'NH'
  }
  // Futuros estados podem ser adicionados aqui
  // NY: {
  //   code: 'NY',
  //   name: 'New York',
  //   dataDir: 'NY'
  // },
  // CA: {
  //   code: 'CA',
  //   name: 'California',
  //   dataDir: 'CA'
  // }
};

export class LocationPathManager {
  private location: LocationConfig;

  constructor(locationCode: string = 'MA') {
    const loc = LOCATIONS[locationCode.toUpperCase()];
    if (!loc) {
      throw new Error(`Location ${locationCode} not supported. Available: ${Object.keys(LOCATIONS).join(', ')}`);
    }
    this.location = loc;
  }

  /**
   * Retorna o caminho para arquivos de casos processados
   */
  getProcessedCasesPath(type: 'probate' | 'hoa' | 'pre_foreclosure' | 'foreclosure'): string {
    return path.join(process.cwd(), 'data', this.location.dataDir, `${type}_processed_cases.json`);
  }

  /**
   * Retorna o caminho para arquivos de casos falhados
   */
  getFailedCasesPath(type: 'probate' | 'hoa' | 'pre_foreclosure' | 'foreclosure'): string {
    return path.join(process.cwd(), 'data', this.location.dataDir, `${type}_failed_cases.json`);
  }

  /**
   * Retorna o caminho para diretórios de dados específicos por tipo
   */
  getDataDir(type: 'Probate' | 'HOA' | 'Pre-Foreclosure' | 'Foreclosure'): string {
    return path.join(process.cwd(), 'data', this.location.dataDir, type);
  }

  /**
   * Retorna o caminho base para o estado/localização
   */
  getBaseDataDir(): string {
    return path.join(process.cwd(), 'data', this.location.dataDir);
  }

  /**
   * Retorna informações sobre a localização atual
   */
  getLocationInfo(): LocationConfig {
    return { ...this.location };
  }

  /**
   * Lista todas as localizações disponíveis
   */
  static getAvailableLocations(): LocationConfig[] {
    return Object.values(LOCATIONS);
  }
}

export default LocationPathManager;