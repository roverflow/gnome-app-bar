// SPDX-License-Identifier: GPL-3.0-or-later

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {AppBar} from './appBar.js';
import {Hotkeys} from './hotkeys.js';

const PANEL_ROLE = 'appbar';

// panel-position to [box, index]. 'left' sits after the workspace pill,
// 'far-left' before it.
const POSITIONS = {
    'far-left': ['left', 0],
    'left': ['left', 1],
    'center': ['center', 0],
    'right': ['right', 0],
};

export default class AppBarExtension extends Extension {
    enable() {
        this._settings = this.getSettings();

        // A panel role can't move between boxes, so rebuild the bar.
        this._settings.connectObject('changed::panel-position', () => {
            this._appBar?.destroy();
            this._appBar = null;
            this._addBar();
        }, 'changed::hotkeys', () => this._syncHotkeys(), this);

        this._addBar();

        // Reads this._appBar on each press, so it follows a rebuild.
        this._hotkeys = new Hotkeys(slot => this._appBar?.activateNth(slot));
        this._syncHotkeys();
    }

    _syncHotkeys() {
        if (this._settings.get_boolean('hotkeys'))
            this._hotkeys.enable();
        else
            this._hotkeys.disable();
    }

    _addBar() {
        const nick = this._settings.get_string('panel-position');
        const [box, index] = POSITIONS[nick] ?? POSITIONS['left'];

        this._appBar = new AppBar(this._settings);
        Main.panel.addToStatusArea(PANEL_ROLE, this._appBar, index, box);
    }

    disable() {
        this._settings?.disconnectObject(this);
        this._settings = null;

        this._hotkeys?.disable();
        this._hotkeys = null;

        // The panel drops the status area role on destroy.
        this._appBar?.destroy();
        this._appBar = null;
    }
}
