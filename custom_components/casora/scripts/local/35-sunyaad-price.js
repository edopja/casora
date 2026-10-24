// ── Sunyaad one-time setup (temporary, removed in a later update) ───────────────────────────
// On the maintainer's own Home Assistant only: electricity price J$80 per kWh (Studio →
// Settings → Price per kWh shows and changes it from then on).
(function () {
  var FLAG = 'sunyaad_once_price_80';
  function done() { try { return localStorage.getItem(FLAG) === '1'; } catch (e) { return true; } }
  async function run(H) {
    if (done() || !H.user || !H.user.is_admin) return;
    if (!H.states['cover.ed_gate'] || !H.states['sensor.deye_battery_soc']) return;
    try { localStorage.setItem(FLAG, '1'); } catch (e) { return; }
    var cur = await H.callWS({ type: 'casora/options/get' });
    var opts = Object.assign({}, (cur && cur.options) || {}, { price_kwh: 80 });
    await H.callWS({ type: 'casora/options/set', options: opts });
    window.CASORA_PRICE_KWH = 80;
    console.info('[sunyaad] electricity price set to 80 per kWh');
  }
  var tries = 0;
  var iv = setInterval(function () {
    var ha = document.querySelector('home-assistant'), H = ha && ha.hass;
    if (H && H.states && Object.keys(H.states).length) { clearInterval(iv); setTimeout(function () { run(H).catch(function (e) { console.warn('[sunyaad] price', e); }); }, 2000); }
    else if (++tries > 60) clearInterval(iv);
  }, 1000);
})();
