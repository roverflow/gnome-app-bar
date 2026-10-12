// SPDX-License-Identifier: GPL-3.0-or-later

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {POPUP_HIDE_TIME, POPUP_SHOW_TIME} from './motion.js';
import {PreviewPopup, popupPosition} from './previews.js';

// How long the pointer rests on an icon before its popup shows.
// DASH_ITEM_HOVER_TIMEOUT in dash.js.
const HOVER_DELAY = 300;

// Time for the pointer to move from a button into its preview.
const HOVER_GRACE = 300;

// After a popup goes away, the next icon shows its popup without waiting,
// so sliding along the bar reads each icon in turn, as in the dash.
const RESHOW_WINDOW = 300;

// The tooltip or window preview shown while the pointer rests on an icon.
// Buttons report hover changes; this decides what to show and when.
//
// A button passed in must provide getWindows() and getTooltipText().
export class HoverPopups {
    // `side` is the screen edge the bar sits on, as St.Side.
    constructor(settings, side) {
        this._settings = settings;
        this._side = side;

        this._source = null;
        this._tooltip = null;
        this._tooltipShown = false;
        this._preview = null;
        this._recentlyShown = false;
        this._showTimeoutId = 0;
        this._hideTimeoutId = 0;
        this._reshowTimeoutId = 0;

        this._showPreviews = settings.get_boolean('show-previews');
        settings.connectObject('changed::show-previews', () => {
            this._showPreviews = settings.get_boolean('show-previews');
            if (!this._showPreviews)
                this._preview?.dismiss();
        }, this);
    }

    show(button) {
        this._source = button;
        this._removeShowTimeout();
        this._removeHideTimeout();

        // With a popup up, or one just gone, move to the new button at once.
        if (this._popupShown() || this._recentlyShown) {
            this._present();
            return;
        }

        this._showTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, HOVER_DELAY, () => {
                this._showTimeoutId = 0;
                this._present();
                return GLib.SOURCE_REMOVE;
            });
    }

    // A null `button` hides whatever is up. `immediate` skips HOVER_GRACE,
    // which otherwise lets the pointer travel into the preview, and the
    // reshow window, as a click or a menu should.
    hide(button, immediate = false) {
        if (button && this._source !== button)
            return;

        this._removeShowTimeout();
        this._source = null;

        if (immediate)
            this._endReshowWindow();
        else if (this._popupShown())
            this._startReshowWindow();

        this._hideTooltip();

        if (!this._preview?.isShown)
            return;

        if (immediate)
            this._preview.dismiss();
        else
            this._scheduleHide();
    }

    // Call before destroying a button.
    forget(button) {
        if (this._source === button) {
            this._removeShowTimeout();
            this._source = null;
            this._hideTooltip();
        }
        if (this._preview?.sourceButton === button)
            this._preview.dismiss();
    }

    // Call after the bar rebuilds, since a previewed button's windows may
    // have changed.
    refresh() {
        const source = this._preview?.isShown ? this._preview.sourceButton : null;
        if (!source)
            return;

        const windows = source.getWindows();
        if (windows.length > 0)
            this._preview.present(source, windows);
        else
            this._preview.dismiss();
    }

    refreshTitles() {
        if (this._tooltipShown && this._source)
            this._presentTooltip(this._source);
        this._preview?.refreshTitles();
    }

    _popupShown() {
        return this._tooltipShown || (this._preview?.isShown ?? false);
    }

    _present() {
        const button = this._source;
        if (!button)
            return;

        const windows = button.getWindows();
        if (windows.length > 0 && this._showPreviews) {
            this._hideTooltip();
            this._ensurePreview().present(button, windows);
        } else {
            this._preview?.dismiss();
            this._presentTooltip(button);
        }
    }

    _ensurePreview() {
        if (this._preview)
            return this._preview;

        this._preview = new PreviewPopup(this._settings, this._side);
        this._preview.connect('notify::hover', () => {
            if (!this._preview.isShown)
                return;
            if (this._preview.hover)
                this._removeHideTimeout();
            else if (!this._source)
                this._scheduleHide();
        });
        return this._preview;
    }

    // A tooltip still on screen glides to the new button; one that has
    // gone fades in where it is needed.
    _presentTooltip(button) {
        if (!this._tooltip) {
            // Not reactive, so it stays out of the input region.
            this._tooltip = new St.Label({style_class: 'appbar-tooltip'});
            this._tooltip.hide();
            Main.layoutManager.addTopChrome(this._tooltip);
        }

        const tooltip = this._tooltip;
        const glide = tooltip.visible;
        this._tooltipShown = true;
        tooltip.text = button.getTooltipText();
        tooltip.show();

        const [x, y] = popupPosition(tooltip, button, this._side);
        if (glide) {
            tooltip.ease({
                x,
                y,
                opacity: 255,
                duration: POPUP_SHOW_TIME,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
            return;
        }

        tooltip.set_position(x, y);
        tooltip.opacity = 0;
        tooltip.ease({
            opacity: 255,
            duration: POPUP_SHOW_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _hideTooltip() {
        if (!this._tooltipShown)
            return;

        this._tooltipShown = false;
        this._tooltip.ease({
            opacity: 0,
            duration: POPUP_HIDE_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => this._tooltip.hide(),
        });
    }

    _startReshowWindow() {
        this._removeReshowTimeout();
        this._recentlyShown = true;
        this._reshowTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, RESHOW_WINDOW, () => {
                this._reshowTimeoutId = 0;
                this._recentlyShown = false;
                return GLib.SOURCE_REMOVE;
            });
    }

    _endReshowWindow() {
        this._removeReshowTimeout();
        this._recentlyShown = false;
    }

    _scheduleHide() {
        this._removeHideTimeout();
        this._hideTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, HOVER_GRACE, () => {
                this._hideTimeoutId = 0;
                if (this._preview && !this._preview.hover)
                    this._preview.dismiss();
                return GLib.SOURCE_REMOVE;
            });
    }

    _removeHideTimeout() {
        if (!this._hideTimeoutId)
            return;

        GLib.Source.remove(this._hideTimeoutId);
        this._hideTimeoutId = 0;
    }

    _removeShowTimeout() {
        if (!this._showTimeoutId)
            return;

        GLib.Source.remove(this._showTimeoutId);
        this._showTimeoutId = 0;
    }

    _removeReshowTimeout() {
        if (!this._reshowTimeoutId)
            return;

        GLib.Source.remove(this._reshowTimeoutId);
        this._reshowTimeoutId = 0;
    }

    destroy() {
        this._removeShowTimeout();
        this._removeHideTimeout();
        this._removeReshowTimeout();
        this._settings.disconnectObject(this);
        this._settings = null;
        this._source = null;

        // Destroying chrome also untracks it, and stops its animations.
        this._tooltip?.destroy();
        this._tooltip = null;
        this._preview?.destroy();
        this._preview = null;
    }
}
