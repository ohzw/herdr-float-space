import test from "node:test";
import assert from "node:assert/strict";
import { FloatController } from "../mods/float-space/controller.js";
import { readState, reconcile, returnPane, ownedTerminals, tabName, pressedInWindow, DEFAULT_SIZE, PRESETS, windowSpec, nextTitle, agentAlerts, unseenFinishes, tabStatus, startFolder } from "../mods/float-space/model.js";

// The block a window shows under its header: a terminal or Notes.
function body(spec) {
  return spec.layout.children[1].children[1];
}

function fixture() {
  const controller = new FloatController();
  const data = { state: readState(null), owned: [], killed: [], opened: [], next: 10 };
  const host = {
    getState: () => data.state,
    setState: state => { data.state = state; },
    listOwned: async () => data.owned,
    spawnOwned: async () => { const terminal = { address: `t${data.next++}` }; data.owned.push(terminal); return terminal; },
    killOwned: async address => { data.killed.push(address); data.owned = data.owned.filter(t => t.address !== address); },
    open: spec => { data.opened.push(spec); return `overlay${data.opened.length}`; },
    close: id => { data.closed = id; },
    focused: () => data.current ?? { space: "s1", tab: "tab1", pane: "pane1", terminal: "t1" },
    panes: () => [{ pane: "pane1", tab: "tab1" }, { pane: "pane2", tab: "tab2" }],
    focusPane: pane => { data.returned = pane; data.log?.push("focus"); },
  };
  return { controller, host, data };
}

test("hide/reopen reuses the same terminal and returns focus", async () => {
  const { controller, host, data } = fixture();
  await controller.handle("toggle", host);
  const address = data.state.active;
  data.current = { space: "s1", tab: "tab1", pane: null, terminal: address };
  data.state.notes = "Keep this\nTiếng Việt";
  await controller.handle("toggle", host);
  assert.equal(data.returned, "pane1");
  assert.equal(data.killed.length, 0);
  await controller.handle("toggle", host);
  assert.equal(data.state.active, address);
  assert.equal(data.state.notes, "Keep this\nTiếng Việt");
  assert.equal(data.owned.length, 1);
});

test("a new controller recovers live owned terminals without spawning another", async () => {
  const { controller, host, data } = fixture();
  await controller.handle("show", host);
  const fresh = new FloatController();
  await fresh.handle("show", host);
  assert.equal(data.owned.length, 1);
  assert.equal(data.state.tabs.length, 1);
});

test("lost saved addresses never authorize a terminal kill", async () => {
  const { controller, host, data } = fixture();
  data.state = readState({ version: 1, tabs: [{ address: "t1", title: "Old terminal" }], active: "t1" });
  await assert.rejects(() => controller.handle("end-t1", host), /no longer belongs/);
  assert.deepEqual(data.killed, []);
});

test("changing tabs and window size preserves notes and terminal identities", async () => {
  const { controller, host, data } = fixture();
  await controller.handle("show", host);
  const first = data.state.active;
  await controller.handle("new", host);
  const second = data.state.active;
  assert.notEqual(first, second);
  data.state.notes = "unsent plan";
  await controller.handle(`select-${first}`, host);
  await controller.handle("notes", host);
  await controller.handle("resize-90-86", host);
  assert.equal(data.state.active, first);
  assert.equal(data.state.notes, "unsent plan");
  assert.equal(data.state.page, "notes");
  assert.deepEqual(data.state.size, { width: 0.90, height: 0.86 });
  assert.equal(data.owned.length, 2);
});

test("closing a tab ends only that terminal, without a question, like Herdr's tabs", async () => {
  const { controller, host, data } = fixture();
  await controller.handle("show", host);
  const first = data.state.active;
  await controller.handle("new", host);
  const second = data.state.active;
  await controller.handle(`end-${second}`, host);
  assert.deepEqual(data.killed, [second]);
  assert.equal(data.state.active, first);
  assert.equal(body(data.opened.at(-1)).content.terminal, first);
});

test("closing the shown tab shows the next one before its terminal ends", async () => {
  const { controller, host, data } = fixture();
  await controller.handle("show", host);
  const first = data.state.active;
  await controller.handle("new", host);
  const second = data.state.active;
  const log = [];
  const open = host.open, kill = host.killOwned;
  host.open = spec => { log.push(`open ${body(spec).content.terminal}`); return open(spec); };
  host.killOwned = async address => { log.push(`kill ${address}`); return kill(address); };
  await controller.handle(`end-${second}`, host);
  assert.deepEqual(log, [`open ${first}`, `kill ${second}`]);
});

test("a failed kill puts the closed tab back in view", async () => {
  const { controller, host, data } = fixture();
  await controller.handle("show", host);
  await controller.handle("new", host);
  const second = data.state.active;
  host.killOwned = async () => { throw new Error("kill failed"); };
  await assert.rejects(() => controller.handle(`end-${second}`, host), /kill failed/);
  assert.equal(data.state.active, second);
  assert.equal(data.state.tabs.length, 2);
  assert.equal(body(data.opened.at(-1)).content.terminal, second);
});

test("notes edited while the core is replying are preserved", async () => {
  const { controller, host, data } = fixture();
  host.listOwned = async () => { data.state.notes = "edited during refresh"; return data.owned; };
  await controller.handle("show", host);
  assert.equal(data.state.notes, "edited during refresh");
});

test("spawn failure keeps the existing saved notes and exposes no fake terminal", async () => {
  const { controller, host, data } = fixture();
  data.state.notes = "important note";
  host.spawnOwned = async () => { throw new Error("core unavailable"); };
  await assert.rejects(() => controller.handle("show", host), /core unavailable/);
  assert.equal(data.state.notes, "important note");
  assert.deepEqual(data.state.tabs, []);
  assert.deepEqual(data.opened, []);
});

test("the last exited terminal leaves Notes accessible without spawning a shell", async () => {
  const { controller, host, data } = fixture();
  await controller.handle("show", host);
  const old = data.state.active;
  data.owned = [];
  await controller.handle("reconcile", host);
  assert.notEqual(data.state.active, old);
  assert.equal(data.state.tabs.length, 0);
  assert.equal(data.state.page, "notes");
  assert.equal(data.owned.length, 0);
});

test("closing after a space change returns to that space, not the old one", () => {
  const previous = { tab: "old", pane: "old-pane" };
  const current = { tab: "new", terminal: "t10" };
  assert.equal(returnPane(previous, current, [{ tab: "new", pane: "new-pane" }], ["t10"]), "new-pane");
  assert.equal(returnPane(previous, { ...current, terminal: "t2" }, [], ["t10"]), null);
  assert.equal(returnPane(previous, { tab: "new", pane: "new-pane", terminal: "t2" }, [{ tab: "new", pane: "new-pane" }], ["t10"]), "new-pane");
});

test("owned-terminal recovery and duplicate normalization preserve notes", () => {
  const state = readState({ notes: "persistent", tabs: [{ address: "t10" }, { address: "t10" }, { address: "bad/path" }] });
  const restored = reconcile(state, [{ address: "t10" }, { address: "t11" }]);
  assert.equal(restored.tabs.length, 2);
  assert.equal(restored.notes, "persistent");
  assert.throws(() => readState({ version: 3 }), /newer version/);
});

test("a live host snapshot reopens without waiting for core or rewriting saved state", async () => {
  const { controller, host, data } = fixture();
  await controller.handle("show", host);
  controller.hide(host);
  host.liveOwned = () => data.owned;
  host.listOwned = async () => { throw new Error("must not query core on warm open"); };
  host.setState = () => { throw new Error("must not rewrite unchanged state"); };
  await controller.handle("show", host);
  assert.equal(data.opened.length, 2);
  assert.equal(data.owned.length, 1);
});

test("unchanged reconciliation does not query, persist or remount", async () => {
  const { controller, host, data } = fixture();
  await controller.handle("show", host);
  host.liveOwned = () => data.owned;
  for (const method of ["listOwned", "setState", "open"]) {
    host[method] = () => { throw new Error(`unexpected ${method}`); };
  }
  await controller.handle("reconcile", host);
  await controller.handle(`select-${data.state.active}`, host);
});

test("size, notes and live tab selection do not wait for core", async () => {
  const { controller, host, data } = fixture();
  await controller.handle("show", host);
  const first = data.state.active;
  await controller.handle("new", host);
  host.liveOwned = () => data.owned;
  host.listOwned = async () => { throw new Error("UI change must not wait for core"); };
  data.state.notes = "keep my draft";
  await controller.handle("resize-73-47", host);
  await controller.handle("notes", host);
  await controller.handle(`select-${first}`, host);
  assert.deepEqual(data.state.size, { width: 0.73, height: 0.47 });
  assert.equal(data.opened.at(-1).width, 0.73);
  assert.equal(data.opened.at(-1).height, 0.47);
  assert.equal(data.state.notes, "keep my draft");
  assert.equal(data.state.active, first);
  const reopened = new FloatController();
  await reopened.handle("show", host);
  assert.equal(data.opened.at(-1).width, 0.73);
});

test("each size opens under its own key, closing the old window once the new one shows", async () => {
  const { controller, host, data } = fixture();
  const closed = [];
  host.close = id => closed.push(id);
  await controller.handle("show", host);
  const first = controller.overlay;
  assert.equal(data.opened.at(-1).key, "float-space.window.50x60");
  await controller.handle("notes", host);
  assert.deepEqual(closed, []);
  const second = controller.overlay;
  await controller.handle("resize-20-50", host);
  assert.equal(data.opened.at(-1).key, "float-space.window.20x50");
  assert.deepEqual(closed, [second]);
  assert.notEqual(controller.overlay, first);
  controller.hide(host);
  assert.equal(closed.at(-1), `overlay${data.opened.length}`);
});

test("live snapshot cannot authorize ending a terminal whose ownership changed", async () => {
  const { controller, host, data } = fixture();
  await controller.handle("show", host);
  const address = data.state.active;
  const stale = [...data.owned];
  host.liveOwned = () => stale;
  data.owned = [];
  await assert.rejects(() => controller.handle(`end-${address}`, host), /no longer belongs/);
  assert.deepEqual(data.killed, []);
});

test("an empty host snapshot falls back to core instead of spawning a duplicate", async () => {
  const { controller, host, data } = fixture();
  await controller.handle("show", host);
  const address = data.state.active;
  controller.hide(host);
  host.liveOwned = () => [];
  await controller.handle("show", host);
  assert.equal(data.state.active, address);
  assert.equal(data.owned.length, 1);
});

test("live ownership requires both labels, local address and running state", () => {
  const terminal = { address: "t10", state: "live", labels: { "herdr.mod": "float-space", "herdr.float-space": "/app" } };
  const list = [terminal, { ...terminal, address: "remote/t10" },
    { ...terminal, address: "t11", state: "exited" },
    { ...terminal, address: "t12", labels: { ...terminal.labels, "herdr.float-space": "/other" } },
    { ...terminal, address: "t13", labels: { "herdr.float-space": "/app" } }];
  assert.deepEqual(ownedTerminals(list, "/app"), [terminal]);
});

test("missing and invalid window sizes become bounded usable values", () => {
  assert.deepEqual(readState({ notes: "legacy draft" }).size, DEFAULT_SIZE);
  const state = readState({ size: { width: NaN, height: -1, notes: 100 }, notes: "draft" });
  assert.deepEqual(state.size, { width: DEFAULT_SIZE.width, height: 0.30 });
  assert.equal(state.notes, "draft");
});

test("the default window is 50% wide and 60% tall", () => {
  assert.deepEqual(readState(null).size, { width: 0.50, height: 0.60 });
});

test("Notes is a full-width tab; returning to a terminal reuses its process", async () => {
  const { controller, host, data } = fixture();
  await controller.handle("show", host);
  const address = data.state.active;
  data.state.notes = "a persisted note";
  await controller.handle("notes", host);
  const spec = windowSpec(data.state);
  assert.equal(body(spec).content.mod, "float-space");
  assert.equal(body(spec).content.props.role, "notes");
  await controller.handle(`select-${address}`, host);
  assert.equal(data.state.page, "terminal");
  assert.equal(data.owned.length, 1);
  assert.equal(data.state.notes, "a persisted note");
  assert.equal(body(data.opened.at(-1)).content.terminal, address);
});

test("saved Notes page opens without spawning an unnecessary terminal after restart", async () => {
  const { host, data } = fixture();
  data.state = readState(JSON.parse(JSON.stringify({ version: 2, notes: "persisted on disk", page: "notes" })));
  const restarted = new FloatController();
  await restarted.handle("show", host);
  assert.equal(data.state.notes, "persisted on disk");
  assert.equal(data.state.page, "notes");
  assert.equal(data.owned.length, 0);
});

test("showing an already visible window or selecting a hidden tab never remounts", async () => {
  const { controller, host, data } = fixture();
  await controller.handle("show", host);
  const first = data.state.active;
  await controller.handle("new", host);
  const count = data.opened.length;
  await controller.handle("show", host);
  assert.equal(data.opened.length, count);
  controller.hide(host);
  await controller.handle(`select-${first}`, host);
  assert.equal(data.opened.length, count);
  assert.equal(controller.overlay, null);
});

test("failed ownership query is never treated as an empty list", async () => {
  const { controller, host, data } = fixture();
  await controller.handle("show", host);
  controller.hide(host);
  const address = data.state.active;
  host.liveOwned = () => [];
  host.listOwned = async () => { throw new Error("core unavailable"); };
  await assert.rejects(() => controller.handle("show", host), /core unavailable/);
  assert.equal(data.state.active, address);
  assert.equal(data.owned.length, 1);
});

test("a window Herdr closed when its terminal ended reopens on the next tab at once", async () => {
  const { controller, host, data } = fixture();
  host.liveOwned = () => data.owned;
  await controller.handle("show", host);
  const first = data.state.active;
  await controller.handle("new", host);
  const second = data.state.active;
  assert.equal(controller.ended(data.owned), false);
  data.owned = data.owned.filter(terminal => terminal.address !== second);
  assert.equal(controller.ended(data.owned), true);
  await controller.handle("reconcile", host);
  assert.equal(data.state.active, first);
  assert.equal(body(data.opened.at(-1)).content.terminal, first);
  assert.equal(controller.ended(data.owned), false);
});

test("toggling after Herdr closed the window shows it instead of hiding nothing", async () => {
  const { controller, host, data } = fixture();
  host.liveOwned = () => data.owned;
  await controller.handle("show", host);
  controller.ended(data.owned);
  data.owned = [];
  const count = data.opened.length;
  await controller.handle("toggle", host);
  assert.equal(data.opened.length, count + 1);
  assert.equal(data.state.page, "notes");
  assert.equal(data.owned.length, 0);
  assert.notEqual(controller.overlay, null);
});

test("a terminal a lagging snapshot hasn't listed yet is not treated as ended", async () => {
  const { controller, host, data } = fixture();
  await controller.handle("show", host);
  assert.equal(controller.ended([]), false);
  const count = data.opened.length;
  await controller.handle("toggle", host);
  assert.equal(controller.overlay, null);
  assert.equal(data.opened.length, count);
});

test("the last terminal ending while hidden opens Notes instead of a new shell", async () => {
  const { controller, host, data } = fixture();
  await controller.handle("show", host);
  controller.hide(host);
  data.owned = [];
  await controller.handle("show", host);
  assert.equal(data.state.page, "notes");
  assert.equal(data.owned.length, 0);
  assert.equal(body(data.opened.at(-1)).content.props.role, "notes");
});

test("tabs, tooltips and the end dialog share one name", async () => {
  const tab = { address: "t10", title: "Terminal 1" };
  assert.equal(tabName(tab, { program: { agent: true, name: "Codex" } }), "Codex");
  assert.equal(tabName(tab, { program: { agent: false, name: "fish" } }), "Terminal 1");
  assert.equal(tabName(tab, undefined), "Terminal 1");
});

test("the mod draws the window's border around the terminal, inside pane-card corners", () => {
  const spec = windowSpec(readState({ tabs: [{ address: "t7" }], active: "t7" }), 7);
  assert.equal(spec.frame, "none");
  assert.equal(spec.layout.border, undefined);
  assert.equal(spec.layout.radius, 10);
  assert.equal(spec.layout.children[0].content.props.generation, 7);
  const [left, , right] = spec.layout.children[1].children;
  assert.deepEqual([left, right, spec.layout.children[2]].map(edge => [edge.content.props.side, edge.size.px]), [["left", 1], ["right", 1], ["bottom", 10]]);
  assert.equal(body(spec).content.terminal, "t7");
});

test("presets: a small window, the default, a large one, all within bounds", () => {
  assert.deepEqual(PRESETS.map(preset => preset.id), ["small", "normal", "large"]);
  assert.deepEqual({ width: PRESETS[1].width, height: PRESETS[1].height }, DEFAULT_SIZE);
  for (const preset of PRESETS) {
    assert.deepEqual(readState({ size: preset }).size, { width: preset.width, height: preset.height });
  }
  assert.deepEqual({ width: PRESETS[0].width, height: PRESETS[0].height }, { width: 0.20, height: 0.50 });
  assert.ok(PRESETS[2].width > PRESETS[1].width && PRESETS[2].height > PRESETS[1].height);
});

test("a press counts as inside the window from its border to its bottom edge", () => {
  const bar = { x: 100, y: 50, width: 400, height: 30 };
  assert.equal(pressedInWindow({ x: 300, y: 200 }, bar, 300), true);
  assert.equal(pressedInWindow({ x: 99, y: 49 }, bar, 300), true);
  assert.equal(pressedInWindow({ x: 300, y: 349 }, bar, 300), true);
  assert.equal(pressedInWindow({ x: 300, y: 351 }, bar, 300), false);
  assert.equal(pressedInWindow({ x: 98, y: 200 }, bar, 300), false);
  assert.equal(pressedInWindow({ x: 502, y: 200 }, bar, 300), false);
  assert.equal(pressedInWindow({ x: 300, y: 20 }, bar, 300), false);
});

test("the header's close after Herdr ended its terminal shows the next tab at once", async () => {
  const { controller, host, data } = fixture();
  host.liveOwned = () => data.owned;
  host.terminals = () => [{ address: "t1", state: "live" }, ...data.owned.map(terminal => ({ ...terminal, state: "live" }))];
  await controller.handle("show", host);
  const first = data.state.active;
  await controller.handle("new", host);
  const second = data.state.active;
  data.owned = data.owned.filter(terminal => terminal.address !== second);
  const count = data.opened.length;
  await controller.windowClosed(host, controller.generation);
  assert.equal(data.opened.length, count + 1);
  assert.equal(body(data.opened.at(-1)).content.terminal, first);
  assert.deepEqual(data.state.tabs.map(tab => tab.address), [first]);
  assert.notEqual(controller.overlay, null);
});

test("a window closed before the snapshot dropped its terminal asks core, then shows the next tab", async () => {
  const { controller, host, data } = fixture();
  host.liveOwned = () => data.owned;
  await controller.handle("show", host);
  const first = data.state.active;
  await controller.handle("new", host);
  const second = data.state.active;
  // Herdr closes the window as the terminal ends; the snapshot still lists it.
  const lagging = data.owned.map(terminal => ({ ...terminal, state: "live" }));
  host.terminals = () => lagging;
  data.owned = data.owned.filter(terminal => terminal.address !== second);
  const count = data.opened.length;
  await controller.windowClosed(host, controller.generation);
  assert.equal(data.opened.length, count + 1);
  assert.equal(body(data.opened.at(-1)).content.terminal, first);
  assert.deepEqual(data.state.tabs.map(tab => tab.address), [first]);
});

test("a press that shows the window while core replies is not followed by another mount", async () => {
  const { controller, host, data } = fixture();
  host.liveOwned = () => data.owned;
  await controller.handle("show", host);
  await controller.handle("new", host);
  const second = data.state.active;
  const lagging = data.owned.map(terminal => ({ ...terminal, state: "live" }));
  host.terminals = () => lagging;
  data.owned = data.owned.filter(terminal => terminal.address !== second);
  const listOwned = host.listOwned;
  let reply;
  host.listOwned = () => new Promise(resolve => { reply = resolve; });
  const closing = controller.windowClosed(host, controller.generation);
  host.listOwned = listOwned;
  await controller.handle("toggle", host);
  const count = data.opened.length;
  reply(data.owned);
  await closing;
  assert.equal(data.opened.length, count);
});

test("the last terminal ending in view shows Notes once core confirms", async () => {
  const { controller, host, data } = fixture();
  host.liveOwned = () => data.owned;
  await controller.handle("show", host);
  const only = data.state.active;
  host.terminals = () => [{ address: only, state: "live" }];
  data.owned = [];
  await controller.windowClosed(host, controller.generation);
  assert.equal(data.state.page, "notes");
  assert.equal(body(data.opened.at(-1)).content.props.role, "notes");
  assert.equal(data.state.tabs.length, 0);
});

test("a layout change closing the window leaves it closed and the next toggle opens it", async () => {
  const { controller, host, data } = fixture();
  host.liveOwned = () => data.owned;
  host.terminals = () => data.owned.map(terminal => ({ ...terminal, state: "live" }));
  await controller.handle("show", host);
  const count = data.opened.length;
  await controller.windowClosed(host, controller.generation);
  assert.equal(controller.overlay, null);
  assert.equal(data.opened.length, count);
  await controller.handle("toggle", host);
  assert.equal(data.opened.length, count + 1);
});

test("closes from a replaced or hidden window are not taken for Herdr's", async () => {
  const { controller, host, data } = fixture();
  host.terminals = () => [];
  await controller.handle("show", host);
  const old = controller.generation;
  await controller.handle("new", host);
  await controller.windowClosed(host, old);
  assert.notEqual(controller.overlay, null);
  data.log = [];
  host.close = () => { data.log.push("close"); controller.windowClosed(host, controller.generation); };
  controller.hide(host);
  assert.deepEqual(data.log, ["close", "focus"]);
  assert.equal(controller.overlay, null);
});

test("hiding closes the overlay window before refocusing the previous pane", async () => {
  const { controller, host, data } = fixture();
  await controller.handle("show", host);
  data.log = [];
  const origClose = host.close;
  host.close = id => { data.log.push("close"); origClose(id); };
  controller.hide(host);
  assert.deepEqual(data.log, ["close", "focus"]);
  assert.equal(data.returned, "pane1");
});

test("an empty snapshot while the window is open still hides it on toggle", async () => {
  const { controller, host, data } = fixture();
  host.liveOwned = () => data.owned;
  await controller.handle("show", host);
  controller.ended(data.owned);
  host.liveOwned = () => [];
  const count = data.opened.length;
  await controller.handle("toggle", host);
  assert.equal(controller.overlay, null);
  assert.equal(data.opened.length, count);
  assert.equal(data.owned.length, 1);
});

test("a new shell takes the lowest number no open tab uses", async () => {
  const { controller, host, data } = fixture();
  await controller.handle("show", host);
  await controller.handle("new", host);
  await controller.handle("new", host);
  assert.deepEqual(data.state.tabs.map(tab => tab.title), ["Terminal 1", "Terminal 2", "Terminal 3"]);
  await controller.handle(`end-${data.state.tabs[1].address}`, host);
  await controller.handle("new", host);
  assert.deepEqual(data.state.tabs.map(tab => tab.title), ["Terminal 1", "Terminal 3", "Terminal 2"]);
  assert.equal(data.state.sequence, 4);
  assert.equal(nextTitle([{ title: "Terminal 37" }, { title: "notes" }]), "Terminal 1");
  assert.equal(nextTitle([]), "Terminal 1");
});

test("recovered shells are numbered after the open tabs too", () => {
  const state = readState({ version: 2, tabs: [{ address: "t1", title: "Terminal 1" }], sequence: 40 });
  const after = reconcile(state, [{ address: "t1" }, { address: "t2" }]);
  assert.deepEqual(after.tabs.map(tab => tab.title), ["Terminal 1", "Terminal 2"]);
  assert.equal(after.sequence, 41);
});

test("a new shell starts where the open space's terminal is, not the space's stored folder", () => {
  const homeDir = "/home/thuanlee";
  const spaces = [
    { id: "s1", folder: "/work/app", machine: null, active: true, tabs: [{ id: "tab1", active: true }] },
    { id: "s2", folder: "/work/other", machine: null, active: false, tabs: [{ id: "tab2", active: true }] },
    { id: "s3", folder: "/remote/repo", machine: "laptop", active: false },
    { id: "s4", folder: "", machine: null, active: false },
  ];
  const here = { space: "s1", pane: "p1", terminal: "t1", cwd: "/work/app/mods" };
  assert.equal(startFolder(spaces, here, homeDir), "/work/app/mods");
  assert.equal(startFolder(
    [{ id: "s1", folder: homeDir, machine: null, active: true, tabs: [{ id: "tab1", active: true }] }],
    { space: "s1", pane: "p1", terminal: "t1", cwd: "/work/app" },
    homeDir,
  ), "/work/app");
  assert.equal(startFolder(spaces, { space: "s2", pane: "p2", cwd: "/work/other" }, homeDir), "/work/other");
  assert.equal(startFolder(spaces, { space: "s3", pane: "p3", cwd: "/remote/repo" }, homeDir), homeDir);
  assert.equal(startFolder(spaces, { space: "s4" }, homeDir), homeDir);
  assert.equal(startFolder(spaces, null, homeDir), "/work/app");
  assert.equal(startFolder([{ id: "s9", folder: "/remote/repo", machine: "laptop", active: true }], null, homeDir), homeDir);
  assert.equal(startFolder(spaces, { space: "missing" }, homeDir), homeDir);
  assert.equal(startFolder([], { space: "s1" }, homeDir), homeDir);
  assert.equal(startFolder(null, null, homeDir), homeDir);
  assert.equal(startFolder([{ id: "s1", folder: 12, machine: null, active: true }], null, homeDir), homeDir);
  // A click in the scratch terminal has no pane. Use the space's pane, not that shell.
  assert.equal(startFolder(
    [{ id: "s1", folder: homeDir, machine: null, active: true, tabs: [{ id: "tab1", active: true }] }],
    { space: "s1", pane: null, terminal: "t30", cwd: homeDir },
    homeDir,
    [{ pane: "p1", tab: "tab1", terminal: "t1", cwd: "/work/app", focused: true }],
  ), "/work/app");
});

test("agent alerts: finishing, needing the person, never the one being watched", () => {
  const first = agentAlerts(null, [{ address: "t1", status: "working" }, { address: "t2", status: "working" }], null);
  assert.deepEqual(first.alerts, [], "the first look only takes note");
  const next = agentAlerts(first.statuses, [{ address: "t1", status: "idle" }, { address: "t2", status: "blocked" }, { address: "t3", status: "done" }], null);
  assert.deepEqual(next.alerts, [{ address: "t1", kind: "done" }, { address: "t2", kind: "blocked" }]);
  const watched = agentAlerts(first.statuses, [{ address: "t1", status: "done" }, { address: "t2", status: "error" }], "t1");
  assert.deepEqual(watched.alerts, [{ address: "t2", kind: "blocked" }], "an error needs the person, as in Herdr");
  const again = agentAlerts({ t1: "blocked", t2: "error" }, [{ address: "t1", status: "error" }, { address: "t2", status: "blocked" }], null);
  assert.deepEqual(again.alerts, [], "blocked ↔ error is one need, alerted once");
  const quiet = agentAlerts({ t1: "idle", t2: null }, [{ address: "t1", status: "done" }, { address: "t2", status: "idle" }], null);
  assert.deepEqual(quiet.alerts, [], "only working → idle/done counts as finishing");
});

test("button dot: one state, a finish not yet seen, until its tab shows", () => {
  const idle = [{ address: "t1", status: "idle" }, { address: "t2", status: null }];
  assert.deepEqual(unseenFinishes([], [], idle, null), { unseen: [], dot: false }, "idle agents and shells: no dot");
  const busy = [{ address: "t1", status: "working" }, { address: "t2", status: "blocked" }, { address: "t3", status: "error" }];
  assert.deepEqual(unseenFinishes([], [{ address: "t2", kind: "blocked" }], busy, null), { unseen: [], dot: false },
    "working, needing you and errors don't light it");
  const done = [{ address: "t1", kind: "done" }];
  const finished = unseenFinishes([], done, [{ address: "t1", status: "idle" }, { address: "t2", status: "working" }], null);
  assert.deepEqual(finished, { unseen: ["t1"], dot: true });
  assert.deepEqual(unseenFinishes(finished.unseen, [], [{ address: "t1", status: "idle" }], null), { unseen: ["t1"], dot: true },
    "the finish stays while hidden");
  assert.deepEqual(unseenFinishes(finished.unseen, [], [{ address: "t1", status: "idle" }], "t1"), { unseen: [], dot: false },
    "showing its tab marks it seen");
  assert.deepEqual(unseenFinishes([], done, [{ address: "t1", status: "idle" }], "t1"), { unseen: [], dot: false },
    "a finish while its tab shows is seen at once");
  assert.deepEqual(unseenFinishes(["t1"], [], [{ address: "t1", status: "working" }], null), { unseen: [], dot: false },
    "working again clears it");
  assert.deepEqual(unseenFinishes(["t1"], [], [{ address: "t1", status: "blocked" }], null), { unseen: [], dot: false },
    "needing you again clears it, as in Herdr");
  assert.deepEqual(unseenFinishes(["t1"], [], [], null), { unseen: ["t1"], dot: false },
    "a lagging snapshot keeps the finish without lighting the dot");
});

test("tab status: the done dot only until the tab has been seen, like Herdr's tabs", () => {
  assert.equal(tabStatus("working", false), "working");
  assert.equal(tabStatus("blocked", false), "blocked");
  assert.equal(tabStatus("done", true), "done", "a finish not yet seen");
  assert.equal(tabStatus("done", false), null, "seen: an agent still reporting done shows nothing");
  assert.equal(tabStatus("idle", true), null, "idle agents keep showing nothing");
  assert.equal(tabStatus(null, false), null);
});

test("a failed reconciliation retries the same snapshot and preserves notes", async () => {
  const { controller, host, data } = fixture();
  await controller.handle("show", host);
  const first = data.state.active;
  data.owned.push({ address: "t99" });
  host.liveOwned = () => data.owned;
  host.listOwned = async () => { throw new Error("core temporarily unavailable"); };
  assert.equal(controller.needsReconcile(host), true);
  await assert.rejects(controller.handle("reconcile", host), /temporarily unavailable/);
  data.state.notes = "Written while core was unavailable";
  assert.equal(controller.needsReconcile(host), true);
  host.listOwned = async () => data.owned;
  await controller.handle("reconcile", host);
  assert.equal(controller.needsReconcile(host), false);
  assert.deepEqual(data.state.tabs.map(t => t.address), [first, "t99"]);
  assert.equal(data.state.notes, "Written while core was unavailable");
  assert.equal(data.opened.length, 1);
});

test("a successfully confirmed lagging snapshot is not queried on every tick", async () => {
  const { controller, host, data } = fixture();
  await controller.handle("show", host);
  host.liveOwned = () => [];
  let queries = 0;
  host.listOwned = async () => { queries++; return data.owned; };
  for (let i = 0; i < 10; i++) {
    if (controller.needsReconcile(host)) await controller.handle("reconcile", host);
  }
  assert.equal(queries, 1);
  host.liveOwned = () => data.owned;
  assert.equal(controller.needsReconcile(host), false);
  host.liveOwned = () => [];
  assert.equal(controller.needsReconcile(host), true);
  await controller.handle("hide", host);
  assert.equal(controller.needsReconcile(host), false);
});

test("an old reconciliation cannot acknowledge a newer snapshot", async () => {
  const { controller, host, data } = fixture();
  await controller.handle("show", host);
  let live = [];
  host.liveOwned = () => live;
  host.listOwned = async () => {
    live = [...data.owned, { address: "t99" }];
    return data.owned;
  };
  await controller.handle("reconcile", host);
  assert.equal(controller.needsReconcile(host), true);
});

test("a toast reveals its own terminal after hiding, without spawning or ending a shell", async () => {
  const { controller, host, data } = fixture();
  await controller.handle("show", host);
  const target = data.state.active;
  await controller.handle("new", host);
  await controller.handle("notes", host);
  data.state.notes = "Keep this note";
  await controller.handle("hide", host);
  data.current = { space: "s2", tab: "tab2", pane: "pane2", terminal: "t2" };
  await controller.handle(`reveal-${target}`, host);
  assert.equal(body(data.opened.at(-1)).content.terminal, target);
  assert.equal(data.state.page, "terminal");
  assert.equal(data.state.notes, "Keep this note");
  assert.equal(data.owned.length, 2);
  assert.deepEqual(data.killed, []);
  await controller.handle("hide", host);
  assert.equal(data.returned, "pane2");
});

test("a toast recovers its terminal into a fresh controller", async () => {
  const { host, data } = fixture();
  data.owned = [{ address: "t99" }];
  const fresh = new FloatController();
  await fresh.handle("reveal-t99", host);
  assert.equal(body(data.opened.at(-1)).content.terminal, "t99");
  assert.equal(data.owned.length, 1);
});

test("a stale toast cannot show an unrelated terminal, even in a lagging live snapshot", async () => {
  const { controller, host, data } = fixture();
  await controller.handle("show", host);
  const target = data.state.active;
  await controller.handle("hide", host);
  host.liveOwned = () => [{ address: target }];
  data.owned = [];
  const before = structuredClone(data.state);
  await assert.rejects(controller.handle(`reveal-${target}`, host), /no longer running/);
  assert.deepEqual(data.state, before);
  assert.equal(controller.overlay, null);
  assert.equal(data.opened.length, 1);
  assert.deepEqual(data.killed, []);
});

test("toast ownership failures leave the currently shown page intact", async () => {
  const { controller, host, data } = fixture();
  await controller.handle("show", host);
  await controller.handle("notes", host);
  const before = structuredClone(data.state);
  const mounted = controller.overlay;
  host.listOwned = async () => { throw new Error("offline"); };
  await assert.rejects(controller.handle(`reveal-${data.state.active}`, host), /offline/);
  assert.deepEqual(data.state, before);
  assert.equal(controller.overlay, mounted);
});

test("keyboard navigation wraps through Notes and terminals without touching processes", async () => {
  const { controller, host, data } = fixture();
  await controller.handle("show", host);
  const first = data.state.active;
  await controller.handle("new", host);
  const second = data.state.active;
  data.state.notes = "Unsaved command draft";
  await controller.handle("next", host);
  assert.equal(data.state.page, "notes");
  await controller.handle("next", host);
  assert.equal(data.state.active, first);
  assert.equal(data.state.page, "terminal");
  await controller.handle("prev", host);
  assert.equal(data.state.page, "notes");
  await controller.handle("prev", host);
  assert.equal(data.state.active, second);
  assert.equal(data.state.page, "terminal");
  assert.equal(data.owned.length, 2);
  assert.deepEqual(data.killed, []);
  assert.equal(data.state.notes, "Unsaved command draft");
});

test("keyboard navigation is a no-op while hidden or with only Notes", async () => {
  const { controller, host, data } = fixture();
  data.state.page = "notes";
  await controller.handle("show", host);
  await controller.handle("next", host);
  await controller.handle("prev", host);
  assert.equal(data.opened.length, 1);
  assert.equal(data.owned.length, 0);
  await controller.handle("hide", host);
  await controller.handle("next", host);
  assert.equal(controller.overlay, null);
  assert.equal(data.opened.length, 1);
});
