#!/bin/bash
# Script de conveniência para executar o executor MA

cd "$(dirname "$0")/../../"
echo "🚀 Iniciando Executor Massachusetts..."
npx ts-node runners/MA/executor.ts