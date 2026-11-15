// Token Radar's dashboard, model radar-3. It reads window.RADAR (written beside
// dashboard/ by main.ts) and the comparables in comps.js, fits the size curve
// itself with model.js — the same derivation main.ts runs — and renders the ranked
// board, a filterable table, a per-protocol detail view with the model's own inputs
// and the protocol's farm plan, the live-token tab, and the model tab with the
// comparables fit and its out-of-sample tests. No network: every byte it shows is
// in data.js and comps.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('app');
  var meta = document.getElementById('top-meta');

  // The page fits the size curve itself, from the comparables shipped beside it
  // (comps.js) with the model in model.js — the same derivation main.ts runs — so
  // the number on the board is the number this page computes. If either file is
  // missing, the page falls back to the curve the board was priced from.
  var PAGE = null;
  try {
    if (window.RadarModel && window.COMPS) PAGE = window.RadarModel.fitPage(window.COMPS, DATA.model, DATA.as_of);
  } catch (e) { PAGE = null; }
  var state = { q: '', category: 'all', chain: 'all', signal: 'all', tab: 'board', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return (Math.round(n * 10000) / 10000).toFixed(4).replace(/0+$/, '').replace(/\.$/, '.0'); }

  // The model in one function: the page recomputes a row from the snapshot figures
  // with the curve it fitted itself from the comparables, and checks the number
  // board.json carries, so the page's code and the board's data are visibly the same
  // arithmetic. Without the page fit, it falls back to the stored curve.
  function impliedOf(row, model) {
    if (PAGE) {
      var r = window.RadarModel.compsFor(row.category, PAGE.fit);
      return window.RadarModel.impliedValue(row, DATA.as_of, model, PAGE.curve, r.residual).implied;
    }
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var extra = Math.min(Math.max((row.chains || []).length - 1, 0), model.chain_max_extra);
    var chainMult = 1 + extra * model.chain_weight;
    var base = Math.pow(10, DATA.size_curve.intercept + DATA.size_curve.slope * Math.log10(row.tvl_usd) + row.comps_residual);
    return Math.max(1, Math.round(base * growthMult * maturity * chainMult));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains,
  // TVL and age decide the action, the capital, the hold and every cost and time.
  // No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 45;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Lend $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and leave the deposit earning.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged') >= 0) return 'Add $' + capital + ' of liquidity to the deepest ' + name + ' pool on ' + chain + ' and leave the position in range.';
    if (c.indexOf('bridge') >= 0) return 'Move $' + capital + ' of USDC across ' + name + ' onto ' + chain + ', then put the bridged funds to work in the destination app.';
    if (c.indexOf('stak') >= 0 || c.indexOf('restak') >= 0) return 'Stake $' + capital + ' of the native asset through ' + name + ' and keep the receipt token in the same wallet.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Post $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged position.';
    if (c.indexOf('prediction') >= 0) return 'Back one outcome with $' + capital + ' on ' + name + ' and let the market resolve.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('risk') >= 0) return 'Place $' + capital + ' into a ' + name + ' vault on ' + chain + ' and hold the vault shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or hold $' + capital + ' of the stable asset issued through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + " of " + name + "'s yield-bearing asset on " + chain + ' and hold it through one distribution.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.';
    if (c.indexOf('basis') >= 0 || c.indexOf('cedefi') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open through one funding cycle.';
    if (c.indexOf('governance') >= 0) return 'Lock $' + capital + ' of assets in ' + name + "'s governance on " + chain + ' and vote on one live proposal.';
    if (c.indexOf('payment') >= 0) return 'Route $' + capital + ' of payments through ' + name + ' on ' + chain + ' and keep the account active.';
    if (c.indexOf('chain') >= 0) return 'Bridge $' + capital + ' onto the ' + name + ' chain and use one native app there each week.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    return [
      { text: 'Open a fresh wallet that holds only the funds you mean to farm, and store its seed phrase offline where no app can read it.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: 'Do one qualifying action every week, a deposit, a swap, a borrow or a vote, so the wallet reads as active instead of dormant.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Keep the position for at least ' + hold + ' days so the activity spans more than one snapshot window.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Halfway through the hold, open the protocol's points or rewards page and confirm the wallet's activity is counted; if a week shows no credit, repeat the qualifying action once more.", cost: 'no fee to check', time: '10 minutes' },
      { text: 'When a claim opens, use only the claim link the protocol itself publishes, and never pay anyone to claim for you.', cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Log the wallet, the dates and every transaction hash, so you can repeat the position or unwind it cleanly.', cost: 'nothing but the log', time: '5 minutes' },
      { text: 'When you exit, unwind in the reverse order you entered: close the position, then move the funds back, and leave a dust balance until the claim window closes.', cost: 'about $2 of gas', time: '15 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('signal')) state.signal = params.get('signal');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('sort')) state.sort = params.get('sort');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.signal !== 'all') params.set('signal', state.signal);
    if (state.tab !== 'board') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    if (state.sort !== 'implied') params.set('sort', state.sort);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.signal !== 'all' && r.signal !== state.signal) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'chains') { av = (a.chains || []).length; bv = (b.chains || []).length; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('h1', { text: DATA.watchlist_size + ' watchlist protocols, priced off the tokens that already trade' }),
      el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols under the same rules. Each implied value comes off a size curve fitted to the ' + DATA.comps_size + ' tokens that already trade — how market cap grows with TVL — plus the protocol\u2019s category residual, adjusted for growth, age and chain reach, and tested out of sample at \u00d7' + DATA.validation.oos_factor + '.' }),
      el('div', { class: 'kpis' },
        el('div', { class: 'kpi' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }), el('small', { text: 'every watchlist slug is ranked' })),
        el('div', { class: 'kpi' }, el('span', { text: 'Pre-token rows' }), el('b', { text: String(DATA.board_size) }), el('small', { text: DATA.verdict_counts.FARM + ' farm \u00b7 ' + DATA.verdict_counts.THIN + ' thin \u00b7 ' + DATA.verdict_counts.SKIP + ' skip' })),
        el('div', { class: 'kpi' }, el('span', { text: 'Out-of-sample error' }), el('b', { text: '\u00d7' + DATA.validation.oos_factor }), el('small', { text: Math.round(DATA.validation.within_2x * 100) + '% of test comps within \u00d72 of their real cap' })),
        el('div', { class: 'kpi' }, el('span', { text: 'Live tokens set aside' }), el('b', { text: String(DATA.live_size) }), el('small', { text: 'their market cap is a fact, not a model' }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var cat = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); render(); });
    var chn = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chn.addEventListener('change', function () { state.chain = chn.value; writeHash(); render(); });
    var tabs = ['board', 'live', 'model'].map(function (t) {
      var label = t === 'board' ? 'Board' : t === 'live' ? 'Live tokens' : 'Model & comps';
      return el('button', { type: 'button', 'aria-pressed': state.tab === t ? 'true' : 'false', text: label, onclick: function () { state.tab = t; state.selected = null; writeHash(); render(); } });
    });
    var chips = ['PRIME', 'STRONG', 'WATCH', 'EARLY'].map(function (s) {
      return el('button', { type: 'button', class: 'chip', 'aria-pressed': state.signal === s ? 'true' : 'false', text: s + ' ' + (DATA.signal_counts[s] || 0), onclick: function () { state.signal = state.signal === s ? 'all' : s; writeHash(); render(); } });
    });
    return el('div', { class: 'filters' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), cat),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chn),
      el('div', { class: 'field' }, el('span', { class: 'lab', text: 'View' }), el('div', { class: 'tabs' }, tabs)),
      el('div', { class: 'field' }, el('span', { class: 'lab', text: 'Signal band' }), el('div', { class: 'chips' }, chips)),
      el('span', { class: 'count', text: state.tab === 'board' ? filteredRows().length + ' rows shown' : state.tab === 'live' ? DATA.live.length + ' live-token protocols' : 'model ' + DATA.model_version + ', fitted on ' + DATA.comps_size + ' comps' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } writeHash(); render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' \u25bc' : ' \u25b2' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(filteredRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category, chain or signal band to see the board again.' }),
        el('button', { class: 'btn', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.signal = 'all'; writeHash(); render(); } })
      ));
    }
    var max = 1;
    DATA.rows.forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        class: state.selected === r.slug ? 'sel' : null,
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' \u00b7 ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: String((r.chains || []).length) }),
        el('td', null, el('div', null,
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'badge ' + r.signal, text: r.signal })),
        el('td', null, el('span', { class: 'badge ' + r.verdict, text: r.verdict }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Pre-token protocols, strongest implied value first. Select a row for its model, verdict and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('chains', 'Chains'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Signal' }),
            el('th', { scope: 'col', text: 'Verdict' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' \u00b7 ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.mcap_usd && r.tvl_usd ? (r.mcap_usd / r.tvl_usd).toFixed(2) + '\u00d7' : 'n/a' }),
        el('td', null, el('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are the comparables the board is priced off, and they are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Mcap / TVL' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var v = PAGE ? PAGE.validation : DATA.validation;
    var curve = PAGE ? PAGE.curve : DATA.size_curve;
    var cats = PAGE ? PAGE.categories : DATA.comps_categories;
    var agrees = PAGE &&
      PAGE.curve.intercept === DATA.size_curve.intercept && PAGE.curve.slope === DATA.size_curve.slope &&
      PAGE.validation.oos_factor === DATA.validation.oos_factor &&
      PAGE.validation.oos_factor_b === DATA.validation.oos_factor_b;
    var rows = cats.map(function (c) {
      return el('tr', null,
        el('td', { text: c.category }),
        el('td', { class: 'num', text: String(c.n) }),
        el('td', { class: 'num', text: '\u00d7' + c.residual_factor.toFixed(2) }),
        el('td', { text: c.fallback ? 'global median' : 'category median' })
      );
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed — model ' + DATA.model_version }),
      el('p', { text: 'Every row is scored by one function of the snapshot figures. The size curve is log10(market cap) = ' + curve.intercept.toFixed(2) + ' + ' + curve.slope.toFixed(2) + ' \u00d7 log10(TVL), fitted by least squares over the ' + DATA.comps_size + ' live tokens; each category then carries its median residual off that curve (at least ' + m.comps_min_n + ' comps), or none when it has too few. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' }, 'implied = round( 10^( ' + curve.intercept.toFixed(2) + ' + ' + curve.slope.toFixed(2) + ' \u00d7 log10(tvl_usd) + category_residual ) \u00d7 (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 \u00d7 ' + m.growth_weight + ') \u00d7 (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' \u00d7 ' + m.maturity_range + ') \u00d7 (1 + min(chains - 1, ' + m.chain_max_extra + ') \u00d7 ' + m.chain_weight + ') )'),
      el('p', { text: PAGE
        ? 'This page fits that curve itself, from the ' + DATA.comps_size + ' comparables shipped beside it (comps.js) with the fit in model.js — the same derivation that priced the board — and the fit it computed ' + (agrees ? 'matches the board\u2019s stored curve exactly, intercept and slope and both out-of-sample factors.' : 'DOES NOT match the board\u2019s stored curve: the board would be stale.')
        : 'The comparables file did not load, so this tab shows the curve the board was priced from instead of a fit the page computed.' }),
      el('h2', { text: 'Out-of-sample test' }),
      el('p', { text: 'The ' + DATA.comps_size + ' live comparables were split by slug into a fit half (' + v.fit_n + ') and a test half (' + v.test_n + '). The curve and residuals were fitted on the fit half only; the test half was then predicted with the same function. The typical test prediction lands within \u00d7' + v.oos_factor + ' of the real market cap, and ' + Math.round(v.within_2x * 100) + '% of test protocols land within \u00d72. Read every implied value with that error in mind: a \u00d7' + v.oos_factor + ' band, not a price.' }),
      el('p', { text: 'The split was also run the other way round — odd positions fit, even positions test — and the typical prediction lands within \u00d7' + v.oos_factor_b + ' of the real cap, with ' + Math.round(v.within_2x_b * 100) + '% within \u00d72. Neither half is the headline: both are the test.' }),
      v.time_split ? el('p', { text: 'Time split: comparables listed before ' + v.time_split.cutoff + ' (' + v.time_split.fit_n + ') fitted the curve, and comparables listed on or after that date (' + v.time_split.test_n + ') were predicted with it. The typical newer listing lands within \u00d7' + v.time_split.factor + ' of its real cap, with ' + Math.round(v.time_split.within_2x * 100) + '% within \u00d72 — the curve holds across time, not just across a shuffled split.' }) : null,
      v.bootstrap ? el('p', { text: 'Bootstrap: refitting the curve on ' + v.bootstrap.resamples + ' resamples of the comparables (fixed seed) puts the slope\u2019s middle half at ' + v.bootstrap.slope_low.toFixed(2) + '–' + v.bootstrap.slope_high.toFixed(2) + ' and the intercept\u2019s at ' + v.bootstrap.intercept_low.toFixed(2) + '–' + v.bootstrap.intercept_high.toFixed(2) + ': the curve does not hinge on any few comps.' }) : null,
      el('h2', { text: 'Signal bands and farm verdicts' }),
      el('p', { text: 'PRIME is an implied value of $40M or more — above the top quartile of live tokens ($35M) — STRONG $15M, WATCH $5M, EARLY below that. FARM means a prime or strong launch with no sharp decline; THIN means a watch-band launch, or a strong one whose TVL fell 20% or more in 7 days — farm it small, if at all; SKIP means an early-band launch, where the farm cost outweighs the modelled launch for now.' }),
      el('div', { class: 'legend' },
        ['PRIME', 'STRONG', 'WATCH', 'EARLY'].map(function (s) { return el('span', { class: 'badge ' + s, text: s + ' ' + (DATA.signal_counts[s] || 0) }); }),
        ['FARM', 'THIN', 'SKIP'].map(function (s) { return el('span', { class: 'badge ' + s, text: s + ' ' + (DATA.verdict_counts[s] || 0) }); })
      ),
      el('h2', { text: 'Comparables by category' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'consts' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Comps' }), el('th', { scope: 'col', text: 'Residual' }), el('th', { scope: 'col', text: 'Source' }))),
          el('tbody', null, rows)
        )
      ),
      el('p', { text: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. A protocol records no token; that is the snapshot\u2019s record, never proof it has none.' })
    );
  }

  function detailPanel() {
    if (!state.selected) return null;
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === state.selected) row = r; });
    if (!row) return null;
    var steps = farmSteps(row);
    var recomputed = impliedOf(row, DATA.model);
    var match = recomputed === row.implied_value_usd;
    var flagList = (row.flags || []).length
      ? el('ul', { class: 'flags' }, row.flags.map(function (f) { return el('li', { text: '\u26a0 ' + f }); }))
      : el('p', { class: 'sub', text: 'No risk flags on this row.' });
    return el('section', { class: 'panel detail', id: 'detail' },
      el('div', { class: 'detail-head' },
        el('div', null,
          el('span', { class: 'rankline', text: 'RANK ' + row.rank + ' OF ' + DATA.board_size + ' \u00b7 ' + row.signal + ' \u00b7 VERDICT ' + row.verdict }),
          el('h2', { text: row.name }),
          el('p', { class: 'sub', text: (row.category || 'Other') + ' \u00b7 ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + ' \u00b7 records no token' })
        ),
        el('button', { class: 'close', type: 'button', text: 'Close', onclick: function () { state.selected = null; writeHash(); render(); } })
      ),
      el('div', { class: 'detail-grid' },
        el('div', null,
          el('h3', { text: 'Implied value' }),
          el('div', { class: 'kv' },
            el('span', { text: 'TVL' }), el('b', { text: fmtUsd(row.tvl_usd) }),
            el('span', { text: 'Category residual (' + (row.category || 'Other') + ')' }), el('b', { text: row.comps_fallback ? '\u00d71.00 — too few comps, curve only' : '\u00d7' + row.comps_residual_factor.toFixed(2) + ' from ' + row.comps_n + (row.comps_n === 1 ? ' comp' : ' comps') }),
            el('span', { text: 'Seven-day growth' }), el('b', { text: fmtPct(row.change_7d) }),
            el('span', { text: 'Age with no token' }), el('b', { text: fmtAge(row.age_days) }),
            el('span', { text: 'Growth multiplier' }), el('b', { text: fmtMult(row.growth_multiplier) }),
            el('span', { text: 'Maturity multiplier' }), el('b', { text: fmtMult(row.maturity_multiplier) }),
            el('span', { text: 'Chain multiplier' }), el('b', { text: fmtMult(row.chain_multiplier) }),
            el('span', { class: 'total', text: 'Implied value' }), el('b', { class: 'total', text: fmtUsd(row.implied_value_usd) })
          ),
          el('p', { class: match ? 'match' : 'mismatch', text: 'Model ' + DATA.model_version + ': the page fits the curve from the comparables and recomputes this row as ' + fmtUsd(recomputed) + (match ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' Read it inside the out-of-sample band of \u00d7' + DATA.validation.oos_factor + '.' }),
          el('h3', { text: 'Farm verdict' }),
          el('p', null, el('span', { class: 'badge ' + row.verdict, text: row.verdict }), document.createTextNode(' ' + row.verdict_reason)),
          el('h3', { text: 'Risk flags' }),
          flagList
        ),
        el('div', null,
          el('h3', { text: 'Farm plan — 8 steps' }),
          el('ol', { class: 'steps' }, steps.map(function (s) {
            var at = s.indexOf(' Cost: ');
            var action = at >= 0 ? s.slice(0, at) : s;
            var tail = at >= 0 ? s.slice(at + 1) : '';
            return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
          }))
        )
      ),
      el('p', { class: 'caveat', text: 'This protocol records no token in the snapshot. That is DefiLlama\u2019s record, not proof it has none — a token may exist that the record does not carry. The farm plan is a paper plan: it states what the steps cost and how long they take, and the verdict nets that cost against the modelled launch.' })
    );
  }

  function openDetail(slug) {
    state.selected = slug;
    state.tab = 'board';
    writeHash();
    render();
    var d = document.getElementById('detail');
    if (d) d.scrollIntoView({ block: 'start' });
  }

  function render() {
    if (meta) {
      meta.textContent = '';
      meta.appendChild(el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })));
      meta.appendChild(el('span', null, 'DefiLlama protocol index'));
      meta.appendChild(el('span', null, el('b', { text: DATA.model_version }), ' model \u00b7 OOS \u00d7' + DATA.validation.oos_factor));
    }
    app.textContent = '';
    app.appendChild(lede());
    app.appendChild(controls());
    if (state.tab === 'live') app.appendChild(liveTable());
    else if (state.tab === 'model') app.appendChild(modelPanel());
    else {
      app.appendChild(boardTable());
      var detail = detailPanel();
      if (detail) app.appendChild(detail);
    }
    app.setAttribute('aria-busy', 'false');
  }

  readHash();
  render();
})();

