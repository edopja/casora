// Sunyaad: smart greeting and two-line titles, layered over Casora's greeting (casora-core.js).
// Casora's window.casoraGreeting / window.casoraFitTitle are wrapped, not edited: an update of
// Casora keeps working, and without this file Casora's own greeting shows.
// Smart greeting (fork): variables.casora_greeting = 'smart'. Name always from the signed-in HA user.
// Special days (own + other people's birthdays from input_datetime.<firstname>_birthday, Jamaican holidays,
// Easter dates) > gate open at night > storm / rain > welcome home > a rotating time-of-day pool.
// Optional variables: casora_greeting_weather, casora_greeting_gate, casora_greeting_battery, casora_greeting_solar
// (each a list with one entity; weather falls back to the first weather.* entity).
(function () {
  if (window.casoraSmartGreeting) return;
  var first = function (n) { return String(n || '').trim().split(/\s+/)[0] || ''; };
  var one = function (x) { return Array.isArray(x) ? x.filter(Boolean)[0] : x; };
  var pad = function (n) { return ('0' + n).slice(-2); };
  var dayMs = 86400000;
  var dOnly = function (y, mo, d) { return Date.UTC(y, mo, d); };
  function easter(y) {
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
      g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
      l = (32 + 2 * e + 2 * i - h - k) % 7, q = Math.floor((a + 11 * h + 22 * l) / 451), t = h + l - 7 * q + 114;
    return dOnly(y, Math.floor(t / 31) - 1, (t % 31) + 1);
  }
  // n-th weekday (0 = Sunday … 6 = Saturday) of a month
  function nth(y, mo, wd, n) { var w = new Date(y, mo, 1).getDay(); return 1 + (wd - w + 7) % 7 + 7 * (n - 1); }
  window.casoraSmartGreeting = function (hass, vars, now) {
    var v = vars || {}, S = (hass && hass.states) || {}, u = hass && hass.user;
    var who = first(u && u.name);
    var n = now || new Date(), y = n.getFullYear(), mo = n.getMonth(), dd = n.getDate();
    var m = n.getHours() * 60 + n.getMinutes(), dow = (n.getDay() + 6) % 7; // 0 = Monday, like Python
    var md = pad(mo + 1) + '-' + pad(dd), today = dOnly(y, mo, dd);
    var doy = Math.floor((today - dOnly(y, 0, 1)) / dayMs) + 1;
    var st = function (e) { return e && S[e] ? S[e].state : ''; };
    var num = function (e) { var x = parseFloat(st(e)); return isNaN(x) ? null : x; };
    var wxId = one(v.casora_greeting_weather) || (S['weather.forecast_home'] ? 'weather.forecast_home' : Object.keys(S).filter(function (e) { return e.indexOf('weather.') === 0; })[0]);
    var wx = st(wxId), outT = wxId && S[wxId] ? parseFloat((S[wxId].attributes || {}).temperature) : NaN;
    var pv = num(one(v.casora_greeting_solar)), soc = num(one(v.casora_greeting_battery));
    var rain = ['rainy', 'pouring', 'lightning-rainy', 'hail'].indexOf(wx) >= 0, storm = ['lightning', 'lightning-rainy'].indexOf(wx) >= 0;
    var awake = m >= 300 && m < 1320;
    // the signed-in user's person (matched by user id, falls back to first name)
    var pid = Object.keys(S).filter(function (e) { return e.indexOf('person.') === 0; }).filter(function (e) {
      var a = S[e].attributes || {}; return (u && a.user_id === u.id) || (who && first(a.friendly_name).toLowerCase() === who.toLowerCase());
    })[0];
    var p = pid && S[pid];
    // A Home Assistant restart resets last_changed on everything; sun.sun only changes at sunrise/sunset,
    // so if it changed within two minutes of the person it was a restart, not an arrival.
    var sun = S['sun.sun'], restart = !!(p && sun && Math.abs(new Date(p.last_changed) - new Date(sun.last_changed)) < 120000);
    var justHome = !!(p && p.state === 'home' && !restart && (n - new Date(p.last_changed)) < 1800000);
    var gate = one(v.casora_greeting_gate), gateOpen = ['open', 'opening', 'closing'].indexOf(st(gate)) >= 0;
    var day = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][dow];
    var pick = doy * 7 + Math.floor(n.getHours() / 2);
    var W = function (txt) { return who ? txt.replace('{w}', who) : txt.replace(/,? ?\{w\}/, ''); };
    var dE = Math.round((today - easter(y)) / dayMs);
    var heroes = nth(y, 9, 1, 3), mums = nth(y, 4, 0, 2), dads = nth(y, 5, 0, 3);
    var toHeroes = Math.round((dOnly(y, 9, heroes) - today) / dayMs), toXmas = Math.round((dOnly(y, 11, 25) - today) / dayMs);
    var bdOf = function (name) { var b = st('input_datetime.' + name.toLowerCase() + '_birthday'); return b && b.slice(0, 4) !== '1970' && b.slice(5, 10) === md; };
    var other = Object.keys(S).filter(function (e) { return /^input_datetime\.[a-z0-9]+_birthday$/.test(e); }).map(function (e) { return e.slice(15, -9); })
      .filter(function (nm) { return nm !== who.toLowerCase() && bdOf(nm); })[0];
    var cap = function (s) { return s.charAt(0).toUpperCase() + s.slice(1); };
    var special = '';
    if (who && bdOf(who)) special = W('Happy Birthday, {w}! 🎂🎉');
    else if (other) special = W("It's " + cap(other) + "'s birthday today, {w} 🎂");
    else if (md === '01-01') special = W('Happy New Year, {w}! 🎆');
    else if (md === '02-06') special = W('One Love, {w}. Happy Bob Marley Day 🎶');
    else if (md === '02-14') special = W("Happy Valentine's Day, {w} ❤️");
    else if (dE === -46) special = W('Ash Wednesday today, {w} 🙏🏾');
    else if (dE >= -9 && dE <= -3) special = W('Easter soon, {w}. Got the bun and cheese? 🧀');
    else if (dE === -2) special = W('Blessed Good Friday, {w} ✝️');
    else if (dE === 0) special = W('Happy Easter, {w} 🐣');
    else if (dE === 1) special = W('Happy Easter Monday, {w} 🌴');
    else if (md === '05-23') special = W('Happy Labour Day, {w} 🛠️');
    else if (mo === 4 && dd === mums) special = W("Happy Mother's Day! Call your mom, {w} 💐");
    else if (mo === 5 && dd === dads) special = W("Happy Father's Day, {w} 👨🏾‍👧🏾");
    else if (md === '08-01') special = W('Happy Emancipation Day, {w} ✊🏾');
    else if (md === '08-06') special = W('Happy Independence Day, {w} 🇯🇲');
    else if (['08-02', '08-03', '08-04', '08-05'].indexOf(md) >= 0) special = W('Happy Emancipendence, {w} 🇯🇲');
    else if (toHeroes === 0) special = W('Happy National Heroes Day, {w} 🇯🇲');
    else if (md === '12-24') special = W('Grand Market night, {w} 🎄');
    else if (md === '12-25') special = W('Merry Christmas, {w}! 🎄');
    else if (md === '12-26') special = W('Happy Boxing Day, {w} 🎁');
    else if (md === '12-31') special = W("Happy Old Year's Night, {w} 🎆");
    var pool;
    if (m >= 300 && m < 510) {
      pool = ['Good morning, {w} ☀️', 'Rise and shine, {w} 🌅', "Mawnin', {w} ☀️", 'Morning, {w} ☕'];
      if (dow >= 5) pool.push('Happy ' + day + ', {w} 🎉');
      if (dow === 0) pool.push('New week, {w} 💪');
    } else if (m >= 510 && m < 720) {
      pool = ['Hey, {w} 👋', 'Wah gwaan, {w} 🇯🇲', 'Yes, {w}! 👊', 'Hi there, {w} 👋'];
      if (dow >= 5) pool.push('Happy ' + day + ', {w} 🎉');
      if (pv != null && pv > 2000) pool.push("Sun's working for you, {w} ☀️");
    } else if (m >= 720 && m < 1020) {
      pool = ['Good afternoon, {w} 🌤️', 'Afternoon, {w} 👋', 'Wah gwaan, {w} 🇯🇲', "How's the day going, {w}?"];
      if (pv != null && pv > 2000) pool.push("Sun's working for you, {w} ☀️");
      if (dow === 3) pool.push('Almost the weekend, {w} 🙌');
    } else if (m >= 1020 && m < 1320) {
      pool = ['Good evening, {w} 🌇', "Evenin', {w} 🌴", 'Evening, {w} 🌙', 'Time to wind down, {w} 🛋️'];
      if (dow === 4) pool.push('TGIF, {w} 🎉');
      if (soc != null && soc >= 97) pool.push("Battery's full, {w} 🔋");
      if (soc != null && soc < 40) pool.push('Go easy on power tonight, {w} 🔋');
    } else {
      pool = ['Good night, {w} 🌙', 'Still up, {w}? 🌙', 'Late one tonight, {w} 🦉'];
    }
    if (!isNaN(outT) && outT >= 32 && awake) pool.push('Hot one out there, {w}. Stay hydrated 💧');
    if (toHeroes > 0 && toHeroes <= 7) pool.push('Heroes Day in ' + toHeroes + (toHeroes === 1 ? ' day' : ' days') + ', {w} 🇯🇲');
    if (toXmas > 0 && toXmas <= 24) pool.push(toXmas + (toXmas === 1 ? ' day' : ' days') + ' to Christmas, {w} 🎄');
    if (special) return special;
    if (gateOpen && (m >= 1200 || m < 300)) return W('Heads up, {w}: the gate is open 🚪');
    if (storm && awake) return W('Thunder out there, {w}. Stay safe ⛈️');
    if (wx === 'pouring' && awake) return W("It's pouring, {w}. Walk with an umbrella");
    if (rain && justHome) return W('Welcome home, {w}. Dry off');
    if (rain && awake) return W(["It's raining, {w}. Walk with an umbrella", 'Rain a fall, {w}. Grab your umbrella', 'Wet one out there, {w}. Umbrella time'][pick % 3]);
    if (rain) return W('Rainy night, {w}. Good sleeping weather 🌧️');
    if (justHome && m >= 300) return W('Welcome home, {w} 🏡');
    return W(pool[pick % pool.length]);
  };
})();

// Wrap Casora's greeting: mode 'smart' is Sunyaad's, every other mode stays Casora's.
(function () {
  var W = window;
  function hook() {
    if (!W.casoraGreeting || W.casoraGreeting._sunyaad) return !!W.casoraGreeting;
    var base = W.casoraGreeting;
    var g = function (hass, vars, now) {
      if (vars && vars.casora_greeting === 'smart') return W.casoraSmartGreeting ? W.casoraSmartGreeting(hass, vars, now) : null;
      return base.apply(this, arguments);
    };
    g._sunyaad = true;
    W.casoraGreeting = g;
    var fit = W.casoraFitTitle;
    if (fit) {
      // A two-part greeting ("It's raining, Edney. Walk with an umbrella") keeps the first part big
      // and puts the advice on a smaller line underneath.
      W.casoraFitTitle = function (el, area) {
        var sp = el && el.querySelector && el.querySelector('span[data-no-i18n]');
        if (sp && !sp._casoraSplit) {
          var txt = sp.textContent || '', cut = txt.indexOf('. ');
          if (cut > 0 && cut < txt.length - 2) {
            sp._casoraSplit = true;
            sp.textContent = txt.slice(0, cut);
            var sub = document.createElement('span');
            sub.textContent = txt.slice(cut + 2);
            sub.style.cssText = 'display:block;font-size:0.42em;font-weight:500;letter-spacing:0;opacity:0.85;margin-top:0.15em;white-space:normal';
            sp.appendChild(sub);
          }
        }
        return fit.apply(this, arguments);
      };
    }
    return true;
  }
  if (!hook()) { var n = 0, t = setInterval(function () { if (hook() || ++n > 100) clearInterval(t); }, 100); }
})();
