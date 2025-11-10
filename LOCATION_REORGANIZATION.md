# Reorganização da Estrutura de Arquivos por Localização

## Resumo das Alterações

Foi implementada uma reorganização da estrutura de arquivos para suportar múltiplas localizações geográficas, facilitando a expansão do sistema de scraping para outros estados além de Massachusetts.

## Estrutura Anterior vs Nova

### Antes:
```
data/
├── failed_cases_after_retry.json              # Probate failed cases
├── failed_cases_after_retry_hoa.json          # HOA failed cases  
├── failed_cases_after_retry_preforeclosure.json # Pre-foreclosure failed cases
└── MA/
    ├── foreclosure_processed_cases.json
    ├── hoa_processed_cases.json
    ├── pre_foreclosure_processed_cases.json
    ├── probate_processed_cases.json
    ├── Foreclosure/
    ├── HOA/
    ├── Pre-Foreclosure/
    └── Probate/
```

### Depois:
```
data/
└── MA/                                     # Massachusetts (organizado por estado)
    ├── foreclosure_processed_cases.json
    ├── foreclosure_failed_cases.json      # Adicionado para futuro uso
    ├── hoa_processed_cases.json
    ├── hoa_failed_cases.json             # Movido de failed_cases_after_retry_hoa.json
    ├── pre_foreclosure_processed_cases.json
    ├── pre_foreclosure_failed_cases.json  # Movido de failed_cases_after_retry_preforeclosure.json
    ├── probate_processed_cases.json
    ├── probate_failed_cases.json          # Movido de failed_cases_after_retry.json
    ├── Foreclosure/
    ├── HOA/
    ├── Pre-Foreclosure/
    └── Probate/
```

### Para o futuro:
```
data/
├── MA/     # Massachusetts
├── NY/     # New York  
├── CA/     # California
└── ...     # Outros estados
```

## Novo Sistema de Gerenciamento de Localização

### LocationPathManager (`utils/location_manager.ts`)

Criado um utilitário centralizado para gerenciar caminhos baseados na localização geográfica:

```typescript
import LocationPathManager from '../utils/location_manager';

// Criar um gerenciador para Massachusetts (padrão)
const locationManager = new LocationPathManager('MA');

// Métodos disponíveis:
locationManager.getProcessedCasesPath('probate');     // data/MA/probate_processed_cases.json
locationManager.getFailedCasesPath('hoa');           // data/MA/hoa_failed_cases.json
locationManager.getDataDir('Probate');               // data/MA/Probate
locationManager.getBaseDataDir();                    // data/MA
```

### Configurações Suportadas:

```typescript
export const LOCATIONS: Record<string, LocationConfig> = {
  MA: {
    code: 'MA',
    name: 'Massachusetts',
    dataDir: 'MA'
  }
  // Futuros estados podem ser facilmente adicionados aqui
};
```

## Alterações nos Runners

Todos os runners foram atualizados para usar o novo sistema:

1. **ProbateRunner**: Agora aceita `locationCode` no construtor
2. **HOARunner**: Agora aceita `locationCode` no construtor  
3. **PreForeclosureRunner**: Agora aceita `locationCode` no construtor
4. **ForeclosureRunner**: Agora aceita `locationCode` no construtor

### Exemplo de uso:

```typescript
// Para Massachusetts (padrão)
const runner = new ProbateRunner();

// Para um futuro estado (quando configurado)
const runner = new ProbateRunner('NY');
```

## Arquivos Movidos

1. `data/failed_cases_after_retry.json` → `data/MA/probate_failed_cases.json`
2. `data/failed_cases_after_retry_hoa.json` → `data/MA/hoa_failed_cases.json`
3. `data/failed_cases_after_retry_preforeclosure.json` → `data/MA/pre_foreclosure_failed_cases.json`

## Benefícios

1. **Escalabilidade**: Fácil adição de novos estados/regiões
2. **Organização**: Estrutura clara e consistente por localização
3. **Manutenção**: Código centralizado para gerenciamento de caminhos
4. **Flexibilidade**: Sistema preparado para expansão geográfica
5. **Compatibilidade**: Alterações mantêm a funcionalidade existente

## Adicionando Novas Localizações

Para adicionar um novo estado (ex: New York):

1. Adicionar configuração em `utils/location_manager.ts`:
```typescript
NY: {
  code: 'NY',
  name: 'New York',
  dataDir: 'NY'
}
```

2. Criar estrutura de diretórios:
```bash
mkdir -p data/NY/{Probate,HOA,Pre-Foreclosure,Foreclosure}
```

3. Usar nos runners:
```typescript
const runner = new ProbateRunner('NY');
```

O sistema agora está preparado para uma expansão geográfica natural e organizada!