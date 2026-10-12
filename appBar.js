// SPDX-License-Identifier: GPL-3.0-or-later

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Appearance} from './appearance.js';
import {AppButton} from './appButton.js';
import {DragReorder} from './dragReorder.js';
import * as HiddenApps from './hiddenApps.js';
import {HoverPopups} from './hoverPopups.js';

// APPBAR_DEBUG=1 logs every rebuild.
const DEBUG = GLib.getenv('APPBAR_DEBUG') !== null;

// The row of app icons. A layout places it on screen and passes
// `placement`:
//   side         the screen edge the bar sits on, as St.Side. Popups and
//                menus open away from it.
//   menuManager  the PopupMenuManager for context menus
//   align        a Clutter.ActorAlign for the icons within the bar
//
// The bar hides itself while it has no icons.
export const AppBar = GObject.registerClass(
class AppBarAppBar extends St.Widget {
    _init(settings, model, placement) {
        super._init({
            layout_manager: new Clutter.BinLayout(),
            y_expand: true,
        });

        this._settings = settings;
        this._model = model;

        this._box = new St.BoxLayout({
            style_class: 'appbar-box',
            x_align: placement.align,
            y_align: Clutter.ActorAlign.FILL,
            x_expand: true,
            y_expand: true,
        });
        this.add_child(this._box);

        this._appearance = new Appearance(settings);
        this._hover = new HoverPopups(settings, placement.side);
        this._buttons = new Map();
        this._hideNotification = null;

        // Buttons shrinking away. They stay in the box until they are gone.
        this._leavingButtons = new Set();

        // The first sync fills the bar at once; later ones animate.
        this._animateChanges = false;

        // Shared by every button.
        this._context = {
            model,
            appearance: this._appearance,
            hover: this._hover,
            side: placement.side,
            menuManager: placement.menuManager,
            hideApp: app => this._hideApp(app),
            focusEnd: last => this._focusEnd(last),
        };

        // Rebuilds wait until a drag ends.
        this._syncFrozen = false;
        this._pendingSync = false;
        this._drag = new DragReorder(this, this._box, {
            onBegin: () => {
                this._hover.hide(null, true);
                this._syncFrozen = true;
            },
            onEnd: () => {
                this._syncFrozen = false;
                if (this._pendingSync) {
                    this._pendingSync = false;
                    this._queueSync();
                }
            },
        });

        // Signal bursts collapse into one pass before the next frame.
        this._laters = global.compositor.get_laters();
        this._syncId = 0;
        this._restyleId = 0;

        this._model.connectObject(
            'entries-changed', () => this._queueSync(),
            'state-changed', () => this._queueRestyle(),
            'titles-changed', () => this._hover.refreshTitles(),
            this);
        this._appearance.connectObject(
            'changed', () => this._queueRestyle(), this);

        this.connect('destroy', () => this._onDestroy());

        this._sync();
        this._animateChanges = true;
    }

    // Activates the index-th visible icon. Returns false if there is none.
    activateNth(index) {
        const button = this._liveButtons()[index];
        if (!button)
            return false;

        button.activateFromShortcut();
        return true;
    }

    // Buttons in screen order, without those leaving or being dragged.
    _liveButtons() {
        return this._box.get_children().filter(child =>
            child instanceof AppButton && !child.leaving && child.visible);
    }

    // Moves keyboard focus to the first icon, or the last.
    _focusEnd(last) {
        const buttons = this._liveButtons();
        (last ? buttons.at(-1) : buttons.at(0))?.grab_key_focus();
    }

    _hideApp(app) {
        const id = app.get_id();
        HiddenApps.add(this._settings, id);

        const source = MessageTray.getSystemSource();
        const notification = new MessageTray.Notification({
            source,
            title: _('%s has been hidden from the App Bar').format(app.get_name()),
            body: _('The Behavior page of the extension preferences lists hidden apps.'),
            isTransient: true,
        });
        notification.addAction(_('Undo'),
            () => HiddenApps.remove(this._settings, id));

        // Undo uses this bar's settings, so the notification must not
        // outlive the bar.
        this._hideNotification?.destroy();
        this._hideNotification = notification;
        notification.connect('destroy', () => {
            if (this._hideNotification === notification)
                this._hideNotification = null;
        });

        source.addNotification(notification);
    }

    _queueSync() {
        if (this._syncFrozen) {
            this._pendingSync = true;
            return;
        }

        if (this._syncId)
            return;

        // A rebuild restyles every button anyway.
        this._removeLater('_restyleId');

        this._syncId = this._laters.add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._syncId = 0;
            this._sync();
            return GLib.SOURCE_REMOVE;
        });
    }

    _queueRestyle() {
        if (this._restyleId || this._syncId)
            return;

        this._restyleId = this._laters.add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._restyleId = 0;
            this._buttons.forEach(button => button.sync());
            if (DEBUG)
                console.debug(`appbar: restyled ${this._buttons.size} buttons`);
            return GLib.SOURCE_REMOVE;
        });
    }

    _removeLater(field) {
        if (!this[field])
            return;

        this._laters.remove(this[field]);
        this[field] = 0;
    }

    _sync() {
        const desired = this._model.entries();
        const kept = new Set(desired.map(entry => entry.id));

        // In ungrouped mode an app's entry id changes when its first window
        // opens or its last one closes. Reusing the outgoing button for the
        // same app avoids a second entrance.
        const spare = new Map();
        for (const [id, button] of this._buttons) {
            if (kept.has(id))
                continue;
            const list = spare.get(button.app) ?? [];
            list.push(id);
            spare.set(button.app, list);
        }

        // Shown first, so new buttons are mapped and their entrance plays.
        if (desired.length > 0)
            this.visible = true;

        // Leaving buttons stay where they are, so buttons are placed
        // relative to the previous kept one rather than by index.
        let previous = null;
        for (const entry of desired) {
            let button = this._buttons.get(entry.id);

            // The shell can swap a window-backed app for a new one with the
            // same id. The old one has no windows, so its button is replaced
            // in place, without an entrance.
            const replacing = button !== undefined && button.app !== entry.app;
            if (replacing) {
                this._buttons.delete(entry.id);
                button.destroy();
                button = undefined;
            }

            const spareId = button ? null : spare.get(entry.app)?.pop();
            if (spareId) {
                button = this._buttons.get(spareId);
                this._buttons.delete(spareId);
                this._buttons.set(entry.id, button);
                button.setWindowSequence(entry.windowSequence);
            }

            if (button) {
                if (this._previousLiveButton(button) !== previous)
                    this._placeAfter(button, previous);
            } else {
                button = new AppButton(entry, this._context);
                this._drag.attach(button);
                this._buttons.set(entry.id, button);
                this._placeAfter(button, previous);
                if (this._animateChanges && !replacing)
                    button.animateIn();
            }
            button.sync();
            previous = button;
        }

        for (const [id, button] of [...this._buttons]) {
            if (kept.has(id))
                continue;
            this._buttons.delete(id);
            this._removeButton(button);
        }

        this._syncVisible();
        this._hover.refresh();

        if (DEBUG)
            this._logState();
    }

    // Puts `button` right after `previous`, or first when that is null.
    // A null sibling means last to set_child_above_sibling() and
    // insert_child_above(), so the first place needs the below variants.
    _placeAfter(button, previous) {
        const inBox = button.get_parent() === this._box;
        if (previous && inBox)
            this._box.set_child_above_sibling(button, previous);
        else if (previous)
            this._box.insert_child_above(button, previous);
        else if (inBox)
            this._box.set_child_below_sibling(button, null);
        else
            this._box.insert_child_below(button, null);
    }

    // The nearest earlier button that is staying, or null.
    _previousLiveButton(button) {
        let child = button.get_previous_sibling();
        while (child && !(child instanceof AppButton && !child.leaving))
            child = child.get_previous_sibling();
        return child;
    }

    _removeButton(button) {
        if (!this._animateChanges) {
            button.destroy();
            return;
        }

        this._leavingButtons.add(button);
        button.connect('destroy', () => {
            if (this._leavingButtons.delete(button))
                this._syncVisible();
        });
        button.animateOut();
    }

    // Hidden while empty, once the last button has finished leaving.
    _syncVisible() {
        this.visible = this._buttons.size > 0 || this._leavingButtons.size > 0;
    }

    _logState() {
        // Box order, not Map order: a drag reorders only the box.
        const summary = this._liveButtons()
            .map(button => {
                const windows = button.getWindows().length;
                return `${button.app.get_id()}[${windows}]`;
            });
        console.debug(`appbar: ${summary.length} buttons: ${summary.join(' ')}`);
    }

    _onDestroy() {
        this._removeLater('_syncId');
        this._removeLater('_restyleId');
        this._laters = null;

        this._model.disconnectObject(this);
        this._model = null;

        // Before the children go, since it owns the drag placeholder.
        this._drag.destroy();
        this._drag = null;

        // Buttons tell the hover popups when they go, so destroy them first.
        this._leavingButtons.clear();
        this._box.destroy_all_children();
        this._buttons.clear();
        this._hover.destroy();
        this._hover = null;

        this._appearance.disconnectObject(this);
        this._appearance.destroy();
        this._appearance = null;

        this._hideNotification?.destroy();
        this._hideNotification = null;
        this._settings = null;
    }
});
