# Changelog

## Unreleased

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
