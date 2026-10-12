// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

// A preferences page with rows bound to settings keys. Call
// disconnectSettings() when the window closes, since settings handlers
// keep the page alive.
export const SettingsPage = GObject.registerClass(
class AppBarSettingsPage extends Adw.PreferencesPage {
    _init(settings, params) {
        super._init(params);

        this._settings = settings;
        this._settingsIds = [];
    }

    onSettingChanged(key, callback) {
        this._settingsIds.push(
            this._settings.connect(`changed::${key}`, callback));
    }

    disconnectSettings() {
        this._settingsIds.forEach(id => this._settings.disconnect(id));
        this._settingsIds = [];
    }

    // GObject rejects an undefined property, so subtitles default to ''.
    switchRow(key, {title, subtitle = ''}) {
        const row = new Adw.SwitchRow({title, subtitle});
        this._settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    spinRow(key, {title, subtitle = '', lower, upper, step = 1}) {
        const row = new Adw.SpinRow({
            title,
            subtitle,
            adjustment: new Gtk.Adjustment({
                lower,
                upper,
                step_increment: step,
                page_increment: step * 2,
            }),
        });
        this._settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    // Exclusive buttons for an enum key, bound by nick. Each toggle's
    // name is a nick. The HIG prefers these to a drop-down for two or three
    // short choices.
    toggleGroup(key, toggles) {
        const group = new Adw.ToggleGroup({
            homogeneous: true,
            valign: Gtk.Align.CENTER,
        });
        toggles.forEach(toggle => group.add(toggle));
        this._settings.bind(key, group, 'active-name',
            Gio.SettingsBindFlags.DEFAULT);
        return group;
    }

    // A row with a toggle group at the end. `labels` follow `nicks`.
    toggleRow(key, nicks, {title, subtitle = '', labels}) {
        const row = new Adw.ActionRow({title, subtitle});
        row.add_suffix(this.toggleGroup(key, nicks.map((name, i) =>
            new Adw.Toggle({name, label: labels[i]}))));
        return row;
    }

    // Shows `toast` in the preferences window.
    showToast(toast) {
        this.get_root()?.add_toast(toast);
    }

    // ComboRow can't bind to an enum key. `nicks` must follow the order of
    // `labels`.
    comboRow(key, nicks, {title, subtitle = '', labels}) {
        const row = new Adw.ComboRow({
            title,
            subtitle,
            model: Gtk.StringList.new(labels),
            selected: Math.max(0, nicks.indexOf(this._settings.get_string(key))),
        });

        row.connect('notify::selected', () =>
            this._settings.set_string(key, nicks[row.get_selected()]));

        this.onSettingChanged(key, () => {
            const index = nicks.indexOf(this._settings.get_string(key));
            if (index >= 0 && index !== row.get_selected())
                row.set_selected(index);
        });

        return row;
    }
});
