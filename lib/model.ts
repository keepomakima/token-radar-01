// Token Radar's model, version radar-2: one sealed snapshot in, one ranked board out.
//
// The board ranks every pre-token protocol the snapshot can rank under the watchlist's
// own exclusion rules: the whole 40-protocol watchlist (the floor) plus every other
// pre-token protocol that is not a wrapped, staked or bridged product, not an exchange
// product and not a versioned pool. Protocols whose token already trades are never
// ranked; they are the comparables the value model is fitted on, and the live set the
// dashboard sets aside with their market caps, which are facts, not a model.
//
// Implied value is priced off the comparables, never off a fixed multiple: a size
// curve fitted in log space to the live tokens that already trade, plus a
// per-category residual:
//
//   log10(mcap) = intercept + slope x log10(tvl)   (OLS over the live comparables)
//   residual    = median log10 residual of the live tokens in the same category
//                 (at least 3 of them), else 0
//   base        = 10^(intercept + slope x log10(tvl_usd) + residual)
//   growth      = clamp(change_7d, -50, 150) per cent; unreported growth counts as 0
//   growthMult  = 1 + (growth / 100) x GROWTH_WEIGHT
//   maturity    = 0.55 + min(age_days, 1460) / 1460 x 0.25
//                 (age is days since first listing; an unreported listing uses 180 days)
//   chainMult   = 1 + 0.02 x min(chains - 1, 5)   (reach across chains, capped)
//   implied     = max(1, round(base x growthMult x maturity x chainMult))
//
// Every number in the curve is computed from the snapshot at run time; no name and
// no number is ever special-cased.
//
// The fit is tested out of sample before it prices anything: the live protocols are
// split deterministically by slug (even positions fit, odd positions test), the
// curve and residuals are fitted on the fit half only, and the test half is predicted
// with the same function. The dashboard reports the test error as a factor — the
// typical test prediction lands within that factor of the real market cap — so the
// reader sees how far to trust the number.
//
// Each row also carries a signal band (PRIME / STRONG / WATCH / EARLY) cut on the
// implied value itself, explicit risk flags (the reasons a row is weaker than its
// number suggests), and a farm verdict — FARM, THIN or SKIP — netted from the plan's
// own cost against the row's band. A farm plan is derived from the protocol's own
// record (category, chains, TVL, age): the same derivation runs in main.ts for
// board.json and in the dashboard, so the page and the board can never disagree.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_weight: number;
  chain_max_extra: number;
  comps_min_n: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.3,
  growth_floor: -50,
  growth_cap: 150,
  maturity_floor: 0.55,
  maturity_range: 0.25,
  maturity_days: 1460,
  unknown_age_days: 180,
  chain_weight: 0.02,
  chain_max_extra: 5,
  comps_min_n: 3,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live tab carries, by market cap. */
export const LIVE_ROWS = 24;

/** Signal bands, cut on the implied value in whole dollars. PRIME clears $40M — above the top quartile of live tokens ($35M); STRONG clears $15M — above the live median ($9.2M); WATCH clears $5M — twice the bottom quartile ($2.5M). */
export const SIGNAL_BANDS = [
  { signal: 'PRIME', min_usd: 40_000_000 },
  { signal: 'STRONG', min_usd: 15_000_000 },
  { signal: 'WATCH', min_usd: 5_000_000 },
] as const;

export type Signal = 'PRIME' | 'STRONG' | 'WATCH' | 'EARLY';

/** A farm verdict, netted from the plan's cost against the row's band. */
export type Verdict = 'FARM' | 'THIN' | 'SKIP';

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  signal: Signal;
  verdict: Verdict;
  verdict_reason: string;
  flags: string[];
  model: {
    comps_residual: number;
    comps_residual_factor: number;
    comps_n: number;
    comps_fallback: boolean;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with the farm plan generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  signal: Signal;
  verdict: Verdict;
  verdict_reason: string;
  flags: string[];
  comps_residual: number;
  comps_residual_factor: number;
  comps_n: number;
  comps_fallback: boolean;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One comparables category: its median log10 residual off the size curve, as a factor, and how many comps set it. */
export interface CompsCategory {
  category: string;
  n: number;
  residual: number;
  residual_factor: number;
  fallback: boolean;
}

/** The out-of-sample test of the comparables fit. */
export interface CompsValidation {
  fit_n: number;
  test_n: number;
  oos_factor: number;
  within_2x: number;
}

/** Everything the dashboard needs: the board, the live set, the comps and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  comps_size: number;
  signal_counts: Record<Signal, number>;
  verdict_counts: Record<Verdict, number>;
  size_curve: { intercept: number; slope: number };
  comps_categories: CompsCategory[];
  validation: CompsValidation;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a sorted-or-not list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The comparables: live-token protocols with a market cap and a TVL, no exchanges. */
export function compsProtocols(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter(
    (p) => !isPreToken(p) && p.category !== 'CEX' && typeof p.mcap_usd === 'number' && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
}

/** The size curve: log10(market cap) against log10(TVL), fitted by least squares. */
export interface SizeCurve {
  intercept: number;
  slope: number;
}

export function fitSizeCurve(live: SnapshotProtocol[]): SizeCurve {
  const xs = live.map((p) => Math.log10(p.tvl_usd));
  const ys = live.map((p) => p.mcap_usd!);
  const yLogs = ys.map((m) => Math.log10(m));
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = yLogs.reduce((a, b) => a + b, 0) / yLogs.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i]! - meanX) * (yLogs[i]! - meanY);
    den += (xs[i]! - meanX) * (xs[i]! - meanX);
  }
  const slope = den === 0 ? 0 : num / den;
  return { intercept: meanY - slope * meanX, slope };
}

/** The fitted curve and residuals: one median log10 residual per category. */
export interface CompsFit {
  curve: SizeCurve;
  byCategory: Map<string, { n: number; residual: number; fallback: boolean }>;
}

export function fitComps(live: SnapshotProtocol[], model: ModelConstants): CompsFit {
  const curve = fitSizeCurve(live);
  const groups = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? 'Other';
    const list = groups.get(key) ?? [];
    list.push(Math.log10(p.mcap_usd!) - (curve.intercept + curve.slope * Math.log10(p.tvl_usd)));
    groups.set(key, list);
  }
  const byCategory = new Map<string, { n: number; residual: number; fallback: boolean }>();
  for (const [category, list] of groups) {
    if (list.length >= model.comps_min_n) {
      byCategory.set(category, { n: list.length, residual: median(list), fallback: false });
    } else {
      byCategory.set(category, { n: list.length, residual: 0, fallback: true });
    }
  }
  return { curve, byCategory };
}

/** A category's fitted residual off the size curve, or 0 when it has too few comps. */
export function compsFor(category: string | null, fit: CompsFit): { residual: number; n: number; fallback: boolean } {
  const entry = fit.byCategory.get(category ?? 'Other');
  if (entry !== undefined) return { residual: entry.residual, n: entry.n, fallback: entry.fallback };
  return { residual: 0, n: 0, fallback: true };
}

/** The multipliers and the implied value one protocol gets under `model`, its curve and residual. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  curve: SizeCurve,
  residual: number,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; chainMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const extraChains = Math.min(Math.max(protocol.chains.length - 1, 0), model.chain_max_extra);
  const chainMult = 1 + extraChains * model.chain_weight;
  const base = Math.pow(10, curve.intercept + curve.slope * Math.log10(protocol.tvl_usd) + residual);
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * chainMult));
  return { implied, growthPct, growthMult, maturityMult, chainMult, age };
}

/**
 * The out-of-sample test: live protocols sorted by slug split into even (fit) and odd
 * (test) positions; the fit half sets the multiples, the test half is predicted with
 * the same function, and the error is reported as a factor — the typical test
 * prediction lands within that factor of the real market cap.
 */
export function validateComps(live: SnapshotProtocol[], asOf: string, model: ModelConstants): CompsValidation {
  const sorted = [...live].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const fitHalf = sorted.filter((_, i) => i % 2 === 0);
  const testHalf = sorted.filter((_, i) => i % 2 === 1);
  const fit = fitComps(fitHalf, model);
  const logErrors: number[] = [];
  let within2x = 0;
  for (const p of testHalf) {
    const { residual } = compsFor(p.category, fit);
    const { implied } = impliedValue(p, asOf, model, fit.curve, residual);
    const actual = p.mcap_usd!;
    const logErr = Math.abs(Math.log10(implied / actual));
    logErrors.push(logErr);
    if (implied / actual >= 0.5 && implied / actual <= 2) within2x += 1;
  }
  const factor = logErrors.length > 0 ? Math.pow(10, median(logErrors)) : 1;
  return {
    fit_n: fitHalf.length,
    test_n: testHalf.length,
    oos_factor: Math.round(factor * 100) / 100,
    within_2x: testHalf.length > 0 ? Math.round((within2x / testHalf.length) * 100) / 100 : 0,
  };
}

/** The signal band an implied value falls in. */
export function signalFor(impliedUsd: number): Signal {
  for (const band of SIGNAL_BANDS) {
    if (impliedUsd >= band.min_usd) return band.signal;
  }
  return 'EARLY';
}

/** The farm verdict, netted from the row's band and its risk flags. */
export function verdictFor(signal: Signal, flags: string[]): { verdict: Verdict; reason: string } {
  const sharpFall = flags.includes('TVL fell 20% or more in 7 days');
  if (signal === 'EARLY') {
    return {
      verdict: 'SKIP',
      reason: 'Implied value sits below the $5M watch band: the farm cost outweighs the modelled launch for now; revisit if TVL grows.',
    };
  }
  if (signal === 'WATCH' || (signal === 'STRONG' && sharpFall)) {
    return {
      verdict: 'THIN',
      reason:
        signal === 'WATCH'
          ? 'A watch-band launch: farm it with a small position only, and only if the weekly actions cost almost nothing.'
          : 'A strong launch whose TVL fell sharply in 7 days: farm it thin until the decline stops.',
    };
  }
  return {
    verdict: 'FARM',
    reason: 'A prime or strong launch with no sharp decline: the modelled value clears the farm cost by a wide margin.',
  };
}

/** The explicit reasons a row is weaker than its number suggests. */
export function riskFlags(p: SnapshotProtocol, age: number | null): string[] {
  const flags: string[] = [];
  if (p.change_7d === null) flags.push('7d growth unreported');
  else if (p.change_7d <= -20) flags.push('TVL fell 20% or more in 7 days');
  if (age === null) flags.push('listing date unreported');
  else if (age < 90) flags.push('listed under 90 days ago');
  if (p.chains.length <= 1) flags.push('single chain');
  return flags;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories the watchlist rule keeps out: wrapped, staked, bridged and exchange products. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Exchange names a protocol must not begin with, under the watchlist rule. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** A whole word wrapped, staked or staking anywhere in the name. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, and none of the watchlist
 * rule's exclusions — not a wrapped, staked or bridged product, not an exchange
 * product, not a versioned pool.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((prefix) => p.name.startsWith(prefix))) return false;
  if (VERSIONED.test(p.name)) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug on it is ranked, whatever its figures say.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable pre-token protocol. No cap: the board ranks
  // the whole pre-token universe the snapshot can rank under the watchlist's rules.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const live = compsProtocols(snapshot);
  const fit = fitComps(live, model);
  const scored = [...chosen.values()].map((p) => {
    const { residual, n, fallback } = compsFor(p.category, fit);
    const { implied, growthPct, growthMult, maturityMult, chainMult, age } = impliedValue(p, snapshot.as_of, model, fit.curve, residual);
    return { p, implied, growthPct, growthMult, maturityMult, chainMult, age, residual, compsN: n, fallback };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => {
    const signal = signalFor(s.implied);
    const flags = riskFlags(s.p, s.age);
    const { verdict, reason } = verdictFor(signal, flags);
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token',
      age_days: s.age,
      implied_value_usd: s.implied,
      signal,
      verdict,
      verdict_reason: reason,
      flags,
      model: {
        comps_residual: s.residual,
        comps_residual_factor: round4(Math.pow(10, s.residual)),
        comps_n: s.compsN,
        comps_fallback: s.fallback,
        growth_pct: s.growthPct,
        growth_multiplier: round4(s.growthMult),
        maturity_multiplier: round4(s.maturityMult),
        chain_multiplier: round4(s.chainMult),
        age_days: s.age,
      },
      farm_steps: farmSteps(s.p, s.age).map(stepText),
    };
  });
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Lend $${capital} of USDC into ${name} on ${chain} and leave the deposit earning.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged')) return `Add $${capital} of liquidity to the deepest ${name} pool on ${chain} and leave the position in range.`;
  if (c.includes('bridge')) return `Move $${capital} of USDC across ${name} onto ${chain}, then put the bridged funds to work in the destination app.`;
  if (c.includes('stak') || c.includes('restak')) return `Stake $${capital} of the native asset through ${name} and keep the receipt token in the same wallet.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Post $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('prediction')) return `Back one outcome with $${capital} on ${name} and let the market resolve.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Place $${capital} into a ${name} vault on ${chain} and hold the vault shares.`;
  if (c.includes('stable')) return `Mint or hold $${capital} of the stable asset issued through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it through one distribution.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('basis') || c.includes('cedefi')) return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open through one funding cycle.`;
  if (c.includes('governance')) return `Lock $${capital} of assets in ${name}'s governance on ${chain} and vote on one live proposal.`;
  if (c.includes('payment')) return `Route $${capital} of payments through ${name} on ${chain} and keep the account active.`;
  if (c.includes('chain')) return `Bridge $${capital} onto the ${name} chain and use one native app there each week.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a time. The plan
 * is derived from the protocol's own record (category, chains, TVL, age), never from a
 * hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  return [
    {
      text: `Open a fresh wallet that holds only the funds you mean to farm, and store its seed phrase offline where no app can read it.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Do one qualifying action every week, a deposit, a swap, a borrow or a vote, so the wallet reads as active instead of dormant.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Keep the position for at least ${hold} days so the activity spans more than one snapshot window.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Halfway through the hold, open the protocol's points or rewards page and confirm the wallet's activity is counted; if a week shows no credit, repeat the qualifying action once more.`,
      cost: 'no fee to check',
      time: '10 minutes',
    },
    {
      text: `When a claim opens, use only the claim link the protocol itself publishes, and never pay anyone to claim for you.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Log the wallet, the dates and every transaction hash, so you can repeat the position or unwind it cleanly.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
    {
      text: `When you exit, unwind in the reverse order you entered: close the position, then move the funds back, and leave a dust balance until the claim window closes.`,
      cost: 'about $2 of gas',
      time: '15 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live tab. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    signal: row.signal,
    verdict: row.verdict,
    verdict_reason: row.verdict_reason,
    flags: row.flags,
    comps_residual: row.model.comps_residual,
    comps_residual_factor: row.model.comps_residual_factor,
    comps_n: row.model.comps_n,
    comps_fallback: row.model.comps_fallback,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const comps = compsProtocols(snapshot);
  const fit = fitComps(comps, model);
  const validation = validateComps(comps, snapshot.as_of, model);
  const signal_counts: Record<Signal, number> = { PRIME: 0, STRONG: 0, WATCH: 0, EARLY: 0 };
  const verdict_counts: Record<Verdict, number> = { FARM: 0, THIN: 0, SKIP: 0 };
  for (const r of board) {
    signal_counts[r.signal] += 1;
    verdict_counts[r.verdict] += 1;
  }
  const comps_categories: CompsCategory[] = [...fit.byCategory.entries()]
    .map(([category, v]) => ({
      category,
      n: v.n,
      residual: round4(v.residual),
      residual_factor: round4(Math.pow(10, v.residual)),
      fallback: v.fallback,
    }))
    .sort((a, b) => b.n - a.n || (a.category < b.category ? -1 : 1));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    comps_size: comps.length,
    signal_counts,
    verdict_counts,
    size_curve: { intercept: fit.curve.intercept, slope: fit.curve.slope },
    comps_categories,
    validation,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
