#!/bin/bash

# New Jersey Courts Scraper - Executor
# Facilita a execução do sistema de scraping de NJ

echo "🚀 Iniciando Executor New Jersey..."

# Navegar para o diretório do projeto
cd "$(dirname "$0")/../.."

# Executar o executor NJ
npx ts-node runners/NJ/executor.ts