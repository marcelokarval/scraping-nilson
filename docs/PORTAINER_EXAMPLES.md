# ⚙️ Exemplo de Configuração Portainer - Massachusetts Scheduler

## 🏛️ Runners Disponíveis

| Modo | Nome | Fonte | Descrição |
|------|------|-------|-----------|
| `1` ou `all` | **Todos os Scrapers** | Múltiplas | Executa sequencialmente: Probate → HOA → Pre-Foreclosure → Foreclosure |
| `2` ou `preforeclosure` | **Pre-Foreclosure** | MassCourts.org | Casos pré-foreclosure (defendants) do sistema de tribunais |
| `3` ou `hoa` | **HOA** | MassCourts.org | Casos de Homeowners Association do sistema de tribunais |
| `4` ou `probate` | **Probate** | MassCourts.org | Casos de probate (herança/testamento) do sistema de tribunais |
| `5` ou `foreclosure` | **Foreclosure** | Landmark Auction | Leilões de propriedades com enriquecimento MassProperty |
| `interactive` | **Menu Interativo** | - | Menu tradicional para seleção manual (padrão) |

## 🚀 Configuração para Execução Automática Diária

### Exemplo 1: Todos os Scrapers às 06:00
```yaml
version: '3.8'
services:
  massachusetts-scraper:
    image: massachusetts-scraper:latest
    container_name: ma-scraper-all
    environment:
      # Scheduler - Todos os scrapers às 06:00
      - RUNNER_MODE=all
      - SCHEDULE_HOUR=6
      
      # Configurações de scraping
      - WEBHOOK_URL=https://sua-webhook.com/endpoint
      - DAYS_BACK=7
      - SEND_WEBHOOK=true
      - ENABLE_ENRICHMENT=true
      - FORCE_REENRICHMENT=false
      - LOG_LEVEL=info
      
    volumes:
      - ma_data:/app/data
      - ma_config:/app/config  
      - ma_logs:/app/logs
      - ma_browser:/app/playwright_user_data
      
    restart: unless-stopped
    command: massachusetts

volumes:
  ma_data:
  ma_config:
  ma_logs:
  ma_browser:
```

### Exemplo 2: Apenas Pre-Foreclosure às 14:00
```yaml
version: '3.8'
services:
  massachusetts-preforeclosure:
    image: massachusetts-scraper:latest
    container_name: ma-scraper-preforeclosure
    environment:
      # Scheduler - Pre-Foreclosure às 14:00
      - RUNNER_MODE=preforeclosure
      - SCHEDULE_HOUR=14
      
      # Configurações de scraping
      - WEBHOOK_URL=https://sua-webhook.com/endpoint
      - DAYS_BACK=5
      - SEND_WEBHOOK=true
      - ENABLE_ENRICHMENT=true
      - LOG_LEVEL=info
      
    volumes:
      - ma_data:/app/data
      - ma_config:/app/config
      - ma_logs:/app/logs
      
    restart: unless-stopped
    command: massachusetts
```

### Exemplo 3: Múltiplos Containers - Horários Diferentes
```yaml
version: '3.8'
services:
  # Pre-Foreclosure às 08:00
  ma-preforeclosure:
    image: massachusetts-scraper:latest
    container_name: ma-preforeclosure
    environment:
      - RUNNER_MODE=2
      - SCHEDULE_HOUR=8
      - WEBHOOK_URL=https://sua-webhook.com/preforeclosure
      - DAYS_BACK=3
      - SEND_WEBHOOK=true
      - ENABLE_ENRICHMENT=true
    volumes:
      - ma_data:/app/data
      - ma_logs:/app/logs
    restart: unless-stopped
    command: massachusetts

  # HOA às 12:00  
  ma-hoa:
    image: massachusetts-scraper:latest
    container_name: ma-hoa
    environment:
      - RUNNER_MODE=3
      - SCHEDULE_HOUR=12
      - WEBHOOK_URL=https://sua-webhook.com/hoa
      - DAYS_BACK=5
      - SEND_WEBHOOK=true
      - ENABLE_ENRICHMENT=true
    volumes:
      - ma_data:/app/data
      - ma_logs:/app/logs
    restart: unless-stopped
    command: massachusetts

  # Foreclosure às 18:00
  ma-foreclosure:
    image: massachusetts-scraper:latest
    container_name: ma-foreclosure
    environment:
      - RUNNER_MODE=5
      - SCHEDULE_HOUR=18
      - WEBHOOK_URL=https://sua-webhook.com/foreclosure
      - DAYS_BACK=7
      - SEND_WEBHOOK=true
      - ENABLE_ENRICHMENT=true
    volumes:
      - ma_data:/app/data
      - ma_logs:/app/logs
    restart: unless-stopped
    command: massachusetts

volumes:
  ma_data:
  ma_logs:
```

## 🎛️ Variáveis de Ambiente do Portainer

### Interface do Portainer
```
Nome: RUNNER_MODE
Valor: all
Descrição: Modo de execução - Opções disponíveis:
          • interactive = Menu interativo (padrão)
          • 1 ou all = Executar todos os scrapers (Probate + HOA + Pre-Foreclosure + Foreclosure)
          • 2 ou preforeclosure = Executar apenas Pre-Foreclosure (MassCourts)
          • 3 ou hoa = Executar apenas HOA (MassCourts)
          • 4 ou probate = Executar apenas Probate (MassCourts)
          • 5 ou foreclosure = Executar apenas Foreclosure (Landmark Auction)

Nome: SCHEDULE_HOUR  
Valor: 9
Descrição: Horário diário para execução (0-23)

Nome: WEBHOOK_URL
Valor: https://sua-webhook.com/endpoint
Descrição: URL do webhook para envio dos dados

Nome: DAYS_BACK
Valor: 7
Descrição: Quantos dias para trás buscar

Nome: SEND_WEBHOOK
Valor: true
Descrição: Habilitar envio de webhook

Nome: ENABLE_ENRICHMENT
Valor: true
Descrição: Habilitar enriquecimento com MassProperty

Nome: LOG_LEVEL
Valor: info
Descrição: Nível de log (error|warn|info|debug)
```

## 📊 Monitoramento via Portainer

### Verificar Logs
1. No Portainer, vá para **Containers**
2. Clique no container `ma-scraper-*`
3. Vá para **Logs**
4. Veja os logs em tempo real:

```
2024-01-15 06:00:00 🤖 Massachusetts Scheduler iniciado
2024-01-15 06:00:00 📅 Modo: all
2024-01-15 06:00:00 ⏰ Horário programado: 6:00
2024-01-15 06:00:00 🔄 Modo automatizado - executando imediatamente...
2024-01-15 06:30:45 ✅ Execução automática concluída - Modo: all
2024-01-15 06:30:45 ⏳ Próxima execução agendada para: 16/01/2024 06:00:00
```

### Reiniciar Container
1. No Portainer, selecione o container
2. Clique em **Restart**
3. O scheduler reiniciará e executará imediatamente

### Verificar Dados Gerados
1. Acesse **Volumes** no Portainer
2. Clique no volume `ma_data`
3. Browse files para ver:
   - `/MA/foreclosure_processed_cases.json`
   - `/MA/probate_processed_cases.json`
   - `/MA/hoa_processed_cases.json`
   - `/MA/pre_foreclosure_processed_cases.json`

## 🛠️ Comandos Docker Diretos

### Executar Uma Vez
```bash
# Todos os scrapers
docker run --rm \
  -e RUNNER_MODE=all \
  -e WEBHOOK_URL=https://sua-webhook.com \
  -v ma_data:/app/data \
  massachusetts-scraper:latest massachusetts

# Apenas Probate
docker run --rm \
  -e RUNNER_MODE=probate \
  -e WEBHOOK_URL=https://sua-webhook.com \
  -v ma_data:/app/data \
  massachusetts-scraper:latest massachusetts
```

### Executar com Schedule
```bash
# Scheduler diário às 09:00
docker run -d \
  --name ma-scheduler \
  -e RUNNER_MODE=all \
  -e SCHEDULE_HOUR=9 \
  -e WEBHOOK_URL=https://sua-webhook.com \
  -v ma_data:/app/data \
  --restart unless-stopped \
  massachusetts-scraper:latest massachusetts
```

## 🔧 Solução de Problemas

### Container não inicia
```bash
# Verificar logs
docker logs ma-scraper-all

# Verificar variáveis
docker exec ma-scraper-all env | grep RUNNER
```

### Scheduler não executa
```bash
# Verificar se não está em modo interactive
docker exec ma-scraper-all env | grep RUNNER_MODE

# Deve retornar algo diferente de "interactive"
```

### Webhook não funciona
```bash
# Verificar URL
docker exec ma-scraper-all env | grep WEBHOOK_URL

# Testar conectividade
docker exec ma-scraper-all curl -I https://sua-webhook.com
```