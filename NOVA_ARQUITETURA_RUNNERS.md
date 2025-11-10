# Nova Arquitetura: Runners Organizados por Estado

## Visão Geral

A arquitetura foi completamente reestruturada para suportar múltiplos estados de forma escalável e organizada. Cada estado agora tem seu próprio diretório com runners específicos, configurações e lógica adaptada aos seus sistemas judiciais únicos.

## Estrutura Atual

```
runners/
├── base_runner.ts              # Classe base abstrata para todos os runners
├── index.ts                    # Barrel export principal
├── MA/                         # Massachusetts (MassCourts)
│   ├── index.ts               # Barrel export para MA
│   ├── config.ts              # Configurações específicas de MA
│   ├── probate_runner.ts      # Scraping de probate para MA
│   ├── hoa_runner.ts          # Scraping de HOA para MA  
│   ├── pre_foreclosure_runner.ts # Scraping de pré-execução para MA
│   └── foreclosure_runner.ts  # Scraping de execução para MA
└── NJ/                        # New Jersey (exemplo)
    ├── index.ts              # Barrel export para NJ
    ├── config.ts             # Configurações específicas de NJ
    └── probate_runner.ts     # Scraping de probate para NJ
```

## Estrutura de Dados Correspondente

```
data/
├── MA/                        # Dados de Massachusetts
│   ├── probate_processed_cases.json
│   ├── probate_failed_cases.json
│   ├── hoa_processed_cases.json
│   ├── hoa_failed_cases.json
│   ├── pre_foreclosure_processed_cases.json
│   ├── pre_foreclosure_failed_cases.json
│   ├── foreclosure_processed_cases.json
│   ├── Probate/              # PDFs e dados específicos
│   ├── HOA/
│   ├── Pre-Foreclosure/
│   └── Foreclosure/
└── NJ/                       # Dados de New Jersey
    ├── probate_processed_cases.json
    ├── probate_failed_cases.json
    ├── Probate/
    ├── Foreclosure/
    └── Civil/
```

## Padrões de Import

### Importação Simples por Estado:
```typescript
// Massachusetts
import { ProbateRunner, HOARunner } from './runners/MA';

// New Jersey  
import { NJProbateRunner } from './runners/NJ';
```

### Importação Namespace:
```typescript
import { MA, NJ } from './runners';

const maRunner = new MA.ProbateRunner();
const njRunner = new NJ.NJProbateRunner();
```

### Importação Específica:
```typescript
import { Massachusetts, NewJersey } from './runners';

const runner = new Massachusetts.ProbateRunner();
```

## Arquitetura Base

### BaseStateRunner
Classe abstrata que define a interface comum para todos os runners:

```typescript
export abstract class BaseStateRunner {
  protected config: StateRunnerConfig;
  
  abstract init(options?: BaseRunOptions): Promise<void>;
  abstract run(options?: BaseRunOptions): Promise<RunnerResult>;
  abstract close(): Promise<void>;
  abstract retrySkippedCases(): Promise<void>;
  
  // Métodos específicos que cada estado implementa diferente
  protected abstract setupBrowser(options?: BaseRunOptions): Promise<void>;
  protected abstract navigateToMainPage(): Promise<void>;
  protected abstract extractCases(options?: BaseRunOptions): Promise<CaseRecord[]>;
  protected abstract processCases(cases: CaseRecord[]): Promise<RunnerResult>;
}
```

## Configurações por Estado

### Massachusetts (config.ts):
```typescript
export const MA_CONFIG: StateRunnerConfig = {
  state: 'MA',
  stateName: 'Massachusetts',
  baseUrl: 'https://www.masscourts.org',
  userAgent: '...'
};

export const MA_DEPARTMENTS = {
  PROBATE: 'PF_DEPT',
  HOA: 'SC_DEPT',
  // ...
};
```

### New Jersey (config.ts):
```typescript
export const NJ_CONFIG: StateRunnerConfig = {
  state: 'NJ', 
  stateName: 'New Jersey',
  baseUrl: 'https://www.njcourts.gov',
  userAgent: '...'
};

export const NJ_COUNTIES = [
  'Atlantic', 'Bergen', 'Burlington', 
  // ...
];
```

## Benefícios da Nova Arquitetura

### 1. **Separação Clara de Responsabilidades**
- Cada estado tem sua própria lógica de scraping
- Configurações específicas isoladas
- Seletores e URLs únicos por estado

### 2. **Escalabilidade Extrema**
- Adicionar novo estado = criar novo diretório
- Zero impacto nos estados existentes
- Desenvolvimento paralelo por diferentes desenvolvedores

### 3. **Manutenibilidade**
- Mudanças em um estado não afetam outros
- Debugging focado e isolado
- Testes independentes por estado

### 4. **Flexibilidade de Configuração**
- Cada estado pode ter parâmetros únicos
- URLs, seletores, departamentos específicos
- Lógica de negócio adaptada ao sistema judicial local

### 5. **Imports Limpos e Intuitivos**
- Barrel exports eliminam caminhos longos
- Namespace claro por estado
- IntelliSense melhorado no VS Code

## Exemplo: Adicionando Novo Estado (New Hampshire)

### 1. Criar estrutura:
```bash
mkdir -p runners/NH
mkdir -p data/NH/{Probate,Foreclosure}
```

### 2. Configuração (runners/NH/config.ts):
```typescript
export const NH_CONFIG: StateRunnerConfig = {
  state: 'NH',
  stateName: 'New Hampshire', 
  baseUrl: 'https://www.courts.nh.gov',
  userAgent: '...'
};
```

### 3. Runner (runners/NH/probate_runner.ts):
```typescript
export class NHProbateRunner extends BaseStateRunner {
  constructor() {
    super(NH_CONFIG);
    this.locationManager = new LocationPathManager('NH');
  }
  
  // Implementações específicas para NH...
}
```

### 4. Barrel export (runners/NH/index.ts):
```typescript
export { NHProbateRunner } from './probate_runner';
export * from './config';
```

### 5. Uso:
```typescript
import { NHProbateRunner } from './runners/NH';

const runner = new NHProbateRunner();
await runner.run({ /* NH-specific options */ });
```

## Migração Realizada

### Arquivos Movidos:
- `masscourts/probate_runner.ts` → `runners/MA/probate_runner.ts`
- `masscourts/hoa_runner.ts` → `runners/MA/hoa_runner.ts`
- `masscourts/pre_foreclosure_runner.ts` → `runners/MA/pre_foreclosure_runner.ts`
- `masscourts/foreclosure_runner.ts` → `runners/MA/foreclosure_runner.ts`
- `masscourts/index.ts` → `runners/MA/index.ts` (com barrel exports)

### Imports Atualizados:
- `run_probate.ts`: Agora usa `import { ProbateRunner } from './runners/MA'`
- `run_hoa.ts`: Agora usa `import { HOARunner } from './runners/MA'`
- `run_pre_foreclosure.ts`: Agora usa `import { PreForeclosureRunner } from './runners/MA'`
- `run_foreclosure.ts`: Agora usa `import { ForeclosureRunner } from './runners/MA'`
- `run_all_scrapers.ts`: Import consolidado

### Compatibilidade Garantida:
- Todos os runners MA funcionam exatamente como antes
- Mesma funcionalidade, melhor organização
- Zero breaking changes para uso existente

## Execução Paralela Multi-Estado

```typescript
import { MA, NJ } from './runners';

async function runMultipleStates() {
  const maRunner = new MA.ProbateRunner();
  const njRunner = new NJ.NJProbateRunner();
  
  const promises = [
    maRunner.init().then(() => maRunner.run({ daysBack: 1 })),
    njRunner.init().then(() => njRunner.run({ county: 'Essex' }))
  ];
  
  const results = await Promise.allSettled(promises);
  
  // Process results for each state independently
  console.log('MA Result:', results[0]);
  console.log('NJ Result:', results[1]);
  
  await Promise.all([maRunner.close(), njRunner.close()]);
}
```

## Conclusão

Esta nova arquitetura transforma o sistema de um scraper específico para Massachusetts em uma **plataforma escalável multi-estado**. Cada estado pode ter:

- **Sites diferentes** (MassCourts vs NJCourts vs NYCourts)
- **Seletores únicos** (cada site tem HTML diferente)  
- **Lógica específica** (fluxos de navegação diferentes)
- **Parâmetros únicos** (condados, tipos de corte, departamentos)
- **Desenvolvimento independente** (equipes diferentes por estado)

O resultado é um sistema robusto, organizado e preparado para crescimento nacional! 🚀