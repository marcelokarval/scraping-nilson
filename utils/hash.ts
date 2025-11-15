import fs from 'fs';
import crypto from 'crypto';

export function sha256File(filePath: string) {
  try {
    const buf = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buf).digest('hex');
  } catch (e) {
    return '';
  }
}

export function sha256String(s: string) {
  return crypto.createHash('sha256').update(String(s || '')).digest('hex');
}

export default { sha256File, sha256String };
