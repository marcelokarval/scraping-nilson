#!/usr/bin/env pwsh
# Teste local do container PA antes de deploy no Portainer

Write-Host "`n=== TESTE LOCAL PA CONTAINER ===" -ForegroundColor Cyan
Write-Host ""

# Carregar variáveis de ambiente
if (Test-Path ".env.pa-foreclosure-portainer") {
    Get-Content ".env.pa-foreclosure-portainer" | Where-Object { $_ -notmatch '^#' -and $_ -match '=' } | ForEach-Object {
        $key, $value = $_ -split '=', 2
        [Environment]::SetEnvironmentVariable($key, $value, "Process")
        Write-Host "✓ Loaded: $key" -ForegroundColor Green
    }
} else {
    Write-Host "⚠ Arquivo .env.pa-foreclosure-portainer não encontrado!" -ForegroundColor Yellow
    Write-Host "Crie o arquivo com as credenciais necessárias" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "=== BUILD DA IMAGEM ===" -ForegroundColor Cyan
docker build -t scraping-pa-test:latest .

if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ Erro no build da imagem" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "=== CRIANDO VOLUMES LOCAIS ===" -ForegroundColor Cyan
$testDir = "F:\projetos\Scraping\test-volumes\pa"
New-Item -ItemType Directory -Force -Path "$testDir\data" | Out-Null
New-Item -ItemType Directory -Force -Path "$testDir\logs" | Out-Null
New-Item -ItemType Directory -Force -Path "$testDir\config" | Out-Null
New-Item -ItemType Directory -Force -Path "$testDir\browser" | Out-Null

Write-Host "✓ Volumes criados em: $testDir" -ForegroundColor Green

Write-Host ""
Write-Host "=== EXECUTANDO CONTAINER (ONE-SHOT) ===" -ForegroundColor Cyan
Write-Host "Pressione Ctrl+C para cancelar..." -ForegroundColor Yellow
Write-Host ""

docker run --rm -it `
    -e PA_USER=$env:PA_USER `
    -e PA_PASS=$env:PA_PASS `
    -e PA_CAPTCHA_WEBHOOK=$env:PA_CAPTCHA_WEBHOOK `
    -e WEBHOOK_URL=$env:WEBHOOK_URL `
    -e RUNNER_MODE=one-shot `
    -e NODE_OPTIONS="--max-old-space-size=8192 --expose-gc" `
    -v "${testDir}\data:/app/data/PA" `
    -v "${testDir}\logs:/app/logs" `
    -v "${testDir}\config:/app/config" `
    -v "${testDir}\browser:/app/playwright_user_data" `
    scraping-pa-test:latest `
    sh -c '
        echo "=== TESTE PA SCRAPING ===" &&
        echo "Timezone: $(date)" &&
        echo "" &&
        
        # Criar estrutura
        mkdir -p /app/data/PA/Foreclosure/cases &&
        mkdir -p /app/logs &&
        
        # Executar
        cd /app &&
        NODE_OPTIONS="--max-old-space-size=8192 --expose-gc" npx tsx src/runners/PA/executor.ts 2>&1 | tee /app/logs/pa_test_$(date +%Y%m%d_%H%M%S).log &&
        
        echo "" &&
        echo "=== TESTE CONCLUÍDO ===" &&
        echo "Logs salvos em /app/logs/" &&
        echo "Dados salvos em /app/data/PA/"
    '

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "=== RESULTADOS DO TESTE ===" -ForegroundColor Green
    Write-Host ""
    
    Write-Host "📁 Dados:" -ForegroundColor Cyan
    if (Test-Path "$testDir\data\Foreclosure\cases") {
        $caseCount = (Get-ChildItem "$testDir\data\Foreclosure\cases" -Directory).Count
        Write-Host "  ✓ Casos processados: $caseCount" -ForegroundColor Green
    }
    
    Write-Host ""
    Write-Host "📋 Logs:" -ForegroundColor Cyan
    if (Test-Path "$testDir\logs") {
        Get-ChildItem "$testDir\logs" -File | ForEach-Object {
            Write-Host "  ✓ $($_.Name) ($([math]::Round($_.Length / 1KB, 2)) KB)" -ForegroundColor Green
        }
    }
    
    Write-Host ""
    Write-Host "✅ TESTE BEM-SUCEDIDO!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Próximos passos:" -ForegroundColor Yellow
    Write-Host "  1. Revisar logs em: $testDir\logs" -ForegroundColor White
    Write-Host "  2. Verificar casos em: $testDir\data\Foreclosure\cases" -ForegroundColor White
    Write-Host "  3. Se tudo OK, fazer deploy no Portainer" -ForegroundColor White
    Write-Host "  4. Consultar: docs/PA_PORTAINER_DEPLOY.md" -ForegroundColor White
    
} else {
    Write-Host ""
    Write-Host "✗ TESTE FALHOU!" -ForegroundColor Red
    Write-Host "Verifique os logs em: $testDir\logs" -ForegroundColor Yellow
}

Write-Host ""
