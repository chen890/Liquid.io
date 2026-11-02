/** Unit test for the comparison chart maths. Run: node --import ./scripts/register-hook.mjs --experimental-strip-types scripts/regress-compare.mts */
import { computeComparison } from '../src/lib/compare.ts';
const c = (time: number, close: number) => ({ time, open: close, high: close, low: close, close, volume: 1 });
let fails = 0;
const ok = (cond: boolean, msg: string) => { if (!cond) { fails++; console.error('FAIL', msg); } else console.log('ok  ', msg); };
const A = [c(100, 10), c(200, 11), c(300, 12)];
const B = [c(100, 200), c(200, 180), c(300, 220)];
const r = computeComparison([{ ticker: 'A', candles: A }, { ticker: 'B', candles: B }]);
ok(r.baseTime === 100, 'base is the shared first date');
ok(Math.abs(r.series[0].lastPct! - 20) < 1e-9 && Math.abs(r.series[1].lastPct! - 10) < 1e-9, 'percent change from base, price level irrelevant');
ok(r.series[0].points[0].pct === 0 && r.series[1].points[0].pct === 0, 'every line starts at 0%');
// late-starting series: base moves to its first date, no one is compared to a date before their data
const L = [c(200, 50), c(300, 55)];
const r2 = computeComparison([{ ticker: 'A', candles: A }, { ticker: 'L', candles: L }]);
ok(r2.baseTime === 200 && Math.abs(r2.series[0].lastPct! - (12 / 11 - 1) * 100) < 1e-9, 'late series moves the shared base');
ok(Math.abs(r2.series[1].lastPct! - 10) < 1e-9, 'late series percent from its first close');
// missing data
const r3 = computeComparison([{ ticker: 'A', candles: A }, { ticker: 'X', candles: [] }]);
ok(r3.missing.join() === 'X' && r3.series.length === 1, 'series without data are reported missing, not drawn');
ok(computeComparison([{ ticker: 'X', candles: [] }]).baseTime === null, 'nothing usable gives no base');
// stale series stays visible via lastTime
const S = [c(100, 5), c(150, 6)];
const r4 = computeComparison([{ ticker: 'A', candles: A }, { ticker: 'S', candles: S }]);
ok(r4.series[1].lastTime === 150 && r4.series[0].lastTime === 300, 'last data date per series is kept');
process.exit(fails ? 1 : 0);
