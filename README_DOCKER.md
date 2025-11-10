# 🐳 Massachusetts Scraping System - Deploy Guide

Guia completo para deploy do sistema Massachusetts Scraping v1.0.0 utilizando Docker e Portainer.

## 🚀 Quick Start

### 1. Build da Imagem
```bash
# Clonar repositório
git clone <repo-url>
cd scraping-nilson

# Build da imagem Docker
docker build -t massachusetts-scraper:v1.0.0 .
```

### 2. Desenvolvimento Local
```bash
# Copiar variáveis de ambiente
cp .env.example .env

# Editar configurações
nano .env

# Subir com docker-compose
docker-compose up -d

# Logs
docker-compose logs -f massachusetts-scraper
```

### 3. Deploy Produção (Portainer)
1. Acessar Portainer → Stacks → Add Stack
2. Nome: `massachusetts-scraper`
3. Copiar conteúdo do `portainer-stack.yml`
4. Configurar variáveis de ambiente
5. Deploy

## 📋 Configurações Importantes

### Variáveis de Ambiente Obrigatórias
```env
WEBHOOK_URL=https://your-webhook-endpoint.com
OCR_API_URL=https://your-ocr-service.com
DATA_PATH=/opt/massachusetts-scraper/data
CONFIG_PATH=/opt/massachusetts-scraper/config
LOGS_PATH=/opt/massachusetts-scraper/logs
```

### Headless Mode
- **DESABILITADO** por padrão (`PLAYWRIGHT_HEADLESS=false`)
- Browser visível para monitoramento
- Para produção sem tela, alterar para `true`

## 🎛️ Comandos Disponíveis

### Container Principal
```bash
# Menu interativo Massachusetts
docker run -it massachusetts-scraper:v1.0.0 massachusetts

# Runners individuais
docker run -it massachusetts-scraper:v1.0.0 foreclosure
docker run -it massachusetts-scraper:v1.0.0 probate
docker run -it massachusetts-scraper:v1.0.0 hoa
docker run -it massachusetts-scraper:v1.0.0 preforeclosure

# Todos os runners
docker run -it massachusetts-scraper:v1.0.0 all

# Shell para debug
docker run -it massachusetts-scraper:v1.0.0 bash
```

## 🏗️ Arquitetura da Stack

### Modo Single Container (Padrão)
- 1 container com menu interativo
- Todos os runners no mesmo container
- Ideal para: desenvolvimento, testes, produção simples

### Modo Dedicated Runners (Profile)
- 1 container por runner
- Execução paralela e isolada
- Ideal para: produção com alta demanda

```bash
# Ativar modo dedicated runners
docker-compose --profile dedicated-runners up -d
```

## 📊 Monitoramento

### Health Checks
- Verificação automática de saúde dos containers
- Restart automático em caso de falha
- Logs estruturados com Winston

### Volumes Persistentes
```
ma_data/                    # Dados dos casos processados  
ma_config/                  # Configurações personalizadas
ma_logs/                    # Logs do sistema
ma_browser/                 # Dados do browser (cookies, cache)
ma_*_browser/              # Browser data por runner (modo dedicado)
```

### Recursos
```yaml
# Limites por container
memory: 2-4G
cpus: 1.0-2.0

# Total recomendado para stack completa
memory: 8-16G
cpus: 4-8 cores
```

## 🔧 Troubleshooting

### Container não inicia
```bash
# Verificar logs
docker logs massachusetts-scraper

# Verificar permissões dos volumes
sudo chown -R 1000:1000 ./data ./config ./logs

# Verificar se Playwright foi instalado
docker exec -it massachusetts-scraper npx playwright install --dry-run
```

### Browser não abre (Headless false)
```bash
# Verificar se X11 está disponível
docker run -it --rm -e DISPLAY=$DISPLAY -v /tmp/.X11-unix:/tmp/.X11-unix massachusetts-scraper:v1.0.0 bash

# Para ambientes sem GUI, usar headless=true
PLAYWRIGHT_HEADLESS=true
```

### Webhook não recebe dados
```bash
# Testar conexão
docker exec -it massachusetts-scraper curl -I $WEBHOOK_URL

# Verificar logs do webhook
docker logs massachusetts-scraper | grep webhook
```

### Performance lenta
```bash
# Aumentar recursos no portainer-stack.yml
resources:
  limits:
    memory: 4G
    cpus: '2.0'

# Usar modo dedicated runners para paralelização
```

## 🚦 Status e Logs

### Logs em Tempo Real
```bash
# Container principal
docker logs -f massachusetts-scraper

# Todos os containers da stack
docker-compose logs -f

# Apenas erros
docker logs massachusetts-scraper 2>&1 | grep ERROR
```

### Arquivo de Logs
```bash
# Acessar logs persistentes
docker exec -it massachusetts-scraper ls -la /app/logs/

# Tail do log principal
docker exec -it massachusetts-scraper tail -f /app/logs/massachusetts.log
```

## 🔄 Updates e Manutenção

### Atualizar Imagem
```bash
# Build nova versão
docker build -t massachusetts-scraper:v1.0.1 .

# Atualizar stack no Portainer
# 1. Editar stack
# 2. Alterar tag da imagem
# 3. Redeploy
```

### Backup de Dados
```bash
# Backup automático dos volumes
docker run --rm -v ma_data:/data -v $(pwd):/backup alpine tar czf /backup/ma-data-$(date +%Y%m%d).tar.gz /data

# Restaurar backup
docker run --rm -v ma_data:/data -v $(pwd):/backup alpine tar xzf /backup/ma-data-YYYYMMDD.tar.gz -C /
```

## 📈 Escalabilidade

### Horizontal (Múltiplas Instâncias)
- Usar diferentes `DATA_PATH` por instância
- Load balancer para webhook endpoints
- Shared storage para configurações

### Vertical (Mais Recursos)
- Aumentar limits no docker-compose/stack
- Adicionar mais workers por runner
- Otimizar configurações do Playwright

## 🛡️ Segurança

### Variáveis de Ambiente
- Nunca commitar `.env` com dados reais
- Usar secrets do Portainer/Docker Swarm
- Rotacionar tokens/keys periodicamente

### Network
- Isolamento de rede entre stacks
- Firewall apenas para portas necessárias
- HTTPS para webhooks externos