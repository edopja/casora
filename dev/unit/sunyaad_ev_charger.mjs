// Sunyaad EV charger: found by itself, its own tile and pop-up, not counted as an appliance.
// Run: node dev/unit/sunyaad_ev_charger.mjs
import assert from 'node:assert/strict';

// Minimal browser stand-ins: enough for sunyaad.js to define its elements and helpers.
const defined = {};
globalThis.window = globalThis;
globalThis.location = { pathname: '/casora/home' };
globalThis.HTMLElement = class {
  attachShadow() { this.shadowRoot = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, appendChild() {} }; return this.shadowRoot; }
};
globalThis.customElements = { get: (t) => defined[t], define: (t, c) => { defined[t] = c; } };
globalThis.document = { documentElement: { style: { setProperty() {} } }, querySelectorAll: () => [] };
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
globalThis.addEventListener = () => {};
globalThis.setInterval = () => 0;
globalThis.setTimeout = () => 0;
globalThis.Event = class { constructor(t) { this.type = t; } };
globalThis.dispatchEvent = () => {};

await import('../../custom_components/casora/scripts/sunyaad/sunyaad.js');

// A charger shaped like a Tuya one: a mis-scaled total power sensor, a real per-phase one.
const st = (state, attributes = {}) => ({ state: String(state), attributes });
const states = {
  'switch.ev_charger': st('on'),
  'sensor.ev_charger_status': st('charging', { options: ['charging', 'available', 'plugged_in', 'charged', 'fault'] }),
  'number.ev_charger_charging_current': st(16, { min: 6, max: 16, step: 1, unit_of_measurement: 'A' }),
  'number.ev_charger_timer': st(0, { min: 0, max: 15, step: 1, unit_of_measurement: 'h' }),
  'select.ev_charger_charging_mode': st('immediate', { options: ['immediate', 'scheduled_charge', 'delayed_charge'] }),
  'sensor.ev_charger_power': st(0.003, { device_class: 'power', unit_of_measurement: 'kW' }),
  'sensor.ev_charger_power_a': st(3.369, { device_class: 'power', unit_of_measurement: 'kW' }),
  'sensor.ev_charger_current_a': st(14.1, { device_class: 'current', unit_of_measurement: 'A' }),
  'sensor.ev_charger_voltage_a': st(239, { device_class: 'voltage', unit_of_measurement: 'V' }),
  'sensor.ev_charger_energy': st(0.69, { device_class: 'energy', state_class: 'total_increasing', unit_of_measurement: 'kWh' }),
  'sensor.ev_charger_last_charge': st(0.61, { device_class: 'energy', state_class: 'measurement', unit_of_measurement: 'kWh' }),
  'sensor.ev_charger_temperature': st(30, { device_class: 'temperature', unit_of_measurement: '°C' }),
  'binary_sensor.ev_charger_problem': st('off', { device_class: 'problem' }),
  'switch.fridge': st('on'),
  'sensor.fridge_power': st(80, { device_class: 'power', unit_of_measurement: 'W' }),
};
const entities = {};
Object.keys(states).forEach((e) => { entities[e] = { entity_id: e, device_id: e.includes('fridge') ? 'dev_fridge' : 'dev_ev', name: null }; });
// Some charger entities are not tied to the device in the registry: found by their id prefix.
['sensor.ev_charger_power_a', 'sensor.ev_charger_current_a', 'sensor.ev_charger_voltage_a'].forEach((e) => { delete entities[e]; });
// An inverter with a charge-current setting is not a charger.
states['number.inv_max_charge_current'] = st(150, { min: 0, max: 250, step: 1 });
entities['number.inv_max_charge_current'] = { entity_id: 'number.inv_max_charge_current', device_id: 'dev_inv', name: null };
const calls = [];
const H = {
  states, entities,
  devices: { dev_ev: { name: 'EV Charger', area_id: 'garage' }, dev_fridge: { name: 'Fridge', area_id: 'garage' }, dev_inv: { name: 'Deye Inverter', area_id: 'garage' } },
  areas: { garage: { name: 'Garage' } },
  config: { currency: 'JMD' }, themes: { darkMode: true },
  callWS: () => new Promise(() => {}),
  callService: (d, s, data) => calls.push([d, s, data]),
};

const evs = window.sunyaadEvChargers(H);
assert.equal(evs.length, 1, 'one charger found');
const ev = evs[0];
assert.equal(ev.power, 'sensor.ev_charger_power_a', 'the real power sensor, not the mis-scaled total');
assert.equal(ev.current, 'number.ev_charger_charging_current');
assert.equal(ev.energy, 'sensor.ev_charger_energy');
assert.equal(ev.last, 'sensor.ev_charger_last_charge');
assert.equal(ev.mode, 'select.ev_charger_charging_mode');
assert.equal(ev.sw, 'switch.ev_charger');
assert.equal(ev.amps, 'sensor.ev_charger_current_a');
assert.equal(ev.volt, 'sensor.ev_charger_voltage_a');

const sm = window.sunyaadEvSummary(H, evs);
assert.ok(sm.charging && /3\.4 kW/.test(sm.text), 'tile says Charging · 3.4 kW: ' + sm.text);

// The garage page: an EV tile, and the charger is not one of the appliances.
const plan = window.sunyaadPagePlan(H, { rooms: [{ name: 'Garage', area: 'garage' }] });
const keys = plan.map((t) => t.key);
assert.ok(keys.includes('ev'), 'EV tile on the page: ' + keys);
assert.ok(keys.indexOf('ev') === keys.indexOf('appliances') + 1, 'EV right after Appliances');
assert.deepEqual(plan.find((t) => t.key === 'appliances').active, ['switch.fridge'], 'only the fridge is an appliance');
// A page saved with its own tile list before the EV tile existed still gets it.
const saved = window.sunyaadPagePlan(H, { rooms: [{ name: 'Garage', area: 'garage' }], tiles: ['lights', 'appliances', 'energy'] }).map((t) => t.key);
assert.deepEqual(saved, ['appliances', 'ev', 'energy']);

// The pop-up draws speed, mode and stats, and the buttons call the right services.
const El = defined['sunyaad-ev'];
const el = new El();
el.setConfig({ rooms: [{ area: 'garage' }] });
el.hass = H;
const html = el.shadowRoot.innerHTML;
['Charging speed', 'Charging mode', 'This session', 'Last session', 'Temperature', '3.4 kW', '14.1 A', '239 V', '16<small> A</small>', 'Stop'].forEach((t) =>
  assert.ok(html.includes(t), 'pop-up shows ' + t));
assert.ok(/data-a="6"/.test(html) && /data-a="16"/.test(html), 'speed chips from min to max');
assert.ok(!/data-t=/.test(html), 'no timer while charging immediately');

states['select.ev_charger_charging_mode'] = st('delayed_charge', states['select.ev_charger_charging_mode'].attributes);
el._sig = null; el.hass = { ...H, states: { ...states } };
assert.ok(/data-t="1"/.test(el.shadowRoot.innerHTML), 'timer shows for a delayed charge');

// A fault shows its description.
states['binary_sensor.ev_charger_problem'] = st('on', { device_class: 'problem', description: 'Over temperature', fault_code: 7 });
el._sig = null; el.hass = { ...H, states: { ...states } };
assert.ok(el.shadowRoot.innerHTML.includes('Over temperature'), 'fault description shown');

// The room that holds the inverter and battery also gets Battery and Solar & Inverter tiles.
Object.assign(states, {
  'sensor.inv_soc': st(91, { unit_of_measurement: '%', device_class: 'battery' }),
  'sensor.inv_pv_power': st(2100, { device_class: 'power', unit_of_measurement: 'W' }),
  'sensor.inv_load_power': st(900, { device_class: 'power', unit_of_measurement: 'W' }),
  'sensor.inv_battery_power': st(-1200, { device_class: 'power', unit_of_measurement: 'W' }),
});
['sensor.inv_soc', 'sensor.inv_pv_power', 'sensor.inv_load_power', 'sensor.inv_battery_power'].forEach((e) => { entities[e] = { entity_id: e, device_id: 'dev_inv', name: null }; });
const H2 = { ...H, states: { ...states } };
assert.ok(window.sunyaadSystemHere(H2, [{ area: 'garage' }]), 'garage holds the energy system');
const sys = window.sunyaadPagePlan(H2, { rooms: [{ name: 'Garage', area: 'garage' }], tiles: ['appliances', 'energy'] }).map((t) => t.key);
assert.deepEqual(sys, ['appliances', 'ev', 'battery', 'system', 'energy']);
assert.ok(!window.sunyaadSystemHere(H2, [{ area: 'kitchen' }]), 'not in another room');

console.log('sunyaad_ev_charger: ok');
