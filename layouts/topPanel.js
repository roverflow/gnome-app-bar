// SPDX-License-Identifier: GPL-3.0-or-later

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import {AppBar} from '../appBar.js';

const PANEL_ROLE = 'appbar';

// panel-position to [box, index]. 'left' sits after the workspace pill,
// 'far-left' before it.
const POSITIONS = {
    'far-left': ['left', 0],
    'left': ['left', 1],
    'center': ['center', 0],
    'right': ['right', 0],
};

// Puts the bar inside GNOME's top panel.
export class TopPanelLayout {
    constructor(settings, model) {
        this._settings = settings;
        this._holder = null;

        this.bar = new AppBar(settings, model, {
            side: St.Side.TOP,
            // Opening an icon's menu closes the panel's own menus.
            menuManager: Main.panel.menuManager,
            align: Clutter.ActorAlign.START,
        });
        this._addToPanel();

        // A status area role can't move between boxes, so the holder is
        // replaced. The bar and its icons are kept.
        this._settings.connectObject('changed::panel-position', () => {
            this._holder.remove_child(this.bar);
            this._holder.destroy();
            this._addToPanel();
        }, this);
    }

    _addToPanel() {
        const nick = this._settings.get_string('panel-position');
        const [box, index] = POSITIONS[nick] ?? POSITIONS['left'];

        // The status area only takes a PanelMenu.Button. This one only
        // holds the bar: no menu, and its icons take the input.
        this._holder = new PanelMenu.Button(0.0, 'AppBar', true);
        this._holder.remove_style_class_name('panel-button');
        this._holder.add_style_class_name('appbar-panel-button');
        this._holder.reactive = false;
        this._holder.track_hover = false;
        this._holder.can_focus = false;

        this._holder.add_child(this.bar);

        // The holder sizes itself from the bar even when the bar is hidden.
        this.bar.bind_property('visible', this._holder, 'visible',
            GObject.BindingFlags.SYNC_CREATE);

        Main.panel.addToStatusArea(PANEL_ROLE, this._holder, index, box);
    }

    destroy() {
        this._settings.disconnectObject(this);
        this._settings = null;

        // Takes the bar with it. The panel drops the role on destroy.
        this._holder.destroy();
        this._holder = null;
        this.bar = null;
    }
}
