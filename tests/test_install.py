import importlib.util
from pathlib import Path
import unittest
import tempfile

spec = importlib.util.spec_from_file_location("installer", Path(__file__).parents[1] / "scripts/install.py")
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class InstallerTests(unittest.TestCase):
    def test_shortcut_conflict_leaves_input_unchanged(self):
        original = {"global": {"ctrl-shift-space": "some.other-action", "ctrl-shift-f": "layout.toggle:panel"}}
        with self.assertRaisesRegex(ValueError, "Shortcut conflict"):
            installer.merge_keys(original, {"global": {"ctrl-shift-space": "mod.open:float-space"}})
        self.assertEqual(original["global"]["ctrl-shift-space"], "some.other-action")

    def test_repeat_install_keeps_its_binding_and_other_keys(self):
        existing = {"global": {"ctrl-shift-space": "mod.open:float-space", "ctrl-shift-f": "layout.toggle:panel"}}
        merged = installer.merge_keys(existing, {"global": {"ctrl-shift-space": "mod.open:float-space"}, "terminal": {"ctrl-shift-space": "mod.open:float-space"}})
        self.assertEqual(merged["global"], existing["global"])
        self.assertEqual(merged["terminal"], {"ctrl-shift-space": "mod.open:float-space"})

    def test_update_refuses_additional_user_files(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory)
            (destination / "main.js").write_text("original")
            marker = {"package": "herdr-float-space", "files": {"main.js": installer.digest(destination / "main.js")}}
            installer.verify_installed(destination, marker)
            (destination / "my-notes.md").write_text("do not delete")
            with self.assertRaisesRegex(ValueError, "Extra installed file"):
                installer.verify_installed(destination, marker)
            self.assertEqual((destination / "my-notes.md").read_text(), "do not delete")

    def test_update_refuses_edited_source_but_accepts_host_generated_types(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory)
            (destination / "main.js").write_text("original")
            marker = {"package": "herdr-float-space", "files": {"main.js": installer.digest(destination / "main.js")}}
            (destination / "gpui-kit.d.ts").write_text("generated")
            installer.verify_installed(destination, marker)
            (destination / "main.js").write_text("customized")
            with self.assertRaisesRegex(ValueError, "Installed file was edited"):
                installer.verify_installed(destination, marker)


if __name__ == "__main__":
    unittest.main()
