# 🏠 Massachusetts Foreclosure Scraper - Deploy no Portainer

## 📋 Configuração Específica para Runner 5 (Foreclosure)

Este guia configura **apenas o scraper de Foreclosure** (Landmark Auction) com execução automática diária.

## 🚀 Passo a Passo no Portainer

### 1️⃣ Preparar Webhook
1. Acesse [webhook.site](https://webhook.site) para teste
2. Copie a URL única gerada (ex: `https://webhook.site/#!/abc123def`)
3. **OU** use sua própria URL de webhook em produção

### 2️⃣ Escolher Método de Deploy

**🔧 Opção A: Build Automático (Recomendado)**
- Use: `portainer-foreclosure-autobuild.yml`
- Builda direto do GitHub
- Mais lento no primeiro deploy, mais confiável

**🔧 Opção B: Build Manual no Servidor**
```bash
# No servidor do Portainer:
git clone https://github.com/marcelokarval/scraping-nilson.git
cd scraping-nilson
git checkout gemini/massachusetts-system-2
docker build -t massachusetts-scraper:v1.0.0 .
```
- Use: `portainer-foreclosure-stack.yml`
- Mais rápido, mas precisa buildar manualmente

**🔧 Opção C: Versão Simples**
```bash
# No servidor, clone o projeto:
git clone https://github.com/marcelokarval/scraping-nilson.git /opt/scraping-nilson
cd /opt/scraping-nilson
git checkout gemini/massachusetts-system-2
```
- Use: `portainer-foreclosure-simple.yml`
- Usa Node base, instala dependências na execução

### 3️⃣ Criar Stack no Portainer
1. **Portainer** → **Stacks** → **Add stack**
2. **Nome**: `massachusetts-foreclosure`
3. **Web editor**: Cole o conteúdo do arquivo escolhido acima

### 3️⃣ Configurar Variáveis de Ambiente

Na seção **Environment variables**, adicione:

```
RUNNER_MODE=5
SCHEDULE_HOUR=6
DAYS_BACK=7
PLAYWRIGHT_HEADLESS=true
WEBHOOK_URL=https://webhook.site/#!/sua-url-aqui
SEND_WEBHOOK=true
ENABLE_ENRICHMENT=true
FORCE_REENRICHMENT=false
NODE_ENV=production
LOG_LEVEL=info
OCR_API_URL=
API_PORT=3000
```

### 4️⃣ Deploy da Stack
1. Clique em **Deploy the stack**
2. Aguarde o download da imagem e inicialização
3. Verifique se o container está **Running**

## 📊 Monitoramento

### Logs Esperados
```
🤖 Massachusetts Scheduler iniciado
📅 Modo: 5 (foreclosure)
⏰ Horário programado: 6:00
🔄 Modo automatizado - executando imediatamente...
🏠 Executando Foreclosure apenas...
[INFO] Playwright browser iniciado para Foreclosure
[INFO] Página do Landmark Auction carregada
[INFO] { raw_listings: 45 } Listings brutas extraídas
[INFO] { count: 32 } Listings extraídas do Landmark Auction
[INFO] { filtered: 28, total: 32, state: 'MA' } Filtro de estado aplicado
[INFO] Iniciando enrichment com MassProperty...
[INFO] { enriched: 28 } Enrichment concluído
✅ Execução automática concluída
⏳ Próxima execução agendada para: 11/11/2024 06:00:00
```

### Verificar Dados
1. **Volumes** → `ma_foreclosure_data` → **Browse**
2. Arquivos gerados:
   - `MA/foreclosure_processed_cases.json`
   - `MA/Foreclosure/landmark_list_YYYY-MM-DD.json`

### Verificar Webhooks
1. No webhook.site, veja as requisições chegando
2. Payload exemplo:
```json
{
  "type": "foreclosure",
  "action": "new",
  "data": {
    "address": "123 Main St, Boston, MA 02101",
    "auction_date": "2024-01-15T10:00:00Z",
    "opening_bid": "$250,000",
    "property_type": "Single Family",
    "enrichment": {
      "bedrooms": 3,
      "bathrooms": 2,
      "sqft": 1500,
      "estimated_value": "$300,000"
    }
  }
}
```

## ⚙️ Configurações Customizáveis

### Horários Alternativos
```
SCHEDULE_HOUR=6   # 06:00 (recomendado)
SCHEDULE_HOUR=9   # 09:00 (horário comercial)
SCHEDULE_HOUR=14  # 14:00 (meio-dia)
SCHEDULE_HOUR=18  # 18:00 (fim do dia)
SCHEDULE_HOUR=22  # 22:00 (noturno)
```

### Período de Busca
```
DAYS_BACK=1   # Apenas hoje
DAYS_BACK=3   # Últimos 3 dias
DAYS_BACK=7   # Última semana (recomendado)
DAYS_BACK=14  # Últimas 2 semanas
DAYS_BACK=30  # Último mês
```

### Níveis de Log
```
LOG_LEVEL=error  # Apenas erros
LOG_LEVEL=warn   # Erros + avisos
LOG_LEVEL=info   # Informativo (recomendado)
LOG_LEVEL=debug  # Detalhado (desenvolvimento)
```

## 🔧 Troubleshooting

### Container não inicia
```bash
# Ver logs detalhados
docker logs ma-foreclosure-scraper

# Verificar imagem
docker images | grep massachusetts-scraper
```

### Webhook não recebe dados
1. Verificar se `SEND_WEBHOOK=true`
2. Testar URL: `curl -I https://sua-webhook-url.com`
3. Verificar logs para erros de HTTP

### Scraper não encontra dados
1. Verificar se site Landmark Auction está acessível
2. Aumentar `DAYS_BACK` para período maior
3. Verificar logs para erros de parsing

### Execução não acontece no horário
1. Verificar timezone do servidor
2. Confirmar `SCHEDULE_HOUR` (formato 24h)
3. Reiniciar container se necessário

## 📈 Otimizações de Produção

### Performance
- `PLAYWRIGHT_HEADLESS=true` (sem interface gráfica)
- `ENABLE_ENRICHMENT=true` (dados completos)
- `FORCE_REENRICHMENT=false` (evita reprocessamento)

### Recursos
- Container usa ~200MB RAM
- ~50MB storage por dia
- ~2-5 minutos por execução

### Backup
- Volume `ma_foreclosure_data` contém todos os dados
- Fazer backup regular dos JSONs gerados
- Logs ficam em `ma_foreclosure_logs`

## 🎯 Resultado Esperado

**Execução Diária:**
- Inicia automaticamente às 06:00
- Coleta ~20-50 propriedades de MA
- Enriquece com dados de MassProperty
- Envia via webhook em tempo real
- Salva em JSON para backup
- Próxima execução: 24h depois

**Dados Coletados:**
- Endereço completo
- Data/hora do leilão
- Lance inicial
- Tipo de propriedade
- Dados enriquecidos (quartos, banheiros, área, etc.)
- Valor estimado

**Webhook em Tempo Real:**
- Propriedades novas: `action: "new"`
- Propriedades atualizadas: `action: "update"`
- Payload JSON estruturado
- Status HTTP 200 para confirmação