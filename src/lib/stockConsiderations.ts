import type { Snapshot } from './indicators';
import type { RsuSummary } from './stockDetect';
import type { TradingWindow } from '../types';
import { currentTradingWindow, nextTradingWindow } from './tradingWindows';

export interface Consideration {
  tone: 'positive' | 'neutral' | 'caution';
  text: string;
}

export interface Assessment {
  considerations: Consideration[];
  scenarios: { label: string; text: string }[];
}

const fmt = (n: number, d = 2) => n.toLocaleString('en-US', { maximumFractionDigits: d });

/**
 * Rule-based reading of the indicators and the user's RSU position. It describes conditions and
 * scenarios; it does not predict prices, recommend a trade, or account for the user's tax position.
 */
export function assess(
  snap: Snapshot | null,
  rsu: RsuSummary,
  windows: TradingWindow[],
  filingsNote?: string,
  rsuDataSuspect = false,
): Assessment {
  const considerations: Consideration[] = [];
  if (snap) {
    if (snap.sma50 != null) {
      const above = snap.last > snap.sma50;
      considerations.push({
        tone: above ? 'positive' : 'caution',
        text: `Price ${fmt(snap.last)} is ${above ? 'above' : 'below'} the 50-period average (${fmt(snap.sma50)}).`,
      });
    }
    if (snap.sma20 != null) {
      const above = snap.last > snap.sma20;
      considerations.push({
        tone: above ? 'positive' : 'caution',
        text: `Price is ${above ? 'above' : 'below'} the 20-period average (${fmt(snap.sma20)}).`,
      });
    }
    if (snap.momentum20Pct != null) {
      considerations.push({
        tone: snap.momentum20Pct >= 0 ? 'positive' : 'caution',
        text: `Change over the last 20 candles: ${snap.momentum20Pct >= 0 ? '+' : ''}${fmt(snap.momentum20Pct)}%.`,
      });
    }
    const pos = snap.rangePosition;
    considerations.push({
      tone: pos > 0.85 ? 'caution' : pos < 0.15 ? 'neutral' : 'neutral',
      text: `Price sits at ${fmt(pos * 100, 0)}% of the displayed range (low ${fmt(snap.low)}, high ${fmt(snap.high)}).`,
    });
    if (snap.avgVolume20 && snap.lastVolume != null && snap.avgVolume20 > 0) {
      const r = snap.lastVolume / snap.avgVolume20;
      if (r > 1.5 || r < 0.5) {
        considerations.push({
          tone: 'neutral',
          text: `Latest volume is ${fmt(r, 1)}x the 20-period average, so the latest move carries ${r > 1.5 ? 'more' : 'less'} weight than usual.`,
        });
      }
    }
  } else {
    considerations.push({ tone: 'neutral', text: 'No price data loaded, so no indicator reading is available.' });
  }

  if (rsu.grantCount > 0) {
    considerations.push({
      tone: 'neutral',
      text: `RSU position as stored: ${fmt(rsu.vestedShares, 0)} vested and ${fmt(rsu.unvestedShares, 0)} unvested shares across ${rsu.grantCount} grant(s).${rsuDataSuspect ? ' The grant data looks inconsistent, so do not rely on these counts until it is checked.' : ''}`,
    });
    if (rsu.nextVest) {
      considerations.push({ tone: 'neutral', text: `Next vest: ${fmt(rsu.nextVest.shares, 0)} shares on ${rsu.nextVest.date}.` });
    }
    const open = currentTradingWindow(windows);
    const next = nextTradingWindow(windows);
    if (open) considerations.push({ tone: 'positive', text: `A trading window is open until ${open.closeDate.slice(0, 10)}.` });
    else if (next) considerations.push({ tone: 'caution', text: `No trading window is open. Next opens ${next.openDate.slice(0, 10)}.` });
  }
  if (filingsNote) considerations.push({ tone: 'neutral', text: filingsNote });

  const up = snap && snap.sma50 != null && snap.last > snap.sma50;
  const scenarios = [
    {
      label: 'If the trend continues',
      text: up
        ? 'Price stays above its averages: holding keeps exposure to further upside, with the same downside risk if it reverses.'
        : 'Price stays below its averages: holding keeps exposure to further decline.',
    },
    {
      label: 'If the trend reverses',
      text: up
        ? 'A close below the 50-period average would weaken the current picture.'
        : 'A close back above the 50-period average would improve the current picture.',
    },
    {
      label: 'Concentration risk',
      text: rsu.vestedShares + rsu.unvestedShares > 0
        ? 'Salary and unvested RSUs often depend on the same employer, so exposure to this one stock may already be large.'
        : 'No RSU position is linked to this stock in your data.',
    },
  ];
  return { considerations, scenarios };
}
