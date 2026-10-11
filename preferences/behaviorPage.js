// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import * as HiddenApps from '../hiddenApps.js';

// Index order must match the enum nicks in the gschema.
const PANEL_POSITIONS = ['far-left', 'left', 'center', 'right'];
const GROUPING_MODES = ['grouped', 'ungrouped'];

export const BehaviorPage = GObject.registerClass(
class AppBarBehaviorPage extends Adw.PreferencesPage {
    _init(settings) {
        super._init({
            title: _('Behavior'),
            icon_name: 'preferences-system-symbolic',
        });

        this._settings = settings;
        this._settingsIds = [];

        const apps = new Adw.PreferencesGroup({
            title: _('Which apps to show'),
        });
        this.add(apps);

        apps.add(this._switchRow('show-favorites', {
            title: _('Show pinned apps'),
            subtitle: _('Keep favourites on the panel even when they are closed'),
        }));

        apps.add(this._switchRow('isolate-workspaces', {
            title: _('Current workspace only'),
            subtitle: _('Hide apps whose windows are all on another workspace'),
        }));

        apps.add(this._comboRow('group-windows', GROUPING_MODES, {
            title: _('Window grouping'),
            subtitle: _('Drag an icon to reorder pinned apps in either mode'),
            labels: [_('One icon per app'), _('One icon per window')],
        }));

        this._hiddenGroup = new Adw.PreferencesGroup({
            title: _('Hidden apps'),
            description: _('Never shown on the panel, even while running. Right-click an icon on the panel to hide its app.'),
        });
        this.add(this._hiddenGroup);
        this._hiddenRows = [];
        this._fillHiddenApps();
        this._onSettingChanged(HiddenApps.KEY, () => this._fillHiddenApps());

        const position = new Adw.PreferencesGroup({
            title: _('Position'),
        });
        this.add(position);

        position.add(this._comboRow('panel-position', PANEL_POSITIONS, {
            title: _('Place in the panel'),
            subtitle: _('Where the taskbar sits in the top panel'),
            labels: [
                _('Far left'),
                _('Left, after the workspace pill'),
                _('Center'),
                _('Right, before the status area'),
            ],
        }));

        const keyboard = new Adw.PreferencesGroup({
            title: _('Keyboard'),
        });
        this.add(keyboard);

        keyboard.add(this._switchRow('hotkeys', {
            title: _('Super+number activates icons'),
            subtitle: _('Super+1 to Super+9 open the icon in that position, instead of the Nth favorite in the dash'),
        }));

        const previews = new Adw.PreferencesGroup({
            title: _('Hover previews'),
            description: _('Click a thumbnail to focus its window, middle-click to close it.'),
        });
        this.add(previews);

        previews.add(this._switchRow('show-previews', {
            title: _('Show window previews'),
            subtitle: _('Live thumbnails on hover instead of the text tooltip'),
        }));

        const size = this._spinRow('preview-size', {
            title: _('Preview width'),
            subtitle: _('Largest width of one thumbnail in pixels'),
            lower: 120,
            upper: 320,
            step: 20,
        });
        this._settings.bind('show-previews', size, 'sensitive',
            Gio.SettingsBindFlags.GET);
        previews.add(size);
    }

    _onSettingChanged(key, callback) {
        this._settingsIds.push(
            this._settings.connect(`changed::${key}`, callback));
    }

    disconnectSettings() {
        this._settingsIds.forEach(id => this._settings.disconnect(id));
        this._settingsIds = [];
    }

    _fillHiddenApps() {
        for (const row of this._hiddenRows)
            this._hiddenGroup.remove(row);

        const ids = [...HiddenApps.get(this._settings)];
        this._hiddenRows = ids.length > 0
            ? ids.map(id => this._hiddenAppRow(id))
            : [new Adw.ActionRow({
                title: _('No hidden apps'),
                subtitle: _('Right-click an icon on the panel and choose Hide from App Bar'),
                sensitive: false,
            })];

        for (const row of this._hiddenRows)
            this._hiddenGroup.add(row);
    }

    _hiddenAppRow(id) {
        // Null for an uninstalled app; the row stays so the id can be removed.
        const info = Gio.DesktopAppInfo.new(id);
        const row = new Adw.ActionRow({
            title: info?.get_display_name() ?? id,
            subtitle: info ? id : _('Not installed'),
            // Names may contain '&'.
            use_markup: false,
        });

        if (info?.get_icon())
            row.add_prefix(new Gtk.Image({gicon: info.get_icon(), pixel_size: 32}));

        const unhide = new Gtk.Button({
            label: _('Unhide'),
            valign: Gtk.Align.CENTER,
        });
        unhide.connect('clicked', () => HiddenApps.remove(this._settings, id));
        row.add_suffix(unhide);
        row.activatable_widget = unhide;
        return row;
    }

    _switchRow(key, {title, subtitle}) {
        const row = new Adw.SwitchRow({title, subtitle});
        this._settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    _spinRow(key, {title, subtitle, lower, upper, step}) {
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

    // ComboRow can't bind to an enum key.
    _comboRow(key, nicks, {title, subtitle, labels}) {
        const row = new Adw.ComboRow({
            title,
            subtitle,
            model: Gtk.StringList.new(labels),
            selected: Math.max(0, nicks.indexOf(this._settings.get_string(key))),
        });

        row.connect('notify::selected', () =>
            this._settings.set_string(key, nicks[row.get_selected()]));

        this._onSettingChanged(key, () => {
            const index = nicks.indexOf(this._settings.get_string(key));
            if (index >= 0 && index !== row.get_selected())
                row.set_selected(index);
        });

        return row;
    }
});
