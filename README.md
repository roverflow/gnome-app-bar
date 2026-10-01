# App Bar

A taskbar for the GNOME top panel. Pinned and running apps show as icons in the
panel.

Supports GNOME Shell 48, 49 and 50. Tested on 50 under Wayland.

## Usage

| Input | Result |
| --- | --- |
| Left click | Raises the app. Clicking again steps through its windows, or minimizes a single window |
| Middle click | Opens a new window |
| Right click | Window list, app actions such as New Private Window, Pin, Hide from App Bar, Minimize, Close |
| Scroll | Steps through the app's windows |
| Hover | Live window previews. Click one to focus it, middle-click to close it |
| Drag | Reorders pinned apps. Dropping a running app among them pins it |
| Super+1 to Super+9 | Activates the icon in that slot. Off by default |

The line under an icon shows its state. Grey means running, wider means more
than one window, accent color means focused, and yellow means a window wants
attention. A launching app shows up at once with a pulsing icon.

Pinned apps follow GNOME's favorites order, so reordering here also reorders
the dash. Running apps follow launch order.

Hide from App Bar removes an app from the panel even while it runs. Unhide it
from the preferences.

## Settings

Open with `gnome-extensions prefs gnome-app-bar@roverflow`. Changes apply
immediately.

| Setting | Default |
| --- | --- |
| Icon size | 20px (12 to 32) |
| Space between icons | 8px (0 to 24) |
| Vertical nudge | 0px (-10 to 10) |
| Indicator style | Bar, Dot or None |
| Indicator thickness | 3px (1 to 6) |
| Indicator distance from bottom | 3px (0 to 12) |
| Window count badge | Off |
| Show pinned apps | On |
| Current workspace only | On |
| Window grouping | One icon per app, or one per window |
| Place in the panel | Left, after the workspace pill |
| Show window previews | On |
| Preview width | 180px (120 to 320) |
| Super+number activates icons | Off |

With Super+number on, the bar handles the shell's own "Switch to application"
shortcuts and gives them back when turned off or disabled. Shortcuts rebound in
Settings still apply.

## Install

```sh
make install     # copy into ~/.local/share/gnome-shell/extensions
make link        # or symlink the working tree, for development
```

Log out and back in, then:

```sh
gnome-extensions enable gnome-app-bar@roverflow
```

`make pack` builds the zip for extensions.gnome.org.

## Development

```sh
make test-shell  # headless shell with isolated settings and a debug trace
make logs        # follow the live session's shell log
```

Set `APPBAR_DEBUG=1` before starting a shell to log every rebuild.

| File | Role |
| --- | --- |
| `extension.js` | Entry point. Places the bar and enables shortcuts |
| `appBar.js` | Which icons exist, hover popups, drag and drop |
| `appButton.js` | One icon. Drawing, clicks, window cycling |
| `appMenu.js` | Right-click menu |
| `appearance.js` | Turns settings into sizes and styles |
| `hiddenApps.js` | The hidden apps list |
| `hotkeys.js` | Super+1 to Super+9 |
| `previews.js` | Window preview popup |
| `prefs.js`, `preferences/` | Preferences window |

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
