// Token Radar's model, version radar-3, as the page itself runs it.
//
// This is the same derivation lib/model.ts runs in main.ts, in plain JavaScript
// the dossier shows whole: the page fits the size curve from the comparables
// shipped beside it (comps.js), prices every row with that fit, and re-runs the
// out-of-sample tests, so the number on the board is the number this code
// computes — no stored coefficient is taken on trust. A row is a protocol record
// (chains an array); a comp is the same shape with chains as a count.
//
//   log10(mcap) = intercept + slope x log10(tvl)   (OLS over the live comparables)
//   residual    = median log10 residual of the live tokens in the same category
//                 (at least 3 of them), else 0
//   base        = 10^(intercept + slope x log10(tvl_usd) + residual)
//   growth      = clamp(change_7d, -50, 150) per cent; unreported growth counts as 0
//   growthMult  = 1 + (growth / 100) x GROWTH_WEIGHT
//   maturity    = 0.55 + min(age_days, 1460) / 1460 x 0.25
//                 (age is days since first listing; an unreported listing uses 180 days)
//   chainMult   = 1 + 0.02 x min(chains - 1, 5)
//   implied     = max(1, round(base x growthMult x maturity x chainMult))
//
// Every number in the curve is computed from the snapshot at run time; no name and
// no number is ever special-cased.
(function (global) {
  'use strict';

  var DAY_MS = 86400000;

  function finite(value, fallback) {
    return typeof value === 'number' && isFinite(value) ? value : fallback;
  }

  function round4(n) { return Math.round(n * 1e4) / 1e4; }
  function round2(n) { return Math.round(n * 100) / 100; }

  /** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
  function ageDays(asOf, listedAt) {
    if (listedAt === null || listedAt === undefined) return null;
    var a = Date.parse(asOf + 'T00:00:00Z');
    var b = Date.parse(listedAt + 'T00:00:00Z');
    if (!isFinite(a) || !isFinite(b)) return null;
    return Math.max(0, Math.floor((a - b) / DAY_MS));
  }

  /** The median of a list of numbers. */
  function median(values) {
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) return sorted[mid];
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }

  /** A comp row from comps.js, [slug, tvl, mcap, category, chains, change_7d, listed_at], as a record. */
  function compFromRow(row) {
    return {
      slug: row[0], tvl_usd: row[1], mcap_usd: row[2], category: row[3],
      chains: row[4], change_7d: row[5], listed_at: row[6],
    };
  }

  /** The size curve: log10(market cap) against log10(TVL), fitted by least squares. */
  function fitSizeCurve(live) {
    var xs = live.map(function (p) { return Math.log10(p.tvl_usd); });
    var yLogs = live.map(function (p) { return Math.log10(p.mcap_usd); });
    var meanX = xs.reduce(function (a, b) { return a + b; }, 0) / xs.length;
    var meanY = yLogs.reduce(function (a, b) { return a + b; }, 0) / yLogs.length;
    var num = 0, den = 0;
    for (var i = 0; i < xs.length; i++) {
      num += (xs[i] - meanX) * (yLogs[i] - meanY);
      den += (xs[i] - meanX) * (xs[i] - meanX);
    }
    var slope = den === 0 ? 0 : num / den;
    return { intercept: meanY - slope * meanX, slope: slope };
  }

  /** The fitted curve and residuals: one median log10 residual per category. */
  function fitComps(live, model) {
    var curve = fitSizeCurve(live);
    var groups = Object.create(null);
    var order = [];
    for (var i = 0; i < live.length; i++) {
      var p = live[i];
      var key = p.category === null || p.category === undefined ? 'Other' : p.category;
      if (!groups[key]) { groups[key] = []; order.push(key); }
      groups[key].push(Math.log10(p.mcap_usd) - (curve.intercept + curve.slope * Math.log10(p.tvl_usd)));
    }
    var byCategory = Object.create(null);
    for (var j = 0; j < order.length; j++) {
      var cat = order[j];
      var list = groups[cat];
      if (list.length >= model.comps_min_n) byCategory[cat] = { n: list.length, residual: median(list), fallback: false };
      else byCategory[cat] = { n: list.length, residual: 0, fallback: true };
    }
    return { curve: curve, byCategory: byCategory };
  }

  /** A category's fitted residual off the size curve, or 0 when it has too few comps. */
  function compsFor(category, fit) {
    var key = category === null || category === undefined ? 'Other' : category;
    var entry = fit.byCategory[key];
    if (entry !== undefined) return { residual: entry.residual, n: entry.n, fallback: entry.fallback };
    return { residual: 0, n: 0, fallback: true };
  }

  /** How many chains a record spans: an array's length, or a comp's count. */
  function chainCount(p) {
    return typeof p.chains === 'number' ? p.chains : p.chains.length;
  }

  /** The multipliers and the implied value one protocol gets under `model`, its curve and residual. */
  function impliedValue(protocol, asOf, model, curve, residual) {
    var age = ageDays(asOf, protocol.listed_at);
    var rawGrowth = finite(protocol.change_7d, 0);
    var growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
    var growthMult = 1 + (growthPct / 100) * model.growth_weight;
    var ageForModel = age === null ? model.unknown_age_days : age;
    var maturityMult = model.maturity_floor +
      (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var extraChains = Math.min(Math.max(chainCount(protocol) - 1, 0), model.chain_max_extra);
    var chainMult = 1 + extraChains * model.chain_weight;
    var base = Math.pow(10, curve.intercept + curve.slope * Math.log10(protocol.tvl_usd) + residual);
    var implied = Math.max(1, Math.round(base * growthMult * maturityMult * chainMult));
    return { implied: implied, growthPct: growthPct, growthMult: growthMult, maturityMult: maturityMult, chainMult: chainMult, age: age };
  }

  /** One half of an out-of-sample test: fit on `fitHalf`, predict `testHalf`. */
  function oosFor(fitHalf, testHalf, asOf, model) {
    var fit = fitComps(fitHalf, model);
    var logErrors = [];
    var within2x = 0;
    for (var i = 0; i < testHalf.length; i++) {
      var p = testHalf[i];
      var r = compsFor(p.category, fit);
      var imp = impliedValue(p, asOf, model, fit.curve, r.residual).implied;
      var actual = p.mcap_usd;
      var logErr = Math.abs(Math.log10(imp / actual));
      logErrors.push(logErr);
      if (imp / actual >= 0.5 && imp / actual <= 2) within2x += 1;
    }
    var factor = logErrors.length > 0 ? Math.pow(10, median(logErrors)) : 1;
    return {
      factor: round2(factor),
      within_2x: testHalf.length > 0 ? round2(within2x / testHalf.length) : 0,
    };
  }

  /** The out-of-sample test, on both halves of the slug split. */
  function validateComps(live, asOf, model) {
    var sorted = live.slice().sort(function (a, b) { return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0; });
    var even = sorted.filter(function (_, i) { return i % 2 === 0; });
    var odd = sorted.filter(function (_, i) { return i % 2 === 1; });
    var a = oosFor(even, odd, asOf, model);
    var b = oosFor(odd, even, asOf, model);
    return {
      fit_n: even.length, test_n: odd.length,
      oos_factor: a.factor, within_2x: a.within_2x,
      oos_factor_b: b.factor, within_2x_b: b.within_2x,
      time_split: validateTimeSplit(live, asOf, model),
      bootstrap: bootstrapCurve(live, model),
    };
  }

  /** The time split: older listings fit, newer listings test, cut at the median listing date. */
  function validateTimeSplit(live, asOf, model) {
    var dated = live.filter(function (p) { return p.listed_at !== null && p.listed_at !== undefined; });
    if (dated.length < 20) return null;
    var dates = dated.map(function (p) { return p.listed_at; }).sort();
    var cutoff = dates[Math.floor(dates.length / 2)];
    var fitHalf = dated.filter(function (p) { return p.listed_at < cutoff; });
    var testHalf = dated.filter(function (p) { return p.listed_at >= cutoff; });
    if (fitHalf.length < 10 || testHalf.length < 10) return null;
    var r = oosFor(fitHalf, testHalf, asOf, model);
    return { cutoff: cutoff, fit_n: fitHalf.length, test_n: testHalf.length, factor: r.factor, within_2x: r.within_2x };
  }

  /** A small deterministic generator: the same seed always draws the same resamples. */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** The middle half of a list of numbers, as [low, high]. */
  function quartiles(values) {
    var s = values.slice().sort(function (a, b) { return a - b; });
    function q(f) {
      var pos = (s.length - 1) * f;
      var lo = Math.floor(pos);
      var hi = Math.ceil(pos);
      return s[lo] + (s[hi] - s[lo]) * (pos - lo);
    }
    return [q(0.25), q(0.75)];
  }

  /** The bootstrap: the size curve refitted on 200 resamples of the comps, middle half of slope and intercept. */
  function bootstrapCurve(live, model, resamples, seed) {
    if (live.length < 10) return null;
    resamples = resamples === undefined ? 200 : resamples;
    seed = seed === undefined ? 1 : seed;
    var rand = mulberry32(seed);
    var slopes = [];
    var intercepts = [];
    for (var r = 0; r < resamples; r++) {
      var sample = [];
      for (var i = 0; i < live.length; i++) sample.push(live[Math.floor(rand() * live.length)]);
      var curve = fitSizeCurve(sample);
      slopes.push(curve.slope);
      intercepts.push(curve.intercept);
    }
    var sq = quartiles(slopes);
    var iq = quartiles(intercepts);
    return {
      resamples: resamples,
      slope_low: round2(sq[0]), slope_high: round2(sq[1]),
      intercept_low: round2(iq[0]), intercept_high: round2(iq[1]),
    };
  }

  /** The page's whole fit: curve, per-category residuals, and every validation, from the comps. */
  function fitPage(compRows, model, asOf) {
    var live = compRows.map(compFromRow);
    var fit = fitComps(live, model);
    var cats = [];
    for (var key in fit.byCategory) {
      var v = fit.byCategory[key];
      cats.push({
        category: key, n: v.n, residual: round4(v.residual),
        residual_factor: round4(Math.pow(10, v.residual)), fallback: v.fallback,
      });
    }
    cats.sort(function (a, b) { return b.n - a.n || (a.category < b.category ? -1 : 1); });
    return { live: live, curve: fit.curve, fit: fit, categories: cats, validation: validateComps(live, asOf, model) };
  }

  global.RadarModel = {
    ageDays: ageDays, median: median, compFromRow: compFromRow,
    fitSizeCurve: fitSizeCurve, fitComps: fitComps, compsFor: compsFor,
    impliedValue: impliedValue, validateComps: validateComps,
    validateTimeSplit: validateTimeSplit, bootstrapCurve: bootstrapCurve, fitPage: fitPage,
  };
})(typeof window !== 'undefined' ? window : globalThis);
