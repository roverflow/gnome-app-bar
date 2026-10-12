// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {LayoutPreview} from './layoutPreview.js';
import {SettingsPage} from './settingsPage.js';

// Nick order must match the labels passed with them.
const PANEL_POSITIONS = ['far-left', 'left', 'center', 'right'];
const INDICATOR_STYLES = ['bar', 'dot', 'none'];

export const AppearancePage = GObject.registerClass(
class AppBarAppearancePage extends SettingsPage {
    _init(settings) {
        super._init(settings, {
            title: _('Appearance'),
            icon_name: 'preferences-desktop-appearance-symbolic',
        });

        this.add(this._layoutGroup());
        this.add(this._placementGroup());
        this.add(this._iconsGroup());
        this.add(this._indicatorGroup());
        this.add(this._fineTuningGroup());
        this.add(this._resetGroup());
    }

    _layoutGroup() {
        const group = new Adw.PreferencesGroup({
            title: _('Layout'),
            description: _('Changes apply to the panel immediately'),
        });

        group.add(this.toggleGroup('layout', [
            this._layoutToggle('top-panel', _('Top Panel')),
            this._layoutToggle('bottom-panel', _('Bottom Panel')),
        ]));

        return group;
    }

    _layoutToggle(name, label) {
        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 6,
            margin_top: 6,
            margin_bottom: 6,
        });
        box.append(new LayoutPreview(name));
        box.append(new Gtk.Label({label}));
        return new Adw.Toggle({name, child: box});
    }

    // Each row only applies to one layout, so only that one shows.
    _placementGroup() {
        const group = new Adw.PreferencesGroup({
            title: _('Placement'),
        });

        const position = this.comboRow('panel-position', PANEL_POSITIONS, {
            title: _('Position in Top Panel'),
            labels: [
                _('Far left'),
                _('Left, after the workspace pill'),
                _('Center'),
                _('Right, before the status area'),
            ],
        });
        group.add(position);

        const height = this.spinRow('bottom-panel-height', {
            title: _('Bottom Panel Height'),
            subtitle: _('In pixels'),
            lower: 32,
            upper: 72,
            step: 4,
        });
        group.add(height);

        const sync = () => {
            const bottom = this._settings.get_string('layout') === 'bottom-panel';
            position.visible = !bottom;
            height.visible = bottom;
        };
        sync();
        this.onSettingChanged('layout', sync);

        return group;
    }

    _iconsGroup() {
        const group = new Adw.PreferencesGroup({
            title: _('Icons'),
        });

        group.add(this.spinRow('icon-size', {
            title: _('Icon Size'),
            subtitle: _('Height of each app icon in pixels'),
            lower: 12,
            upper: 48,
        }));

        group.add(this.spinRow('icon-spacing', {
            title: _('Space Between Icons'),
            subtitle: _('Clear space between neighbouring icons in pixels'),
            lower: 0,
            upper: 24,
        }));

        return group;
    }

    _indicatorGroup() {
        const group = new Adw.PreferencesGroup({
            title: _('Running Indicator'),
            description: _('The mark beneath an icon that has windows open. It stretches for the app in focus'),
        });

        group.add(this.toggleRow('indicator-style', INDICATOR_STYLES, {
            title: _('Style'),
            labels: [_('Bar'), _('Dot'), _('None')],
        }));

        group.add(this.switchRow('show-window-count', {
            title: _('Window Count'),
            subtitle: _('A number on icons with more than one window'),
        }));

        return group;
    }

    // Settings few people need, folded away below the common ones.
    _fineTuningGroup() {
        const group = new Adw.PreferencesGroup();

        const expander = new Adw.ExpanderRow({
            title: _('Fine-Tuning'),
            subtitle: _('Icon position and indicator size'),
        });
        group.add(expander);

        expander.add_row(this.spinRow('vertical-offset', {
            title: _('Vertical Nudge'),
            subtitle: _('Negative moves icons up, positive moves them down'),
            lower: -10,
            upper: 10,
        }));

        const thickness = this.spinRow('indicator-thickness', {
            title: _('Indicator Thickness'),
            subtitle: _('Height of the bar, or radius of the dot'),
            lower: 1,
            upper: 6,
        });
        expander.add_row(thickness);

        const margin = this.spinRow('indicator-bottom-margin', {
            title: _('Indicator Distance From Bottom'),
            subtitle: _('Gap between the indicator and the bottom of the icon'),
            lower: 0,
            upper: 12,
        });
        expander.add_row(margin);

        const sync = () => {
            const shown = this._settings.get_string('indicator-style') !== 'none';
            thickness.sensitive = shown;
            margin.sensitive = shown;
        };
        sync();
        this.onSettingChanged('indicator-style', sync);

        return group;
    }

    _resetGroup() {
        const group = new Adw.PreferencesGroup();

        const button = new Gtk.Button({
            label: _('Reset'),
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action'],
        });
        button.connect('clicked', () => this._resetAll());

        const row = new Adw.ActionRow({
            title: _('Reset All Settings'),
            subtitle: _('Restore every option on both pages to its default'),
        });
        row.add_suffix(button);
        row.activatable_widget = button;
        group.add(row);

        return group;
    }

    // The HIG prefers undo to asking first, so the old values are kept
    // for the toast's Undo button.
    _resetAll() {
        const changed = [];
        for (const key of this._settings.settings_schema.list_keys()) {
            const value = this._settings.get_user_value(key);
            if (value !== null)
                changed.push([key, value]);
        }

        if (changed.length === 0) {
            this.showToast(new Adw.Toast({
                title: _('All settings are already at their defaults'),
            }));
            return;
        }

        changed.forEach(([key]) => this._settings.reset(key));

        const toast = new Adw.Toast({
            title: _('Settings reset'),
            button_label: _('Undo'),
        });
        toast.connect('button-clicked', () =>
            changed.forEach(([key, value]) => this._settings.set_value(key, value)));
        this.showToast(toast);
    }
});
