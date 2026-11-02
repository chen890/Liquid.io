/**
 * Regression test for grant import/re-upload (no AI, no network).
 *   npm i --no-save fake-indexeddb
 *   node --import ./scripts/register-hook.mjs --experimental-strip-types scripts/regress-import.mts
 * Uses the public ByStatus fixture. Fails (exit 1) if grants are mixed or duplicated.
 */
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { tryParseMorganStanleyByStatusFile } from '../src/lib/parsers/morganStanleyByStatus.ts';
import { deduplicateAgainstPortfolio } from '../src/lib/ai/reconciler.ts';
import { usePortfolioStore } from '../src/store/portfolioStore.ts';

const buf = readFileSync(new URL('../public/fixtures/ByStatus_expanded.xlsx', import.meta.url));
const parse = async (name = 'ByStatus_expanded.xlsx') => {
  const f = new File([buf], name);
  return (await tryParseMorganStanleyByStatusFile(f, f.name))!;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const show = (l: any[]) => l.map((g) => `${g.grantId?.value}:${g.totalShares?.value}/${g.vestedShares?.value}/${g.unvestedShares?.value}`).sort().join(' ');
const GOOD = '00005895:1333/879/454 00008154:1600/1056/544 00011101:2964/978/1986';
let failures = 0;
const check = (ok: boolean, msg: string) => { if (!ok) { failures++; console.error('FAIL', msg); } else console.log('ok  ', msg); };

// 1. Re-uploading the same file must not mix grants, whatever order they are stored in.
const base = await parse();
for (const p of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) {
  const existing = p.map((i) => structuredClone(base[i]));
  const { toAdd, toUpdate } = deduplicateAgainstPortfolio(await parse(), existing);
  const m = new Map(existing.map((g) => [g.id, g]));
  [...toAdd, ...toUpdate].forEach((g) => m.set(g.id, g));
  check(show([...m.values()]) === GOOD, `re-upload, stored order ${p.join('')}`);
}
// 2. A different grant of the same company stays separate.
{
  const existing = (await parse()).map((g) => structuredClone(g));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const extra: any = structuredClone(existing[0]);
  extra.id = 'x-new'; extra.sourceFiles = ['other.pdf']; extra.grantId.value = '00099999'; extra.totalShares.value = 500;
  const { toAdd, toUpdate } = deduplicateAgainstPortfolio([extra], existing);
  check(toAdd.length === 1 && toUpdate.length === 0, 'different grant id, same company is added, not merged');
}
// 3. Concurrent load + import calls (React StrictMode / startup) end in the same state.
for (let r = 0; r < 25; r++) {
  await usePortfolioStore.getState().clearAllData();
  const grants = await parse();
  const go = async () => {
    const s = usePortfolioStore.getState();
    s.setPendingGrants(structuredClone(grants));
    s.setPendingSession({ id: crypto.randomUUID(), createdAt: '', documentIds: [], grantIds: [], status: 'review' } as never);
    await usePortfolioStore.getState().importPendingGrants();
  };
  const st = () => usePortfolioStore.getState();
  await Promise.all([st().loadPortfolio(), go(), go(), st().loadPortfolio(), go()]);
  await st().loadPortfolio();
  if (show(st().portfolio.grants) !== GOOD) { failures++; console.error('FAIL concurrent run', r, show(st().portfolio.grants)); }
}
console.log(failures === 0 ? 'all concurrent runs ok' : 'FAILURES: ' + failures);
process.exit(failures ? 1 : 0);
