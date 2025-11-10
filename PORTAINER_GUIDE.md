# 📋 Portainer Stack - Massachusetts Scraping System

## 🚀 Como Deployar no Portainer

### 1. Preparar o Ambiente

#### Criar Diretórios no Host
```bash
# No servidor Docker host
sudo mkdir -p /opt/massachusetts-scraper/{data,config,logs}
sudo chown -R 1000:1000 /opt/massachusetts-scraper/
```

#### Build da Imagem
```bash
# Opção 1: Build local
git clone <repo-url>
cd scraping-nilson
docker build -t massachusetts-scraper:v1.0.0 .

# Opção 2: Registry (recomendado para produção)
# docker pull your-registry/massachusetts-scraper:v1.0.0
```

### 2. Configurar no Portainer

#### Acessar Portainer
1. Abrir Portainer (ex: https://portainer.domain.com)
2. Login no ambiente
3. Selecionar endpoint Docker

#### Criar Nova Stack
1. **Stacks** → **Add Stack**
2. **Name**: `massachusetts-scraper`
3. **Build method**: Web editor
4. Copiar o conteúdo do `portainer-stack.yml`

#### Configurar Variáveis de Ambiente
```env
# OBRIGATÓRIAS
WEBHOOK_URL=https://your-webhook-endpoint.com/massachusetts
OCR_API_URL=https://your-ocr-service.com/api/v1/ocr
DATA_PATH=/opt/massachusetts-scraper/data
CONFIG_PATH=/opt/massachusetts-scraper/config
LOGS_PATH=/opt/massachusetts-scraper/logs

# OPCIONAIS
API_PORT=3000
LOG_LEVEL=info
FORCE_REENRICHMENT=false
```

#### Deploy da Stack
1. Clicar em **Deploy the stack**
2. Aguardar o download e inicialização dos containers
3. Verificar status: **Containers** → Status "running"

### 3. Modos de Operação

#### Modo Single Container (Padrão)
- Container: `massachusetts-scraper`
- Menu interativo através dos logs
- Todos os runners em um container

#### Modo Dedicated Runners
1. Editar a stack
2. Uncommentar seção `profiles: - dedicated-runners`
3. Update stack
4. Containers separados: `ma-foreclosure-runner`, `ma-probate-runner`, etc.

### 4. Monitoramento

#### Verificar Logs
1. **Containers** → `massachusetts-scraper` → **Logs**
2. Logs em tempo real
3. Filtrar por nível (ERROR, WARN, INFO)

#### Health Check
- Status: Verde = Healthy
- Status: Vermelho = Restarting/Unhealthy
- Auto-restart configurado

#### Recursos
```
Container          CPU    Memory   
massachusetts      1-2    2-4GB    
foreclosure        0.5-1  1-2GB    
probate           0.5-1  1-2GB    
hoa               0.5-1  1-2GB    
preforeclosure    0.5-1  1-2GB    
```

### 5. Operações

#### Restart Container
1. **Containers** → `massachusetts-scraper`
2. **Actions** → **Restart**

#### Acessar Shell
1. **Containers** → `massachusetts-scraper`
2. **Console** → **Connect** → **/bin/bash**

#### Update da Imagem
1. Build nova versão: `massachusetts-scraper:v1.0.1`
2. **Stacks** → `massachusetts-scraper` → **Edit**
3. Alterar tag da imagem
4. **Update the stack**

#### Backup de Dados
```bash
# Via Docker host
sudo tar -czf /backup/ma-data-$(date +%Y%m%d).tar.gz /opt/massachusetts-scraper/data/

# Via Portainer Console
tar -czf /tmp/backup.tar.gz /app/data/
```

### 6. Troubleshooting

#### Container não inicia
```bash
# Verificar logs do container
docker logs massachusetts-scraper

# Verificar se imagem existe
docker images | grep massachusetts

# Verificar permissões dos volumes
sudo ls -la /opt/massachusetts-scraper/
```

#### Browser não funciona (Headless=false)
```bash
# Verificar se X11 está disponível no host
echo $DISPLAY

# Para servidores sem GUI, forçar headless
# Environment: PLAYWRIGHT_HEADLESS=true
```

#### Webhook não funciona
```bash
# Testar conectividade
docker exec massachusetts-scraper curl -I $WEBHOOK_URL

# Verificar variável de ambiente
docker exec massachusetts-scraper env | grep WEBHOOK
```

#### Performance lenta
1. **Containers** → `massachusetts-scraper` → **Stats**
2. Verificar uso de CPU/Memory
3. Ajustar limits na stack se necessário
4. Considerar usar modo dedicated runners

### 7. Configurações Avançadas

#### Networking
```yaml
# Para comunicação entre stacks
networks:
  massachusetts_network:
    external: true
```

#### Secrets (Portainer Business)
```yaml
# Substituir environment variables
secrets:
  - webhook_url
  - ocr_api_key
```

#### Scaling
```yaml
# Para múltiplas instâncias
deploy:
  replicas: 2
  update_config:
    parallelism: 1
    delay: 10s
```

### 8. Manutenção

#### Rotação de Logs
```bash
# Configurar logrotate no host
sudo vim /etc/logrotate.d/massachusetts-scraper
```

#### Cleanup de Dados Antigos
```bash
# Script de limpeza semanal
find /opt/massachusetts-scraper/data -type f -mtime +30 -delete
```

#### Updates de Segurança
```bash
# Update da base image
docker build --no-cache -t massachusetts-scraper:v1.0.2 .
```

### 9. Alertas e Notificações

#### Webhook para Status
```yaml
environment:
  - STATUS_WEBHOOK=https://alerts.domain.com/massachusetts
```

#### Monitoramento Externo
- Portainer Webhooks
- Prometheus + Grafana
- Uptime Kuma
- StatusCake

### 10. Exemplo de Configuração Completa

```yaml
# Variáveis de Ambiente no Portainer
WEBHOOK_URL=https://api.realestate.com/webhook/massachusetts
OCR_API_URL=https://ocr.service.com/api/v1/process
DATA_PATH=/opt/massachusetts-scraper/data
CONFIG_PATH=/opt/massachusetts-scraper/config
LOGS_PATH=/opt/massachusetts-scraper/logs
API_PORT=3000
LOG_LEVEL=info
PLAYWRIGHT_HEADLESS=false
DAYS_BACK=0
ENABLE_ENRICHMENT=true
SEND_WEBHOOK=true
FORCE_REENRICHMENT=false
```

## ✅ Checklist de Deploy

- [ ] Diretórios criados no host (`/opt/massachusetts-scraper/`)
- [ ] Permissões configuradas (`chown 1000:1000`)
- [ ] Imagem buildada (`massachusetts-scraper:v1.0.0`)
- [ ] Stack criada no Portainer
- [ ] Variáveis de ambiente configuradas
- [ ] Webhook URL válida
- [ ] OCR API URL configurada (se usado)
- [ ] Stack deployada com sucesso
- [ ] Container executando (status: running)
- [ ] Logs mostrando menu Massachusetts
- [ ] Teste de conectividade webhook
- [ ] Backup configurado
- [ ] Monitoramento ativo

## 🆘 Suporte

Para problemas específicos, verificar:
1. Logs do container no Portainer
2. Status dos volumes e networking
3. Conectividade com serviços externos
4. Recursos disponíveis (CPU/Memory)
5. README_DOCKER.md para troubleshooting detalhado