// SPDX-License-Identifier: GPL-3.0-or-later

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {POPUP_HIDE_TIME, POPUP_SHOW_TIME} from './motion.js';

const POPUP_GAP = 6;

// The preview grows from this scale as it opens, like the shell's menus.
const OPENING_SCALE = 0.96;

// Thumbnail height cap, as a fraction of its width.
const MAX_HEIGHT_FRACTION = 0.7;

// Narrower thumbnails are unreadable, so past this the popup overflows.
const MIN_ITEM_WIDTH = 80;

// Estimated padding per item, for sizing before the items exist.
const ITEM_CHROME = 26;

// Where `popup` goes to sit centred on `source`, below it when `side` is
// St.Side.TOP (the bar is at the top of the screen) and above it when
// St.Side.BOTTOM. Returns [x, y]. `popup` must already be visible.
export function popupPosition(popup, source, side) {
    const [sourceX, sourceY] = source.get_transformed_position();
    const [sourceWidth, sourceHeight] = source.get_transformed_size();
    const [, width] = popup.get_preferred_width(-1);

    const monitor = Main.layoutManager.findMonitorForActor(source) ??
        Main.layoutManager.primaryMonitor;

    const centered = sourceX + sourceWidth / 2 - width / 2;
    const x = Math.max(monitor.x + POPUP_GAP,
        Math.min(centered, monitor.x + monitor.width - width - POPUP_GAP));

    let y;
    if (side === St.Side.BOTTOM) {
        const [, height] = popup.get_preferred_height(width);
        y = sourceY - height - POPUP_GAP;
    } else {
        y = sourceY + sourceHeight + POPUP_GAP;
    }

    return [Math.round(x), Math.round(y)];
}

export const PreviewPopup = GObject.registerClass(
class AppBarPreviewPopup extends St.BoxLayout {
    _init(settings, side) {
        super._init({
            style_class: 'appbar-preview',
            orientation: Clutter.Orientation.HORIZONTAL,
            reactive: true,
            track_hover: true,
            // Grows out of the bar, from the edge nearest the icon.
            pivot_point: new Graphene.Point({
                x: 0.5,
                y: side === St.Side.BOTTOM ? 1 : 0,
            }),
        });

        this._settings = settings;
        this._side = side;
        this._source = null;
        this._windows = [];
        this._closing = false;

        this.hide();
        // Clickable, so it keeps the default input region.
        Main.layoutManager.addTopChrome(this);

        // Disconnected when this actor is destroyed.
        global.display.connectObject(
            'notify::focus-window', () => this._syncFocused(), this);
    }

    get sourceButton() {
        return this._source;
    }

    // Visible and not on its way out.
    get isShown() {
        return this.visible && !this._closing;
    }

    present(source, windows) {
        // Most calls show what is already up; skip the rebuild.
        if (this.isShown && source === this._source &&
            sameWindows(windows, this._windows)) {
            this._reposition();
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
        this._syncFocused();

        // One that is closing turns around from where it got to.
        const wasShown = this.isShown;
        if (!this.visible) {
            this.opacity = 0;
            this.set_scale(OPENING_SCALE, OPENING_SCALE);
        }
        this._closing = false;
        this.show();
        this._reposition();

        if (!wasShown) {
            this.ease({
                opacity: 255,
                scale_x: 1,
                scale_y: 1,
                duration: POPUP_SHOW_TIME,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }
    }

    _reposition() {
        if (this._source)
            this.set_position(...popupPosition(this, this._source, this._side));
    }

    dismiss() {
        this._source = null;
        this._windows = [];
        if (!this.isShown)
            return;

        this._closing = true;
        this.ease({
            opacity: 0,
            scale_x: OPENING_SCALE,
            scale_y: OPENING_SCALE,
            duration: POPUP_HIDE_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                this._closing = false;
                this.hide();
                this.destroy_all_children();
            },
        });
    }

    // Marks the thumbnail of the window that has focus.
    _syncFocused() {
        if (!this.visible)
            return;

        const focused = global.display.focus_window;
        for (const item of this.get_children()) {
            if (item._window === focused)
                item.add_style_class_name('focused');
            else
                item.remove_style_class_name('focused');
        }
    }

    refreshTitles() {
        if (!this.visible)
            return;

        for (const item of this.get_children()) {
            const title = item._window.get_title() ?? '';
            item._titleLabel.text = title;
            item.accessible_name = title;
        }
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

        // The title, with a close button at the end that shows on hover.
        const header = new St.BoxLayout({
            style_class: 'appbar-preview-header',
            width,
        });
        box.add_child(header);

        const label = new St.Label({
            style_class: 'appbar-preview-title',
            text: window.get_title() ?? '',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        header.add_child(label);
        header.add_child(this._buildCloseButton(item, window));

        box.add_child(this._buildThumbnail(item, window, width));

        item._window = window;
        item._titleLabel = label;
        item.accessible_name = window.get_title() ?? '';

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

    // Kept in the layout while hidden, so the title doesn't shift when it
    // appears. It stops the click, so the window behind is not raised.
    _buildCloseButton(item, window) {
        const button = new St.Button({
            style_class: 'appbar-preview-close',
            child: new St.Icon({
                icon_name: 'window-close-symbolic',
                style_class: 'appbar-preview-close-icon',
            }),
            accessible_name: _('Close'),
            can_focus: true,
            opacity: 0,
            y_align: Clutter.ActorAlign.CENTER,
        });
        button.connect('clicked', () => window.delete(global.get_current_time()));

        const sync = () => {
            const shown = item.hover || item.has_key_focus() || button.has_key_focus();
            button.ease({
                opacity: shown ? 255 : 0,
                duration: shown ? POPUP_SHOW_TIME : POPUP_HIDE_TIME,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        };
        item.connect('notify::hover', sync);
        item.connect('key-focus-in', sync);
        item.connect('key-focus-out', sync);
        button.connect('key-focus-in', sync);
        button.connect('key-focus-out', sync);

        return button;
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
            this._reposition();
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
                this._reposition();
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
