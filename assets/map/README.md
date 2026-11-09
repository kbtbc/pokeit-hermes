# Map viewer

The Desktop pane shows a real map through the SDK's `SandboxedFrame`. The page is built
by `dashboard/plugin_api.py` (`/map`) from the four files here and nothing else.

- `leaflet.js`, `leaflet.css`: unchanged **Leaflet 1.9.4** distribution files (the same
  copies pokeit.cc serves). BSD-2-Clause, see `Leaflet-LICENSE.txt`.
  sha256 `db49d009c841f5ca34a888c96511ae936fd9f5533e90d8b2c4d57596f4e5641a` (js),
  `a7837102824184820dfa198d1ebcd109ff6d0ff9a2672a074b9a1b4d147d04c6` (css).
- `guest.js`, `guest.css`: the PokeIt layer. Search point, radius rings, returned catches
  as large icons, other observations as dots, a walking line to the selected catch.

What the page can do:

- It runs in an opaque-origin frame with scripts only. It cannot reach Hermes, its
  storage, the chat or the plugin's backend.
- It draws the state the pane hands it. It never reads PokeIt data and cannot start a
  search or a scan.
- Its CSP allows two image sources and nothing else: map tiles from
  `https://tile.openstreetmap.org` and species icons from `https://pokeit.cc`. Looking at
  the map therefore tells those two hosts the viewed area (tiles), the species shown
  (icons) and your IP address.
- It sends the pane two messages: `ready`, and `select` with a catch id when you tap one.
  The pane accepts only an id that is already in its own list.

No CDN scripts, fonts, marker images or runtime downloads. Leaflet's stock marker and
layer images are not shipped and its CSS references to them are blocked by the CSP.
