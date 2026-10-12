# App Bar

A taskbar for GNOME. Pinned and running apps show as icons, either inside the
top panel or in a separate panel along the bottom of the screen.

Supports GNOME Shell 48, 49 and 50. Tested on 50 under Wayland.

## Layouts

**Top panel.** The icons sit inside GNOME's top panel, at the far left, after
the workspace pill, in the centre, or before the status area.

**Bottom panel.** A full-width panel along the bottom of the primary monitor,
with the icons centred, much like the Windows 11 taskbar. The top panel stays
as it is. The bottom panel reserves its space, so maximized windows and the
overview stop above it, and it hides when a window goes fullscreen.

Switch between them on the Appearance page of the preferences. The change
applies at once.

## Usage

| Input | Result |
| --- | --- |
| Left click | Raises the app. Clicking again steps through its windows, or minimizes a single window |
| Middle click | Opens a new window |
| Right click | Window list, app actions such as New Private Window, Pin, Hide from App Bar, Minimize, Close |
| Scroll | Steps through the app's windows |
| Hover | Live window previews. Click one to focus it. Its close button or a middle-click closes it |
| Drag | Reorders pinned apps. Dropping a running app among them pins it |
| Super+1 to Super+9 | Activates the icon in that slot. Off by default |
| Ctrl+Alt+Tab | Moves keyboard focus to the panel. Arrow keys move between icons, Home and End jump to the ends, Enter activates, Menu or Shift+F10 opens the menu, Escape leaves |

The line under an icon shows its state. A short grey line means running. It
stretches and turns to the accent color when the app has focus, and grows a
little more when the app has more than one window. Yellow means a window wants
attention, and the icon hops three times when that starts. A launching app
shows up at once with a slow pulse.

Icons grow in and shrink out as apps open and close, so the others slide over
instead of jumping. Timings follow GNOME Shell's own, and every animation
turns off with Accessibility > Animations. Screen readers hear each icon's
state, for example "Firefox, 3 windows, focused".

Pinned apps follow GNOME's favorites order, so reordering here also reorders
the dash. Running apps follow launch order.

Hide from App Bar removes an app from the panel even while it runs. Unhide it
from the preferences.

## Settings

Open with `gnome-extensions prefs gnome-app-bar@roverflow`. Changes apply
immediately.

| Setting | Default |
| --- | --- |
| Layout | Top Panel, or Bottom Panel |
| Position in Top Panel | Left, after the workspace pill |
| Bottom Panel Height | 48px (32 to 72) |
| Icon Size | 20px (12 to 48) |
| Space Between Icons | 8px (0 to 24) |
| Running Indicator Style | Bar, Dot or None |
| Window Count | Off |
| Vertical Nudge | 0px (-10 to 10), under Fine-Tuning |
| Indicator Thickness | 3px (1 to 6), under Fine-Tuning |
| Indicator Distance From Bottom | 3px (0 to 12), under Fine-Tuning |
| Show Pinned Apps | On |
| Current Workspace Only | On |
| Icons | Per App, or Per Window |
| Window Previews | On |
| Preview Width | 180px (120 to 320) |
| Activate Icons With Super+Number | Off |

Reset All Settings restores the defaults, and the toast that follows has an
Undo button.

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
| `extension.js` | Entry point. Creates the model and the chosen layout, enables shortcuts |
| `taskbarModel.js` | Which icons exist, in what order, and which windows each stands for. No actors |
| `layouts/topPanel.js` | Puts the bar in GNOME's top panel |
| `layouts/bottomPanel.js` | The full-width bottom panel |
| `appBar.js` | The row of icons. Keeps buttons in step with the model |
| `appButton.js` | One icon. Drawing, clicks, window cycling |
| `appMenu.js` | Right-click menu |
| `hoverPopups.js` | When to show the tooltip or window preview |
| `previews.js` | Window preview popup, and popup placement |
| `dragReorder.js` | Drag an icon to reorder or pin favorites |
| `appearance.js` | Turns settings into sizes and styles |
| `motion.js` | Animation durations, matched to GNOME Shell's |
| `hiddenApps.js` | The hidden apps list |
| `hotkeys.js` | Super+1 to Super+9 |
| `prefs.js`, `preferences/` | Preferences window. `layoutPreview.js` draws the layout pictures |

A layout owns where the bar lives on screen. It creates an `AppBar` and tells
it which edge it sits on, so popups and menus open away from that edge. To add
another layout, write a class with the same shape as the two in `layouts/`
and register it in `LAYOUTS` in `extension.js`.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
