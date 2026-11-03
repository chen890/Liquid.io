import type { ExtractionProvider, GrantRecord } from '../../types';
import { getSetting } from '../storage';
import { getExtractionKeyForProvider } from '../extractionKeys';
import { computePortfolioStats } from '../insights';
import { resolveVestingCounts } from '../vestingCounts';
import { getAllVestingEvents } from '../vestingSchedule';
import { checkServerHealth, serverUsesSofia } from './extractor';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface PortfolioChatResult {
  reply: string;
  backend: string;
  model: string;
}

const fmtMoney = (n: number) =>
  Number.isFinite(n) ? `$${Math.round(n).toLocaleString('en-US')}` : '—';

/**
 * Compact text snapshot of the working portfolio for the chat system prompt.
 */
export function buildPortfolioContext(
  grants: GrantRecord[],
  livePrices?: Record<string, number | null | undefined>,
): string {
  if (grants.length === 0) {
    return 'No grants are currently loaded in the portfolio.';
  }

  const stats = computePortfolioStats(grants);
  const lines: string[] = [
    `As of: ${new Date().toISOString().slice(0, 10)}`,
    `Summary: ${stats.totalGrants} grants · ${stats.totalShares.toLocaleString()} total shares · ` +
      `${stats.totalVested.toLocaleString()} vested · ${stats.totalUnvested.toLocaleString()} unvested`,
    `Doc values: vested ${fmtMoney(stats.vestedValue)} · sellable ${fmtMoney(stats.sellableNowValue)} · ` +
      `unvested ${fmtMoney(stats.unvestedValue)} · total ${fmtMoney(stats.totalValue)}`,
  ];

  const tickers = [
    ...new Set(grants.map((g) => g.tickerSymbol?.value).filter(Boolean) as string[]),
  ];
  if (livePrices && tickers.length > 0) {
    const priceBits = tickers.map((t) => {
      const p = livePrices[t];
      return p != null && p > 0 ? `${t}=$${p.toFixed(2)}` : `${t}=n/a`;
    });
    lines.push(`Live prices: ${priceBits.join(', ')}`);
  }

  lines.push('', 'Grants:');
  for (const g of grants) {
    const c = resolveVestingCounts(g);
    const type = g.grantType?.value ?? '?';
    const id = g.grantId?.value ?? g.id.slice(0, 8);
    const ticker = g.tickerSymbol?.value ?? '—';
    const company = g.companyName?.value ?? '';
    const fmv = g.fairMarketValue?.value;
    const live = ticker !== '—' ? livePrices?.[ticker] : undefined;
    const price =
      live != null && live > 0
        ? live
        : fmv != null && fmv > 0
          ? fmv
          : undefined;

    lines.push(
      `- ${id} | ${type} | ${ticker}${company ? ` (${company})` : ''} | ` +
        `total=${c.total} vested=${c.vested} unvested=${c.unvested} sellable=${c.sellable}` +
        (c.sold > 0 ? ` sold≈${c.sold}` : '') +
        (price != null ? ` | ~$${price.toFixed(2)}/sh` : '') +
        (g.grantDate?.value ? ` | granted ${g.grantDate.value}` : '') +
        (g.vestingEndDate?.value ? ` | full vest ${g.vestingEndDate.value}` : '') +
        (g.taxRoute ? ` | tax ${g.taxRoute}` : ''),
    );

    if (g.vestingSchedule && g.vestingSchedule.length > 0) {
      const upcoming = g.vestingSchedule
        .filter((e) => !e.vested)
        .slice(0, 4)
        .map((e) => `${e.date}:${e.shares}`)
        .join(', ');
      if (upcoming) lines.push(`    schedule (upcoming): ${upcoming}`);
    }
  }

  const liveMap =
    livePrices &&
    Object.fromEntries(
      Object.entries(livePrices)
        .filter(([, p]) => p != null && Number(p) > 0)
        .map(([t, p]) => [t, Number(p)]),
    );
  const events = getAllVestingEvents(
    grants,
    liveMap && Object.keys(liveMap).length > 0 ? liveMap : undefined,
  ).slice(0, 12);

  if (events.length > 0) {
    lines.push('', 'Upcoming vesting (next events):');
    for (const ev of events) {
      const date = ev.vestDate.toISOString().slice(0, 10);
      lines.push(
        `- ${date} · ${ev.grantId} · ${ev.grantType} · ${ev.ticker || '—'} · ` +
          `${ev.shares.toLocaleString()} sh` +
          (ev.estimatedValue > 0 ? ` · ~${fmtMoney(ev.estimatedValue)}` : ''),
      );
    }
  }

  return lines.join('\n');
}

export async function askPortfolioChat(
  messages: ChatTurn[],
  portfolioContext: string,
): Promise<PortfolioChatResult> {
  const provider =
    (await getSetting<ExtractionProvider>('extractionProvider')) ?? 'openai';
  const apiKey = (await getExtractionKeyForProvider(provider)) || '';
  const health = await checkServerHealth();
  const useSofia = serverUsesSofia(health);

  if (!apiKey && !useSofia && !health.online) {
    throw new Error(
      'Chat needs the extraction server online (Sofia) or a saved API key under Secure vault.',
    );
  }
  if (!apiKey && !useSofia && health.online && health.backend !== 'sofia') {
    // Server online but no Sofia and no client key — server may still have env keys.
    // Proceed; server returns 503 if none configured.
  }

  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages,
      portfolioContext,
      apiKey,
      provider,
    }),
  });

  if (!res.ok) {
    let msg = `Chat error ${res.status}`;
    try {
      const j = (await res.json()) as { detail?: string };
      if (typeof j.detail === 'string' && j.detail.trim()) msg = j.detail;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }

  const data = (await res.json()) as {
    reply?: string;
    backend?: string;
    model?: string;
  };
  const reply = (data.reply ?? '').trim();
  if (!reply) throw new Error('Empty response from chat');
  return {
    reply,
    backend: data.backend ?? 'unknown',
    model: data.model ?? '',
  };
}
