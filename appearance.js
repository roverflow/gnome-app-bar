// SPDX-License-Identifier: GPL-3.0-or-later

import GObject from 'gi://GObject';

const WATCHED_KEYS = [
    'icon-size',
    'icon-spacing',
    'vertical-offset',
    'indicator-style',
    'indicator-thickness',
    'indicator-bottom-margin',
    'show-window-count',
];

// St's CSS has no opacity property, so these are set from code.
const OPACITY_ACTIVE = 255;
const OPACITY_RUNNING = 215;
const OPACITY_IDLE = 110;

// Indicator length as a fraction of icon size.
const BAR_FRACTION_SINGLE = 0.7;
const BAR_FRACTION_MULTIPLE = 1.1;
const DOT_FRACTION_MULTIPLE = 2.2;

export const Appearance = GObject.registerClass({
    Signals: {'changed': {}},
}, class AppBarAppearance extends GObject.Object {
    _init(settings) {
        super._init();

        this._settings = settings;
        this._reload();

        for (const key of WATCHED_KEYS) {
            this._settings.connectObject(`changed::${key}`, () => {
                this._reload();
                this.emit('changed');
            }, this);
        }
    }

    // styleFor() runs for every button on every focus change, so it reads
    // these cached fields instead of GSettings.
    _reload() {
        this._iconSize = this._settings.get_int('icon-size');
        this._iconOffset = this._settings.get_int('vertical-offset');
        this._indicatorName = this._settings.get_string('indicator-style');
        this._showWindowCount = this._settings.get_boolean('show-window-count');

        // Half on each side, so the gap between icons is the value set.
        const half = Math.round(this._settings.get_int('icon-spacing') / 2);
        this._buttonStyle = `padding: 0 ${half}px;`;

        const thickness = this._settings.get_int('indicator-thickness');
        const bottom = this._settings.get_int('indicator-bottom-margin');

        this._indicatorSingle = this._indicatorStyle(thickness, bottom, false);
        this._indicatorMultiple = this._indicatorStyle(thickness, bottom, true);
    }

    // iconPulseOpacity is the peak of the launch pulse, or null for none.
    styleFor(state) {
        return {
            iconSize: this._iconSize,
            iconOpacity: this._opacityFor(state),
            iconPulseOpacity: state.launching ? OPACITY_ACTIVE : null,
            iconOffset: this._iconOffset,
            buttonStyle: this._buttonStyle,
            indicatorVisible: state.running && this._indicatorName !== 'none',
            indicatorStyle: state.windowCount > 1
                ? this._indicatorMultiple
                : this._indicatorSingle,
            badgeVisible: this._showWindowCount && state.windowCount > 1,
        };
    }

    _opacityFor({running, focused, launching, attention, hovered}) {
        if (launching)
            return OPACITY_IDLE;
        if (hovered || focused || attention)
            return OPACITY_ACTIVE;
        return running ? OPACITY_RUNNING : OPACITY_IDLE;
    }

    _indicatorStyle(thickness, bottom, multiple) {
        let width, height;
        if (this._indicatorName === 'dot') {
            height = thickness * 2;
            width = multiple ? Math.round(thickness * DOT_FRACTION_MULTIPLE * 2) : height;
        } else {
            height = thickness;
            width = Math.round(this._iconSize *
                (multiple ? BAR_FRACTION_MULTIPLE : BAR_FRACTION_SINGLE));
        }

        return `min-width: ${width}px;` +
               `min-height: ${height}px;` +
               `border-radius: ${Math.ceil(height / 2)}px;` +
               `margin-bottom: ${bottom}px;`;
    }

    destroy() {
        this._settings.disconnectObject(this);
        this._settings = null;
    }
});
