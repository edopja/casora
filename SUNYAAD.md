# Sunyaad on Casora

Sunyaad is a fork of [Casora](https://github.com/SH1FT-W/casora) (MIT). This branch is built on
Casora **26.10.60b2**. Sunyaad's code lives in its own files; Casora's files only carry small,
marked hooks (search for `Sunyaad`), so a new Casora version can be taken over by re-applying them.

## Sunyaad's own files

| File | What it does |
| --- | --- |
| `scripts/sunyaad/sunyaad.js` | Pop-ups (battery, energy, gate, lights, climate, appliances, EV charger, room energy), the banner, the tile plan for every page (`window.sunyaadPagePlan`) |
| `scripts/sunyaad/rows.js` | The tile row (`casora-smart-row`): one tile per group, drawn by Casora's own row |
| `scripts/sunyaad/greeting.js` | Smart greeting; wraps `window.casoraGreeting` / `window.casoraFitTitle` |
| `panel/sunyaad-studio.js` | Studio: "Tiles & areas", smart-greeting and battery fields, preview |

## Hooks in Casora's files

| File | Hook |
| --- | --- |
| `scripts/smart-row.js` | Casora's row is defined as `casora-smart-row-classic`; imports `sunyaad/rows.js`, falls back to Casora's row under the old name if that fails |
| `scripts/casora-local.js` | `'../sunyaad/sunyaad'` at the end of `MODULES` |
| `scripts/filter-overlay.js` | Room photo: the day photo under the night photo (no night photo → day photo) |
| `scripts_view.py` | `sunyaad-studio.js` in `STUDIO_MODULES`, before `casora-panel.js` |
| `__init__.py` | `scripts/sunyaad/` counts for the loader's `?v=` stamp |
| `panel/casora-panel.js` | `sunyaadStudio.sections(SECTIONS)`, `sunyaadStudio.phoneVars(...)`, field type `sunyaad`, `_sunyaadPreview(...)`, brand name |
| `panel/casora-panel-i18n.js` | Shown text says Sunyaad instead of Casora |
| `panel/casora-panel-settings.js`, `options.py` | Electricity price in any currency (up to 100 000 per kWh) |
| `const.py`, `update.py` | Updates come from `edopja/casora`; the HACS repository id is looked up |
| `manifest.json`, `hacs.json`, `translations/` | Name: Sunyaad |

## Where a page's settings live

On the page's tile row (`custom:casora-smart-row`):

- `sunyaad_rooms`: the areas the page brings together (Bedrooms). Empty: a normal room.
- `sunyaad_tiles`: which tiles, in order (`lights`, `media`, `climate`, `appliances`, `ev`, `battery`, `system`, `energy`, `presence`, `more`).
  `ev` (an EV charger in the room), `battery` and `system` (the room holding the inverter and battery) come by
  themselves when the page has what they show, even on pages saved before them.

The Studio carries the row through every save unchanged, so Done cannot drop these. Earlier
versions kept a copy in the header's variables (`sunyaad_areas`, `sunyaad_tiles`); it is still
read, and cleared on the next edit in "Tiles & areas".
