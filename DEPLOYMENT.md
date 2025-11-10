# Massachusetts Scraper - Portainer Deployment

## 🚀 Deployment Atual

Este projeto usa o **`portainer-swarm-ultra.yml`** para deployment no Portainer.

### 📋 Configuração Necessária

No Portainer, configure as seguintes variáveis de ambiente:

```bash
GITHUB_TOKEN=seu_token_do_github
GITHUB_USER=marcelokarval
```

### 🎯 Funcionalidades

- **Runner Mode**: Foreclosure (RUNNER_MODE=5)
- **Schedule**: Execução às 6h da manhã
- **Node.js**: Versão 20 (compatível com better-sqlite3)
- **TypeScript**: Compilação completa com bibliotecas DOM
- **Playwright**: Browser automation para scraping

### 📂 Estrutura de Dados

Os dados são persistidos em volumes Docker:
- `foreclosure_data`: Dados extraídos
- `foreclosure_logs`: Logs do sistema
- `foreclosure_browser`: Dados do browser Playwright

### 🔧 Recursos

- **Memória**: 4GB (limite)
- **CPU**: 2.0 cores (limite)
- **Restart Policy**: Reinicia automaticamente em caso de falha
- **Health Check**: Monitora o processo Node.js

### 📝 Webhook

Webhook configurado para: `https://n8n.arthuragrelli.com/webhook/scraping`

---

**Status**: ✅ Pronto para produção
**Última atualização**: 10/11/2025