// ── Sunyaad pop-up panels (fork) ──────────────────────────────────────────────────────────
// Rich contents for Casora's own pop-up (window.casoraPopup), opened from the Sunyaad banner and
// from the Appliances tile. Every panel finds its entities by itself through Home Assistant's
// energy settings and the device registry, so it works in any home without fixed entity ids:
//   custom:sunyaad-battery     battery bank: charge, charging/discharging, time to full/empty,
//                              voltage, current, temperature, stored, charged/used today, cycles
//   custom:sunyaad-energy      live energy flow: solar → inverter → house / battery (/ grid), PV strings
//   custom:sunyaad-gate        gate controls: open, stop, close, plus the gate's own buttons
//                              (pedestrian, start …) and switches (keep open …)
//   custom:sunyaad-appliances  one card per appliance: on/off, power now, history, today, month, cost
// Options (Sunyaad Studio → Home): sunyaad_battery_packs, sunyaad_battery_reserve. Cost uses the
// electricity price from the Studio settings (window.casoraPriceKwh), else no cost is shown.
(function () {
  if (window._sunyaadPanels) return;
  window._sunyaadPanels = true;

  var tr = function (t) { return typeof window.casoraTr === 'function' ? window.casoraTr(t) : t; };
  var esc = function (x) { return String(x == null ? '' : x).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var num = function (H, e) { var s = e && H && H.states[e]; var v = s ? parseFloat(s.state) : NaN; return isFinite(v) ? v : null; };
  var unitOf = function (H, e) { var s = e && H.states[e]; return s ? String((s.attributes || {}).unit_of_measurement || '') : ''; };
  // Power in W whatever the sensor's unit (W or kW).
  var watts = function (H, e) { var v = num(H, e); if (v == null) return null; return /^kW$/i.test(unitOf(H, e)) ? v * 1000 : v; };
  var fmtW = function (w) { if (w == null) return '–'; var a = Math.abs(w); return a >= 1000 ? (a / 1000).toFixed(a >= 10000 ? 0 : 1) + ' kW' : Math.round(a) + ' W'; };
  var fmtW2 = function (w) { if (w == null) return ['–', '']; var a = Math.abs(w); return a >= 1000 ? [(a / 1000).toFixed(a >= 10000 ? 0 : 1), 'kW'] : [String(Math.round(a)), 'W']; };
  var fmtKwh = function (k) { return k == null ? '–' : (k >= 100 ? Math.round(k) : k.toFixed(1)) + ' kWh'; };
  var hm = function (h) {
    if (!isFinite(h) || h <= 0) return '';
    if (h > 48) return tr('over 2 days');
    var hh = Math.floor(h), mm = Math.round((h - hh) * 60); if (mm === 60) { hh++; mm = 0; }
    return (hh ? hh + ' h ' : '') + mm + ' min';
  };
  var money = function (H, n) {
    if (n == null || !isFinite(n)) return null;
    var cur = (H && H.config && H.config.currency) || 'EUR', loc = window.casoraLocale ? window.casoraLocale() : undefined;
    try {
      var s = n.toLocaleString(loc, { style: 'currency', currency: cur, currencyDisplay: 'narrowSymbol', maximumFractionDigits: n >= 100 ? 0 : 2, minimumFractionDigits: 0 });
      return cur === 'JMD' ? s.replace(/^\$/, 'J$') : s;
    } catch (e) { return n.toFixed(2); }
  };
  var price = function () { return window.casoraPriceKwh ? window.casoraPriceKwh() : null; };
  var reg = function (H, e) { return (H.entities || {})[e] || null; };
  var devOf = function (H, e) { var r = reg(H, e); return r && r.device_id || null; };
  var siblings = function (H, e) {
    var d = devOf(H, e); if (!d) return [];
    return Object.values(H.entities || {}).filter(function (r) { return r && r.device_id === d && H.states[r.entity_id]; }).map(function (r) { return r.entity_id; });
  };
  var dclass = function (H, e) { return ((H.states[e] || {}).attributes || {}).device_class; };
  var friendly = function (H, e) { var s = H.states[e]; return s ? (s.attributes || {}).friendly_name || e : e; };
  var deviceName = function (H, e) {
    var d = devOf(H, e), dv = d && (H.devices || {})[d];
    return dv ? (dv.name_by_user || dv.name) : friendly(H, e);
  };

  // Energy settings (cached by Casora's finder, else one load of our own).
  var ownPrefs = null, ownAsked = false;
  function prefs(H) {
    if (window.casoraEnergyPrefs) { var p = window.casoraEnergyPrefs(H); if (p) return p; }
    if (!ownAsked && H && H.callWS) { ownAsked = true; H.callWS({ type: 'energy/get_prefs' }).then(function (p) { ownPrefs = p || {}; }, function () { ownPrefs = {}; }); }
    return ownPrefs;
  }
  // A power config of the energy settings → W, HA's sign (battery: + discharge, grid: + import).
  function flow(H, src) {
    if (!src) return null;
    var pc = src.power_config || {};
    if (pc.stat_rate_inverted) { var v = watts(H, pc.stat_rate_inverted); return v == null ? null : -v; }
    if (pc.stat_rate_from || pc.stat_rate_to) {
      var a = watts(H, pc.stat_rate_from), b = watts(H, pc.stat_rate_to);
      return a == null && b == null ? null : (a || 0) - (b || 0);
    }
    return watts(H, pc.stat_rate || src.stat_rate);
  }
  function energy(H) {
    var p = prefs(H) || {}, src = p.energy_sources || [];
    var bat = src.filter(function (x) { return x.type === 'battery'; });
    var sol = src.filter(function (x) { return x.type === 'solar'; });
    var grid = src.filter(function (x) { return x.type === 'grid'; });
    var b0 = bat[0] || null;
    var batPowerId = b0 && ((b0.power_config || {}).stat_rate || b0.stat_rate || (b0.power_config || {}).stat_rate_inverted || null);
    var soc = b0 && b0.stat_soc && H.states[b0.stat_soc] ? b0.stat_soc : null;
    if (!soc && batPowerId) {
      var d = devOf(H, batPowerId);
      soc = Object.keys(H.states).find(function (e) { return e.indexOf('sensor.') === 0 && d && devOf(H, e) === d && dclass(H, e) === 'battery'; }) || null;
    }
    if (!soc) soc = Object.keys(H.states).find(function (e) { return /^sensor\..*(battery_soc|_soc)$/.test(e) && unitOf(H, e) === '%'; }) || null;
    var sum = function (arr) { var t = null; arr.forEach(function (x) { var v = flow(H, x); if (v != null) t = (t || 0) + v; }); return t; };
    // Grid: older settings keep the power under flow_from/flow_to, newer ones in power_config.
    var gridW = null;
    grid.forEach(function (g) {
      var v = flow(H, g);
      if (v == null && g.flow_from) (g.flow_from || []).forEach(function (f) { var w = watts(H, f.stat_rate); if (w != null) v = (v || 0) + w; });
      if (v == null && g.flow_to) (g.flow_to || []).forEach(function (f) { var w = watts(H, f.stat_rate); if (w != null) v = (v || 0) - w; });
      if (v != null) gridW = (gridW || 0) + v;
    });
    return {
      bat: b0, sol: sol, grid: grid, batPowerId: batPowerId, soc: soc,
      solarW: sum(sol), batW: sum(bat), gridW: gridW, hasGrid: grid.length > 0,
      capacity: b0 && isFinite(+b0.capacity) && +b0.capacity > 0 ? +b0.capacity : null,
      solarEnergy: sol.map(function (x) { return x.stat_energy_from; }).filter(Boolean),
    };
  }

  // Statistics: change over today / this month (cached 5 min per id and period).
  var statCache = {};
  function change(H, id, period) {
    if (!id) return null;
    var k = id + '|' + period, c = statCache[k];
    if (c && Date.now() - c.at < 300000) return c.v;
    if (!c || !c.busy) {
      statCache[k] = { at: c ? c.at : 0, v: c ? c.v : null, busy: true };
      H.callWS({ type: 'recorder/statistic_during_period', statistic_id: id, types: ['change'], calendar: { period: period } }).then(function (r) {
        var v = r && typeof r.change === 'number' ? r.change : null;
        if (v != null && /^Wh$/i.test(unitOf(H, id))) v = v / 1000;
        statCache[k] = { at: Date.now(), v: v, busy: false };
      }, function () { statCache[k] = { at: Date.now(), v: null, busy: false }; });
    }
    return statCache[k].v;
  }
  function changeSum(H, ids, period) {
    var t = null; (ids || []).forEach(function (id) { var v = change(H, id, period); if (v != null) t = (t || 0) + v; }); return t;
  }
  // Power history for sparklines (last 12 h, cached 5 min).
  var histCache = {};
  function history(H, id) {
    if (!id) return null;
    var c = histCache[id];
    if (c && Date.now() - c.at < 300000) return c.v;
    if (!c || !c.busy) {
      histCache[id] = { at: c ? c.at : 0, v: c ? c.v : null, busy: true };
      var end = new Date(), start = new Date(end.getTime() - 12 * 3600 * 1000);
      H.callWS({ type: 'history/history_during_period', start_time: start.toISOString(), end_time: end.toISOString(),
        entity_ids: [id], minimal_response: true, no_attributes: true, significant_changes_only: false }).then(function (r) {
        var pts = ((r && r[id]) || []).map(function (x) { return [(x.lu || x.lc || 0) * 1000, parseFloat(x.s)]; }).filter(function (p) { return isFinite(p[1]) && p[0]; });
        histCache[id] = { at: Date.now(), v: pts, busy: false };
      }, function () { histCache[id] = { at: Date.now(), v: [], busy: false }; });
    }
    return histCache[id].v;
  }
  // Points → SVG path (12 h window, 48 buckets, step-hold).
  function spark(pts, w, h) {
    if (!pts || pts.length < 2) return null;
    var end = Date.now(), start = end - 12 * 3600 * 1000, n = 48, step = (end - start) / n, vals = [], i = 0, last = pts[0][1];
    for (var b = 0; b <= n; b++) {
      var t = start + b * step, mx = null;
      while (i < pts.length && pts[i][0] <= t) { last = pts[i][1]; mx = mx == null ? last : Math.max(mx, last); i++; }
      vals.push(mx == null ? last : mx);
    }
    var hi = Math.max.apply(null, vals), lo = Math.min.apply(null, vals);
    if (hi === lo) { hi = hi + 1; lo = Math.max(0, lo - 1); }
    var d = vals.map(function (v, k) { return (k ? 'L' : 'M') + (k / n * w).toFixed(1) + ' ' + (h - 3 - (v - lo) / (hi - lo) * (h - 8)).toFixed(1); }).join(' ');
    return { line: d, area: d + ' L' + w + ' ' + h + ' L0 ' + h + ' Z' };
  }

  var BASE_CSS = ':host{display:block;color:var(--primary-text-color,#fff);text-align:left}' +
    '.blk{border-radius:20px;background:rgba(255,255,255,.07);box-shadow:inset 0 0 0 1px rgba(255,255,255,.06);padding:16px 18px;box-sizing:border-box}' +
    '.k{font-size:11px;font-weight:800;letter-spacing:1.8px;text-transform:uppercase}' +
    '.mut{color:rgba(255,255,255,.62)}' +
    '.grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}' +
    '.st .l{font-size:13px;color:rgba(255,255,255,.65)}.st .v{font-size:26px;font-weight:750;line-height:1.25;letter-spacing:-.3px}.st .s{font-size:12.5px;color:rgba(255,255,255,.55)}' +
    'button{font:inherit;color:inherit}' +
    '@media (max-width:560px){.st .v{font-size:22px}}';

  // Base element: setConfig/hass like a Lovelace card; renders only when its signature changes.
  function define(tag, render) {
    if (customElements.get(tag)) return;
    customElements.define(tag, class extends HTMLElement {
      setConfig(c) { this._c = c || {}; this._sig = null; if (this._h) this._go(); }
      set hass(h) { this._h = h; if (this._others) this._others.hass = h; this._go(); }
      get hass() { return this._h; }
      getCardSize() { return 6; }
      connectedCallback() { var self = this; this._iv = setInterval(function () { if (self._h) self._go(); }, 15000); }
      disconnectedCallback() { clearInterval(this._iv); }
      _go() {
        if (!this._h) return;
        if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
        var out = render.call(this, this._h, this._c || {});
        if (!out || out.sig === this._sig) return;
        this._sig = out.sig;
        this.shadowRoot.innerHTML = '<style>' + BASE_CSS + (out.css || '') + '</style>' + out.html;
        if (out.bind) out.bind.call(this, this.shadowRoot, this._h);
      }
    });
  }
  window.sunyaadEnergy = energy;

  // ── Battery ─────────────────────────────────────────────────────────────────────────────
  function batteryData(H, c) {
    var E = energy(H), soc = num(H, E.soc), w = E.batW; // + discharge, − charge
    var sib = E.batPowerId ? siblings(H, E.batPowerId) : [];
    if (E.soc) siblings(H, E.soc).forEach(function (x) { if (sib.indexOf(x) < 0) sib.push(x); });
    var pick = function (cls, re) {
      var l = sib.filter(function (e) { return e.indexOf('sensor.') === 0 && dclass(H, e) === cls && num(H, e) != null; });
      return l.find(function (e) { return re.test(e); }) || (re.source === '.' ? l[0] : null);
    };
    var volt = pick('voltage', /batt/), amps = pick('current', /batt/), temp = pick('temperature', /batt/);
    var reserve = c.reserve != null && c.reserve !== '' ? +c.reserve : null;
    if (reserve == null) {
      var rn = sib.find(function (e) { return /^number\./.test(e) && /(shutdown|reserve|low_?batt|min.*soc|soc.*min|battery_low)/.test(e) && unitOf(H, e) === '%'; });
      if (rn) reserve = num(H, rn);
    }
    var cap = c.capacity ? +c.capacity : E.capacity;
    var packs = c.packs ? Math.max(1, Math.round(+c.packs)) : 1;
    var A = num(H, amps);
    if (A == null && w != null && num(H, volt)) A = Math.abs(w) / num(H, volt);
    var b = E.bat || {};
    var inToday = change(H, b.stat_energy_to, 'day'), outToday = change(H, b.stat_energy_from, 'day');
    var totalOut = num(H, b.stat_energy_from);
    if (totalOut != null && /^Wh$/i.test(unitOf(H, b.stat_energy_from))) totalOut /= 1000;
    return { E: E, soc: soc, w: w, volt: num(H, volt), amps: A, temp: num(H, temp), tempUnit: unitOf(H, temp) || '°C',
      reserve: reserve, cap: cap, packs: packs, inToday: inToday, outToday: outToday, totalOut: totalOut, name: b.name || '' };
  }
  define('sunyaad-battery', function (H, c) {
    var d = batteryData(H, c);
    if (d.soc == null && d.w == null) return { sig: 'none', html: '<div class="blk mut">' + esc(tr('No battery found in the energy settings.')) + '</div>' };
    var soc = d.soc == null ? null : Math.max(0, Math.min(100, d.soc));
    var charging = d.w != null && d.w < -20, dis = d.w != null && d.w > 20;
    var status = charging ? tr('Charging') + ' · ' + fmtW(d.w) : dis ? tr('Discharging') + ' · ' + fmtW(d.w) : tr('Resting');
    var sub = '';
    if (charging && soc != null) sub = soc >= 97 ? tr('Topping off') : d.cap ? tr('Full in about') + ' ' + hm(d.cap * (100 - soc) / 100 / (Math.abs(d.w) / 1000)) : '';
    else if (dis && soc != null && d.cap) { var floor = d.reserve || 0; sub = soc > floor ? tr('About') + ' ' + hm(d.cap * (soc - floor) / 100 / (d.w / 1000)) + ' ' + tr('left at this rate') : tr('At the reserve'); }
    else if (soc != null) sub = soc >= 99 ? tr('Full') : '';
    var col = charging || (soc != null && soc >= 40) ? '124,196,154' : soc != null && soc >= 20 ? '240,190,90' : '240,110,100';
    var tiles = [];
    if (d.w != null) tiles.push([tr('Power'), fmtW(d.w), charging ? tr('into the batteries') : dis ? tr('out of the batteries') : tr('resting')]);
    if (d.amps != null) tiles.push([tr('Current'), (Math.abs(d.amps) >= 10 ? Math.round(Math.abs(d.amps)) : Math.abs(d.amps).toFixed(1)) + ' A', d.packs > 1 ? (Math.abs(d.amps) / d.packs).toFixed(1) + ' A ' + tr('per pack') : '']);
    if (d.volt != null) tiles.push([tr('Voltage'), d.volt.toFixed(1) + ' V', d.packs > 1 ? d.packs + ' ' + tr('packs in parallel') : '']);
    if (d.temp != null) tiles.push([tr('Temperature'), Math.round(d.temp) + d.tempUnit, d.temp < 10 ? tr('cold') : d.temp <= 35 ? tr('comfortable') : d.temp <= 45 ? tr('warm') : tr('hot')]);
    if (d.cap && soc != null) tiles.push([tr('Stored now'), (d.cap * soc / 100).toFixed(1) + ' kWh', tr('of') + ' ' + d.cap + ' kWh']);
    if (d.inToday != null) tiles.push([tr('Charged today'), fmtKwh(d.inToday), tr('since midnight')]);
    if (d.outToday != null) tiles.push([tr('Used today'), fmtKwh(d.outToday), d.cap ? Math.round(d.outToday / d.cap * 100) + '% ' + tr('of the bank') : tr('since midnight')]);
    if (d.totalOut != null && d.cap) tiles.push([tr('Cycles (approx.)'), '≈ ' + Math.round(d.totalOut / d.cap), Math.round(d.totalOut).toLocaleString() + ' kWh ' + tr('delivered')]);
    var packs = '';
    if (d.packs > 1) { packs = '<div class="packs">'; for (var i = 1; i <= d.packs; i++) packs += '<div>' + esc(tr('Pack')) + ' ' + i + (d.cap ? ' · ' + +(d.cap / d.packs).toFixed(1) + ' kWh' : '') + '</div>'; packs += '</div>'; }
    var head = (d.packs > 1 ? d.packs + ' ' + tr('packs') : '') + (d.cap ? (d.packs > 1 ? ' · ' : '') + d.cap + ' kWh' : '');
    var html = '<div class="wrap" style="--c:' + col + '"><div class="blk hero">' +
      '<div class="top"><span class="k" style="color:rgb(var(--c))">' + esc(d.name || tr('Battery bank')) + '</span><span class="mut">' + esc(head) + '</span></div>' +
      '<div class="pct">' + (soc == null ? '–' : Math.round(soc)) + '<small>%</small></div>' +
      '<div class="stat" style="color:rgb(var(--c))">' + esc(status) + '</div>' + (sub ? '<div class="mut sub">' + esc(sub) + '</div>' : '') +
      '<div class="bar"><i style="width:' + (soc || 0) + '%"></i>' + (d.reserve ? '<b style="left:' + d.reserve + '%"></b>' : '') + '</div>' +
      '<div class="ax mut"><span>0%</span>' + (d.reserve ? '<span>' + esc(tr('reserve')) + ' ' + Math.round(d.reserve) + '%</span>' : '') + '<span>100%</span></div>' +
      packs + '</div>' +
      '<div class="grid2">' + tiles.map(function (t) { return '<div class="blk st"><div class="l">' + esc(t[0]) + '</div><div class="v">' + esc(t[1]) + '</div><div class="s">' + esc(t[2]) + '</div></div>'; }).join('') + '</div></div>';
    return {
      sig: html, html: html,
      css: '.wrap{display:grid;gap:12px}.hero{padding:20px 22px}.top{display:flex;justify-content:space-between;gap:10px;align-items:baseline}.top .mut{font-size:13px}' +
        '.pct{font-size:76px;font-weight:800;letter-spacing:-3px;line-height:1;margin:14px 0 8px}.pct small{font-size:28px;letter-spacing:0;margin-left:2px;opacity:.8}' +
        '.stat{font-size:20px;font-weight:700}.sub{font-size:15px;margin-top:2px}' +
        '.bar{position:relative;height:16px;border-radius:9px;background:rgba(255,255,255,.1);margin:18px 0 6px;overflow:hidden}' +
        '.bar i{position:absolute;inset:0 auto 0 0;border-radius:9px;background:linear-gradient(90deg,rgba(var(--c),.75),rgba(var(--c),1))}' +
        '.bar b{position:absolute;top:0;bottom:0;width:3px;margin-left:-1px;background:rgba(255,255,255,.85)}' +
        '.ax{display:flex;justify-content:space-between;font-size:12.5px}' +
        '.packs{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-top:14px}.packs div{border-radius:14px;padding:10px;text-align:center;font-weight:700;background:rgba(var(--c),.35)}' +
        '@media (max-width:560px){.pct{font-size:60px}}',
    };
  });

  // ── Energy flow ─────────────────────────────────────────────────────────────────────────
  var C = { solar: '245,194,107', house: '143,184,240', battery: '124,196,154', grid: '201,160,255', inv: '185,163,255' };
  var ICON = { solar: 'mdi:white-balance-sunny', house: 'mdi:home', battery: 'mdi:battery-charging', grid: 'mdi:transmission-tower', inv: 'mdi:sine-wave' };
  function strings(H, E) {
    var ids = Object.keys(H.states).filter(function (e) { return /^sensor\..*pv_?(\d+)_(dc_)?power$/.test(e) && watts(H, e) != null; });
    var near = E.sol[0] && devOf(H, E.sol[0].stat_rate);
    ids.sort(function (a, b) { return +a.match(/pv_?(\d+)/)[1] - +b.match(/pv_?(\d+)/)[1]; });
    var seen = {};
    return ids.filter(function (e) { var n = e.match(/pv_?(\d+)/)[1]; if (seen[n]) return false; seen[n] = 1; return true; })
      .map(function (e) { return { n: +e.match(/pv_?(\d+)/)[1], w: watts(H, e), near: devOf(H, e) === near }; });
  }
  function inverter(H, E) {
    var ref = (E.sol[0] && E.sol[0].stat_rate) || E.batPowerId;
    if (!ref) return null;
    var sib = siblings(H, ref);
    var t = sib.filter(function (e) { return dclass(H, e) === 'temperature' && !/batt/.test(e) && num(H, e) != null; }).map(function (e) { return num(H, e); });
    var name = deviceName(H, ref);
    return { name: name, temp: t.length ? Math.max.apply(null, t) : null, unit: t.length ? '°' : '' };
  }
  define('sunyaad-energy', function (H, c) {
    var E = energy(H), sol = E.solarW, bat = E.batW, grid = E.gridW;
    var house = null;
    if (c.house && watts(H, c.house) != null) house = watts(H, c.house);
    else if (sol != null || bat != null || grid != null) house = Math.max(0, (sol || 0) + (bat || 0) + (grid || 0));
    if (sol == null && bat == null && grid == null && house == null) return { sig: 'none', html: '<div class="blk mut">' + esc(tr('Set up solar or a battery in Home Assistant’s energy settings to see the flow.')) + '</div>' };
    var R = function (w) { return w == null ? 'x' : Math.round(w / 10); };
    var solarToday = changeSum(H, E.solarEnergy, 'day');
    var b = E.bat || {}, inT = change(H, b.stat_energy_to, 'day'), outT = change(H, b.stat_energy_from, 'day');
    var gIn = null, gOut = null;
    E.grid.forEach(function (g) {
      (g.flow_from || []).forEach(function (f) { var v = change(H, f.stat_energy_from, 'day'); if (v != null) gIn = (gIn || 0) + v; });
      (g.flow_to || []).forEach(function (f) { var v = change(H, f.stat_energy_to, 'day'); if (v != null) gOut = (gOut || 0) + v; });
      if (g.stat_energy_from) { var v1 = change(H, g.stat_energy_from, 'day'); if (v1 != null) gIn = (gIn || 0) + v1; }
      if (g.stat_energy_to) { var v2 = change(H, g.stat_energy_to, 'day'); if (v2 != null) gOut = (gOut || 0) + v2; }
    });
    var houseToday = solarToday == null && outT == null && gIn == null ? null : Math.max(0, (solarToday || 0) + (outT || 0) - (inT || 0) + (gIn || 0) - (gOut || 0));
    var soc = num(H, E.soc), inv = inverter(H, E), pv = strings(H, E);
    var on = function (w) { return w != null && Math.abs(w) > 20; };
    // Headline
    var head;
    if (on(sol) && bat != null && bat < -20) head = tr('The sun is running the house and charging the batteries');
    else if (on(sol) && bat != null && bat > 20) head = tr('Sun and batteries are sharing the load');
    else if (on(sol) && grid != null && grid < -20) head = tr('The sun is running the house and selling the rest');
    else if (on(sol) && grid != null && grid > 20) head = tr('The sun and the grid are sharing the load');
    else if (on(sol)) head = tr('The sun is running the house');
    else if (bat != null && bat > 20) head = tr('The batteries are running the house');
    else if (grid != null && grid > 20) head = tr('The grid is running the house');
    else head = tr('Everything is quiet');
    var chip = E.hasGrid ? (grid != null && grid > 20 ? tr('Importing') + ' ' + fmtW(grid) : grid != null && grid < -20 ? tr('Exporting') + ' ' + fmtW(grid) : tr('Grid idle')) : tr('Off-grid');
    // Diagram (viewBox 1000 × 640): solar (190,150), house (810,150), inverter (500,190), battery (500,470), grid (190,470).
    var P = { solar: [190, 150], house: [810, 150], inv: [500, 190], battery: [500, 470], grid: [190, 470] };
    var line = function (a, b2, col, active, rev) {
      var A = P[a], B = P[b2], path = 'M' + A[0] + ' ' + A[1] + ' L' + B[0] + ' ' + B[1];
      return '<path d="' + path + '" stroke="rgba(255,255,255,.12)" stroke-width="4" fill="none"/>' +
        (active ? '<path class="dash' + (rev ? ' rev' : '') + '" d="' + path + '" stroke="rgb(' + col + ')" stroke-width="7" stroke-linecap="round" stroke-dasharray="1 34" fill="none"/>' : '');
    };
    var svg = '<svg viewBox="0 0 1000 640" preserveAspectRatio="xMidYMid meet">' +
      (sol != null ? line('solar', 'inv', C.solar, on(sol)) : '') +
      line('inv', 'house', C.house, on(house)) +
      (bat != null ? line('inv', 'battery', C.battery, on(bat), bat > 0) : '') +
      (E.hasGrid ? line('grid', 'inv', C.grid, on(grid), grid < 0) : '') + '</svg>';
    var node = function (key, label, w, sub, cls) {
      var p = P[key], parts = fmtW2(w);
      return '<div class="node ' + (cls || '') + (on(w) ? ' act' : '') + '" data-k="' + key + '" style="left:' + p[0] / 10 + '%;top:' + p[1] / 6.4 + '%;--c:' + C[key] + '">' +
        '<div class="ring"><ha-icon icon="' + (key === 'battery' && bat != null && bat > 20 ? 'mdi:battery-arrow-down' : ICON[key]) + '"></ha-icon></div>' +
        '<div class="lab"><div class="n">' + esc(label) + '</div><div class="w">' + esc(parts[0]) + '<small>' + esc(parts[1]) + '</small></div>' +
        (sub ? '<div class="s">' + esc(sub) + '</div>' : '') + '</div></div>';
    };
    var nodes = '';
    if (sol != null) nodes += node('solar', tr('Solar'), sol, solarToday != null ? fmtKwh(solarToday) + ' ' + tr('today') : '');
    nodes += node('house', tr('House'), house, houseToday != null ? fmtKwh(houseToday) + ' ' + tr('today') : '');
    if (bat != null) {
      var bp = P.battery, bsub = (bat < -20 ? tr('Charging') + ' ' + fmtW(bat) : bat > 20 ? tr('Discharging') + ' ' + fmtW(bat) : tr('Resting'));
      nodes += '<div class="node bat' + (on(bat) ? ' act' : '') + '" data-k="battery" style="left:' + bp[0] / 10 + '%;top:' + bp[1] / 6.4 + '%;--c:' + C.battery + '">' +
        '<div class="ring"><ha-icon icon="' + (bat < -20 ? 'mdi:battery-charging' : 'mdi:battery') + '"></ha-icon></div>' +
        '<div class="lab"><div class="n">' + esc(tr('Battery')) + '</div><div class="w">' + (soc == null ? esc(fmtW(bat)) : Math.round(soc) + '<small>%</small>') + '</div><div class="s">' + esc(bsub) + '</div></div></div>';
    }
    if (E.hasGrid) nodes += node('grid', tr('Grid'), grid, gIn != null ? fmtKwh(gIn) + ' ' + tr('bought today') : '');
    var ip = P.inv;
    nodes += '<div class="node inv" style="left:' + ip[0] / 10 + '%;top:' + ip[1] / 6.4 + '%;--c:' + C.inv + '"><div class="ring sm"><ha-icon icon="' + ICON.inv + '"></ha-icon></div>' +
      (inv ? '<div class="lab"><div class="s">' + esc(inv.name + (inv.temp != null ? ' · ' + Math.round(inv.temp) + '°' : '')) + '</div></div>' : '') + '</div>';
    var tiles = pv.map(function (s) { return '<div class="t"><div class="l">PV' + s.n + '</div><div class="v">' + esc(fmtW(s.w)) + '</div></div>'; }).join('');
    var html = '<div class="blk card"><div class="hd"><div><div class="k" style="color:rgb(' + C.solar + ')">' + esc(tr('Live energy flow')) + '</div>' +
      '<div class="h">' + esc(head) + (house != null ? ' <span class="mut">· ' + esc(fmtW(house)) + ' ' + esc(tr('used')) + '</span>' : '') + '</div></div>' +
      '<div class="chip"><i></i>' + esc(chip) + '</div></div>' +
      '<div class="dia">' + svg + nodes + '</div>' + (tiles ? '<div class="tiles">' + tiles + '</div>' : '') + '</div>';
    return {
      sig: [R(sol), R(bat), R(grid), R(house), soc == null ? '' : Math.round(soc), solarToday == null ? '' : solarToday.toFixed(1), houseToday == null ? '' : houseToday.toFixed(1), pv.map(function (s) { return R(s.w); }).join(','), inv && inv.temp].join('|'),
      html: html,
      css: '.card{padding:22px}.hd{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}.h{font-size:22px;font-weight:750;line-height:1.25;margin-top:6px;max-width:520px}' +
        '.chip{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:8px 14px;border-radius:999px;background:rgba(255,255,255,.08);font-size:12px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;color:rgba(255,255,255,.8)}' +
        '.chip i{width:9px;height:9px;border-radius:50%;background:rgb(' + C.battery + ')}' +
        '.dia{position:relative;aspect-ratio:1000/640;margin:14px 0 4px}.dia svg{position:absolute;inset:0;width:100%;height:100%}' +
        '.dash{animation:sy-flow 1.4s linear infinite}.dash.rev{animation-direction:reverse}@keyframes sy-flow{to{stroke-dashoffset:-35}}' +
        '@media (prefers-reduced-motion:reduce){.dash{animation:none}}' +
        '.node{position:absolute;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;text-align:center}' +
        '.ring{width:clamp(64px,15vw,104px);aspect-ratio:1;border-radius:50%;display:grid;place-items:center;background:rgba(30,28,30,.85);box-shadow:inset 0 0 0 3px rgba(var(--c),.25);color:rgb(var(--c));transition:box-shadow .3s}' +
        '.act .ring{box-shadow:inset 0 0 0 3px rgba(var(--c),.9),0 0 24px rgba(var(--c),.25)}.ring ha-icon{--mdc-icon-size:clamp(26px,5vw,42px)}' +
        '.ring.sm{width:clamp(44px,9vw,64px)}.ring.sm ha-icon{--mdc-icon-size:clamp(20px,3.6vw,28px)}' +
        '.lab{position:absolute;top:100%;margin-top:8px;white-space:nowrap}.lab .n{font-size:14px;font-weight:700;color:rgba(255,255,255,.8)}' +
        '.lab .w{font-size:clamp(24px,4.6vw,40px);font-weight:800;line-height:1.05;letter-spacing:-1px}.lab .w small{font-size:.5em;letter-spacing:0;margin-left:3px;opacity:.7}' +
        '.lab .s{font-size:13px;color:rgba(255,255,255,.6)}.inv .lab{margin-top:6px}' +
        '.node.bat .lab{top:auto;bottom:auto;position:static;margin-top:8px}.node.bat{transform:translate(-50%,-32%)}' +
        '[data-k="battery"]{cursor:pointer}' +
        '.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-top:64px}' +
        '.t{border-radius:16px;background:rgba(255,255,255,.07);padding:12px 14px}.t .l{font-size:13px;color:rgba(255,255,255,.6)}.t .v{font-size:20px;font-weight:750}' +
        '@media (max-width:560px){.card{padding:16px}.h{font-size:18px}.hd{flex-direction:column}.lab .n{font-size:12px}.lab .s{font-size:11px}.tiles{margin-top:72px}}',
      bind: function (root) {
        var b2 = root.querySelector('[data-k="battery"]');
        if (b2) b2.addEventListener('click', function () { window.sunyaadOpen && window.sunyaadOpen('battery'); });
      },
    };
  });

  // ── Gate ────────────────────────────────────────────────────────────────────────────────
  var busy = {};
  function since(iso) {
    var t = Date.parse(iso); if (!t) return '';
    var m = Math.round((Date.now() - t) / 60000);
    return m < 1 ? tr('just now') : m < 60 ? m + ' min ' + tr('ago') : m < 1440 ? Math.round(m / 60) + ' h ' + tr('ago') : Math.round(m / 1440) + ' d ' + tr('ago');
  }
  define('sunyaad-gate', function (H, c) {
    var ids = (c.entities || []).filter(function (e) { return H.states[e]; });
    if (!ids.length) return { sig: 'none', html: '<div class="blk mut">' + esc(tr('No gate found.')) + '</div>' };
    var sig = [], parts = ids.map(function (id) {
      var s = H.states[id], a = s.attributes || {}, f = a.supported_features || 0, st = s.state;
      var sib = siblings(H, id).filter(function (e) { var r = reg(H, e); return !(r && (r.hidden || r.entity_category)); });
      var btns = sib.filter(function (e) { return /^button\./.test(e); });
      var sws = sib.filter(function (e) { return /^switch\./.test(e); });
      var evs = sib.filter(function (e) { return /^event\./.test(e) && H.states[e].state && H.states[e].state !== 'unknown'; });
      var moving = st === 'opening' || st === 'closing';
      var label = tr(st.charAt(0).toUpperCase() + st.slice(1));
      var short = function (e) { var n = friendly(H, e), d = deviceName(H, id); return n.indexOf(d) === 0 && n.length > d.length ? n.slice(d.length).trim() : n; };
      var acts = [];
      if (f & 1 || !f) acts.push({ k: 'open', icon: 'mdi:gate-open', label: tr('Open'), dis: st === 'open' });
      if (f & 8) acts.push({ k: 'stop', icon: 'mdi:stop', label: tr('Stop'), dis: false });
      if (f & 2 || !f) acts.push({ k: 'close', icon: 'mdi:gate', label: tr('Close'), dis: st === 'closed' });
      btns.forEach(function (e) {
        var n = short(e);
        acts.push({ k: 'press:' + e, icon: /pedestrian|walk|person/i.test(e + n) ? 'mdi:walk' : /start|toggle|step/i.test(e + n) ? 'mdi:gesture-tap-button' : ((H.states[e].attributes || {}).icon || 'mdi:gesture-tap-button'), label: n, dis: false });
      });
      sig.push(id + st + a.current_position + sws.map(function (e) { return H.states[e].state; }).join(',') + evs.map(function (e) { return H.states[e].state; }).join(',') + JSON.stringify(busy));
      return '<div class="blk g" data-id="' + esc(id) + '">' +
        '<div class="top"><div class="ic' + (st === 'closed' ? '' : ' open') + '"><ha-icon icon="' + (st === 'closed' ? 'mdi:gate' : 'mdi:gate-open') + '"></ha-icon></div>' +
        '<div><div class="nm">' + esc(a.friendly_name || id) + '</div><div class="stt">' + esc(label) + (a.current_position != null && moving ? ' · ' + a.current_position + '%' : '') +
        ' <span class="mut">· ' + esc(since(s.last_changed)) + '</span></div></div></div>' +
        '<div class="acts">' + acts.map(function (x) {
          return '<button class="a' + (busy[id + x.k] ? ' busy' : '') + '" data-a="' + esc(x.k) + '"' + (x.dis ? ' disabled' : '') + '><ha-icon icon="' + esc(x.icon) + '"></ha-icon><span>' + esc(x.label) + '</span></button>';
        }).join('') + '</div>' +
        (sws.length ? '<div class="sws">' + sws.map(function (e) {
          return '<button class="sw" data-sw="' + esc(e) + '"><span>' + esc(short(e)) + '</span><i class="tg' + (H.states[e].state === 'on' ? ' on' : '') + '"></i></button>';
        }).join('') + '</div>' : '') +
        (evs.length ? '<div class="ev mut">' + evs.map(function (e) { return esc(short(e)) + ': ' + esc(since(H.states[e].state)); }).join(' · ') + '</div>' : '') +
        '</div>';
    });
    var html = '<div class="wrap">' + parts.join('') + '</div>';
    return {
      sig: sig.join('|'), html: html,
      css: '.wrap{display:grid;gap:12px;min-width:min(560px,80vw)}.g{padding:20px}.top{display:flex;gap:14px;align-items:center}' +
        '.ic{width:56px;height:56px;border-radius:50%;display:grid;place-items:center;background:rgba(160,180,255,.18);color:rgb(160,180,255)}.ic.open{background:rgba(240,190,90,.2);color:rgb(240,190,90)}.ic ha-icon{--mdc-icon-size:28px}' +
        '.nm{font-size:20px;font-weight:750}.stt{font-size:15px;color:rgba(255,255,255,.8)}' +
        '.acts{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin-top:18px}' +
        '.a{display:flex;flex-direction:column;align-items:center;gap:8px;padding:16px 8px;border:0;border-radius:18px;background:rgba(255,255,255,.08);cursor:pointer;font-size:14px;font-weight:650;transition:background .15s,transform .1s;-webkit-tap-highlight-color:transparent}' +
        '.a:hover{background:rgba(255,255,255,.14)}.a:active{transform:scale(.97)}.a[disabled]{opacity:.4;cursor:default}.a ha-icon{--mdc-icon-size:26px}.a.busy{background:rgba(160,180,255,.3)}' +
        '.sws{margin-top:12px;display:grid;gap:8px}.sw{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border:0;border-radius:14px;background:rgba(255,255,255,.06);cursor:pointer;font-size:14px}' +
        '.tg{width:42px;height:24px;border-radius:12px;background:rgba(255,255,255,.2);position:relative;transition:background .2s}.tg::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:left .2s}' +
        '.tg.on{background:rgb(124,196,154)}.tg.on::after{left:21px}.ev{margin-top:12px;font-size:12.5px}',
      bind: function (root, H2) {
        var self = this;
        root.querySelectorAll('.g').forEach(function (g) {
          var id = g.dataset.id;
          g.querySelectorAll('.a').forEach(function (b) {
            b.addEventListener('click', function () {
              var a = b.dataset.a, Hh = self._h, p;
              if (a.indexOf('press:') === 0) p = Hh.callService('button', 'press', { entity_id: a.slice(6) });
              else p = Hh.callService('cover', a === 'open' ? 'open_cover' : a === 'close' ? 'close_cover' : 'stop_cover', { entity_id: id });
              busy[id + a] = 1; self._sig = null; self._go();
              Promise.resolve(p).catch(function () {}).then(function () { setTimeout(function () { delete busy[id + a]; self._sig = null; self._go(); }, 1500); });
            });
          });
          g.querySelectorAll('.sw').forEach(function (b) {
            b.addEventListener('click', function () { self._h.callService('switch', 'toggle', { entity_id: b.dataset.sw }); });
          });
        });
      },
    };
  });

  // ── Appliances ──────────────────────────────────────────────────────────────────────────
  var PALETTE = ['143,184,240', '240,150,90', '124,210,190', '185,150,255', '240,130,170', '240,200,100', '120,200,140', '150,170,255'];
  var KIND = [
    [/fridge|freezer|refrig/, 'mdi:fridge', '143,184,240'], [/stove|oven|cooker|hob/, 'mdi:stove', '240,150,90'],
    [/dehumid|humid/, 'mdi:air-humidifier', '124,210,190'], [/desk|computer|pc|office/, 'mdi:desk', '185,150,255'],
    [/tv|television|sound|media/, 'mdi:television', '240,130,170'], [/wash/, 'mdi:washing-machine', '150,170,255'],
    [/dry/, 'mdi:tumble-dryer', '150,170,255'], [/dish/, 'mdi:dishwasher', '150,170,255'], [/ac\b|a\/c|air.?con|aircon/, 'mdi:air-conditioner', '100,210,255'],
    [/ev|car|charger/, 'mdi:ev-station', '120,200,140'], [/kettle/, 'mdi:kettle', '240,200,100'], [/coffee|espresso/, 'mdi:coffee-maker', '200,150,110'],
    [/microwave/, 'mdi:microwave', '240,150,90'], [/heater/, 'mdi:radiator', '240,150,90'], [/fan/, 'mdi:fan', '124,210,190'], [/pump/, 'mdi:pump', '100,210,255'],
    [/light|lamp/, 'mdi:lamp', '240,200,100'], [/router|network|modem/, 'mdi:router-wireless', '150,170,255'],
  ];
  function appliance(H, id, i) {
    var s = H.states[id], a = (s && s.attributes) || {}, name = deviceName(H, id), key = (name + ' ' + id).toLowerCase();
    var sib = siblings(H, id);
    var find = function (cls, extra) { return sib.find(function (e) { return e.indexOf('sensor.') === 0 && dclass(H, e) === cls && (!extra || extra(e)); }) || null; };
    var power = find('power'), en = find('energy', function (e) { return ((H.states[e].attributes || {}).state_class || '') === 'total_increasing' || /energy/.test(e); });
    var kind = KIND.find(function (k) { return k[0].test(key); });
    return { id: id, name: name, on: s && s.state === 'on', unavail: !s || s.state === 'unavailable', power: power, energy: en,
      volt: find('voltage'), amps: find('current'), icon: a.icon || (kind ? kind[1] : 'mdi:power-socket'), col: kind ? kind[2] : PALETTE[i % PALETTE.length] };
  }
  define('sunyaad-appliances', function (H, c) {
    var cards = c.cards || [];
    var ids = [], others = [];
    cards.forEach(function (x) {
      var e = x && (x.entity || (x.variables && x.variables.entity));
      if (e && /^switch\./.test(e) && H.states[e]) { if (ids.indexOf(e) < 0) ids.push(e); } else others.push(x);
    });
    var pr = price(), apps = ids.map(function (e, i) { return appliance(H, e, i); });
    var totalW = 0, totalKwh = null, sig = [];
    var body = apps.map(function (p) {
      var w = watts(H, p.power), today = change(H, p.energy, 'day'), month = change(H, p.energy, 'month'), hist = history(H, p.power);
      if (w != null && p.on) totalW += w;
      if (today != null) totalKwh = (totalKwh || 0) + today;
      var active = p.on && w != null && w >= 10;
      var status = p.unavail ? tr('Unavailable') : !p.on ? tr('Off') : w == null ? tr('On') : active ? tr('In use') : tr('Standby');
      var sp = spark(hist, 300, 56);
      var v = num(H, p.volt), A = num(H, p.amps);
      var cost = function (k) { return pr != null && k != null ? money(H, k * pr) : null; };
      var stat = function (l, big, small) { return '<div class="sb"><div class="l">' + esc(l) + '</div><div class="v">' + esc(big) + '</div>' + (small ? '<div class="s">' + esc(small) + '</div>' : '') + '</div>'; };
      var stats = '';
      if (p.energy) {
        stats += stat(tr('Today'), cost(today) || fmtKwh(today), cost(today) ? fmtKwh(today) : '');
        stats += stat(tr('Month'), cost(month) || fmtKwh(month), cost(month) ? fmtKwh(month) : '');
      }
      if (v != null) stats += stat(tr('Voltage'), Math.round(v) + ' V', A != null ? A.toFixed(2) + ' A' : '');
      sig.push(p.id, p.on, w == null ? '' : Math.round(w), today == null ? '' : today.toFixed(2), month == null ? '' : month.toFixed(1), v == null ? '' : Math.round(v), A == null ? '' : A.toFixed(2), hist ? hist.length : 0);
      return '<div class="ap' + (active ? ' act' : '') + '" style="--c:' + p.col + '">' +
        '<div class="row"><div class="ic"><ha-icon icon="' + esc(p.icon) + '"></ha-icon></div><div class="nm"><b>' + esc(p.name) + '</b><span><i></i>' + esc(status) + '</span></div>' +
        '<button class="tg' + (p.on ? ' on' : '') + '" data-e="' + esc(p.id) + '" aria-label="' + esc(tr('Toggle')) + '"' + (p.unavail ? ' disabled' : '') + '></button></div>' +
        (p.power ? '<div class="now">' + esc(w == null ? '–' : fmtW(p.on ? w : 0)) + ' <small>' + esc(active ? tr('drawing now') : p.on ? tr('idle draw') : tr('off')) + '</small></div>' : '') +
        (sp ? '<svg class="sp" viewBox="0 0 300 56" preserveAspectRatio="none"><path d="' + sp.area + '" fill="rgba(var(--c),.18)"/><path d="' + sp.line + '" fill="none" stroke="rgb(var(--c))" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>' : '') +
        (stats ? '<div class="stats">' + stats + '</div>' : '') + '</div>';
    }).join('');
    var head = apps.length ? '<div class="sum"><div><div class="l">' + esc(tr('Drawing now')) + '</div><div class="v">' + esc(fmtW(totalW)) + '</div></div>' +
      (totalKwh != null ? '<div><div class="l">' + esc(tr('Today')) + '</div><div class="v">' + esc(fmtKwh(totalKwh)) + '</div></div>' : '') +
      (totalKwh != null && pr != null ? '<div><div class="l">' + esc(tr('Cost today')) + '</div><div class="v">' + esc(money(H, totalKwh * pr)) + '</div></div>' : '') + '</div>' : '';
    var html = '<div class="wrap">' + head + (body ? '<div class="list">' + body + '</div>' : '') + (others.length ? '<div class="others"></div>' : '') + '</div>';
    return {
      sig: sig.join('|') + '|' + others.length + '|' + pr, html: html,
      css: '.wrap{display:grid;gap:14px}.sum{display:flex;gap:28px;flex-wrap:wrap;padding:4px 6px}.sum .l{font-size:12px;letter-spacing:1.2px;text-transform:uppercase;font-weight:700;color:rgba(255,255,255,.55)}.sum .v{font-size:24px;font-weight:800}' +
        '.list{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}' +
        '.ap{border-radius:22px;padding:16px;background:linear-gradient(160deg,rgba(var(--c),.10),rgba(255,255,255,.05));box-shadow:inset 0 0 0 1px rgba(255,255,255,.07)}' +
        '.row{display:flex;align-items:center;gap:12px}.ic{width:46px;height:46px;flex:0 0 auto;border-radius:50%;display:grid;place-items:center;background:rgba(var(--c),.22);color:rgb(var(--c))}.ic ha-icon{--mdc-icon-size:24px}' +
        '.nm{flex:1;min-width:0}.nm b{display:block;font-size:17px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.nm span{font-size:13.5px;font-style:italic;color:rgba(255,255,255,.65);display:flex;align-items:center;gap:6px}' +
        '.nm i{width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,.35)}.act .nm i{background:rgb(var(--c))}' +
        '.tg{flex:0 0 auto;width:52px;height:30px;border:0;border-radius:15px;background:rgba(255,255,255,.18);position:relative;cursor:pointer;transition:background .2s}' +
        '.tg::after{content:"";position:absolute;top:3px;left:3px;width:24px;height:24px;border-radius:50%;background:#fff;transition:left .2s}.tg.on{background:rgb(var(--c))}.tg.on::after{left:25px}.tg[disabled]{opacity:.4}' +
        '.now{font-size:30px;font-weight:800;margin:12px 0 2px;letter-spacing:-.5px}.now small{font-size:14px;font-weight:600;color:rgba(255,255,255,.6);letter-spacing:0}' +
        '.sp{display:block;width:100%;height:48px;margin:4px 0 8px}' +
        '.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(80px,1fr));gap:8px}.sb{border-radius:14px;background:rgba(0,0,0,.18);padding:9px 11px}' +
        '.sb .l{font-size:12px;color:rgba(255,255,255,.55)}.sb .v{font-size:16px;font-weight:750}.sb .s{font-size:12px;color:rgba(255,255,255,.55)}' +
        '.others{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px}' +
        '@media (max-width:560px){.list{grid-template-columns:1fr}}',
      bind: function (root) {
        var self = this;
        root.querySelectorAll('.tg[data-e]').forEach(function (b) {
          b.addEventListener('click', function () { b.classList.toggle('on'); self._h.callService('switch', 'toggle', { entity_id: b.dataset.e }); });
        });
        var box = root.querySelector('.others');
        if (box && others.length) {
          var list = document.createElement('casora-group-list');
          if (list.setConfig) list.setConfig({ cards: others });
          list.hass = self._h; box.appendChild(list);
          self._others = list;
        }
      },
    };
  });

  // Open a panel in Casora's pop-up (banner, energy flow → battery).
  window.sunyaadOpen = function (what, opts) {
    if (!window.casoraPopup) return false;
    opts = opts || {};
    var v = window._sunyaadHomeVars || {};
    var map = {
      battery: { title: tr('Battery'), content: { type: 'custom:sunyaad-battery', packs: v.sunyaad_battery_packs, reserve: v.sunyaad_battery_reserve } },
      energy: { title: tr('Energy'), content: { type: 'custom:sunyaad-energy', house: v.energy_power_entity || null } },
      gate: { title: tr(opts.title || 'Gate'), content: { type: 'custom:sunyaad-gate', entities: opts.entities || [] } },
    };
    var cfg = map[what]; if (!cfg) return false;
    window.casoraPopup.open(Object.assign({ dismissable: true, dismiss_on_background: true }, cfg, opts.src ? { src: opts.src } : {}));
    return true;
  };
})();
