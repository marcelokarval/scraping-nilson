#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const util = require('util');
const child = require('child_process');
const execFile = util.promisify(child.execFile);

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data', 'MA', 'Probate');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(function(file) {
    const full = path.join(dir, file);
    const stat = fs.statSync(full);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(full));
    } else {
      results.push(full);
    }
  });
  return results;
}

async function main() {
  if (!fs.existsSync(DATA_DIR)) {
    console.error('Data dir not found:', DATA_DIR);
    process.exit(1);
  }
  const allFiles = walk(DATA_DIR);
   const pdfs = allFiles.filter(f => f.endsWith('_FORMAL_PROBATE.pdf'));
  console.log(`Found ${pdfs.length} probate PDFs`);

  const needFix = [];
  for (const pdf of pdfs) {
    const dir = path.dirname(pdf);
    const fname = path.basename(pdf);
    const caseNumber = fname.split('_')[0];
  const jsonPath = path.join(dir, `${caseNumber}_formal_probate_extracted.json`);
    let need = false;
    if (!fs.existsSync(jsonPath)) need = true;
    else {
      try {
        const j = JSON.parse(fs.readFileSync(jsonPath,'utf8'));
        const txtlen = j.text_length !== undefined ? j.text_length : (j.full_text ? j.full_text.length : 0);
        if (!txtlen || txtlen < 20) need = true;
      } catch (e) { need = true; }
    }
    if (need) needFix.push({ pdf, dir, caseNumber, jsonPath });
  }
  console.log(`Need pdftotext fix for ${needFix.length} files`);
  for (const it of needFix) {
    console.log('Processing', it.caseNumber, it.pdf);
    try {
      // run pdftotext -layout pdf -
      const { stdout, stderr } = await execFile('pdftotext', ['-layout', it.pdf, '-'], { timeout: 60000, maxBuffer: 50*1024*1024 });
      const text = (stdout || '').trim();
      const txtPath = path.join(it.dir, 'formal_probate_pdf.txt');
      fs.writeFileSync(txtPath, text, 'utf8');
      // update json
      let data = { pdf_path: it.pdf, text_length: text.length, extraction_successful: text.length > 50, full_text: text };
      try {
         const old = fs.existsSync(it.jsonPath) ? JSON.parse(fs.readFileSync(it.jsonPath,'utf8')) : {};
        data = Object.assign(old, data);
      } catch {}
       fs.writeFileSync(it.jsonPath, JSON.stringify(data, null, 2), 'utf8');
       console.log(' Wrote', it.jsonPath, 'and', txtPath, 'len=', text.length);
    } catch (e) {
      console.error(' Failed pdftotext for', it.caseNumber, e.message || e);
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
