// SPDX-License-Identifier: GPL-3.0-or-later

// Replaces the handler of the shell's own switch-to-application-N
// bindings, so user-set accelerators keep working.

import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const SLOTS = 9;

// Same modes the shell registers these bindings with.
const MODES = Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW;

export class Hotkeys {
    // activateSlot gets the zero-based slot of the key pressed.
    constructor(activateSlot) {
        this._activateSlot = activateSlot;
        this._active = false;
    }

    enable() {
        // Without the shell's handler there is nothing to restore later.
        if (this._active || typeof Main.wm._switchToApplication !== 'function')
            return;

        for (let slot = 1; slot <= SLOTS; slot++) {
            Main.wm.setCustomKeybindingHandler(`switch-to-application-${slot}`,
                MODES, () => this._activateSlot(slot - 1));
        }
        this._active = true;
    }

    disable() {
        if (!this._active)
            return;

        const shellHandler = Main.wm._switchToApplication.bind(Main.wm);
        for (let slot = 1; slot <= SLOTS; slot++) {
            Main.wm.setCustomKeybindingHandler(`switch-to-application-${slot}`,
                MODES, shellHandler);
        }
        this._active = false;
    }
}
