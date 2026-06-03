export type GrantType = 'RSU' | 'ISO' | 'NSO' | 'ESPP' | 'RestrictedShares' | 'PerformanceShares';
export type VestingFrequency = 'Monthly' | 'Quarterly' | 'Annual' | 'Custom';
export type VestingStatus = 'active' | 'fully_vested' | 'cancelled' | 'expired';
export type ConfidenceLevel = 'high' | 'medium' | 'low';

/** Israeli Section 102 tax route chosen at grant time */
export type TaxRoute =
  | '102b2'     // Capital gains route: 24-month trustee lock-up, all at 25% CGT
  | '102b1'     // Regular income route: income tax at vest + 25% CGT on appreciation
  | 'us'        // US ordinary income at vest + LTCG/STCG on appreciation
  | 'other';

export interface SourceReference {
  file: string;
  page?: number;
  snippet: string;
}

export interface ExtractedField<T> {
  value: T;
  confidence: number; // 0–100
  sources: SourceReference[];
}

export interface VestingEvent {
  date: string;
  shares: number;
  vested: boolean;
}

/**
 * A single vest-lot: shares that vested on a specific date at a specific price.
 * Required for accurate per-lot CGT calculation.
 */
export interface VestLot {
  id: string;
  grantId: string;            // parent GrantRecord.id
  vestDate: string;           // ISO date
  grossShares: number;        // shares that vested
  withholdingShares: number;  // shares withheld for tax
  netShares: number;          // grossShares - withholdingShares (actually received)
  fmvAtVest: number;          // USD price at vest date (cost basis)
  usdilsAtVest?: number;      // USD/ILS rate at vest date
  incomeTaxPaid?: number;     // USD value of withheld shares (tax cost)
  source?: string;            // source document
}

/**
 * A share sale transaction — required for realized-gain tracking and
 * year-end tax offsetting.
 */
export interface SaleTransaction {
  id: string;
  date: string;               // ISO date
  ticker: string;
  grantId?: string;           // optional link to grant
  lotIds?: string[];          // vest lots being sold (for FIFO/LIFO/specific)
  sharesSold: number;
  salePrice: number;          // USD per share
  costBasis: number;          // USD per share (from vest lot)
  realizedGainUSD: number;    // (salePrice - costBasis) * sharesSold
  usdilsAtSale?: number;      // USD/ILS at sale date
  realizedGainNIS?: number;   // realizedGainUSD * usdilsAtSale
  taxPaidUSD?: number;        // estimated IL CGT
  notes?: string;
}

/** Configurable trading window for a company (quarterly open periods) */
export interface TradingWindow {
  id: string;
  label: string;              // e.g. "Q1 2026 open window"
  openDate: string;           // ISO date — window opens
  closeDate: string;          // ISO date — window closes
  notes?: string;
}

export interface GrantRecord {
  id: string;

  // Grant Details
  grantId?: ExtractedField<string>;
  grantType?: ExtractedField<GrantType>;
  companyName?: ExtractedField<string>;
  tickerSymbol?: ExtractedField<string>;
  grantDate?: ExtractedField<string>;
  vestingStartDate?: ExtractedField<string>;
  vestingEndDate?: ExtractedField<string>;
  totalShares?: ExtractedField<number>;
  strikePrice?: ExtractedField<number>;
  exercisePrice?: ExtractedField<number>;
  fairMarketValue?: ExtractedField<number>;

  // Vesting
  cliffDuration?: ExtractedField<number>; // months
  vestingFrequency?: ExtractedField<VestingFrequency>;
  vestingSchedule?: VestingEvent[];

  // Israeli Section 102 tax route (set manually in Settings or detected from doc)
  taxRoute?: TaxRoute;
  // 102(b)(2): trustee release date = grantDate + 24 months
  trusteeReleaseDate?: string; // ISO date, computed automatically for 102b2

  // Current Status
  vestedShares?: ExtractedField<number>;
  unvestedShares?: ExtractedField<number>;
  exercisedShares?: ExtractedField<number>;
  cancelledShares?: ExtractedField<number>;
  soldShares?: ExtractedField<number>;
  remainingShares?: ExtractedField<number>;
  // Withholding
  withholdingRate?: number;       // e.g. 0.46 for 46%
  netSharesAfterWithholding?: number; // explicitly known net shares

  // Financial
  currentMarketValue?: ExtractedField<number>;
  costBasis?: ExtractedField<number>;
  estimatedTaxBasis?: ExtractedField<number>;

  // Vest lots (per-lot cost basis)
  vestLots?: VestLot[];

  // Meta
  sourceFiles: string[];
  mergedFromIds?: string[];
  matchConfidence?: number;
  notes?: string;
}

export type DocumentStatus = 'pending' | 'processing' | 'completed' | 'error';

export interface DocumentRecord {
  id: string;
  filename: string;
  fileType: string;
  fileSize: number;
  uploadedAt: string;
  status: DocumentStatus;
  errorMessage?: string;
  extractedGrantCount: number;
  rawText?: string;
  pageCount?: number;
}

export interface ExtractionSession {
  id: string;
  createdAt: string;
  documentIds: string[];
  grantIds: string[];
  status: 'pending' | 'processing' | 'review' | 'imported' | 'error';
  errorMessage?: string;
}

export interface Portfolio {
  grants: GrantRecord[];
  documents: DocumentRecord[];
  sessions: ExtractionSession[];
  transactions: SaleTransaction[];
  tradingWindows: TradingWindow[];
  lastUpdated: string;
}

export interface ReviewField {
  grantId: string;
  fieldName: string;
  extractedValue: unknown;
  confidence: number;
  sources: SourceReference[];
  status: 'pending' | 'accepted' | 'rejected' | 'edited';
  editedValue?: unknown;
}

export interface AIInsight {
  id: string;
  type: 'info' | 'warning' | 'opportunity';
  title: string;
  description: string;
  metric?: string;
  generatedAt: string;
}

export type AppView =
  | 'dashboard'
  | 'upload'
  | 'review'
  | 'grants'
  | 'documents'
  | 'insights'
  | 'whatif'
  | 'transactions'
  | 'reminders'
  | 'analytics'
  | 'chart'
  | 'settings';
