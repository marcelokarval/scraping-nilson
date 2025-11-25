# Portainer Stack Files - Scraping System

## 📁 Arquivos de Stack Disponíveis

### ✅ Stacks Prontas para Uso

1. **`portainer-stack-ma-foreclosure.yml`**
   - 🏛️ Massachusetts Foreclosure Scraper
   - Branch: `main`
   - Estrutura: `src/runners/MA/`
   - Volumes: Named volumes (`ma_foreclosure_*`)

2. **`portainer-stack-pa-foreclosure.yml`**
   - 🏛️ Pennsylvania Foreclosure Scraper
   - Branch: `main`
   - Estrutura: `src/runners/PA/`
   - Volumes: Named volumes (`pa_foreclosure_*`)

---

## 🚀 Como Usar no Portainer

### 1️⃣ Acessar Portainer
```
https://seu-portainer.com
```

### 2️⃣ Criar Nova Stack

1. **Stacks** → **Add Stack**
2. **Nome da Stack**: 
   - Para MA: `scraping-ma-foreclosure`
   - Para PA: `scraping-pa-foreclosure`
3. **Web editor**: Copiar conteúdo do arquivo `.yml` correspondente
4. **Environment variables**: Adicionar variáveis necessárias

---

## 🔧 Variáveis de Ambiente Necessárias

### Massachusetts (MA)

```bash
# GitHub (obrigatório)
GITHUB_TOKEN=ghp_seu_token_aqui
GITHUB_USER=marcelokarval

# Webhook (opcional - já tem default)
WEBHOOK_URL=https://n8n.arthuragrelli.com/webhook/scraping
```

### Pennsylvania (PA)

```bash
# Credenciais PA Court (obrigatório)
PA_USER=seu_usuario_aqui
PA_PASS=sua_senha_aqui

# Captcha Webhook (opcional - já tem default)
PA_CAPTCHA_WEBHOOK=https://n8n.arthuragrelli.com/webhook/captcha-solver

# Webhook de dados (opcional - já tem default)
WEBHOOK_URL=https://n8n.arthuragrelli.com/webhook/scraping

# GitHub (opcional - para auto-update)
GITHUB_TOKEN=ghp_seu_token_aqui

# Cron Schedule (opcional - default: 9h diariamente)
CRON_SCHEDULE=0 9 * * *
```

---

## 📊 Características Comuns

### ✅ Sincronização Inteligente Git + Volume
Ambos os stacks incluem lógica que:
- Compara casos processados no Git vs Volume
- Escolhe automaticamente a fonte com mais dados
- Protege contra perda de dados históricos

### ✅ Monitoramento
- Logs detalhados de execução
- Contagem de casos processados
- Status de sincronização

### ✅ Persistência de Dados
Volumes separados para:
- 📂 **data**: Casos processados e PDFs
- 📝 **logs**: Logs de execução
- ⚙️ **config**: Configurações persistentes
- 🌐 **browser**: Sessões Playwright
- 💻 **code**: Código fonte (apenas MA)

---

## 🔄 Atualizando Stack Existente

Se já existe uma stack rodando:

1. **Stacks** → Selecionar stack existente
2. **Editor** → Colar novo conteúdo
3. **Update the stack** → ✅ Re-pull and redeploy
4. Deploy

**⚠️ IMPORTANTE**: Volumes são preservados durante atualização!

---

## 📋 Padrão para Futuros Estados

Ao criar novos scrapers (CT, NH, NJ, etc.), seguir este padrão:

```yaml
# Nome do arquivo
portainer-stack-{ESTADO}-{TIPO}.yml

# Exemplo:
portainer-stack-ct-foreclosure.yml
portainer-stack-nh-probate.yml
portainer-stack-nj-foreclosure.yml

# Service name
{estado}-{tipo}-scraper
# Exemplo: ct-foreclosure-scraper

# Volume names
{estado}_{tipo}_data
{estado}_{tipo}_logs
{estado}_{tipo}_config
{estado}_{tipo}_browser

# Exemplo:
ct_foreclosure_data
ct_foreclosure_logs
```

### Estrutura de Código no Git
```
src/
  runners/
    MA/
    PA/
    CT/  ← Novo estado
    NH/
    NJ/
```

---

## 🛠️ Comandos Úteis

### Verificar logs
```bash
# MA
docker service logs -f scraping-ma-foreclosure_ma-foreclosure-scraper

# PA
docker service logs -f scraping-pa-foreclosure_pa-foreclosure-scraper
```

### Verificar dados processados
```bash
# MA
docker exec $(docker ps -q -f name=ma-foreclosure) cat /app/data/MA/foreclosure_processed_cases.json | grep -c "processed_at"

# PA
docker exec $(docker ps -q -f name=pa-foreclosure) cat /app/data/PA/Foreclosure/foreclosure_processed_cases.json | grep -c "processed_at"
```

### Executar manualmente (PA)
```bash
docker exec -it $(docker ps -q -f name=pa-foreclosure) sh -c 'cd /app && npx tsx src/runners/PA/executor.ts'
```

---

## 📝 Diferenças entre MA e PA

| Característica | MA | PA |
|---------------|----|----|
| **Imagem Base** | `node:20-slim` | `ghcr.io/.../scraping-nilson:latest` |
| **Compilação** | TypeScript in-container | Pré-compilado (Alpine) |
| **Execução** | Scheduler integrado | Cron manual |
| **Display** | Xvfb explícito | Incluído no Dockerfile |
| **Instalação** | Completa no start | Apenas npm install |
| **Memória** | 4GB | 10GB |
| **CPU** | 2 cores | 4 cores |

---

## 🎯 Próximos Passos

1. ✅ Deploy MA stack no Portainer
2. ✅ Deploy PA stack no Portainer
3. ⏳ Monitorar primeira execução
4. ⏳ Validar dados sendo salvos nos volumes
5. ⏳ Confirmar webhooks funcionando

---

**Última atualização**: 2025-11-22  
**Branch**: `feature/pa-update-mode-scraping` → `main` (após merge)
