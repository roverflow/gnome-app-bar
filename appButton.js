// SPDX-License-Identifier: GPL-3.0-or-later

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {zoomOutActor} from 'resource:///org/gnome/shell/ui/iconGrid.js';
import {gettext as _, ngettext} from 'resource:///org/gnome/shell/extensions/extension.js';

import {AppContextMenu} from './appMenu.js';
import {ITEM_TIME, PRESS_TIME} from './motion.js';

// One fade of the launch pulse, up or down.
const PULSE_DURATION = 900;

// Icon scale while the button is held down.
const PRESS_SCALE = 0.88;

// An app asking for attention hops its icon away from the screen edge this
// many times, by this fraction of the icon size, then rests. A hop that
// never stops wears on the eye.
const HOPS = 3;
const HOP_FRACTION = 0.2;
const HOP_TIME = 250;

// Without a throttle one wheel flick skips past every window.
const SCROLL_THROTTLE = 200 * GLib.TIME_SPAN_MILLISECOND;

// One icon on the bar. `entry` comes from TaskbarModel.entries(). `context`
// is shared by every button on a bar:
//   model       the TaskbarModel
//   appearance  the Appearance
//   hover       the HoverPopups
//   side        the screen edge the bar sits on, as St.Side
//   menuManager the PopupMenuManager for the context menu
//   hideApp     hides an app from the bar
//   focusEnd    moves keyboard focus to the first icon, or the last if
//               passed true
export const AppButton = GObject.registerClass(
class AppBarAppButton extends St.Button {
    _init(entry, context) {
        super._init({
            style_class: 'appbar-app-button',
            reactive: true,
            can_focus: true,
            track_hover: true,
            button_mask: St.ButtonMask.ONE | St.ButtonMask.TWO | St.ButtonMask.THREE,
            y_expand: true,
            y_align: Clutter.ActorAlign.FILL,
            pivot_point: new Graphene.Point({x: 0.5, y: 0.5}),
        });

        this.app = entry.app;
        this.accessible_name = this.app.get_name();

        this._context = context;
        this._model = context.model;
        this._appearance = context.appearance;
        this._hover = context.hover;
        this._windowSequence = entry.windowSequence;
        this._menu = null;
        this._lastScrollTime = 0;
        this._iconSize = 0;
        this._indicatorWidth = null;
        this._running = false;
        this._focused = false;
        this._launching = false;
        this._attention = false;
        this._pulsing = false;
        this._leaving = false;
        this._styleKey = null;

        // Grows and shrinks the button's width along with its scale, so
        // neighbouring icons slide over instead of jumping.
        this.connect('notify::scale-x', () => this.queue_relayout());

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
            pivot_point: new Graphene.Point({x: 0.5, y: 0.5}),
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

        // DND asks the delegate for the drag actor. The bar makes the button
        // draggable.
        this._delegate = this;

        this.connect('clicked', (_actor, button) => this._onClicked(button));
        this.connect('scroll-event', (_actor, event) => this._onScroll(event));
        this.connect('key-press-event', (_actor, event) => this._onKeyPress(event));
        this.connect('notify::hover', () => this._onHover());
        this.connect('notify::pressed', () => this._onPressed());
        this.connect('style-changed', () => this._syncIndicatorOffset());
        this.connect('key-focus-in', () => this._hover.show(this));
        this.connect('key-focus-out', () => this._hover.hide(this));
        this.connect('destroy', () => this._onButtonDestroy());
    }

    vfunc_get_preferred_width(forHeight) {
        const [min, nat] = super.vfunc_get_preferred_width(forHeight);
        return [min * this.scale_x, nat * this.scale_x];
    }

    // True once animateOut() has begun. The button is no longer on the bar
    // as far as input, drag and drop and hotkeys are concerned.
    get leaving() {
        return this._leaving;
    }

    setWindowSequence(sequence) {
        this._windowSequence = sequence;
    }

    // The app's visible windows in grouped mode, or the one window this
    // button is for in ungrouped mode.
    getWindows() {
        return this._model.windowsFor(this.app, this._windowSequence);
    }

    sync() {
        const windows = this.getWindows();
        const hadAttention = this._attention;

        this._running = windows.length > 0;
        this._focused = this._isFocused(windows);
        this._launching = this._model.isLaunching(this.app);

        this._attention = !this._focused &&
            windows.some(w => w.demands_attention || w.urgent);

        this._setStyleFlag(this, 'focused', this._focused);
        this._setStyleFlag(this._indicator, 'running', this._running);
        this._setStyleFlag(this._indicator, 'focused', this._focused);
        this._setStyleFlag(this._indicator, 'attention', this._attention);

        this._applyAppearance(windows.length);
        this._syncAccessibleName(windows.length);

        if (this._attention && !hadAttention)
            this._hop();

        if (this._menu?.isOpen)
            this._menu.rebuild();
    }

    _applyAppearance(windowCount) {
        // Every rebuild and focus change restyles all buttons; most of them
        // have not changed.
        const key = [this._running, this._focused, this._launching,
            this._attention, this.hover, windowCount, this._icon.mapped,
            this._appearance.version].join();
        if (key === this._styleKey)
            return;
        this._styleKey = key;

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
        this._setIndicatorWidth(style.indicatorWidth);

        this._badge.visible = style.badgeVisible;
        if (style.badgeVisible)
            this._badge.text = String(windowCount);
    }

    // The indicator stretches when its app gains focus and shrinks when it
    // loses it.
    _setIndicatorWidth(width) {
        if (width === this._indicatorWidth)
            return;

        const first = this._indicatorWidth === null;
        this._indicatorWidth = width;

        if (first) {
            this._indicator.width = width;
            return;
        }

        this._indicator.ease({
            width,
            duration: ITEM_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    // The stylesheet can move the indicator into the button's border.
    _syncIndicatorOffset() {
        const [found, offset] = this.get_theme_node()
            .lookup_length('-appbar-indicator-offset', false);
        this._indicator.translation_y = found ? offset : 0;
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

    // The texture hops, not the icon, since the icon carries the vertical
    // nudge and the press scale.
    _hop() {
        const texture = this._icon.get_child();
        if (!texture || !this._icon.mapped)
            return;

        const away = this._context.side === St.Side.BOTTOM ? -1 : 1;
        texture.translation_y = 0;
        texture.ease({
            translation_y: away * Math.round(this._iconSize * HOP_FRACTION),
            duration: HOP_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            // Up and back down is two runs.
            repeatCount: HOPS * 2 - 1,
            autoReverse: true,
            onStopped: () => (texture.translation_y = 0),
        });
    }

    _syncAccessibleName(windowCount) {
        const parts = [this.app.get_name()];
        if (this._launching)
            parts.push(_('starting'));
        if (windowCount > 1)
            parts.push(ngettext('%d window', '%d windows', windowCount).format(windowCount));
        if (this._focused)
            parts.push(_('focused'));
        if (this._attention)
            parts.push(_('needs attention'));

        const name = parts.join(', ');
        if (name !== this.accessible_name)
            this.accessible_name = name;
    }

    animateIn() {
        this.set_scale(0, 0);
        this.opacity = 0;
        this.ease({
            scale_x: 1,
            scale_y: 1,
            opacity: 255,
            duration: ITEM_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    // Shrinks the button away, then destroys it.
    animateOut() {
        this._leaving = true;
        this.reactive = false;
        this.can_focus = false;
        this._hover.forget(this);
        this._menu?.close();

        this.ease({
            scale_x: 0,
            scale_y: 0,
            opacity: 0,
            duration: ITEM_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => this.destroy(),
        });
    }

    // The zoom the shell plays when an app starts from the dash or the grid.
    animateLaunch() {
        zoomOutActor(this._icon);
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
        // As in the dash, a click puts the tooltip and preview away.
        this._hover.hide(this, true);

        if (button === Clutter.BUTTON_SECONDARY)
            this._popupMenu();
        else if (button === Clutter.BUTTON_MIDDLE)
            this._openNewWindow();
        else
            this._activateOrCycle();
    }

    _onPressed() {
        this._icon.ease({
            scale_x: this.pressed ? PRESS_SCALE : 1,
            scale_y: this.pressed ? PRESS_SCALE : 1,
            duration: PRESS_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
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

    // Arrow keys move between icons through the shell's focus manager.
    // Home and End jump to the ends, Escape hands focus back, and Menu or
    // Shift+F10 opens the context menu, as elsewhere in GNOME. Key events
    // stop at the button, so the bar can't handle these itself.
    _onKeyPress(event) {
        const shift = (event.get_state() & Clutter.ModifierType.SHIFT_MASK) !== 0;

        switch (event.get_key_symbol()) {
        case Clutter.KEY_Home:
            this._context.focusEnd(false);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_End:
            this._context.focusEnd(true);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Escape:
            global.stage.set_key_focus(null);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Menu:
            this._popupMenu();
            return Clutter.EVENT_STOP;
        case Clutter.KEY_F10:
            if (!shift)
                return Clutter.EVENT_PROPAGATE;
            this._popupMenu();
            return Clutter.EVENT_STOP;
        default:
            return Clutter.EVENT_PROPAGATE;
        }
    }

    _onHover() {
        this._applyAppearance(this.getWindows().length);

        if (this.hover)
            this._hover.show(this);
        else
            this._hover.hide(this);
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
            this._launch();
        else
            Main.activateWindow(this._mostRecentlyUsed(windows));
    }

    // An unfocused app raises its most recent window. A focused one steps
    // to its next window, or minimizes if it has only one.
    _activateOrCycle() {
        const windows = this.getWindows();

        if (windows.length === 0) {
            this._launch();
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

    // An app running on another workspace only switches there, so it gets
    // no launch zoom.
    _launch() {
        if (this.app.state === Shell.AppState.STOPPED)
            this.animateLaunch();
        this.app.activate();
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
        if (!this.app.can_open_new_window()) {
            this.app.activate();
            return;
        }

        this.animateLaunch();
        this.app.open_new_window(-1);
    }

    _popupMenu() {
        this._hover.hide(this, true);

        if (!this._menu) {
            const {side, menuManager, hideApp} = this._context;
            this._menu = new AppContextMenu(this, side, hideApp);
            this._menu.actor.hide();
            Main.uiGroup.add_child(this._menu.actor);
            // The manager closes the bar's other menus when this opens.
            menuManager.addMenu(this._menu);
            this._menu.connect('open-state-changed', (_menu, isOpen) =>
                this._setStyleFlag(this, 'menu-open', isOpen));
        }

        this._menu.rebuild();
        this._menu.open(true);
    }

    _onButtonDestroy() {
        this._hover.forget(this);

        if (this._menu) {
            this._context.menuManager.removeMenu(this._menu);
            this._menu.destroy();
            this._menu = null;
        }
    }
});
