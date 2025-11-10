// Scraper para Landmark Auction (Foreclosure) — conversão do landmark_scrape.js para TypeScript/Playwright
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { logger } from '../../utils/logger';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import { sha256String } from '../../utils/hash';
import processedStore from '../../lib/processed_store';
import LocationPathManager from '../../utils/location_manager';

interface ForeclosureRunOptions {
  stateFilter?: string;
  outputDir?: string;
  sendWebhook?: boolean;
  webhookUrl?: string;
  daysBack?: number;
  enableEnrichment?: boolean;
  forceReenrichment?: boolean;
  headless?: boolean;
}

interface ForeclosureListing {
  raw: string;
  property_address: string | null;
  property_street: string | null;
  property_city: string | null;
  property_state: string | null;
  property_zipcode: string | null;
  auction_date: string | null;
  auction_time_start: string | null;
  auction_time_end: string | null;
  status: string | null;
  continued_to: string | null;
  book_number: string | null;
  book_page: string | null;
  _state?: string | null;
  massproperty?: MassPropertyData | null;
}

interface MassPropertyData {
  raw: string;
  owner: string | null;
  owner_address: string | null;
  owner_address_street: string | null;
  owner_city: string | null;
  owner_state: string | null;
  owner_zipcode: string | null;
  building_value: string | null;
  land_value: string | null;
  other_value: string | null;
  total_value: string | null;
  last_sale_price: string | null;
  last_sale_date: string | null;
  year_built: string | null;
  lot_size: string | null;
  residential_area: string | null;
  building_style: string | null;
  units: string | null;
  number_of_rooms: string | null;
  parcel_id: string | null;
  location_id: string | null;
  [key: string]: any;
}

interface ParsedAddress {
  fullAddress: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

interface StructuredData {
  auction_date: string | null;
  auction_time_start: string | null;
  auction_time_end: string | null;
  status: string | null;
  continued_to: string | null;
  book_number: string | null;
  book_page: string | null;
}

export class ForeclosureRunner {
  browser: Browser | null = null;
  context: BrowserContext | null = null;
  private runOptions: ForeclosureRunOptions = {};
  private locationManager: LocationPathManager;
  baseDataDir: string;
  webhookCategory = 'Foreclosure';

  constructor(locationCode: string = 'MA') {
    this.locationManager = new LocationPathManager(locationCode);
    this.baseDataDir = this.locationManager.getDataDir('Foreclosure');
  }

  async init(options?: ForeclosureRunOptions) {
    // Store options if provided
    if (options) {
      this.runOptions = options;
    }
    
    const headless = this.runOptions.headless !== undefined ? this.runOptions.headless : (process.env.PLAYWRIGHT_HEADLESS === 'true');
    const userAgent = process.env.USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36';
    
    this.browser = await chromium.launch({
      headless,
      args: ['--start-maximized'],
    });
    
    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent,
      locale: 'en-US,en',
    });

    logger.info({ headless }, 'Playwright browser iniciado para Foreclosure (Landmark Auction)');
    
    // Initialize processed store
    try {
      const ppath = this.locationManager.getProcessedCasesPath('foreclosure');
      await processedStore.init(ppath);
      logger.info({ ppath }, 'Processed store inicializado para Foreclosure');
    } catch (e) {
      logger.warn({ e }, 'Falha inicializando processed store para Foreclosure');
    }
  }

  async close() {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    logger.info('Playwright browser fechado para Foreclosure');
  }

  async run(options: ForeclosureRunOptions = {}) {
    this.runOptions = options;
    
    // Ensure output directory exists
    if (!fs.existsSync(this.baseDataDir)) {
      fs.mkdirSync(this.baseDataDir, { recursive: true });
    }

    logger.info({ options }, 'Iniciando scraping de Foreclosure (Landmark Auction)');

    try {
      const listings = await this.scrape();
      logger.info({ count: listings.length }, 'Listings extraídas do Landmark Auction');

      // Apply state filter if provided
      let filteredListings = listings;
      const stateFilter = this.runOptions.stateFilter?.toUpperCase();
      if (stateFilter) {
        filteredListings = this.filterByState(listings, stateFilter);
        logger.info({ 
          filtered: filteredListings.length, 
          total: listings.length, 
          state: stateFilter 
        }, 'Filtro de estado aplicado');
      }

      // Save to JSON
      await this.saveListing(filteredListings);

      // Enrichment if enabled
      if (this.runOptions.enableEnrichment) {
        logger.info('Iniciando enrichment com MassProperty...');
        const enrichedListings = await this.enrichListings(filteredListings);
        logger.info({ enriched: enrichedListings.length }, 'Enrichment concluído');
        
        // Webhooks already sent individually during enrichment
        
        return enrichedListings;
      } else {
        // Send to webhook without enrichment if configured
        if (this.runOptions.sendWebhook) {
          await this.sendListingsToWebhook(filteredListings);
        }
        
        return filteredListings;
      }

      logger.info({ final_count: filteredListings.length }, 'Scraping de Foreclosure concluído com sucesso');
    } catch (error) {
      logger.error({ error }, 'Erro durante scraping de Foreclosure');
      throw error;
    }
  }

  private async scrape(): Promise<ForeclosureListing[]> {
    if (!this.context) {
      throw new Error('Context não inicializado. Chame init() primeiro.');
    }

    const page = await this.context.newPage();

    try {
      // Navigate to Landmark Auction main page
      await page.goto('https://www.landmarkauction.biz/', { waitUntil: 'networkidle' });
      logger.info('Página do Landmark Auction carregada');

      // Wait for page to load dynamic content
      await page.waitForTimeout(2000);

      // Auto-scroll to trigger lazy loading
      await this.autoScroll(page);

      // Extract listings with multiple selectors (resilient approach)
      const listings = await page.$$eval(
        'div.auction-listing, li.listing, .property-card, .listing-item, article, .auction-item, .listing-card, .property-listing, .search-result',
        (nodes) => {
          return nodes.map((n) => {
            const text = n.textContent || '';
            const get = (sel: string) => {
              const el = n.querySelector(sel);
              return el ? (el.textContent || '').trim() : null;
            };

            // Extract common fields
            const property_address = get('.address') || get('.property-address') || get('h3') || null;
            const auction_date = get('.date') || get('.auction-date') || null;
            const time = get('.time') || get('.auction-time') || null;
            const status = get('.status') || get('.badge') || null;

            return {
              raw: text,
              property_address,
              auction_date,
              auction_time: time,
              status,
            };
          });
        }
      );

      logger.info({ raw_listings: listings.length }, 'Listings brutas extraídas');

      // Deduplicate by property_address
      const deduped = this.dedupeByKey(listings, 'property_address');
      logger.info({ deduped_count: deduped.length }, 'Deduplicação concluída');

      // Extract address from raw if property_address is missing
      for (const item of deduped) {
        if (!item.property_address && item.raw) {
          const addr = this.extractAddressFromRaw(item.raw);
          if (addr) {
            item.property_address = addr.full || addr.line || null;
            item._state = addr.state || null;
          }
        } else if (item.property_address) {
          const m = String(item.property_address).match(/,\s*([A-Z]{2})\b/);
          if (m) item._state = m[1];
        }
      }

      // Parse structured fields from raw
      for (const item of deduped) {
        const parsed = this.parseStructured(item.raw || '');
        item.auction_date = parsed.auction_date;
        item.auction_time_start = parsed.auction_time_start;
        item.auction_time_end = parsed.auction_time_end;
        item.status = parsed.status || item.status;
        item.continued_to = parsed.continued_to;
        if (parsed.book_number) item.book_number = parsed.book_number;
        if (parsed.book_page) item.book_page = parsed.book_page;
      }

      // Normalize property address into components
      for (const item of deduped) {
        const addrSource = item.property_address || (item.raw || '');
        const parsedAddr = this.parsePropertyAddress(String(addrSource));
        item.property_address = parsedAddr.fullAddress || item.property_address || null;
        item.property_street = parsedAddr.street || null;
        item.property_city = parsedAddr.city || null;
        item.property_state = parsedAddr.state || item._state || null;
        item.property_zipcode = parsedAddr.zip || null;
        if (!item._state && parsedAddr.state) item._state = parsedAddr.state;
      }

      // Filter out invalid addresses (too long raw text, no street number, etc)
      const validListings = deduped.filter(item => {
        const addr = item.property_address || '';
        // Skip if address is actually raw text (too long)
        if (addr.length > 200) return false;
        // Skip if contains common raw text markers
        if (/Google Calendar|ICS|Likes|Share|Map View/i.test(addr)) return false;
        // Must have a street number at the beginning
        if (!/^\d+/.test(addr)) return false;
        return true;
      });

      logger.info({ valid: validListings.length, filtered_out: deduped.length - validListings.length }, 'Validação de endereços aplicada');

      await page.close();
      return validListings as ForeclosureListing[];
    } catch (error) {
      logger.error({ error }, 'Erro durante extração de listings');
      await page.close();
      throw error;
    }
  }

  private async autoScroll(page: Page): Promise<void> {
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        let total = 0;
        const distance = 500;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          total += distance;
          if (total >= scrollHeight - window.innerHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 200);
        // Fallback timeout
        setTimeout(() => {
          clearInterval(timer);
          resolve();
        }, 5000);
      });
    });
  }

  private dedupeByKey(items: any[], key: string): any[] {
    const seen = new Map<string, any>();
    for (const item of items) {
      const val = item[key];
      if (val && !seen.has(val)) {
        seen.set(val, item);
      } else if (!val) {
        // If key is null/empty, keep item but don't use for deduplication
        const uniqueKey = `__null_${seen.size}`;
        seen.set(uniqueKey, item);
      }
    }
    return Array.from(seen.values());
  }

  private extractAddressFromRaw(raw: string): { full: string | null; state: string | null; line: string | null } | null {
    if (!raw) return null;
    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);

    // Prefer lines that contain ", XX <zip>" pattern
    for (const l of lines) {
      const m = l.match(/(.+?,\s*[^,]+,\s*([A-Z]{2})\s*\d{5})/i);
      if (m) return { full: m[1].trim(), state: (m[2] || '').toUpperCase(), line: l };
    }

    // Fallback: look for ", MA" anywhere
    const joined = lines.join(' ');
    const m2 = joined.match(/([0-9]+\s+[^,]+?,\s*[^,]+?,\s*(MA|NH|RI|VT|CT|ME|NY|PA)\b(?:\s*\d{5})?)/i);
    if (m2) return { full: m2[1].trim(), state: (m2[2] || '').toUpperCase(), line: m2[1] };

    // Last resort: find " , XX" token
    const m3 = joined.match(/,\s*([A-Z]{2})\b/i);
    if (m3) return { full: null, state: (m3[1] || '').toUpperCase(), line: joined };

    return null;
  }

  private parseStructured(raw: string): StructuredData {
    const out: StructuredData = {
      auction_date: null,
      auction_time_start: null,
      auction_time_end: null,
      status: null,
      continued_to: null,
      book_number: null,
      book_page: null,
    };

    if (!raw) return out;

    // Normalize spaces including non-breaking
    const txt = raw.replace(/\u00A0|\u202F/g, ' ').replace(/\r/g, '\n');
    const lines = txt.split('\n').map((l) => l.trim()).filter(Boolean);

    // Find a line that looks like a long date (e.g., Wednesday, October 15, 2025)
    for (const l of lines) {
      if (/\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/i.test(l) && /\d{4}/.test(l)) {
        out.auction_date = l;
        break;
      }
    }

    // Times: look for patterns like "2:00 PM  3:00 PM" or "1:00 PM  2:00 PM"
    for (const l of lines) {
      const m = l.match(/(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm))\s*[-–—]?\s*(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm))/i);
      if (m) {
        out.auction_time_start = m[1];
        out.auction_time_end = m[2];
        break;
      }
    }

    // Status: look for keywords
    const reversedLines = [...lines].reverse();
    for (const l of reversedLines) {
      if (/CANCELED|CANCELLED/i.test(l)) {
        out.status = 'CANCELED';
        break;
      }
      if (/Currently going forward/i.test(l)) {
        out.status = 'Currently going forward';
        break;
      }
      if (/Continued to/i.test(l)) {
        const match = l.match(/Continued to\s*(.+)/i);
        out.continued_to = match ? match[1] : null;
        out.status = out.status || 'Continued';
        break;
      }
    }

    // Book and Page
    const bookLine = lines.find((l) => /Book\s+\d+/i.test(l) && /Page\s+\d+/i.test(l));
    if (bookLine) {
      const mb = bookLine.match(/Book\s+(\d+)/i);
      const mp = bookLine.match(/Page\s+(\d+)/i);
      if (mb) out.book_number = mb[1];
      if (mp) out.book_page = mp[1];
    }

    return out;
  }

  private parsePropertyAddress(input: string): ParsedAddress {
    const out: ParsedAddress = { fullAddress: null, street: null, city: null, state: null, zip: null };
    if (!input) return out;

    // Collapse whitespace and newlines
    const s = input.replace(/\u00A0|\u202F/g, ' ').replace(/[\t\r]+/g, ' ').replace(/\s+/g, ' ').trim();

    // Try to extract zip
    const zipMatch = s.match(/(\d{5})(?:-\d{4})?\b/);
    if (zipMatch) out.zip = zipMatch[1];

    // Try to find state (two uppercase letters) before zip
    const stateMatch = s.match(/\b([A-Z]{2})\b/);
    if (stateMatch) out.state = stateMatch[1];

    // If there's a clear comma-separated address like "street, city, ST ZIP"
    const parts = s.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 3) {
      // Typical: [street, city, 'ST ZIP']
      out.street = parts.slice(0, parts.length - 2).join(', ');
      out.city = parts[parts.length - 2];
      const last = parts[parts.length - 1];
      const st = last.match(/([A-Z]{2})/);
      const zp = last.match(/(\d{5})(?:-\d{4})?/);
      if (st) out.state = st[1];
      if (zp) out.zip = zp[1];
      out.fullAddress = parts.join(', ');
    } else if (parts.length === 2) {
      // e.g. [street, 'City ST ZIP'] or [street, 'City']
      out.street = parts[0];
      const second = parts[1];
      const m = second.match(/(.+?)\s+([A-Z]{2})\s*(\d{5})?/);
      if (m) {
        out.city = m[1].trim();
        out.state = m[2];
        if (m[3]) out.zip = m[3];
      } else {
        out.city = second;
      }
      out.fullAddress = parts.join(', ');
    } else {
      // Fallback: try to find street, city, state, zip in a single line
      const m = s.match(/^(.*?),?\s*([A-Za-z\s\(\)]+),?\s*([A-Z]{2})\s*(\d{5})?/);
      if (m) {
        out.street = m[1].trim();
        out.city = m[2].trim();
        out.state = m[3];
        if (m[4]) out.zip = m[4];
        out.fullAddress = s;
      } else {
        out.fullAddress = s;
      }
    }

    // Cleanup: remove parentheses around city, e.g. "Hyannis (Barnstable)"
    if (out.city) out.city = out.city.replace(/[\(\)]/g, '').trim();

    return out;
  }

  private filterByState(listings: ForeclosureListing[], state: string): ForeclosureListing[] {
    return listings.filter((item) => {
      const s = (item._state || '').toUpperCase();
      if (s) return s === state;
      // Fallback: check raw text for ", XX" pattern
      return new RegExp(',\\s*' + state + '\\b', 'i').test(item.raw || '');
    });
  }

  private async saveListing(listings: ForeclosureListing[]): Promise<void> {
    const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
    const filename = `landmark_list_${timestamp}.json`;
    const filepath = path.join(this.baseDataDir, filename);

    fs.writeFileSync(filepath, JSON.stringify(listings, null, 2), 'utf8');
    logger.info({ filepath, count: listings.length }, 'Listings salvas em arquivo JSON');
  }

  private async sendListingsToWebhook(listings: ForeclosureListing[]): Promise<void> {
    for (const [index, listing] of listings.entries()) {
      await this.sendIndividualWebhook(listing, index + 1, listings.length);
    }
  }

  private buildWebhookPayload(listing: ForeclosureListing): any {
    const now = new Date().toISOString();
    const sanitized = this.sanitizeFileName(listing.property_address || 'unknown');
    const id = `landmark_${sanitized}_${Date.now()}`;

    return {
      id,
      source: {
        system: 'Landmarkauction',
        scraped_from: 'https://www.landmarkauction.biz/',
        retrieved_at: now,
        version: 'v1',
      },
      category: this.webhookCategory,
      foreclosure: {
        raw: listing.raw || null,
        property_address: listing.property_address || null,
        property_street: listing.property_street || null,
        property_city: listing.property_city || null,
        property_state: listing.property_state || null,
        property_zipcode: listing.property_zipcode || null,
        auction_date: listing.auction_date || null,
        auction_time_start: listing.auction_time_start || null,
        auction_time_end: listing.auction_time_end || null,
        status: listing.status || null,
        continued_to: listing.continued_to || null,
        book_number: listing.book_number || null,
        book_page: listing.book_page || null,
      },
      metadata: {
        created_at: now,
        crawler: 'foreclosure_runner.ts',
      },
    };
  }

  private sanitizeFileName(s: string): string {
    return String(s).replace(/[^a-z0-9-_\.]/gi, '_').slice(0, 200);
  }

  private normalizeStreetForSearch(street: string): string {
    // Remove common noise from street addresses
    let normalized = street;
    
    // Remove "a/k/a" and everything after it
    normalized = normalized.replace(/\s+a\/k\/a\s+.*/i, '');
    
    // Remove "Unit XYZ" patterns
    normalized = normalized.replace(/,?\s+Unit\s+[A-Z0-9]+.*$/i, '');
    
    // Remove condo/condominium references
    normalized = normalized.replace(/,?\s+of\s+the\s+.*?Condominium.*$/i, '');
    
    // Clean up extra spaces
    normalized = normalized.replace(/\s+/g, ' ').trim();
    
    return normalized;
  }

  // ==================== ENRICHMENT METHODS ====================

  private async enrichListings(listings: ForeclosureListing[]): Promise<ForeclosureListing[]> {
    const enriched: ForeclosureListing[] = [];
    
    for (const [index, listing] of listings.entries()) {
      try {
        const address = listing.property_address || 'UNKNOWN';
        const normalized = processedStore.normalizeKey(address);
        const wasProcessed = await processedStore.isProcessed(normalized);
        
        let enrichedListing: ForeclosureListing;
        
        if (!wasProcessed || this.runOptions.forceReenrichment) {
          // New case OR force re-enrichment - perform enrichment
          const enrichmentReason = !wasProcessed ? 'novo' : 'forçado (re-enriquecimento)';
          logger.info({ 
            index: index + 1, 
            total: listings.length, 
            address, 
            isNew: !wasProcessed,
            forceReenrich: this.runOptions.forceReenrichment,
            reason: enrichmentReason
          }, `Enriquecendo listing ${enrichmentReason}...`);
          
          enrichedListing = await this.enrichOne(listing);
          
          // Save enriched individual file
          const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
          const sanitized = this.sanitizeFileName(enrichedListing.property_address || `prop-${index}`);
          const filename = `enriched_${sanitized}_${timestamp}.json`;
          const filepath = path.join(this.baseDataDir, filename);
          fs.writeFileSync(filepath, JSON.stringify(enrichedListing, null, 2), 'utf8');
        } else {
          // Already processed case - skip enrichment
          logger.info({ index: index + 1, total: listings.length, address, isNew: false }, 'Listing já processado, pulando enriquecimento...');
          enrichedListing = listing;
        }
        
        enriched.push(enrichedListing);
        
        // Send webhook for all cases (new or update)
        if (this.runOptions.sendWebhook) {
          await this.sendIndividualWebhook(enrichedListing, index + 1, listings.length);
        }
        
        // Delay between requests using page
        const delayPage = await this.context.newPage();
        await delayPage.waitForTimeout(500);
        await delayPage.close();
      } catch (error) {
        logger.warn({ error, address: listing.property_address }, 'Falha ao enriquecer listing');
        enriched.push(listing); // Keep original if enrichment fails
        
        // Still try to send webhook even if enrichment failed
        if (this.runOptions.sendWebhook) {
          await this.sendIndividualWebhook(listing, index + 1, listings.length);
        }
      }
    }
    
    return enriched;
  }

  private async enrichOne(listing: ForeclosureListing): Promise<ForeclosureListing> {
    if (!this.context) {
      throw new Error('Context não inicializado');
    }

    const page = await this.context.newPage();

    try {
      // Navigate to MassPropertyInfo page
      await page.goto('https://arcgisserver.digital.mass.gov/ParcelAccessibility2/MassPropertyInfo.aspx', { 
        waitUntil: 'networkidle',
        timeout: 30000 
      });

      // Normalize address: remove a/k/a, Unit, Condo, etc
      let street = listing.property_street || '';
      const city = listing.property_city || '';
      const state = listing.property_state || '';
      const zip = listing.property_zipcode || '';

      // Clean street address
      street = this.normalizeStreetForSearch(street);

      await page.waitForTimeout(800);

      let result: MassPropertyData | null = null;

      // Extract number(s) and street name
      const numberMatch = street.match(/^(\d+)(?:\s*[-–—]\s*(\d+))?/);
      const numbers: string[] = [];
      
      if (numberMatch) {
        numbers.push(numberMatch[1]); // First number
        if (numberMatch[2]) {
          // Range detected (e.g., "22-26")
          numbers.push(numberMatch[2]); // Second number
          // Add middle number if range is small
          const first = parseInt(numberMatch[1]);
          const second = parseInt(numberMatch[2]);
          if (second - first <= 10 && second - first > 0) {
            const middle = Math.floor((first + second) / 2);
            if (middle > first && middle < second) {
              numbers.splice(1, 0, middle.toString()); // Insert middle
            }
          }
        }
      }

      const streetName = street.replace(/^\s*\d+(?:\s*[-–—]\s*\d+)?\s*/, '');

      // Try each number until we get results
      for (let attempt = 0; attempt < numbers.length && !result?.owner; attempt++) {
        const number = numbers[attempt];
        logger.debug({ attempt: attempt + 1, total: numbers.length, number, streetName }, 'Tentando busca com número');
        
        // Reload page for fresh search
        if (attempt > 0) {
          await page.goto('https://arcgisserver.digital.mass.gov/ParcelAccessibility2/MassPropertyInfo.aspx', { waitUntil: 'networkidle', timeout: 30000 });
          await page.waitForTimeout(800);
        }

        try {
          // Try select-based flow
          const cityIdx = await this.findSelectIndex(page, ['Select a city', 'Select a city/town', 'Select a city/town:']);
          const streetIdx = await this.findSelectIndex(page, ['Select a street', 'Select a street name']);
          const numberIdx = await this.findSelectIndex(page, ['Select an address number', 'Select an address']);

          const cityIndexFinal = (cityIdx !== null) ? cityIdx : 0;
          const streetIndexFinal = (streetIdx !== null) ? streetIdx : 1;
          const numberIndexFinal = (numberIdx !== null) ? numberIdx : 2;

          let cityOk = false, streetOk = false, numberOk = false;

          if (city) {
            cityOk = await this.setSelectOption(page, cityIndexFinal, city);
            if (cityOk) await page.waitForTimeout(900);
          }

          if (streetName && cityOk) {
            streetOk = await this.setSelectOption(page, streetIndexFinal, streetName);
            if (streetOk) await page.waitForTimeout(900);
          }

          if (number && streetOk) {
            numberOk = await this.setSelectOption(page, numberIndexFinal, number);
            if (numberOk) await page.waitForTimeout(600);
          }

          // Check if button is enabled before clicking
          const getInfoBtn = page.locator("input[value='Get Information']:not([disabled])").first();
          const isEnabled = await getInfoBtn.isVisible().catch(() => false);
          
          if (isEnabled) {
            await getInfoBtn.click({ timeout: 5000 });
            await page.waitForTimeout(900);
            
            // Extract results
            result = await this.extractMassProperty(page);
            if (result?.owner) {
              logger.debug({ number, owner: result.owner }, 'Enrichment bem-sucedido');
              break;
            }
          } else {
            logger.debug({ number }, 'Botão Get Information desabilitado, tentando próximo número');
          }
        } catch (e) {
          logger.debug({ error: e, number }, 'Falha na tentativa de busca');
        }
      }

      // Fallback: free-text search if no results yet
      if (!result?.owner) {
        try {
          logger.debug('Tentando fallback com busca por texto livre');
          await page.goto('https://arcgisserver.digital.mass.gov/ParcelAccessibility2/MassPropertyInfo.aspx', { waitUntil: 'networkidle', timeout: 30000 });
          await page.waitForTimeout(800);
          
          const full = [street, city, state, zip].filter(Boolean).join(' ');
          const textInput = await page.locator('input[type="text"], input[type="search"]').first();
          if (await textInput.isVisible().catch(() => false)) {
            await textInput.click({ clickCount: 3 });
            await textInput.fill(full);
            await textInput.press('Enter');
            await page.waitForTimeout(1200);
            
            result = await this.extractMassProperty(page);
          }
        } catch (e) {
          logger.debug({ error: e }, 'Fallback por texto livre falhou');
        }
      }

      // Fallback: try just city and street name (no number)
      if (!result?.owner && streetName && city) {
        try {
          logger.debug({ streetName, city }, 'Tentando busca por cidade e rua sem número');
          await page.goto('https://arcgisserver.digital.mass.gov/ParcelAccessibility2/MassPropertyInfo.aspx', { waitUntil: 'networkidle', timeout: 30000 });
          await page.waitForTimeout(800);
          
          const cityIdx = await this.findSelectIndex(page, ['Select a city', 'Select a city/town', 'Select a city/town:']);
          const streetIdx = await this.findSelectIndex(page, ['Select a street', 'Select a street name']);
          
          const cityIndexFinal = (cityIdx !== null) ? cityIdx : 0;
          const streetIndexFinal = (streetIdx !== null) ? streetIdx : 1;
          
          if (city) {
            const cityOk = await this.setSelectOption(page, cityIndexFinal, city);
            if (cityOk) {
              await page.waitForTimeout(900);
              const streetOk = await this.setSelectOption(page, streetIndexFinal, streetName);
              if (streetOk) {
                await page.waitForTimeout(900);
                // Get first option from number select if available
                const firstNum = await page.evaluate((idx) => {
                  const sels = Array.from(document.querySelectorAll('select'));
                  const sel = sels[idx];
                  if (sel && sel.options && sel.options.length > 1) {
                    return sel.options[1].value || sel.options[1].text;
                  }
                  return null;
                }, 2).catch(() => null);
                
                if (firstNum) {
                  await this.setSelectOption(page, 2, firstNum);
                  const getInfoBtn = page.locator("input[value='Get Information']:not([disabled])").first();
                  if (await getInfoBtn.isVisible().catch(() => false)) {
                    await getInfoBtn.click({ timeout: 5000 });
                    await page.waitForTimeout(900);
                    result = await this.extractMassProperty(page);
                  }
                }
              }
            }
          }
        } catch (e) {
          logger.debug({ error: e }, 'Fallback por semelhança falhou');
        }
      }

      // Post-process owner_address into components
      if (result && result.owner_address) {
        const lines = result.owner_address.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        if (lines.length >= 1) {
          result.owner_address_street = lines.slice(0, lines.length - 1).join(' ');
        }
        if (lines.length >= 2) {
          const last = lines[lines.length - 1];
          const m = last.match(/^(.*?),\s*([A-Z]{2})[,\s]+(\d{5})(?:-\d+)?$/);
          if (m) {
            result.owner_city = m[1].trim();
            result.owner_state = m[2].trim();
            result.owner_zipcode = m[3].trim();
          } else {
            const m2 = last.match(/^(.*?),\s*([A-Z]{2}),\s*(\d{5})$/);
            if (m2) {
              result.owner_city = m2[1].trim();
              result.owner_state = m2[2].trim();
              result.owner_zipcode = m2[3].trim();
            } else {
              result.owner_city = last;
            }
          }
        }
      }

      await page.close();
      
      return {
        ...listing,
        massproperty: result || undefined
      };
    } catch (error) {
      logger.error({ error, address: listing.property_address }, 'Erro durante enrichment');
      await page.close();
      return listing;
    }
  }

  private async findSelectIndex(page: Page, labelCandidates: string[]): Promise<number | null> {
    return await page.evaluate((labels) => {
      const u = (s: any) => (s || '').toString().trim().toUpperCase();
      const tryFind = (lbl: string) => {
        const labelsEls = Array.from(document.querySelectorAll('label'));
        for (const L of labelsEls) {
          if (u(L.innerText).includes(u(lbl))) {
            const forId = L.getAttribute('for');
            if (forId) {
              const sel = document.getElementById(forId);
              if (sel && sel.tagName === 'SELECT') return sel;
            }
            let s = L.nextElementSibling;
            while (s && s.tagName !== 'SELECT') s = s.nextElementSibling;
            if (s && s.tagName === 'SELECT') return s;
          }
        }
        return null;
      };
      for (const lbl of labels) {
        const sel = tryFind(lbl);
        if (sel) {
          const all = Array.from(document.querySelectorAll('select'));
          return all.indexOf(sel as HTMLSelectElement);
        }
      }
      return null;
    }, labelCandidates).catch(() => null);
  }

  private async setSelectOption(page: Page, selectIndex: number, matchText: string): Promise<boolean> {
    if (selectIndex === null || typeof selectIndex === 'undefined') return false;
    const ok = await page.evaluate(([idx, txt]) => {
      const u = (s: any) => (s || '').toString().trim().toUpperCase();
      const sels: any = Array.from(document.querySelectorAll('select'));
      const sel = sels[idx];
      if (!sel) return false;
      const opts: any = Array.from(sel.options || []);
      if (!opts.length) return false;
      let opt: any = opts.find((o: any) => u(o.text) === u(txt) || u(o.value) === u(txt));
      if (!opt) opt = opts.find((o: any) => u(o.text).includes(u(txt)) || u(o.value).includes(u(txt)));
      if (!opt) {
        const tnum = (txt || '').toString().trim().toUpperCase();
        opt = opts.find((o: any) => (u(o.text).replace(/[^0-9]/g, '') === tnum.replace(/[^0-9]/g, '')) || (u(o.value).replace(/[^0-9]/g, '') === tnum.replace(/[^0-9]/g, '')));
      }
      if (opt) {
        sel.value = opt.value;
        sel.selectedIndex = Array.from(sel.options).indexOf(opt);
        sel.dispatchEvent(new Event('input', { bubbles: true }));
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        try { sel.focus(); sel.click(); } catch (e) { }
        return true;
      }
      return false;
    }, [selectIndex, matchText]).catch(() => false) as boolean;
    if (ok) await page.waitForTimeout(700);
    return ok;
  }

  private async setNumberSelect(page: Page, num: string): Promise<boolean> {
    const ok = await page.evaluate((n) => {
      const u = (s: any) => (s || '').toString().trim().toUpperCase();
      const txt = String(n).trim().toUpperCase();
      const selects = Array.from(document.querySelectorAll('select'));
      for (const sel of selects) {
        const opts = Array.from(sel.options || []);
        let opt = opts.find(o => u(o.text) === txt || u(o.value) === txt);
        if (!opt) opt = opts.find(o => u(o.text).includes(txt) || u(o.value).includes(txt));
        if (opt) {
          try {
            sel.focus();
            sel.value = opt.value;
            sel.selectedIndex = Array.from(sel.options).indexOf(opt);
            sel.dispatchEvent(new Event('input', { bubbles: true }));
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            try { sel.click(); } catch (e) { }
            return true;
          } catch (e) { }
        }
      }
      return false;
    }, num).catch(() => false);
    if (ok) await page.waitForTimeout(600);
    return ok;
  }

  private async waitForNumberOption(page: Page, num: string, timeout = 3000): Promise<boolean> {
    const start = Date.now();
    const txt = String(num).trim().toUpperCase();
    while (Date.now() - start < timeout) {
      const found = await page.evaluate((t) => {
        const selects = Array.from(document.querySelectorAll('select'));
        const sel = selects[2] || null;
        if (!sel) return false;
        return Array.from(sel.options || []).some(o => (o.text || '').toString().trim().toUpperCase() === t || (o.value || '').toString().trim().toUpperCase() === t || (o.text || '').toString().trim().toUpperCase().includes(t));
      }, txt).catch(() => false);
      if (found) return true;
      await page.waitForTimeout(300);
    }
    return false;
  }

  private async clickGetInfo(page: Page): Promise<void> {
    try {
      const btn = await page.locator("input[value='Get Information'], button:has-text('Get Information')").first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click();
        await page.waitForTimeout(600);
      }
    } catch (e) {
      logger.debug({ error: e }, 'Failed to click Get Information button');
    }
  }

  private async extractMassProperty(page: Page): Promise<MassPropertyData> {
    await page.waitForTimeout(800);
    await page.waitForSelector('table', { timeout: 7000 }).catch(() => {});
    
    const res = await page.evaluate(() => {
      const out: any = { raw: '' };
      const tables = Array.from(document.querySelectorAll('table'));
      let tbl = tables.find(t => /Owner\s*[:]?/i.test(t.innerText || '')) || tables[0];
      if (!tbl) {
        out.raw = document.body.innerText || '';
        return out;
      }
      out.raw = tbl.innerText || '';
      const rows = Array.from(tbl.querySelectorAll('tr'));
      for (const r of rows) {
        const cols = Array.from(r.querySelectorAll('td, th')).map(c => (c.textContent || '').trim());
        if (cols.length >= 2) {
          const label = cols[0].replace(/[:\s]+$/, '').trim();
          const value = cols[1].trim();
          const key = label.toLowerCase();
          if (/owner(?!.*\baddress)/i.test(key)) out.owner = value;
          else if (/owner address|mailing address/i.test(key)) out.owner_address = value;
          else if (/building value|building/i.test(key)) out.building_value = value;
          else if (/land value|land/i.test(key)) out.land_value = value;
          else if (/other value/i.test(key)) out.other_value = value;
          else if (/total value|assessed/i.test(key)) out.total_value = value;
          else if (/last sale price|sale price/i.test(key)) out.last_sale_price = value;
          else if (/last sale date|sale date/i.test(key)) out.last_sale_date = value;
          else if (/year built|year constructed/i.test(key)) out.year_built = value;
          else if (/lot size/i.test(key)) out.lot_size = value;
          else if (/residential area|total living area|area/i.test(key)) out.residential_area = value;
          else if (/building style/i.test(key)) out.building_style = value;
          else if (/number of units|units/i.test(key)) out.units = value;
          else if (/number of rooms|rooms/i.test(key)) out.number_of_rooms = value;
          else if (/property id|parcel id|map\/parcel/i.test(key)) out.parcel_id = value;
          else if (/location id/i.test(key)) out.location_id = value;
          else {
            out[label] = value;
          }
        }
      }
      return out;
    });
    
    return res as MassPropertyData;
  }

  private async sendEnrichedToWebhook(listings: ForeclosureListing[]): Promise<void> {
    const webhookUrl = this.runOptions.webhookUrl || process.env.WEBHOOK_URL || 'https://n8n.arthuragrelli.com/webhook/scraping';

    for (const [index, listing] of listings.entries()) {
      await this.sendIndividualWebhook(listing, index + 1, listings.length);
    }
  }

  private async sendIndividualWebhook(listing: ForeclosureListing, index: number, total: number): Promise<void> {
    const webhookUrl = this.runOptions.webhookUrl || process.env.WEBHOOK_URL || 'https://n8n.arthuragrelli.com/webhook/scraping';
    
    try {
      const address = listing.property_address || 'UNKNOWN';
      const normalized = processedStore.normalizeKey(address);
      
      // Calculate content hash for change detection
      const contentKey = JSON.stringify({
        auction_date: listing.auction_date,
        auction_time_start: listing.auction_time_start,
        auction_time_end: listing.auction_time_end,
        status: listing.status,
        continued_to: listing.continued_to,
        owner: listing.massproperty?.owner,
        total_value: listing.massproperty?.total_value,
        assessed_value: listing.massproperty?.assessed_value,
        city: listing.massproperty?.city
      });
      const contentHash = sha256String(contentKey);
      
      // Check if this address was already processed
      const wasProcessed = await processedStore.isProcessed(normalized);
      const existingData = processedStore.data[normalized];
      const lastHash = existingData?.source || ''; // Usando 'source' para armazenar hash
      
      let sendType: 'new' | 'update' = 'new';
      
      if (wasProcessed) {
        if (lastHash === contentHash) {
          // No changes, but still send as update
          sendType = 'update';
          logger.debug({ address }, 'Listing sem mudanças, enviando como update');
        } else {
          // Content changed, send update
          sendType = 'update';
        }
      }
      
      const payload = this.buildStandardWebhookPayload(listing, sendType);
      const resp = await axios.post(webhookUrl, payload, { timeout: 30000 });
      
      // Mark as processed with hash in 'source' field
      await processedStore.markProcessed(normalized, {
        processed_at: new Date().toISOString(),
        caseNumber: address,
        city: listing.property_city || listing.massproperty?.city || 'Unknown',
        source: contentHash // Armazenando hash aqui
      });
      
      logger.info({
        index,
        total,
        property: address,
        sendType,
        status: resp.status
      }, 'Webhook enviado para listing');
    } catch (error) {
      logger.warn({
        error,
        property: listing.property_address
      }, 'Falha ao enviar webhook para listing');
    }
  }

  private buildStandardWebhookPayload(listing: ForeclosureListing, sendType: 'new' | 'update'): any {
    const city = listing.property_city || listing.massproperty?.city || 'Unknown';
    const address = listing.property_address || 'UNKNOWN';
    
    // Build base payload (sempre inclui)
    const payload: any = {
      Categoria: this.webhookCategory,
      Status: sendType === 'new' ? 'Novo Case' : 'Update Case',
      Estado: listing.property_state || 'MA',
      Cidade: city,
      'Case Number': address, // Usando endereço como identificador único
    };
    
    // Build metadata com dados básicos do foreclosure
    const metadata: any = {
      property_address: listing.property_address,
      property_street: listing.property_street,
      property_city: listing.property_city,
      property_state: listing.property_state,
      property_zipcode: listing.property_zipcode,
      auction_date: listing.auction_date,
      auction_time_start: listing.auction_time_start,
      auction_time_end: listing.auction_time_end,
      status: listing.status,
      continued_to: listing.continued_to,
      book_number: listing.book_number,
      book_page: listing.book_page,
    };
    
    // Para NOVO case, incluir dados de enriquecimento (como o PDF Base64 dos outros)
    if (sendType === 'new' && listing.massproperty) {
      payload['Enrichment Data'] = {
        owner: listing.massproperty.owner,
        owner_address: listing.massproperty.owner_address,
        owner_address_street: listing.massproperty.owner_address_street,
        owner_city: listing.massproperty.owner_city,
        owner_state: listing.massproperty.owner_state,
        owner_zipcode: listing.massproperty.owner_zipcode,
        building_value: listing.massproperty.building_value,
        land_value: listing.massproperty.land_value,
        other_value: listing.massproperty.other_value,
        total_value: listing.massproperty.total_value,
        assessed_value: listing.massproperty.assessed_value,
        last_sale_price: listing.massproperty.last_sale_price,
        last_sale_date: listing.massproperty.last_sale_date,
        year_built: listing.massproperty.year_built,
        lot_size: listing.massproperty.lot_size,
        residential_area: listing.massproperty.residential_area,
        building_style: listing.massproperty.building_style,
        units: listing.massproperty.units,
        number_of_rooms: listing.massproperty.number_of_rooms,
        parcel_id: listing.massproperty.parcel_id,
        location_id: listing.massproperty.location_id,
        city: listing.massproperty.city,
        street: listing.massproperty.street,
        street_number: listing.massproperty.street_number,
      };
    }
    
    payload.Metadata = metadata;
    
    return payload;
  }

  private buildEnrichedWebhookPayload(listing: ForeclosureListing): any {
    const now = new Date().toISOString();
    const sanitized = this.sanitizeFileName(listing.property_address || 'unknown');
    const id = `landmark_${sanitized}_${Date.now()}`;

    return {
      id,
      source: {
        system: 'Landmarkauction_ArcGIS',
        scraped_from: 'https://www.landmarkauction.biz/',
        enriched_from: 'https://arcgisserver.digital.mass.gov/ParcelAccessibility2/MassPropertyInfo.aspx',
        retrieved_at: now,
        version: 'v1',
      },
      category: this.webhookCategory,
      foreclosure: {
        raw: listing.raw || null,
        property_address: listing.property_address || null,
        property_street: listing.property_street || null,
        property_city: listing.property_city || null,
        property_state: listing.property_state || null,
        property_zipcode: listing.property_zipcode || null,
        auction_date: listing.auction_date || null,
        auction_time_start: listing.auction_time_start || null,
        auction_time_end: listing.auction_time_end || null,
        status: listing.status || null,
        continued_to: listing.continued_to || null,
        book_number: listing.book_number || null,
        book_page: listing.book_page || null,
      },
      details: {
        owner: listing.massproperty?.owner || null,
        owner_address: listing.massproperty?.owner_address || null,
        owner_address_street: listing.massproperty?.owner_address_street || null,
        owner_city: listing.massproperty?.owner_city || null,
        owner_state: listing.massproperty?.owner_state || null,
        owner_zipcode: listing.massproperty?.owner_zipcode || null,
        building_value: listing.massproperty?.building_value || null,
        land_value: listing.massproperty?.land_value || null,
        other_value: listing.massproperty?.other_value || null,
        total_value: listing.massproperty?.total_value || null,
        last_sale_price: listing.massproperty?.last_sale_price || null,
        last_sale_date: listing.massproperty?.last_sale_date || null,
        year_built: listing.massproperty?.year_built || null,
        lot_size: listing.massproperty?.lot_size || null,
        residential_area: listing.massproperty?.residential_area || null,
        building_style: listing.massproperty?.building_style || null,
        number_of_units: listing.massproperty?.units || null,
        number_of_rooms: listing.massproperty?.number_of_rooms || null,
        property_id: listing.massproperty?.parcel_id || null,
        location_id: listing.massproperty?.location_id || null,
        massproperty_raw: listing.massproperty?.raw || null,
      },
      metadata: {
        created_at: now,
        crawler: 'foreclosure_runner.ts',
        enricher: 'foreclosure_runner.ts',
      },
    };
  }
}
