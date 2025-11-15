# 🐳 Massachusetts Foreclosure - Docker Swarm (Portainer)

## ⚠️ Problema Identificado
Seu Portainer está configurado para **Docker Swarm mode**, que tem algumas limitações:
- Não suporta `build` context
- Não suporta `container_name`
- Não suporta redes bridge customizadas
- Precisa usar `deploy` ao invés de `restart`

## ✅ Solução: Stack Compatível com Swarm

### 🚀 Implementação Correta

#### 1️⃣ **Preparar Webhook**
1. Acesse [webhook.site](https://webhook.site)
2. Copie a URL (ex: `https://webhook.site/#!/abc123def`)

#### 2️⃣ **Usar Stack Compatível**
No Portainer:
1. **Stacks** → **Add stack**
2. **Nome**: `massachusetts-foreclosure`
3. **Cole este código**:

```yaml
version: '3.8'

services:
  foreclosure-scraper:
    image: node:18-slim
    
    environment:
      - RUNNER_MODE=5
      - SCHEDULE_HOUR=6
      - DAYS_BACK=7
      - PLAYWRIGHT_HEADLESS=true
      - WEBHOOK_URL=https://webhook.site/#!/your-unique-id
      - SEND_WEBHOOK=true
      - ENABLE_ENRICHMENT=true
      - NODE_ENV=production
      - LOG_LEVEL=info
      
    volumes:
      - foreclosure_data:/app/data
      - foreclosure_logs:/app/logs
      - foreclosure_browser:/app/playwright_user_data
      
    deploy:
      replicas: 1
      restart_policy:
        condition: on-failure
        delay: 10s
        max_attempts: 3
      resources:
        limits:
          memory: 2G
          cpus: '1.0'
        reservations:
          memory: 512M
          cpus: '0.25'
          
    working_dir: /app
    
    command: >
      bash -c "
        echo '🚀 Iniciando Massachusetts Foreclosure Scraper...' &&
        apt-get update -qq &&
        apt-get install -y -qq git curl wget gnupg ca-certificates &&
        echo '📦 Clonando repositório...' &&
        git clone -q https://github.com/marcelokarval/scraping-nilson.git /tmp/scraper &&
        cd /tmp/scraper &&
        git checkout -q gemini/massachusetts-system-2 &&
        cp -r . /app/ &&
        cd /app &&
        echo '📥 Instalando dependências...' &&
        npm install --silent &&
        echo '🎭 Instalando Playwright...' &&
        npx playwright install chromium --with-deps &&
        echo '✅ Iniciando scraper...' &&
        npx ts-node runners/MA/main.ts
      "

volumes:
  foreclosure_data:
  foreclosure_logs:
  foreclosure_browser:
```

#### 3️⃣ **Configurar Variáveis**
Na seção **Environment variables** do Portainer:
```
WEBHOOK_URL=https://webhook.site/#!/sua-url-aqui
```
(As outras já estão configuradas no YAML)

#### 4️⃣ **Deploy**
1. Clique em **Deploy the stack**
2. ⏳ Aguarde 5-8 minutos (primeira vez)
3. 👀 Acompanhe em **Services** → `foreclosure-scraper`

## 📊 Monitoramento no Swarm

### Ver Logs
1. **Services** → `massachusetts-foreclosure_foreclosure-scraper`
2. **Tasks** → Clique na task ativa
3. **Logs**

### Logs Esperados
```
🚀 Iniciando Massachusetts Foreclosure Scraper...
📦 Clonando repositório...
📥 Instalando dependências...
🎭 Instalando Playwright...
✅ Iniciando scraper...
🤖 Massachusetts Scheduler iniciado
📅 Modo: 5 (foreclosure)
⏰ Horário programado: 6:00
🔄 Executando imediatamente...
🏠 Executando Foreclosure apenas...
[INFO] Playwright browser iniciado
[INFO] { raw_listings: 45 } Listings extraídas
✅ Execução automática concluída
⏳ Próxima execução: 11/11/2024 06:00:00
```

### Ver Dados
1. **Volumes** → `massachusetts-foreclosure_foreclosure_data`
2. **Browse** para ver JSONs gerados

## 🔧 Diferenças do Swarm Mode

### ✅ **Funciona:**
- Deploy automático
- Volumes persistentes
- Restart policies
- Resource limits
- Health checks
- Environment variables

### ❌ **Não Funciona:**
- Build context do Git
- Container names customizados
- Redes bridge customizadas
- Restart: unless-stopped (usar deploy.restart_policy)

## ⚡ **Vantagens da Versão Swarm:**
- **Mais Robusta**: Restart automático em caso de falha
- **Resource Management**: Limites de CPU/RAM definidos
- **High Availability**: Pode rodar em múltiplos nodes
- **Rolling Updates**: Atualizações sem downtime

## 🎯 **Resultado Esperado:**
- Service ativo no Swarm
- Execução imediata após deploy
- Coleta de ~20-50 propriedades MA
- Webhook em tempo real
- Execução diária às 06:00
- Dados salvos nos volumes

## 🆘 **Troubleshooting Swarm:**

### Service não inicia:
```bash
docker service ls
docker service logs massachusetts-foreclosure_foreclosure-scraper
```

### Ver tasks:
```bash
docker service ps massachusetts-foreclosure_foreclosure-scraper
```

### Update do service:
```bash
# No Portainer: Services → Update → Force update
```

### Escalar replicas:
```bash
# No Portainer: Services → Scale → Replicas: 1
```

Agora deve funcionar perfeitamente no Docker Swarm! 🚀