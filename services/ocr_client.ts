import fs from 'fs';
import { sha256String } from '../utils/hash';
import path from 'path';
import { promisify } from 'util';
import child from 'child_process';
const execFile = promisify(child.execFile);

const DEFAULT_LANG = process.env.OCR_LANG || 'eng';
const OCR_API_URL = process.env.OCR_API_URL;
const PDFTOTEXT_MIN_LENGTH = 200; // threshold to accept pdftotext output

async function extractPdfWithExternalAPI(filePath: string): Promise<any> {
  if (!OCR_API_URL) return null;
  
  try {
    const FormData = require('form-data');
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));
    form.append('lang', DEFAULT_LANG);
    
    const response = await fetch(OCR_API_URL, {
      method: 'POST',
      body: form,
      headers: form.getHeaders()
    });
    
    if (response.ok) {
      const result = await response.json();
      return result;
    }
  } catch (error) {
    console.warn('External OCR API failed:', error);
  }
  return null;
}

export async function extractPdf(filePath: string) {
  // 0) Try external OCR API first if configured
  if (OCR_API_URL) {
    const externalResult = await extractPdfWithExternalAPI(filePath);
    if (externalResult?.text) {
      const txt = externalResult.text;
      const data = { extraction_successful: true, text_length: txt.length, full_text: txt, source: 'external_api' };
      return { data, jsonHash: sha256String(JSON.stringify(data)), textHash: sha256String(txt), extractedText: txt };
    }
  }
  // 1) try pdftotext -layout
  try {
    const { stdout } = await execFile('pdftotext', ['-layout', filePath, '-'], { timeout: 60_000 });
    const txt = String(stdout || '').replace(/\r/g, '\n');
    if (txt && txt.length >= PDFTOTEXT_MIN_LENGTH) {
      const data = { extraction_successful: true, text_length: txt.length, full_text: txt };
      return { data, jsonHash: sha256String(JSON.stringify(data)), textHash: sha256String(txt), extractedText: txt };
    }
  } catch (e) {
    // pdftotext may fail or not be present; continue to image OCR
    // console.warn('pdftotext failed:', e && e.message ? e.message : e);
  }

  // 2) fallback to Tesseract: convert PDF pages to PNG and OCR each page
  const workDir = path.join(path.dirname(filePath), '.ocr_temp_' + path.basename(filePath).replace(/[^a-z0-9]/gi,'_'));
  try {
    fs.mkdirSync(workDir, { recursive: true });
    // pdftoppm -> PNG files
    try {
      await execFile('pdftoppm', ['-png', filePath, path.join(workDir, 'page')], { timeout: 60_000 });
    } catch (e) {
      // pdftoppm may fail; try pdftocairo
      try { await execFile('pdftocairo', ['-png', filePath, path.join(workDir, 'page')], { timeout: 60_000 }); } catch (e2) {}
    }
    const imgs = fs.readdirSync(workDir).filter(f => f.toLowerCase().endsWith('.png')).sort();
    let full = '';
    for (const img of imgs) {
      const imgPath = path.join(workDir, img);
      // preprocessing with ImageMagick (deskew, grayscale, resize) - optional
      const proc = path.join(workDir, 'proc_' + img);
      try {
        await execFile('convert', [imgPath, '-deskew', '40%', '-colorspace', 'Gray', '-resize', '200%', proc], { timeout: 30000 });
      } catch (e) {
        // fallback to original image
        fs.copyFileSync(imgPath, proc);
      }
      try {
        const { stdout } = await execFile('tesseract', [proc, 'stdout', '-l', DEFAULT_LANG, '--psm', '1'], { timeout: 120000, maxBuffer: 50 * 1024 * 1024 });
        full += String(stdout || '') + '\n\n';
      } catch (e) {
        // try different psm
        try { const { stdout } = await execFile('tesseract', [proc, 'stdout', '-l', DEFAULT_LANG, '--psm', '3'], { timeout: 120000 }); full += String(stdout || '') + '\n\n'; } catch (e2) {}
      }
    }
    const txt = full.trim();
    const data = { extraction_successful: !!txt, text_length: txt.length, full_text: txt };
    return { data, jsonHash: sha256String(JSON.stringify(data)), textHash: sha256String(txt), extractedText: txt };
  } finally {
    // cleanup temp? keep for debugging
    // try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
  }
}

export async function ensureExtractAndSave(pdfPath: string, outJson: string, outTxt: string) {
  const res = await extractPdf(pdfPath);
  try { fs.writeFileSync(outJson, JSON.stringify(res.data, null, 2), 'utf8'); } catch(e){}
  try { fs.writeFileSync(outTxt, String(res.extractedText || ''), 'utf8'); } catch(e){}
  return { data: res.data, jsonHash: sha256String(JSON.stringify(res.data || {})), textHash: sha256String(String(res.extractedText || '')), extractedText: res.extractedText };
}

export default { extractPdf, ensureExtractAndSave };
