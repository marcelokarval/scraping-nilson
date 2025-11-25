# Deployment PA Foreclosure - Portainer

## 📋 Pré-requisitos

### 1. Criar diretórios no servidor

```bash
# No servidor do Portainer/Docker Swarm
sudo mkdir -p /mnt/scraping/pa/{data,logs,config,browser}
sudo chown -R 1000:1000 /mnt/scraping/pa
sudo chmod -R 755 /mnt/scraping/pa
```

### 2. Verificar se os diretórios foram criados

```bash
ls -la /mnt/scraping/pa/
# Deve mostrar: data/ logs/ config/ browser/
```

## 🚀 Deploy via Portainer

### Passo 1: Acessar Portainer

1. Acesse: `https://seu-portainer.com`
2. Login com suas credenciais
3. Selecione o **Swarm cluster**

### Passo 2: Criar Stack

1. Menu lateral: **Stacks** → **Add Stack**
2. Nome: `scraping-pa-foreclosure`
3. Build method: **Web editor**

### Passo 3: Copiar configuração

Cole o conteúdo do arquivo `portainer-swarm-pa.yml`

### Passo 4: Configurar variáveis de ambiente

Na seção **Environment variables**, adicione:

```env
PA_USER=seu_usuario
PA_PASS=sua_senha
PA_CAPTCHA_WEBHOOK=https://n8n.arthuragrelli.com/webhook/captcha-solver
WEBHOOK_URL=https://n8n.arthuragrelli.com/webhook/scraping
GITHUB_TOKEN=ghp_seu_token_aqui
CRON_SCHEDULE=0 9 * * *
RUNNER_MODE=pa-foreclosure
```

### Passo 5: Deploy

1. Clique em **Deploy the stack**
2. Aguarde a criação do serviço

## 📊 Monitoramento

### Ver logs em tempo real

```bash
# Via Portainer UI
Stacks → scraping-pa-foreclosure → scraping-pa-foreclosure → Logs → Live

# Via CLI
docker service logs -f scraping-pa-foreclosure_scraping-pa-foreclosure
```

### Verificar execuções

```bash
# Ver logs de execução
sudo ls -lh /mnt/scraping/pa/logs/

# Ver último log
sudo tail -f /mnt/scraping/pa/logs/pa_scraping_$(date +%Y%m%d).log
```

### Verificar dados processados

```bash
# Total de casos
sudo ls -l /mnt/scraping/pa/data/Foreclosure/cases/ | wc -l

# Ver caso específico
sudo ls -lh /mnt/scraping/pa/data/Foreclosure/cases/MG-25-000921/
```

## 🔧 Configuração

### Alterar schedule do cron

Via Portainer:
1. **Stacks** → `scraping-pa-foreclosure` → **Editor**
2. Modificar variável `CRON_SCHEDULE`
3. **Update the stack**

Exemplos de schedule:
- `0 9 * * *` - Diário às 9h
- `0 9,17 * * *` - 9h e 17h
- `0 9 * * 1-5` - Segunda a sexta às 9h
- `0 */6 * * *` - A cada 6 horas

### Modificar config do PA

```bash
# Editar config
sudo nano /mnt/scraping/pa/config/pa_config.json

# Após editar, reiniciar serviço
docker service update --force scraping-pa-foreclosure_scraping-pa-foreclosure
```

### Executar manualmente (fora do cron)

```bash
# Criar task one-shot
docker service create \
  --name pa-manual \
  --env-file .env.pa-foreclosure-portainer \
  --env RUNNER_MODE=one-shot \
  --mount type=bind,source=/mnt/scraping/pa/data,target=/app/data/PA \
  --mount type=bind,source=/mnt/scraping/pa/logs,target=/app/logs \
  --mount type=bind,source=/mnt/scraping/pa/config,target=/app/config \
  ghcr.io/marcelokarval/scraping-nilson:latest

# Remover após execução
docker service rm pa-manual
```

## 🔄 Atualização

### Via GitHub Token (automático)

Se `GITHUB_TOKEN` está configurado, o sistema faz pull automático antes de cada execução.

### Manual

```bash
# Forçar rebuild da imagem
docker service update \
  --force \
  --update-parallelism 1 \
  scraping-pa-foreclosure_scraping-pa-foreclosure
```

## 📈 Volumes Persistentes

| Volume | Caminho Host | Caminho Container | Conteúdo |
|--------|-------------|-------------------|----------|
| `scraping-pa-data` | `/mnt/scraping/pa/data` | `/app/data/PA` | Casos processados, PDFs, JSON |
| `scraping-pa-logs` | `/mnt/scraping/pa/logs` | `/app/logs` | Logs de execução |
| `scraping-pa-config` | `/mnt/scraping/pa/config` | `/app/config` | Configuração PA |
| `scraping-pa-browser` | `/mnt/scraping/pa/browser` | `/app/playwright_user_data` | Sessões browser |

## 🐛 Troubleshooting

### Container não inicia

```bash
# Ver logs de erro
docker service logs scraping-pa-foreclosure_scraping-pa-foreclosure

# Verificar permissões
sudo ls -la /mnt/scraping/pa/
```

### Cron não executa

```bash
# Entrar no container
docker exec -it $(docker ps -q -f name=scraping-pa-foreclosure) sh

# Ver cron configurado
cat /etc/crontabs/root

# Ver logs do cron
cat /var/log/cron.log
```

### Falta de memória

```bash
# Aumentar limite no stack
# Editar portainer-swarm-pa.yml:
resources:
  limits:
    memory: 12G  # Era 10G
```

### Dados não persistem

```bash
# Verificar se volumes estão montados
docker inspect $(docker ps -q -f name=scraping-pa-foreclosure) | grep Mounts -A 20

# Verificar permissões
sudo chown -R 1000:1000 /mnt/scraping/pa
```

## 📝 Logs de Execução

### Estrutura de logs

```
/mnt/scraping/pa/logs/
├── pa_scraping_20251122.log  # Log do dia
├── pa_scraping_20251121.log
└── pa_scraping_20251120.log
```

### Analisar logs

```bash
# Ver últimas 100 linhas
sudo tail -100 /mnt/scraping/pa/logs/pa_scraping_$(date +%Y%m%d).log

# Buscar erros
sudo grep -i "error\|fail" /mnt/scraping/pa/logs/pa_scraping_$(date +%Y%m%d).log

# Ver estatísticas
sudo grep -i "phase\|summary" /mnt/scraping/pa/logs/pa_scraping_$(date +%Y%m%d).log
```

## 🔐 Segurança

### Proteger credenciais

1. Nunca commitar o arquivo `.env.pa-foreclosure-portainer`
2. Usar Portainer Secrets para senhas sensíveis
3. Rotacionar tokens periodicamente

### Backup

```bash
# Backup dos dados
sudo tar -czf pa_backup_$(date +%Y%m%d).tar.gz /mnt/scraping/pa/data

# Backup dos logs
sudo tar -czf pa_logs_$(date +%Y%m%d).tar.gz /mnt/scraping/pa/logs
```

## 📞 Suporte

- Logs detalhados em `/mnt/scraping/pa/logs/`
- Casos processados em `/mnt/scraping/pa/data/Foreclosure/cases/`
- Config em `/mnt/scraping/pa/config/pa_config.json`
