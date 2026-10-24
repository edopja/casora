// ── Sunyaad one-time setup (temporary, removed in the next update) ─────────────────────────
// Puts three room photos in place on the maintainer's own Home Assistant (recognised by its gate
// and inverter). Does nothing on any other installation. Runs once per browser, admin only.
(function () {
  var FLAG = 'sunyaad_once_photos_1';
  var BASE = 'https://raw.githubusercontent.com/edopja/casora/tmp-assets/';
  var PHOTOS = [
    { file: 'home.jpg', name: 'home-render', match: function (v) { return v.path === 'home'; } },
    { file: 'living.jpg', name: 'living-room-photo', match: function (v) { return v.path === 'living-room'; } },
    { file: 'bedroom.jpg', name: 'bedroom-photo', match: function (v) { return /master/i.test((v.path || '') + ' ' + (v.title || '')); } },
  ];
  function done() { try { return localStorage.getItem(FLAG) === '1'; } catch (e) { return true; } }
  async function run(H) {
    if (done()) return;
    if (!H.user || !H.user.is_admin) return;
    if (!H.states['cover.ed_gate'] || !H.states['sensor.deye_battery_soc']) return;
    try { localStorage.setItem(FLAG, '1'); } catch (e) { return; }
    var names = {};
    for (var i = 0; i < PHOTOS.length; i++) {
      var p = PHOTOS[i];
      var blob = await (await fetch(BASE + p.file, { cache: 'no-store' })).blob();
      var fd = new FormData(); fd.append('name', p.name); fd.append('variant', 'day'); fd.append('file', blob, p.name + '.jpg');
      var r = await fetch('/api/casora/images', { method: 'POST', headers: { Authorization: 'Bearer ' + H.auth.data.access_token }, body: fd });
      var j = await r.json(); if (!j.name) throw new Error('upload ' + p.file);
      names[p.name] = j.name;
    }
    var changed = 0;
    for (var d = 0; d < 2; d++) {
      var url = d ? 'casora-dashboard-mobile' : 'casora-dashboard', cfg;
      try { cfg = await H.callWS({ type: 'lovelace/config', url_path: url }); } catch (e) { continue; }
      (cfg.views || []).forEach(function (v) {
        var ph = PHOTOS.find(function (x) { return x.match(v); }); if (!ph) return;
        (function walk(x) {
          if (!x || typeof x !== 'object') return;
          if (x.template === 'casora_room' && x.variables) { x.variables.image = names[ph.name]; x.variables.image_night = names[ph.name]; changed++; }
          (Array.isArray(x) ? x : Object.values(x)).forEach(walk);
        })(v);
      });
      await H.callWS({ type: 'lovelace/config/save', url_path: url, config: cfg });
    }
    console.info('[sunyaad] photos set:', changed);
    if (changed) setTimeout(function () { location.reload(); }, 800);
  }
  var tries = 0;
  var iv = setInterval(function () {
    var ha = document.querySelector('home-assistant'), H = ha && ha.hass;
    if (H && H.states && Object.keys(H.states).length) { clearInterval(iv); run(H).catch(function (e) { console.warn('[sunyaad] setup', e); }); }
    else if (++tries > 60) clearInterval(iv);
  }, 1000);
})();
