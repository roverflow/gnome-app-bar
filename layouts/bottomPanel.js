// SPDX-License-Identifier: GPL-3.0-or-later

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as CtrlAltTab from 'resource:///org/gnome/shell/ui/ctrlAltTab.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {AppBar} from '../appBar.js';
import {PANEL_TIME} from '../motion.js';

// A full-width panel along the bottom of the primary monitor, with the
// icons centred, like the Windows taskbar. GNOME's top panel stays.
export class BottomPanelLayout {
    constructor(settings, model) {
        this._settings = settings;

        // The struts follow this actor's position, so it stays still and
        // the visible panel slides inside it. Reactive, so clicks on empty
        // space don't fall through.
        this._panel = new St.Widget({
            name: 'appbarBottomPanel',
            layout_manager: new Clutter.BinLayout(),
            reactive: true,
            clip_to_allocation: true,
            accessible_name: _('App Bar'),
        });

        this._background = new St.Widget({
            style_class: 'appbar-bottom-panel',
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
        });
        this._panel.add_child(this._background);

        this._menuManager = new PopupMenu.PopupMenuManager(this._panel);

        this.bar = new AppBar(settings, model, {
            side: St.Side.BOTTOM,
            menuManager: this._menuManager,
            align: Clutter.ActorAlign.CENTER,
        });
        this._background.add_child(this.bar);

        // Struts shrink the work area, so maximized windows and the overview
        // stop above the panel. It hides under fullscreen windows.
        Main.layoutManager.addChrome(this._panel, {
            affectsStruts: true,
            trackFullscreen: true,
        });

        // Ctrl+Alt+Tab can move keyboard focus to the icons, as it can to
        // the top bar.
        Main.ctrlAltTabManager.addGroup(this._panel, _('App Bar'),
            'view-app-grid-symbolic', {sortGroup: CtrlAltTab.SortGroup.BOTTOM});

        this._themeContext = St.ThemeContext.get_for_stage(global.stage);

        const place = () => this._place();
        Main.layoutManager.connectObject('monitors-changed', place, this);
        this._themeContext.connectObject('notify::scale-factor', place, this);
        this._settings.connectObject('changed::bottom-panel-height', place, this);
        this._place();
        this._slideIn();
    }

    _place() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;

        // The setting is in the same units as the stylesheet, which St
        // scales.
        const height = this._settings.get_int('bottom-panel-height') *
            this._themeContext.scale_factor;

        this._panel.set_position(monitor.x, monitor.y + monitor.height - height);
        this._panel.set_size(monitor.width, height);
    }

    // Windows make room at once; the panel rises into the space they left.
    _slideIn() {
        this._background.translation_y = this._panel.height;
        this._background.ease({
            translation_y: 0,
            duration: PANEL_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    destroy() {
        Main.layoutManager.disconnectObject(this);
        this._themeContext.disconnectObject(this);
        this._themeContext = null;
        this._settings.disconnectObject(this);
        this._settings = null;

        Main.ctrlAltTabManager.removeGroup(this._panel);

        // Destroying chrome untracks it and takes the bar with it. The bar's
        // buttons remove their menus from the manager as they go.
        this._panel.destroy();
        this._panel = null;
        this._background = null;
        this._menuManager = null;
        this.bar = null;
    }
}
