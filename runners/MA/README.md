# 🏛️ Massachusetts Courts Scraper - Executor Manual

Executor interativo unificado para todos os scrapers de Massachusetts (MassCourts).

## 🚀 Como Usar

### Método 1: Script Shell (Recomendado)
```bash
# Na raiz do projeto
./runners/MA/run.sh
```

### Método 2: Execução Direta
```bash
# Na raiz do projeto
npx ts-node runners/MA/executor.ts
```

### Método 3: Via Node
```bash
# Na raiz do projeto  
npm run build
node dist/runners/MA/executor.js
```

## 📋 Menu de Opções

O executor apresenta um menu interativo com as seguintes opções:

### 🎯 Execução Principal
- **1️⃣ - Executar TODOS os scrapers**
  - Probate + HOA + Pre-Foreclosure + Foreclosure em sequência
  - Configurações otimizadas para cada tipo

- **2️⃣ - Executar Pre-Foreclosure apenas**
  - Scraping específico de casos de pré-execução
  - Departamento: SC_DEPT, Status: Aberto

- **3️⃣ - Executar HOA apenas**
  - Scraping de casos HOA (Homeowners Association)
  - Departamento: SC_DEPT, Tipo: RP

- **4️⃣ - Executar Probate apenas**
  - Scraping de casos de inventário/testamento
  - Departamento: PF_DEPT

- **5️⃣ - Executar Foreclosure apenas**
  - Scraping de leilões (Landmark Auction)
  - Filtro: Massachusetts

### ⚙️ Configurações Avançadas
- **6️⃣ - Modo Headless**
  - Execução sem interface gráfica do navegador
  - Ideal para servidores ou execução automatizada

- **7️⃣ - Configurações Personalizadas**
  - Dias para voltar na busca
  - Departamento específico
  - Modo headless customizável

### 🛑 Controles
- **0️⃣ - Sair**
- **Ctrl+C** - Interrupção forçada
- **Enter** - Voltar ao menu após execução

## 🔧 Configurações Padrão

### Probate
```typescript
{
  departmentContains: 'PF_DEPT',
  daysBack: 0
}
```

### HOA e Pre-Foreclosure
```typescript
{
  departmentContains: 'SC_DEPT',
  daysBack: 0,
  caseCd: 'RP                            ',
  statCd: 'O                             ',
  ptyCd: null
}
```

### Foreclosure
```typescript
{
  stateFilter: 'MA',
  daysBack: 0
}
```

## 🎨 Interface

O executor apresenta uma interface colorida e intuitiva:

```
============================================================
🏛️  MASSACHUSETTS COURTS SCRAPER - EXECUTOR MANUAL
============================================================

📋 Escolha uma opção:

  1️⃣  - Executar TODOS os scrapers
  2️⃣  - Executar Pre-Foreclosure apenas
  3️⃣  - Executar HOA apenas
  4️⃣  - Executar Probate apenas
  5️⃣  - Executar Foreclosure apenas

  ⚙️  - Configurações avançadas:
  6️⃣  - Executar com modo headless
  7️⃣  - Executar com configurações personalizadas

  0️⃣  - Sair
============================================================
```

## 🔍 Logs e Feedback

O executor fornece feedback visual em tempo real:

- ✅ **Sucesso**: Mensagens verdes com checkmark
- ❌ **Erro**: Mensagens vermelhas com detalhes
- 🚀 **Início**: Indicação de início de cada scraper
- 📊 **Progresso**: Updates durante execução

## 🗂️ Estrutura de Arquivos

```
runners/MA/
├── executor.ts          # 🎯 Executor principal
├── run.sh              # 🚀 Script de conveniência
├── index.ts            # 📦 Barrel exports (inclui executor)
├── config.ts           # ⚙️ Configurações MA
├── probate_runner.ts   # 🏛️ Runner probate
├── hoa_runner.ts       # 🏠 Runner HOA
├── pre_foreclosure_runner.ts # 📋 Runner pré-execução
└── foreclosure_runner.ts     # 🔨 Runner leilões
```

## 🚨 Tratamento de Erros

O executor inclui tratamento robusto de erros:

- **Captura de exceções** por runner individual
- **Limpeza de recursos** (fechamento de browsers)
- **Continuidade de execução** (falha em um não para os outros)
- **Feedback detalhado** sobre erros
- **Opção de continuar** após erro

## 💡 Vantagens

### ✅ Em relação aos scripts individuais:
- **Interface unificada** - Um só ponto de entrada
- **Menu interativo** - Não precisa lembrar comandos
- **Configurações centralizadas** - Consistência garantida
- **Melhor UX** - Feedback visual e controle
- **Facilidade de uso** - Para usuários não técnicos
- **Manutenção simplificada** - Lógica centralizada

### 🎯 Casos de uso ideais:
- **Execução manual por operadores**
- **Testes e desenvolvimento**
- **Execução pontual de scrapers específicos**
- **Demonstrações e treinamento**

## 🔗 Integração

O executor pode ser facilmente integrado em workflows:

```typescript
import { MARunnerExecutor } from './runners/MA';

const executor = new MARunnerExecutor();
await executor.start();
```

## 🛠️ Personalização

Para adicionar novas opções ou modificar comportamentos, edite o arquivo `executor.ts`. A estrutura modular facilita extensões e customizações.

---

**Criado para simplificar a execução dos scrapers Massachusetts Courts** 🎯