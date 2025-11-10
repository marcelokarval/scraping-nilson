import fs from 'fs';
import path from 'path';

type Entry = { processed_at: string; caseNumber: string; city?: string; source?: string };

class ProcessedStore {
  filePath: string | null = null;
  data: Record<string, Entry> = {};
  initialized = false;

  normalizeKey(s: string) {
    if (!s) return '';
    return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  async init(filePath: string) {
    this.filePath = filePath;
    try {
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    } catch (e) {}
    try {
      if (fs.existsSync(filePath)) {
        const raw = await fs.promises.readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw || '{}');
        this.data = (parsed && parsed.processed) ? parsed.processed : {};
      } else {
        this.data = {};
        await this.flush();
      }
    } catch (e) {
      // try to recover by backing up
      try { const bak = filePath + '.bak'; if (fs.existsSync(filePath)) await fs.promises.copyFile(filePath, bak); } catch (e) {}
      this.data = {};
      await this.flush();
    }
    this.initialized = true;
  }

  async flush() {
    if (!this.filePath) throw new Error('ProcessedStore not initialized');
    const tmp = this.filePath + '.tmp';
    const payload = { processed: this.data };
    await fs.promises.writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8');
    await fs.promises.rename(tmp, this.filePath);
  }

  async isProcessed(key: string) {
    const k = this.normalizeKey(key);
    return !!this.data[k];
  }

  async markProcessed(key: string, entry: Entry) {
    const k = this.normalizeKey(key);
    this.data[k] = Object.assign({ processed_at: new Date().toISOString() }, entry);
    await this.flush();
  }

  async loadAll() {
    return this.data;
  }
}

const store = new ProcessedStore();
export default store;
export { Entry };
