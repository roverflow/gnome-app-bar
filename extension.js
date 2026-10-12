// SPDX-License-Identifier: GPL-3.0-or-later

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Hotkeys} from './hotkeys.js';
import {BottomPanelLayout} from './layouts/bottomPanel.js';
import {TopPanelLayout} from './layouts/topPanel.js';
import {TaskbarModel} from './taskbarModel.js';

// layout setting to the class that places the bar. Each takes (settings,
// model), exposes `bar`, and has destroy().
const LAYOUTS = {
    'top-panel': TopPanelLayout,
    'bottom-panel': BottomPanelLayout,
};

export default class AppBarExtension extends Extension {
    enable() {
        this._settings = this.getSettings();

        // Kept across layout switches, so app and window tracking carries on.
        this._model = new TaskbarModel(this._settings);
        this._createLayout();

        // Reads this._layout on each press, so it follows a layout switch.
        this._hotkeys = new Hotkeys(slot => this._layout?.bar.activateNth(slot));
        this._syncHotkeys();

        this._settings.connectObject(
            'changed::layout', () => {
                this._layout.destroy();
                this._createLayout();
            },
            'changed::hotkeys', () => this._syncHotkeys(),
            this);
    }

    _createLayout() {
        const Layout = LAYOUTS[this._settings.get_string('layout')] ??
            TopPanelLayout;
        this._layout = new Layout(this._settings, this._model);
    }

    _syncHotkeys() {
        if (this._settings.get_boolean('hotkeys'))
            this._hotkeys.enable();
        else
            this._hotkeys.disable();
    }

    disable() {
        this._settings.disconnectObject(this);

        this._hotkeys.disable();
        this._hotkeys = null;

        this._layout.destroy();
        this._layout = null;

        this._model.destroy();
        this._model = null;

        this._settings = null;
    }
}
