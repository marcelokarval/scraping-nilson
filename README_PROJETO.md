# 🕷️ Massachusetts Courts Scraping System

Sistema completo de scraping para tribunais de Massachusetts, incluindo Probate, HOA, Pre-Foreclosure e Foreclosure com enriquecimento de dados e integração webhook.

## 🚀 Quick Start

### Pré-requisitos
- Node.js 18+ 
- TypeScript
- Git

### Instalação
```bash
# Clonar repositório
git clone https://github.com/marcelokarval/scraping-nilson.git
cd scraping-nilson

# Instalar dependências
npm install

# Compilar TypeScript
npm run build
```

### Uso
```bash
# Executar scraper Massachusetts
cd runners/MA
npx ts-node executor.ts

# Executar scraper específico
# 1 - Todos os scrapers
# 2 - Pre-Foreclosure
# 3 - HOA  
# 4 - Probate
# 5 - Foreclosure
```

## 📁 Estrutura do Projeto

```
├── runners/MA/              # Massachusetts runners
│   ├── config.ts           # Configurações MA
│   ├── executor.ts         # Menu principal
│   ├── foreclosure_runner.ts    # Landmark Auction scraper
│   ├── hoa_runner.ts           # HOA cases scraper
│   ├── pre_foreclosure_runner.ts # Pre-foreclosure scraper
│   ├── probate_runner.ts       # Probate cases scraper
│   └── data/MA/                # Dados processados
├── lib/                    # Bibliotecas compartilhadas
│   └── processed_store.ts  # Sistema de casos processados
├── utils/                  # Utilitários
│   ├── logger.ts          # Sistema de logs
│   └── hash.ts            # Funções de hash
├── config/                # Configurações globais
└── services/              # Serviços externos
    └── ocr_client.ts      # Cliente OCR
```

## 🎯 Funcionalidades

### ✅ Implementadas
- **4 Runners Massachusetts**: Probate, HOA, Pre-Foreclosure, Foreclosure
- **Enriquecimento de Dados**: Via MassProperty para proprietários e valores
- **Sistema Webhook**: Envio automático new/update com detecção de mudanças
- **Processed Cases**: Evita duplicatas com hash SHA-256
- **Filtros Temporais**: Configuração daysBack (0=hoje, N=dias atrás)
- **Logs Estruturados**: Winston com diferentes níveis
- **TypeScript**: Tipagem completa e compilação

### 🔧 Configurações

#### daysBack Filter
```typescript
// config.ts
daysBack: 0    // Busca apenas hoje
daysBack: 5    // Busca últimos 5 dias
```

#### Webhook Integration
```typescript
// Automaticamente envia:
sendType: 'new'     // Casos novos
sendType: 'update'  // Casos com mudanças
// Skip eliminado - sempre envia webhook
```

#### Enrichment System
```typescript
enableEnrichment: true        // Ativa enriquecimento
forceReenrichment: false     // Re-enriquece casos processados
```

## 🏛️ Runners por Tipo

### Foreclosure (Landmark Auction)
- **Fonte**: `https://www.landmark-auction.com`
- **Dados**: Propriedades em leilão
- **Enriquecimento**: MassProperty (proprietário, valores)
- **Filtros**: Estado (MA), status ativo

### Pre-Foreclosure (MassCourts)
- **Fonte**: `https://www.masscourts.org`
- **Tipo**: Cases RP (Real Property)
- **Status**: Abertos (O)
- **Party**: Defendant (DFNDT)

### HOA (MassCourts)
- **Fonte**: `https://www.masscourts.org`
- **Tipo**: Cases RP (Real Property)
- **Departamento**: SC_DEPT (Superior Court)
- **Status**: Abertos

### Probate (MassCourts)
- **Fonte**: `https://www.masscourts.org`
- **Departamento**: PF_DEPT (Probate & Family)
- **Tipos**: Todos os casos probate

## 📊 Sistema de Dados

### Processed Cases Storage
```json
{
  "processed": {
    "normalized_address_key": {
      "processed_at": "2025-11-10T21:00:00.000Z",
      "caseNumber": "123 Main St, Boston, MA",
      "city": "Boston",
      "source": "sha256_hash_of_content"
    }
  }
}
```

### Change Detection
- **Hash SHA-256** do conteúdo principal
- **Detecção automática** de mudanças
- **Webhook diferenciado** new vs update

## 🔗 Integrações

### Webhook Payload
```json
{
  "Categoria": "Foreclosure|PreForeclosure|HOA|Probate",
  "Status": "Novo Case|Update Case",
  "Estado": "MA",
  "Cidade": "Boston",
  "Case Number": "123 Main St",
  "metadata": {
    "property_address": "123 Main St, Boston, MA",
    "owner": "John Doe",
    "total_value": "$500,000",
    "auction_date": "2025-12-01"
  }
}
```

### MassProperty Enrichment
- **Proprietário atual**
- **Endereço do proprietário**  
- **Valores (building, land, total)**
- **Histórico de vendas**
- **Características do imóvel**

## 🚦 Status do Desenvolvimento

- ✅ **Massachusetts Sistema Completo**
- ✅ **4 Runners Funcionais**
- ✅ **Enriquecimento Ativo**
- ✅ **Webhook Integration**
- ✅ **Processed Cases System**
- 🔄 **Documentação em Progresso**

## 🤝 Contribuição

Siga o [Contributing Guide](./.github/CONTRIBUTING.md) para workflow padrão:

1. Criar Issue no GitHub
2. Branch: `gemini/<description>-<issue_number>`
3. Commits: Conventional Commits
4. Pull Request com template
5. Code Review & Merge

## 📋 Issues & Roadmap

Consulte o [Roadmap](./.roadmap/README.md) para próximas implementações e o [Issues](https://github.com/marcelokarval/scraping-nilson/issues) para tarefas ativas.

---

**Desenvolvido para extração automatizada de dados judiciais de Massachusetts com alta precisão e confiabilidade.**