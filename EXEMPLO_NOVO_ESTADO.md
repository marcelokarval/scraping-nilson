# Exemplo: Adicionando Suporte para New York (NY)

Este documento demonstra como adicionar suporte para um novo estado usando o sistema de localização implementado.

## Passo 1: Atualizar as Configurações de Localização

Edite o arquivo `utils/location_manager.ts` e adicione NY às localizações suportadas:

```typescript
export const LOCATIONS: Record<string, LocationConfig> = {
  MA: {
    code: 'MA',
    name: 'Massachusetts',
    dataDir: 'MA'
  },
  NY: {
    code: 'NY',
    name: 'New York',
    dataDir: 'NY'
  }
  // Outros estados...
};
```

## Passo 2: Criar a Estrutura de Diretórios

```bash
mkdir -p data/NY
mkdir -p data/NY/Probate
mkdir -p data/NY/HOA
mkdir -p data/NY/Pre-Foreclosure
mkdir -p data/NY/Foreclosure
```

## Passo 3: Usar nos Runners

### Exemplo com ProbateRunner para NY:

```typescript
import { ProbateRunner } from './masscourts/probate_runner';

async function runNYProbate() {
  // Instanciar runner para New York
  const runner = new ProbateRunner('NY');
  
  try {
    await runner.init();
    
    await runner.run({
      departmentContains: 'PROBATE_DEPT', // Ajustar conforme necessário para NY
      daysBack: 7
    });
    
    await runner.close();
  } catch (error) {
    console.error('Erro no scraping de NY:', error);
  }
}
```

### Arquivos que serão criados automaticamente:

```
data/NY/
├── probate_processed_cases.json        # Casos processados
├── probate_failed_cases.json          # Casos falhados
└── Probate/                           # Diretório para PDFs e dados específicos
    ├── [CaseNumber]_FORMAL_PROBATE.pdf
    └── [CaseNumber]_formal_probate_extracted.json
```

## Passo 4: Criar Runners Específicos (Opcional)

Você pode criar arquivos de execução específicos para NY:

### `run_probate_ny.ts`:

```typescript
import { ProbateRunner } from './masscourts/probate_runner';

async function run() {
  process.env.PLAYWRIGHT_HEADLESS = 'false';
  
  const runner = new ProbateRunner('NY'); // Especifica NY
  
  try {
    console.log('🚀 Iniciando Probate Runner para New York...\n');
    
    await runner.init();
    
    await runner.run({
      departmentContains: 'NY_PROBATE_DEPT', // Ajustar conforme NY
      daysBack: 0
    });
    
    console.log('\n✅ Scraping de Probate NY concluído!');
    
    await runner.close();
  } catch (error) {
    console.error('❌ Erro durante scraping NY:', error);
    await runner.close();
    process.exit(1);
  }
}

run();
```

## Passo 5: Executar

```bash
# Para Massachusetts (padrão)
npm run ts-node run_probate.ts

# Para New York
npm run ts-node run_probate_ny.ts
```

## Verificação dos Caminhos

O LocationPathManager garantirá que os caminhos sejam corretos:

```typescript
const locationManager = new LocationPathManager('NY');

console.log(locationManager.getProcessedCasesPath('probate')); 
// Saída: /path/to/project/data/NY/probate_processed_cases.json

console.log(locationManager.getFailedCasesPath('hoa'));
// Saída: /path/to/project/data/NY/hoa_failed_cases.json

console.log(locationManager.getDataDir('Probate'));
// Saída: /path/to/project/data/NY/Probate
```

## Benefícios da Abordagem

1. **Zero Alterações no Código Core**: Os runners funcionam exatamente igual
2. **Isolamento de Dados**: Cada estado tem seus próprios arquivos
3. **Facilidade de Manutenção**: Adicionar novos estados é trivial
4. **Flexibilidade**: Permite execução simultânea para múltiplos estados
5. **Organização Clara**: Estrutura intuitiva e fácil de navegar

## Executando Múltiplos Estados Simultaneamente

```typescript
import { ProbateRunner } from './masscourts/probate_runner';

async function runMultipleStates() {
  const states = ['MA', 'NY', 'CA'];
  
  const promises = states.map(async (state) => {
    const runner = new ProbateRunner(state);
    
    try {
      await runner.init();
      await runner.run({ daysBack: 1 });
      await runner.close();
      console.log(`✅ ${state} concluído`);
    } catch (error) {
      console.error(`❌ Erro em ${state}:`, error);
    }
  });
  
  await Promise.all(promises);
}
```

Este sistema torna a expansão geográfica do scraping extremamente simples e organizizada!