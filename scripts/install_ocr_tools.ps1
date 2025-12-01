# Script para instalar ferramentas de OCR no Windows
# Executa: powershell -ExecutionPolicy Bypass .\scripts\install_ocr_tools.ps1

$ToolsDir = "C:\OCRTools"
New-Item -ItemType Directory -Force -Path $ToolsDir | Out-Null

Write-Host "=== Instalando ferramentas de OCR ===" -ForegroundColor Green

# 1. Poppler (pdftotext, pdftoppm, pdftocairo)
Write-Host "`n[1/2] Baixando Poppler..." -ForegroundColor Yellow
$PopplerUrl = "https://github.com/oschwartz10612/poppler-windows/releases/download/v24.08.0-0/Release-24.08.0-0.zip"
$PopplerZip = "$ToolsDir\poppler.zip"
$PopplerDir = "$ToolsDir\poppler"

if (-not (Test-Path "$PopplerDir\Library\bin\pdftotext.exe")) {
    Invoke-WebRequest -Uri $PopplerUrl -OutFile $PopplerZip -UseBasicParsing
    Expand-Archive -Path $PopplerZip -DestinationPath $PopplerDir -Force
    Remove-Item $PopplerZip
    Write-Host "  [OK] Poppler installed at: $PopplerDir\Library\bin" -ForegroundColor Green
} else {
    Write-Host "  [OK] Poppler already installed" -ForegroundColor Green
}

# 2. Tesseract OCR
Write-Host "`n[2/2] Baixando Tesseract OCR..." -ForegroundColor Yellow
$TesseractUrl = "https://digi.bib.uni-mannheim.de/tesseract/tesseract-ocr-w64-setup-5.3.3.20231005.exe"
$TesseractInstaller = "$ToolsDir\tesseract-installer.exe"
$TesseractDir = "C:\Program Files\Tesseract-OCR"

if (-not (Test-Path "$TesseractDir\tesseract.exe")) {
    Invoke-WebRequest -Uri $TesseractUrl -OutFile $TesseractInstaller -UseBasicParsing
    Write-Host "  Installing Tesseract (please wait)..." -ForegroundColor Yellow
    Start-Process -FilePath $TesseractInstaller -ArgumentList "/S" -Wait
    Remove-Item $TesseractInstaller
    Write-Host "  [OK] Tesseract installed at: $TesseractDir" -ForegroundColor Green
} else {
    Write-Host "  [OK] Tesseract already installed" -ForegroundColor Green
}

# 3. Adicionar ao PATH
Write-Host "`n[3/3] Configurando PATH..." -ForegroundColor Yellow
$PathsToAdd = @(
    "$PopplerDir\Library\bin",
    "$TesseractDir"
)

$CurrentPath = [Environment]::GetEnvironmentVariable("Path", "Machine")
$Modified = $false

foreach ($Path in $PathsToAdd) {
    if ($CurrentPath -notlike "*$Path*") {
        $CurrentPath = "$CurrentPath;$Path"
        $Modified = $true
        Write-Host "  + Adicionado ao PATH: $Path" -ForegroundColor Cyan
    } else {
        Write-Host "  [OK] Already in PATH: $Path" -ForegroundColor Green
    }
}

if ($Modified) {
    [Environment]::SetEnvironmentVariable("Path", $CurrentPath, "Machine")
    Write-Host "`n[OK] PATH updated (restart terminal to apply)" -ForegroundColor Green
}

# Atualizar PATH da sessão atual
$env:Path = "$env:Path;$PopplerDir\Library\bin;$TesseractDir"

Write-Host "`n=== Verificando instalação ===" -ForegroundColor Green
Write-Host "pdftotext: " -NoNewline
& "$PopplerDir\Library\bin\pdftotext.exe" -v 2>&1 | Select-Object -First 1
Write-Host "tesseract: " -NoNewline
& "$TesseractDir\tesseract.exe" --version 2>&1 | Select-Object -First 1

Write-Host "`n[DONE] Installation completed!" -ForegroundColor Green
Write-Host "Run this command: " -NoNewline -ForegroundColor Yellow
Write-Host "`$env:Path = `"$PopplerDir\Library\bin;$TesseractDir;`$env:Path`"" -ForegroundColor Cyan
Write-Host "to use the tools in this PowerShell session." -ForegroundColor Yellow
