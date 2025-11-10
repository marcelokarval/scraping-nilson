#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

async function main() {
  const cookiePath = path.join(process.cwd(), 'config', 'session_cookies.json');
  if (!fs.existsSync(cookiePath)) {
    console.error('Cookie file not found:', cookiePath);
    process.exit(1);
  }
  const raw = fs.readFileSync(cookiePath, 'utf8');
  const cookies = JSON.parse(raw);
  const userDataDir = path.join(process.cwd(), 'playwright_user_data');
  console.log('Using userDataDir:', userDataDir);
  const headless = true;
  const context = await chromium.launchPersistentContext(userDataDir, { headless });
  try {
    // map fields
    const toAdd = cookies.map(c => {
      const out = {
        name: c.name,
        value: String(c.value || ''),
        domain: c.domain,
        path: c.path || '/',
      };
      if (c.expirationDate) out.expires = Math.floor(Number(c.expirationDate));
      if (typeof c.httpOnly === 'boolean') out.httpOnly = c.httpOnly;
      if (typeof c.secure === 'boolean') out.secure = c.secure;
      if (c.sameSite && (c.sameSite === 'Strict' || c.sameSite === 'Lax' || c.sameSite === 'None')) out.sameSite = c.sameSite;
      return out;
    });
    await context.addCookies(toAdd);
    console.log('Added', toAdd.length, 'cookies to context.');
    // save storage state for verification
    const statePath = path.join(process.cwd(), 'playwright_state_after_cookie_inject.json');
    await context.storageState({ path: statePath });
    console.log('Saved storageState to', statePath);
  } catch (e) {
    console.error('Error injecting cookies:', e);
  } finally {
    try { await context.close(); } catch (e) {}
  }
}

main().catch(err => { console.error(err); process.exit(1); });
