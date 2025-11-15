#!/bin/bash

# New Hampshire Courts Scraper - Executor
# Facilita a execução do sistema de scraping de NH com duas fases

echo "🏔️ Iniciando Executor New Hampshire..."

# Navegar para o diretório do projeto
cd "$(dirname "$0")/../.."

# Executar o executor NH
npx ts-node runners/NH/executor.ts