# Changelog

## Unreleased

- Focus: Notes reliably takes keyboard focus on open and tab selection without
  racing header chrome focus.
- Hiding Float Space cleanly restores keyboard focus to the previously active
  pane by unmounting the overlay window before requesting pane focus.
- The status-bar button's label waits 1000 ms before showing (a `HoverCard`
  instead of the 500 ms tooltip), matching a status bar whose other buttons
  wait that long.

## 0.2.0 — 2026-11-02

- Failed terminal-list synchronization retries on the next check, even when
  the live snapshot hasn't changed.
- Clicking an agent alert opens its Float Space tab, including after hiding
  the window. A stale alert never starts a replacement shell.
- Header/Notes shortcuts: Ctrl+Tab and Ctrl+Shift+Tab cycle pages,
  Ctrl+Shift+T starts a terminal, Ctrl+Shift+N opens Notes. Opening Notes
  focuses its editor. Embedded terminals keep Herdr's existing bindings.
- New shells start in the folder the open space's terminal is in now, the
  same place a new Herdr tab starts. A space on another machine still starts
  in your home directory.
- While the window is open, an agent in it that finishes or needs you posts
  a toast and plays Herdr's done or blocked sound (following `sounds` in
  Herdr's settings), unless you're watching it.
- New shells take the lowest free number, like Herdr's tabs, instead of
  counting up forever ("Terminal 37").
- Tested with Herdr 0.1.11 and core 0.1.16. The first opening after the mod
  loads no longer pauses, and the header's tooltips show; both were Herdr
  fixes, so nothing changed in the mod.
- `CONTRIBUTING.md`, issue forms and CI (Node and Python tests, file checks).

## 0.1.0 — 2026-10-31

First release.

- Floating scratch window over any Herdr layout, toggled with
  **Ctrl+Shift+Space**; hiding it keeps shells and their programs running.
- Terminal tabs of its own (up to 12), with agent names, icons, Herdr's
  working spinner and blocked/done dots.
- **Notes**: one autosaved scratchpad shared across all spaces.
- Window sizes: Small (20% × 50%), Normal (50% × 60%), Large (85% × 88%) or
  custom; each size remembers where you dragged it.
- The whole window border marks keyboard focus in your theme's accent color.
- Closing the shown terminal switches to the next tab, or Notes after the last.
- `scripts/install.py` installs or updates the mod and merges `keys.json`
  without replacing your bindings, with backups and `--dry-run`.

Tested on Linux with Herdr 0.1.10 and core 0.1.15. macOS and Windows testers
welcome.
