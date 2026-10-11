// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// Index order must match the enum nicks in the gschema.
const INDICATOR_STYLES = ['bar', 'dot', 'none'];

export const AppearancePage = GObject.registerClass(
class AppBarAppearancePage extends Adw.PreferencesPage {
    _init(settings) {
        super._init({
            title: _('Appearance'),
            icon_name: 'preferences-desktop-appearance-symbolic',
        });

        this._settings = settings;
        this._settingsIds = [];

        const layout = new Adw.PreferencesGroup({
            title: _('Layout'),
            description: _('Changes apply to the panel immediately.'),
        });
        this.add(layout);

        layout.add(this._spinRow('icon-size', {
            title: _('Icon size'),
            subtitle: _('Height of each app icon in pixels'),
            lower: 12,
            upper: 32,
        }));

        layout.add(this._spinRow('icon-spacing', {
            title: _('Space between icons'),
            subtitle: _('Clear space between neighbouring icons in pixels'),
            lower: 0,
            upper: 24,
        }));

        layout.add(this._spinRow('vertical-offset', {
            title: _('Vertical nudge'),
            subtitle: _('Negative moves icons up, positive moves them down'),
            lower: -10,
            upper: 10,
        }));

        const indicator = new Adw.PreferencesGroup({
            title: _('Running indicator'),
            description: _('The mark drawn beneath an icon that has windows open.'),
        });
        this.add(indicator);
        indicator.add(this._indicatorStyleRow());

        indicator.add(this._spinRow('indicator-thickness', {
            title: _('Thickness'),
            subtitle: _('Height of the bar, or radius of the dot'),
            lower: 1,
            upper: 6,
        }));

        indicator.add(this._spinRow('indicator-bottom-margin', {
            title: _('Distance from bottom'),
            subtitle: _('Gap between the indicator and the panel edge'),
            lower: 0,
            upper: 12,
        }));

        const badge = new Adw.PreferencesGroup({
            title: _('Window count'),
        });
        this.add(badge);

        const badgeRow = new Adw.SwitchRow({
            title: _('Show window count badge'),
            subtitle: _('Number of open windows on top of an icon that has more than one'),
        });
        this._settings.bind('show-window-count', badgeRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        badge.add(badgeRow);

        const reset = new Adw.PreferencesGroup();
        this.add(reset);
        reset.add(this._resetRow());
    }

    _onSettingChanged(key, callback) {
        this._settingsIds.push(
            this._settings.connect(`changed::${key}`, callback));
    }

    disconnectSettings() {
        this._settingsIds.forEach(id => this._settings.disconnect(id));
        this._settingsIds = [];
    }

    _spinRow(key, {title, subtitle, lower, upper}) {
        const row = new Adw.SpinRow({
            title,
            subtitle,
            adjustment: new Gtk.Adjustment({
                lower,
                upper,
                step_increment: 1,
                page_increment: 2,
            }),
        });

        this._settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    // ComboRow can't bind to an enum key.
    _indicatorStyleRow() {
        const row = new Adw.ComboRow({
            title: _('Style'),
            model: Gtk.StringList.new([_('Bar'), _('Dot'), _('None')]),
            selected: Math.max(0, INDICATOR_STYLES.indexOf(
                this._settings.get_string('indicator-style'))),
        });

        row.connect('notify::selected', () =>
            this._settings.set_string('indicator-style',
                INDICATOR_STYLES[row.get_selected()]));

        this._onSettingChanged('indicator-style', () => {
            const index = INDICATOR_STYLES.indexOf(
                this._settings.get_string('indicator-style'));
            if (index >= 0 && index !== row.get_selected())
                row.set_selected(index);
        });

        return row;
    }

    _resetRow() {
        const button = new Gtk.Button({
            label: _('Reset'),
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action'],
        });

        button.connect('clicked', () => {
            for (const key of this._settings.list_keys())
                this._settings.reset(key);
        });

        const row = new Adw.ActionRow({
            title: _('Reset all settings'),
            subtitle: _('Restore every value on both pages to its default'),
        });
        row.add_suffix(button);
        row.activatable_widget = button;
        return row;
    }
});
