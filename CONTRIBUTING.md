# Contributing

Bug reports, tests on macOS or Windows, and small focused changes are all
welcome. Float Space is a community mod, not part of Herdr: problems in
Herdr's own windows, terminals or mod API belong upstream.

## Reporting a problem

Open an issue with the bug form. It asks for `herdr-app --version`,
`hc --version`, your OS and the `errors` from `herdr-app status`. Leave out
terminal output, Notes and anything else private.

## Setting up

You need Node 22 or newer and Python 3.10 or newer. There are no packages to
install and no build step. To try a change in the app, install your checkout
over the current one:

```sh
python3 scripts/install.py --dry-run
python3 scripts/install.py --update
```

Herdr hot-reloads the mod when its files change, so editing the installed
copy under `~/.config/herdr-app/mods/float-space/` shows results at once.
Copy the edit back into `mods/float-space/` and reinstall with `--update`
afterwards, since the installer refuses to overwrite installed files that
differ from its record.

## Where things live

- `mods/float-space/model.js`: saved state, presets and the window spec.
  No Herdr calls, so the tests import it directly.
- `mods/float-space/controller.js`: the window's lifecycle (open, hide,
  reuse, recover, end a terminal) against a small host interface.
- `mods/float-space/main.js`: views and the real Herdr and `hc` calls.
- `scripts/install.py`: installer; its `FILES` list must name every file in
  `mods/float-space/` (CI checks this).
- `RECIPE.md` and `preview.png`: the herdr.dev listing. Keep them in step
  with what the mod does, in the section order the listing expects.
- `docs/validation.md`: what was checked on the real app, and what wasn't.

## Before opening a pull request

```sh
npm test
python3 -m unittest discover -s tests -p 'test_*.py'
herdr-app check mods/float-space
```

CI runs the first two on Node 22/24 and Python 3.10/3.13, plus JSON and
file-list checks. It can't run Herdr, so also say in the PR what you tried
in the app, on which OS and Herdr version.

Some guidelines:

- Behavior changes in `controller.js` or `model.js` come with a test in
  `tests/controller.test.mjs`.
- Float Space must keep working in any layout without editing it, and must
  only ever end terminals labelled as its own for this app home.
- Use theme colors and Herdr's icons; no network requests.
- Update `README.md`, `RECIPE.md` and `CHANGELOG.md` when users would notice
  the change. Never put your own terminals or notes in a screenshot.

By contributing you agree your work is released under the [MIT License](LICENSE).
