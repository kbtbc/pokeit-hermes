# PokeIt release notes

## 0.1.19 · November 9, 2026 (ET)

- Fix: the Radar did not follow a search in some chats. The hook that follows the agent's search compared the event's session id with only one of the two ids a chat can have, so it ignored every search in chats where they differ. It now accepts either. The pane also follows the chat in front instead of staying tied to the chat it was first opened from, and a Hunt Watch toast opens the catch in the chat you are in.
- While the agent's scan runs, the Radar opens at the spot and shows one dot per scan point filling as points are confirmed, then reads the spot when the scan is covered. It reads the coverage plan only (it never starts or renews a scan). If a scan stalls, "Show what is here now" reads what exists. If you decline the scan, it stops after 45 seconds and shows the existing data.
- A PokeIt backend older than the Radar now says so in plain words instead of "Unexpected query parameter". Copy debug info includes counters for what the follow hook saw (no ids, places or text).
- The skill waits on a scan with `wait_seconds: 10`, never sleeps in the terminal, and after about two minutes stops polling, says how many of the 49 points are confirmed and offers to check again, so a slow scan no longer uses up the agent's tool-call budget.
- TESTING.md: the Hermes version needed, removing duplicate PokeIt installs, and what to send when the Radar does not follow.

## 0.1.18 · November 9, 2026 (ET)

- The Radar follows your chat: it opens beside the answer after a catch search, reads the same spot, and lists the best three or four catches (hundos, nundos and PvP #1 first, then the highest IV) with the gyms and Pokéstops around. The search box is gone; ask in chat. Close it and it stays closed until you open it from the status bar. A note under the list says why these catches were picked, and a read older than five minutes refreshes when you return to the pane.
- The chat answer is a short list with distance, compass direction, expiry and a map link per catch, and the chat map picture shows the same catches large and bright with the rest faded. The Radar's featured card is more compact and the PvP #1 label stays above the selection ring.
- The empty Radar shows a faded piece of PokeIt's own map behind the radar rings (dark theme), with the map credit in the corner.
- Radar buttons put a ready question in the chat bar and replace the question the last button wrote instead of stacking them; text you typed stays.
- Hunt Watch ends by itself after 2 hours and says so. It checks whether ongoing scans cover the spot and says so when none do. The toast is titled `PokeIt! Nearby <species> (<IV>%)` and gives where and when it was found, when it expires, and a map link.
- When only a city or large park is named, the agent opens with a varied short line ("Let's zoom in!", "<place> is a bit too wide for a single scan.", "Help me narrow that down!") and asks for an address, intersection or landmark with three examples from that place. When the player's answer picks the place the agent offered, it no longer asks again. Before a scan it says Hermes will ask for approval.
- The service now understands more ways people name places (Saint/St, centre/center, "the", "in front of", a bare "hotel" inside a site) and finds a lone hotel, library or cinema inside a named site without a second question. Scan planning treats spots near the border between two neighbouring scan areas as covered. These are service changes; nothing to reinstall for them.
- Beta diagnostics remain enabled in the MCP configuration. They must be opt-in in the final contest submission.

## 0.1.17 · November 8, 2026 (ET)

- Desktop: a catch card whose data cannot be fetched keeps the place, the distance, a map button and a retry instead of a red box. The unreachable message says how to fix it (enable PokeIt for the profile you are chatting in).
- The Radar has a **Best catches** button that asks for PokeIt cards. Cards appear when you ask for "PokeIt cards" or start from the Radar. With a card on screen the agent says which catch to go for instead of repeating the card's figures, and puts the scan progress card up as soon as a scan starts.
- The skill follows the service's ready-made Markdown map links and its nearest-area list for "my area is dead" questions when the service provides them, and no longer asks the player to confirm a clear place match.
- README: a real card screenshot and the correct update command. Start a fresh chat after updating.

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
