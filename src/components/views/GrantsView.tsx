import { useState, useMemo } from 'react';
import { Search, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import type { GrantRecord, GrantType } from '../../types';
import { usePortfolioStore } from '../../store/portfolioStore';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

const GRANT_TYPE_COLORS: Record<GrantType, 'purple' | 'info' | 'success' | 'warning' | 'error' | 'default'> = {
  RSU: 'purple',
  ISO: 'info',
  NSO: 'success',
  ESPP: 'warning',
  RestrictedShares: 'default',
  PerformanceShares: 'error',
};

const fmt = (n?: number) =>
  n === undefined ? '—' : n >= 1000000 ? `$${(n / 1000000).toFixed(2)}M` : `$${n.toLocaleString()}`;

function GrantRow({ grant }: { grant: GrantRecord }) {
  const [expanded, setExpanded] = useState(false);
  const { deleteGrant } = usePortfolioStore();

  const total   = grant.totalShares?.value ?? 0;
  const unvest  = grant.unvestedShares?.value;
  const vested  = grant.vestedShares?.value;

  // Compute vested count: explicit, derived, or 0
  const vestedCount =
    vested !== undefined ? vested :
    (unvest !== undefined && total > 0 ? Math.max(0, total - unvest) : undefined);

  const vestedPct =
    vestedCount !== undefined && total > 0
      ? Math.min(100, Math.round((vestedCount / total) * 100))
      : null;

  return (
    <>
      <tr
        className="border-b border-slate-800 hover:bg-slate-800/30 cursor-pointer transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            {expanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
            )}
            <span className="text-sm text-white font-mono">
              {grant.grantId?.value ?? grant.id.slice(0, 8)}
            </span>
          </div>
        </td>
        <td className="px-4 py-3">
          {grant.grantType?.value ? (
            <Badge variant={GRANT_TYPE_COLORS[grant.grantType.value] ?? 'default'} size="sm">
              {grant.grantType.value}
            </Badge>
          ) : (
            <span className="text-slate-600 text-xs">—</span>
          )}
        </td>
        <td className="px-4 py-3 text-sm text-slate-300">
          {grant.grantDate?.value
            ? new Date(grant.grantDate.value).toLocaleDateString()
            : '—'}
        </td>
        {/* Total shares */}
        <td className="px-4 py-3 text-sm text-white font-mono">
          {grant.totalShares?.value?.toLocaleString() ?? '—'}
        </td>
        {/* Vested RSUs — count + progress bar */}
        <td className="px-4 py-3">
          {vestedCount !== undefined ? (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-emerald-400 font-medium">
                  {vestedCount.toLocaleString()}
                </span>
                {unvest !== undefined && (
                  <span className="text-xs text-slate-600">
                    / {unvest.toLocaleString()} unvested
                  </span>
                )}
              </div>
              {vestedPct !== null && (
                <div className="flex items-center gap-1.5">
                  <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden w-20">
                    <div
                      className="h-full bg-emerald-500 rounded-full"
                      style={{ width: `${vestedPct}%` }}
                    />
                  </div>
                  <span className="text-xs text-slate-500">{vestedPct}%</span>
                </div>
              )}
            </div>
          ) : (
            <span className="text-slate-600 text-xs">—</span>
          )}
        </td>
        <td className="px-4 py-3 text-sm text-slate-300 font-mono">
          {fmt(grant.fairMarketValue?.value)}
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-1">
            {grant.sourceFiles.slice(0, 2).map((f) => (
              <span key={f} className="text-xs bg-slate-800 px-1.5 py-0.5 rounded text-slate-500 max-w-24 truncate">
                {f}
              </span>
            ))}
            {grant.sourceFiles.length > 2 && (
              <span className="text-xs text-slate-600">+{grant.sourceFiles.length - 2}</span>
            )}
          </div>
        </td>
        <td className="px-4 py-3">
          <button
            onClick={(e) => { e.stopPropagation(); deleteGrant(grant.id); }}
            className="text-slate-700 hover:text-red-400 transition-colors p-1"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </td>
      </tr>

      {expanded && (
        <tr className="border-b border-slate-800 bg-slate-950/50">
          <td colSpan={8} className="px-6 py-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
              {[
                { label: 'Company', val: grant.companyName?.value },
                { label: 'Ticker', val: grant.tickerSymbol?.value },
                { label: 'Vesting Start', val: grant.vestingStartDate?.value },
                { label: 'Vesting End', val: grant.vestingEndDate?.value },
                { label: 'Vesting Frequency', val: grant.vestingFrequency?.value },
                { label: 'Cliff', val: grant.cliffDuration?.value ? `${grant.cliffDuration.value}mo` : undefined },
                { label: 'Strike Price', val: grant.strikePrice?.value ? `$${grant.strikePrice.value}` : undefined },
                { label: 'Exercise Price', val: grant.exercisePrice?.value ? `$${grant.exercisePrice.value}` : undefined },
                { label: 'Vested Shares', val: grant.vestedShares?.value?.toLocaleString() },
                { label: 'Unvested Shares', val: grant.unvestedShares?.value?.toLocaleString() },
                { label: 'Exercised Shares', val: grant.exercisedShares?.value?.toLocaleString() },
                { label: 'Cancelled Shares', val: grant.cancelledShares?.value?.toLocaleString() },
                { label: 'Cost Basis', val: grant.costBasis?.value ? `$${grant.costBasis.value.toLocaleString()}` : undefined },
                { label: 'Est. Tax Basis', val: grant.estimatedTaxBasis?.value ? `$${grant.estimatedTaxBasis.value.toLocaleString()}` : undefined },
                { label: 'Market Value', val: grant.currentMarketValue?.value ? `$${grant.currentMarketValue.value.toLocaleString()}` : undefined },
              ]
                .filter((x) => x.val)
                .map(({ label, val }) => (
                  <div key={label}>
                    <div className="text-slate-600 mb-0.5">{label}</div>
                    <div className="text-slate-300 font-mono">{val}</div>
                  </div>
                ))}
            </div>
            {grant.mergedFromIds && grant.mergedFromIds.length > 0 && (
              <div className="mt-3 pt-3 border-t border-slate-800">
                <Badge variant="info" size="sm">
                  Merged from {grant.mergedFromIds.length} sources · Match confidence:{' '}
                  {grant.matchConfidence ?? '—'}%
                </Badge>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export function GrantsView() {
  const { portfolio, setView } = usePortfolioStore();
  const grants = portfolio.grants;

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [yearFilter, setYearFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');

  const years = useMemo(() => {
    const s = new Set<string>();
    grants.forEach((g) => {
      if (g.grantDate?.value) s.add(g.grantDate.value.slice(0, 4));
    });
    return Array.from(s).sort().reverse();
  }, [grants]);

  const allSources = useMemo(() => {
    const s = new Set<string>();
    grants.forEach((g) => g.sourceFiles.forEach((f) => s.add(f)));
    return Array.from(s);
  }, [grants]);

  const filtered = useMemo(() => {
    return grants.filter((g) => {
      if (search) {
        const q = search.toLowerCase();
        const match =
          g.grantId?.value?.toLowerCase().includes(q) ||
          g.companyName?.value?.toLowerCase().includes(q) ||
          g.tickerSymbol?.value?.toLowerCase().includes(q) ||
          g.grantType?.value?.toLowerCase().includes(q);
        if (!match) return false;
      }
      if (typeFilter !== 'all' && g.grantType?.value !== typeFilter) return false;
      if (yearFilter !== 'all' && g.grantDate?.value?.slice(0, 4) !== yearFilter) return false;
      if (sourceFilter !== 'all' && !g.sourceFiles.includes(sourceFilter)) return false;
      return true;
    });
  }, [grants, search, typeFilter, yearFilter, sourceFilter]);

  if (grants.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-12 text-center">
        <div className="text-slate-500">No grants imported yet.</div>
        <Button variant="primary" onClick={() => setView('upload')}>
          Upload Documents
        </Button>
      </div>
    );
  }

  const selectClass = 'bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-indigo-500';

  return (
    <div className="flex-1 overflow-auto p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Grant Explorer</h1>
          <p className="text-sm text-slate-500 mt-0.5">{filtered.length} of {grants.length} grants</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search grants..."
            className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={selectClass}>
          <option value="all">All Types</option>
          {['RSU', 'ISO', 'NSO', 'ESPP', 'RestrictedShares', 'PerformanceShares'].map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} className={selectClass}>
          <option value="all">All Years</option>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>

        <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className={selectClass}>
          <option value="all">All Sources</option>
          {allSources.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Table */}
      <Card padding="none" className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/50">
                <th className="text-left px-4 py-3 text-xs text-slate-500 font-medium">Grant ID</th>
                <th className="text-left px-4 py-3 text-xs text-slate-500 font-medium">Type</th>
                <th className="text-left px-4 py-3 text-xs text-slate-500 font-medium">Grant Date</th>
                <th className="text-left px-4 py-3 text-xs text-slate-500 font-medium">Total Shares</th>
                <th className="text-left px-4 py-3 text-xs text-slate-500 font-medium">Vested RSUs</th>
                <th className="text-left px-4 py-3 text-xs text-slate-500 font-medium">FMV</th>
                <th className="text-left px-4 py-3 text-xs text-slate-500 font-medium">Sources</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((g) => <GrantRow key={g.id} grant={g} />)}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div className="py-12 text-center text-slate-600 text-sm">
            No grants match your filters.
          </div>
        )}
      </Card>
    </div>
  );
}
