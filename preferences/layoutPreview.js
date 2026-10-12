// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

const WIDTH = 132;
const HEIGHT = 82;
const RADIUS = 6;
const TOP_BAR = 8;
const BOTTOM_BAR = 12;

// A small drawing of the desktop with the icons in the top panel or in a
// bottom panel, in the theme's text and accent colours.
export const LayoutPreview = GObject.registerClass(
class AppBarLayoutPreview extends Gtk.DrawingArea {
    // `layout` is a value of the layout setting.
    _init(layout) {
        super._init({
            content_width: WIDTH,
            content_height: HEIGHT,
            halign: Gtk.Align.CENTER,
        });

        this._layout = layout;
        this._styleIds = [];
        this.set_draw_func((_area, cr, width, height) => {
            this._draw(cr, width, height);
            cr.$dispose();
        });

        // The style manager outlives the window, so only hold it while
        // realized.
        const styleManager = Adw.StyleManager.get_default();
        this.connect('realize', () => {
            this._styleIds = [
                styleManager.connect('notify::dark', () => this.queue_draw()),
                styleManager.connect('notify::accent-color-rgba', () => this.queue_draw()),
            ];
        });
        this.connect('unrealize', () => {
            this._styleIds.forEach(id => styleManager.disconnect(id));
            this._styleIds = [];
        });
    }

    _draw(cr, width, height) {
        const fg = this.get_color();
        const accent = Adw.StyleManager.get_default().get_accent_color_rgba();
        const fill = (color, alpha) =>
            cr.setSourceRGBA(color.red, color.green, color.blue, alpha);

        // The screen.
        roundedRect(cr, 0.5, 0.5, width - 1, height - 1, RADIUS);
        fill(fg, 0.06);
        cr.fillPreserve();
        fill(fg, 0.2);
        cr.setLineWidth(1);
        cr.stroke();

        // A window.
        roundedRect(cr, width * 0.2, TOP_BAR + 8, width * 0.6, height * 0.45, 3);
        fill(fg, 0.12);
        cr.fill();

        // Panels, clipped to the screen's rounded corners.
        cr.save();
        roundedRect(cr, 0, 0, width, height, RADIUS);
        cr.clip();

        cr.rectangle(0, 0, width, TOP_BAR);
        fill(fg, 0.22);
        cr.fill();

        if (this._layout === 'bottom-panel') {
            cr.rectangle(0, height - BOTTOM_BAR, width, BOTTOM_BAR);
            fill(fg, 0.22);
            cr.fill();
            drawIcons(cr, fill, fg, accent, {
                count: 5,
                size: 6,
                gap: 4,
                x: null,
                y: height - BOTTOM_BAR / 2,
                width,
            });
        } else {
            drawIcons(cr, fill, fg, accent, {
                count: 4,
                size: 4,
                gap: 3,
                x: 10,
                y: TOP_BAR / 2,
                width,
            });
        }
        cr.restore();
    }
});

// A row of square icons centred on `y`, starting at `x`, or centred
// across `width` when `x` is null. The first is in the accent colour, as
// if focused.
function drawIcons(cr, fill, fg, accent, {count, size, gap, x, y, width}) {
    const rowWidth = count * size + (count - 1) * gap;
    const start = x ?? (width - rowWidth) / 2;

    for (let i = 0; i < count; i++) {
        roundedRect(cr, start + i * (size + gap), y - size / 2, size, size, 1.5);
        if (i === 0)
            fill(accent, 1);
        else
            fill(fg, 0.55);
        cr.fill();
    }
}

function roundedRect(cr, x, y, width, height, radius) {
    cr.newSubPath();
    cr.arc(x + width - radius, y + radius, radius, -Math.PI / 2, 0);
    cr.arc(x + width - radius, y + height - radius, radius, 0, Math.PI / 2);
    cr.arc(x + radius, y + height - radius, radius, Math.PI / 2, Math.PI);
    cr.arc(x + radius, y + radius, radius, Math.PI, Math.PI * 1.5);
    cr.closePath();
}
