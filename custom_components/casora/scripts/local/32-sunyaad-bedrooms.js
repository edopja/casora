// ── Sunyaad one-time setup: Bedrooms (temporary, removed in a later update) ────────────────
// On the maintainer's own Home Assistant only (recognised by its gate and inverter): one Bedrooms
// page in place of Master bedroom and Guest Room. Both old pages stay in the dashboard, hidden
// (casora_hidden), so the Studio can bring them back. A copy of the old config is kept in this
// browser (localStorage sunyaad_backup_<dashboard>).
(function () {
  var FLAG = 'sunyaad_once_bedrooms_1';
  function done() { try { return localStorage.getItem(FLAG) === '1'; } catch (e) { return true; } }
  function rooms(cfg) {
    var master = null, guest = null;
    (cfg.views || []).forEach(function (v) {
      var t = (v.path || '') + ' ' + (v.title || '');
      if (/master/i.test(t)) master = master || v;
      else if (/guest/i.test(t)) guest = guest || v;
    });
    return { master: master, guest: guest };
  }
  function eachRoom(v, fn) {
    (function walk(x) {
      if (!x || typeof x !== 'object') return;
      if (x.template === 'casora_room' && x.variables) fn(x);
      (Array.isArray(x) ? x : Object.values(x)).forEach(walk);
    })(v);
  }
  async function run(H) {
    if (done()) return;
    if (!H.user || !H.user.is_admin) return;
    if (!H.states['cover.ed_gate'] || !H.states['sensor.deye_battery_soc']) return;
    var areas = Object.values(H.areas || {});
    var aM = areas.find(function (a) { return /master/i.test(a.name); }), aG = areas.find(function (a) { return /guest/i.test(a.name); });
    if (!aM || !aG) { console.warn('[sunyaad] bedrooms: areas not found'); return; }
    try { localStorage.setItem(FLAG, '1'); } catch (e) { return; }
    var list = [{ name: 'Master Bedroom', area: aM.area_id }, { name: 'Guest Room', area: aG.area_id }];
    for (var d = 0; d < 2; d++) {
      var url = d ? 'casora-dashboard-mobile' : 'casora-dashboard', cfg;
      try { cfg = await H.callWS({ type: 'lovelace/config', url_path: url }); } catch (e) { continue; }
      var r = rooms(cfg);
      if (!r.master || !r.guest || (cfg.views || []).some(function (v) { return v.path === 'bedrooms'; })) continue;
      try { localStorage.setItem('sunyaad_backup_' + url, JSON.stringify(cfg)); } catch (e) { /* full */ }
      var nv = JSON.parse(JSON.stringify(r.master));
      nv.path = 'bedrooms'; nv.title = 'Bedrooms'; delete nv.visible;
      var rows = 0;
      eachRoom(nv, function (x) {
        x.name = 'Bedrooms';
        x.variables.sunyaad_areas = [aM.area_id, aG.area_id];
        delete x.variables.casora_hidden;
      });
      (function walk(x) {
        if (!x || typeof x !== 'object') return;
        if (x.type === 'custom:casora-smart-row') { x.sunyaad_rooms = list; rows++; }
        (Array.isArray(x) ? x : Object.values(x)).forEach(walk);
      })(nv);
      if (d === 0 && !rows) { console.warn('[sunyaad] bedrooms: no tile row on the master page'); continue; }
      // The old pages stay, hidden.
      [r.master, r.guest].forEach(function (v) { v.visible = false; eachRoom(v, function (x) { x.variables.casora_hidden = true; }); });
      cfg.views.splice(cfg.views.indexOf(r.master), 0, nv);
      // Navigation: Bedrooms where Master bedroom was, Guest Room out.
      var mUrl = '/' + url + '/' + r.master.path, gUrl = '/' + url + '/' + r.guest.path;
      (function walk(x) {
        if (!x || typeof x !== 'object') return;
        if (Array.isArray(x.routes)) {
          x.routes = x.routes.filter(function (rt) { return !(rt && rt.url === gUrl); }).map(function (rt) {
            return rt && rt.url === mUrl ? Object.assign({}, rt, { url: '/' + url + '/bedrooms', label: 'Bedrooms', literal: true }) : rt;
          });
        }
        (Array.isArray(x) ? x : Object.values(x)).forEach(walk);
      })(cfg);
      await H.callWS({ type: 'lovelace/config/save', url_path: url, config: cfg });
      console.info('[sunyaad] Bedrooms page added to', url);
    }
    if (/\/(master|guest)/i.test(location.pathname)) setTimeout(function () { location.assign('/casora-dashboard/bedrooms'); }, 800);
    else setTimeout(function () { location.reload(); }, 800);
  }
  var tries = 0;
  var iv = setInterval(function () {
    var ha = document.querySelector('home-assistant'), H = ha && ha.hass;
    var photosDone = false; try { photosDone = localStorage.getItem('sunyaad_once_photos_1') === '1'; } catch (e) {}
    if (H && H.states && Object.keys(H.states).length && H.areas && photosDone && !window._sunyaadPhotosRunning) { clearInterval(iv); setTimeout(function () { run(H).catch(function (e) { console.warn('[sunyaad] bedrooms', e); }); }, 4000); }
    else if (++tries > 120) clearInterval(iv);
  }, 1000);
})();
