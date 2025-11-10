#!/bin/bash
set -e

# Massachusetts Scraping System Docker Entrypoint
echo "🚀 Iniciando Massachusetts Scraping System v1.0.0"

# Aguardar um pouco para o sistema estabilizar
sleep 2

# Verificar se o diretório de dados existe
mkdir -p /app/data/MA
mkdir -p /app/playwright_user_data

# Configurar permissões
chown -R node:node /app/data
chown -R node:node /app/playwright_user_data

# Função para executar como usuário node
run_as_node() {
    exec gosu node "$@"
}

# Instalar gosu se não existir
if ! command -v gosu &> /dev/null; then
    apt-get update && apt-get install -y gosu && rm -rf /var/lib/apt/lists/*
fi

# Executar com base no comando
case "$1" in
    massachusetts|ma)
        echo "📍 Executando Massachusetts System Menu"
        run_as_node npx ts-node runners/MA/executor.ts
        ;;
    foreclosure)
        echo "🏠 Executando apenas Foreclosure Runner"
        run_as_node npx ts-node -e "
        import { ForeclosureRunner } from './runners/MA/foreclosure_runner';
        import { MA_DEFAULT_OPTIONS } from './runners/MA/config';
        const runner = new ForeclosureRunner();
        runner.run(MA_DEFAULT_OPTIONS).catch(console.error);
        "
        ;;
    probate)
        echo "⚖️ Executando apenas Probate Runner"
        run_as_node npx ts-node -e "
        import { runProbateRunner } from './runners/MA/probate_runner';
        import { MA_DEFAULT_OPTIONS } from './runners/MA/config';
        runProbateRunner(MA_DEFAULT_OPTIONS).catch(console.error);
        "
        ;;
    hoa)
        echo "🏘️ Executando apenas HOA Runner"
        run_as_node npx ts-node -e "
        import { runHOARunner } from './runners/MA/hoa_runner';
        import { MA_DEFAULT_OPTIONS } from './runners/MA/config';
        runHOARunner(MA_DEFAULT_OPTIONS).catch(console.error);
        "
        ;;
    preforeclosure)
        echo "⚠️ Executando apenas Pre-Foreclosure Runner"
        run_as_node npx ts-node -e "
        import { runPreForeclosureRunner } from './runners/MA/pre_foreclosure_runner';
        import { MA_DEFAULT_OPTIONS } from './runners/MA/config';
        runPreForeclosureRunner(MA_DEFAULT_OPTIONS).catch(console.error);
        "
        ;;
    all)
        echo "🔄 Executando todos os runners"
        run_as_node npx ts-node -e "
        import { MassachusettsExecutor } from './runners/MA/executor';
        const executor = new MassachusettsExecutor();
        executor['runAllScrapers']().catch(console.error);
        "
        ;;
    bash|shell)
        echo "🐚 Iniciando shell interativo"
        exec /bin/bash
        ;;
    *)
        echo "❌ Comando não reconhecido: $1"
        echo ""
        echo "Comandos disponíveis:"
        echo "  massachusetts, ma  - Menu interativo Massachusetts"
        echo "  foreclosure       - Apenas Foreclosure Runner"
        echo "  probate          - Apenas Probate Runner" 
        echo "  hoa              - Apenas HOA Runner"
        echo "  preforeclosure   - Apenas Pre-Foreclosure Runner"
        echo "  all              - Todos os runners"
        echo "  bash, shell      - Shell interativo"
        exit 1
        ;;
esac