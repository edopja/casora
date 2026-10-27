// Sunyaad on the phone dashboard: the page row stays Casora's, room pages get Sunyaad's tiles.
// Run: node dev/unit/sunyaad_phone_rows.mjs
import assert from 'node:assert/strict';

const defined = {};
globalThis.window = globalThis;
globalThis.location = { pathname: '/casora-dashboard-mobile/home' };
class FakeEl {
  attachShadow() { this.shadowRoot = { innerHTML: '', children: [], querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, appendChild(c) { this.children.push(c); } }; return this.shadowRoot; }
  remove() {}
}
globalThis.HTMLElement = FakeEl;
globalThis.customElements = { get: (t) => defined[t], define: (t, c) => { defined[t] = c; } };
globalThis.document = {
  documentElement: { style: { setProperty() {} } }, querySelectorAll: () => [], querySelector: () => null,
  createElement: (t) => (t === 'casora-smart-row-classic' ? { setConfig(c) { this.config = c; }, set hass(h) { this.h = h; } } : { textContent: '' }),
};
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
globalThis.addEventListener = () => {};
globalThis.setInterval = () => 0;
globalThis.clearInterval = () => {};
globalThis.setTimeout = () => 0;
globalThis.clearTimeout = () => {};
globalThis.Event = class { constructor(t) { this.type = t; } };
globalThis.dispatchEvent = () => {};

await import('../../custom_components/casora/scripts/sunyaad/sunyaad.js');
await import('../../custom_components/casora/scripts/sunyaad/rows.js');

const st = (state, attributes = {}) => ({ state: String(state), attributes });
const states = {
  'light.garage_post': st('on'),
  'switch.ev_charger': st('on'),
  'sensor.ev_charger_status': st('charging', { options: ['charging', 'available'] }),
  'sensor.ev_charger_power': st(3300, { device_class: 'power', unit_of_measurement: 'W' }),
  'number.ev_charger_charging_current': st(16, { min: 6, max: 16, step: 1 }),
};
const entities = {};
Object.keys(states).forEach((e) => { entities[e] = { entity_id: e, device_id: e.startsWith('light') ? 'dev_l' : 'dev_ev' }; });
let asked = null;
const H = {
  states, entities, user: { id: 'u1' },
  devices: { dev_l: { name: 'Post', area_id: 'garage' }, dev_ev: { name: 'EV Charger', area_id: 'garage' } },
  areas: { garage: { name: 'Garage' } }, config: { currency: 'JMD' }, themes: { darkMode: true },
  callWS: () => new Promise(() => {}),
  connection: { sendMessagePromise: (m) => { asked = m; return new Promise(() => {}); } },
};

// The phone page: one row holding the greeting, badges, room pages and room sections.
const Row = defined['casora-smart-row'];
const page = new Row();
const pageCfg = { type: 'custom:casora-smart-row', scroll_mode: true, cards: [
  { type: 'custom:button-card', template: 'casora_mobile_weather' },
  { type: 'custom:casora-filter-overlay', room: 'Garage' },
  { type: 'custom:button-card', template: 'casora_mobile_header', name: 'Garage' },
  { type: 'custom:casora-smart-row', cards: [{ type: 'custom:button-card', template: 'casora_switch', entity: 'switch.ev_charger' }] },
] };
page.setConfig(pageCfg);
page.hass = H;
assert.equal(page._row.config, pageCfg, 'the phone page row stays Casora\'s own');
assert.deepEqual(asked, { type: 'lovelace/config', url_path: 'casora-dashboard' }, 'reads the desktop pair once');

// A room row on the phone stays Casora's too (the room page draws Sunyaad's tiles).
const room = new Row();
const roomCfg = pageCfg.cards[3];
room.setConfig(roomCfg);
room.hass = H;
assert.equal(room._row.config, roomCfg);

// The room page: Sunyaad's tiles for the room, opening its pop-ups.
const cards = window.sunyaadRoomCards(H, 'Garage', roomCfg.cards);
const names = cards.map((c) => c.name);
assert.ok(names.includes('EV Charger') && names.includes('Lights'), 'room tiles: ' + names);
const ev = cards.find((c) => c.name === 'EV Charger');
assert.match(ev.state_display, /Charging/);
assert.ok(window._sunyaadTiles[ev.tap_action.sunyaad_open], 'the tile names its pop-up');

// On a desktop page the row is Sunyaad's.
globalThis.location = { pathname: '/casora-dashboard/garage' };
const desk = new Row();
desk.setConfig({ type: 'custom:casora-smart-row', cards: roomCfg.cards });
desk.hass = H;
assert.notEqual(desk._row.config.cards, roomCfg.cards, 'desktop row draws Sunyaad tiles');

console.log('sunyaad_phone_rows: ok');
