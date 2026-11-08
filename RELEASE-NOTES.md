# PokeIt release notes

## 0.1.13 · November 7, 2026 · 9:50 PM ET (EST, UTC-05:00)

- Desktop redesign. Catch cards and the radar show the species art from the PokeIt map's icon set, the IVs as bars, a Hundo, Nundo or PvP #1 badge, and the direction and distance from the place you searched ("447 m SE of Alpharetta City Hall").
- The Radar lists every catch beside the radar. Selecting a row or a node highlights the other, and the radar opens with example spots and a Resume button for your last spot.
- Scan cards fill in as points are confirmed and show when the scan was requested. Expired catches and catches missing from a read are now quiet.
- Hunt Watch is a single compact row. Alerts name the catch.
- The gateway proxy gains a read-only icon route that fetches icons from the PokeIt map's own assets. The skill asks agents to name the searched place on each card.
- The Radar remembers your last spot locally. It is read only when you choose Resume.

## 0.1.12 · November 7, 2026 · 9:17 PM ET (EST, UTC-05:00)

- Hunt Watch checks a selected Radar spot for hundos, nundos, PvP rank #1 or a minimum IV. Start and stop it yourself; it reads existing observations without starting scans.
- New matches appear in the app, with OS notifications when Hermes is in the background and notifications are allowed. Repeat alerts are limited.
- Watch filters are remembered locally; watched locations stay in memory. Switching profile or connection stops the watch.

## 0.1.11 · November 7, 2026 (ET)

- Hermes Desktop radar with live catches, compass directions and map links.
- Catch cards with expiry countdowns and scan cards with reported progress.
- Read-only gateway proxy; scans retain the agent's approval flow.
- Event context accompanies nearby results, backed by the service's regular official-news refresh.
- Portable CLI and messaging use stays available; Desktop cards only appear on Desktop.
- Verified on Windows Desktop with a remote Mac gateway, including one real 49-point scan. Follow-up buttons keep the selected location and only draft a question.

Beta diagnostics remain enabled in the MCP configuration. They must be opt-in in the final contest submission.
