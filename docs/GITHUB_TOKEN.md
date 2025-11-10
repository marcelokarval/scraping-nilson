# 🔐 GitHub Token - Acesso a Repositório Privado

## 📋 Passo a Passo Completo

### 1️⃣ **Criar Personal Access Token no GitHub**

1. **Acesse**: [https://github.com/settings/tokens](https://github.com/settings/tokens)
2. **Clique**: "Generate new token" → "Generate new token (classic)"
3. **Configure**:
   - **Note**: `Massachusetts Scraper Token`
   - **Expiration**: `90 days` (ou conforme necessário)
   - **Scopes**: Marque apenas:
     - ✅ `repo` (Full control of private repositories)
     - ✅ `read:org` (Read org and team membership)

4. **Clique**: "Generate token"
5. **⚠️ IMPORTANTE**: Copie o token imediatamente (só aparece uma vez!)
   - Exemplo: `ghp_1234567890abcdefghijklmnopqrstuvwxyz`

### 2️⃣ **Configurar no Portainer**

#### **Usar Stack com Token**
1. **Portainer** → **Stacks** → **Add stack**
2. **Nome**: `massachusetts-foreclosure`
3. **Cole o conteúdo** do arquivo `portainer-swarm-token.yml`

#### **Configurar Variáveis de Ambiente**
Na seção **Environment variables**:

```
GITHUB_TOKEN=ghp_seu_token_aqui_muito_longo
GITHUB_USER=marcelokarval
WEBHOOK_URL=https://webhook.site/#!/sua-url-aqui
```

### 3️⃣ **Deploy da Stack**
1. **Deploy the stack**
2. ⏳ **Aguarde**: ~5-8 minutos (primeira vez)
3. 👀 **Monitore**: Services → Logs

## 🔒 **Segurança do Token**

### ✅ **Boas Práticas:**
- **Escopo Mínimo**: Apenas `repo` permission
- **Expiration**: Definir prazo (não indefinido)
- **Nome Descritivo**: Para identificar facilmente
- **Rotação**: Renovar periodicamente

### ⚠️ **Cuidados:**
- **Não compartilhar** o token
- **Não commitar** em código
- **Usar apenas** nas variáveis do Portainer
- **Revogar** se comprometido

## 📊 **Logs Esperados**

### **Sucesso:**
```
🚀 Iniciando Massachusetts Foreclosure Scraper...
📦 Instalando dependências do sistema...
🔐 Configurando autenticação GitHub...
📥 Clonando repositório privado...
📦 Instalando dependências Node...
🎭 Instalando Playwright...
🧹 Limpando credenciais...
✅ Iniciando Massachusetts Scraper...
🤖 Massachusetts Scheduler iniciado
📅 Modo: 5 (foreclosure)
⏰ Horário programado: 6:00
```

### **Erro de Token:**
```
❌ GITHUB_TOKEN não configurado!
📝 Configure o token nas variáveis de ambiente do Portainer
🔗 Crie em: https://github.com/settings/tokens
```

## 🔄 **Renovação do Token**

### **Quando Renovar:**
- Token expirando
- Mudança de permissões
- Suspeita de comprometimento

### **Como Renovar:**
1. **GitHub**: Settings → Tokens → Regenerate token
2. **Portainer**: Stacks → Edit → Environment variables
3. **Atualizar**: `GITHUB_TOKEN` com novo valor
4. **Update**: Update the stack

## 🆘 **Troubleshooting**

### **Clone Falha:**
```bash
# Verificar token
echo $GITHUB_TOKEN | cut -c1-10  # Deve mostrar: ghp_xxxxxx

# Testar manualmente
curl -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/user
```

### **Token Inválido:**
- Verificar se não expirou
- Confirmar permissões `repo`
- Recriar se necessário

### **Repositório Não Encontrado:**
- Verificar se `GITHUB_USER` está correto
- Confirmar nome do repositório
- Verificar se token tem acesso ao repo

## 🎯 **Resultado Final**

### **Container Funcional:**
- ✅ Clone automático do repositório privado
- ✅ Instalação completa das dependências
- ✅ Execução do Massachusetts Scraper
- ✅ Limpeza automática das credenciais
- ✅ Execução diária programada

### **Dados Gerados:**
- `foreclosure_data` volume com JSONs
- `foreclosure_logs` volume com logs
- Webhook enviado em tempo real

### **Segurança:**
- Token usado apenas para clone
- Credenciais removidas após uso
- Sem rastros no filesystem

## 📝 **Exemplo de Configuração Completa**

```yaml
# No Portainer - Environment variables
GITHUB_TOKEN=ghp_1234567890abcdefghijklmnopqrstuvwxyz123456
GITHUB_USER=marcelokarval
WEBHOOK_URL=https://webhook.site/#!/abc-def-123
RUNNER_MODE=5
SCHEDULE_HOUR=6
DAYS_BACK=7
SEND_WEBHOOK=true
ENABLE_ENRICHMENT=true
```

Agora o clone do repositório privado funcionará perfeitamente! 🚀🔐