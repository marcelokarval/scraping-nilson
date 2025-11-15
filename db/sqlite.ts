// Minimal sqlite stub for testing the scraper flow.
let CASE_ID_COUNTER = 1;
let FILE_ID_COUNTER = 1;

export function upsertCaseRecord(caseNumber: string, division: string, filingDate?: any, caseStatus?: any) {
  return CASE_ID_COUNTER++;
}

export function insertFileRecord(caseId: number | null, type_: string, filename: string, hash: string, size: number, path_: string) {
  return FILE_ID_COUNTER++;
}

export function insertExtractRecord(caseId: number, fileId: number, jsonHash: string, textHash: string, textLength: number, extra: any) {
  return true;
}

export function insertEvent(caseId: number | null, eventType: string, payload: string) {
  // noop
}

export function getCaseByNumber(caseNumber: string, division: string) {
  return null;
}

export function setLastSent(caseId: number, hash: string, sendType: string) {
  return true;
}

export function getLastSentHash(caseId: number) { return null; }

export default { upsertCaseRecord, insertFileRecord, insertExtractRecord, insertEvent, getCaseByNumber, setLastSent, getLastSentHash };
// (kept single implementation above)
