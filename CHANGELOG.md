# Changelog

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
