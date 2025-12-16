#!/usr/bin/env ts-node
/**
 * Script para reextrair PDFs dos cases de hoje
 * Extrai novamente os PDFs que falharam por falta de dependências
 */

import fs from 'fs';
import path from 'path';
import { ensureExtractAndSave } from '../services/ocr_client';

const BASE_DATA_DIR = path.join(process.cwd(), 'runners', 'MA', 'data', 'MA', 'Pre-Foreclosure');
const TODAY = '2025-12-03';

interface CaseToReextract {
  caseNumber: string;
  city: string;
  caseDir: string;
  pdfPath: string;
}

async function findCasesToReextract(): Promise<CaseToReextract[]> {
  const processedFile = path.join(process.cwd(), 'runners', 'MA', 'data', 'MA', 'pre_foreclosure_processed_cases.json');
  
  if (!fs.existsSync(processedFile)) {
    console.error('❌ Arquivo de cases processados não encontrado');
    return [];
  }

  const data = JSON.parse(fs.readFileSync(processedFile, 'utf8'));
  const cases: CaseToReextract[] = [];

  for (const [key, value] of Object.entries(data.processed)) {
    const caseData = value as any;
    if (caseData.processed_at && caseData.processed_at.startsWith(TODAY)) {
      const city = caseData.city;
      const caseNumber = caseData.caseNumber;
      const caseDir = path.join(BASE_DATA_DIR, city, 'cases', caseNumber);
      const pdfPath = path.join(caseDir, `${caseNumber}_COMPLAINT.pdf`);
      
      if (fs.existsSync(pdfPath)) {
        // Verificar se a extração falhou
        const extractedJson = path.join(caseDir, `${caseNumber}_complaint_extracted.json`);
        if (fs.existsSync(extractedJson)) {
          const extractedData = JSON.parse(fs.readFileSync(extractedJson, 'utf8'));
          if (!extractedData.extraction_successful || !extractedData.full_text || extractedData.full_text.length === 0) {
            cases.push({ caseNumber, city, caseDir, pdfPath });
          }
        } else {
          // Se não existe JSON de extração, precisa extrair
          cases.push({ caseNumber, city, caseDir, pdfPath });
        }
      }
    }
  }

  return cases;
}

async function reextractPDF(caseInfo: CaseToReextract): Promise<boolean> {
  const { caseNumber, city, caseDir, pdfPath } = caseInfo;
  
  console.log(`\n🔄 Reextraindo PDF: ${caseNumber} (${city})`);
  console.log(`   PDF: ${pdfPath}`);
  
  const outJson = path.join(caseDir, `${caseNumber}_complaint_extracted.json`);
  const outTxt = path.join(caseDir, 'complaint_pdf.txt');
  
  try {
    const result = await ensureExtractAndSave(pdfPath, outJson, outTxt);
    
    if (result.data.extraction_successful && result.extractedText && result.extractedText.length > 0) {
      console.log(`   ✅ Extração bem-sucedida! ${result.data.text_length} caracteres`);
      return true;
    } else {
      console.log(`   ⚠️  Extração retornou vazio`);
      return false;
    }
  } catch (e: any) {
    console.error(`   ❌ Erro na extração:`, e.message);
    return false;
  }
}

async function main() {
  console.log('🚀 Iniciando reextração de PDFs de hoje...\n');
  console.log(`📅 Data: ${TODAY}\n`);
  
  const cases = await findCasesToReextract();
  
  if (cases.length === 0) {
    console.log('✅ Todos os PDFs já foram extraídos com sucesso!');
    return;
  }

  console.log(`📋 Encontrados ${cases.length} PDFs para reextrair:\n`);
  cases.forEach((c, i) => {
    console.log(`   ${i + 1}. ${c.caseNumber} (${c.city})`);
  });

  console.log('\n' + '='.repeat(60) + '\n');

  let success = 0;
  let failed = 0;

  for (const caseInfo of cases) {
    const result = await reextractPDF(caseInfo);
    if (result) {
      success++;
    } else {
      failed++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('\n📊 RESUMO DA REEXTRAÇÃO:');
  console.log(`   ✅ Sucesso: ${success}`);
  console.log(`   ❌ Falhas: ${failed}`);
  console.log(`   📋 Total: ${cases.length}\n`);
  
  if (success > 0) {
    console.log('💡 Agora execute o script de reenvio:');
    console.log('   npx ts-node scripts/resend_today_cases.ts\n');
  }
}

// Executar
main().catch(console.error);
