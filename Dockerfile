# Massachusetts Scraping System v1.0.0
FROM node:18-bullseye

# Instalar dependências do sistema para Playwright
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    libnss3-dev \
    libatk-bridge2.0-dev \
    libdrm-dev \
    libxkbcommon-dev \
    libgtk-3-dev \
    libxss1 \
    libasound2-dev \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

# Criar diretório de trabalho
WORKDIR /app

# Copiar package.json e instalar dependências Node.js
COPY package*.json ./
RUN npm ci --only=production

# Instalar Playwright browsers
RUN npx playwright install chromium
RUN npx playwright install-deps chromium

# Copiar código fonte
COPY . .

# Compilar TypeScript
RUN npm run build 2>/dev/null || echo "No build script found, using ts-node directly"

# Criar volumes para dados persistentes
VOLUME ["/app/data", "/app/playwright_user_data"]

# Variáveis de ambiente
ENV NODE_ENV=production
ENV PLAYWRIGHT_HEADLESS=false
ENV DAYS_BACK=0
ENV ENABLE_ENRICHMENT=true
ENV SEND_WEBHOOK=true

# Expor porta para possível API futura
EXPOSE 3000

# Script de inicialização
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Comando padrão - Massachusetts executor
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["massachusetts"]