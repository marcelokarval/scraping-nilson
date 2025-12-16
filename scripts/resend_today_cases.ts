#!/usr/bin/env ts-node
/**
 * Script para reenviar cases processados hoje
 * Força o reenvio de webhooks para cases que falharam por falta de dependências
 */

import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { sha256String } from '../utils/hash';

const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://n8n.arthuragrelli.com/webhook/scraping';
const BASE_DATA_DIR = path.join(process.cwd(), 'runners', 'MA', 'data', 'MA', 'Pre-Foreclosure');
const TODAY = '2025-12-03';

interface CaseToResend {
  caseNumber: string;
  city: string;
  caseDir: string;
}

async function findCasesToResend(): Promise<CaseToResend[]> {
  const processedFile = path.join(process.cwd(), 'runners', 'MA', 'data', 'MA', 'pre_foreclosure_processed_cases.json');
  
  if (!fs.existsSync(processedFile)) {
    console.error('❌ Arquivo de cases processados não encontrado');
    return [];
  }

  const data = JSON.parse(fs.readFileSync(processedFile, 'utf8'));
  const cases: CaseToResend[] = [];

  for (const [key, value] of Object.entries(data.processed)) {
    const caseData = value as any;
    if (caseData.processed_at && caseData.processed_at.startsWith(TODAY)) {
      const city = caseData.city;
      const caseNumber = caseData.caseNumber;
      const caseDir = path.join(BASE_DATA_DIR, city, 'cases', caseNumber);
      
      if (fs.existsSync(caseDir)) {
        cases.push({ caseNumber, city, caseDir });
      } else {
        console.warn(`⚠️  Case ${caseNumber} não tem diretório: ${caseDir}`);
      }
    }
  }

  return cases;
}

async function resendCase(caseInfo: CaseToResend): Promise<boolean> {
  const { caseNumber, city, caseDir } = caseInfo;
  
  console.log(`\n📤 Reenviando case: ${caseNumber} (${city})`);
  
  // Verificar arquivos necessários
  const metadataPath = path.join(caseDir, 'metadata.json');
  const pdfPath = path.join(caseDir, `${caseNumber}_COMPLAINT.pdf`);
  const txtPath = path.join(caseDir, 'complaint_pdf.txt');
  
  if (!fs.existsSync(metadataPath)) {
    console.error(`  ❌ Metadata não encontrado: ${metadataPath}`);
    return false;
  }

  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  
  // Remover complaint_pdf_path do metadata
  if (metadata.complaint_pdf_path) {
    delete metadata.complaint_pdf_path;
  }

  // Verificar se tem PDF e extração
  const pdfExists = fs.existsSync(pdfPath);
  const txtExists = fs.existsSync(txtPath);
  
  if (!pdfExists) {
    console.warn(`  ⚠️  PDF não encontrado: ${pdfPath}`);
  }
  
  if (!txtExists) {
    console.warn(`  ⚠️  TXT não encontrado: ${txtPath}`);
  }

  // Ler conteúdo
  const pdfBase64 = pdfExists ? fs.readFileSync(pdfPath).toString('base64') : null;
  const txtContent = txtExists ? fs.readFileSync(txtPath, 'utf8') : '';

  // Montar payload
  const payload = {
    Categoria: 'Pre-Foreclosure',
    Status: 'Novo Case',
    Estado: 'MA',
    Cidade: city,
    'Case Number': caseNumber,
    Source: 'masscourts.org',
    'PDF Original': pdfBase64,
    'PDF TXT': txtContent,
    Metadata: metadata
  };

  try {
    console.log(`  📊 Enviando webhook para ${WEBHOOK_URL}...`);
    console.log(`  📄 PDF: ${pdfExists ? 'Sim' : 'Não'} | TXT: ${txtContent.length} chars`);
    
    const resp = await axios.post(WEBHOOK_URL, payload, { 
      timeout: 60000,
      maxContentLength: 50 * 1024 * 1024, // 50MB
      maxBodyLength: 50 * 1024 * 1024
    });
    
    console.log(`  ✅ Webhook enviado com sucesso! Status: ${resp.status}`);
    return true;
  } catch (e: any) {
    console.error(`  ❌ Erro ao enviar webhook:`, e.message);
    if (e.response) {
      console.error(`     Status: ${e.response.status}`);
      console.error(`     Data:`, JSON.stringify(e.response.data).substring(0, 200));
    }
    return false;
  }
}

async function main() {
  console.log('🚀 Iniciando reenvio de cases de hoje...\n');
  console.log(`📅 Data: ${TODAY}`);
  console.log(`🌐 Webhook: ${WEBHOOK_URL}\n`);
  
  const cases = await findCasesToResend();
  
  if (cases.length === 0) {
    console.log('❌ Nenhum case encontrado para reenviar');
    return;
  }

  console.log(`📋 Encontrados ${cases.length} cases para reenviar:\n`);
  cases.forEach((c, i) => {
    console.log(`   ${i + 1}. ${c.caseNumber} (${c.city})`);
  });

  console.log('\n' + '='.repeat(60) + '\n');

  let success = 0;
  let failed = 0;

  for (const caseInfo of cases) {
    const result = await resendCase(caseInfo);
    if (result) {
      success++;
    } else {
      failed++;
    }
    
    // Delay entre requests
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log('\n' + '='.repeat(60));
  console.log('\n📊 RESUMO:');
  console.log(`   ✅ Sucesso: ${success}`);
  console.log(`   ❌ Falhas: ${failed}`);
  console.log(`   📋 Total: ${cases.length}\n`);
}

// Executar
main().catch(console.error);
