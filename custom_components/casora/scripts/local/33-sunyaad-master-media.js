// ── Sunyaad one-time fix (temporary, removed in a later update) ───────────────────────────────
// On the maintainer's own Home Assistant only: the master bedroom has just the Hisense TV.
// Other media players (JBL speaker, other TVs) leave the Master Bedroom area and its page.
(function () {
  var FLAG = 'sunyaad_once_master_media_1';
  function done() { try { return localStorage.getItem(FLAG) === '1'; } catch (e) { return true; } }
  async function run(H) {
    if (done()) return;
    if (!H.user || !H.user.is_admin) return;
    if (!H.states['cover.ed_gate'] || !H.states['sensor.deye_battery_soc']) return;
    var area = Object.values(H.areas || {}).find(function (a) { return /master/i.test(a.name); });
    if (!area) return;
    try { localStorage.setItem(FLAG, '1'); } catch (e) { return; }
    var R = H.entities || {}, D = H.devices || {}, keep = /hisense/i, moved = [];
    var name = function (e) { var s = H.states[e]; var r = R[e] || {}; var d = D[r.device_id] || {}; return [e, s && s.attributes.friendly_name, d.name, d.name_by_user, d.manufacturer, d.model].join(' '); };
    var ids = Object.keys(R).filter(function (e) {
      if (e.indexOf('media_player.') !== 0 && e.indexOf('remote.') !== 0) return false;
      var r = R[e]; return (r.area_id || (D[r.device_id] || {}).area_id) === area.area_id && !keep.test(name(e));
    });
    for (var i = 0; i < ids.length; i++) {
      var r = R[ids[i]];
      if (r.area_id) await H.callWS({ type: 'config/entity_registry/update', entity_id: ids[i], area_id: null });
      var dev = D[r.device_id];
      if (dev && dev.area_id === area.area_id && !keep.test(name(ids[i]))) await H.callWS({ type: 'config/device_registry/update', device_id: dev.id, area_id: null });
      moved.push(ids[i]);
    }
    // The master bedroom page's own media list (Studio fields media_player_N).
    for (var d = 0; d < 2; d++) {
      var url = d ? 'casora-dashboard-mobile' : 'casora-dashboard', cfg, n = 0;
      try { cfg = await H.callWS({ type: 'lovelace/config', url_path: url }); } catch (e) { continue; }
      (cfg.views || []).forEach(function (v) {
        if (!/master/i.test((v.path || '') + ' ' + (v.title || ''))) return;
        (function walk(x) {
          if (!x || typeof x !== 'object') return;
          if (x.template === 'casora_room' && x.variables) {
            Object.keys(x.variables).forEach(function (k) {
              var val = x.variables[k];
              if (/^media_player_\d+$/.test(k) && typeof val === 'string' && !keep.test(name(val))) { delete x.variables[k]; n++; }
            });
          }
          (Array.isArray(x) ? x : Object.values(x)).forEach(walk);
        })(v);
      });
      if (n) await H.callWS({ type: 'lovelace/config/save', url_path: url, config: cfg });
    }
    console.info('[sunyaad] master bedroom media moved out:', moved);
  }
  var tries = 0;
  var iv = setInterval(function () {
    var ha = document.querySelector('home-assistant'), H = ha && ha.hass;
    var ready = false; try { ready = localStorage.getItem('sunyaad_once_bedrooms_1') === '1'; } catch (e) {}
    if (H && H.states && H.areas && ready && !window._sunyaadPhotosRunning) { clearInterval(iv); setTimeout(function () { run(H).catch(function (e) { console.warn('[sunyaad] media', e); }); }, 8000); }
    else if (++tries > 180) clearInterval(iv);
  }, 1000);
})();
