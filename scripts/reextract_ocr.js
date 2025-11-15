#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const util = require('util');
const child = require('child_process');
const execFile = util.promisify(child.execFile);

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data', 'MA', 'Probate');
const PY_EXTRACTOR_CANDIDATES = [
  path.join(ROOT, '..', '..', 'src', 'utils', 'pdf_extractor_foreclosure.py'), // if playwright_service inside project
  path.join(ROOT, '..', 'src', 'utils', 'pdf_extractor_foreclosure.py'),
  path.join(ROOT, '..', '..', '..', 'src', 'utils', 'pdf_extractor_foreclosure.py'),
  path.join(process.cwd(), '..', 'src', 'utils', 'pdf_extractor_foreclosure.py'),
];

function findExtractor() {
  for (const p of PY_EXTRACTOR_CANDIDATES) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

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
  const extractor = findExtractor();
  console.log('Using python extractor:', extractor || '(none found)');
  if (!fs.existsSync(DATA_DIR)) {
    console.error('Data dir not found:', DATA_DIR);
    process.exit(1);
  }

  const allFiles = walk(DATA_DIR);
  const pdfs = allFiles.filter(f => f.endsWith('_FORMAL_PROBATE.pdf'));
  console.log(`Found ${pdfs.length} probate PDFs`);

  const problemCases = [];
  for (const pdf of pdfs) {
    const dir = path.dirname(pdf);
    // Determine case number from filename
    const fname = path.basename(pdf);
    const caseNumber = fname.split('_')[0];
  const jsonPath = path.join(dir, `${caseNumber}_formal_probate_extracted.json`);
  const txtPath = path.join(dir, `formal_probate_pdf.txt`);
    let needs = false;
    if (!fs.existsSync(jsonPath)) {
      needs = true;
    } else {
      try {
        const j = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        if (!j || (j.text_length === undefined ? (j.full_text ? j.full_text.length : 0) : j.text_length) < 20) needs = true;
      } catch (e) { needs = true; }
    }
    if (!fs.existsSync(txtPath)) needs = true;
    if (needs) problemCases.push({ caseNumber, pdf, jsonPath, txtPath });
  }

  console.log(`Cases needing re-extraction: ${problemCases.length}`);
  for (const p of problemCases) {
    console.log('-', p.caseNumber, p.pdf);
  }

  if (problemCases.length === 0) return;

  const doFix = process.argv.includes('--fix');
  if (!doFix) {
    console.log('\nRun this script with --fix to re-run the Python extractor on these PDFs.');
    return;
  }

  if (!extractor) {
    console.error('No python extractor found on candidates. Aborting fix.');
    process.exit(1);
  }

  for (const p of problemCases) {
    console.log('\nProcessing', p.caseNumber, p.pdf);
    try {
      const python = process.env.PYTHON_BIN || 'python3';
      const { stdout, stderr } = await execFile(python, [extractor, p.pdf], { timeout: 120000, maxBuffer: 20 * 1024 * 1024 });
      if (stderr) console.error('python stderr:', stderr.substring(0,400));
      const s = stdout.trim();
      const first = s.search(/\{|\[/);
      if (first === -1) throw new Error('No JSON output from python extractor');
      const jsonPart = s.slice(first);
      const data = JSON.parse(jsonPart);
      // write json
      fs.writeFileSync(p.jsonPath, JSON.stringify(data, null, 2), 'utf8');
      // write txt
      const text = data.full_text || data.text || '';
      fs.writeFileSync(p.txtPath, String(text || ''), 'utf8');
      console.log(' Wrote', p.jsonPath, 'and', p.txtPath);
    } catch (e) {
      console.error(' Failed to extract for', p.caseNumber, e.message || e);
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
