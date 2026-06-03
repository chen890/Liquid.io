/**
 * TransactionsView — realized P&L and sale transaction history.
 *
 * Lets the user manually record share sales, computes:
 * - Realized gain/loss per sale
 * - Year-to-date realized total (for IL calendar-year offsetting)
 * - Estimated CGT paid / owed
 */

import { useState, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Plus, Trash2, TrendingDown } from 'lucide-react';
import { usePortfolioStore } from '../../store/portfolioStore';
import type { SaleTransaction } from '../../types';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';

const IL_CGT = 0.25;

function fmtUSD(n: number, signed = false) {
  const s = n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M`
           : n >= 1_000     ? `$${(n / 1_000).toFixed(1)}K`
           : `$${n.toFixed(0)}`;
  return signed && n > 0 ? `+${s}` : s;
}

function thisYear() { return new Date().getFullYear(); }

export function TransactionsView() {
  const { portfolio, addTransaction, deleteTransaction } = usePortfolioStore();
  const { transactions, grants } = portfolio;

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    ticker: '',
    grantId: '',
    sharesSold: '',
    salePrice: '',
    costBasis: '',
    notes: '',
  });

  // Auto-fill cost basis from the selected grant — accessed in handleFormChange

  const handleFormChange = (field: string, value: string) => {
    setForm((f) => {
      const next = { ...f, [field]: value };
      // Auto-fill ticker from grant
      if (field === 'grantId' && value) {
        const g = grants.find((gr) => gr.id === value);
        if (g) {
          next.ticker = g.tickerSymbol?.value ?? '';
          // Use FMV as cost basis proxy
          const basis = g.fairMarketValue?.value ??
            (g.currentMarketValue?.value && g.totalShares?.value ? g.currentMarketValue.value / g.totalShares.value : 0);
          if (basis) next.costBasis = String(basis.toFixed(2));
        }
      }
      return next;
    });
  };

  const handleAdd = async () => {
    const shares     = Number(form.sharesSold);
    const salePrice  = Number(form.salePrice);
    const costBasis  = Number(form.costBasis);
    if (!shares || !salePrice || !form.date || !form.ticker) return;

    const gain = (salePrice - costBasis) * shares;
    const tx: SaleTransaction = {
      id: uuidv4(),
      date: form.date,
      ticker: form.ticker.toUpperCase(),
      grantId: form.grantId || undefined,
      sharesSold: shares,
      salePrice,
      costBasis,
      realizedGainUSD: gain,
      notes: form.notes || undefined,
    };
    await addTransaction(tx);
    setShowForm(false);
    setForm({ date: new Date().toISOString().slice(0, 10), ticker: '', grantId: '', sharesSold: '', salePrice: '', costBasis: '', notes: '' });
  };

  // YTD stats
  const ytdTxs = useMemo(() =>
    transactions.filter((t) => new Date(t.date).getFullYear() === thisYear()),
    [transactions]);

  const ytdGain   = ytdTxs.reduce((s, t) => s + t.realizedGainUSD, 0);
  const ytdTax    = Math.max(0, ytdGain * IL_CGT);
  const ytdProfit = ytdTxs.filter((t) => t.realizedGainUSD > 0).reduce((s, t) => s + t.realizedGainUSD, 0);
  const ytdLoss   = ytdTxs.filter((t) => t.realizedGainUSD < 0).reduce((s, t) => s + t.realizedGainUSD, 0);

  const allYears = [...new Set(transactions.map((t) => new Date(t.date).getFullYear()))].sort().reverse();
  const [yearFilter, setYearFilter] = useState<number | 'all'>('all');
  const visibleTxs = yearFilter === 'all' ? transactions : transactions.filter((t) => new Date(t.date).getFullYear() === yearFilter);
  const sorted = [...visibleTxs].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Sale Transactions</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Track realized gains for IL calendar-year tax offsetting
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setShowForm((v) => !v)}>
          <Plus className="w-3.5 h-3.5" />
          Record Sale
        </Button>
      </div>

      {/* YTD Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card padding="md">
          <div className="text-xs text-slate-500 mb-1">YTD Realized Gain</div>
          <div className={`text-xl font-mono font-semibold ${ytdGain >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {fmtUSD(ytdGain, true)}
          </div>
          <div className="text-xs text-slate-600 mt-0.5">{ytdTxs.length} sales in {thisYear()}</div>
        </Card>
        <Card padding="md">
          <div className="text-xs text-slate-500 mb-1">Profits (IL offsettable)</div>
          <div className="text-xl font-mono font-semibold text-emerald-400">{fmtUSD(ytdProfit)}</div>
        </Card>
        <Card padding="md">
          <div className="text-xs text-slate-500 mb-1">Losses (can offset gains)</div>
          <div className="text-xl font-mono font-semibold text-red-400">{fmtUSD(ytdLoss)}</div>
        </Card>
        <Card padding="md">
          <div className="text-xs text-slate-500 mb-1">Est. IL CGT Owed (25%)</div>
          <div className="text-xl font-mono font-semibold text-amber-400">{fmtUSD(ytdTax)}</div>
          <div className="text-xs text-slate-600 mt-0.5">on net {thisYear()} gain</div>
        </Card>
      </div>

      {/* IL offsetting note */}
      {ytdLoss < 0 && ytdProfit > 0 && (
        <div className="flex items-start gap-2 bg-blue-950/30 border border-blue-800/50 rounded-xl px-4 py-3 text-xs text-blue-300">
          <TrendingDown className="w-3.5 h-3.5 mt-0.5 text-blue-400 flex-shrink-0" />
          You have {fmtUSD(Math.abs(ytdLoss))} of realized losses in {thisYear()} that can offset your {fmtUSD(ytdProfit)} of gains.
          Net taxable gain: {fmtUSD(Math.max(0, ytdGain))} → estimated tax: {fmtUSD(ytdTax)}.
          Losses cannot be carried forward to {thisYear() + 1} under IL rules.
        </div>
      )}

      {/* Add sale form */}
      {showForm && (
        <Card padding="md">
          <CardHeader>
            <CardTitle>Record a Sale</CardTitle>
          </CardHeader>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
            {[
              { label: 'Date', key: 'date', type: 'date' },
              { label: 'Ticker', key: 'ticker', type: 'text', placeholder: 'MBLY' },
              { label: 'Shares Sold', key: 'sharesSold', type: 'number', placeholder: '100' },
              { label: 'Sale Price (USD/sh)', key: 'salePrice', type: 'number', placeholder: '12.50' },
              { label: 'Cost Basis (USD/sh)', key: 'costBasis', type: 'number', placeholder: '8.00' },
              { label: 'Notes', key: 'notes', type: 'text', placeholder: 'Optional' },
            ].map(({ label, key, type, placeholder }) => (
              <div key={key}>
                <label className="block text-xs text-slate-500 mb-1">{label}</label>
                <input type={type} value={form[key as keyof typeof form]} placeholder={placeholder}
                  onChange={(e) => handleFormChange(key, e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono" />
              </div>
            ))}
            {grants.length > 0 && (
              <div>
                <label className="block text-xs text-slate-500 mb-1">Link to Grant (optional)</label>
                <select value={form.grantId} onChange={(e) => handleFormChange('grantId', e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-300 focus:outline-none">
                  <option value="">— none —</option>
                  {grants.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.grantId?.value ?? g.id.slice(0, 8)} ({g.tickerSymbol?.value ?? '?'})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          {form.sharesSold && form.salePrice && form.costBasis && (
            <div className="mt-3 p-2 bg-slate-950 rounded-lg text-xs font-mono text-slate-400 border border-slate-800">
              Realized gain: {fmtUSD((Number(form.salePrice) - Number(form.costBasis)) * Number(form.sharesSold), true)}
              {' · '}Est. IL CGT: {fmtUSD(Math.max(0, (Number(form.salePrice) - Number(form.costBasis)) * Number(form.sharesSold) * IL_CGT))}
            </div>
          )}
          <div className="flex gap-2 mt-3">
            <Button variant="primary" size="sm" onClick={handleAdd}>Save</Button>
            <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </Card>
      )}

      {/* Year filter */}
      {allYears.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Year:</span>
          <button onClick={() => setYearFilter('all')}
            className={`text-xs px-2 py-1 rounded ${yearFilter === 'all' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>All</button>
          {allYears.map((y) => (
            <button key={y} onClick={() => setYearFilter(y)}
              className={`text-xs px-2 py-1 rounded ${yearFilter === y ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>{y}</button>
          ))}
        </div>
      )}

      {/* Transaction table */}
      {sorted.length > 0 ? (
        <Card padding="none">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/40">
                  {['Date', 'Ticker', 'Shares', 'Sale Price', 'Cost Basis', 'Realized Gain', 'Est. CGT (25%)', 'Notes', ''].map((h) => (
                    <th key={h} className="text-left px-3 py-2.5 text-xs text-slate-500 font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {sorted.map((tx) => {
                  const cgt = Math.max(0, tx.realizedGainUSD * IL_CGT);
                  return (
                    <tr key={tx.id} className="hover:bg-slate-800/20">
                      <td className="px-3 py-2.5 text-xs text-slate-400 whitespace-nowrap">{new Date(tx.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-white">{tx.ticker}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-white">{tx.sharesSold.toLocaleString()}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-slate-300">${tx.salePrice.toFixed(2)}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-slate-500">${tx.costBasis.toFixed(2)}</td>
                      <td className="px-3 py-2.5">
                        <span className={`font-mono text-xs ${tx.realizedGainUSD >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {fmtUSD(tx.realizedGainUSD, true)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs text-amber-400">{cgt > 0 ? fmtUSD(cgt) : '—'}</td>
                      <td className="px-3 py-2.5 text-xs text-slate-600 max-w-24 truncate">{tx.notes ?? '—'}</td>
                      <td className="px-3 py-2.5">
                        <button onClick={() => deleteTransaction(tx.id)} className="text-slate-700 hover:text-red-400 p-1">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <div className="text-center py-12 text-slate-600 text-sm">
          No transactions recorded yet. Click "Record Sale" to add your first sale.
        </div>
      )}
    </div>
  );
}
