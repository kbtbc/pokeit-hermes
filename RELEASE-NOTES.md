# PokeIt release notes

## 0.1.21 · November 10, 2026 (ET)

- Fix: with Hermes's right-hand panel open, a second, narrow copy of the Radar appeared beside the first. The Radar is now one workspace tab only.
- Fix: the agent sent a time zone to tools that reject it, so raid and scan answers showed "1 tool call failed" before retrying. It now sends it only to the two tools that take one.
- README: a headline ("Real-time Pokémon GO hunting. Near you. Inside Hermes Desktop.") and a closing line naming pokeit.cc as the MCP service behind the plugin.
- When an older PokeIt is still loaded in Hermes's background processes, the Radar now says so and says what fixes it (restart the computer), instead of telling you to reinstall. README: what to do when updating from an older PokeIt.

## 0.1.20 · November 10, 2026 (ET)

- The Radar now follows raid, gym, showcase, Max Battle and PokéStop questions as well as catches; **Raids nearby** asks for raids and eggs right now, and the line under the map counts the raids on the gyms shown.
- A raid question turns the Radar to raids: bosses and eggs lead on the map and in a list with the gym, distance, open slots and time left, and catches step back to small faded icons. A catch question turns it back.
- Fix: after a plugin update the Radar's map could stay on the old version until the gateway restarted, because the map page was built once per process. It is rebuilt when its files change.
- Catch icons on the map are a little smaller again, and the long tail of a watch list is drawn small. The no-ongoing-scans warning links to the coverage map.
- "Hunt Watch" is now **Watch it**: the status bar says "PokeIt · Watching" while it runs. README rewritten around "near me", the Radar and desktop alerts.
- The sample questions use the Georgia Aquarium in Atlanta and the Gateway Arch in St. Louis. The empty Radar's examples say which ones answer at once ("live now") and which need a scan ("fresh scan").
- README: restart Hermes after an install or update. A Desktop that was not restarted can open chats without the PokeIt tools, and the Radar cannot follow those. The skill now tells the agent to say so instead of reaching the service another way.
- Fix: after a scan the agent reads 371 m but the Radar read 500 m, so the two listed different catches. The Radar now reads the ring the agent read and offers it in the Ring menu.
- Fix: "A scan is in progress here" stayed on the Radar after the scan had finished. It now clears by itself.
- Hunt Watch sits under the map in its own panel, says what it is watching for, and no longer prints a bare map link. The desktop alert drops the link too: clicking it opens the catch in the Radar.
- Radar buttons write a short question. A named place no longer carries a map link, **Best catches** no longer asks for catch cards (ask for "PokeIt cards" to get them), and **Events today** asks about today's events for the spawns at the spot. The Radar has one **Open live map** button; the chat card's second button is **Open Radar**.
- Map icons are a little smaller and the map leaves room for icons that sit on the ring. Timers in the list say "left". The footer is one quiet line.
- The skill keeps the city the player gave for every later lookup and sends it as the plain city name, so "I'm in downtown Atlanta" followed by a landmark no longer gets "Did you mean" or no match. A landmark with one exact match is used without a confirming question. "Near me" gets "Let's check it! Is there a nearby landmark, address or intersection?". When a name cannot be placed the agent no longer suggests a street.
- A scan is read once 45 of its 49 points are in, in the chat and in the Radar, instead of waiting on the last few. The skill always asks for the place's own time zone, so times are never UTC.
- README: the Hermes version PokeIt needs.
- The Radar's first screen leads with "What's worth catching near you?" and one large button that asks it. The watch panel has its own header, "Watch it · Real-Time Desktop Notifications!". Alerts and the watch line say how long is left instead of clock times. Where no ongoing scans cover the spot the watch says so and asks you to reach out to PokeIt. The scan card says it may take a minute or two.
- Chat answers link to pokeit.cc only, plus a named link to an official event article when an event is mentioned.
- The Radar's scan card shows a sweep and "Scanning…" instead of a point count that could look stuck. A link to the live map sits under the Radar's map at all times. With Hunt Watch on, the best six matches are large on the map and the rest small.
- Fix: when the chat went back to an earlier place, the Radar, its card and a Hunt Watch alert showed the name of the last place instead.
- The skill keeps the service's order for the catch list, so the chat and the Radar agree more often. It no longer says a catch has despawned just because it dropped out of the list, and does not run code to convert times.

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
