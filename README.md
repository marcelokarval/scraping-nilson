# 🕷️ scraping-nilson

**v1.0.0** - Sistema completo de scraping para tribunais de Massachusetts com enriquecimento de dados e integração webhook.

---

## 🚀 Passos Iniciais (Setup Rápido)

Para configurar e iniciar o trabalho neste repositório, siga os seguintes passos na ordem correta:

1.  **Configure o Ambiente:** Instale Node.js 18+, TypeScript e Git. Execute `npm install` na raiz do projeto.

2.  **Entenda o Sistema:** O projeto implementa 4 runners especializados para Massachusetts: Probate, HOA, Pre-Foreclosure e Foreclosure.

3.  **Execute o Sistema:** Navegue até `runners/MA/` e execute `npx ts-node executor.ts` para o menu interativo.

4.  **Entenda o Processo:** Leia o `/.github/CONTRIBUTING.md` para entender nosso fluxo de trabalho com branches, commits e pull requests.

5.  **Consulte o Roadmap:** Veja `/.roadmap/README.md` para encontrar o plano de produto ativo e próximas implementações.

---

## 🎯 Sistema de Scraping Massachusetts (v1.0.0)

### 🏛️ Runners Implementados

| Runner | Fonte | Descrição | Status |
|--------|-------|-----------|--------|
| **Foreclosure** | Landmark Auction | Leilões de propriedades com enriquecimento MassProperty | ✅ Ativo |
| **Probate** | MassCourts.org | Casos de probate (herança/testamento) | ✅ Ativo |
| **HOA** | MassCourts.org | Cases de Homeowners Association | ✅ Ativo |
| **Pre-Foreclosure** | MassCourts.org | Casos pré-foreclosure (defendants) | ✅ Ativo |

### ⚡ Quick Start - Execução
```bash
# Instalar dependências
npm install

# Executar sistema Massachusetts
cd runners/MA
npx ts-node executor.ts

# Menu interativo:
# 1 - Todos os scrapers
# 2 - Pre-Foreclosure apenas
# 3 - HOA apenas
# 4 - Probate apenas
# 5 - Foreclosure apenas
```

### 🔧 Configurações Principais
- **daysBack**: `0` (apenas hoje) | `N` (últimos N dias)
- **enableEnrichment**: `true` (enriquecimento ativo)
- **sendWebhook**: `true` (envio automático)
- **forceReenrichment**: `false` (re-enriquecimento opcional)

### 📊 Recursos Avançados
- ✅ **Enriquecimento Automático**: Via MassProperty (proprietários, valores)
- ✅ **Webhook Integration**: new/update com detecção SHA-256
- ✅ **Zero Duplicatas**: Sistema processed cases
- ✅ **Logs Estruturados**: Winston logging
- ✅ **Error Handling**: Retry logic robusto

### 📁 Estrutura do Projeto
```
runners/MA/           # Sistema Massachusetts
├── foreclosure/      # Landmark Auction
├── probate/         # Probate cases
├── hoa/             # HOA cases
├── preforeclosure/  # Pre-foreclosure defendants
├── executor.ts      # Menu principal
└── shared/          # Utilitários compartilhados

config/              # Configurações
├── sequences.json   # Sequências de busca
├── session_cookies.json
└── probate_search_items.json

data/MA/            # Dados processados por estado
├── foreclosure_processed_cases.json
├── probate_processed_cases.json
├── hoa_processed_cases.json
└── pre_foreclosure_processed_cases.json

services/           # Serviços externos
└── ocr_client.ts   # Processamento OCR

utils/              # Utilitários globais
├── logger.ts       # Winston logging
└── hash.ts         # SHA-256 hashing
```

## 📈 Status de Desenvolvimento

### v1.0.0 - Massachusetts System (Atual)
- [x] 4 Runners implementados e testados
- [x] Sistema de enriquecimento MassProperty
- [x] Webhook integration com deduplicação
- [x] Logs estruturados e error handling
- [x] Processed cases tracking (zero duplicatas)

### Próximas Versões
- [ ] **v1.1.0**: Expansão para outros estados (NY, CA, FL)
- [ ] **v1.2.0**: Dashboard web para monitoramento
- [ ] **v1.3.0**: API REST para integração externa
- [ ] **v2.0.0**: Sistema multi-tenant com isolamento por cliente

## 🚀 Deploy e Produção

### Pré-requisitos Sistema
- **Node.js**: >= 18.0.0
- **TypeScript**: >= 4.9.0
- **Playwright**: >= 1.40.0
- **Recursos**: 4GB RAM, 2GB storage

### Variáveis de Ambiente
```bash
WEBHOOK_URL=https://your-webhook-endpoint.com
OCR_API_URL=https://your-ocr-service.com
LOG_LEVEL=info
DAYS_BACK=0
ENABLE_ENRICHMENT=true
```

---

## ⚠️ Acesso e Segurança

Para conceder acesso de escrita a este repositório a um novo desenvolvedor, **NÃO compartilhe tokens ou senhas**. Siga o procedimento de segurança correto:

1.  Vá até a página do repositório no GitHub.
2.  Clique em **`Settings`** > **`Collaborators and teams`**.
3.  Clique em **`Add people`** e adicione o nome de usuário GitHub do desenvolvedor.

O desenvolvedor é responsável por configurar a própria autenticação na sua máquina local (via Chave SSH ou `gh auth login`).

---

## 📚 Cadeia Sequencial de Leitura (Contexto da IA)

Para o completo entendimento do projeto, leia os seguintes documentos em ordem:

1.  [README.md](./README.md) (Este arquivo)
2.  [CONTRIBUTING.md](./.github/CONTRIBUTING.md)
3.  [CONTEXT.md](./.github/CONTEXT.md)
4.  [Roadmap Master](/.roadmap/README.md)
