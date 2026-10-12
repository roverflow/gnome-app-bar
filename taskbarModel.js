// SPDX-License-Identifier: GPL-3.0-or-later

import GObject from 'gi://GObject';
import Shell from 'gi://Shell';

import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';

import * as HiddenApps from './hiddenApps.js';

// The windows the bar counts for `app`: not skip-taskbar, and for an app
// with no .desktop file, not a helper surface.
function taskbarWindows(app) {
    const windows = app.get_windows().filter(w => !w.is_skip_taskbar());
    if (app.get_app_info() !== null)
        return windows;
    return windows.filter(w => !isHelperSurface(w));
}

// A window with no WM class or app id, or at most 1px across, is a helper
// rather than an app. wl-copy and wl-paste map a 1x1 window for a moment to
// reach the clipboard on GNOME, which is how Wispr Flow pastes. The shell
// gives each one a throwaway window-backed app.
function isHelperSurface(window) {
    if (!window.get_wm_class())
        return true;

    const {width, height} = window.get_frame_rect();
    return width <= 1 || height <= 1;
}

// Decides which icons exist, in what order, and which windows each one
// stands for. It holds no actors, so it survives a switch between layouts.
//
// Signals fire once per shell event and can come in bursts, so listeners
// should coalesce them.
export const TaskbarModel = GObject.registerClass({
    Signals: {
        // The entries may differ; call entries() again.
        'entries-changed': {},
        // Focus or attention moved. The entries are the same.
        'state-changed': {},
        'titles-changed': {},
    },
}, class AppBarTaskbarModel extends GObject.Object {
    _init(settings) {
        super._init();

        this._settings = settings;
        this._loadSettings();

        this._appSystem = Shell.AppSystem.get_default();
        this._appFavorites = AppFavorites.getAppFavorites();
        this._windowTracker = Shell.WindowTracker.get_default();

        // Moving a window between workspaces emits no app signal, so each
        // window is watched.
        this._trackedWindows = new Set();

        // Tracked windows that look like helper surfaces, rechecked as they
        // resize or gain an app id.
        this._helperWindows = new Set();

        // Apps that are not stopped, watched for windows-changed.
        this._watchedApps = new Set();

        // get_running() leaves out apps in the STARTING state. Maps each one
        // to whether it has shown a window since its launch began.
        this._startingApps = new Map();

        const changed = () => this.emit('entries-changed');
        const restyle = () => this.emit('state-changed');

        this._appSystem.connectObject(
            'app-state-changed', (_appSystem, app) => this._onAppStateChanged(app),
            'installed-changed', changed,
            this);

        this._appFavorites.connectObject('changed', changed, this);

        const reload = () => {
            this._loadSettings();
            changed();
        };
        this._settings.connectObject(
            'changed::show-favorites', reload,
            'changed::isolate-workspaces', reload,
            'changed::group-windows', reload,
            `changed::${HiddenApps.KEY}`, reload,
            this);

        this._windowTracker.connectObject('notify::focus-app', restyle, this);

        global.display.connectObject(
            'notify::focus-window', restyle,
            'window-created', (_display, window) => {
                this._trackWindow(window);
                changed();
            },
            this);

        global.workspace_manager.connectObject(
            'active-workspace-changed', changed,
            'workspaces-reordered', changed,
            this);

        for (const app of this._appSystem.get_running())
            this._watchApp(app);

        // Apps already launching can only be found through their windows.
        for (const window of global.display.list_all_windows()) {
            this._trackWindow(window);
            const app = this._windowTracker.get_window_app(window);
            if (app && app.state !== Shell.AppState.STOPPED)
                this._onAppStateChanged(app, false);
        }
    }

    // entries() runs on every rebuild and reads these for every app.
    _loadSettings() {
        this._grouped =
            this._settings.get_string('group-windows') !== 'ungrouped';
        this._showFavorites = this._settings.get_boolean('show-favorites');
        this._isolateWorkspaces =
            this._settings.get_boolean('isolate-workspaces');
        this._hidden = HiddenApps.get(this._settings);
    }

    // One {id, app, windowSequence} per icon. windowSequence is null when
    // the icon stands for the whole app, or the stable sequence of its one
    // window in ungrouped mode.
    //
    // Favorites come first, then running apps in order of their oldest
    // window. Hidden apps are left out, even when pinned.
    entries() {
        const favorites = this._showFavorites
            ? this._appFavorites.getFavorites() : [];
        const favoriteIds = new Set(favorites.map(app => app.get_id()));
        const hidden = this._hidden;
        const workspace = global.workspace_manager.get_active_workspace();

        const entries = [];
        for (const app of favorites) {
            if (!hidden.has(app.get_id()))
                this._pushEntries(entries, app, null);
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

            if (visible.length > 0 || this._isLaunching(app, windows))
                running.push({app, visible, sequence: lowestSequence(windows)});
        }

        running.sort((a, b) => a.sequence - b.sequence);

        for (const {app, visible} of running)
            this._pushEntries(entries, app, visible);

        return entries;
    }

    // The windows an entry's icon stands for: the app's windows on this
    // workspace (or all of them), or its one window in ungrouped mode.
    windowsFor(app, windowSequence) {
        const windows = taskbarWindows(app);
        if (windowSequence !== null)
            return windows.filter(w => w.get_stable_sequence() === windowSequence);

        return this._onActiveWorkspace(windows);
    }

    // An app launched with startup notification stays STARTING until the
    // launch completes. Splash screens are skip-taskbar, so they don't end
    // a launch.
    isLaunching(app) {
        // Most apps are not starting, so skip copying their window list.
        return this._startingApps.has(app) &&
            this._isLaunching(app, taskbarWindows(app));
    }

    // `windows` is the app's taskbarWindows(). An app that closes its
    // windows before its launch completes is still STARTING, but closing.
    _isLaunching(app, windows) {
        return windows.length === 0 && this._startingApps.get(app) === false;
    }

    // Firefox can sit in STARTING for seconds with its window already on
    // screen, so STARTING apps are added here.
    _runningApps() {
        return [...this._appSystem.get_running(), ...this._startingApps.keys()];
    }

    // `windows` is null for favorites; it is only computed in ungrouped mode.
    _pushEntries(entries, app, windows) {
        const id = app.get_id();
        if (this._grouped) {
            entries.push({id, app, windowSequence: null});
            return;
        }

        windows ??= this._onActiveWorkspace(taskbarWindows(app));
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

    _onActiveWorkspace(windows) {
        if (!this._isolateWorkspaces)
            return windows;

        const workspace = global.workspace_manager.get_active_workspace();
        return windows.filter(w => w.located_on_workspace(workspace));
    }

    _onAppStateChanged(app, notify = true) {
        if (app.state === Shell.AppState.STOPPED) {
            this._startingApps.delete(app);
            if (this._watchedApps.delete(app))
                app.disconnectObject(this);
        } else {
            this._watchApp(app);
            if (app.state !== Shell.AppState.STARTING)
                this._startingApps.delete(app);
            else if (!this._startingApps.has(app))
                this._startingApps.set(app, taskbarWindows(app).length > 0);
        }

        if (notify)
            this.emit('entries-changed');
    }

    _watchApp(app) {
        if (this._watchedApps.has(app))
            return;

        this._watchedApps.add(app);
        app.connectObject('windows-changed', () => {
            // A window arriving on a STARTING app does not change its state.
            if (this._startingApps.has(app) && taskbarWindows(app).length > 0)
                this._startingApps.set(app, true);
            this.emit('entries-changed');
        }, this);
    }

    _trackWindow(window) {
        if (this._trackedWindows.has(window))
            return;

        this._trackedWindows.add(window);
        if (isHelperSurface(window))
            this._helperWindows.add(window);

        window.connectObject(
            'workspace-changed', () => this.emit('entries-changed'),
            'notify::skip-taskbar', () => this.emit('entries-changed'),
            'notify::wm-class', () => this._recheckHelper(window),
            'size-changed', () => this._recheckHelper(window),
            'notify::title', () => this.emit('titles-changed'),
            'notify::demands-attention', () => this.emit('state-changed'),
            'notify::urgent', () => this.emit('state-changed'),
            'unmanaged', () => {
                this._trackedWindows.delete(window);
                this._helperWindows.delete(window);
                window.disconnectObject(this);
                this.emit('entries-changed');
            },
            this);
    }

    _recheckHelper(window) {
        if (!this._helperWindows.has(window) || isHelperSurface(window))
            return;

        this._helperWindows.delete(window);
        this.emit('entries-changed');
    }

    destroy() {
        this._trackedWindows.forEach(w => w.disconnectObject(this));
        this._trackedWindows.clear();
        this._helperWindows.clear();
        this._watchedApps.forEach(app => app.disconnectObject(this));
        this._watchedApps.clear();
        this._startingApps.clear();

        this._appSystem.disconnectObject(this);
        this._appFavorites.disconnectObject(this);
        this._settings.disconnectObject(this);
        this._windowTracker.disconnectObject(this);
        global.display.disconnectObject(this);
        global.workspace_manager.disconnectObject(this);
        this._settings = null;
    }
});

// Windows on every workspace count, so switching workspaces never reorders
// the icons.
function lowestSequence(windows) {
    return windows.reduce((lowest, w) => Math.min(lowest, w.get_stable_sequence()),
        Number.MAX_SAFE_INTEGER);
}
