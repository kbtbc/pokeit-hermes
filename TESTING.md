# Testing PokeIt 0.1.23

About 20 minutes. You need Hermes Desktop 0.23.0 or newer (the status bar shows `client v0.23.0`; if it says v0.22.x, update Hermes first) and a model that can call tools. Data is US-only for now; the Atlanta and Alpharetta/Roswell areas are the best covered, and [pokeit.cc/coverage](https://pokeit.cc/coverage) shows all of them.

## 1. Install the new build

If you already have an older PokeIt, remove it first. Run these in the default profile (no `-p`), because Desktop copies the Radar from that install.

```sh
hermes plugins remove pokeit
hermes plugins install kbtbc/pokeit-hermes --enable --yes-deps
```

Open **Capabilities → Plugins** and make sure there is exactly one PokeIt entry. Older or Desktop-made installs can appear under other names (for example `agent-plugin-pokeit-…`); remove those. Two copies fight each other, and an old backend makes the Radar say that Hermes is still running an older PokeIt. Hermes keeps background processes alive after you quit the app, so after removing an old copy restart your computer before installing again. If you use another profile, enable PokeIt there too.

Quit Hermes Desktop completely and start it again, then open a new chat.

You have the new build when the **PokeIt Radar** pane says "Follows your chat" and has no search box.

## 2. Try these

| # | Ask or do | You should see |
|---|---|---|
| 1 | "anything good spawning in Atlanta" | A short opener, then a question for a landmark, address or intersection with three examples from Atlanta. No scan, no tool calls. |
| 2 | "What's worth catching near the Georgia Aquarium in Atlanta?" | A list of 3 or 4 catches with IV, distance, compass direction, expiry and a map link; a small map picture; the Radar opening beside the chat by itself. |
| 3 | In the Radar: click a catch, press **Refresh**, change **Ring** | The map and card follow the selection. **Open live map** opens pokeit.cc. |
| 4 | Press **Best catches**, then **Raids nearby** | The chat bar holds only the last question, not both. |
| 5 | "anything good spawning in Avalon", then answer "Hotel side" | The agent goes on with the hotel. It must not ask "did you mean the hotel?" after you already chose it. |
| 6 | Name a landmark outside the listed areas, in your own city if it is in the US | The agent says a fresh scan is needed and that Hermes will ask you to approve it. The prompt calls the server "untrusted" and the tool "write-capable"; that is expected. **Run** starts a 49-point scan (a few minutes). The Radar opens at the spot with a small grid of 49 dots that fill as points are confirmed, then shows the catches when it finishes. If it stalls, "Show what is here now" reads what exists. **Reject** is also a valid test: the agent should stop and say so. |
| 7 | Radar on the Georgia Aquarium (or anywhere in the Atlanta area), the **Watch it** panel's filter "IV at least" 80, press **Watch**, then minimize Hermes | Within a couple of minutes an OS toast titled `PokeIt! Nearby <species> (<IV>%)`, with where it was found and how long is left. Clicking it opens the catch in the Radar. Does it make a sound? Note whether it does. |
| 8 | Start a new chat before searching | The empty Radar shows a faded map behind the rings. |

The watch ends by itself after 2 hours, or press **Stop**. It never starts scans. Outside an area with ongoing scans the Radar warns that the watch needs ongoing scans there.

## 3. What to report

- The question you typed, the model, your OS, and the time with timezone.
- A screenshot of the chat and the Radar.
- The Radar's **Copy debug info** output. It holds plugin and backend versions and counters for what the chat-following hook saw, no location or chat text. If the Radar did not follow a search, this is the most useful thing to send.
- Anything that felt slow, confusing or wrong, even if it worked.

Send it on [Discord](https://discord.gg/3NSTeCxBXk).

## Notes

- Scans are limited to 20 per network per rolling 24 hours, one minute apart. Reading data is not limited.
- This beta build sends `X-PokeIt-Search-Diagnostics: 1`, so the service logs the place text you type for about 14 days. To opt out, remove that header from `mcp.json` in the plugin folder or send `Sec-GPC: 1`.
- Remove it with `hermes plugins remove pokeit`.
