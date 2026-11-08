<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/pokeit-lockup.svg">
    <img alt="PokeIt" src="assets/pokeit-lockup-light.svg" width="320">
  </picture>
</p>

<p align="center">
  <b>Live Pokémon GO data for your Hermes agent.</b><br>
  Hundos, raids, showcases and events near any spot, from a real scanning network.<br>
  No account, no API key.
</p>

## Try it

```sh
hermes plugins install kbtbc/pokeit-hermes
```

Then ask:

> Any hundos or rank-one PvP catches near Alpharetta City Hall?
>
> What raids and showcases are on near Alpharetta City Hall?
>
> What's worth catching near Alpharetta City Hall?

Give a specific spot: an address, an intersection or a landmark. Your agent doesn't know your GPS, so if you only name a city it will ask for something smaller. Answers link to the [live map](https://pokeit.cc/map). You can also try the search without Hermes at [pokeit.cc](https://pokeit.cc).

## How it works

Hermes calls the hosted PokeIt MCP server, which answers from observations on the public map. There is no language model inside the server.

Outside the mapped areas, your agent can ask PokeIt to scan: 49 points covering a 371 m radius. Hermes asks you to approve before it starts, and a scan can take a few minutes. Reading data never starts a scan. Without signing in you get 20 full scans per network per rolling 24 hours, one minute apart.

## Tools

| Tool | What it does |
|---|---|
| `find_pokemon` | Hundos, nundos and PvP rank 1 by default, or any species, IV or league filter |
| `find_raids` `find_gyms` `find_showcases` `find_max_battles` `find_pokestops` | What is active near a point: raids and eggs, gym slots, showcases, Max Battles, lures and Rocket stops |
| `get_game_context` `get_event_details` | Official event articles that matter for what is nearby |
| `get_coverage` `request_scan` `get_scan_status` | Check coverage, start an approved scan, follow its progress |
| `search_places` `describe_location` `list_areas` | Place name to coordinates and back (US only; elsewhere give coordinates), and the listed map areas |
| `get_map_preview` | A map screenshot with a live link |

## What leaves your machine

- Each tool call sends coordinates, place text and filters to `https://mcp.pokeit.cc`, which PokeIt runs. Nothing else is sent: no files, no credentials, no conversation text. This package has no code of its own.
- The service keeps tool names, filters, timings and result counts for about 14 days. A scan request keeps its coordinates and request ID for 24 hours, plus a keyed hash of your network address (not the address) to apply the trial limit. Ordinary web logs hold IP, path, time and status.
- This preview build sends the header `X-PokeIt-Search-Diagnostics: 1`, so the service also logs the place text you submit for about 14 days, to debug searches. Coordinates, full tool payloads and conversations are not part of that log. To opt out, remove the header in your own MCP config, or send `Sec-GPC: 1`.
- Place search uses OpenStreetMap data, © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL). Species names in other languages can come from WatWowMap's public translation files on GitHub; no user data goes with that request.
- Map previews are drawn by the service in a signed-out browser and cached for 60 seconds.
- The server runs separately from this repository and can change after you install. Results are not exhaustive and observations can expire before you arrive.

## If the tools disappear

Run `/reload-mcp` in the chat, or start a new one. If Hermes still can't find the server, add it yourself and keep approvals on:

```sh
hermes --profile YOUR_PROFILE mcp add pokeit --url https://mcp.pokeit.cc/mcp
hermes --profile YOUR_PROFILE config set mcp_servers.pokeit.trust untrusted
hermes --profile YOUR_PROFILE mcp test pokeit
```

## Other clients

Any MCP client can connect to `https://mcp.pokeit.cc/mcp` over Streamable HTTP. The skill in this repository is Hermes guidance.

## Package

`plugin.json`, `mcp.json` and one skill, with no `plugin.yaml`: with one present, Hermes skips the portable MCP tools.

---

Questions and feedback: [Discord](https://discord.gg/3NSTeCxBXk). MIT licensed.

PokeIt is not affiliated with or endorsed by Nintendo, Niantic, Scopely, The Pokémon Company, Creatures or GAMEFREAK. Pokémon and Pokémon GO are trademarks of their owners.
