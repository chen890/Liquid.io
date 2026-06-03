import type { GrantRecord, AIInsight } from '../types';
import { v4 as uuidv4 } from 'uuid';

export function generateInsights(grants: GrantRecord[]): AIInsight[] {
  if (grants.length === 0) return [];

  const insights: AIInsight[] = [];
  const now = new Date();

  const totalShares = grants.reduce((s, g) => s + (g.totalShares?.value ?? 0), 0);
  const totalUnvested = grants.reduce((s, g) => s + (g.unvestedShares?.value ?? 0), 0);
  const totalValue = grants.reduce((s, g) => s + (g.currentMarketValue?.value ?? 0), 0);

  // Vesting concentration
  if (totalShares > 0 && totalUnvested > 0) {
    const unvestedPct = Math.round((totalUnvested / totalShares) * 100);
    insights.push({
      id: uuidv4(),
      type: 'info',
      title: 'Unvested Position',
      description: `${unvestedPct}% of your total grant shares (${totalUnvested.toLocaleString()} shares) are still unvested.`,
      metric: `${unvestedPct}%`,
      generatedAt: now.toISOString(),
    });
  }

  // Upcoming vesting in 18 months
  const upcoming18m = grants.filter((g) => {
    if (!g.vestingEndDate?.value) return false;
    const end = new Date(g.vestingEndDate.value);
    const monthsDiff = (end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 30);
    return monthsDiff > 0 && monthsDiff <= 18;
  });

  if (upcoming18m.length > 0) {
    const sharesVesting = upcoming18m.reduce((s, g) => s + (g.unvestedShares?.value ?? 0), 0);
    insights.push({
      id: uuidv4(),
      type: 'opportunity',
      title: 'Near-Term Vesting',
      description: `${upcoming18m.length} grant${upcoming18m.length > 1 ? 's' : ''} with approximately ${sharesVesting.toLocaleString()} shares will fully vest within the next 18 months.`,
      metric: `${sharesVesting.toLocaleString()} shares`,
      generatedAt: now.toISOString(),
    });
  }

  // Largest grant concentration
  if (grants.length > 1 && totalValue > 0) {
    const largest = grants.reduce((a, b) =>
      (a.currentMarketValue?.value ?? 0) > (b.currentMarketValue?.value ?? 0) ? a : b
    );
    if (largest.currentMarketValue?.value) {
      const pct = Math.round((largest.currentMarketValue.value / totalValue) * 100);
      if (pct > 30) {
        insights.push({
          id: uuidv4(),
          type: 'warning',
          title: 'Portfolio Concentration',
          description: `Your largest grant represents ${pct}% of your total portfolio value ($${largest.currentMarketValue.value.toLocaleString()}). Consider diversification strategies.`,
          metric: `${pct}%`,
          generatedAt: now.toISOString(),
        });
      }
    }
  }

  // Grants expiring this year
  const expiringThisYear = grants.filter((g) => {
    if (!g.vestingEndDate?.value) return false;
    return new Date(g.vestingEndDate.value).getFullYear() === now.getFullYear();
  });

  if (expiringThisYear.length > 0) {
    insights.push({
      id: uuidv4(),
      type: 'warning',
      title: 'Grants Reaching Full Vesting This Year',
      description: `${expiringThisYear.length} grant${expiringThisYear.length > 1 ? 's' : ''} will reach full vesting this year. Plan for tax implications and exercise decisions.`,
      metric: `${expiringThisYear.length} grants`,
      generatedAt: now.toISOString(),
    });
  }

  // Growth projection
  if (totalValue > 0) {
    const growthRate = 0.12;
    const years = 4;
    const projectedValue = totalValue * Math.pow(1 + growthRate, years);
    insights.push({
      id: uuidv4(),
      type: 'info',
      title: '4-Year Growth Projection',
      description: `At a 12% annual growth rate, your vested portfolio value may reach $${Math.round(projectedValue).toLocaleString()} by ${now.getFullYear() + years}.`,
      metric: `$${Math.round(projectedValue).toLocaleString()}`,
      generatedAt: now.toISOString(),
    });
  }

  // RSU vs Options split
  const rsuGrants = grants.filter((g) => g.grantType?.value === 'RSU');
  const optionGrants = grants.filter((g) => ['ISO', 'NSO'].includes(g.grantType?.value ?? ''));

  if (rsuGrants.length > 0 && optionGrants.length > 0) {
    insights.push({
      id: uuidv4(),
      type: 'info',
      title: 'Mixed Grant Portfolio',
      description: `You hold ${rsuGrants.length} RSU grant${rsuGrants.length > 1 ? 's' : ''} and ${optionGrants.length} stock option grant${optionGrants.length > 1 ? 's' : ''}. RSUs and options have different tax treatments — consult your tax advisor.`,
      metric: `${rsuGrants.length} RSU + ${optionGrants.length} options`,
      generatedAt: now.toISOString(),
    });
  }

  // Total portfolio value
  if (totalValue > 0) {
    const vestedValue = grants.reduce((s, g) => {
      const fmv = g.fairMarketValue?.value ?? g.currentMarketValue?.value ?? 0;
      return s + fmv * (g.vestedShares?.value ?? 0);
    }, 0);

    insights.push({
      id: uuidv4(),
      type: 'info',
      title: 'Vested Portfolio Value',
      description: `Your currently vested equity is worth approximately $${Math.round(vestedValue).toLocaleString()} based on recorded fair market values.`,
      metric: `$${Math.round(vestedValue).toLocaleString()}`,
      generatedAt: now.toISOString(),
    });
  }

  return insights;
}

export function computePortfolioStats(grants: GrantRecord[]) {
  const totalGrants = grants.length;
  const totalShares = grants.reduce((s, g) => s + (g.totalShares?.value ?? 0), 0);
  const totalVested = grants.reduce((s, g) => s + (g.vestedShares?.value ?? 0), 0);
  const totalUnvested = grants.reduce((s, g) => s + (g.unvestedShares?.value ?? 0), 0);

  // Use document-extracted prices throughout — fairMarketValue is the per-share
  // price at statement date; currentMarketValue is the total dollar value.
  const pricePerShare = (g: GrantRecord) =>
    g.fairMarketValue?.value ??
    (g.currentMarketValue?.value && g.totalShares?.value
      ? g.currentMarketValue.value / g.totalShares.value
      : 0);

  // Vested value: explicit vestedShares × price, or fall back to
  // (totalShares − unvestedShares) × price, or currentMarketValue when the
  // grant represents fully-vested stock (vestedShares === totalShares).
  const vestedValue = grants.reduce((s, g) => {
    const price  = pricePerShare(g);
    const vested = g.vestedShares?.value;
    const total  = g.totalShares?.value ?? 0;
    const unvest = g.unvestedShares?.value;

    if (vested !== undefined) return s + price * vested;
    if (unvest !== undefined && total > 0) return s + price * Math.max(0, total - unvest);
    // Grant shows no vesting split — assume fully vested (e.g. already-settled stock)
    return s + (g.currentMarketValue?.value ?? 0);
  }, 0);

  // Unvested value: explicit unvestedShares × price, or currentMarketValue
  // (which for "Potential Restricted Stock" sections IS the unvested total).
  const unvestedValue = grants.reduce((s, g) => {
    const price  = pricePerShare(g);
    const unvest = g.unvestedShares?.value;
    const total  = g.totalShares?.value ?? 0;
    const vested = g.vestedShares?.value;

    if (unvest !== undefined) return s + price * unvest;
    if (vested !== undefined && total > 0) return s + price * Math.max(0, total - vested);
    // No explicit split — treat currentMarketValue as the unvested portion
    return s + (g.currentMarketValue?.value ?? 0);
  }, 0);

  // Sellable now = RSU/settled shares that are already vested
  // Options need separate exercise step — flag separately
  const sellableNowValue = grants.reduce((s, g) => {
    const type   = g.grantType?.value ?? '';
    const price  = pricePerShare(g);
    const vested = g.vestedShares?.value;
    const total  = g.totalShares?.value ?? 0;
    const unvest = g.unvestedShares?.value;

    const vestedCount =
      vested !== undefined ? vested :
      (unvest !== undefined && total > 0 ? Math.max(0, total - unvest) : 0);

    // Options require exercise — not immediately sellable from this view
    if (['ISO', 'NSO'].includes(type)) return s;
    return s + price * vestedCount;
  }, 0);

  const totalValue = grants.reduce((s, g) => s + (g.currentMarketValue?.value ?? 0), 0);

  const now = new Date();
  const nextVesting = grants
    .filter((g) => g.vestingEndDate?.value && new Date(g.vestingEndDate.value) > now)
    .sort((a, b) =>
      new Date(a.vestingEndDate!.value).getTime() - new Date(b.vestingEndDate!.value).getTime()
    )[0];

  return {
    totalGrants,
    totalShares,
    totalVested,
    totalUnvested,
    totalValue: totalValue || vestedValue + unvestedValue,
    vestedValue,
    unvestedValue,
    sellableNowValue,
    nextVestingGrant: nextVesting ?? null,
    nextVestingDate: nextVesting?.vestingEndDate?.value ?? null,
  };
}
