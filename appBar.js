// SPDX-License-Identifier: GPL-3.0-or-later

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Appearance} from './appearance.js';
import {AppButton, taskbarWindows} from './appButton.js';
import * as HiddenApps from './hiddenApps.js';
import {PreviewPopup, positionBelow} from './previews.js';

// APPBAR_DEBUG=1 logs every rebuild.
const DEBUG = GLib.getenv('APPBAR_DEBUG') !== null;

const HOVER_DELAY = 450;
const TOOLTIP_FADE = 120;

// Time for the pointer to move from a button into its preview.
const HOVER_GRACE = 300;

export const AppBar = GObject.registerClass(
class AppBarPanelButton extends PanelMenu.Button {
    _init(settings) {
        super._init(0.0, 'AppBar', true);

        this._settings = settings;
        this._appearance = new Appearance(settings);
        this._loadSettings();

        this.remove_style_class_name('panel-button');
        this.add_style_class_name('appbar-panel-button');
        this.reactive = false;
        this.track_hover = false;
        this.can_focus = false;

        // Drops land on the bar, so the gaps between icons accept them too.
        this._delegate = this;

        this._box = new St.BoxLayout({
            style_class: 'appbar-box',
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.FILL,
            y_expand: true,
        });
        this.add_child(this._box);

        this._buttons = new Map();
        this._trackedWindows = new Set();

        // get_running() leaves out apps in the STARTING state. Maps each one
        // to whether it has shown a window since its launch began.
        this._startingApps = new Map();

        // Signal bursts collapse into one pass before the next frame.
        this._laters = global.compositor.get_laters();
        this._syncId = 0;
        this._restyleId = 0;

        // Rebuilds wait until a drag ends.
        this._syncFrozen = false;
        this._pendingSync = false;
        this._dragMonitor = null;
        this._dragPlaceholder = null;
        this._dragSlot = -1;

        this._tooltip = null;
        this._preview = null;
        this._hideNotification = null;
        this._hoverSource = null;
        this._hoverTimeoutId = 0;
        this._hoverHideId = 0;

        this._appSystem = Shell.AppSystem.get_default();
        this._appFavorites = AppFavorites.getAppFavorites();
        this._windowTracker = Shell.WindowTracker.get_default();

        this._appSystem.connectObject(
            'app-state-changed', (_appSystem, app) => this._onAppStateChanged(app),
            'installed-changed', () => this.queueSync(),
            this);

        this._appFavorites.connectObject(
            'changed', () => this.queueSync(), this);

        this._appearance.connectObject(
            'changed', () => this._queueRestyle(), this);

        const reload = () => {
            this._loadSettings();
            this.queueSync();
        };
        this._settings.connectObject(
            'changed::show-favorites', reload,
            'changed::isolate-workspaces', reload,
            'changed::group-windows', reload,
            `changed::${HiddenApps.KEY}`, reload,
            'changed::show-previews', () => this._onPreviewsToggled(),
            this);

        this._windowTracker.connectObject(
            'notify::focus-app', () => this._queueRestyle(), this);

        global.display.connectObject(
            'notify::focus-window', () => this._queueRestyle(),
            'window-created', (_display, window) => this._onWindowCreated(window),
            this);

        global.workspace_manager.connectObject(
            'active-workspace-changed', () => this.queueSync(),
            'workspaces-reordered', () => this.queueSync(),
            this);

        // Moving a window between workspaces emits no app signal, so each
        // window is watched. Apps already launching can only be found here,
        // through their windows.
        for (const window of global.display.list_all_windows()) {
            this._trackWindow(window);
            const app = this._windowTracker.get_window_app(window);
            if (app?.state === Shell.AppState.STARTING)
                this._watchLaunch(app);
        }

        this.connect('destroy', () => this._onTaskbarDestroy());

        this._sync();
    }

    // Rebuilds run often and read these for every app, so they are cached.
    _loadSettings() {
        this._grouped =
            this._settings.get_string('group-windows') !== 'ungrouped';
        this._showFavorites = this._settings.get_boolean('show-favorites');
        this._isolateWorkspaces =
            this._settings.get_boolean('isolate-workspaces');
        this._showPreviews = this._settings.get_boolean('show-previews');
        this._hidden = HiddenApps.get(this._settings);
    }

    get isolateWorkspaces() {
        return this._isolateWorkspaces;
    }

    // Favorites first, then running apps in order of their oldest window.
    // Hidden apps are left out, even when pinned.
    _desiredEntries() {
        const grouped = this._grouped;
        const favorites = this._showFavorites
            ? this._appFavorites.getFavorites() : [];
        const favoriteIds = new Set(favorites.map(app => app.get_id()));
        const hidden = this._hidden;
        const workspace = global.workspace_manager.get_active_workspace();

        const entries = [];
        for (const app of favorites) {
            if (!hidden.has(app.get_id()))
                this._pushEntries(entries, app, grouped, null);
        }

        // Sort keys are computed once per app; get_windows() copies the list.
        const running = [];
        for (const app of this._runningApps()) {
            const id = app.get_id();
            if (favoriteIds.has(id) || hidden.has(id))
                continue;

            const windows = taskbarWindows(app);
            const visible = this._isolateWorkspaces
                ? windows.filter(w => w.located_on_workspace(workspace))
                : windows;

            if (visible.length > 0 || this.isLaunching(app, windows))
                running.push({app, visible, sequence: lowestSequence(windows)});
        }

        running.sort((a, b) => a.sequence - b.sequence);

        for (const {app, visible} of running)
            this._pushEntries(entries, app, grouped, visible);

        return entries;
    }

    // An app launched with startup notification stays STARTING until the
    // launch completes. Firefox can sit there for seconds with its window
    // already on screen, so STARTING apps are added here.
    _runningApps() {
        return [...this._appSystem.get_running(), ...this._startingApps.keys()];
    }

    // `windows` is the app's taskbarWindows(). An app that closes its
    // windows before its launch completes is still STARTING, but closing.
    // Splash screens are skip-taskbar, so they don't end a launch.
    isLaunching(app, windows) {
        return windows.length === 0 && this._startingApps.get(app) === false;
    }

    _onAppStateChanged(app) {
        if (app.state === Shell.AppState.STARTING)
            this._watchLaunch(app);
        else
            this._unwatchLaunch(app);

        this.queueSync();
    }

    _watchLaunch(app) {
        if (this._startingApps.has(app))
            return;

        // A window arriving on a STARTING app does not change its state.
        this._startingApps.set(app, taskbarWindows(app).length > 0);
        app.connectObject('windows-changed', () => {
            if (taskbarWindows(app).length > 0)
                this._startingApps.set(app, true);
            this.queueSync();
        }, this);
    }

    _unwatchLaunch(app) {
        if (this._startingApps.delete(app))
            app.disconnectObject(this);
    }

    // `windows` is null for favorites and only computed in ungrouped mode.
    _pushEntries(entries, app, grouped, windows) {
        const id = app.get_id();
        if (grouped) {
            entries.push({id, app, windowSequence: null});
            return;
        }

        windows ??= this._visibleWindows(app);
        if (windows.length === 0) {
            entries.push({id, app, windowSequence: null});
            return;
        }

        const ordered = [...windows].sort(
            (a, b) => a.get_stable_sequence() - b.get_stable_sequence());
        for (const window of ordered) {
            const sequence = window.get_stable_sequence();
            entries.push({id: `${id}:${sequence}`, app, windowSequence: sequence});
        }
    }

    _visibleWindows(app) {
        const windows = taskbarWindows(app);
        if (!this._isolateWorkspaces)
            return windows;

        const workspace = global.workspace_manager.get_active_workspace();
        return windows.filter(w => w.located_on_workspace(workspace));
    }

    hideApp(app) {
        const id = app.get_id();
        HiddenApps.add(this._settings, id);

        const source = MessageTray.getSystemSource();
        const notification = new MessageTray.Notification({
            source,
            title: _('%s has been hidden from the App Bar').format(app.get_name()),
            body: _('The Behavior page of the extension preferences lists hidden apps.'),
            isTransient: true,
        });
        notification.addAction(_('Undo'),
            () => HiddenApps.remove(this._settings, id));

        // Undo uses this bar's settings, so the notification must not
        // outlive the bar.
        this._hideNotification?.destroy();
        this._hideNotification = notification;
        notification.connect('destroy', () => {
            if (this._hideNotification === notification)
                this._hideNotification = null;
        });

        source.addNotification(notification);
    }

    queueSync() {
        if (this._syncFrozen) {
            this._pendingSync = true;
            return;
        }

        if (this._syncId)
            return;

        // A rebuild restyles every button anyway.
        this._removeRestyle();

        this._syncId = this._laters.add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._syncId = 0;
            this._sync();
            return GLib.SOURCE_REMOVE;
        });
    }

    _queueRestyle() {
        if (this._restyleId || this._syncId)
            return;

        this._restyleId = this._laters.add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._restyleId = 0;
            this._syncButtonStates();
            return GLib.SOURCE_REMOVE;
        });
    }

    _removeRestyle() {
        if (!this._restyleId)
            return;

        this._laters.remove(this._restyleId);
        this._restyleId = 0;
    }

    _sync() {
        const desired = this._desiredEntries();
        const kept = new Set(desired.map(entry => entry.id));

        // In ungrouped mode an app's entry id changes when its first window
        // opens or its last one closes. Reusing the outgoing button for the
        // same app avoids a second fade-in.
        const spare = new Map();
        for (const [id, button] of this._buttons) {
            if (kept.has(id))
                continue;
            const list = spare.get(button.app) ?? [];
            list.push(id);
            spare.set(button.app, list);
        }

        desired.forEach((entry, index) => {
            let button = this._buttons.get(entry.id);
            const spareId = button ? null : spare.get(entry.app)?.pop();
            if (spareId) {
                button = this._buttons.get(spareId);
                this._buttons.delete(spareId);
                this._buttons.set(entry.id, button);
                button.setWindowSequence(entry.windowSequence);
            }

            if (button) {
                if (this._box.get_child_at_index(index) !== button)
                    this._box.set_child_at_index(button, index);
            } else {
                button = new AppButton(entry, this, this._appearance);
                this._buttons.set(entry.id, button);
                this._box.insert_child_at_index(button, index);
                button.animateIn();
            }
            button.sync();
        });

        for (const [id, button] of [...this._buttons]) {
            if (kept.has(id))
                continue;
            this._buttons.delete(id);
            this.forgetHover(button);
            button.destroy();
        }

        this.visible = this._buttons.size > 0;

        const previewSource = this._preview?.visible
            ? this._preview.sourceButton : null;
        if (previewSource) {
            const windows = previewSource.getWindows();
            if (windows.length > 0)
                this._preview.present(previewSource, windows);
            else
                this._preview.dismiss();
        }

        if (DEBUG)
            this._logState();
    }

    _logState() {
        // Box order, not Map order: a drag reorders only the box.
        const summary = this._box.get_children()
            .filter(child => child !== this._dragPlaceholder)
            .map(button => {
                const windows = button.getWindows().length;
                return `${button.app.get_id()}[${windows}]`;
            });
        console.debug(`appbar: ${summary.length} buttons: ${summary.join(' ')}`);
    }

    _syncButtonStates() {
        this._buttons.forEach(button => button.sync());

        if (DEBUG)
            console.debug(`appbar: restyled ${this._buttons.size} buttons`);
    }

    activateNth(index) {
        const button = this._box.get_children()
            .filter(child => child instanceof AppButton && child.visible)[index];
        if (!button)
            return false;

        button.activateFromShortcut();
        return true;
    }

    // Also covers a running app whose button is missing because its other
    // windows are on another workspace.
    _onWindowCreated(window) {
        this._trackWindow(window);
        this.queueSync();
    }

    _trackWindow(window) {
        if (this._trackedWindows.has(window))
            return;

        this._trackedWindows.add(window);
        window.connectObject(
            'workspace-changed', () => this.queueSync(),
            'notify::skip-taskbar', () => this.queueSync(),
            'notify::title', () => this._onWindowTitleChanged(),
            'notify::demands-attention', () => this._queueRestyle(),
            'notify::urgent', () => this._queueRestyle(),
            'unmanaged', () => this._untrackWindow(window),
            this);
    }

    _untrackWindow(window) {
        if (!this._trackedWindows.delete(window))
            return;

        window.disconnectObject(this);
        this.queueSync();
    }

    showHover(button) {
        this._hoverSource = button;
        this._removeHoverTimeout();
        this._cancelHoverHide();

        // With a popup already up, move it to the new button at once.
        if (this._preview?.visible || this._tooltip?.visible) {
            this._presentHover();
            return;
        }

        this._hoverTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, HOVER_DELAY, () => {
                this._hoverTimeoutId = 0;
                this._presentHover();
                return GLib.SOURCE_REMOVE;
            });
    }

    // A null `button` hides whatever is up. `immediate` skips HOVER_GRACE.
    hideHover(button, immediate = false) {
        if (button && this._hoverSource !== button)
            return;

        this._removeHoverTimeout();
        this._hoverSource = null;
        this._tooltip?.hide();

        if (!this._preview?.visible)
            return;

        if (immediate)
            this._preview.dismiss();
        else
            this._scheduleHoverHide();
    }

    _presentHover() {
        const button = this._hoverSource;
        if (!button)
            return;

        const windows = button.getWindows();
        if (windows.length > 0 && this._showPreviews) {
            this._tooltip?.hide();
            this._ensurePreview().present(button, windows);
        } else {
            this._preview?.dismiss();
            this._presentTooltip(button.getTooltipText());
        }
    }

    _ensurePreview() {
        if (this._preview)
            return this._preview;

        this._preview = new PreviewPopup(this._settings);
        this._preview.connect('notify::hover', () => {
            if (!this._preview.visible)
                return;
            if (this._preview.hover)
                this._cancelHoverHide();
            else if (!this._hoverSource)
                this._scheduleHoverHide();
        });
        return this._preview;
    }

    _presentTooltip(text) {
        if (!this._hoverSource)
            return;

        if (!this._tooltip) {
            // Not reactive, so it stays out of the input region.
            this._tooltip = new St.Label({style_class: 'appbar-tooltip'});
            this._tooltip.hide();
            Main.layoutManager.addTopChrome(this._tooltip);
        }

        this._tooltip.text = text;
        this._tooltip.opacity = 0;
        this._tooltip.show();
        positionBelow(this._tooltip, this._hoverSource);
        this._tooltip.ease({
            opacity: 255,
            duration: TOOLTIP_FADE,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _onWindowTitleChanged() {
        if (this._tooltip?.visible && this._hoverSource) {
            this._tooltip.text = this._hoverSource.getTooltipText();
            positionBelow(this._tooltip, this._hoverSource);
        }
        this._preview?.refreshTitles();
    }

    forgetHover(button) {
        if (this._hoverSource === button) {
            this._removeHoverTimeout();
            this._hoverSource = null;
            this._tooltip?.hide();
        }
        if (this._preview?.sourceButton === button)
            this._preview.dismiss();
    }

    _scheduleHoverHide() {
        this._cancelHoverHide();
        this._hoverHideId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, HOVER_GRACE, () => {
                this._hoverHideId = 0;
                if (this._preview && !this._preview.hover)
                    this._preview.dismiss();
                return GLib.SOURCE_REMOVE;
            });
    }

    _cancelHoverHide() {
        if (!this._hoverHideId)
            return;

        GLib.Source.remove(this._hoverHideId);
        this._hoverHideId = 0;
    }

    _removeHoverTimeout() {
        if (!this._hoverTimeoutId)
            return;

        GLib.Source.remove(this._hoverTimeoutId);
        this._hoverTimeoutId = 0;
    }

    _onPreviewsToggled() {
        this._showPreviews = this._settings.get_boolean('show-previews');
        if (!this._showPreviews)
            this._preview?.dismiss();
    }

    onDragBegin(button) {
        this.hideHover(null, true);

        this._syncFrozen = true;

        // The placeholder marks the slot instead.
        button.hide();

        this._dragMonitor = {dragMotion: event => this._onDragMotion(event)};
        DND.addDragMonitor(this._dragMonitor);
    }

    onDragEnd(button) {
        if (this._dragMonitor) {
            DND.removeDragMonitor(this._dragMonitor);
            this._dragMonitor = null;
        }
        this._clearDragPlaceholder();
        button.show();

        this._syncFrozen = false;
        if (this._pendingSync) {
            this._pendingSync = false;
            this.queueSync();
        }
    }

    // handleDragOver is not called when the pointer leaves the bar.
    _onDragMotion(dragEvent) {
        if (!this.contains(dragEvent.targetActor))
            this._clearDragPlaceholder();
        return DND.DragMotionResult.CONTINUE;
    }

    handleDragOver(source, _actor, x, _y, _time) {
        if (!this._isOwnButton(source))
            return DND.DragMotionResult.CONTINUE;

        const [barX] = this.get_transformed_position();
        const {slot, buttons} = this._slotForX(barX + x);
        const info = this._dropInfoForSlot(slot, buttons, source.app);
        if (!info) {
            this._clearDragPlaceholder();
            return DND.DragMotionResult.NO_DROP;
        }

        this._setDragPlaceholder(info.slot, buttons, source);
        return this._appFavorites.isFavorite(source.app.get_id())
            ? DND.DragMotionResult.MOVE_DROP
            : DND.DragMotionResult.COPY_DROP;
    }

    acceptDrop(source, _actor, x, _y, _time) {
        // Use the slot the placeholder showed. Removing the placeholder
        // shifts later buttons, so a slot recomputed from x can be off by one.
        const shownSlot = this._dragPlaceholder ? this._dragSlot : -1;
        this._clearDragPlaceholder();
        if (!this._isOwnButton(source))
            return false;

        const {slot: pointerSlot, buttons} = this._slotForX(
            this.get_transformed_position()[0] + x);
        const slot = shownSlot >= 0 ? shownSlot : pointerSlot;
        const info = this._dropInfoForSlot(slot, buttons, source.app);
        if (!info)
            return false;

        const id = source.app.get_id();
        if (!this._appFavorites.isFavorite(id)) {
            this._appFavorites.addFavoriteAtPos(id, info.favoritesPos);
        } else if (this._appFavorites.getFavorites()[info.favoritesPos]
                       ?.get_id() !== id) {
            this._appFavorites.moveFavoriteToPos(id, info.favoritesPos);
        }
        return true;
    }

    _isOwnButton(source) {
        return source instanceof AppButton && source.get_parent() === this._box;
    }

    _slotForX(stageX) {
        const buttons = this._box.get_children()
            .filter(child => child !== this._dragPlaceholder && child.visible);

        let slot = buttons.length;
        for (let i = 0; i < buttons.length; i++) {
            const [buttonX] = buttons[i].get_transformed_position();
            const [buttonWidth] = buttons[i].get_transformed_size();
            if (stageX < buttonX + buttonWidth / 2) {
                slot = i;
                break;
            }
        }
        return {slot, buttons};
    }

    // Returns null when the slot cannot take the drop.
    _dropInfoForSlot(slot, buttons, sourceApp) {
        const isFavorite = app => this._appFavorites.isFavorite(app.get_id());

        // Only the favorites order can be saved, so only that part of the
        // bar accepts drops.
        let favoritesEnd = 0;
        while (favoritesEnd < buttons.length &&
               isFavorite(buttons[favoritesEnd].app))
            favoritesEnd++;
        if (slot > favoritesEnd)
            return null;

        // In ungrouped mode, don't drop between two windows of another app.
        const before = buttons[slot - 1];
        const after = buttons[slot];
        if (before && after && before.app === after.app &&
            before.app !== sourceApp)
            return null;

        // Distinct favorites before the slot, not counting the dragged app.
        const seen = new Set();
        for (let i = 0; i < slot; i++) {
            const id = buttons[i].app.get_id();
            if (id !== sourceApp.get_id())
                seen.add(id);
        }
        return {slot, favoritesPos: seen.size};
    }

    _setDragPlaceholder(slot, buttons, source) {
        if (this._dragPlaceholder && this._dragSlot === slot)
            return;

        if (!this._dragPlaceholder) {
            this._dragPlaceholder = new St.Widget({
                style_class: 'appbar-drag-placeholder',
                y_expand: true,
            });
            this._dragPlaceholder.set_width(source.width);
        } else {
            this._box.remove_child(this._dragPlaceholder);
        }

        // `slot` counts visible buttons; the box also holds the hidden
        // drag source.
        const children = this._box.get_children();
        const index = slot < buttons.length
            ? children.indexOf(buttons[slot])
            : children.length;
        this._box.insert_child_at_index(this._dragPlaceholder, index);
        this._dragSlot = slot;
    }

    _clearDragPlaceholder() {
        if (!this._dragPlaceholder)
            return;

        this._dragPlaceholder.destroy();
        this._dragPlaceholder = null;
        this._dragSlot = -1;
    }

    _onTaskbarDestroy() {
        this._removeHoverTimeout();
        this._cancelHoverHide();

        this._removeRestyle();

        if (this._syncId) {
            this._laters.remove(this._syncId);
            this._syncId = 0;
        }
        this._laters = null;

        if (this._dragMonitor) {
            DND.removeDragMonitor(this._dragMonitor);
            this._dragMonitor = null;
        }
        this._clearDragPlaceholder();

        this._trackedWindows.forEach(w => w.disconnectObject(this));
        this._trackedWindows.clear();
        for (const app of this._startingApps.keys())
            app.disconnectObject(this);
        this._startingApps.clear();

        this._appSystem.disconnectObject(this);
        this._appFavorites.disconnectObject(this);
        this._settings.disconnectObject(this);
        this._appearance.disconnectObject(this);
        this._appearance.destroy();
        this._appearance = null;
        this._settings = null;
        this._windowTracker.disconnectObject(this);
        global.display.disconnectObject(this);
        global.workspace_manager.disconnectObject(this);

        this._hideNotification?.destroy();
        this._hideNotification = null;

        if (this._tooltip) {
            Main.layoutManager.removeChrome(this._tooltip);
            this._tooltip.destroy();
            this._tooltip = null;
        }

        if (this._preview) {
            Main.layoutManager.removeChrome(this._preview);
            this._preview.destroy();
            this._preview = null;
        }

        this._buttons.clear();
        this._hoverSource = null;
    }
});

// Windows on every workspace count, so switching workspaces never reorders
// the icons.
function lowestSequence(windows) {
    return windows.reduce((lowest, w) => Math.min(lowest, w.get_stable_sequence()),
        Number.MAX_SAFE_INTEGER);
}
