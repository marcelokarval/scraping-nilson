# 🏛️ New Jersey Courts Scraper

Sistema de scraping para tribunais de New Jersey, focando inicialmente no Essex County Register of Deeds.

## 🎯 **Funcionalidades**

### ✅ **Implementado:**
- **Foreclosure Scraper** - Essex Register of Deeds
- **Menu interativo** com opções numeradas
- **Sistema de webhooks** com sufixo `_nj`
- **Download automático de PDFs**
- **Estrutura organizacional** por condado
- **Processamento de casos** novos vs. atualizados

### 🚧 **Em Desenvolvimento:**
- HOA Runner
- Probate Runner
- Outros condados além de Essex

## 🚀 **Como Usar**

### **Comando Único:**
```bash
./runners/NJ/run.sh
```

### **Ou via TypeScript:**
```bash
npx ts-node runners/NJ/executor.ts
```

### **Menu Interativo:**
```
============================================================
🏛️  NEW JERSEY COURTS SCRAPER - EXECUTOR MANUAL
============================================================

📋 Escolha uma opção:

  1️⃣  - Executar Foreclosure (Essex Register)
  2️⃣  - Executar HOA (Em desenvolvimento)
  3️⃣  - Executar Probate (Em desenvolvimento)
  4️⃣  - Executar TODOS os scrapers disponíveis

  ⚙️  - Configurações avançadas:
  5️⃣  - Executar com modo headless (sem interface gráfica)
  6️⃣  - Executar com configurações personalizadas
  7️⃣  - Ver configurações atuais

  0️⃣  - Sair
```

## 📊 **Estrutura de Dados**

### **Foreclosure Case:**
```typescript
interface NJForeclosureCase {
  // Identificação
  caseNumber: string;          // Docket Number
  instrumentNumber: string;    // Instrument Number
  
  // Propriedade
  propertyAddress: string;     // Endereço sendo executado
  lotNumber?: string;          // Lot Number
  blockNumber?: string;        // Block Number
  
  // Pessoa/Proprietário
  ownerFirstName: string;      // Primeiro nome
  ownerLastName: string;       // Último nome
  ownerFullName: string;       // Nome completo
  mailingAddress?: string;     // Endereço de correspondência
  
  // Financiamento
  lender?: string;             // Banco/empresa
  loanAmount?: number;         // Valor financiado
  mortgageDate?: string;       // Data do mortgage
  maturityDate?: string;       // Data vencimento
  
  // Processo
  filingDate: string;          // Data entrada sistema
  county: string;              // Condado
  status: string;              // Pre-Foreclosure
}
```

## 🎯 **Webhooks**

### **Categorias com sufixo _nj:**
- `foreclosure_nj` - Casos de foreclosure
- `hoa_nj` - Casos de HOA (futuro)
- `probate_nj` - Casos de probate (futuro)

### **Tipos de envio:**
- **`new`** - Caso novo (inclui PDF)
- **`update`** - Caso atualizado (sem PDF)

## 📁 **Estrutura de Arquivos**

```
📁 data/NJ/
├── foreclosure_processed_cases.json
├── hoa_processed_cases.json (futuro)
├── probate_processed_cases.json (futuro)
└── Foreclosure/
    └── Essex/
        └── cases/
            └── [caseNumber]/
                ├── metadata.json
                └── [caseNumber]_FORECLOSURE.pdf

📁 runners/NJ/
├── executor.ts              # 🎯 EXECUTOR PRINCIPAL
├── run.sh                   # Script de conveniência  
├── config.ts                # Configurações NJ
├── foreclosure_runner.ts    # Foreclosure específico
├── probate_runner.ts        # Probate (base)
└── index.ts                 # Barrel exports

📁 config/
├── sequences_nj.json        # Configurações NJ
└── nj_foreclosure_search_items.json
```

## ⚙️ **Configurações**

### **Padrões:**
- **Estado:** New Jersey (NJ)
- **Condado principal:** Essex
- **Dias de busca:** 1 (última execução)
- **URL:** Essex Register of Deeds
- **Document Type:** "List Pending Foreclosure"

### **Personalizáveis:**
- Modo headless (com/sem interface)
- Dias para buscar (1-30)
- Configurações específicas por execução

## 🔍 **Processo de Scraping**

### **1. Navegação:**
- Essex Register → New Jersey → Register of Deeds
- Seleção do Document Type
- Aplicação de filtros de data

### **2. Extração:**
- Lista de casos da tabela de resultados
- Dados básicos: instrument number, filing date, owner name
- Verificação se é caso de foreclosure

### **3. Processamento Individual:**
- Navegação para detalhes do caso
- Extração de dados detalhados
- Download de PDF (casos novos)
- Salvamento de metadata

### **4. Finalização:**
- Envio de webhook com sufixo `_nj`
- Marcação como processado
- Retorno à lista de resultados

## 🛠️ **Desenvolvimento**

### **Adicionar Novo County:**
1. Estender `NJ_COUNTIES` em `config.ts`
2. Implementar navegação específica
3. Adaptar extração de dados
4. Testar e validar

### **Adicionar Novo Runner:**
1. Criar `[type]_runner.ts`
2. Implementar interface padrão
3. Configurar webhook suffix
4. Integrar no executor

## 📈 **Monitoramento**

### **Logs:**
- Todas as operações são logadas
- Erros detalhados para debugging
- Progresso de execução visível

### **Validação:**
- Casos processados vs. novos
- PDFs baixados corretamente
- Webhooks enviados com sucesso
- Metadados salvos adequadamente

## 🏆 **Benefícios**

- **Escalabilidade:** Fácil expansão para outros condados
- **Modularidade:** Runners independentes por tipo
- **Consistência:** Padrões unificados com MA
- **Flexibilidade:** Configurações personalizáveis
- **Robustez:** Tratamento de erros e retry logic

---

**Status:** ✅ **Foreclosure implementado e funcionando**
**Próximos:** HOA Runner, Probate Runner, mais condados