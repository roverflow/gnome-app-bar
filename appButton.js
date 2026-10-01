// SPDX-License-Identifier: GPL-3.0-or-later

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {AppContextMenu} from './appMenu.js';

const APPEAR_DURATION = 150;

// One fade of the launch pulse, up or down.
const PULSE_DURATION = 600;

// Without a throttle one wheel flick skips past every window.
const SCROLL_THROTTLE = 200 * GLib.TIME_SPAN_MILLISECOND;

export function taskbarWindows(app) {
    return app.get_windows().filter(w => !w.is_skip_taskbar());
}

// `windows` is the app's taskbarWindows(). Splash screens are skip-taskbar,
// so an app showing only a splash still counts as launching.
export function isLaunching(app, windows) {
    return windows.length === 0 && app.state === Shell.AppState.STARTING;
}

export const AppButton = GObject.registerClass(
class AppBarAppButton extends St.Button {
    _init(entry, appBar, appearance) {
        super._init({
            style_class: 'appbar-app-button',
            reactive: true,
            can_focus: true,
            track_hover: true,
            button_mask: St.ButtonMask.ONE | St.ButtonMask.TWO | St.ButtonMask.THREE,
            y_expand: true,
            y_align: Clutter.ActorAlign.FILL,
        });

        this.app = entry.app;
        this.accessible_name = this.app.get_name();

        this._appBar = appBar;
        this._appearance = appearance;
        this._windowSequence = entry.windowSequence;
        this._menu = null;
        this._lastScrollTime = 0;
        this._iconSize = 0;
        this._running = false;
        this._focused = false;
        this._launching = false;
        this._attention = false;
        this._pulsing = false;

        // Stacked, so the indicator and badge never push the icon off centre.
        const overlay = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
        });
        this.set_child(overlay);

        this._icon = new St.Bin({
            style_class: 'appbar-app-icon',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            y_expand: true,
        });
        overlay.add_child(this._icon);

        // A new button is not mapped yet, so its pulse starts here.
        this._icon.connect('notify::mapped', () => {
            if (this._launching)
                this._applyAppearance(0);
        });

        this._indicator = new St.Widget({
            style_class: 'appbar-indicator',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.END,
            x_expand: true,
            y_expand: true,
        });
        overlay.add_child(this._indicator);

        this._badge = new St.Label({
            style_class: 'appbar-window-count',
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.START,
            x_expand: true,
            y_expand: true,
            visible: false,
        });
        overlay.add_child(this._badge);

        // The bar handles drops and uses the delegate to spot its own buttons.
        this._delegate = this;
        this._draggable = DND.makeDraggable(this);
        this._draggable.connect('drag-begin',
            () => this._appBar.onDragBegin(this));
        this._draggable.connect('drag-end',
            () => this._appBar.onDragEnd(this));

        this.connect('clicked', (_actor, button) => this._onClicked(button));
        this.connect('scroll-event', (_actor, event) => this._onScroll(event));
        this.connect('notify::hover', () => this._onHover());
        this.connect('destroy', () => this._onButtonDestroy());

        this.app.connectObject(
            'windows-changed', () => this._appBar.queueSync(), this);

        this.sync();
    }

    // The app's visible windows in grouped mode, or the one window this
    // button is for in ungrouped mode.
    getWindows() {
        return this._shownWindows(taskbarWindows(this.app));
    }

    _shownWindows(windows) {
        if (this._windowSequence !== null) {
            return windows.filter(
                w => w.get_stable_sequence() === this._windowSequence);
        }

        if (!this._appBar.isolateWorkspaces)
            return windows;

        const workspace = global.workspace_manager.get_active_workspace();
        return windows.filter(w => w.located_on_workspace(workspace));
    }

    sync() {
        const all = taskbarWindows(this.app);
        const windows = this._shownWindows(all);

        this._running = windows.length > 0;
        this._focused = this._isFocused(windows);
        this._launching = isLaunching(this.app, all);

        this._attention = !this._focused &&
            windows.some(w => w.demands_attention || w.urgent);

        this._setStyleFlag(this._indicator, 'running', this._running);
        this._setStyleFlag(this._indicator, 'focused', this._focused);
        this._setStyleFlag(this._indicator, 'attention', this._attention);

        this._applyAppearance(windows.length);

        if (this._menu?.isOpen)
            this._menu.rebuild();
    }

    _applyAppearance(windowCount) {
        const style = this._appearance.styleFor({
            running: this._running,
            focused: this._focused,
            launching: this._launching,
            attention: this._attention,
            hovered: this.hover,
            windowCount,
        });

        // Icon textures have a fixed size; a new size needs a new texture.
        if (style.iconSize !== this._iconSize) {
            this._iconSize = style.iconSize;
            this._icon.set_child(this.app.create_icon_texture(style.iconSize));
        }

        this._updatePulse(style);

        this._icon.translation_y = style.iconOffset;
        this.set_style(style.buttonStyle);

        this._indicator.visible = style.indicatorVisible;
        this._indicator.set_style(style.indicatorStyle);

        this._badge.visible = style.badgeVisible;
        if (style.badgeVisible)
            this._badge.text = String(windowCount);
    }

    // ease() skips to the end on an unmapped actor, so the pulse only starts
    // once the icon is mapped.
    _updatePulse(style) {
        const pulse = style.iconPulseOpacity !== null && this._icon.mapped;
        if (pulse && this._pulsing)
            return;

        if (this._pulsing) {
            this._pulsing = false;
            this._icon.remove_transition('opacity');
        }
        this._icon.opacity = style.iconOpacity;

        if (!pulse)
            return;

        this._pulsing = true;
        this._icon.ease({
            opacity: style.iconPulseOpacity,
            duration: PULSE_DURATION,
            mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
            repeatCount: -1,
            autoReverse: true,
        });
    }

    animateIn() {
        this.opacity = 0;
        this.ease({
            opacity: 255,
            duration: APPEAR_DURATION,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _isFocused(windows) {
        return Shell.WindowTracker.get_default().focus_app === this.app &&
            windows.some(w => w === global.display.focus_window);
    }

    _setStyleFlag(actor, name, enabled) {
        if (enabled)
            actor.add_style_class_name(name);
        else
            actor.remove_style_class_name(name);
    }

    getDragActor() {
        return this.app.create_icon_texture(this._iconSize || 24);
    }

    getDragActorSource() {
        return this._icon;
    }

    _onClicked(button) {
        if (button === Clutter.BUTTON_SECONDARY)
            this._popupMenu();
        else if (button === Clutter.BUTTON_MIDDLE)
            this._openNewWindow();
        else
            this._activateOrCycle();
    }

    _onScroll(event) {
        let step;
        switch (event.get_scroll_direction()) {
        case Clutter.ScrollDirection.UP:
        case Clutter.ScrollDirection.LEFT:
            step = -1;
            break;
        case Clutter.ScrollDirection.DOWN:
        case Clutter.ScrollDirection.RIGHT:
            step = 1;
            break;
        default:
            return Clutter.EVENT_PROPAGATE;
        }

        const now = GLib.get_monotonic_time();
        if (now - this._lastScrollTime < SCROLL_THROTTLE)
            return Clutter.EVENT_STOP;
        this._lastScrollTime = now;

        this._cycleBy(step);
        return Clutter.EVENT_STOP;
    }

    _onHover() {
        this._applyAppearance(this.getWindows().length);

        if (this.hover)
            this._appBar.showHover(this);
        else
            this._appBar.hideHover(this);
    }

    getTooltipText() {
        return this._tooltipTextFor(this.getWindows());
    }

    _tooltipTextFor(windows) {
        if (windows.length > 1)
            return `${this.app.get_name()} (${windows.length})`;

        const title = windows.length === 1 ? windows[0].get_title() : null;
        return title && title !== this.app.get_name()
            ? `${this.app.get_name()} — ${title}`
            : this.app.get_name();
    }

    // From the overview, raise the app even if focused instead of minimizing.
    activateFromShortcut() {
        if (!Main.overview.visible) {
            this._activateOrCycle();
            return;
        }

        Main.overview.hide();
        const windows = this.getWindows();
        if (windows.length === 0)
            this.app.activate();
        else
            Main.activateWindow(this._mostRecentlyUsed(windows));
    }

    // An unfocused app raises its most recent window. A focused one steps
    // to its next window, or minimizes if it has only one.
    _activateOrCycle() {
        const windows = this.getWindows();

        if (windows.length === 0) {
            this.app.activate();
            return;
        }

        const focused = global.display.focus_window;
        if (!focused || !windows.includes(focused)) {
            Main.activateWindow(this._mostRecentlyUsed(windows));
            return;
        }

        if (windows.length === 1)
            focused.minimize();
        else
            this._cycleBy(1);
    }

    _cycleBy(step) {
        const windows = this._inCycleOrder();
        if (windows.length === 0)
            return;

        const current = windows.indexOf(global.display.focus_window);
        const from = current === -1 ? (step > 0 ? -1 : 0) : current;
        const next = (from + step + windows.length) % windows.length;

        Main.activateWindow(windows[next]);
    }

    // Launch order, since cycling by recency only flips between two windows.
    _inCycleOrder() {
        return this.getWindows().sort(
            (a, b) => a.get_stable_sequence() - b.get_stable_sequence());
    }

    _mostRecentlyUsed(windows) {
        const workspace = global.workspace_manager.get_active_workspace();
        const mru = global.display.get_tab_list(Meta.TabList.NORMAL, workspace);
        return mru.find(w => windows.includes(w)) ?? windows[0];
    }

    _openNewWindow() {
        if (this.app.can_open_new_window())
            this.app.open_new_window(-1);
        else
            this.app.activate();
    }

    _popupMenu() {
        this._appBar.hideHover(this, true);

        if (!this._menu) {
            this._menu = new AppContextMenu(this, this._appBar);
            this._menu.actor.hide();
            Main.uiGroup.add_child(this._menu.actor);
            // The panel's manager closes other panel menus when this opens.
            Main.panel.menuManager.addMenu(this._menu);
            this._menu.connect('open-state-changed', (_menu, isOpen) =>
                this._setStyleFlag(this, 'menu-open', isOpen));
        }

        this._menu.rebuild();
        this._menu.open(true);
    }

    _onButtonDestroy() {
        this._appBar.forgetHover(this);
        this.app.disconnectObject(this);

        if (this._menu) {
            Main.panel.menuManager.removeMenu(this._menu);
            this._menu.destroy();
            this._menu = null;
        }
    }
});
