import { View, div, svg, image } from "gpui-kit";
import { HoverCard, h_flex, v_flex, TextareaState, Textarea, SliderState, Slider, SliderTrack, SliderIndicator, SliderThumb } from "gpui-base";
import { appHome, home, hc, focused, spaces, panes, terminals, shared, setShared, settings, props, theme, run, openOverlay, closeOverlay, notify, playSound, nextCommand, window as app } from "herdr";
import { STATE_KEY, DEFAULT_SIZE, PRESETS, RESIZE_BORDER, HEADER_HEIGHT, readState, ownedTerminals, tabName, tabProgram, liveStatus, pressedInWindow, agentAlerts, unseenFinishes, tabStatus, startFolder, dragGeometry } from "./model.js";
import { FloatController } from "./controller.js";

const WINDOW = "__herdr_float_space_window_v1";
const SIZE_POPUP = "__herdr_float_space_size_v1";

function resultJSON(result, operation) {
  if (result.code !== 0) throw new Error(`${operation}: ${result.stderr.trim() || `exit ${result.code}`}`);
  try { return JSON.parse(result.stdout); }
  catch { throw new Error(`${operation}: invalid response from herdr-core`); }
}

function host() {
  const labels = ["--label", "herdr.mod=float-space", "--label", `herdr.float-space=${appHome()}`];
  return {
    getState: () => shared(STATE_KEY),
    setState: state => setShared(STATE_KEY, state),
    focused, panes, terminals,
    liveOwned: () => ownedTerminals(terminals(), appHome()),
    listOwned: async () => {
      const data = resultJSON(await hc(["ls", "--json", ...labels]), "List Float Space terminals");
      if (!Array.isArray(data.terminals)) throw new Error("List Float Space terminals: missing terminal list");
      return data.terminals;
    },
    spawnOwned: async () => resultJSON(await hc(["run", "--bg", "--keep", "--no-parent", "--cwd", startFolder(spaces(), focused(), home(), panes()), "--json", ...labels]), "Start terminal"),
    killOwned: async address => {
      const result = await hc(["kill", address]);
      if (result.code !== 0) throw new Error(result.stderr.trim() || "Could not end terminal");
    },
    open: spec => openOverlay(spec),
    close: id => closeOverlay(id),
    focusPane: pane => run("pane.focus", { pane }),
  };
}

// No copy lives as long as the window, so every copy shares this controller.
// Its fields outlive copies and reloads; its methods are this build's.
function windowShared() {
  const memory = globalThis[WINDOW] ??= { controller: new FloatController(), lease: null };
  Object.setPrototypeOf(memory.controller, FloatController.prototype);
  return memory;
}

// Each command runs in its own invisible copy, which closes itself when done.
// Herdr stops a copy's tasks when that copy closes or reloads, and a remount
// closes the header, so neither the header nor a popup may run one. The
// shortcut's `mod.open` starts the same copy without a command: a toggle.
function act(command, geometry) {
  openOverlay({ mod: "float-space", kind: "window", frame: "none", width: 1, height: 1, props: { role: "run", command, geometry } });
}

// One command at a time. A claim, not a shared promise chain: a chain through
// a copy Herdr stopped never settles, while a stopped copy's claim expires.
async function claim(cx, owner) {
  const memory = windowShared();
  while (memory.lease && memory.lease.owner !== owner && Date.now() - memory.lease.at < 15000) await cx.sleep(15);
  memory.lease = { owner, at: Date.now() };
}

function release(owner) {
  const memory = windowShared();
  if (memory.lease?.owner === owner) memory.lease = null;
}

async function executeCommand(command, owner, cx, geometry) {
  try {
    await claim(cx, owner);
    await windowShared().controller.handle(command, host(), geometry);
  } catch (error) {
    notify({ title: "Float Space", body: String(error?.message ?? error), level: "error" });
  } finally {
    release(owner);
    closeOverlay(owner);
  }
}

function stop(_event, cx) { cx.stop_propagation(); }

function resizeCursor(element, direction) {
  if (direction === "n" || direction === "s") return element.cursor_ns_resize();
  if (direction === "e" || direction === "w") return element.cursor_ew_resize();
  if (direction === "ne" || direction === "sw") return element.cursor_nesw_resize();
  return element.cursor_nwse_resize();
}

// The header and the edge blocks draw one border. Each waits on the same
// change in a task of its own (a task's `cx.notify()` redraws its view even
// when another view woke it), so all four redraw together.
function showFocus(keyboard) {
  const memory = windowShared();
  if (memory.keyboard === keyboard) return;
  memory.keyboard = keyboard;
  memory.focusChanged?.resolve();
  memory.focusChanged = null;
}

function drawsBorder(cx) {
  cx.spawn(async cx => {
    for (;;) {
      const memory = windowShared();
      if (!memory.focusChanged) {
        let resolve;
        const promise = new Promise(done => { resolve = done; });
        memory.focusChanged = { promise, resolve };
      }
      await memory.focusChanged.promise;
      cx.notify();
    }
  });
}

// Herdr alerts only for agents in its spaces, so Float Space tells about its
// own the way Herdr does: Herdr's sound, and Herdr's agent toast unless
// they're watching it (Herdr's window active, the keyboard in this window,
// that tab shown). The header checks while the window is open, the
// status-bar button also while it's hidden; the shared memory makes one of
// them report each change. The same check keeps the button's dot.
const ALERTS = {
  done: { says: "finished", level: "info" },
  blocked: { says: "needs you", level: "error" },
};
function watchAgents() {
  const memory = windowShared();
  const state = readState(shared(STATE_KEY));
  const live = ownedTerminals(terminals(), appHome());
  // After a gap (hidden with no button, reloaded), what changed meanwhile is old news.
  const seen = Date.now() - (memory.watchedAt ?? 0) < 3000 ? memory.statuses ?? null : null;
  memory.watchedAt = Date.now();
  const showing = memory.controller.overlay && app().active && state.page === "terminal" ? state.active : null;
  const looking = memory.keyboard ? showing : null;
  const { statuses, alerts } = agentAlerts(seen, live, looking);
  memory.statuses = statuses;
  const { unseen, dot } = unseenFinishes(memory.unseen, alerts, live, showing);
  memory.unseen = unseen;
  memory.dot = dot;
  memory.marks = `${dot}|${unseen.join(" ")}`;
  if (!alerts.length) return;
  for (const alert of alerts) {
    const tab = state.tabs.find(item => item.address === alert.address);
    // A terminal not yet adopted as a tab (the window hasn't opened since) still has its program's name.
    const name = tabName(tab ?? { title: "An agent" }, live.find(item => item.address === alert.address));
    const { says, level } = ALERTS[alert.kind];
    // The receiver lives as long as its toast, even after the main window is
    // hidden. Commands reach shown mod copies only in Herdr 0.1.11.
    openOverlay({ mod: "float-space", kind: "window", frame: "none", width: 2, height: 2,
      at: { x: 0, y: 0 }, props: { role: "alert", address: alert.address, title: `${name} ${says}`, level } });
  }
  // Herdr's own sounds, or the files settings.json names; off with them.
  if (settings().sounds?.enabled !== false) {
    playSound(alerts.some(alert => alert.kind !== "done") ? "blocked" : "done");
  }
}

// Checks the agents once a second. Unseen finishes live in memory, not in
// Herdr's live data, so a view drawing them (the button's dot, the tabs'
// done dots) redraws itself when the check changes them.
function watchesAgents(view, cx) {
  cx.timer.every(1000, cx => {
    watchAgents();
    if (windowShared().marks !== view.drawnMarks) cx.notify();
  });
}

// A press on the header's own controls puts the keyboard in the window too.
function grab(view) {
  return (_event, cx) => { cx.stop_propagation(); view.headerClicked = true; view.handle?.focus(); showFocus(true); };
}
function focusKey() {
  const now = focused();
  return `${now?.pane}|${now?.terminal}`;
}
// The icon from the app's program table: a one-color glyph or a picture.
function programIcon(program, color) {
  if (!program?.icon) return null;
  return program.tint ? svg(program.icon).size(14).flex_none().text_color(color) : image(program.icon).size(14).flex_none();
}

// A hover label drawn like Herdr's popups (popover fill, 1px border, 6px radius,
// soft shadow) at tooltip size. HoverCard draws no surface of its own.
function hoverLabel(t, text) {
  return div().px(8).py(4).rounded(6).bg(t.popover).border(1).border_color(t.border).shadow_md()
    .text_size(12).text_color(t.foreground).whitespace_nowrap().child(text);
}

export default class FloatSpace extends View {
  init(_props, cx) {
    this.copyProps = props() ?? {};
    // `mod.open` (the shortcut) opens a copy with only an overlay id. A layout
    // block without a role is an optional button.
    const role = this.copyProps.role;
    this.role = role ?? (this.copyProps.overlay ? "run" : "launcher");
    if (this.role === "run") {
      const owner = this.copyProps.overlay;
      cx.spawn(cx => executeCommand(this.copyProps.command ?? "toggle", owner, cx, this.copyProps.geometry));
    } else if (this.role === "resize") {
      this.handle = cx.focus_handle();
      this.drag = this.copyProps.drag;
      this.preview = { size: this.drag.size, position: this.drag.position };
      cx.timer.after(0, () => this.handle.focus());
      // Releases outside the app are not delivered. A focus loss, fresh press
      // or Escape dismisses the transparent tracking layer.
      let active = app().active;
      cx.timer.every(100, () => {
        if (active && !app().active) this.cancelResize();
        active = app().active;
      });
    } else if (this.role === "alert") {
      const { overlay, address, title, level } = this.copyProps;
      const command = `alert-${overlay}`;
      // Herdr's agent toast: its title and level, no body (a Float Space
      // terminal has no space or tab) and Herdr's own timeout, which this
      // receiver only mirrors to know when to go.
      const timeout = level === "error" || level === "warning" ? 8000 : 5000;
      this.toast = notify({ title, level, action: { name: `float-space.${command}` } });
      cx.spawn(async cx => {
        for (;;) {
          if (await nextCommand() !== command) continue;
          this.expiry?.cancel();
          // This receiver survives the main window's remount. Finish here:
          // closing immediately after handing work to a new copy can cancel
          // that copy's first hc call in Herdr 0.1.11.
          await executeCommand(`reveal-${address}`, overlay, cx);
          return;
        }
      });
      this.expiry = cx.timer.after(timeout + 250, () => closeOverlay(overlay));
    } else if (this.role === "size") {
      // Lets the size button close this popup instead of opening another.
      globalThis[SIZE_POPUP] = { overlay: this.copyProps.overlay };
      const size = readState(shared(STATE_KEY)).size;
      this.sliders = {};
      for (const [key, min, max] of [["width", 20, 95], ["height", 30, 95]]) {
        const slider = SliderState.new({ min, max, step: 1, value: Math.round(size[key] * 100) });
        slider.on("change", (_value, cx) => cx.notify());
        this.sliders[key] = slider;
      }
    } else if (this.role === "notes") {
      this.notes = TextareaState.new({ value: readState(shared(STATE_KEY)).notes, placeholder: "Notes shared across your spaces…" });
      // Auto grow pinned at 10 rows keeps the old size (at least 10 rows,
      // filling the window) but scrolls the way a terminal does. The plain
      // mode, once 24 rows fit, keeps the caret 3 rows above the bottom and
      // clamps only after painting: Enter on the last line drew the text 2
      // rows too high for a frame, then dropped it back. In auto grow the
      // caret may reach the last row and the text never scrolls past its end.
      this.notes.set_auto_grow(10, 10);
      // Shared state re-renders every mod in the app: save once typing pauses,
      // and on close (switching tabs, hiding, reloading).
      this.notes.on("change", (_e, cx) => {
        this.pendingSave?.cancel();
        this.pendingSave = cx.timer.after(400, () => this.saveNotes());
      });
      this.notes.on("focus", () => { windowShared().notesFocused = true; showFocus(true); });
      this.notes.on("blur", () => { windowShared().notesFocused = false; });
      cx.timer.after(0, () => this.notes.focus());
    } else if (this.role === "bar") {
      this.handle = cx.focus_handle();
      this.headerClicked = false;
      const state = readState(shared(STATE_KEY));
      // Safety guard: hold keyboard in Float Space to prevent keystrokes
      // from leaking to the background pane. Do NOT mark border accent;
      // border stays neutral until the user clicks into the terminal.
      if (state.page !== "notes") cx.timer.after(0, () => this.handle.focus());
      drawsBorder(cx);
      // A failed core query must remain eligible on the next tick.
      cx.timer.every(3000, () => {
        const memory = windowShared();
        if (!memory.lease && memory.controller.needsReconcile(host())) act("reconcile");
      });
      // Presses update the border at once; this catches the rest, such as
      // Herdr focusing another pane from the keyboard.
      cx.timer.every(150, () => showFocus(this.keyboard()));
      watchesAgents(this, cx);
      // Only the header consumes navigation commands. Other shown copies
      // receive the same message; executing here prevents duplicate shells.
      cx.spawn(async () => {
        for (;;) {
          const command = await nextCommand();
          if (!["next", "prev", "new", "notes"].includes(command)) continue;
          if (this.copyProps.generation !== windowShared().controller.generation) continue;
          if (globalThis[SIZE_POPUP]?.overlay || !this.canNavigate()) continue;
          act(command);
        }
      });
    } else if (this.role === "edge") {
      drawsBorder(cx);
    } else if (this.role === "launcher") {
      // The button stays in its layout while the window is hidden, so it
      // keeps the alerts and its dot going then.
      watchesAgents(this, cx);
    }
  }

  canNavigate() {
    return this.handle?.is_focused() || this.keyboard();
  }

  // Whether typing goes into this window: its header, Notes or its terminal.
  // Herdr keeps the pane underneath marked focused in all three cases, and
  // `focused()` doesn't report a terminal in an overlay, so a press inside the
  // window counts until a press elsewhere or Herdr focusing another pane.
  keyboard() {
    if (windowShared().notesFocused) return true;
    if (this.pressedIn && this.pressedIn === focusKey()) return true;
    if (this.headerClicked && this.handle?.is_focused()) return true;
    const now = focused();
    return !now?.pane && readState(shared(STATE_KEY)).tabs.some(tab => tab.address === now?.terminal);
  }

  // Any press outside the header: in the window's body, or anywhere else.
  notePress(event) {
    if (!event.bounds) return;
    const height = readState(shared(STATE_KEY)).size.height * window.viewport_size().height;
    const bounds = { ...event.bounds, y: event.bounds.y - RESIZE_BORDER * settings().zoom };
    const inside = pressedInWindow(event.position, bounds, height);
    this.pressedIn = inside ? focusKey() : null;
    this.headerClicked = false;
    showFocus(inside);
  }

  saveNotes() {
    this.pendingSave = null;
    const state = readState(shared(STATE_KEY));
    const notes = this.notes.value();
    if (state.notes !== notes) setShared(STATE_KEY, { ...state, notes });
  }

  async close() {
    if (this.toast) closeOverlay(this.toast);
    if (this.role === "resize" && windowShared().resizeOverlay === this.copyProps.overlay) windowShared().resizeOverlay = null;
    if (this.role === "notes") {
      windowShared().notesFocused = false;
      showFocus(false);
    }
    if (this.role === "size" && globalThis[SIZE_POPUP]?.overlay === this.copyProps.overlay) globalThis[SIZE_POPUP] = { closedAt: Date.now() };
    if (this.pendingSave) {
      this.pendingSave.cancel();
      this.saveNotes();
    }
    this.notes?.release();
    for (const slider of Object.values(this.sliders ?? {})) slider.release();
    // Last: it may wait for core. Work started from here is cancelled with
    // this copy, so it must not hand over to another copy.
    if (this.role === "bar") {
      if (this.copyProps.generation === windowShared().controller.generation) {
        windowShared().keyboard = false;
        showFocus(false);
      }
      try { await windowShared().controller.windowClosed(host(), this.copyProps.generation); }
      catch (error) { notify({ title: "Float Space", body: String(error?.message ?? error), level: "error" }); }
    }
  }

  // The confirm dialog's buttons, at popup size: a solid primary, a raised secondary.
  button(id, label, action, primary = false) {
    const t = theme();
    return h_flex().id(id).h(26).px(12).items_center().justify_center().flex_none().rounded(6).border_1()
      .border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).cursor_pointer().hover(s => s.opacity(0.88))
      .on_mouse_down("left", stop).on_click(action).child(label);
  }

  iconButton(id, icon, label, action, press) {
    const t = theme();
    return h_flex().id(id).size(22).items_center().justify_center().flex_none().rounded(6).text_color(t.dim)
      .cursor_pointer().hover(s => s.bg(t.hover).text_color(t.foreground))
      .tooltip(label).accessibility_label(label)
      .on_mouse_down("left", (event, cx) => { cx.stop_propagation(); this.headerClicked = true; this.handle?.focus(); showFocus(true); this.pointer = event.position; press?.(); }).on_click(action)
      .child(svg(`mods/float-space/${icon}.svg`).size(14));
  }

  // A tab as Herdr's tab bar draws one, sized for a 30px header.
  tab(id, icon, label, active, action, extra = []) {
    const t = theme();
    return h_flex().id(id).h(22).px(8).gap(6).flex_none().items_center().rounded(6)
      .border_1().border_color(active ? t.border : t.background).bg(active ? t.raised : t.background)
      .text_color(active ? t.foreground : t.muted).cursor_pointer().hover(s => s.bg(t.hover))
      .on_mouse_down("left", grab(this)).on_click(action)
      .when(Boolean(icon), el => el.child(icon))
      .child(div().max_w(135).truncate().child(label))
      .children(extra);
  }

  // A press outside a popup closes it before the click arrives, so remember
  // whether this press found it open; the click then only closes it.
  pressSize() {
    const popup = globalThis[SIZE_POPUP];
    this.sizeWasOpen = Boolean(popup?.overlay) || Date.now() - (popup?.closedAt ?? 0) < 250;
  }

  toggleSize() {
    const popup = globalThis[SIZE_POPUP];
    if (this.sizeWasOpen) {
      if (popup?.overlay) closeOverlay(popup.overlay);
      return;
    }
    const at = this.pointer ? { x: Math.max(0, this.pointer.x - 260), y: this.pointer.y + 16 } : "pointer";
    openOverlay({ mod: "float-space", props: { role: "size" }, kind: "popup", width: 280, at });
  }

  applySize(width, height) {
    act(`resize-${width}-${height}`);
    closeOverlay(this.copyProps.overlay);
  }

  renderLauncher() {
    const t = theme();
    const memory = windowShared();
    this.drawnMarks = memory.marks;
    const dot = Boolean(memory.dot);
    // A finish you haven't seen: a dot at the icon's top right, where its
    // front window leaves room, in Herdr's yellow (its `working` color) and
    // ringed in the bar's color like Herdr's tile dots.
    const icon = div().relative().size(14).flex_none()
      .child(svg("mods/float-space/float.svg").size(14))
      .when(dot, el => el.child(div().absolute().top(-3).right(-4).size(8).rounded_full()
        .border_1().border_color(t.chrome).bg(t.working)));
    // Continues the status bar beside it: chrome, its top border, a rounded button.
    const button = h_flex().id("float-space-launcher").w(26).h(22).items_center().justify_center().rounded(6).text_color(t.muted)
      .cursor_pointer().hover(s => s.bg(t.hover).text_color(t.foreground))
      .accessibility_label("Toggle Float Space (Ctrl+Shift+Space)")
      .on_mouse_down("left", stop).on_click(() => act("toggle"))
      .child(icon);
    // The label waits 1000 ms like the status bar's other buttons; .tooltip() is fixed at 500.
    return h_flex().size_full().items_center().justify_center().bg(t.chrome).border_t(1).border_color(t.border)
      .child(HoverCard.new("float-space-launcher-hover").anchor("bottom_center").open_delay(1000).trigger(button)
        .content(hoverLabel(t, "Float Space · Ctrl+Shift+Space").mb(6)));
  }

  renderBar() {
    const t = theme();
    const state = readState(shared(STATE_KEY));
    const live = terminals();
    const notes = state.page === "notes";
    const ring = windowShared().keyboard ? t.accent : t.input;
    this.drawnMarks = windowShared().marks;
    const unseen = new Set(windowShared().unseen ?? []);
    // The shell entry as Herdr shows it now, so the person's programs.json applies.
    const shell = live.find(item => item.program?.key === "shell")?.program;
    const tabs = state.tabs.map(tab => {
      const terminal = live.find(item => item.address === tab.address);
      const name = tabName(tab, terminal);
      const status = tabStatus(liveStatus(terminal), unseen.has(tab.address));
      const active = state.page === "terminal" && state.active === tab.address;
      return this.tab(`float-tab-${tab.address}`, programIcon(tabProgram(terminal, shell), t.muted), name, active,
        () => act(`select-${tab.address}`), [
          status === "working" ? svg("mods/float-space/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)
            : status ? div().size(6).flex_none().rounded(3).bg(t[status]) : null,
          active ? div().id(`float-end-${tab.address}`).flex_none().text_color(t.dim).hover(s => s.text_color(t.foreground))
            .tooltip(`Close ${name}`).accessibility_label(`Close ${name}`)
            .on_mouse_down("left", grab(this)).on_click((_e, cx) => { cx.stop_propagation(); act(`end-${tab.address}`); })
            .child(svg("mods/float-space/close.svg").size(12)) : null,
        ].filter(Boolean));
    });
    // Free header space moves the window; resize bands sit outside the controls.
    return v_flex().id("float-space-bar").track_focus(this.handle).on_mouse_down_out(event => this.notePress(event))
      .on_mouse_down("left", () => { this.headerClicked = true; this.handle.focus(); showFocus(true); })
      .size_full().bg(t.background).border_l(1).border_r(1).border_color(ring)
      .child(h_flex().flex_1().min_h(0).px(6).gap(6).items_center().border_b(1).border_color(t.border)
      .text_color(t.foreground).text_size(12)
      .child(this.tab("float-notes-tab", svg("mods/float-space/notes.svg").size(14).flex_none().text_color(notes ? t.foreground : t.muted), "Notes",
        notes, () => act("notes")).tooltip("Notes shared across your spaces · Ctrl+Shift+N"))
      .when(tabs.length > 0, el => el.child(div().w(1).h(14).flex_none().bg(t.border)))
      .child(h_flex().id("float-terminal-tabs").flex_1().h_full().min_w(0).items_center().gap(2).overflow_x_scrollbar().children(tabs))
      .child(this.iconButton("float-new-terminal", "plus", "New terminal · Ctrl+Shift+T", () => act("new")))
      .child(this.iconButton("float-size", "size", "Window size", () => this.toggleSize(), () => this.pressSize()))
      .child(this.iconButton("float-hide", "hide", "Hide · Ctrl+Shift+Space", () => act("hide"))));
  }

  beginResize(event, cx, direction, position) {
    if (!event.bounds) return;
    cx.stop_propagation();
    const memory = windowShared();
    if (memory.resizeOverlay) return;
    const state = readState(shared(STATE_KEY));
    const viewport = window.viewport_size();
    const drag = {
      down: event.position, size: state.size, viewport, direction, position,
      generation: memory.controller.generation,
    };
    // Track across the whole app without remounting the scratch window.
    memory.resizeOverlay = openOverlay({ mod: "float-space", kind: "window", frame: "none",
      width: 1, height: 1, at: { x: 0, y: 0 }, props: { role: "resize", drag } });
  }

  cancelResize() {
    const id = this.copyProps.overlay;
    if (windowShared().resizeOverlay === id) windowShared().resizeOverlay = null;
    closeOverlay(id);
  }

  finishResize(event, cx) {
    cx.stop_propagation();
    const geometry = dragGeometry(this.drag, event.position);
    this.cancelResize();
    act("resize-drop", { ...geometry, generation: this.drag.generation });
  }

  renderResize() {
    const t = theme();
    const { viewport, direction } = this.drag;
    const { position, size } = this.preview;
    return resizeCursor(div().id("float-resize-tracker").size_full().relative(), direction)
      .track_focus(this.handle)
      .on_key_down((event, cx) => {
        cx.stop_propagation();
        if (event.key === "escape") this.cancelResize();
      })
      .on_mouse_down("left", (_event, cx) => { cx.stop_propagation(); this.cancelResize(); })
      .on_mouse_move((event, cx) => { this.preview = dragGeometry(this.drag, event.position); cx.notify(); })
      .on_mouse_up("left", (event, cx) => this.finishResize(event, cx))
      .child(div().absolute().left(position.x).top(position.y)
        .w(size.width * viewport.width).h(size.height * viewport.height)
        .rounded(10).border(2).border_color(t.accent)
        .child(div().absolute().right(12).bottom(12).px(8).py(4).rounded(4)
          .bg(t.popover).text_color(t.foreground).text_size(12)
          .child(`${Math.round(size.width * 100)}% × ${Math.round(size.height * 100)}% · release to apply · Esc to cancel`)));
  }

  renderEdge() {
    const t = theme();
    const side = this.copyProps.side;
    const horizontal = side === "top" || side === "bottom";
    const ring = windowShared().keyboard ? t.accent : t.input;
    const root = div().id(`float-resize-${side}`).size_full().relative().bg(t.background)
      .on_mouse_down("left", (event, cx) => {
        const bounds = event.bounds;
        if (!bounds) return;
        const state = readState(shared(STATE_KEY));
        const viewport = window.viewport_size();
        const width = state.size.width * viewport.width;
        const height = state.size.height * viewport.height;
        let direction = { top: "n", bottom: "s", left: "w", right: "e" }[side];
        if (horizontal) {
          const corner = 24 * settings().zoom;
          if (event.position.x < bounds.x + corner) direction += "w";
          else if (event.position.x > bounds.x + bounds.width - corner) direction += "e";
        }
        let y = bounds.y;
        if (side === "bottom") y += bounds.height - height;
        else if (!horizontal) y -= (RESIZE_BORDER + HEADER_HEIGHT) * settings().zoom;
        const position = { x: side === "right" ? bounds.x + bounds.width - width : bounds.x, y };
        this.beginResize(event, cx, direction, position);
      });
    if (!horizontal) {
      const line = div().absolute().top(0).bottom(0).w(1).bg(ring);
      return root.cursor_ew_resize().accessibility_label(`Resize ${side} edge`)
        .child(side === "left" ? line.left(0) : line.right(0));
    }
    const top = side === "top";
    const frame = div().absolute().inset_0().border_l(1).border_r(1).border_color(ring);
    return root.cursor_ns_resize().accessibility_label(`Resize ${side} edge`)
      .child(top ? frame.border_t(1).rounded_t(10) : frame.border_b(1).rounded_b(10))
      .child(resizeCursor(div().absolute().left(0).top(0).bottom(0).w(24), top ? "nw" : "sw"))
      .child(resizeCursor(div().absolute().right(0).top(0).bottom(0).w(24), top ? "ne" : "se")
        .when(!top, el => el.flex().items_center().justify_center().text_color(t.muted)
          .tooltip("Drag any edge or corner to resize · release to apply")
          .child(svg("mods/float-space/size.svg").size(12))));
  }

  // The terminals' font and size from Herdr's settings, so Notes reads like the
  // terminal tabs beside it.
  renderNotes() {
    const t = theme();
    const look = settings();
    return v_flex().id("float-notes").size_full().min_h(0).bg(t.background).text_color(t.foreground)
      .on_mouse_down("left", stop)
      .child(Textarea.new(this.notes).flex_1().min_h(0).w_full().px(16).py(14).bg(t.background).text_color(t.foreground)
        .font_family(look.font_family ?? "JetBrains Mono").text_size(look.font_size ?? 14));
  }

  renderSize() {
    const t = theme();
    const current = readState(shared(STATE_KEY)).size;
    return v_flex().w_full().p(14).gap(10).bg(t.popover).text_color(t.foreground).text_size(12)
      .child(div().font_medium().child("Window size"))
      .child(h_flex().gap(6).children(PRESETS.map(preset => {
        const on = current.width === preset.width && current.height === preset.height;
        return v_flex().id(`float-preset-${preset.id}`).flex_1().py(6).items_center().rounded(6).border_1()
          .border_color(on ? t.accent : t.input).bg(on ? t.selected : t.raised).cursor_pointer().hover(s => s.bg(t.hover))
          .on_mouse_down("left", stop).on_click(() => this.applySize(Math.round(preset.width * 100), Math.round(preset.height * 100)))
          .child(div().child(preset.label))
          .child(div().text_size(11).text_color(t.dim).child(`${Math.round(preset.width * 100)} × ${Math.round(preset.height * 100)}`));
      })))
      .children([["width", "Width"], ["height", "Height"]].map(([key, label]) => {
        const slider = this.sliders[key];
        return v_flex().gap(3)
          .child(h_flex().justify_between().child(label)
            .child(div().text_color(t.muted).child(`${Math.round(slider.value())}%`)))
          .child(Slider.new(slider).accessibility_label(label).w_full().child(
            SliderTrack.new(slider).flex().items_center().h(24).w_full().child(
              // The shell places the thumb's left edge only; center it on the groove.
              SliderIndicator.new(slider).relative().w_full().h(4).rounded(2).bg(t.border)
                .range_style(fill => fill.rounded(2).bg(t.accent))
                .child(SliderThumb.new(slider).size(12).rounded(6).bg(t.foreground).ml(-6).mt(-4)))));
      }))
      .child(h_flex().gap(8).justify_between()
        .child(this.button("float-reset-size", "Reset", (_e, cx) => {
          for (const [key, slider] of Object.entries(this.sliders)) slider.set_value(Math.round(DEFAULT_SIZE[key] * 100));
          cx.notify();
        }))
        .child(this.button("float-apply-size", "Apply", () =>
          this.applySize(...["width", "height"].map(key => Math.round(this.sliders[key].value()))), true)));
  }

  render() {
    if (this.role === "bar") return this.renderBar();
    if (this.role === "notes") return this.renderNotes();
    if (this.role === "size") return this.renderSize();
    if (this.role === "edge") return this.renderEdge();
    if (this.role === "resize") return this.renderResize();
    if (this.role === "run" || this.role === "alert") return div();
    return this.renderLauncher();
  }
}
