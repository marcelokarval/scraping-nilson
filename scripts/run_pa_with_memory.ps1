# Script para executar PA runner com limite de memoria aumentado e garbage collection
Write-Host "=== EXECUTANDO PA RUNNER COM OTIMIZACOES DE MEMORIA ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Configuracoes:" -ForegroundColor Yellow
Write-Host "  - Node heap size: 8GB" -ForegroundColor White
Write-Host "  - Garbage collection: HABILITADO" -ForegroundColor White
Write-Host "  - Fases: Coleta, PDFs, Extracao, Enriquecimento, Webhooks" -ForegroundColor White
Write-Host ""

$env:NODE_OPTIONS = "--max-old-space-size=8192 --expose-gc"

npx tsx src/runners/PA/executor.ts

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n=== SCRAPING CONCLUÍDO COM SUCESSO ===" -ForegroundColor Green
} else {
    Write-Host "`n=== SCRAPING FINALIZADO COM ERROS ===" -ForegroundColor Red
    Write-Host "Exit code: $LASTEXITCODE" -ForegroundColor Yellow
}
