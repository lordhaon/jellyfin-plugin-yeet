# YEET – Your Entertainment, Elsewhere, Televised

A Jellyfin plugin that adds **⋮ → Yeet to device** to the item menu. Pick a device and the movie, show, episode or album starts playing there. If the device is off, it is turned on first: a Roku directly over the network, anything else through Home Assistant.

- Works on movies, episodes, series (continues from Next Up), seasons, albums, playlists and collections
- Offers **Resume from …** when you have a saved position
- Lets you pick the **version, audio track and subtitles** for a single movie, episode or song, starting from what is selected on the item's page
- Devices that already have Jellyfin open are listed automatically, with no setup
- Available to every signed-in user. The Home Assistant token stays on the server and is only visible to administrators.
- Works in the web browser and the official Jellyfin apps that use the web UI (Android, iOS, Jellyfin Media Player). Native apps such as the Roku and Android TV apps can be played *to*, but don't show the menu option themselves.

## Requirements

- Jellyfin **12.x**
- For a Roku: **Settings → System → Advanced system settings → Control by mobile apps** set to *Default* or *Permissive*, and Jellyfin able to reach the Roku on port 8060.
- Home Assistant, only for non-Roku devices that need turning on. Jellyfin must be able to reach it over the network.
- The target device's Jellyfin app must support remote control (it shows up under the cast icon in Jellyfin when open).

## Install

1. In Jellyfin, go to **Dashboard → Plugins → Repositories** and add:
   `https://raw.githubusercontent.com/lordhaon/jellyfin-plugin-yeet/main/manifest.json`
2. From **Catalog**, install **YEET - Your Entertainment, Elsewhere, Televised**.
3. Restart Jellyfin, then hard-refresh the browser (Ctrl+F5) so the updated page loads.

To install without a repository, copy `Jellyfin.Plugin.Yeet.dll` into `<jellyfin data>/plugins/Yeet/` and restart Jellyfin.

## Setup (Dashboard → Plugins → YEET)

1. Only if you have non-Roku devices: enter the **Home Assistant URL** and a **long-lived access token** (Home Assistant: your profile → Security → Long-lived access tokens).
2. **Add device** for each TV or box that should be turned on for you:

| Field | What to enter |
|---|---|
| Name | What the picker shows, e.g. `Living Room TV` |
| Jellyfin device name | Part of the name the device has under Dashboard → Devices. This is how the plugin spots the device once its app is open. |
| Roku address | The Roku's IP address. When set, the Home Assistant fields are ignored for this device. Give the Roku a fixed IP in your router. |
| Home Assistant entity (Android TV / Google TV) | The `remote.…` entity from Home Assistant's **Android TV Remote** integration. It turns the TV on and opens Jellyfin (`org.jellyfin.androidtv`). |
| Home Assistant entity | A `media_player` (turned on, then switched to the app below), or a `script`, `scene` or `button` that does the waking itself |
| App to open | For a `media_player`: the source name Home Assistant lists for the Jellyfin app, or an Android package name. Leave as `Jellyfin` for Android TV. |

3. **Save**, then **Test** to check the device turns on and opens Jellyfin.

### Android TV / Google TV

1. In Home Assistant: **Settings → Devices & services → Add integration → Android TV Remote**, enter the TV's IP address, and type the pairing code it shows on screen.
2. In YEET, add the device with the `remote.…` entity it created, and leave **App to open** as `Jellyfin`.
3. On the TV, open Jellyfin once and sign in, so it signs in by itself next time.

YEET turns the TV on, opens Jellyfin, waits for it to connect, then starts playback with Jellyfin's remote control. Choose a device that is already on to skip the wait.

For anything more involved than "turn on and open the app" (switching a receiver's input, for example), make a Home Assistant script and enter that as the entity.

## How it works

1. The menu option opens a picker listing configured devices and any other open Jellyfin app you're allowed to control.
2. If the device already has Jellyfin open, playback is started with Jellyfin's own remote control API (`POST /Sessions/{id}/Playing`), so Jellyfin's usual permissions apply.
3. If it's a Roku that is off, the server sends a power-on and a deep link to the Jellyfin channel (`POST http://<roku>:8060/launch/592369?contentId=…`), which starts the item in one step.
4. For other devices, the plugin calls Home Assistant, waits up to 90 seconds for the Jellyfin session to appear, then starts playback as in step 2.

## Limitations

- Version, audio and subtitle choices are only sent to a device that already has Jellyfin open. A Roku that is off uses its own defaults, and whether a choice is honoured is up to the app on the device.
- A Roku that is off plays the first item only (one episode or track), because a deep link carries a single item. It plays as whichever user is signed in on the Roku.
- The device's Jellyfin app must sign in by itself when opened. If it stops at a user picker, playback can't start.
- The menu option depends on Jellyfin's web UI markup. A major Jellyfin web update may need a small script fix.
- Any signed-in user can wake a configured device.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/Yeet/Devices` | The configured devices (no Home Assistant details) |
| POST | `/Yeet/Devices/{id}/Wake` | Turn the device on and open Jellyfin |
| POST | `/Yeet/Devices/{id}/Launch?itemId=…` | Roku only: turn it on and start the item |

## License

GPL-3.0
