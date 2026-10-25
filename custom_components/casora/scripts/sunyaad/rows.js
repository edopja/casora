// Sunyaad: the grouped tile row. Loaded by smart-row.js, which keeps Casora's own row as
// 'casora-smart-row-classic'; this file takes the name 'casora-smart-row' and draws the classic row
// inside it. If this file is missing or fails, smart-row.js gives the name back to Casora's row.

// Same helper as smart-row.js (module scope there).
function userHides(cfg, user) {
  const list = cfg && Array.isArray(cfg.visibility) ? cfg.visibility : null;
  if (!list) return false;
  return list.some((v) => v && v.condition === 'user' && Array.isArray(v.users)
    && !(user && user.id && v.users.indexOf(user.id) !== -1));
}
// ── Sunyaad tile row ────────────────────────────────────────────────────────────────────
// Every page shows one tile per group: Lights · Entertainment · Climate · Appliances · Energy
// (and More for a room's other tiles). The plan comes from window.sunyaadPagePlan (sunyaad.js),
// the same one the Studio preview draws, so every page opens the same pop-ups.
// Layout, size and look stay Casora's: the classic row draws the tiles.
// Opt out (Casora's original tiles): window.CASORA_SECTIONS = false, or classic: true on the row.

// The pop-up's content: the group's devices as Casora tiles.
class CasoraGroupList extends HTMLElement {
  setConfig(c) { this._c = c || { cards: [] }; this._built = false; }
  set hass(h) { this._h = h; if (!this._built) this._build(); else (this._els || []).forEach((e) => { e.hass = h; }); }
  getCardSize() { return 3; }
  async _build() {
    this._built = true;
    const helpers = await (window.loadCardHelpers ? window.loadCardHelpers() : null);
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `<style>
      :host { display: block; }
      .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 12px; }
      @media (max-width: 767px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; } }
    </style><div class="grid"></div>`;
    const grid = this.shadowRoot.querySelector('.grid');
    this._els = [];
    (this._c.cards || []).forEach((cfg) => {
      let el; try { el = helpers.createCardElement(cfg); } catch (e) { el = document.createElement('div'); }
      el.hass = this._h; grid.appendChild(el); this._els.push(el);
    });
  }
}

// Group tiles about 40% smaller than Casora's (desktop and tablet; the phone has its own dashboard).
const CS_HOST_CSS = `
  :host {
    display: block;
    --casora-entity-height-current: calc(var(--casora-entity-height-desktop, 180px) * 0.6);
    --casora-entity-col-width-current: calc(var(--casora-entity-col-width-desktop, 280px) * 0.6);
    --casora-entity-inner-pad-current: 14px;
    --casora-entity-name-font-current: 15px;
    --casora-entity-state-font-current: 12.5px;
    --casora-entity-icon-size-current: 28px;
  }
  @media (min-width: 768px) and (max-width: 1600px) and (min-height: 501px) and (hover: none) and (pointer: coarse) {
    :host {
      --casora-entity-height-current: calc(var(--casora-entity-height-tablet, 150px) * 0.6);
      --casora-entity-col-width-current: calc(var(--casora-entity-col-width-tablet, 210px) * 0.6);
      --casora-entity-inner-pad-current: 12px;
      --casora-entity-name-font-current: 14px;
    }
  }
`;
// Inside each tile: no white "on" overlay, text and icon keep the off colours.
const CS_TILE_GLASS = `
  ha-card {
    --casora-active-overlay-opacity: 0 !important;
    --casora-entity-name-active: var(--casora-entity-name, rgba(255, 255, 255, 0.9)) !important;
    --casora-entity-state-active: var(--casora-entity-state, rgba(255, 255, 255, 0.7)) !important;
    --casora-entity-state-active-color: var(--casora-entity-state, rgba(255, 255, 255, 0.7)) !important;
  }
  ha-card::after { opacity: 0 !important; }
`;

class CasoraSections extends HTMLElement {
  constructor() { super(); this.attachShadow({ mode: 'open' }); this._sig = null; }
  static getConfigElement() { return document.createElement('div'); }
  static getStubConfig() { return { cards: [] }; }
  setConfig(config) {
    this._config = config || { cards: [] };
    this._sig = null;
    if (this._hass) this._update();
  }
  set hass(h) { this._hass = h; this._update(); }
  get hass() { return this._hass; }
  getCardSize() { return this._row && this._row.getCardSize ? this._row.getCardSize() : 4; }

  _rowEl() {
    if (!this._row) {
      const st = document.createElement('style');
      st.textContent = CS_HOST_CSS;
      this.shadowRoot.appendChild(st);
      this._row = document.createElement('casora-smart-row-classic');
      this.shadowRoot.appendChild(this._row);
    }
    return this._row;
  }
  // Every tile stays frosted glass (like an off tile), even when its devices are on.
  _glass() {
    const root = this._row && this._row.shadowRoot;
    if (!root) return;
    const walk = (node, depth) => {
      if (!node || depth > 6) return;
      node.querySelectorAll('*').forEach((el) => {
        if (el.tagName === 'BUTTON-CARD') {
          const sr = el.shadowRoot;
          if (sr && sr.querySelector('ha-card') && !sr.getElementById('casora-sections-glass')) {
            const st = document.createElement('style'); st.id = 'casora-sections-glass'; st.textContent = CS_TILE_GLASS; sr.appendChild(st);
          }
        } else if (el.shadowRoot) walk(el.shadowRoot, depth + 1);
      });
    };
    walk(root, 0);
  }
  _update() {
    if (!this._hass || !this._config) return;
    const row = this._rowEl();
    let cfg = this._config;
    if (window.CASORA_SECTIONS !== false && !this._config.classic) {
      const g = this._grouped();
      if (g) cfg = Object.assign({}, this._config, { cards: g.cards, sort: false }), this._sigNow = g.sig;
    }
    const sig = cfg === this._config ? 'classic' : this._sigNow;
    if (sig !== this._sig) { this._sig = sig; row.setConfig(cfg); }
    row.hass = this._hass;
    if (sig !== 'classic') {
      this._glass();
      clearTimeout(this._glassT);
      this._glassT = setTimeout(() => this._glass(), 600);
    }
  }

  // The page's tiles from Sunyaad's plan. Each tile only names its pop-up (sunyaad_open); the
  // content stays in this page (window._sunyaadTiles) and sunyaad.js opens it on tap.
  _grouped() {
    const H = this._hass, P = window.sunyaadPagePlan, c = this._config;
    if (!P) return null;
    const base = (c.cards || []).filter((x) => !userHides(x, H.user));
    const path = location.pathname || '';
    // The banner of this page covers the same areas (sunyaad.js roomArea).
    (window._sunyaadPageRooms || (window._sunyaadPageRooms = {}))[path] = (Array.isArray(c.sunyaad_rooms) ? c.sunyaad_rooms : [])
      .map((r) => (r && typeof r === 'object' ? r.area : r)).filter(Boolean);
    const plan = P(H, {
      rooms: c.sunyaad_rooms, tiles: c.sunyaad_tiles, cards: base,
      home: c.sunyaad_home === true || (c.sunyaad_home !== false && /\/home\/?$/.test(path)),
    });
    if (!plan.length) return null;
    const reg = window._sunyaadTiles || (window._sunyaadTiles = {});
    const cards = [], sig = [];
    plan.forEach((t) => {
      const id = 'p:' + path + ':' + t.key;
      reg[id] = { title: t.name, content: t.content, dismissable: true, dismiss_on_background: true };
      const act = { action: 'fire-dom-event', haptic: 'light', sunyaad_open: id };
      cards.push({ type: 'custom:button-card', template: 'casora_entity', entity: (t.active || [])[0] || 'sun.sun',
        name: t.name, show_state: true, state_display: t.state, variables: { icon: t.icon, active_entities: t.active || [] },
        tap_action: act, hold_action: act, icon_tap_action: act });
      sig.push(t.key + ':' + t.state);
    });
    return { cards, sig: sig.join('|') };
  }
}
if (!customElements.get('casora-smart-row')) customElements.define('casora-smart-row', CasoraSections);

// The Sunyaad banner lives in scripts/sunyaad/sunyaad.js (the Studio preview draws it too).

if (!customElements.get('casora-group-list')) customElements.define('casora-group-list', CasoraGroupList);
