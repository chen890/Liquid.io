import { create } from 'zustand';
import type { Portfolio, GrantRecord, DocumentRecord, ExtractionSession, SaleTransaction, TradingWindow, AppView } from '../types';
import * as storage from '../lib/storage';
import { deduplicateAgainstPortfolio } from '../lib/ai/reconciler';

interface PortfolioState {
  portfolio: Portfolio;
  currentView: AppView;
  pendingGrants: GrantRecord[];
  pendingSession: ExtractionSession | null;
  isLoading: boolean;
  isProcessing: boolean;
  processingLog: string[];

  // Actions
  loadPortfolio: () => Promise<void>;
  setView: (view: AppView) => void;
  addDocuments: (docs: DocumentRecord[]) => Promise<void>;
  updateDocument: (doc: DocumentRecord) => Promise<void>;
  setPendingGrants: (grants: GrantRecord[]) => void;
  setPendingSession: (session: ExtractionSession | null) => void;
  importPendingGrants: () => Promise<void>;
  deleteGrant: (id: string) => Promise<void>;
  updateGrant: (grant: GrantRecord) => Promise<void>;
  deleteDocument: (id: string) => Promise<void>;
  // Transactions
  addTransaction: (tx: SaleTransaction) => Promise<void>;
  deleteTransaction: (id: string) => Promise<void>;
  // Trading windows
  addTradingWindow: (w: TradingWindow) => Promise<void>;
  deleteTradingWindow: (id: string) => Promise<void>;
  // Logs
  addProcessingLog: (msg: string) => void;
  clearProcessingLog: () => void;
  setProcessing: (v: boolean) => void;
  clearAllData: () => Promise<void>;
}

const emptyPortfolio: Portfolio = {
  grants: [],
  documents: [],
  sessions: [],
  transactions: [],
  tradingWindows: [],
  lastUpdated: new Date().toISOString(),
};

export const usePortfolioStore = create<PortfolioState>((set, get) => ({
  portfolio: emptyPortfolio,
  currentView: 'dashboard',
  pendingGrants: [],
  pendingSession: null,
  isLoading: true,
  isProcessing: false,
  processingLog: [],

  loadPortfolio: async () => {
    set({ isLoading: true });
    const portfolio = await storage.loadPortfolio();
    set({ portfolio, isLoading: false });
  },

  setView: (view) => set({ currentView: view }),

  addDocuments: async (docs) => {
    for (const doc of docs) await storage.saveDocument(doc);
    const documents = await storage.getDocuments();
    set((state) => ({ portfolio: { ...state.portfolio, documents } }));
  },

  updateDocument: async (doc) => {
    await storage.saveDocument(doc);
    set((state) => ({
      portfolio: {
        ...state.portfolio,
        documents: state.portfolio.documents.map((d) => (d.id === doc.id ? doc : d)),
      },
    }));
  },

  setPendingGrants: (grants) => set({ pendingGrants: grants }),
  setPendingSession: (session) => set({ pendingSession: session }),

  importPendingGrants: async () => {
    const { pendingGrants, pendingSession } = get();
    const existingGrants = await storage.getGrants();
    const { toAdd, toUpdate } = deduplicateAgainstPortfolio(pendingGrants, existingGrants);

    for (const grant of toAdd)    await storage.saveGrant(grant);
    for (const grant of toUpdate) await storage.saveGrant(grant);

    if (pendingSession) {
      const updatedSession: ExtractionSession = {
        ...pendingSession,
        status: 'imported',
        grantIds: [...toAdd.map((g) => g.id), ...toUpdate.map((g) => g.id)],
      };
      await storage.saveSession(updatedSession);
    }

    const [grants, sessions] = await Promise.all([storage.getGrants(), storage.getSessions()]);
    set((state) => ({
      portfolio: { ...state.portfolio, grants, sessions },
      pendingGrants: [],
      pendingSession: null,
    }));
  },

  deleteGrant: async (id) => {
    await storage.deleteGrant(id);
    set((state) => ({
      portfolio: { ...state.portfolio, grants: state.portfolio.grants.filter((g) => g.id !== id) },
    }));
  },

  updateGrant: async (grant) => {
    await storage.saveGrant(grant);
    set((state) => ({
      portfolio: { ...state.portfolio, grants: state.portfolio.grants.map((g) => (g.id === grant.id ? grant : g)) },
    }));
  },

  deleteDocument: async (id) => {
    await storage.deleteDocument(id);
    set((state) => ({
      portfolio: { ...state.portfolio, documents: state.portfolio.documents.filter((d) => d.id !== id) },
    }));
  },

  addTransaction: async (tx) => {
    await storage.saveTransaction(tx);
    const transactions = await storage.getTransactions();
    set((state) => ({ portfolio: { ...state.portfolio, transactions } }));
  },

  deleteTransaction: async (id) => {
    await storage.deleteTransaction(id);
    set((state) => ({
      portfolio: { ...state.portfolio, transactions: state.portfolio.transactions.filter((t) => t.id !== id) },
    }));
  },

  addTradingWindow: async (w) => {
    await storage.saveTradingWindow(w);
    const tradingWindows = await storage.getTradingWindows();
    set((state) => ({ portfolio: { ...state.portfolio, tradingWindows } }));
  },

  deleteTradingWindow: async (id) => {
    await storage.deleteTradingWindow(id);
    set((state) => ({
      portfolio: { ...state.portfolio, tradingWindows: state.portfolio.tradingWindows.filter((w) => w.id !== id) },
    }));
  },

  addProcessingLog: (msg) =>
    set((state) => ({ processingLog: [...state.processingLog, msg] })),

  clearProcessingLog: () => set({ processingLog: [] }),
  setProcessing: (v) => set({ isProcessing: v }),

  clearAllData: async () => {
    await storage.clearAllData();
    set({ portfolio: { ...emptyPortfolio, lastUpdated: new Date().toISOString() } });
  },
}));
