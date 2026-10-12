// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import * as HiddenApps from '../hiddenApps.js';
import {SettingsPage} from './settingsPage.js';

// Nick order must match the labels passed with them.
const GROUPING_MODES = ['grouped', 'ungrouped'];

export const BehaviorPage = GObject.registerClass(
class AppBarBehaviorPage extends SettingsPage {
    _init(settings) {
        super._init(settings, {
            title: _('Behavior'),
            icon_name: 'preferences-system-symbolic',
        });

        const apps = new Adw.PreferencesGroup({
            title: _('Apps'),
            description: _('Drag an icon on the panel to reorder pinned apps'),
        });
        this.add(apps);

        apps.add(this.switchRow('show-favorites', {
            title: _('Show Pinned Apps'),
            subtitle: _('Keep favourites on the panel even when they are closed'),
        }));

        apps.add(this.switchRow('isolate-workspaces', {
            title: _('Current Workspace Only'),
            subtitle: _('Hide apps whose windows are all on another workspace'),
        }));

        apps.add(this.toggleRow('group-windows', GROUPING_MODES, {
            title: _('Icons'),
            subtitle: _('One for each app, or one for each window'),
            labels: [_('Per App'), _('Per Window')],
        }));

        this._hiddenGroup = new Adw.PreferencesGroup({
            title: _('Hidden Apps'),
            description: _('Never shown on the panel, even while running'),
        });
        this.add(this._hiddenGroup);
        this._hiddenRows = [];
        this._fillHiddenApps();
        this.onSettingChanged(HiddenApps.KEY, () => this._fillHiddenApps());

        const keyboard = new Adw.PreferencesGroup({
            title: _('Keyboard'),
            description: _('Ctrl+Alt+Tab moves focus to the panel. Arrow keys move between icons, and the Menu key opens the focused icon’s menu'),
        });
        this.add(keyboard);

        keyboard.add(this.switchRow('hotkeys', {
            title: _('Activate Icons With Super+Number'),
            subtitle: _('Super+1 to Super+9 open the icon in that position, instead of the nth favourite in the dash'),
        }));

        const previews = new Adw.PreferencesGroup({
            title: _('Hover Previews'),
            description: _('Click a thumbnail to focus its window. Its close button or a middle-click closes it'),
        });
        this.add(previews);

        previews.add(this.switchRow('show-previews', {
            title: _('Window Previews'),
            subtitle: _('Live thumbnails on hover instead of the text tooltip'),
        }));

        const size = this.spinRow('preview-size', {
            title: _('Preview Width'),
            subtitle: _('Largest width of one thumbnail in pixels'),
            lower: 120,
            upper: 320,
            step: 20,
        });
        this._settings.bind('show-previews', size, 'sensitive',
            Gio.SettingsBindFlags.GET);
        previews.add(size);
    }

    _fillHiddenApps() {
        for (const row of this._hiddenRows)
            this._hiddenGroup.remove(row);

        const ids = [...HiddenApps.get(this._settings)];
        this._hiddenRows = ids.length > 0
            ? ids.map(id => this._hiddenAppRow(id))
            : [new Adw.ActionRow({
                title: _('No Hidden Apps'),
                subtitle: _('Right-click an icon on the panel and choose Hide from App Bar'),
                sensitive: false,
            })];

        for (const row of this._hiddenRows)
            this._hiddenGroup.add(row);
    }

    _hiddenAppRow(id) {
        // Null for an uninstalled app; the row stays so the id can be removed.
        const info = GioUnix.DesktopAppInfo.new(id);
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
});
