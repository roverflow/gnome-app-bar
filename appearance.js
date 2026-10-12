// SPDX-License-Identifier: GPL-3.0-or-later

import GObject from 'gi://GObject';
import St from 'gi://St';

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

// A launching icon pulses between this and OPACITY_ACTIVE.
const OPACITY_LAUNCHING = 150;

// An unfocused single-window indicator, as a fraction of icon size. The
// dot is round instead.
const BAR_FRACTION = 0.3;

// How much longer the indicator grows for the focused app, and for an app
// with more than one window.
const FOCUSED_STRETCH = 2.4;
const MULTIPLE_STRETCH = 1.6;

export const Appearance = GObject.registerClass({
    Signals: {'changed': {}},
}, class AppBarAppearance extends GObject.Object {
    _init(settings) {
        super._init();

        this._settings = settings;
        this._themeContext = St.ThemeContext.get_for_stage(global.stage);
        this._version = 0;
        this._reload();

        const reload = () => {
            this._reload();
            this.emit('changed');
        };
        for (const key of WATCHED_KEYS)
            this._settings.connectObject(`changed::${key}`, reload, this);

        // Indicator widths are in actor pixels, which the scale multiplies.
        this._themeContext.connectObject('notify::scale-factor', reload, this);
    }

    // styleFor() runs for every button on every focus change, so it reads
    // these cached fields instead of GSettings.
    _reload() {
        this._version++;
        this._iconSize = this._settings.get_int('icon-size');
        this._iconOffset = this._settings.get_int('vertical-offset');
        this._indicatorName = this._settings.get_string('indicator-style');
        this._showWindowCount = this._settings.get_boolean('show-window-count');

        // Half on each side, so the gap between icons is the value set.
        const half = Math.round(this._settings.get_int('icon-spacing') / 2);
        this._buttonStyle = `padding: 0 ${half}px;`;

        const thickness = this._settings.get_int('indicator-thickness');
        const bottom = this._settings.get_int('indicator-bottom-margin');

        // The CSS sizes the stylesheet scales; widths are set from code and
        // eased, so they are scaled here.
        const height = this._indicatorName === 'dot' ? thickness * 2 : thickness;
        this._indicatorStyle =
            `min-height: ${height}px;` +
            `border-radius: ${Math.ceil(height / 2)}px;` +
            `margin-bottom: ${bottom}px;`;

        const scale = this._themeContext.scale_factor;
        this._indicatorBaseWidth = scale * (this._indicatorName === 'dot'
            ? height
            : Math.max(height, this._iconSize * BAR_FRACTION));
    }

    // Changes whenever a setting does, so buttons can tell their style is stale.
    get version() {
        return this._version;
    }

    // iconPulseOpacity is the far end of the launch pulse, or null for none.
    // indicatorWidth is in actor pixels.
    styleFor(state) {
        return {
            iconSize: this._iconSize,
            iconOpacity: this._opacityFor(state),
            iconPulseOpacity: state.launching ? OPACITY_ACTIVE : null,
            iconOffset: this._iconOffset,
            buttonStyle: this._buttonStyle,
            indicatorVisible: state.running && this._indicatorName !== 'none',
            indicatorStyle: this._indicatorStyle,
            indicatorWidth: this._indicatorWidthFor(state),
            badgeVisible: this._showWindowCount && state.windowCount > 1,
        };
    }

    _opacityFor({running, focused, launching, attention, hovered}) {
        if (launching)
            return OPACITY_LAUNCHING;
        if (hovered || focused || attention)
            return OPACITY_ACTIVE;
        return running ? OPACITY_RUNNING : OPACITY_IDLE;
    }

    _indicatorWidthFor({focused, windowCount}) {
        let width = this._indicatorBaseWidth;
        if (focused)
            width *= FOCUSED_STRETCH;
        if (windowCount > 1)
            width *= MULTIPLE_STRETCH;
        return Math.round(width);
    }

    destroy() {
        this._settings.disconnectObject(this);
        this._settings = null;
        this._themeContext.disconnectObject(this);
        this._themeContext = null;
    }
});
