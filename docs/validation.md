# Validation

Checked on 2026-10-31 with Herdr app 0.1.10, core 0.1.15, and re-checked on
2026-11-01 with Herdr app 0.1.11, core 0.1.16 (see "Herdr 0.1.11"), on Linux
(KDE Wayland), in the shipped `main` layout. This records technical checks;
day-to-day comfort is for the person using it to judge.

## Automated checks

- `npm test`: 43 passing lifecycle and state tests.
- `python3 -m unittest discover -s tests -p 'test_*.py'`: 4 passing installer tests.
- `herdr-app check mods/float-space`: passes (0.1.10 and 0.1.11).
- CI runs the first two on every push and pull request (Node 22 and 24,
  Python 3.10 and 3.13), plus JSON and installer file-list checks.

The lifecycle tests cover reusing hidden terminals, recovery into a fresh
controller, refusing to end a terminal whose ownership core no longer
confirms, notes edited while core replies, spawn failures, failed or empty
core queries, warm reopening without a core query, no-op reconciliation
without writes, focus returning after a space change, Herdr closing the
window when its terminal ends (with a lagging and an up-to-date snapshot, the
last terminal, and a press that reopens the window meanwhile), layout changes,
closes from replaced or hidden windows, one window key per size, and the
presets. The installer tests cover shortcut conflicts, repeat installs and
refusing to overwrite edited or extra installed files.

## Running app, current build

Checked with the app CLI (`herdr-app do`, `status`, `shot`), `hc` and the
journal, without synthetic mouse or keyboard input. Commands other than the
shortcut (Notes, new, select, resize) were sent through a temporary hook in
the installed copy that was removed afterwards; the installed files then
matched the installer's record again.

| Check | Result |
| --- | --- |
| Shortcut toggles (`mod.open:float-space`): 6, then 5 and 4 across two hot reloads, then 6 more | All correct, no command copies left over; the new state was already reported at the first poll (0.07 s) |
| An earlier design ran commands through a promise queue shared by copies | After a hot reload the journal showed `error in a promise continuation: interrupted` and toggles lagged one press; replaced by one copy per command and a lease |
| `hc kill` of the shown terminal, before the fix | Herdr closed the window while `terminals()` still listed the terminal as live; the window stayed closed |
| Handing that check from the header's `close()` to a new command copy | The copy hung on its first `hc` call and ran only after the next reload |
| Asking core inside the header's `close()`, twice | Reopened on the next tab 14–15 ms after the close |
| Window border drawn by the mod's own blocks (header top, 1px sides, 10px bottom band) | Continuous all the way round, corners included; `accent` `(97,175,239)` right after opening, `input` `(64,68,73)` on all four sides after `pane.focus` moved the keyboard to a pane outside |
| Border redraw, 3 rounds: `pane.focus` to a pane outside, then hide and show; screenshots about 0.1 s apart | All four sides always the same color; `input` within 0.09–0.14 s (through the 150 ms check), `accent` on showing |
| Earlier border redraws | Polling in each block: the person saw the sides change before the header. Calling the edge views' `cx.notify()` from the header: header `input`, sides still `accent` 0.4 s later, all `input` after about 1.4 s |
| The person clicking into the window's terminal and out to a pane, several times | Border changed at once, all sides together |
| Header | Notes icon and label, divider, terminal tabs with program icons |
| Notes | Terminal font from settings (JetBrains Mono 14) |
| Size popup | Three presets; the current size outlined |
| A former 32 × 90 preset with a single window key | Reopened at the remembered spot (424, 353) and ran about 210 px past the app's bottom edge |
| 32 × 90 and 50 × 60 with one key per size | Each opened centered; 32 × 90 at about (870, 71), inside the app |
| Focus, traced while the person clicked into the window's terminal, then a pane outside, and typed | `focused()` kept naming the pane underneath after the click into the window, so focus stayed unmarked while typing went into the window; outside, typing reached the pane. The header now decides from presses (`on_mouse_down_out`) |
| `terminal_menu` set on the window's layout, the person right-clicking its terminal | Ignored: Herdr's own pane menu showed; removed again |
| Installed with `scripts/install.py --update`, no layout file | No mod errors in `herdr-app status` |

Not checked with real input in this build: closing the shown tab with ×
since it shows the next tab before ending the terminal, clicking a header
tab from a pane outside, clicking Notes, presets, ×, dragging the window,
and typing into Notes. The size button a second time was checked with real
input on 0.1.11, below. A
core reply slower than the 250 ms Herdr gives `close()` would leave the
window closed until the next press.

## Herdr 0.1.11

Herdr 0.1.11 fixed three things this file had left open: the window freezing
while mods run, popups stacking when opened again, and mod tooltips in
embedded windows. Re-checked on 2026-11-01 with core 0.1.16, the mod files
unchanged from 0.1.0. The last two used real mouse events (a temporary
uinput pointer outside this repository) with the window at Small (20 × 50).

| Check | Result |
| --- | --- |
| First opening after a hot reload (a comment appended to the installed `main.js`, then the original restored), 11 times with Herdr on screen and every screenshot a new frame | The window was in the first screenshot each time (0.13–0.34 s after the command); `status` reported it after 0.04–0.27 s and answered within 0.04 s throughout, so the main thread stayed free. Warm openings: same first screenshot |
| The same, 8 earlier tries in that session | Not counted: the detector only looked where the Large window's header sits, and the window had meanwhile been set to Small and moved |
| Hovering the size, Notes and Hide buttons for 1.6 s | Tooltips shown: "Window size", "Notes shared across your spaces", "Hide · Ctrl+Shift+Space" |
| Clicking the size button, then clicking it again | First click opened the popup (`status` overlays `layout`, `float-space`); the second closed it (`layout` only), with no second popup and the size left at Small |

Not re-checked on 0.1.11: an opening right after the app starts, which
needs restarting Herdr.

### Agent alerts (unreleased)

| Check | Result |
| --- | --- |
| A probe terminal outside every space (`hc run --no-parent`) reporting OSC 7501 working, then done or idle, with Herdr on screen | No toast from Herdr, so Float Space's own alerts don't double Herdr's |
| A probe with Float Space's labels reporting working for 4 s, then idle, while the window showed another tab | Adopted as tab "Terminal 1" (shown as "fsprobe"), then a toast "fsprobe finished · In Float Space"; `status` overlays `layout`, `toast` |

Not checked: the sound itself (no audio capture), alerts while Herdr isn't
the active app, and blocked or error reports.

## Earlier builds, with real input

These used real mouse and keyboard events (through a temporary Linux input
device outside this repository) on earlier builds with the same terminal
and Notes handling but a different header, a split Notes view and a
confirmation before ending a terminal:

| Check | Result |
| --- | --- |
| Type multiline notes into the textarea | Saved in shared state; kept across tab switches, hiding and a hot reload |
| Click the terminal, type and run a shell command | Output read back from core |
| Toggle with the real Ctrl+Shift+Space, from the window and from the workspace | Passed |
| Hide, reopen and change spaces | Same terminal address and process PID |
| Type after hiding | Went to the workspace's shell, not the scratch shell |
| Type right after opening, before clicking the terminal | Stayed in the window's chrome; nothing reached either shell |
| Unload the mod by switching layouts, then come back | Same terminal PID and notes |
| Drag the width and height sliders, Escape, Apply | Drafts didn't resize the terminal; Escape kept the size; Apply saved it |

Hide and show took 42–195 ms once warm (command to state change, through the
CLI). On Herdr 0.1.10 the first opening after the mod loads took up to about
3 s while the app's main thread was busy; on 0.1.11 it no longer did (see
above). Herdr also rebuilds the terminal view whenever the window is
replaced.

## Host limits observed

- `pane.focus {terminal}` doesn't search overlay terminals in Herdr 0.1.10
  and shows a failed-command notification, so the window focuses its own
  header and a click focuses the terminal.
- Layout dividers and window edges can't be dragged in an overlay, and mods
  have no resize call; the size popup applies a size once.
- The command palette is a fixed list (Herdr's own commands and layouts);
  mods can't add entries.

Not tested: macOS, Windows, remote machines, a machine reboot or a core
crash. Reboot behavior is from Herdr's documentation of `--keep`.
