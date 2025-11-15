# 🤖 Massachusetts Scheduler - Execução Automática

O Massachusetts Scheduler permite execução automática e programada dos scrapers, facilitando a operação em ambientes de produção.

## 📋 Configuração

### Variáveis de Ambiente

#### `RUNNER_MODE`
Define qual scraper será executado automaticamente:

- `interactive` (padrão): Menu interativo tradicional
- `1` ou `all`: Executar todos os scrapers sequencialmente
- `2` ou `preforeclosure`: Executar apenas Pre-Foreclosure
- `3` ou `hoa`: Executar apenas HOA
- `4` ou `probate`: Executar apenas Probate
- `5` ou `foreclosure`: Executar apenas Foreclosure

#### `SCHEDULE_HOUR`
Define o horário diário para execução (formato 24h):
- `9` (padrão): 09:00
- `14`: 14:00
- `22`: 22:00

## 🚀 Exemplos de Uso

### 1. Execução Interativa (Padrão)
```bash
# No Portainer
RUNNER_MODE=interactive

# Ou via Docker
docker run -e RUNNER_MODE=interactive massachusetts-scraper
```

### 2. Execução de Todos os Scrapers às 09:00
```bash
# No Portainer
RUNNER_MODE=all
SCHEDULE_HOUR=9

# Ou via Docker
docker run -e RUNNER_MODE=all -e SCHEDULE_HOUR=9 massachusetts-scraper
```

### 3. Apenas Pre-Foreclosure às 14:00
```bash
# No Portainer
RUNNER_MODE=preforeclosure
SCHEDULE_HOUR=14

# Ou via Docker
docker run -e RUNNER_MODE=2 -e SCHEDULE_HOUR=14 massachusetts-scraper
```

### 4. Apenas HOA às 22:00
```bash
# No Portainer
RUNNER_MODE=hoa
SCHEDULE_HOUR=22

# Ou via Docker
docker run -e RUNNER_MODE=3 -e SCHEDULE_HOUR=22 massachusetts-scraper
```

## ⚙️ Funcionamento

### Fluxo de Execução
1. **Primeira Execução**: Imediatamente ao iniciar o container
2. **Execução Diária**: No horário configurado em `SCHEDULE_HOUR`
3. **Logs Detalhados**: Todas as execuções são logadas com timestamps

### Exemplo de Logs
```
2024-01-15 08:00:00 🤖 Massachusetts Scheduler iniciado
2024-01-15 08:00:00 📅 Modo: all
2024-01-15 08:00:00 ⏰ Horário programado: 9:00
2024-01-15 08:00:00 🔄 Modo automatizado - executando imediatamente...
2024-01-15 08:00:00 🚀 Iniciando execução automática - Modo: all
2024-01-15 08:00:00 📋 Executando TODOS os scrapers...
2024-01-15 08:30:45 ✅ Execução automática concluída - Modo: all
2024-01-15 08:30:45 ⏳ Próxima execução agendada para: 16/01/2024 09:00:00 (em 24h)
```

## 🛠️ Configuração no Portainer

### Stack com Scheduler
```yaml
version: '3.8'
services:
  massachusetts-scraper:
    image: massachusetts-scraper:latest
    environment:
      # Configuração do scheduler
      - RUNNER_MODE=all
      - SCHEDULE_HOUR=9
      
      # Outras configurações
      - WEBHOOK_URL=https://sua-webhook.com
      - DAYS_BACK=7
      - SEND_WEBHOOK=true
      - ENABLE_ENRICHMENT=true
    
    volumes:
      - ma_data:/app/data
      - ma_config:/app/config
      - ma_logs:/app/logs
    
    restart: unless-stopped
```

## 🔄 Monitoramento

### Verificar Status
```bash
# Ver logs do container
docker logs massachusetts-scraper

# Seguir logs em tempo real
docker logs -f massachusetts-scraper

# Verificar dados processados
docker exec massachusetts-scraper ls -la /app/data/MA/
```

### Restart Manual
```bash
# Reiniciar para aplicar nova configuração
docker restart massachusetts-scraper
```

## ⚠️ Considerações Importantes

1. **Primeira Execução**: O scheduler executa imediatamente ao iniciar, não espera o horário programado
2. **Persistência**: Os dados são salvos em volumes Docker, garantindo persistência
3. **Logs**: Todos os logs são salvos no volume `ma_logs` para auditoria
4. **Failover**: Em caso de erro, o scheduler continuará tentando no próximo horário programado
5. **Interrução**: Use `docker stop` para parar graciosamente o scheduler

## 📊 Cenários de Uso

### Produção - Execução Diária Completa
```bash
RUNNER_MODE=all
SCHEDULE_HOUR=6  # 06:00 da manhã
```

### Desenvolvimento - Apenas Probate
```bash
RUNNER_MODE=probate
SCHEDULE_HOUR=10  # 10:00 da manhã
```

### Teste - Modo Interativo
```bash
RUNNER_MODE=interactive  # Menu tradicional
```

## 🆘 Solução de Problemas

### Scheduler Não Executa
- Verificar se `RUNNER_MODE` não é `interactive`
- Verificar logs: `docker logs massachusetts-scraper`
- Verificar variáveis: `docker exec massachusetts-scraper env | grep RUNNER`

### Horário Incorreto
- Verificar timezone do container
- Ajustar `SCHEDULE_HOUR` conforme necessário
- Logs mostram próxima execução programada