# PokeIt release notes

## 0.1.16 · November 8, 2026 · 8:34 AM ET (EST, UTC-05:00)

- Readable named map links in ordinary chat; no automatic Desktop card markup on unconfirmed frontends.
- Cards remain available in the supported PokeIt Desktop view, separated into individual paragraphs and accompanied by usable links.
- Preserve exact Pokémon names, show only rank #1 in general catch answers, and proceed with already-resolved nearby search areas.
- Radar and card design are unchanged. Start a fresh chat after updating to load the revised guidance.

## 0.1.15 · November 8, 2026 · 7:10 AM ET (EST, UTC-05:00)

- Worldwide place lookup through self-hosted Photon, with limited US fallback. Confirm a new place and city before scanning; follow-ups reuse the confirmed spot.
- Clearer guidance for estimated despawn times. An estimated expiry is not a learned spawnpoint timer or a guarantee.
- Preserves the v0.1.14 Desktop card and radar design.

## 0.1.14 · November 7, 2026 · 10:45 PM ET (EST, UTC-05:00)

- The chat cards are now a trainer briefing. The top pick is a hero card with large art and a glow, sparkles on a hundo, a compass to the catch, segmented IV bars, a countdown and a walking guide ("Worth the walk", "Tight" or "Probably too far"). The guide is a straight line at 5 km/h from the place you searched, not from you.
- Other recommended catches are compact rows with the same guide, plus Map and Radar buttons. The skill asks agents to mark them `variant="compact"`.
- Scan cards are a progress ring that fills as points are confirmed, with a check when the scan completes.
- A catch that expires while its card is on screen folds into a quiet row.

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
