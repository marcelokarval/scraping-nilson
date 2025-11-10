# 🚀 Scripts de Execução Individual dos Runners

Este diretório contém scripts standalone para executar cada runner independentemente.

## 📋 Scripts Disponíveis

### 1️⃣ Probate Runner
```bash
npx ts-node run_probate.ts
```
**Configuração:**
- Department: `PF_DEPT` (Probate & Family)
- Days Back: `0` (somente cases de hoje)
- Case Type: `EA` (Estate Administration)
- Status: `O` (Open)

---

### 2️⃣ Pre-Foreclosure Runner
```bash
npx ts-node run_pre_foreclosure.ts
```
**Configuração:**
- Department: `SC_DEPT` (Superior Court)
- Days Back: `3` (últimos 3 dias)
- Case Type: `RP` (Real Property)
- Status: `O` (Open)
- Party Type: `DFNDT` (Defendant)

---

### 3️⃣ HOA Runner
```bash
npx ts-node run_hoa.ts
```
**Configuração:**
- Department: `SC_DEPT` (Superior Court)
- Days Back: `0` (somente cases de hoje)
- Case Type: `RP` (Real Property)
- Status: `O` (Open)
- Filtro Especial: Apenas "Condominium Lien & Charges"

---

### 4️⃣ Foreclosure Runner
```bash
npx ts-node run_foreclosure.ts
```
**Configuração:**
- Source: Landmark Auction (https://www.landmarkauction.biz/)
- State Filter: `MA` (Massachusetts)
- Enable Enrichment: `true` ✨ **NOVO - enriquece com dados do MassProperty**
- Send Webhook: `false` (pode ser alterado no script)

**Enrichment (Opcional):**
Quando habilitado, para cada listing do Landmark Auction, o runner:
1. Acessa ArcGIS MassPropertyInfo
2. Busca dados do proprietário usando endereço (city → street → number)
3. Extrai: Owner, valores (building/land/total), última venda, ano construção, etc.
4. Inclui seção `details` no payload do webhook
5. Salva JSON enriquecido adicional

---

## 🔄 Executar Todos de Uma Vez

### Opção A: Via Orchestrator (Recomendado)
```bash
npx ts-node --transpile-only -e "require('./masscourts/index').runMassCourtsSequences()"
```
Executa todas as sequences configuradas em `config/sequences.json` na ordem.

### Opção B: Via Script Consolidado
```bash
npx ts-node run_all_scrapers.ts
```
Executa todas as sequences com logging detalhado.

---

## ⚙️ Configurações

### Modo Headless
Por padrão, todos os scripts abrem o browser visível. Para executar em modo headless:

Edite o script desejado e altere:
```typescript
process.env.PLAYWRIGHT_HEADLESS = 'true';
```

### Ajustar Parâmetros
Cada script tem suas configurações no método `runner.run({...})`. Você pode alterar:
- `daysBack`: Quantos dias retroativos buscar
- `departmentContains`: Filtro de departamento
- `caseCd`, `statCd`, `ptyCd`: Códigos de filtro do MassCourts
- `stateFilter`: Estado para Foreclosure
- `enableEnrichment`: Habilitar/desabilitar enrichment para Foreclosure ✨
- `sendWebhook`: Habilitar/desabilitar envio para webhook

---

## 📊 Output

### MassCourts Runners (Probate, Pre-Foreclosure, HOA)
- **PDFs**: `data/MA/{RunnerType}/{CaseNumber}/`
- **Extracts**: JSON com dados extraídos via OCR
- **Database**: SQLite em `db/masscourts.db`
- **Logs**: Console com pino logger

### Foreclosure Runner
- **JSON**: `data/MA/Foreclosure/landmark_list_YYYY-MM-DDTHH-mm-ss.json`
- **Enriched JSON** (se enableEnrichment=true): `data/MA/Foreclosure/enriched_{address}_YYYY-MM-DDTHH-mm-ss.json`
- **Logs**: Console com pino logger

---

## 🐛 Debug

Se encontrar erros:

1. **Verifique se o browser está instalado:**
   ```bash
   npx playwright install chromium
   ```

2. **Execute em modo não-headless para visualizar:**
   ```typescript
   process.env.PLAYWRIGHT_HEADLESS = 'false';
   ```

3. **Verifique os logs:**
   Os runners usam `pino` logger com níveis de informação detalhados.

4. **Verifique cookies de sessão:**
   Para MassCourts runners, certifique-se de que `config/session_cookies.json` existe.

---

## 📝 Histórico de Arquivos

- `run_probate.ts` - ✅ Novo (criado 27/10/2025)
- `run_pre_foreclosure.ts` - ✅ Novo (criado 27/10/2025)
- `run_hoa.ts` - ✅ Novo (criado 27/10/2025)
- `run_foreclosure.ts` - ✅ Novo (criado 27/10/2025)
- `run_all_scrapers.ts` - ✅ Atualizado (inclui Foreclosure)
- `run_probate_scraper.ts` - ⚠️ Legado (pode ser removido)

---

## 🎯 Exemplos de Uso

### Executar apenas Probate
```bash
npx ts-node run_probate.ts
```

### Executar apenas Foreclosure
```bash
npx ts-node run_foreclosure.ts
```

### Executar Pre-Foreclosure e HOA em sequência
```bash
npx ts-node run_pre_foreclosure.ts && npx ts-node run_hoa.ts
```

### Executar todos via orchestrator
```bash
npx ts-node --transpile-only -e "require('./masscourts/index').runMassCourtsSequences()"
```

---

## 📦 Estrutura de Dados

### Foreclosure (Landmark Auction) - SEM Enrichment
```json
{
  "id": "landmark_123MainSt_1730000000000",
  "source": { "system": "Landmarkauction", ... },
  "category": "Foreclosure",
  "foreclosure": {
    "property_address": "123 Main St, Springfield, MA",
    "auction_date": "Wednesday, November 15, 2025",
    "status": "Currently going forward",
    ...
  }
}
```

### Foreclosure (Landmark Auction) - COM Enrichment ✨
```json
{
  "id": "landmark_123MainSt_1730000000000",
  "source": { 
    "system": "Landmarkauction_ArcGIS",
    "scraped_from": "https://www.landmarkauction.biz/",
    "enriched_from": "https://arcgisserver.digital.mass.gov/..."
  },
  "category": "Foreclosure",
  "foreclosure": {
    "property_address": "123 Main St, Springfield, MA",
    "auction_date": "Wednesday, November 15, 2025",
    "status": "Currently going forward",
    ...
  },
  "details": {
    "owner": "JOHN DOE",
    "owner_address": "456 Oak Ave, Boston, MA 02101",
    "owner_city": "Boston",
    "owner_state": "MA",
    "owner_zipcode": "02101",
    "building_value": "$250,000",
    "land_value": "$100,000",
    "total_value": "$350,000",
    "last_sale_price": "$300,000",
    "last_sale_date": "2020-05-15",
    "year_built": "1985",
    "lot_size": "5,000 sq ft",
    "residential_area": "2,500 sq ft",
    "building_style": "Colonial",
    "number_of_units": "1",
    "number_of_rooms": "8",
    "property_id": "12-34-56",
    "location_id": "LOC-789",
    ...
  }
}
```

### MassCourts (Probate, Pre-Foreclosure, HOA)
```json
{
  "Categoria": "Probate" | "Pre-Foreclosure" | "HOA",
  "Case Number": "...",
  "Filing Date": "...",
  "PDF Original": "base64...",  // apenas para novos cases
  "OCR Text": "...",
  ...
}
```
