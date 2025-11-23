/**
 * Script para reenviar webhooks de casos específicos com erro
 * 
 * Uso: npx tsx scripts/resend_failed_webhooks.ts
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';

// === CONFIGURAÇÃO ===
const WEBHOOK_URL = 'https://n8n.arthuragrelli.com/webhook/scraping';
const PROCESSED_STORE_PATH = path.join(process.cwd(), 'data', 'PA', 'foreclosure_processed_cases.json');

// Casos com erro para reenviar (atualizar esta lista conforme necessário)
const FAILED_CASES = [
  'MG-25-000978',  // Request failed with status code 500
  'MG-25-000926'   // read ECONNRESET
];

interface ProcessedStore {
  processed: Record<string, {
    caseNumber: string;
    webhook_sent: boolean;
    webhook_error?: string;
    webhook_sent_at?: string;
    webhook_error_at?: string;
    pdf_downloaded: boolean;
    case_detail_exists: boolean;
    last_updated: string;
  }>;
}

async function resendFailedWebhooks() {
  console.log('\n=== REENVIANDO WEBHOOKS COM ERRO ===\n');
  console.log(`Total de casos para reenviar: ${FAILED_CASES.length}`);
  console.log('');

  // Carregar processed store
  if (!fs.existsSync(PROCESSED_STORE_PATH)) {
    console.error('❌ Processed store não encontrado:', PROCESSED_STORE_PATH);
    process.exit(1);
  }

  const processedStore: ProcessedStore = JSON.parse(
    fs.readFileSync(PROCESSED_STORE_PATH, 'utf8')
  );

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < FAILED_CASES.length; i++) {
    const caseNumber = FAILED_CASES[i];
    console.log(`[${i + 1}/${FAILED_CASES.length}] Processando: ${caseNumber}`);

    const caseDir = path.join(
      process.cwd(),
      'data',
      'PA',
      'Foreclosure',
      'cases',
      caseNumber
    );

    if (!fs.existsSync(caseDir)) {
      console.log(`  ⚠ Diretório não encontrado: ${caseDir}`);
      errorCount++;
      continue;
    }

    // Caminhos dos arquivos
    const detailPath = path.join(caseDir, 'case_detail.json');
    const pdfPath = path.join(caseDir, `${caseNumber}_complaint.pdf`);
    const txtPath = path.join(caseDir, `${caseNumber}_extracted.txt`);
    const enrichmentPath = path.join(caseDir, 'property_enrichment.json');

    // Verificar arquivos necessários
    if (!fs.existsSync(detailPath)) {
      console.log(`  ⚠ case_detail.json não encontrado`);
      errorCount++;
      continue;
    }

    const caseDetail = JSON.parse(fs.readFileSync(detailPath, 'utf8'));

    // Extrair cidade do case detail
    const extractCity = (detail: any): string => {
      if (!detail.litigants || detail.litigants.length === 0) return '';
      for (const litigant of detail.litigants) {
        if (litigant.address && litigant.address.city) {
          return litigant.address.city;
        }
      }
      return '';
    };

    // Construir payload (IGUAL ao código de produção)
    const payload: any = {
      Categoria: 'Foreclosure',
      Status: 'Novo Case',
      Estado: 'PA',
      Cidade: extractCity(caseDetail),
      'Case Number': caseNumber,
      Source: 'alleghenycounty.us'
    };

    // PDF Original (base64) - com limite de tamanho
    if (fs.existsSync(pdfPath)) {
      const pdfSizeKB = fs.statSync(pdfPath).size / 1024;
      const pdfSizeMB = pdfSizeKB / 1024;
      const base64SizeMB = pdfSizeMB * 1.37; // Base64 aumenta ~37%
      
      // Limite: 30 MB original (41 MB em base64)
      if (pdfSizeMB <= 30) {
        const pdfBase64 = fs.readFileSync(pdfPath).toString('base64');
        payload['PDF Original'] = pdfBase64;
        console.log(`  ✓ PDF carregado: ${pdfSizeKB.toFixed(0)} KB (${pdfSizeMB.toFixed(2)} MB)`);
      } else {
        console.log(`  ⚠ PDF muito grande: ${pdfSizeMB.toFixed(2)} MB (base64: ~${base64SizeMB.toFixed(2)} MB)`);
        console.log(`  → Pulando PDF para evitar erro 500 do servidor`);
        console.log(`  → Enviando apenas TXT + Enrichment`);
        payload['PDF Original'] = null;
        payload['PDF_TOO_LARGE'] = true;
        payload['PDF_SIZE_MB'] = parseFloat(pdfSizeMB.toFixed(2));
      }
    } else {
      console.log(`  ⚠ PDF não encontrado`);
    }

    // PDF TXT (sempre incluir)
    const txtContent = fs.existsSync(txtPath) ? fs.readFileSync(txtPath, 'utf8') : '';
    payload['PDF TXT'] = txtContent;
    console.log(`  ✓ TXT carregado: ${txtContent.length} caracteres`);

    // Metadata (igual ao código de produção)
    payload.Metadata = {
      case_number: caseDetail.caseNumber,
      case_description: caseDetail.caseDescription,
      filing_date: caseDetail.filingDate,
      case_type: caseDetail.caseType,
      current_status: caseDetail.currentStatus,
      judge: caseDetail.judge,
      amount_in_dispute: caseDetail.amountInDispute,
      litigants: caseDetail.litigants,
      attorneys: caseDetail.attorneys,
      docket_entries_count: caseDetail.docketEntries?.length || 0,
      complaint_url: caseDetail.complaintUrl
    };

    // Enrichment Data (apenas se existir e válido)
    if (fs.existsSync(enrichmentPath)) {
      const enrichment = JSON.parse(fs.readFileSync(enrichmentPath, 'utf8'));
      if (enrichment.enrichment_data && !enrichment.error && enrichment.match_score > 0) {
        payload['Enrichment Data'] = enrichment.enrichment_data;
        console.log(`  ✓ Enrichment carregado: ${enrichment.match_score}% match`);
      }
    }

    // Enviar webhook
    try {
      const response = await axios.post(WEBHOOK_URL, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000
      });

      if (response.status === 200) {
        console.log(`  ✓ Webhook enviado com sucesso: ${response.status}`);
        
        // Atualizar processed store
        const entry = processedStore.processed[caseNumber];
        if (entry) {
          entry.webhook_sent = true;
          entry.webhook_sent_at = new Date().toISOString();
          delete entry.webhook_error;
          delete entry.webhook_error_at;
          entry.last_updated = new Date().toISOString();
        }
        
        successCount++;
      } else {
        console.log(`  ⚠ Status inesperado: ${response.status}`);
        errorCount++;
      }
    } catch (error: any) {
      console.log(`  ✗ Erro ao enviar: ${error.message}`);
      errorCount++;
    }

    // Delay entre envios
    if (i < FAILED_CASES.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    console.log('');
  }

  // Salvar processed store atualizado
  fs.writeFileSync(
    PROCESSED_STORE_PATH,
    JSON.stringify(processedStore, null, 2),
    'utf8'
  );

  console.log('=== RESUMO ===');
  console.log(`✓ Enviados com sucesso: ${successCount}`);
  console.log(`✗ Erros: ${errorCount}`);
  console.log('');
}

resendFailedWebhooks().catch(err => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
