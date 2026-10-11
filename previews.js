// SPDX-License-Identifier: GPL-3.0-or-later

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const FADE_DURATION = 120;
const POPUP_GAP = 6;

// Thumbnail height cap, as a fraction of its width.
const MAX_HEIGHT_FRACTION = 0.7;

// Narrower thumbnails are unreadable, so past this the popup overflows.
const MIN_ITEM_WIDTH = 80;

// Estimated padding per item, for sizing before the items exist.
const ITEM_CHROME = 26;

// `popup` must already be visible.
export function positionBelow(popup, source) {
    const [sourceX, sourceY] = source.get_transformed_position();
    const [sourceWidth, sourceHeight] = source.get_transformed_size();
    const [, width] = popup.get_preferred_width(-1);

    const monitor = Main.layoutManager.findMonitorForActor(source) ??
        Main.layoutManager.primaryMonitor;

    const centered = sourceX + sourceWidth / 2 - width / 2;
    const x = Math.round(Math.max(monitor.x + POPUP_GAP,
        Math.min(centered, monitor.x + monitor.width - width - POPUP_GAP)));

    popup.set_position(x, Math.round(sourceY + sourceHeight + POPUP_GAP));
}

export const PreviewPopup = GObject.registerClass(
class AppBarPreviewPopup extends St.BoxLayout {
    _init(settings) {
        super._init({
            style_class: 'appbar-preview',
            orientation: Clutter.Orientation.HORIZONTAL,
            reactive: true,
            track_hover: true,
        });

        this._settings = settings;
        this._source = null;
        this._windows = [];

        this.hide();
        // Clickable, so it keeps the default input region.
        Main.layoutManager.addTopChrome(this);
    }

    get sourceButton() {
        return this._source;
    }

    present(source, windows) {
        // Most calls show what is already up; skip the rebuild.
        if (this.visible && source === this._source &&
            sameWindows(windows, this._windows)) {
            positionBelow(this, source);
            return;
        }

        this._source = source;
        this._windows = [...windows];
        this.destroy_all_children();

        const monitor = Main.layoutManager.findMonitorForActor(source) ??
            Main.layoutManager.primaryMonitor;

        // Shrink thumbnails rather than drop windows.
        const available = monitor.width - 2 * POPUP_GAP;
        const fitted = Math.floor(available / windows.length) - ITEM_CHROME;
        const width = Math.max(MIN_ITEM_WIDTH,
            Math.min(this._settings.get_int('preview-size'), fitted));

        for (const window of windows)
            this.add_child(this._buildItem(window, width));

        const wasVisible = this.visible;
        this.show();
        positionBelow(this, source);

        if (!wasVisible) {
            this.opacity = 0;
            this.ease({
                opacity: 255,
                duration: FADE_DURATION,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }
    }

    dismiss() {
        this._source = null;
        this._windows = [];
        if (!this.visible)
            return;

        this.hide();
        this.destroy_all_children();
    }

    refreshTitles() {
        if (!this.visible)
            return;

        for (const item of this.get_children())
            item._titleLabel.text = item._window.get_title() ?? '';
    }

    _buildItem(window, width) {
        const item = new St.Button({
            style_class: 'appbar-preview-item',
            button_mask: St.ButtonMask.ONE | St.ButtonMask.TWO,
            can_focus: true,
        });

        const box = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'appbar-preview-item-box',
        });
        item.set_child(box);

        const label = new St.Label({
            style_class: 'appbar-preview-title',
            text: window.get_title() ?? '',
        });
        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        label.set_width(width);
        box.add_child(label);

        box.add_child(this._buildThumbnail(item, window, width));

        item._window = window;
        item._titleLabel = label;

        item.connect('clicked', (_actor, button) => {
            if (button === Clutter.BUTTON_MIDDLE) {
                // The bar's next sync removes the closed window's item.
                window.delete(global.get_current_time());
            } else {
                Main.activateWindow(window);
                this.dismiss();
            }
        });

        return item;
    }

    _buildThumbnail(item, window, width) {
        const bin = new St.Bin({x_align: Clutter.ActorAlign.CENTER});

        const fill = () => {
            const actor = window.get_compositor_private();
            if (!actor || actor.width === 0)
                return false;

            bin.set_child(this._buildClone(item, actor, width));
            return true;
        };
        if (fill())
            return bin;

        // A window still opening has nothing to clone yet. The handler is
        // owned by the bin, so it goes away with the item.
        const actor = window.get_compositor_private();
        const [target, signal] = actor
            ? [actor, 'first-frame'] : [window, 'shown'];
        target.connectObject(signal, () => {
            if (!fill())
                return;
            target.disconnectObject(bin);
            if (this._source)
                positionBelow(this, this._source);
        }, bin);

        return bin;
    }

    _buildClone(item, actor, width) {
        const maxHeight = Math.round(width * MAX_HEIGHT_FRACTION);
        const clone = new Clutter.Clone({source: actor});
        const fit = () => {
            const scale = Math.min(
                width / actor.width, maxHeight / actor.height, 1);
            clone.set_size(
                Math.round(actor.width * scale),
                Math.round(actor.height * scale));
        };
        fit();

        actor.connectObject(
            // A clone stretches to its own size, so refit on resize.
            'notify::size', () => {
                fit();
                if (this._source)
                    positionBelow(this, this._source);
            },
            // Painting a clone of a destroyed actor would crash.
            'destroy', () => clone.set_source(null),
            item);

        return clone;
    }
});

function sameWindows(a, b) {
    return a.length === b.length && a.every((window, i) => window === b[i]);
}
