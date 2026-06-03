import { useState, useMemo } from 'react';
import { CheckCircle, XCircle, Edit2, ChevronDown, ChevronRight, AlertTriangle, Info, FileText, RefreshCw, Plus } from 'lucide-react';
import type { GrantRecord, ExtractedField, SourceReference } from '../../types';
import { usePortfolioStore } from '../../store/portfolioStore';
import { deduplicateAgainstPortfolio } from '../../lib/ai/reconciler';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { ConfidenceBadge } from '../ui/ConfidenceBadge';
import { Card } from '../ui/Card';

const FIELD_LABELS: Record<string, string> = {
  grantId: 'Grant ID',
  grantType: 'Grant Type',
  companyName: 'Company',
  tickerSymbol: 'Ticker',
  grantDate: 'Grant Date',
  vestingStartDate: 'Vesting Start',
  vestingEndDate: 'Vesting End',
  totalShares: 'Total Shares',
  strikePrice: 'Strike Price',
  exercisePrice: 'Exercise Price',
  fairMarketValue: 'FMV',
  cliffDuration: 'Cliff (months)',
  vestingFrequency: 'Vesting Frequency',
  vestedShares: 'Vested Shares',
  unvestedShares: 'Unvested Shares',
  exercisedShares: 'Exercised Shares',
  cancelledShares: 'Cancelled Shares',
  soldShares: 'Sold Shares',
  remainingShares: 'Remaining Shares',
  currentMarketValue: 'Market Value',
  costBasis: 'Cost Basis',
  estimatedTaxBasis: 'Est. Tax Basis',
};

type FieldStatus = 'accepted' | 'rejected' | 'edited' | 'pending';

interface FieldState {
  status: FieldStatus;
  editedValue?: string;
}

function SourcePopover({ sources }: { sources: SourceReference[] }) {
  const [open, setOpen] = useState(false);
  if (sources.length === 0) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-slate-600 hover:text-blue-400 transition-colors"
        title="View source"
      >
        <FileText className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div
          className="absolute z-50 right-0 top-6 w-72 bg-slate-900 border border-slate-700 rounded-xl p-3 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-xs font-medium text-slate-400 mb-2">Source References</div>
          <div className="space-y-2">
            {sources.map((s, i) => (
              <div key={i} className="bg-slate-800 rounded-lg p-2">
                <div className="text-xs font-medium text-slate-300 mb-1">
                  {s.file}{s.page ? ` · Page ${s.page}` : ''}
                </div>
                {s.snippet && (
                  <div className="text-xs text-slate-500 italic line-clamp-3">"{s.snippet}"</div>
                )}
              </div>
            ))}
          </div>
          <button onClick={() => setOpen(false)} className="mt-2 text-xs text-slate-600 hover:text-slate-400">
            Close
          </button>
        </div>
      )}
    </div>
  );
}

function GrantReviewCard({
  grant,
  index,
}: {
  grant: GrantRecord;
  index: number;
}) {
  const [expanded, setExpanded] = useState(index === 0);
  const [fieldStates, setFieldStates] = useState<Record<string, FieldState>>({});
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const fields = Object.entries(FIELD_LABELS)
    .map(([key, label]) => {
      const f = grant[key as keyof GrantRecord] as ExtractedField<unknown> | undefined;
      if (!f) return null;
      return { key, label, field: f };
    })
    .filter(Boolean) as { key: string; label: string; field: ExtractedField<unknown> }[];

  const lowConfidenceCount = fields.filter((f) => f.field.confidence < 70).length;
  const medConfidenceCount = fields.filter((f) => f.field.confidence >= 70 && f.field.confidence < 95).length;

  const setFieldStatus = (key: string, status: FieldStatus, val?: string) => {
    setFieldStates((prev) => ({ ...prev, [key]: { status, editedValue: val } }));
  };

  const startEdit = (key: string, currentVal: unknown) => {
    setEditingField(key);
    setEditValue(String(currentVal));
  };

  const saveEdit = (key: string) => {
    setFieldStatus(key, 'edited', editValue);
    setEditingField(null);
  };

  const displayValue = (key: string, val: unknown): string => {
    const state = fieldStates[key];
    if (state?.status === 'edited' && state.editedValue !== undefined) return state.editedValue;
    if (typeof val === 'number') return val.toLocaleString();
    if (typeof val === 'string') return val;
    return String(val);
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-800/50 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex-1 flex items-center gap-2.5 text-left">
          <span className="text-sm font-medium text-white">
            {grant.grantId?.value ?? `Grant ${index + 1}`}
          </span>
          {grant.grantType?.value && <Badge variant="purple" size="sm">{grant.grantType.value}</Badge>}
          {grant.totalShares?.value && (
            <span className="text-xs text-slate-500">
              {grant.totalShares.value.toLocaleString()} shares
            </span>
          )}
          {grant.sourceFiles.length > 1 && (
            <Badge variant="info" size="sm">Merged · {grant.sourceFiles.length} sources</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {lowConfidenceCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-red-400">
              <AlertTriangle className="w-3 h-3" />
              {lowConfidenceCount} low
            </span>
          )}
          {medConfidenceCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-amber-400">
              <Info className="w-3 h-3" />
              {medConfidenceCount} med
            </span>
          )}
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-slate-500" />
          ) : (
            <ChevronRight className="w-4 h-4 text-slate-500" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-left px-4 py-2 text-xs text-slate-500 font-medium">Field</th>
                <th className="text-left px-4 py-2 text-xs text-slate-500 font-medium">Extracted Value</th>
                <th className="text-left px-4 py-2 text-xs text-slate-500 font-medium">Confidence</th>
                <th className="text-right px-4 py-2 text-xs text-slate-500 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {fields.map(({ key, label, field }) => {
                const state = fieldStates[key];
                const isRejected = state?.status === 'rejected';
                const isEdited = state?.status === 'edited';
                const isAccepted = state?.status === 'accepted';

                return (
                  <tr
                    key={key}
                    className={`transition-colors ${
                      isRejected
                        ? 'opacity-40 line-through'
                        : isAccepted || isEdited
                        ? 'bg-emerald-950/20'
                        : field.confidence < 70
                        ? 'bg-red-950/10'
                        : field.confidence < 95
                        ? 'bg-amber-950/10'
                        : ''
                    }`}
                  >
                    <td className="px-4 py-2 text-slate-400 text-xs">{label}</td>
                    <td className="px-4 py-2 text-white text-xs font-mono">
                      {editingField === key ? (
                        <div className="flex items-center gap-2">
                          <input
                            autoFocus
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            className="bg-slate-800 border border-indigo-500 rounded px-2 py-1 text-xs font-mono w-36 focus:outline-none"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveEdit(key);
                              if (e.key === 'Escape') setEditingField(null);
                            }}
                          />
                          <button onClick={() => saveEdit(key)} className="text-emerald-400 text-xs">Save</button>
                          <button onClick={() => setEditingField(null)} className="text-slate-500 text-xs">Cancel</button>
                        </div>
                      ) : (
                        <span>
                          {isEdited && <span className="text-amber-400 mr-1">✎</span>}
                          {displayValue(key, field.value)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <ConfidenceBadge confidence={field.confidence} />
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-1.5">
                        <SourcePopover sources={field.sources} />
                        <button
                          onClick={() => startEdit(key, field.value)}
                          className="text-slate-600 hover:text-indigo-400 transition-colors"
                          title="Edit"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setFieldStatus(key, isAccepted ? 'pending' : 'accepted')}
                          className={`transition-colors ${isAccepted ? 'text-emerald-400' : 'text-slate-600 hover:text-emerald-400'}`}
                          title="Accept"
                        >
                          <CheckCircle className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setFieldStatus(key, isRejected ? 'pending' : 'rejected')}
                          className={`transition-colors ${isRejected ? 'text-red-400' : 'text-slate-600 hover:text-red-400'}`}
                          title="Reject"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {grant.sourceFiles.length > 0 && (
            <div className="px-4 py-2 border-t border-slate-800 flex items-center gap-2">
              <span className="text-xs text-slate-600">Sources:</span>
              {grant.sourceFiles.map((f) => (
                <span key={f} className="text-xs bg-slate-800 px-2 py-0.5 rounded text-slate-400">{f}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ReviewView() {
  const { pendingGrants, importPendingGrants, setPendingGrants, setView, portfolio } = usePortfolioStore();
  const [importing, setImporting] = useState(false);

  // Preview what will be new vs what will update existing grants
  const dedupePreview = useMemo(
    () => deduplicateAgainstPortfolio(pendingGrants, portfolio.grants),
    [pendingGrants, portfolio.grants],
  );

  const handleImport = async () => {
    setImporting(true);
    await importPendingGrants();
    setImporting(false);
    setView('dashboard');
  };

  const handleDiscard = () => {
    setPendingGrants([]);
    setView('upload');
  };

  if (pendingGrants.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-12 text-center">
        <div className="text-slate-500">No pending extractions to review.</div>
        <Button variant="secondary" onClick={() => setView('upload')}>
          Go to Upload
        </Button>
      </div>
    );
  }

  const lowCount = pendingGrants.reduce((s, g) => {
    return s + Object.values(g)
      .filter((v): v is ExtractedField<unknown> => v !== null && typeof v === 'object' && 'confidence' in v && 'sources' in v)
      .filter((f) => f.confidence < 70).length;
  }, 0);

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-white">Extraction Review</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Review the AI-extracted data before importing into your portfolio.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button variant="ghost" size="sm" onClick={handleDiscard}>
            Discard
          </Button>
          <Button variant="primary" size="md" loading={importing} onClick={handleImport}>
            <CheckCircle className="w-4 h-4" />
            Import {pendingGrants.length} Grant{pendingGrants.length > 1 ? 's' : ''}
          </Button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-4 gap-4">
        <Card padding="md">
          <div className="text-2xl font-semibold text-white">{pendingGrants.length}</div>
          <div className="text-xs text-slate-500 mt-0.5">Grants Extracted</div>
        </Card>
        <Card padding="md">
          <div className="flex items-center gap-2">
            <Plus className="w-4 h-4 text-emerald-400" />
            <div className="text-2xl font-semibold text-emerald-400">{dedupePreview.toAdd.length}</div>
          </div>
          <div className="text-xs text-slate-500 mt-0.5">New to Portfolio</div>
        </Card>
        <Card padding="md">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-blue-400" />
            <div className="text-2xl font-semibold text-blue-400">{dedupePreview.toUpdate.length}</div>
          </div>
          <div className="text-xs text-slate-500 mt-0.5">Updates Existing</div>
        </Card>
        <Card padding="md">
          <div className={`text-2xl font-semibold ${lowCount > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
            {lowCount}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">Low-Confidence Fields</div>
        </Card>
      </div>

      {/* Duplicate notice */}
      {dedupePreview.toUpdate.length > 0 && (
        <div className="flex items-start gap-3 bg-blue-950/30 border border-blue-800/50 rounded-xl px-4 py-3">
          <RefreshCw className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-blue-300">
            <span className="font-medium">{dedupePreview.toUpdate.length} grant{dedupePreview.toUpdate.length > 1 ? 's' : ''} already exist in your portfolio</span>
            {' '}and will be updated with the latest data from these documents (newer prices, updated vesting counts). No duplicates will be created.
          </div>
        </div>
      )}

      {/* Grant Cards */}
      <div className="space-y-3">
        {pendingGrants.map((grant, i) => (
          <GrantReviewCard key={grant.id} grant={grant} index={i} />
        ))}
      </div>

      <div className="flex items-center gap-2 pb-4">
        <Button variant="ghost" size="sm" onClick={handleDiscard}>
          Discard All
        </Button>
        <div className="flex-1" />
        <Button variant="primary" size="lg" loading={importing} onClick={handleImport}>
          <CheckCircle className="w-4 h-4" />
          Import {pendingGrants.length} Grant{pendingGrants.length > 1 ? 's' : ''} to Portfolio
        </Button>
      </div>
    </div>
  );
}
