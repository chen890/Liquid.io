import { useMemo } from 'react';
import { Lightbulb, TrendingUp, AlertTriangle, Info, Upload } from 'lucide-react';
import { usePortfolioStore } from '../../store/portfolioStore';
import { generateInsights } from '../../lib/insights';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

const INSIGHT_CONFIG = {
  info: {
    icon: Info,
    color: 'text-blue-400',
    border: 'border-blue-900/50',
    bg: 'bg-blue-950/20',
    badge: 'bg-blue-900/40 text-blue-400',
    label: 'Insight',
  },
  warning: {
    icon: AlertTriangle,
    color: 'text-amber-400',
    border: 'border-amber-900/50',
    bg: 'bg-amber-950/20',
    badge: 'bg-amber-900/40 text-amber-400',
    label: 'Action Needed',
  },
  opportunity: {
    icon: TrendingUp,
    color: 'text-emerald-400',
    border: 'border-emerald-900/50',
    bg: 'bg-emerald-950/20',
    badge: 'bg-emerald-900/40 text-emerald-400',
    label: 'Opportunity',
  },
};

export function InsightsView() {
  const { portfolio, setView } = usePortfolioStore();
  const insights = useMemo(() => generateInsights(portfolio.grants), [portfolio.grants]);

  if (portfolio.grants.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-12 text-center">
        <div className="w-14 h-14 rounded-2xl bg-amber-600/20 border border-amber-700/30 flex items-center justify-center">
          <Lightbulb className="w-7 h-7 text-amber-400" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-white mb-1">No insights yet</h2>
          <p className="text-slate-400 text-sm max-w-xs">
            Import your equity grants to generate personalized portfolio insights.
          </p>
        </div>
        <Button variant="primary" onClick={() => setView('upload')}>
          <Upload className="w-4 h-4" />
          Upload Documents
        </Button>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">AI Insights</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Generated from {portfolio.grants.length} grant{portfolio.grants.length > 1 ? 's' : ''} in your portfolio
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card padding="md">
          <div className="text-2xl font-semibold text-blue-400">
            {insights.filter((i) => i.type === 'info').length}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">Portfolio Insights</div>
        </Card>
        <Card padding="md">
          <div className="text-2xl font-semibold text-amber-400">
            {insights.filter((i) => i.type === 'warning').length}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">Action Items</div>
        </Card>
        <Card padding="md">
          <div className="text-2xl font-semibold text-emerald-400">
            {insights.filter((i) => i.type === 'opportunity').length}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">Opportunities</div>
        </Card>
      </div>

      <div className="space-y-3">
        {insights.map((insight) => {
          const cfg = INSIGHT_CONFIG[insight.type];
          const Icon = cfg.icon;
          return (
            <div
              key={insight.id}
              className={`border rounded-xl p-4 ${cfg.border} ${cfg.bg}`}
            >
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 ${cfg.color} flex-shrink-0`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${cfg.badge}`}>
                      {cfg.label}
                    </span>
                    {insight.metric && (
                      <span className="text-xs font-mono text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
                        {insight.metric}
                      </span>
                    )}
                  </div>
                  <div className="text-sm font-medium text-white mb-1">{insight.title}</div>
                  <div className="text-sm text-slate-400 leading-relaxed">{insight.description}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="text-xs text-slate-700 text-center pb-4">
        Insights are generated from imported portfolio data only. Projections are illustrative and not financial advice.
      </div>
    </div>
  );
}
