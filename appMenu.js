// SPDX-License-Identifier: GPL-3.0-or-later

import St from 'gi://St';

import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

const MAX_TITLE_LENGTH = 44;

export class AppContextMenu extends PopupMenu.PopupMenu {
    constructor(appButton, appBar) {
        super(appButton, 0.5, St.Side.TOP);

        this._appButton = appButton;
        this._appBar = appBar;
    }

    rebuild() {
        this.removeAll();

        const {app} = this._appButton;
        const windows = this._appButton.getWindows();

        this._addWindowItems(windows);
        this._addActionItems(app);
        this._addPinItems(app);
        this._addCloseItems(windows);
    }

    _addWindowItems(windows) {
        if (windows.length === 0)
            return;

        for (const window of windows) {
            const item = new PopupMenu.PopupMenuItem(
                truncate(window.get_title() || this._appButton.app.get_name()));

            if (window === global.display.focus_window &&
                PopupMenu.Ornament?.DOT !== undefined)
                item.setOrnament(PopupMenu.Ornament.DOT);

            item.connect('activate', () => Main.activateWindow(window));
            this.addMenuItem(item);
        }

        this.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    }

    // As in the shell's app menu, a desktop file's own new-window action
    // replaces the generic New Window item.
    _addActionItems(app) {
        const appInfo = app.get_app_info();
        const actions = appInfo?.list_actions() ?? [];
        const items = [];

        if (app.can_open_new_window() && !actions.includes('new-window')) {
            const item = new PopupMenu.PopupMenuItem(_('New Window'));
            item.connect('activate', () => {
                Main.overview.hide();
                app.open_new_window(-1);
            });
            items.push(item);
        }

        for (const action of actions) {
            const item = new PopupMenu.PopupMenuItem(
                appInfo.get_action_name(action));
            item.connect('activate', () => {
                Main.overview.hide();
                app.launch_action(action, global.get_current_time(), -1);
            });
            items.push(item);
        }

        if (items.length === 0)
            return;

        items.forEach(item => this.addMenuItem(item));
        this.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    }

    _addPinItems(app) {
        const favorites = AppFavorites.getAppFavorites();
        const appId = app.get_id();
        const isPinned = favorites.isFavorite(appId);

        const item = new PopupMenu.PopupMenuItem(
            isPinned ? _('Unpin from Taskbar') : _('Pin to Taskbar'));
        item.connect('activate', () => {
            if (isPinned)
                favorites.removeFavorite(appId);
            else
                favorites.addFavorite(appId);
        });
        this.addMenuItem(item);

        // A window-backed app's id changes every launch, so it can't be hidden.
        if (app.get_app_info()) {
            const hide = new PopupMenu.PopupMenuItem(_('Hide from App Bar'));
            hide.connect('activate', () => this._appBar.hideApp(app));
            this.addMenuItem(hide);
        }
    }

    _addCloseItems(windows) {
        if (windows.length === 0)
            return;

        this.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        if (windows.some(w => !w.minimized)) {
            const item = new PopupMenu.PopupMenuItem(
                windows.length > 1 ? _('Minimize All') : _('Minimize'));
            item.connect('activate', () => windows.forEach(w => w.minimize()));
            this.addMenuItem(item);
        }

        const close = new PopupMenu.PopupMenuItem(
            windows.length > 1 ? _('Close All') : _('Close'));
        close.connect('activate', () => {
            const time = global.get_current_time();
            windows.forEach(w => w.delete(time));
        });
        this.addMenuItem(close);
    }
}

function truncate(text) {
    return text.length > MAX_TITLE_LENGTH
        ? `${text.substring(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`
        : text;
}
