// Sunyaad in the Studio. Loaded before casora-panel.js (scripts_view.STUDIO_MODULES); Casora's
// Studio calls in through window.sunyaadStudio at a few marked hooks ("Sunyaad:" in casora-panel.js):
//   sections(SECTIONS)        – adds "Tiles & areas", the smart greeting and the battery fields
//   phoneVars(home, vars)     – the phone title gets the smart greeting's entities too
//   field / preview           – CasoraPanel.prototype._sunyaadField / _sunyaadPreview (below)
//
// Where Sunyaad keeps a page's settings: on the page's tile row (the casora-smart-row card) as
// sunyaad_rooms (areas brought together, like Bedrooms) and sunyaad_tiles (which tiles, in order).
// The Studio carries that card through a save unchanged (room._row), so nothing is rebuilt from
// elsewhere and a save cannot drop it. Older saves kept a copy in the page's variables
// (sunyaad_areas / sunyaad_tiles): read as a fallback and cleared on the first edit.
(function () {
  const W = window;
  if (W.sunyaadStudio) return;

  // The pop-ups, the banner and the tile plan (shared with the dashboard).
  const ready = import("/casora_scripts/sunyaad/sunyaad.js").catch((e) => { console.error("[sunyaad] studio", e); });

  const LIST = (key, label, domains) => ({ key, label, type: "list", domains });
  const ids = (x) => (Array.isArray(x) ? x : []).map((r) => (r && typeof r === "object" ? r.area : r)).filter(Boolean);

  // The page's Sunyaad settings: the tile row first, the old copy in the variables second.
  function pageOf(room) {
    const row = (room && room._row) || {}, V = (room && room.variables) || {};
    const rooms = Array.isArray(row.sunyaad_rooms) && row.sunyaad_rooms.length ? row.sunyaad_rooms
      : Array.isArray(V.sunyaad_areas) && V.sunyaad_areas.length ? V.sunyaad_areas : [];
    const tiles = Array.isArray(row.sunyaad_tiles) && row.sunyaad_tiles.length ? row.sunyaad_tiles
      : Array.isArray(V.sunyaad_tiles) && V.sunyaad_tiles.length ? V.sunyaad_tiles : null;
    return { rooms, tiles };
  }
  const isHome = (room, rooms) => !!room && (room === rooms[0] || room.path === "home");

  W.sunyaadStudio = {
    ready,
    pageOf,

    sections(SECTIONS) {
      if (!Array.isArray(SECTIONS) || SECTIONS._sunyaad) return;
      SECTIONS._sunyaad = true;
      const greet = SECTIONS.find((s) => (s.fields || []).some((f) => f.key === "casora_greeting"));
      SECTIONS.unshift({
        // Which tiles the page shows (each opens its pop-up) and, for a page like Bedrooms, which
        // areas it brings together. The dashboard and the preview read the same settings.
        label: "Sunyaad", title: "Tiles & areas", icon: "home", iconColor: greet && greet.iconColor, group: "rooms",
        blurb: "The tiles along the bottom of this page. Bring several areas together for one page, like Bedrooms.",
        fields: [{ key: "sunyaad_tiles", label: "Tiles & areas", type: "sunyaad", always: true }],
      });
      if (!greet) return;
      const F = greet.fields, g = F.find((f) => f.key === "casora_greeting");
      if (Array.isArray(g.options) && g.options.indexOf("smart") < 0) g.options = g.options.concat("smart");
      g.optionLabels = Object.assign({}, g.optionLabels, { smart: "Smart greeting (weather, holidays, birthdays)" });
      const smart = (v) => v.casora_greeting === "smart";
      const add = [
        { ...LIST("casora_greeting_weather", "Weather for the greeting", ["weather"]), always: true, homeOnly: true, when: smart, hint: "Empty: the first weather entity." },
        { ...LIST("casora_greeting_gate", "Gate to warn about at night", ["cover"]), always: true, homeOnly: true, when: smart, hint: "Optional." },
        { ...LIST("casora_greeting_battery", "Battery level (%)", ["sensor"]), always: true, homeOnly: true, when: smart,
          hint: "Optional: adds battery-full and go-easy greetings in the evening." },
        { ...LIST("casora_greeting_solar", "Solar power (W)", ["sensor"]), always: true, homeOnly: true, when: smart,
          hint: "Optional: adds a sunny greeting when solar is above 2 kW." },
        // The battery pop-up (banner → Battery). Capacity comes from HA's energy settings.
        { key: "sunyaad_battery_packs", label: "Battery packs", type: "number", placeholder: "1", always: true, homeOnly: true,
          hint: "Sunyaad: number of battery packs, shown in the battery pop-up. Capacity comes from the energy settings." },
        { key: "sunyaad_battery_reserve", label: "Battery reserve (%)", type: "number", placeholder: "20", always: true, homeOnly: true,
          hint: "Sunyaad: the charge kept back for outages. Marked on the battery bar; time left counts down to it." },
      ];
      let at = F.findIndex((f) => f.key === "casora_greeting_people");
      if (at < 0) at = F.indexOf(g);
      F.splice(at + 1, 0, ...add);
    },

    // The phone's title follows the start page's greeting (markPhoneManaged).
    phoneVars(hv, cv) {
      ["casora_greeting_weather", "casora_greeting_gate", "casora_greeting_battery", "casora_greeting_solar"].forEach((k) => {
        if (hv.casora_greeting === "smart" && Array.isArray(hv[k]) && hv[k].length) cv[k] = hv[k].slice();
        else delete cv[k];
      });
    },
  };

  customElements.whenDefined("casora-panel").then(() => {
    const P = customElements.get("casora-panel").prototype;

    // "Tiles & areas": the areas a page brings together (Bedrooms) and the tiles it shows, in order.
    // set(key, value) clears the old copy in the variables.
    P._sunyaadField = function (room, fs, set) {
      const H = this._hass;
      const rooms = ((this._state || {}).compact || {}).rooms || [];
      const pg = pageOf(room), areasSel = ids(pg.rooms), merged = areasSel.length > 0, home = isHome(room, rooms);
      const M = W.sunyaadMergedTiles || { keys: ["lights", "media", "climate", "appliances", "energy", "presence", "more"],
        labels: { lights: "Lights", media: "Entertainment", climate: "Climate", appliances: "Appliances", energy: "Energy", presence: "Presence", more: "More" },
        defaults: ["lights", "media", "climate", "appliances", "energy", "more"] };
      // "More" (a room's other Casora tiles) only exists on a normal room.
      const plain = !merged && !home;
      const keys = M.keys.filter((k) => plain || k !== "more");
      const defaults = M.defaults.filter((k) => plain || k !== "more");
      const shown = pg.tiles ? pg.tiles.filter((k) => keys.includes(k)) : defaults.slice();
      const again = () => { this._syncPreview(); this._renderForm(); };
      // Written on the tile row the dashboard reads (room._row), the old variable copy dropped.
      const row = () => (room._row = room._row || {});
      const writeTiles = (next) => {
        if (!next || next.join() === defaults.join()) delete row().sunyaad_tiles; else row().sunyaad_tiles = next.slice();
        set("sunyaad_tiles", undefined);
      };
      const writeAreas = (next) => {
        if (next && next.length) {
          // Unchanged areas keep the form they were saved in ({name, area} or the area id).
          const cur = Array.isArray(row().sunyaad_rooms) ? row().sunyaad_rooms : [];
          row().sunyaad_rooms = next.map((a) => cur.find((r) => (r && typeof r === "object" ? r.area : r) === a) || a);
        } else delete row().sunyaad_rooms;
        set("sunyaad_areas", undefined);
      };
      const head = (text, hint) => {
        const h = document.createElement("div");
        h.className = "subhead";
        h.textContent = text;
        fs.appendChild(h);
        if (hint) { const p = document.createElement("div"); p.className = "hint"; p.textContent = hint; fs.appendChild(p); }
      };
      const pillCss = (on) => "border:0;border-radius:999px;padding:7px 13px;margin:0 6px 6px 0;cursor:pointer;font:inherit;font-size:var(--t-foot,13px);"
        + (on ? "background:var(--casora-studio-done, var(--accent, #B67A50));color:#fff;"
          : "background:var(--chip, rgba(255,255,255,.08));color:var(--ink, #fff);box-shadow:inset 0 0 0 1px var(--chip-rim, rgba(255,255,255,.12));");

      // Tiles: on/off and order
      head("Tiles on this page", "Tap a tile to show or hide it. The arrows change the order.");
      const list = document.createElement("div");
      list.style.cssText = "display:grid;gap:6px;margin:0 0 14px";
      const order = shown.concat(keys.filter((k) => !shown.includes(k)));
      order.forEach((k) => {
        const on = shown.includes(k);
        const r = document.createElement("div");
        r.style.cssText = "display:flex;align-items:center;gap:8px";
        const b = document.createElement("button");
        b.type = "button";
        b.style.cssText = pillCss(on) + "margin:0;flex:1;text-align:left";
        b.textContent = (on ? "✓  " : "+  ") + (M.labels[k] || k);
        b.onclick = () => { writeTiles(on ? shown.filter((x) => x !== k) : shown.concat(k)); again(); };
        r.appendChild(b);
        if (on) {
          const i = shown.indexOf(k);
          [["↑", -1], ["↓", 1]].forEach(([t, d]) => {
            const m = document.createElement("button");
            m.type = "button";
            m.textContent = t;
            m.disabled = i + d < 0 || i + d >= shown.length;
            m.style.cssText = pillCss(false) + "margin:0;width:36px;padding:7px 0;opacity:" + (m.disabled ? ".35" : "1");
            m.onclick = () => { const n = shown.slice(); n.splice(i, 1); n.splice(i + d, 0, k); writeTiles(n); again(); };
            r.appendChild(m);
          });
        }
        list.appendChild(r);
      });
      fs.appendChild(list);

      // Areas brought together (not on the start page: it always covers the whole home)
      if (home) return;
      head("Areas on this page", merged
        ? "This page shows these areas together; each pop-up lists them room by room. Remove all to make it a normal room again."
        : "Pick two or more areas to make one page for them, like Bedrooms. Leave empty for a normal room.");
      const wrap = document.createElement("div");
      wrap.style.cssText = "display:flex;flex-wrap:wrap;margin:0 0 6px";
      Object.values((H && H.areas) || {}).sort((a, b) => String(a.name).localeCompare(String(b.name))).forEach((a) => {
        const on = areasSel.includes(a.area_id);
        const b = document.createElement("button");
        b.type = "button";
        b.style.cssText = pillCss(on);
        b.textContent = a.name;
        b.setAttribute("data-no-i18n", "");
        b.onclick = () => {
          const next = on ? areasSel.filter((x) => x !== a.area_id) : areasSel.concat(a.area_id);
          // The tile choice belongs to one kind of page: switching kinds starts from its default.
          if (!!next.length !== merged) writeTiles(null);
          writeAreas(next);
          again();
        };
        wrap.appendChild(b);
      });
      fs.appendChild(wrap);
    };

    // The preview draws what the dashboard shows: Sunyaad's banner instead of Casora's badges and
    // the page's tiles from the same plan as the dashboard.
    P._sunyaadPreview = function (room, badges, tiles) {
      try {
        if (W.CASORA_SECTIONS === false || !W.sunyaadPagePlan || !room) return;
        const H = this._hass, rooms = ((this._state || {}).compact || {}).rooms || [];
        const pg = pageOf(room), home = isHome(room, rooms);
        const plan = W.sunyaadPagePlan(H, { rooms: pg.rooms, tiles: pg.tiles, cards: room.tiles, home, name: room.name });
        const toSection = (ev) => { ev.stopPropagation(); this._select({ group: "rooms", key: "Sunyaad", label: "Sunyaad" }); };
        // Casora's single tiles make way (its "Add a tile" stays on a normal room).
        [...tiles.children].forEach((c) => { if (pg.rooms.length || home || !c.classList.contains("ghost")) c.style.display = "none"; });
        plan.forEach((t) => {
          const el = document.createElement("div");
          el.className = "mtile";
          el.innerHTML = '<span class="mtop"><span class="mcircle"><span class="mglyph"></span></span></span>'
            + '<span class="mbot"><span class="mname"></span><span class="mstate"></span></span>';
          el.querySelector(".mglyph").style.setProperty("--i", "url('/casora_assets/icons/" + t.icon + ".svg')");
          el.querySelector(".mname").textContent = t.name;
          el.querySelector(".mstate").textContent = t.state;
          el.title = "Tiles & areas";
          el.onclick = toSection;
          tiles.appendChild(el);
        });
        if (customElements.get("sunyaad-banner")) {
          [...badges.children].forEach((c) => { c.style.display = "none"; });
          const bn = document.createElement("sunyaad-banner");
          bn.style.cssText = "pointer-events:none;transform-origin:left center";
          badges.appendChild(bn);
          const V = room.variables || {};
          bn.update(H, home ? V : ((rooms[0] || {}).variables || {}),
            { _sunyaadScope: home ? "home" : "room", _config: { variables: Object.assign({}, V, pg.rooms.length ? { sunyaad_areas: ids(pg.rooms) } : {}) } });
          badges.onclick = toSection;
        }
      } catch (e) { /* the preview keeps Casora's own drawing */ }
    };

    // Once the plan has loaded, draw open Studios again so the preview shows it.
    ready.then(() => {
      const walk = (root, d) => {
        if (!root || d > 8) return;
        root.querySelectorAll("*").forEach((el) => {
          if (el.tagName === "CASORA-PANEL" && el._state && el._rebuildPreview) { try { el._rebuildPreview(); } catch (e) { /* next change draws it */ } }
          else if (el.shadowRoot) walk(el.shadowRoot, d + 1);
        });
      };
      walk(document, 0);
    });
  });
})();
