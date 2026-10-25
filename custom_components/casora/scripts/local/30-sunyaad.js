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
  function change(H, id, period, offset) {
    if (!id) return null;
    var k = id + '|' + period + '|' + (offset || 0), c = statCache[k];
    if (c && Date.now() - c.at < 300000) return c.v;
    if (!c || !c.busy) {
      statCache[k] = { at: c ? c.at : 0, v: c ? c.v : null, busy: true };
      H.callWS({ type: 'recorder/statistic_during_period', statistic_id: id, types: ['change'], calendar: offset ? { period: period, offset: offset } : { period: period }, units: { energy: 'kWh' } }).then(function (r) {
        var v = r && typeof r.change === 'number' ? r.change : null;
        statCache[k] = { at: Date.now(), v: v, busy: false };
      }, function () { statCache[k] = { at: Date.now(), v: null, busy: false }; });
    }
    return statCache[k].v;
  }
  function changeSum(H, ids, period, offset) {
    var t = null; (ids || []).forEach(function (id) { var v = change(H, id, period, offset); if (v != null) t = (t || 0) + v; }); return t;
  }
  // kWh per day for the last 7 days (today last), summed over ids; cached 10 min.
  var dayCache = {};
  function lastWeek(H, ids) {
    var k = ids.slice().sort().join(','), c = dayCache[k];
    if (c && Date.now() - c.at < 600000) return c.v;
    if (!ids.length) return null;
    if (!c || !c.busy) {
      dayCache[k] = { at: c ? c.at : 0, v: c ? c.v : null, busy: true };
      var d0 = new Date(); d0.setHours(0, 0, 0, 0); d0.setDate(d0.getDate() - 6);
      H.callWS({ type: 'recorder/statistics_during_period', start_time: d0.toISOString(), statistic_ids: ids, period: 'day', types: ['change'], units: { energy: 'kWh' } }).then(function (r) {
        var days = [0, 0, 0, 0, 0, 0, 0];
        Object.keys(r || {}).forEach(function (id) { (r[id] || []).forEach(function (row) {
          var t = typeof row.start === 'number' ? row.start : Date.parse(row.start), i = Math.round((t - d0.getTime()) / 86400000);
          if (i >= 0 && i < 7 && typeof row.change === 'number' && row.change > 0 && row.change < 200) days[i] += row.change;
        }); });
        dayCache[k] = { at: Date.now(), v: days, busy: false };
      }, function () { dayCache[k] = { at: Date.now(), v: null, busy: false }; });
    }
    return dayCache[k].v;
  }
  // Hours a climate device ran today (from its history since midnight); cached 5 min.
  var runCache = {};
  function hoursOn(H, id) {
    var c = runCache[id];
    if (c && Date.now() - c.at < 300000) return c.v;
    if (!c || !c.busy) {
      runCache[id] = { at: c ? c.at : 0, v: c ? c.v : null, busy: true };
      var d0 = new Date(); d0.setHours(0, 0, 0, 0);
      H.callWS({ type: 'history/history_during_period', start_time: d0.toISOString(), end_time: new Date().toISOString(), entity_ids: [id], minimal_response: true, no_attributes: true, significant_changes_only: false }).then(function (r) {
        var pts = (r && r[id]) || [], ms = 0;
        for (var i = 0; i < pts.length; i++) {
          var t = Math.max(d0.getTime(), (pts[i].lu || pts[i].lc || 0) * 1000), t2 = i + 1 < pts.length ? (pts[i + 1].lu || pts[i + 1].lc) * 1000 : Date.now();
          if (pts[i].s !== 'off' && pts[i].s !== 'unavailable' && pts[i].s !== 'unknown') ms += Math.max(0, t2 - t);
        }
        runCache[id] = { at: Date.now(), v: ms / 3600000, busy: false };
      }, function () { runCache[id] = { at: Date.now(), v: null, busy: false }; });
    }
    return runCache[id].v;
  }
  // An inverter's own "today" counter (kWh, resets at midnight), e.g. sensor.*_day_pv_energy. Preferred over the
  // statistics, which a sensor reset can blow up to thousands of kWh.
  function daily(H, re) {
    var id = Object.keys(H.states).find(function (e) {
      return e.indexOf('sensor.') === 0 && re.test(e) && /(^|_)(day|daily|today)(_|$)/.test(e.slice(7)) && /^k?Wh$/i.test(unitOf(H, e)) && num(H, e) != null;
    });
    if (!id) return null;
    var v = num(H, id); return /^Wh$/i.test(unitOf(H, id)) ? v / 1000 : v;
  }
  var sane = function (v) { return v != null && v >= 0 && v < 500 ? v : null; };
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

  // The top block gets its own layer: inside Casora's blurred pop-up, Chrome otherwise skips painting plain text.
  var BASE_CSS = ':host{display:block;color:#fff;text-align:left}:host>:not(style){transform:translateZ(0)}' +
    '.blk{border-radius:18px;background:rgba(255,255,255,.07);box-shadow:inset 0 0 0 1px rgba(255,255,255,.06);padding:12px 14px;box-sizing:border-box}' +
    '.k{font-size:10px;font-weight:800;letter-spacing:1.8px;text-transform:uppercase}' +
    '.mut{color:rgba(255,255,255,.62)}' +
    '.grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}' +
    '.st .l{font-size:12px;color:rgba(255,255,255,.65)}.st .v{font-size:18px;font-weight:750;line-height:1.25}.st .s{font-size:11.5px;color:rgba(255,255,255,.55)}' +
    'button{font:inherit;color:inherit}' +
    '@media (max-width:560px){.st .v{font-size:17px}}';

  // Section heading inside a pop-up (a room's name, "Lights" …) with its quick actions on the right.
  var GH_CSS = '.gh{display:flex;justify-content:space-between;align-items:center;gap:10px;margin:4px 4px -2px;font-size:12px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;color:rgba(255,255,255,.7)}' +
    '.gh em{font-style:normal;font-weight:500;letter-spacing:0;text-transform:none;color:rgba(255,255,255,.5);margin-left:6px}' +
    '.gh .all{display:flex;gap:6px}.gh .all button{border:0;border-radius:999px;padding:5px 11px;background:rgba(255,255,255,.12);color:#fff;font:inherit;font-size:11.5px;font-weight:600;letter-spacing:0;text-transform:none;cursor:pointer}' +
    '.gh .all button:hover{background:rgba(255,255,255,.2)}.none{font-size:13px;color:rgba(255,255,255,.55);padding:4px 6px}';
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
      css: '.wrap{display:grid;gap:8px}.hero{padding:14px 16px}.top{display:flex;justify-content:space-between;gap:10px;align-items:baseline}.top .mut{font-size:13px}' +
        '.pct{font-size:44px;font-weight:800;letter-spacing:-1.5px;line-height:1;margin:8px 0 4px}.pct small{font-size:18px;letter-spacing:0;margin-left:2px;opacity:.8}' +
        '.stat{font-size:15px;font-weight:700}.sub{font-size:13px;margin-top:1px}' +
        '.bar{position:relative;height:10px;border-radius:6px;background:rgba(255,255,255,.1);margin:12px 0 4px;overflow:hidden}' +
        '.bar i{position:absolute;inset:0 auto 0 0;border-radius:9px;background:linear-gradient(90deg,rgba(var(--c),.75),rgba(var(--c),1))}' +
        '.bar b{position:absolute;top:0;bottom:0;width:3px;margin-left:-1px;background:rgba(255,255,255,.85)}' +
        '.ax{display:flex;justify-content:space-between;font-size:11px}' +
        '.packs{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin-top:10px}.packs div{border-radius:12px;padding:7px;font-size:13px;text-align:center;font-weight:700;background:rgba(var(--c),.35)}' +
        '@media (max-width:560px){.pct{font-size:40px}}',
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
    var solarToday = daily(H, /(pv|solar)/) ; if (solarToday == null) solarToday = sane(changeSum(H, E.solarEnergy, 'day'));
    var b = E.bat || {}, inT = change(H, b.stat_energy_to, 'day'), outT = change(H, b.stat_energy_from, 'day');
    var gIn = null, gOut = null;
    E.grid.forEach(function (g) {
      (g.flow_from || []).forEach(function (f) { var v = change(H, f.stat_energy_from, 'day'); if (v != null) gIn = (gIn || 0) + v; });
      (g.flow_to || []).forEach(function (f) { var v = change(H, f.stat_energy_to, 'day'); if (v != null) gOut = (gOut || 0) + v; });
      if (g.stat_energy_from) { var v1 = change(H, g.stat_energy_from, 'day'); if (v1 != null) gIn = (gIn || 0) + v1; }
      if (g.stat_energy_to) { var v2 = change(H, g.stat_energy_to, 'day'); if (v2 != null) gOut = (gOut || 0) + v2; }
    });
    var houseToday = daily(H, /(load|consumption)/);
    if (houseToday == null) houseToday = solarToday == null && outT == null && gIn == null ? null : sane(Math.max(0, (solarToday || 0) + (outT || 0) - (inT || 0) + (gIn || 0) - (gOut || 0)));
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
      css: '.card{padding:16px}.hd{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.h{font-size:16px;font-weight:700;line-height:1.3;margin-top:4px;max-width:420px}' +
        '.chip{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:6px 11px;border-radius:999px;background:rgba(255,255,255,.08);font-size:10.5px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;color:rgba(255,255,255,.8)}' +
        '.chip i{width:9px;height:9px;border-radius:50%;background:rgb(' + C.battery + ')}' +
        '.dia{position:relative;aspect-ratio:1000/640;margin:6px auto 0;max-width:460px}.dia svg{position:absolute;inset:0;width:100%;height:100%}' +
        '.dash{animation:sy-flow 1.4s linear infinite}.dash.rev{animation-direction:reverse}@keyframes sy-flow{to{stroke-dashoffset:-35}}' +
        '@media (prefers-reduced-motion:reduce){.dash{animation:none}}' +
        '.node{position:absolute;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;text-align:center}' +
        '.ring{width:clamp(48px,10vw,70px);aspect-ratio:1;border-radius:50%;display:grid;place-items:center;background:rgba(30,28,30,.85);box-shadow:inset 0 0 0 3px rgba(var(--c),.25);color:rgb(var(--c));transition:box-shadow .3s}' +
        '.act .ring{box-shadow:inset 0 0 0 3px rgba(var(--c),.9),0 0 24px rgba(var(--c),.25)}.ring ha-icon{--mdc-icon-size:clamp(22px,3.6vw,30px)}' +
        '.ring.sm{width:clamp(34px,6vw,46px)}.ring.sm ha-icon{--mdc-icon-size:clamp(18px,2.8vw,22px)}' +
        '.lab{position:absolute;top:100%;margin-top:5px;white-space:nowrap}.lab .n{font-size:12px;font-weight:700;color:rgba(255,255,255,.8)}' +
        '.lab .w{font-size:clamp(18px,3vw,24px);font-weight:800;line-height:1.05;letter-spacing:-.5px}.lab .w small{font-size:.5em;letter-spacing:0;margin-left:3px;opacity:.7}' +
        '.lab .s{font-size:11px;color:rgba(255,255,255,.6)}.inv .lab{margin-top:6px}' +
        '.node.bat .lab{top:auto;bottom:auto;position:static;margin-top:8px}.node.bat{transform:translate(-50%,-32%)}' +
        '[data-k="battery"]{cursor:pointer}' +
        '.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;margin-top:56px}' +
        '.t{border-radius:14px;background:rgba(255,255,255,.07);padding:8px 12px}.t .l{font-size:11.5px;color:rgba(255,255,255,.6)}.t .v{font-size:16px;font-weight:750}' +
        '@media (max-width:560px){.card{padding:12px}.h{font-size:15px}.hd{flex-direction:column}.lab .n{font-size:11px}.lab .s{font-size:10px}.tiles{margin-top:60px}}',
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
      // Gate controllers file pedestrian/start buttons and keep-open switches under "config"; only diagnostics stay out.
      var sib = siblings(H, id).filter(function (e) { var r = reg(H, e); return !(r && (r.hidden || r.entity_category === 'diagnostic')); });
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
      css: '.wrap{display:grid;gap:10px}.g{padding:14px}.top{display:flex;gap:12px;align-items:center}' +
        '.ic{width:42px;height:42px;border-radius:50%;display:grid;place-items:center;background:rgba(160,180,255,.18);color:rgb(160,180,255)}.ic.open{background:rgba(240,190,90,.2);color:rgb(240,190,90)}.ic ha-icon{--mdc-icon-size:22px}' +
        '.nm{font-size:16px;font-weight:700}.stt{font-size:13px;color:rgba(255,255,255,.8)}' +
        '.acts{display:grid;grid-template-columns:repeat(auto-fit,minmax(84px,1fr));gap:8px;margin-top:12px}' +
        '.a{display:flex;flex-direction:column;align-items:center;gap:5px;padding:10px 6px;border:0;border-radius:14px;background:rgba(255,255,255,.08);cursor:pointer;font-size:12.5px;font-weight:650;transition:background .15s,transform .1s;-webkit-tap-highlight-color:transparent}' +
        '.a:hover{background:rgba(255,255,255,.14)}.a:active{transform:scale(.97)}.a[disabled]{opacity:.4;cursor:default}.a ha-icon{--mdc-icon-size:20px}.a.busy{background:rgba(160,180,255,.3)}' +
        '.sws{margin-top:8px;display:grid;gap:6px}.sw{display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border:0;border-radius:12px;background:rgba(255,255,255,.06);cursor:pointer;font-size:13px}' +
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
    var ids = [], others = [], groups = null;
    if (Array.isArray(c.rooms) && c.rooms.length) {
      // One section per room (Bedrooms): each room's plugs under its name.
      groups = c.rooms.map(function (r) { return { name: r.name, ids: inArea(H, r.area, 'switch').filter(isPlug(H)) }; });
      groups.forEach(function (g) { g.ids.forEach(function (e) { ids.push(e); }); });
    } else cards.forEach(function (x) {
      var e = x && (x.entity || (x.variables && x.variables.entity));
      if (e && /^switch\./.test(e) && H.states[e]) { if (ids.indexOf(e) < 0) ids.push(e); } else others.push(x);
    });
    var pr = price(), apps = ids.map(function (e, i) { return appliance(H, e, i); });
    var totalW = 0, totalKwh = null, sig = [];
    var cardOf = function (p) {
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
    };
    var body = groups
      ? groups.map(function (g) { return '<div class="gh">' + esc(g.name) + '</div>' + (g.ids.length ? '<div class="list">' + g.ids.map(function (e) { return cardOf(apps[ids.indexOf(e)]); }).join('') + '</div>' : '<div class="none">' + esc(tr('No appliances here')) + '</div>'); }).join('')
      : (apps.length ? '<div class="list">' + apps.map(cardOf).join('') + '</div>' : '');
    var head = apps.length ? '<div class="sum"><div><div class="l">' + esc(tr('Drawing now')) + '</div><div class="v">' + esc(fmtW(totalW)) + '</div></div>' +
      (totalKwh != null ? '<div><div class="l">' + esc(tr('Today')) + '</div><div class="v">' + esc(fmtKwh(totalKwh)) + '</div></div>' : '') +
      (totalKwh != null && pr != null ? '<div><div class="l">' + esc(tr('Cost today')) + '</div><div class="v">' + esc(money(H, totalKwh * pr)) + '</div></div>' : '') + '</div>' : '';
    var html = '<div class="wrap">' + head + body + (others.length ? '<div class="others"></div>' : '') + '</div>';
    return {
      sig: sig.join('|') + '|' + others.length + '|' + pr, html: html,
      css: '.wrap{display:grid;gap:10px}.sum{display:flex;gap:22px;flex-wrap:wrap;padding:2px 4px}.sum .l{font-size:10.5px;letter-spacing:1.2px;text-transform:uppercase;font-weight:700;color:rgba(255,255,255,.55)}.sum .v{font-size:18px;font-weight:800}' +
        '.list{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:8px}' +
        '.ap{border-radius:18px;padding:12px;background:linear-gradient(160deg,rgba(var(--c),.10),rgba(255,255,255,.05));box-shadow:inset 0 0 0 1px rgba(255,255,255,.07)}' +
        '.row{display:flex;align-items:center;gap:10px}.ic{width:36px;height:36px;flex:0 0 auto;border-radius:50%;display:grid;place-items:center;background:rgba(var(--c),.22);color:rgb(var(--c))}.ic ha-icon{--mdc-icon-size:19px}' +
        '.nm{flex:1;min-width:0}.nm b{display:block;font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.nm span{font-size:12px;font-style:italic;color:rgba(255,255,255,.65);display:flex;align-items:center;gap:6px}' +
        '.nm i{width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,.35)}.act .nm i{background:rgb(var(--c))}' +
        '.tg{flex:0 0 auto;width:42px;height:24px;border:0;border-radius:12px;background:rgba(255,255,255,.18);position:relative;cursor:pointer;transition:background .2s}' +
        '.tg::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:left .2s}.tg.on{background:rgb(var(--c))}.tg.on::after{left:21px}.tg[disabled]{opacity:.4}' +
        '.now{font-size:21px;font-weight:800;margin:8px 0 0}.now small{font-size:12px;font-weight:600;color:rgba(255,255,255,.6);letter-spacing:0}' +
        '.sp{display:block;width:100%;height:34px;margin:4px 0 6px}' +
        '.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(70px,1fr));gap:6px}.sb{border-radius:11px;background:rgba(0,0,0,.18);padding:6px 9px}' +
        '.sb .l{font-size:10.5px;color:rgba(255,255,255,.55)}.sb .v{font-size:13.5px;font-weight:750}.sb .s{font-size:10.5px;color:rgba(255,255,255,.55)}' +
        '.others{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px}' + GH_CSS +
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

  // ── Lights ──────────────────────────────────────────────────────────────────────────────
  // config: { rooms: [{name, area}] } (a section per room, each with All on / All off) or { entities: [...] }.
  define('sunyaad-lights', function (H, c) {
    var groups = Array.isArray(c.rooms) && c.rooms.length
      ? c.rooms.map(function (r) { return { name: r.name, ids: inArea(H, r.area, 'light').filter(function (e) { return !(H.states[e].attributes || {}).entity_id; }) }; })
      : [{ name: '', ids: (c.entities || []).filter(function (e) { return H.states[e]; }) }];
    var sig = [];
    var card = function (e) {
      var st = H.states[e], a = st.attributes || {}, on = st.state === 'on', un = st.state === 'unavailable';
      var dim = (a.supported_color_modes || []).some(function (m) { return m !== 'onoff'; });
      var pct = on && a.brightness != null ? Math.round(a.brightness / 2.55) : 0;
      var rgb = on && Array.isArray(a.rgb_color) ? a.rgb_color.join(',') : '255,205,110';
      sig.push(e, st.state, pct, rgb);
      return '<div class="lc' + (on ? ' on' : '') + '" style="--c:' + rgb + '">' +
        '<div class="row"><button class="ic" data-t="' + esc(e) + '"' + (un ? ' disabled' : '') + '><ha-icon icon="' + esc(a.icon || (on ? 'mdi:lightbulb-on' : 'mdi:lightbulb-outline')) + '"></ha-icon></button>' +
        '<div class="nm"><b>' + esc(friendly(H, e)) + '</b><span>' + esc(un ? tr('Unavailable') : on ? (dim ? pct + '%' : tr('On')) : tr('Off')) + '</span></div>' +
        '<button class="tg' + (on ? ' on' : '') + '" data-t="' + esc(e) + '"' + (un ? ' disabled' : '') + '></button></div>' +
        (dim && !un ? '<input class="br" type="range" min="1" max="100" value="' + (pct || 1) + '" data-b="' + esc(e) + '" style="--p:' + (pct || 0) + '%">' : '') + '</div>';
    };
    var body = groups.map(function (g) {
      var on = g.ids.filter(function (e) { return H.states[e].state === 'on'; }).length;
      return (g.name ? '<div class="gh"><span>' + esc(g.name) + ' <em>' + (on ? on + ' ' + esc(tr('on')) : esc(tr('All off'))) + '</em></span>' +
          (g.ids.length ? '<span class="all"><button data-all="on" data-ids="' + esc(g.ids.join(',')) + '">' + esc(tr('All on')) + '</button><button data-all="off" data-ids="' + esc(g.ids.join(',')) + '">' + esc(tr('All off')) + '</button></span>' : '') + '</div>' : '') +
        (g.ids.length ? '<div class="list">' + g.ids.map(card).join('') + '</div>' : '<div class="none">' + esc(tr('No lights here')) + '</div>');
    }).join('');
    return {
      sig: sig.join('|'), html: '<div class="wrap">' + body + '</div>',
      css: '.wrap{display:grid;gap:10px}.list{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px}' +
        '.lc{border-radius:18px;padding:12px;background:rgba(255,255,255,.06);box-shadow:inset 0 0 0 1px rgba(255,255,255,.07);transition:background .3s}' +
        '.lc.on{background:linear-gradient(160deg,rgba(var(--c),.22),rgba(255,255,255,.05))}' +
        '.row{display:flex;align-items:center;gap:10px}.ic{width:36px;height:36px;flex:0 0 auto;border:0;border-radius:50%;display:grid;place-items:center;background:rgba(255,255,255,.1);color:rgba(255,255,255,.7);cursor:pointer}' +
        '.on .ic{background:rgba(var(--c),.9);color:#2a2116;box-shadow:0 0 18px rgba(var(--c),.55)}.ic ha-icon{--mdc-icon-size:19px}' +
        '.nm{flex:1;min-width:0}.nm b{display:block;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.nm span{font-size:12px;color:rgba(255,255,255,.65)}' +
        '.tg{flex:0 0 auto;width:42px;height:24px;border:0;border-radius:12px;background:rgba(255,255,255,.18);position:relative;cursor:pointer;transition:background .2s}' +
        '.tg::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:left .2s}.tg.on{background:rgb(var(--c))}.tg.on::after{left:21px}' +
        '.br{-webkit-appearance:none;appearance:none;width:100%;height:8px;border-radius:5px;margin:12px 0 2px;background:linear-gradient(90deg,rgba(var(--c),.95) var(--p),rgba(255,255,255,.14) var(--p));outline:none}' +
        '.br::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.4);cursor:pointer}' + GH_CSS,
      bind: function (root) {
        var self = this;
        root.querySelectorAll('[data-t]').forEach(function (b) { b.addEventListener('click', function () { self._h.callService('light', 'toggle', { entity_id: b.dataset.t }); }); });
        root.querySelectorAll('[data-b]').forEach(function (r) {
          r.addEventListener('input', function () { r.style.setProperty('--p', r.value + '%'); });
          r.addEventListener('change', function () { self._h.callService('light', 'turn_on', { entity_id: r.dataset.b, brightness_pct: +r.value }); });
        });
        root.querySelectorAll('[data-all]').forEach(function (b) {
          b.addEventListener('click', function () { self._h.callService('light', b.dataset.all === 'on' ? 'turn_on' : 'turn_off', { entity_id: b.dataset.ids.split(',') }); });
        });
      },
    };
  });

  // ── One room in a pop-up (Bedrooms → Master Bedroom, Guest Room) ─────────────────────────
  // Lights and appliances in Sunyaad's cards, the AC, media and sensors as Casora tiles.
  if (!customElements.get('sunyaad-room')) customElements.define('sunyaad-room', class extends HTMLElement {
    setConfig(c) { this._c = c || {}; this._built = null; }
    getCardSize() { return 8; }
    set hass(h) {
      this._h = h;
      var c = this._c || {}, area = c.area;
      var sec = roomSections(h, area);
      var key = Object.keys(sec).map(function (k) { return k + sec[k].length; }).join('|');
      if (key !== this._built) this._build(sec, key);
      (this._kids || []).forEach(function (k) { k.hass = h; });
    }
    _build(sec, key) {
      this._built = key;
      if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
      var root = this.shadowRoot, c = this._c || {}, self = this;
      // Sections flow into columns side by side (Lights | Climate | Appliances …), so a wider sheet means
      // more columns and less scrolling, never one section stretched across the whole width.
      root.innerHTML = '<style>:host{display:block;color:#fff}:host>div{transform:translateZ(0)}' +
        '.wrap{columns:320px;column-gap:14px}.sec{break-inside:avoid;-webkit-column-break-inside:avoid;display:grid;gap:8px;margin-bottom:14px}' + GH_CSS + '</style><div class="wrap"></div>';
      var wrap = root.querySelector('.wrap');
      this._kids = [];
      var add = function (title, el) {
        var box = document.createElement('div'); box.className = 'sec';
        var h = document.createElement('div'); h.className = 'gh'; h.innerHTML = '<span>' + esc(tr(title)) + '</span>';
        box.appendChild(h); box.appendChild(el); wrap.appendChild(box); el.hass = self._h; self._kids.push(el);
      };
      var mk = function (tag, cfg) { var el = document.createElement(tag); if (el.setConfig) el.setConfig(cfg); else el._c = cfg; return el; };
      var tiles = function (ids, tpl) { return ids.map(function (e) { return { type: 'custom:button-card', template: typeof tpl === 'function' ? tpl(e) : tpl, entity: e }; }); };
      if (sec.lights.length) add('Lights', mk('sunyaad-lights', { entities: sec.lights }));
      if (sec.climate.length) add('Climate', mk('sunyaad-climate', { rooms: [{ name: '', area: self._c.area }] }));
      if (sec.plugs.length) add('Appliances', mk('sunyaad-appliances', { cards: tiles(sec.plugs, 'casora_switch') }));
      if (sec.media.length) add('Entertainment', mk('casora-group-list', { cards: tiles(sec.media, 'casora_media') }));
      if (sec.sensors.length) add('Sensors', mk('casora-group-list', { cards: tiles(sec.sensors, function (e) { return /occupancy|presence|motion/.test(dclass(self._h, e) || '') ? 'casora_motion' : 'casora_entity'; }) }));
      if (!wrap.children.length) wrap.innerHTML = '<div class="none">' + esc(tr('Nothing in this room yet.')) + '</div>';
    }
  });

  // ── Climate: one card per room — the room's temperature and humidity, a 24 h graph, and its AC ──
  // config: { rooms: [{name, area}] } or { entities: [climate ids] }.
  var MODE_ICON = { cool: 'mdi:snowflake', heat: 'mdi:fire', dry: 'mdi:water-percent', fan_only: 'mdi:fan', auto: 'mdi:autorenew', heat_cool: 'mdi:sun-snowflake-variant', off: 'mdi:power' };
  var MODE_NAME = { cool: 'Cool', heat: 'Heat', dry: 'Dry', fan_only: 'Fan', auto: 'Auto', heat_cool: 'Auto', off: 'Off' };
  function roomClimate(H, area, ids) {
    var all = area ? inArea(H, area) : [];
    var acs = (ids || all.filter(function (e) { return e.indexOf('climate.') === 0; })).filter(function (e) { return H.states[e]; });
    var t = all.find(function (e) { return e.indexOf('sensor.') === 0 && dclass(H, e) === 'temperature' && num(H, e) != null; });
    var h = all.find(function (e) { return e.indexOf('sensor.') === 0 && dclass(H, e) === 'humidity' && num(H, e) != null; });
    var occ = all.filter(function (e) { return e.indexOf('binary_sensor.') === 0 && /^(occupancy|presence|motion)$/.test(dclass(H, e) || ''); });
    return { acs: acs, temp: t, hum: h, occ: occ };
  }
  define('sunyaad-climate', function (H, c) {
    var rooms = Array.isArray(c.rooms) && c.rooms.length ? c.rooms : [{ name: '', area: null, ids: c.entities || [] }];
    var sig = [];
    var body = rooms.map(function (r) {
      var rc = roomClimate(H, r.area, r.ids);
      var a0 = rc.acs[0] && H.states[rc.acs[0]].attributes || {};
      var T = num(H, rc.temp); if (T == null && a0.current_temperature != null) T = +a0.current_temperature;
      var RH = num(H, rc.hum); if (RH == null && a0.current_humidity != null) RH = +a0.current_humidity;
      var here = rc.occ.some(function (e) { return H.states[e].state === 'on'; });
      var hist = history(H, rc.temp), sp = spark(hist, 300, 60);
      sig.push(r.area, T, RH, here, hist ? hist.length : 0);
      var comfort = '<div class="cf">' +
        '<div><span class="l">' + esc(tr('Temp')) + '</span><b>' + (T == null ? '–' : (+T).toFixed(1)) + '<small>°</small></b></div>' +
        '<div><span class="l">' + esc(tr('Humidity')) + '</span><b>' + (RH == null ? '–' : Math.round(RH)) + '<small>%</small></b></div>' +
        (rc.occ.length ? '<div><span class="l">' + esc(tr('Room')) + '</span><b class="sm">' + esc(here ? tr('Occupied') : tr('Empty')) + '</b></div>' : '') + '</div>' +
        (sp ? '<svg class="sp" viewBox="0 0 300 60" preserveAspectRatio="none"><path d="' + sp.area + '" fill="rgba(240,170,90,.16)"/><path d="' + sp.line + '" fill="none" stroke="rgb(240,170,90)" stroke-width="2" vector-effect="non-scaling-stroke"/></svg><div class="ax"><span>' + esc(tr('12 h ago')) + '</span><span>' + esc(tr('Now')) + '</span></div>' : '');
      var acs = rc.acs.map(function (e) {
        var st = H.states[e], a = st.attributes || {}, on = st.state !== 'off' && st.state !== 'unavailable';
        var lo = a.min_temp != null ? +a.min_temp : 16, hi = a.max_temp != null ? +a.max_temp : 30, step = a.target_temp_step || (H.config && H.config.unit_system && H.config.unit_system.temperature === '°F' ? 1 : 0.5);
        var tgt = a.temperature != null ? +a.temperature : null;
        var pct = tgt == null ? 0 : Math.max(0, Math.min(1, (tgt - lo) / (hi - lo)));
        // Arc of 270°: 135° … 405°
        var ang = (135 + pct * 270) * Math.PI / 180, cx = 100 + 80 * Math.cos(ang), cy = 100 + 80 * Math.sin(ang);
        var arc = function (p) { var e2 = (135 + p * 270) * Math.PI / 180; var x = 100 + 80 * Math.cos(e2), y = 100 + 80 * Math.sin(e2); var s2 = 135 * Math.PI / 180; return 'M' + (100 + 80 * Math.cos(s2)).toFixed(1) + ' ' + (100 + 80 * Math.sin(s2)).toFixed(1) + ' A80 80 0 ' + (p * 270 > 180 ? 1 : 0) + ' 1 ' + x.toFixed(1) + ' ' + y.toFixed(1); };
        var modes = (a.hvac_modes || []).filter(function (m) { return MODE_NAME[m]; });
        var eco = (a.preset_modes || []).find(function (m) { return /eco/i.test(m); });
        var pw = siblings(H, e).find(function (x) { return x.indexOf('sensor.') === 0 && dclass(H, x) === 'power'; });
        var col = st.state === 'heat' ? '240,130,90' : on ? '100,200,255' : '200,200,200';
        sig.push(e, st.state, tgt, a.current_temperature, a.preset_mode, a.fan_mode, pw && Math.round(watts(H, pw) || 0));
        return '<div class="ac" style="--c:' + col + '" data-e="' + esc(e) + '">' +
          '<div class="row"><div class="ic"><ha-icon icon="mdi:air-conditioner"></ha-icon></div><div class="nm"><b>' + esc(friendly(H, e)) + '</b><span>' +
          esc(a.current_temperature != null ? tr('Room') + ' ' + a.current_temperature + '°' : '') + '</span></div><span class="pill' + (on ? ' on' : '') + '">' + esc(tr(MODE_NAME[st.state] || st.state)) + '</span></div>' +
          '<div class="dial"><svg viewBox="0 0 200 200"><path d="' + arc(1) + '" stroke="rgba(255,255,255,.12)" stroke-width="10" fill="none" stroke-linecap="round"/>' +
          (tgt != null ? '<path d="' + arc(pct || 0.001) + '" stroke="rgb(var(--c))" stroke-width="10" fill="none" stroke-linecap="round" opacity="' + (on ? 1 : .35) + '"/><circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="9" fill="#fff"/>' : '') + '</svg>' +
          '<div class="mid"><b>' + (tgt == null ? '–' : tgt) + '<small>°</small></b><span>' + esc(tr('Target')) + (a.current_temperature != null ? ' · ' + esc(tr('Now')) + ' ' + a.current_temperature + '°' : '') + '</span></div>' +
          '<div class="lo">' + lo + '°</div><div class="hi">' + hi + '°</div></div>' +
          '<div class="pm"><button data-d="-' + step + '">−</button><button data-d="' + step + '">+</button></div>' +
          (modes.length ? '<div class="modes">' + modes.map(function (m) { return '<button class="md' + (st.state === m ? ' sel' : '') + '" data-m="' + m + '"><ha-icon icon="' + MODE_ICON[m] + '"></ha-icon><span>' + esc(tr(MODE_NAME[m])) + '</span></button>'; }).join('') + '</div>' : '') +
          '<div class="foot">' + (eco ? '<button class="eco' + (a.preset_mode === eco ? ' sel' : '') + '" data-p="' + esc(eco) + '"><ha-icon icon="mdi:leaf"></ha-icon>' + esc(tr('Eco')) + '</button>' : '<span></span>') +
          (pw ? '<span class="use">' + esc(tr('Using')) + ' <b>' + esc(fmtW(watts(H, pw))) + '</b></span>' : '') + '</div></div>';
      }).join('');
      return '<div class="room">' + (r.name ? '<div class="gh"><span>' + esc(r.name) + '</span></div>' : '') + '<div class="blk">' + comfort + '</div>' +
        (acs || '<div class="none">' + esc(tr('No AC in this room')) + '</div>') + '</div>';
    }).join('');
    return {
      sig: sig.join('|'), html: '<div class="wrap">' + body + '</div>',
      css: '.wrap{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:14px}.room{display:grid;gap:8px;align-content:start}' +
        '.cf{display:flex;gap:22px}.cf .l{display:block;font-size:10.5px;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;color:rgba(255,255,255,.55)}.cf b{font-size:22px;font-weight:800}.cf b small{font-size:12px;opacity:.7;margin-left:2px}.cf b.sm{font-size:16px;line-height:1.7}' +
        '.sp{display:block;width:100%;height:46px;margin-top:8px}.ax{display:flex;justify-content:space-between;font-size:10.5px;color:rgba(255,255,255,.5)}' +
        '.ac{border-radius:18px;padding:12px;background:rgba(255,255,255,.06);box-shadow:inset 0 0 0 1px rgba(255,255,255,.07)}' +
        '.row{display:flex;align-items:center;gap:10px}.ic{width:36px;height:36px;flex:0 0 auto;border-radius:50%;display:grid;place-items:center;background:rgba(var(--c),.2);color:rgb(var(--c))}.ic ha-icon{--mdc-icon-size:19px}' +
        '.nm{flex:1;min-width:0}.nm b{display:block;font-size:14.5px}.nm span{font-size:12px;color:rgba(255,255,255,.6)}' +
        '.pill{font-size:11.5px;padding:4px 10px;border-radius:999px;background:rgba(255,255,255,.1);color:rgba(255,255,255,.6)}.pill.on{background:rgba(var(--c),.25);color:rgb(var(--c))}' +
        '.dial{position:relative;width:170px;margin:4px auto 0}.dial svg{display:block;width:100%}' +
        '.mid{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}.mid b{font-size:34px;font-weight:800;letter-spacing:-1px}.mid b small{font-size:15px;vertical-align:top}.mid span{font-size:11px;color:rgba(255,255,255,.6)}' +
        '.lo,.hi{position:absolute;bottom:4px;font-size:11px;color:rgba(255,255,255,.5)}.lo{left:22px}.hi{right:22px}' +
        '.pm{display:flex;justify-content:center;margin:2px 0 10px}.pm button{width:52px;height:34px;border:0;background:rgba(255,255,255,.1);color:#fff;font-size:20px;cursor:pointer}.pm button:first-child{border-radius:17px 0 0 17px;border-right:1px solid rgba(255,255,255,.12)}.pm button:last-child{border-radius:0 17px 17px 0}' +
        '.modes{display:grid;grid-template-columns:repeat(auto-fit,minmax(52px,1fr));gap:5px}.md{display:flex;flex-direction:column;align-items:flex-start;gap:6px;padding:8px;border:0;border-radius:12px;background:rgba(255,255,255,.06);box-shadow:inset 0 0 0 1px rgba(255,255,255,.08);color:#fff;font-size:12px;cursor:pointer}' +
        '.md ha-icon{--mdc-icon-size:16px}.md.sel{background:rgba(var(--c),.25);box-shadow:inset 0 0 0 1px rgba(var(--c),.6)}' +
        '.foot{display:flex;justify-content:space-between;align-items:center;margin-top:8px}.eco{display:flex;align-items:center;gap:6px;border:0;border-radius:999px;padding:6px 12px;background:rgba(255,255,255,.08);color:#fff;font-size:12.5px;cursor:pointer}.eco ha-icon{--mdc-icon-size:15px}.eco.sel{background:rgba(120,200,140,.3)}' +
        '.use{font-size:12.5px;color:rgba(255,255,255,.6)}.use b{color:#fff}' + GH_CSS,
      bind: function (root) {
        var self = this;
        root.querySelectorAll('.ac').forEach(function (card) {
          var e = card.dataset.e;
          card.querySelectorAll('[data-d]').forEach(function (b) {
            b.addEventListener('click', function () {
              var a = (self._h.states[e] || {}).attributes || {}, t = (a.temperature != null ? +a.temperature : 24) + +b.dataset.d;
              t = Math.max(a.min_temp != null ? +a.min_temp : 16, Math.min(a.max_temp != null ? +a.max_temp : 30, t));
              self._h.callService('climate', 'set_temperature', { entity_id: e, temperature: Math.round(t * 2) / 2 });
            });
          });
          card.querySelectorAll('[data-m]').forEach(function (b) { b.addEventListener('click', function () { self._h.callService('climate', 'set_hvac_mode', { entity_id: e, hvac_mode: b.dataset.m }); }); });
          card.querySelectorAll('[data-p]').forEach(function (b) {
            b.addEventListener('click', function () {
              var a = (self._h.states[e] || {}).attributes || {};
              var off = (a.preset_modes || []).find(function (m) { return /^(none|normal|comfort)$/i.test(m); }) || 'none';
              self._h.callService('climate', 'set_preset_mode', { entity_id: e, preset_mode: a.preset_mode === b.dataset.p ? off : b.dataset.p });
            });
          });
        });
      },
    };
  });

  // ── Energy of rooms (Bedrooms → Energy) ──────────────────────────────────────────────────
  // Per device in the area: its power sensor and its energy counter (one each), plus a name.
  function roomDevices(H, area) {
    var R = H.entities || {}, D = H.devices || {}, byDev = {};
    Object.keys(H.states).forEach(function (e) {
      if (e.indexOf('sensor.') !== 0) return;
      var r = R[e]; if (!r || r.hidden) return;
      var dev = r.device_id, a = r.area_id || (D[dev] || {}).area_id; if (a !== area) return;
      var dc = dclass(H, e), sc = ((H.states[e].attributes || {}).state_class) || '';
      var key = dev || e, d = byDev[key] || (byDev[key] = { id: key, name: dev && D[dev] ? (D[dev].name_by_user || D[dev].name) : friendly(H, e), power: null, energy: null, ent: [] });
      if (dc === 'power' && !d.power && watts(H, e) != null) d.power = e;
      if (dc === 'energy' && /total/.test(sc) && !d.energy) d.energy = e;
    });
    Object.keys(H.states).forEach(function (e) {
      var r = R[e]; if (!r || !r.device_id || !byDev[r.device_id]) return;
      if (/^(switch|climate|light|media_player|fan|humidifier)\./.test(e) && !r.entity_category) byDev[r.device_id].ent.push(e);
    });
    return Object.keys(byDev).map(function (k) { return byDev[k]; }).filter(function (d) { return d.power || d.energy; });
  }
  function roomPower(H, area) {
    var devs = roomDevices(H, area), w = 0;
    devs.forEach(function (d) { var v = watts(H, d.power); if (v != null && v > 0) w += v; });
    return { w: w, ids: devs.map(function (d) { return d.power || d.energy; }), devs: devs };
  }
  window.sunyaadRoomPower = roomPower;
  window.sunyaadMoney = money;

  var ROOM_COL = ['143,184,240', '240,170,110', '160,210,150', '200,160,255'];
  define('sunyaad-room-energy', function (H, c) {
    var rooms = c.rooms || [], pr = price(), sig = [pr];
    var cost = function (k) { return k == null ? null : pr != null ? money(H, k * pr) : fmtKwh(k); };
    var per = rooms.map(function (r, i) {
      var p = roomPower(H, r.area), en = p.devs.map(function (d) { return d.energy; }).filter(Boolean);
      var x = { name: r.name, col: ROOM_COL[i % ROOM_COL.length], w: p.w, devs: p.devs, en: en,
        today: changeSum(H, en, 'day'), week: changeSum(H, en, 'week'), month: changeSum(H, en, 'month'), lastWeek: changeSum(H, en, 'week', -1), days: lastWeek(H, en) };
      sig.push(Math.round(x.w), x.today && x.today.toFixed(2), x.week && x.week.toFixed(1), x.month && x.month.toFixed(1), x.days && x.days.join(','));
      return x;
    });
    var sum = function (k) { var t = null; per.forEach(function (x) { if (x[k] != null) t = (t || 0) + x[k]; }); return t; };
    var W = sum('w') || 0, today = sum('today'), week = sum('week'), month = sum('month'), lw = sum('lastWeek');
    // This week so far against the same number of days last week.
    var dow = (new Date().getDay() + 6) % 7 + 1, pace = lw != null && week != null && lw > 0 ? (week / (lw * dow / 7) - 1) * 100 : null;
    var head = '<div class="kpis">' +
      '<div class="kp big"><span>' + esc(tr('Running now')) + '</span><b>' + esc(pr != null ? money(H, W / 1000 * pr) : fmtW(W)) + '<small>' + esc(pr != null ? ' / h' : '') + '</small></b><em>' + esc(fmtW(W)) + '</em></div>' +
      '<div class="kp"><span>' + esc(tr('Today')) + '</span><b>' + esc(cost(today) || '–') + '</b><em>' + esc(today != null ? fmtKwh(today) : '') + '</em></div>' +
      '<div class="kp"><span>' + esc(tr('This week')) + '</span><b>' + esc(cost(week) || '–') + '</b><em>' + esc(pace == null ? (week != null ? fmtKwh(week) : '') : (pace <= 0 ? '▼ ' : '▲ ') + Math.abs(Math.round(pace)) + '% ' + tr('vs last week')) + '</em></div>' +
      '<div class="kp"><span>' + esc(tr('This month')) + '</span><b>' + esc(cost(month) || '–') + '</b><em>' + esc(month != null ? fmtKwh(month) : '') + '</em></div></div>';
    // 7 days, stacked by room
    var maxD = 0, dayTot = [0, 0, 0, 0, 0, 0, 0];
    per.forEach(function (x) { (x.days || []).forEach(function (v, i) { dayTot[i] += v; }); });
    maxD = Math.max.apply(null, dayTot) || 1;
    var names = ['S', 'M', 'T', 'W', 'T', 'F', 'S'], d0 = new Date(); d0.setDate(d0.getDate() - 6);
    var bars = '<div class="bars">' + dayTot.map(function (t, i) {
      var day = new Date(d0.getTime() + i * 86400000);
      var stack = per.map(function (x) { var v = x.days ? x.days[i] : 0; return v > 0 ? '<i style="height:' + (v / maxD * 100) + '%;background:rgba(' + x.col + ',.85)"></i>' : ''; }).join('');
      return '<div class="bar' + (i === 6 ? ' today' : '') + '"><div class="col">' + stack + '</div><span>' + names[day.getDay()] + '</span></div>';
    }).join('') + '</div>';
    var legend = '<div class="lg">' + per.map(function (x) { return '<span><i style="background:rgb(' + x.col + ')"></i>' + esc(x.name) + '</span>'; }).join('') + '</div>';
    var roomsHtml = per.map(function (x) {
      return '<div class="rm" style="--c:' + x.col + '"><div class="rn"><i></i>' + esc(x.name) + '</div>' +
        '<div class="rv"><b>' + esc(fmtW(x.w)) + '</b><span>' + esc(tr('now')) + '</span></div>' +
        '<div class="rv"><b>' + esc(cost(x.today) || '–') + '</b><span>' + esc(tr('today')) + '</span></div>' +
        '<div class="rv"><b>' + esc(cost(x.month) || '–') + '</b><span>' + esc(tr('month')) + '</span></div></div>';
    }).join('');
    // Biggest users this month
    var users = [];
    per.forEach(function (x) { x.devs.forEach(function (d) { var m = d.energy ? change(H, d.energy, 'month') : null; users.push({ name: d.name, room: x.name, col: x.col, m: m, w: watts(H, d.power) }); }); });
    users = users.filter(function (u) { return u.m != null && u.m > 0.01; }).sort(function (a, b) { return b.m - a.m; });
    var topM = users.length ? users[0].m : 1, totM = users.reduce(function (a, u) { return a + u.m; }, 0) || 1;
    var top = users.slice(0, 6).map(function (u) {
      sig.push(u.name, u.m.toFixed(2));
      return '<div class="us"><div class="ut"><b>' + esc(u.name) + '</b><span>' + esc(u.room) + '</span><em>' + esc(cost(u.m)) + ' · ' + Math.round(u.m / totM * 100) + '%</em></div><div class="ub"><i style="width:' + (u.m / topM * 100) + '%;background:rgb(' + u.col + ')"></i></div></div>';
    }).join('');
    // Standby: switched-on plugs drawing almost nothing
    var idleW = 0, idleN = 0;
    per.forEach(function (x) { x.devs.forEach(function (d) { var w = watts(H, d.power); if (w != null && w > 0.3 && w < 10) { idleW += w; idleN++; } }); });
    // AC hours today
    var acs = [];
    rooms.forEach(function (r) { inArea(H, r.area, 'climate').forEach(function (e) { var h = hoursOn(H, e); acs.push({ name: friendly(H, e), h: h }); sig.push(e, h && h.toFixed(1)); }); });
    var side = '<div class="blk"><div class="t">' + esc(tr('Standby')) + '</div><div class="sb"><b>' + esc(fmtW(idleW)) + '</b><span>' + esc(idleN + ' ' + tr(idleN === 1 ? 'device idling' : 'devices idling')) + '</span></div>' +
      '<div class="note">' + esc(pr != null ? '≈ ' + money(H, idleW * 24 * 30 / 1000 * pr) + ' ' + tr('a month for nothing') : '≈ ' + fmtKwh(idleW * 24 * 30 / 1000) + ' ' + tr('a month')) + '</div></div>' +
      (acs.length ? '<div class="blk"><div class="t">' + esc(tr('AC running today')) + '</div>' + acs.map(function (a) { return '<div class="ac"><span>' + esc(a.name) + '</span><b>' + (a.h == null ? '–' : a.h < 0.05 ? esc(tr('Off all day')) : a.h.toFixed(1) + ' h') + '</b></div>'; }).join('') + '</div>' : '');
    sig.push(Math.round(idleW));
    var html = '<div class="wrap"><div class="main">' + head + '<div class="blk"><div class="t">' + esc(tr('Last 7 days')) + '</div>' + bars + legend + '</div>' +
      '<div class="rooms">' + roomsHtml + '</div></div>' +
      '<div class="aside">' + (top ? '<div class="blk"><div class="t">' + esc(tr('Biggest users this month')) + '</div>' + top + '</div>' : '') + side +
      (pr == null ? '<div class="note">' + esc(tr('Set your electricity price in Sunyaad Studio → Settings to see costs.')) + '</div>' : '') + '</div></div>';
    return {
      sig: sig.join('|'), html: html,
      css: '.wrap{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:14px}.main,.aside{display:grid;gap:10px;align-content:start}' +
        '.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px}.kp{border-radius:16px;padding:10px 12px;background:rgba(255,255,255,.07)}' +
        '.kp span{display:block;font-size:10.5px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:rgba(255,255,255,.55)}.kp b{display:block;font-size:19px;font-weight:800;margin-top:2px}.kp b small{font-size:12px;opacity:.7}.kp em{font-style:normal;font-size:11.5px;color:rgba(255,255,255,.55)}' +
        '.kp.big{background:linear-gradient(160deg,rgba(255,190,90,.22),rgba(255,255,255,.06))}.kp.big b{font-size:24px}' +
        '.t{font-size:11px;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;color:rgba(255,255,255,.6);margin-bottom:8px}' +
        '.bars{display:grid;grid-template-columns:repeat(7,1fr);gap:8px;height:110px;align-items:end}.bar{display:flex;flex-direction:column;align-items:center;gap:4px;height:100%}' +
        '.col{flex:1;width:100%;max-width:30px;display:flex;flex-direction:column-reverse;border-radius:7px;overflow:hidden;background:rgba(255,255,255,.05)}.col i{display:block;width:100%}' +
        '.bar span{font-size:10.5px;color:rgba(255,255,255,.55)}.bar.today span{color:#fff;font-weight:700}' +
        '.lg{display:flex;gap:14px;margin-top:8px;font-size:11.5px;color:rgba(255,255,255,.7)}.lg i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px}' +
        '.rooms{display:grid;gap:6px}.rm{display:grid;grid-template-columns:1.4fr 1fr 1fr 1fr;align-items:center;gap:6px;border-radius:14px;padding:9px 12px;background:rgba(var(--c),.10)}' +
        '.rn{font-size:13.5px;font-weight:700;display:flex;align-items:center;gap:7px}.rn i{width:8px;height:8px;border-radius:50%;background:rgb(var(--c))}.rv b{display:block;font-size:14px}.rv span{font-size:10.5px;color:rgba(255,255,255,.55)}' +
        '.us{margin-bottom:9px}.ut{display:flex;align-items:baseline;gap:6px;font-size:12.5px}.ut b{font-size:13px}.ut span{color:rgba(255,255,255,.5)}.ut em{margin-left:auto;font-style:normal;color:rgba(255,255,255,.75)}' +
        '.ub{height:6px;border-radius:4px;background:rgba(255,255,255,.08);margin-top:4px;overflow:hidden}.ub i{display:block;height:100%;border-radius:4px}' +
        '.sb b{font-size:20px;font-weight:800;margin-right:8px}.sb span{font-size:12px;color:rgba(255,255,255,.6)}.note{font-size:12px;color:rgba(255,255,255,.6);margin-top:4px}' +
        '.ac{display:flex;justify-content:space-between;font-size:13px;padding:5px 0;border-top:1px solid rgba(255,255,255,.06)}.ac:first-of-type{border-top:0}',
    };
  });

  // Casora tiles under section headings (Bedrooms → Climate, Sensors: one section per room).
  if (!customElements.get('sunyaad-tiles')) customElements.define('sunyaad-tiles', class extends HTMLElement {
    setConfig(c) { this._c = c || {}; this._built = false; }
    getCardSize() { return 6; }
    set hass(h) {
      this._h = h;
      if (!this._built) this._build();
      (this._kids || []).forEach(function (k) { k.hass = h; });
    }
    _build() {
      this._built = true;
      if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
      var root = this.shadowRoot, self = this;
      root.innerHTML = '<style>:host{display:block;color:#fff}:host>div{transform:translateZ(0)}.wrap{display:grid;gap:12px}' + GH_CSS + '</style><div class="wrap"></div>';
      var wrap = root.querySelector('.wrap');
      this._kids = [];
      (this._c.sections || []).forEach(function (sec) {
        var h = document.createElement('div'); h.className = 'gh'; h.innerHTML = '<span>' + esc(sec.title || '') + '</span>'; wrap.appendChild(h);
        if (!sec.cards || !sec.cards.length) { var n = document.createElement('div'); n.className = 'none'; n.textContent = tr(sec.empty || 'Nothing here'); wrap.appendChild(n); return; }
        var el = document.createElement('casora-group-list'); el.setConfig({ cards: sec.cards }); el.hass = self._h; wrap.appendChild(el); self._kids.push(el);
      });
    }
  });

  // Entities of an area (directly or through their device), visible ones only.
  function inArea(H, area, domain) {
    if (!area) return [];
    var R = H.entities || {}, D = H.devices || {};
    return Object.keys(H.states).filter(function (e) {
      if (domain && e.indexOf(domain + '.') !== 0) return false;
      var r = R[e]; if (!r || r.hidden || r.entity_category) return false;
      return (r.area_id || (D[r.device_id] || {}).area_id) === area && H.states[e].state !== 'unavailable';
    });
  }
  // A plug's main switch has no name of its own ("Metering only mode" and the like do).
  function isPlug(H) { return function (e) { var r = (H.entities || {})[e]; return r && !r.name; }; }
  var SENSOR_CLASSES = /^(occupancy|presence|motion|door|window|opening|moisture|smoke|gas|temperature|humidity)$/;
  function roomSections(H, area) {
    var all = inArea(H, area);
    var climateDevs = {};
    all.forEach(function (e) { if (e.indexOf('climate.') === 0) { var r = (H.entities || {})[e]; if (r && r.device_id) climateDevs[r.device_id] = 1; } });
    var seen = {};
    return {
      lights: all.filter(function (e) { return e.indexOf('light.') === 0 && !(H.states[e].attributes || {}).entity_id; }),
      climate: all.filter(function (e) { return e.indexOf('climate.') === 0 || e.indexOf('fan.') === 0; }),
      plugs: all.filter(function (e) { return e.indexOf('switch.') === 0; }).filter(isPlug(H)),
      media: oneEach(H, all.filter(function (e) { return e.indexOf('media_player.') === 0; })),
      sensors: all.filter(function (e) {
        var d = e.split('.')[0], dc = dclass(H, e) || '';
        if (d === 'binary_sensor') return SENSOR_CLASSES.test(dc);
        if (d === 'sensor' && (dc === 'temperature' || dc === 'humidity') && !climateDevs[((H.entities || {})[e] || {}).device_id] && !seen[dc]) { seen[dc] = 1; return true; }
        return false;
      }),
    };
  }
  // One TV can show up as two media players (e.g. Cast and DLNA) with the same name: keep the one that can do most.
  function oneEach(H, ids) {
    var best = {};
    ids.forEach(function (e) {
      var a = H.states[e].attributes || {}, k = String(a.friendly_name || e).toLowerCase();
      var f = a.supported_features || 0, n = 0; while (f) { n += f & 1; f >>>= 1; }
      if (!best[k] || n > best[k].n) best[k] = { e: e, n: n };
    });
    return ids.filter(function (e) { var k = String((H.states[e].attributes || {}).friendly_name || e).toLowerCase(); return best[k].e === e; });
  }
  window.sunyaadOneEach = oneEach;
  window.sunyaadRoomSections = roomSections;

  // ── Tiles of a page that brings several areas together (Bedrooms) ─────────────────────────
  // Used by the dashboard (casora-smart-row) and by the Studio preview, so both show the same.
  // rooms: area ids or {name, area}; tiles: the keys to show, in order (default below).
  var MERGED_TILES = ['lights', 'media', 'climate', 'appliances', 'energy'];
  var MERGED_LABEL = { lights: 'Lights', media: 'Entertainment', climate: 'Climate', appliances: 'Appliances', energy: 'Energy', presence: 'Presence' };
  function normRooms(H, rooms) {
    return (rooms || []).map(function (r) {
      if (typeof r === 'string') return { name: ((H.areas || {})[r] || {}).name || r, area: r };
      return r && r.area ? { name: r.name || ((H.areas || {})[r.area] || {}).name || r.area, area: r.area } : null;
    }).filter(Boolean);
  }
  function mergedPlan(H, roomsIn, tiles) {
    var S = H.states, rooms = normRooms(H, roomsIn), out = [];
    var per = rooms.map(function (r) { return Object.assign({ sec: roomSections(H, r.area) }, r); });
    var all = function (k) { return per.reduce(function (a, r) { return a.concat(r.sec[k]); }, []); };
    var order = Array.isArray(tiles) && tiles.length ? tiles : MERGED_TILES;
    var isOcc = function (e) { return /occupancy|presence|motion/.test(dclass(H, e) || ''); };
    order.forEach(function (key) {
      var name = tr(MERGED_LABEL[key] || key), e, on;
      if (key === 'lights' && (e = all('lights')).length) {
        on = e.filter(function (x) { return S[x].state === 'on'; }).length;
        out.push({ key: key, name: name, icon: 'light', state: on ? on + ' ' + tr('on') : tr('All off'), active: e, content: { type: 'custom:sunyaad-lights', rooms: rooms } });
      } else if (key === 'media' && (e = all('media')).length) {
        var play = e.filter(function (x) { return S[x].state === 'playing'; });
        on = e.filter(function (x) { return ['on', 'playing', 'paused', 'idle'].indexOf(S[x].state) >= 0; }).length;
        out.push({ key: key, name: name, icon: 'tv', state: play.length ? ((S[play[0]].attributes || {}).media_title || tr('Playing')) : on ? on + ' ' + tr('on') : tr('Off'), active: e,
          content: { type: 'custom:sunyaad-tiles', sections: per.map(function (r) { return { title: r.name, empty: 'No TV here', cards: r.sec.media.map(function (x) { return { type: 'custom:button-card', template: 'casora_media', entity: x }; }) }; }) } });
      } else if (key === 'climate' && (e = all('climate')).length) {
        var run = e.filter(function (x) { return S[x].state !== 'off'; }), c0 = run.find(function (x) { return x.indexOf('climate.') === 0; });
        out.push({ key: key, name: name, icon: 'thermostat', state: run.length ? (c0 && (S[c0].attributes || {}).temperature != null ? tr('AC') + ' ' + S[c0].attributes.temperature + '°' : run.length + ' ' + tr('on')) : tr('Off'), active: e,
          content: { type: 'custom:sunyaad-climate', rooms: rooms } });
      } else if (key === 'appliances' && (e = all('plugs')).length) {
        on = e.filter(function (x) { return S[x].state === 'on'; }).length;
        out.push({ key: key, name: name, icon: 'plug', state: on ? on + ' ' + tr('on') : tr('Off'), active: e, content: { type: 'custom:sunyaad-appliances', rooms: rooms } });
      } else if (key === 'energy') {
        var pw = rooms.map(function (r) { return roomPower(H, r.area); });
        if (!pw.some(function (x) { return x.ids.length; })) return;
        var w = pw.reduce(function (a, x) { return a + x.w; }, 0), pr = price();
        out.push({ key: key, name: name, icon: 'energy', state: pr != null ? money(H, w / 1000 * pr) + ' / h' : Math.round(w) + ' W', active: [], content: { type: 'custom:sunyaad-room-energy', rooms: rooms } });
      } else if (key === 'presence') {
        var pres = per.map(function (r) { return r.sec.sensors.filter(function (x) { return x.indexOf('binary_sensor.') === 0; }); });
        var flat = pres.reduce(function (a, x) { return a.concat(x); }, []);
        if (!flat.length) return;
        var here = per.filter(function (r, i) { return pres[i].some(function (x) { return isOcc(x) && S[x].state === 'on'; }); }).map(function (r) { return r.name.replace(/ (Bedroom|Room)$/i, ''); });
        out.push({ key: key, name: name, icon: 'motion', state: here.length ? here.join(' · ') : tr('Empty'), active: flat,
          content: { type: 'custom:sunyaad-tiles', sections: per.map(function (r, i) { return { title: r.name, empty: 'Nothing here', cards: pres[i].map(function (x) { return { type: 'custom:button-card', template: isOcc(x) ? 'casora_motion' : 'casora_entity', entity: x }; }) }; }) } });
      }
    });
    return out;
  }
  window.sunyaadMergedPlan = mergedPlan;
  // Tiles of a combined page (casora-smart-row) name their pop-up (sunyaad_open); open it here,
  // before Casora's tile handler sees the tap.
  if (!window._sunyaadTapHook) {
    window._sunyaadTapHook = true;
    window.addEventListener('ll-custom', function (ev) {
      var id = ev.detail && ev.detail.sunyaad_open, cfg = id && window._sunyaadTiles && window._sunyaadTiles[id];
      if (!cfg || !window.casoraPopup) return;
      ev.stopImmediatePropagation(); ev.stopPropagation();
      var lt = window._casoraLastTile;
      window.casoraPopup.open(Object.assign({}, cfg, lt && Date.now() - lt.at < 2000 ? { src: lt.el } : {}));
    }, true);
  }
  // A normal room for the Studio preview: its tiles in the groups the dashboard shows
  // (casora-smart-row: Lights · Climate · Appliances · Entertainment · Sensors).
  var ROOM_GROUPS = [
    { key: 'lights', label: 'Lights', icon: 'light', tpl: /^casora_(light|scenes|scene_row)$/, dom: /^light$/ },
    { key: 'climate', label: 'Climate', icon: 'thermostat', tpl: /^casora_(thermostat|fan|air_device|air_purifier|humidifier|vent|climate_popup)$/, dom: /^(climate|fan|humidifier)$/ },
    { key: 'appliances', label: 'Appliances', icon: 'plug', tpl: /^casora_(switch|appliance|waschmaschine|trockner|geschirrspueler|coffee|vacuum|3d_printer|car|ebike|lawn_mower|aquarium.*|pet|cover|lock)$/, dom: /^(switch|cover|lock|vacuum)$/ },
    { key: 'media', label: 'Entertainment', icon: 'tv', tpl: /^casora_(media|now_playing|game|football)$/, dom: /^(media_player|remote)$/ },
    { key: 'sensors', label: 'Sensors', icon: 'motion', tpl: /^casora_(motion|presence|entity|plant|battery)$/, dom: /^(binary_sensor|sensor)$/ },
  ];
  window.sunyaadRoomGroups = ROOM_GROUPS.map(function (g) { return { key: g.key, label: g.label }; });
  window.sunyaadRoomPlan = function (H, cards, tiles) {
    var S = H.states, by = {};
    (cards || []).forEach(function (c) {
      var t = String((c && (Array.isArray(c.template) ? c.template[0] : c.template)) || ''), v = (c && c.variables) || {};
      var ents = [c && c.entity].concat(Array.isArray(v.lights) ? v.lights : [], Array.isArray(v.entities) ? v.entities : []).filter(function (e) { return typeof e === 'string'; });
      var g = ROOM_GROUPS.find(function (x) { return x.tpl.test(t); }) || ROOM_GROUPS.find(function (x) { return ents[0] && x.dom.test(ents[0].split('.')[0]); });
      if (!g) return;
      (by[g.key] = by[g.key] || []).push.apply(by[g.key], ents);
    });
    var order = Array.isArray(tiles) && tiles.length ? tiles : ROOM_GROUPS.map(function (g) { return g.key; });
    return order.map(function (k) {
      var g = ROOM_GROUPS.find(function (x) { return x.key === k; }), e = by[k];
      if (!g || !e) return null;
      var on = e.filter(function (x) { return S[x] && ['on', 'playing', 'open', 'heat', 'cool', 'dry', 'fan_only', 'auto', 'heat_cool'].indexOf(S[x].state) >= 0; }).length;
      return { key: k, name: tr(g.label), icon: g.icon, state: on ? on + ' ' + tr('on') : tr('Off'), active: on > 0 };
    }).filter(Boolean);
  };
  window.sunyaadMergedTiles = { keys: MERGED_TILES.concat(['presence']), labels: MERGED_LABEL, defaults: MERGED_TILES };
  window.sunyaadInArea = inArea;

  // ── Landscape pop-ups ────────────────────────────────────────────────────────────────────
  // Casora's pop-up is a 600 px portrait sheet. When its content does not fit the height, the sheet
  // grows sideways (in steps, up to the screen) so tiles flow into more columns instead of scrolling.
  // Phones keep the sheet as it is.
  (function () {
    var BASE = 600, STEP = 220, busy = false, timers = [], cur = BASE;
    function parts() {
      var el = window.casoraPopup && window.casoraPopup.element, sr = el && el.shadowRoot;
      return sr && el.hasAttribute('open') ? { el: el, surface: sr.querySelector('.surface'), content: sr.querySelector('.content') } : null;
    }
    // fresh: a new sheet starts at the base width; later passes only grow it (no jumping while it updates).
    function fit(fresh) {
      var p = parts(); if (!p || !p.surface || !p.content || busy) return;
      if (window.innerWidth < 760) { p.surface.style.removeProperty('width'); p.surface.style.removeProperty('max-width'); return; }
      busy = true;
      var max = Math.min(1320, window.innerWidth - 32), w = fresh === true ? BASE : Math.min(cur, max);
      p.surface.style.setProperty('max-width', max + 'px', 'important');
      p.surface.style.setProperty('transition', 'width .25s ease');
      p.surface.style.setProperty('width', w + 'px', 'important');
      while (p.content.scrollHeight > p.content.clientHeight + 4 && w < max) {
        w = Math.min(max, w + STEP);
        p.surface.style.setProperty('width', w + 'px', 'important');
      }
      cur = w;
      busy = false;
    }
    // Content arrives a moment after the sheet opens (cards render, history loads): fit again then.
    function schedule(fresh) {
      timers.forEach(clearTimeout);
      timers = [0, 150, 450, 1000, 2200].map(function (ms, i) { return setTimeout(function () { fit(fresh && i === 0); }, ms); });
    }
    var watched = null, mo = null;
    setInterval(function () {
      var el = window.casoraPopup && window.casoraPopup.element;
      if (!el || el === watched) return;
      watched = el;
      mo = new MutationObserver(function () { if (el.hasAttribute('open')) schedule(true); });
      mo.observe(el, { attributes: true, attributeFilter: ['open'] });
      // A pop-up that swaps its content while open (‹ back, a detail page) fits again.
      var ct = el.shadowRoot && el.shadowRoot.querySelector('.content');
      if (ct) new MutationObserver(function () { if (el.hasAttribute('open')) schedule(true); }).observe(ct, { childList: true });
      if (el.hasAttribute('open')) schedule(true);
    }, 500);
    window.addEventListener('resize', function () { schedule(true); });
    window.sunyaadFitPopup = fit;
  })();

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

// ── Sunyaad banner (fork) ─────────────────────────────────────────────────────────────────
// On Home, Casora's row of badges becomes one frosted-glass banner:
// Security · Climate · Battery · Charging* · Solar* · Energy · Occupied* · Gate   (* only while it is happening)
// Lights, scenes and media leave the banner (media is a tile below). Security, Climate and the
// energy items open Casora's own badge pop-ups; Occupied and Gate open Casora's pop-up with tiles.
(function () {
  if (window._sunyaadBanner) return;
  window._sunyaadBanner = true;
  const tr = (t) => (window.casoraTr ? window.casoraTr(t) : t);
  const esc = (x) => String(x == null ? '' : x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let prefs = null, prefsAsked = false;
  function hassNow() { const h = document.querySelector('home-assistant'); return h && h.hass; }
  function num(H, e) { const v = e && H.states[e] ? parseFloat(H.states[e].state) : NaN; return isNaN(v) ? null : v; }
  function kw(w) { return Math.abs(w) >= 1000 ? (Math.abs(w) / 1000).toFixed(1) + ' kW' : Math.round(Math.abs(w)) + ' W'; }
  function areaName(H, eid) {
    const e = (H.entities || {})[eid]; if (!e) return null;
    const a = e.area_id || ((H.devices || {})[e.device_id] || {}).area_id;
    return a && H.areas && H.areas[a] ? H.areas[a].name : null;
  }
  function energyIds(H) {
    if (!prefsAsked) {
      prefsAsked = true;
      H.connection.sendMessagePromise({ type: 'energy/get_prefs' }).then((p) => { prefs = p; }).catch(() => { prefs = { energy_sources: [] }; });
    }
    const src = (prefs && prefs.energy_sources) || [];
    const bat = src.find((x) => x.type === 'battery'), sol = src.find((x) => x.type === 'solar');
    const batPower = bat && (bat.stat_rate || (bat.power_config && bat.power_config.stat_rate));
    const solar = sol && sol.stat_rate;
    let soc = null;
    const R = H.entities || {};
    if (batPower && R[batPower] && R[batPower].device_id) {
      soc = Object.keys(H.states).find((e) => e.startsWith('sensor.') && R[e] && R[e].device_id === R[batPower].device_id
        && (H.states[e].attributes || {}).device_class === 'battery');
    }
    if (!soc) soc = Object.keys(H.states).find((e) => /^sensor\..*(battery_soc|_soc)$/.test(e) && (H.states[e].attributes || {}).unit_of_measurement === '%');
    return { batPower, solar, soc };
  }
  function segments(H, vars) {
    const S = H.states, out = [];
    const on = (e) => S[e] && S[e].state === 'on';
    const all = Object.keys(S);
    // Security
    const openings = all.filter((e) => e.startsWith('binary_sensor.') && ['door', 'window', 'opening', 'garage_door'].indexOf((S[e].attributes || {}).device_class) >= 0 && on(e));
    const unlocked = all.filter((e) => e.startsWith('lock.') && S[e].state === 'unlocked');
    out.push({ key: 'security', label: 'Security', icon: 'mdi:shield-check-outline', c: '80,200,200',
      value: unlocked.length ? unlocked.length + ' unlocked' : openings.length ? openings.length + ' open' : 'All secure', badge: 'casora_badge_security_group',
      fallback: all.filter((e) => (e.startsWith('lock.') || (e.startsWith('binary_sensor.') && ['door', 'window', 'opening', 'garage_door'].indexOf((S[e].attributes || {}).device_class) >= 0))
        && !((H.entities || {})[e] || {}).hidden).map((e) => ({ type: 'custom:button-card', template: e.startsWith('lock.') ? 'casora_lock' : 'casora_entity', entity: e })) });
    // Climate
    const cl = all.filter((e) => e.startsWith('climate.') && S[e].state !== 'unavailable');
    if (cl.length) {
      const t = cl.map((e) => parseFloat((S[e].attributes || {}).current_temperature)).filter((x) => !isNaN(x));
      const running = cl.filter((e) => S[e].state !== 'off').length;
      out.push({ key: 'climate', label: 'Climate', icon: 'mdi:air-conditioner', c: '100,210,255',
        value: (t.length ? Math.round(t.reduce((a, b) => a + b, 0) / t.length) + '°' : '') + (running ? ' · ' + running + ' on' : ''), badge: 'casora_badge_climate_group',
        fallback: cl.map((e) => ({ type: 'custom:button-card', template: 'casora_thermostat', entity: e })) });
    }
    // Battery, charging, solar
    let E = energyIds(H);
    let soc = num(H, E.soc), bp = num(H, E.batPower), pv = num(H, E.solar);
    if (window.sunyaadEnergy) {
      const X = window.sunyaadEnergy(H);
      if (X.soc && num(H, X.soc) != null) soc = num(H, X.soc);
      if (X.batW != null) bp = X.batW;
      if (X.solarW != null) pv = X.solarW;
    }
    if (soc != null) out.push({ key: 'battery', label: 'Battery', icon: soc >= 90 ? 'mdi:battery-high' : soc >= 40 ? 'mdi:battery-medium' : 'mdi:battery-low', c: '120,220,160', value: Math.round(soc) + '%', open: 'battery', badge: 'casora_badge_energy_group' });
    if (bp != null && bp < -50) out.push({ key: 'charging', label: 'Charging', icon: 'mdi:battery-arrow-up-outline', c: '120,220,160', value: '+' + kw(bp), open: 'battery', badge: 'casora_badge_energy_group' });
    if (pv != null && pv > 50) out.push({ key: 'solar', label: 'Solar', icon: 'mdi:solar-power-variant', c: '255,200,90', value: kw(pv), open: 'energy', badge: 'casora_badge_energy_group' });
    const load = num(H, vars && vars.energy_power_entity);
    if (load != null) out.push({ key: 'energy', label: 'Energy', icon: 'mdi:lightning-bolt', c: '255,190,90', value: kw(load), open: 'energy', badge: 'casora_badge_energy_group' });
    // Occupied rooms
    const occ = all.filter((e) => e.startsWith('binary_sensor.') && ['occupancy', 'presence', 'motion'].indexOf((S[e].attributes || {}).device_class) >= 0);
    const rooms = [];
    occ.filter(on).forEach((e) => { const n = areaName(H, e); if (n && rooms.indexOf(n) < 0) rooms.push(n); });
    if (rooms.length) out.push({ key: 'occupied', label: 'Occupied', icon: 'mdi:account-outline', c: '190,160,255',
      value: rooms.length > 2 ? rooms.slice(0, 2).join(', ') + ' +' + (rooms.length - 2) : rooms.join(', '),
      popup: occ.filter((e) => !((H.entities || {})[e] || {}).hidden).map((e) => ({ type: 'custom:button-card', template: 'casora_motion', entity: e })) });
    // Gate
    const gates = all.filter((e) => e.startsWith('cover.') && (S[e].attributes || {}).device_class === 'gate');
    if (gates.length) {
      const st = S[gates[0]].state;
      out.push({ key: 'gate', label: gates.length > 1 ? 'Gates' : 'Gate', icon: st === 'closed' ? 'mdi:gate' : 'mdi:gate-open', c: '160,180,255',
        value: tr(st.charAt(0).toUpperCase() + st.slice(1)), open: 'gate', entities: gates, popup: gates.map((e) => ({ type: 'custom:button-card', template: 'casora_cover', entity: e, name: (S[e].attributes || {}).friendly_name || 'Gate' })) });
    }
    return out;
  }
  // A room page: only what is in that room (its Home Assistant area, and the devices its header names).
  function roomArea(H, vars) {
    const ids = [];
    Object.values(vars || {}).forEach((v) => (Array.isArray(v) ? v : [v]).forEach((x) => { if (typeof x === 'string' && /^[a-z_]+\.[a-z0-9_]+$/.test(x) && H.states[x]) ids.push(x); }));
    const n = {};
    ids.forEach((e) => { const r = (H.entities || {})[e]; const a = r && (r.area_id || ((H.devices || {})[r.device_id] || {}).area_id); if (a) n[a] = (n[a] || 0) + 1; });
    const areas = Array.isArray(vars && vars.sunyaad_areas) && vars.sunyaad_areas.length ? vars.sunyaad_areas : null;
    return { area: Object.keys(n).sort((a, b) => n[b] - n[a])[0] || null, areas, ids };
  }
  function roomSegments(H, vars) {
    const S = H.states, R = H.entities || {}, D = H.devices || {}, out = [];
    const { area, areas, ids } = roomArea(H, vars);
    const inRoom = (e) => { const r = R[e]; if (r && (r.hidden || r.entity_category)) return false; const a = r && (r.area_id || (D[r.device_id] || {}).area_id);
      return areas ? areas.indexOf(a) >= 0 : ((area && a === area) || ids.indexOf(e) >= 0); };
    const all = Object.keys(S).filter((e) => inRoom(e) && S[e].state !== 'unavailable');
    const dc = (e) => (S[e].attributes || {}).device_class;
    const tile = (tpl, e) => ({ type: 'custom:button-card', template: tpl, entity: e });
    // Lights (no light groups)
    const lights = all.filter((e) => e.startsWith('light.') && !(S[e].attributes || {}).entity_id);
    if (lights.length) {
      const on = lights.filter((e) => S[e].state === 'on').length;
      out.push({ key: 'lights', label: 'Lights', icon: on ? 'mdi:lightbulb-on-outline' : 'mdi:lightbulb-outline', c: '255,205,110', value: on ? on + ' on' : 'All off', content: { type: 'custom:sunyaad-lights', entities: lights } });
    }
    // Climate
    const cl = all.filter((e) => e.startsWith('climate.') || e.startsWith('fan.'));
    const temp = all.find((e) => e.startsWith('sensor.') && dc(e) === 'temperature');
    if (cl.length) {
      const c0 = cl.find((e) => e.startsWith('climate.')), a = c0 ? S[c0].attributes || {} : {};
      const t = a.current_temperature != null ? a.current_temperature : (temp ? parseFloat(S[temp].state) : null);
      const running = cl.filter((e) => S[e].state !== 'off').length;
      out.push({ key: 'climate', label: 'Climate', icon: 'mdi:air-conditioner', c: '100,210,255',
        value: (t != null && !isNaN(t) ? Math.round(t) + '°' : '') + (running ? (t != null ? ' · ' : '') + (c0 && S[c0].state !== 'off' && a.temperature != null ? 'set ' + a.temperature + '°' : running + ' on') : (t != null ? ' · Off' : 'Off')),
        content: areas ? { type: 'custom:sunyaad-climate', rooms: areas.map((x) => ({ name: ((H.areas || {})[x] || {}).name || '', area: x })) }
          : area ? { type: 'custom:sunyaad-climate', rooms: [{ name: '', area }] } : { type: 'custom:sunyaad-climate', entities: cl.filter((e) => e.startsWith('climate.')) } });
    } else if (temp) {
      out.push({ key: 'temp', label: 'Temperature', icon: 'mdi:thermometer', c: '100,210,255', value: Math.round(parseFloat(S[temp].state)) + '°', popup: [tile('casora_entity', temp)] });
    }
    // Appliances: plugs (a device's main switch) with their power
    const sw = all.filter((e) => e.startsWith('switch.') && !(R[e] || {}).name);
    if (sw.length) {
      let w = 0, hasW = false;
      sw.forEach((e) => { if (S[e].state !== 'on') return; const d = (R[e] || {}).device_id; const p = d && Object.keys(S).find((x) => x.startsWith('sensor.') && (R[x] || {}).device_id === d && dc(x) === 'power'); if (p && !isNaN(parseFloat(S[p].state))) { w += parseFloat(S[p].state); hasW = true; } });
      const on = sw.filter((e) => S[e].state === 'on').length;
      out.push({ key: 'appliances', label: 'Appliances', icon: 'mdi:power-plug-outline', c: '150,170,255', value: hasW ? kw(w) : on ? on + ' on' : 'Off',
        content: { type: 'custom:sunyaad-appliances', cards: sw.map((e) => tile('casora_switch', e)) } });
    }
    // Media
    const mp0 = all.filter((e) => e.startsWith('media_player.')), mp = window.sunyaadOneEach ? window.sunyaadOneEach(H, mp0) : mp0;
    if (mp.length) {
      const play = mp.filter((e) => S[e].state === 'playing');
      const on = mp.filter((e) => ['on', 'playing', 'paused', 'idle'].indexOf(S[e].state) >= 0);
      out.push({ key: 'media', label: 'Media', icon: 'mdi:television-play', c: '240,130,170',
        value: play.length ? ((S[play[0]].attributes || {}).media_title || 'Playing') : on.length ? on.length + ' on' : 'Off', popup: mp.map((e) => tile('casora_media', e)) });
    }
    // Presence
    const occ = all.filter((e) => e.startsWith('binary_sensor.') && ['occupancy', 'presence', 'motion'].indexOf(dc(e)) >= 0);
    if (occ.length) {
      const here = occ.some((e) => S[e].state === 'on');
      out.push({ key: 'occupied', label: here ? 'Occupied' : 'Empty', icon: here ? 'mdi:account' : 'mdi:account-outline', c: '190,160,255', value: here ? 'Someone here' : 'No one', popup: occ.map((e) => tile('casora_motion', e)) });
    }
    // Doors, windows, locks
    const open = all.filter((e) => (e.startsWith('binary_sensor.') && ['door', 'window', 'opening', 'garage_door'].indexOf(dc(e)) >= 0) || e.startsWith('lock.'));
    if (open.length) {
      const o = open.filter((e) => S[e].state === 'on' || S[e].state === 'unlocked').length;
      out.push({ key: 'security', label: 'Doors', icon: o ? 'mdi:door-open' : 'mdi:door-closed-lock', c: '80,200,200', value: o ? o + ' open' : 'Closed',
        popup: open.map((e) => tile(e.startsWith('lock.') ? 'casora_lock' : 'casora_entity', e)) });
    }
    // Gate / covers in this area
    const cov = all.filter((e) => e.startsWith('cover.'));
    cov.filter((e) => dc(e) === 'gate').forEach((e) => out.push({ key: 'gate', label: 'Gate', icon: S[e].state === 'closed' ? 'mdi:gate' : 'mdi:gate-open', c: '160,180,255', value: tr(S[e].state.charAt(0).toUpperCase() + S[e].state.slice(1)), open: 'gate', entities: [e] }));
    const blinds = cov.filter((e) => dc(e) !== 'gate');
    if (blinds.length) out.push({ key: 'covers', label: 'Blinds', icon: 'mdi:blinds', c: '200,180,140', value: blinds.filter((e) => S[e].state === 'open').length + ' open', popup: blinds.map((e) => tile('casora_cover', e)) });
    // Room power (the room's energy sensors from the Studio)
    const en = [].concat(vars.energy_entities || [], vars.energy_power_entity || []).filter((e) => typeof e === 'string' && S[e]);
    if (en.length) {
      let w = 0; en.forEach((e) => { const v = parseFloat(S[e].state); if (!isNaN(v)) w += /^kW$/i.test((S[e].attributes || {}).unit_of_measurement || '') ? v * 1000 : v; });
      out.push({ key: 'power', label: 'Power', icon: 'mdi:lightning-bolt', c: '255,190,90', value: kw(w), popup: en.map((e) => tile('casora_entity', e)) });
    }
    return out;
  }
  const CSS = `
    :host { display: block; }
    .bn { display: inline-flex; align-items: stretch; max-width: 100%; overflow-x: auto; scrollbar-width: none; padding: 5px; border-radius: 24px;
      background: rgba(30, 27, 24, 0.42); -webkit-backdrop-filter: blur(24px) saturate(160%); backdrop-filter: blur(24px) saturate(160%);
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.14), 0 10px 30px rgba(0, 0, 0, 0.2); }
    .bn::-webkit-scrollbar { display: none; }
    .s { position: relative; flex: 0 0 auto; display: flex; align-items: center; gap: 9px; padding: 6px 15px 6px 8px; border: 0; border-radius: 18px;
      background: none; color: #fff; font: inherit; text-align: left; cursor: pointer; -webkit-tap-highlight-color: transparent; transition: background .2s; }
    .s:hover { background: rgba(255, 255, 255, 0.08); }
    .s:active { background: rgba(255, 255, 255, 0.12); }
    .s + .s::before { content: ''; position: absolute; left: 0; top: 24%; bottom: 24%; width: 1px; background: rgba(255, 255, 255, 0.14); }
    .i { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; background: rgba(var(--c), 0.22); color: rgb(var(--c)); }
    .i ha-icon { --mdc-icon-size: 17px; }
    .t b { display: block; font-size: 13px; font-weight: 650; line-height: 1.15; white-space: nowrap; }
    .t span { display: block; font-size: 11.5px; opacity: 0.75; white-space: nowrap; }
  `;
  class SunyaadBanner extends HTMLElement {
    constructor() { super(); this.attachShadow({ mode: 'open' }); this._sig = ''; }
    update(H, vars, room) {
      this._room = room; this._vars = vars;
      const segs = room && room._sunyaadScope === 'room' ? roomSegments(H, room._config.variables || {}) : segments(H, vars);
      this._segs = segs;
      if (!segs.length) { this.style.display = 'none'; this._sig = ''; return; }
      this.style.display = '';
      const sig = segs.map((x) => x.key + x.value).join('|');
      if (sig === this._sig) return; this._sig = sig;
      this.shadowRoot.innerHTML = `<style>${CSS}</style><div class="bn">${segs.map((x, i) => `
        <button class="s" data-i="${i}" style="--c:${x.c}"><span class="i"><ha-icon icon="${x.icon}"></ha-icon></span>
        <span class="t"><b>${esc(tr(x.label))}</b><span>${esc(x.value)}</span></span></button>`).join('')}</div>`;
      this.shadowRoot.querySelectorAll('.s').forEach((b) => b.addEventListener('click', () => this._tap(this._segs[+b.dataset.i])));
    }
    _tap(seg) {
      if (seg.open && window.sunyaadOpen && window.sunyaadOpen(seg.open, { entities: seg.entities, title: seg.label, src: this })) return;
      if (seg.content && window.casoraPopup) {
        window.casoraPopup.open({ title: tr(seg.label), content: seg.content, dismissable: true, dismiss_on_background: true, src: this });
        return;
      }
      if (seg.popup && window.casoraPopup) {
        window.casoraPopup.open({ title: tr(seg.label), content: { type: 'custom:casora-group-list', cards: seg.popup }, dismissable: true, dismiss_on_background: true, src: this });
        return;
      }
      // Casora's own badge (hidden behind the banner) opens its pop-up.
      const sr = this._room && this._room.shadowRoot, box = sr && sr.getElementById('badges');
      const find = (root, depth) => {
        if (!root || depth > 8) return null;
        for (const el of root.querySelectorAll('*')) {
          if (el.tagName === 'BUTTON-CARD' && el._config && el._config.template === seg.badge) return el;
          if (el.shadowRoot) { const f = find(el.shadowRoot, depth + 1); if (f) return f; }
        }
        return null;
      };
      const bc = find(box, 0);
      const card = bc && bc.shadowRoot && bc.shadowRoot.querySelector('ha-card');
      // The same "action" event Home Assistant's tap handler fires on a tile.
      if (card) card.dispatchEvent(new CustomEvent('action', { detail: { action: 'tap' }, bubbles: true, composed: true }));
      // A room page without that badge: Casora's pop-up with the devices as tiles.
      else if (seg.fallback && seg.fallback.length && window.casoraPopup) {
        window.casoraPopup.open({ title: tr(seg.label), content: { type: 'custom:casora-group-list', cards: seg.fallback }, dismissable: true, dismiss_on_background: true, src: this });
      }
    }
  }
  if (!customElements.get('sunyaad-banner')) customElements.define('sunyaad-banner', SunyaadBanner);
  // For the Studio preview: the same items the banner shows. scope 'home' (whole house) or 'room'.
  window.sunyaadBannerSegments = function (H, vars, scope) { return scope === 'room' ? roomSegments(H, vars || {}) : segments(H, vars || {}); };

  // Every room header (Home and each room page) carries the same house-wide banner.
  function homeRooms() {
    const out = [];
    let lovelace = null;
    (function walk(root, depth) {
      if (!root || depth > 14) return;
      for (const el of root.querySelectorAll('*')) {
        if (el.tagName === 'HUI-ROOT' && el.lovelace) lovelace = el.lovelace;
        if (el.tagName === 'BUTTON-CARD' && el._config && el._config.template === 'casora_room') out.push(el);
        else if (el.shadowRoot) walk(el.shadowRoot, depth + 1);
      }
    })(document, 0);
    out.lovelace = lovelace;
    return out;
  }
  // The Home header's settings (house power, battery options), also on room pages.
  function homeVars(ll) {
    const views = (ll && ll.config && ll.config.views) || [];
    const home = views.find((v) => v.path === 'home') || views[0];
    let found = null;
    (function walk(x, depth) {
      if (found || !x || typeof x !== 'object' || depth > 12) return;
      if (x.template === 'casora_room' && x.variables) { found = x.variables; return; }
      (Array.isArray(x) ? x : Object.values(x)).forEach((y) => walk(y, depth + 1));
    })(home, 0);
    return found;
  }
  function tick() {
    if (window.CASORA_SECTIONS === false) return;
    if (/^\/(casora-studio|config|hacs|developer-tools|profile)/.test(location.pathname)) return;
    const H = hassNow(); if (!H) return;
    const rooms = homeRooms();
    if (!rooms.length) return;
    const onHome = /\/home\/?$/.test(location.pathname);
    const hv = (onHome && rooms[0]._config.variables) || homeVars(rooms.lovelace) || window._sunyaadHomeVars || {};
    window._sunyaadHomeVars = hv;
    rooms.forEach((room) => {
      const sr = room.shadowRoot, box = sr && sr.getElementById('badges');
      if (!box) return;
      if (!sr.getElementById('sunyaad-banner-style')) {
        const st = document.createElement('style'); st.id = 'sunyaad-banner-style';
        st.textContent = '#badges > :not(sunyaad-banner){position:absolute!important;width:1px!important;height:1px!important;overflow:hidden!important;opacity:0!important;pointer-events:none!important}';
        sr.appendChild(st);
      }
      let bn = box.querySelector(':scope > sunyaad-banner');
      if (!bn) { bn = document.createElement('sunyaad-banner'); box.insertBefore(bn, box.firstChild); }
      room._sunyaadScope = onHome ? 'home' : 'room';
      bn.update(H, hv, room);
    });
  }
  setInterval(tick, 2000);
  window.addEventListener('location-changed', () => setTimeout(tick, 300));
  setTimeout(tick, 800);
})();
