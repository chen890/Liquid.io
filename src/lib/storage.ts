import { openDB } from 'idb';
import type { IDBPDatabase } from 'idb';
import type { Portfolio, GrantRecord, DocumentRecord, ExtractionSession, SaleTransaction, TradingWindow } from '../types';

const DB_NAME    = 'equity-dashboard';
const DB_VERSION = 2;   // bumped for new stores

let db: IDBPDatabase | null = null;

async function getDB(): Promise<IDBPDatabase> {
  if (db) return db;
  db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(database, oldVersion) {
      // v1 stores
      if (!database.objectStoreNames.contains('grants'))    database.createObjectStore('grants',    { keyPath: 'id' });
      if (!database.objectStoreNames.contains('documents')) database.createObjectStore('documents', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('sessions'))  database.createObjectStore('sessions',  { keyPath: 'id' });
      if (!database.objectStoreNames.contains('settings'))  database.createObjectStore('settings');
      // v2 stores
      if (oldVersion < 2) {
        if (!database.objectStoreNames.contains('transactions'))   database.createObjectStore('transactions',   { keyPath: 'id' });
        if (!database.objectStoreNames.contains('tradingWindows')) database.createObjectStore('tradingWindows', { keyPath: 'id' });
      }
    },
  });
  return db;
}

// ── Grants ────────────────────────────────────────────────────────────────────
export async function saveGrant(grant: GrantRecord): Promise<void>    { (await getDB()).put('grants', grant); }
export async function getGrants(): Promise<GrantRecord[]>             { return (await getDB()).getAll('grants'); }
export async function deleteGrant(id: string): Promise<void>          { (await getDB()).delete('grants', id); }

// ── Documents ─────────────────────────────────────────────────────────────────
export async function saveDocument(doc: DocumentRecord): Promise<void> { (await getDB()).put('documents', doc); }
export async function getDocuments(): Promise<DocumentRecord[]>        { return (await getDB()).getAll('documents'); }
export async function deleteDocument(id: string): Promise<void>        { (await getDB()).delete('documents', id); }

// ── Sessions ──────────────────────────────────────────────────────────────────
export async function saveSession(session: ExtractionSession): Promise<void> { (await getDB()).put('sessions', session); }
export async function getSessions(): Promise<ExtractionSession[]>            { return (await getDB()).getAll('sessions'); }

// ── Transactions ──────────────────────────────────────────────────────────────
export async function saveTransaction(tx: SaleTransaction): Promise<void>  { (await getDB()).put('transactions', tx); }
export async function getTransactions(): Promise<SaleTransaction[]>         { return (await getDB()).getAll('transactions'); }
export async function deleteTransaction(id: string): Promise<void>          { (await getDB()).delete('transactions', id); }

// ── Trading Windows ───────────────────────────────────────────────────────────
export async function saveTradingWindow(w: TradingWindow): Promise<void>   { (await getDB()).put('tradingWindows', w); }
export async function getTradingWindows(): Promise<TradingWindow[]>         { return (await getDB()).getAll('tradingWindows'); }
export async function deleteTradingWindow(id: string): Promise<void>        { (await getDB()).delete('tradingWindows', id); }

// ── Settings ──────────────────────────────────────────────────────────────────
export async function saveSetting(key: string, value: unknown): Promise<void> { (await getDB()).put('settings', value, key); }
export async function getSetting<T>(key: string): Promise<T | undefined>       { return (await getDB()).get('settings', key); }

// ── Portfolio ─────────────────────────────────────────────────────────────────
export async function loadPortfolio(): Promise<Portfolio> {
  const [grants, documents, sessions, transactions, tradingWindows] = await Promise.all([
    getGrants(), getDocuments(), getSessions(), getTransactions(), getTradingWindows(),
  ]);
  return { grants, documents, sessions, transactions, tradingWindows, lastUpdated: new Date().toISOString() };
}

export async function clearAllData(): Promise<void> {
  const database = await getDB();
  await Promise.all([
    database.clear('grants'),
    database.clear('documents'),
    database.clear('sessions'),
    database.clear('transactions'),
    database.clear('tradingWindows'),
  ]);
}
