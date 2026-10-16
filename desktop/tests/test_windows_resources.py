"""Public branding/configuration checks; Windows visual acceptance stays separate."""
import json
from pathlib import Path
import struct
import unittest

ROOT = Path(__file__).resolve().parents[1]


class WindowsResourcesTest(unittest.TestCase):
    def test_high_resolution_frame_is_first_for_tauri(self):
        data = (ROOT / 'src-tauri/icons/icon.ico').read_bytes()
        count = struct.unpack_from('<H', data, 4)[0]
        sizes = [(data[6+i*16] or 256, data[7+i*16] or 256) for i in range(count)]
        self.assertEqual(sizes[0], (256, 256))
        self.assertTrue({(16, 16), (32, 32), (48, 48), (256, 256)}.issubset(sizes))

    def test_installer_and_uninstaller_use_approved_brand_resource(self):
        config = json.loads((ROOT / 'src-tauri/tauri.windows.conf.json').read_text(encoding='utf-8'))
        nsis = config['bundle']['windows']['nsis']
        self.assertEqual(nsis['installerIcon'], 'icons/icon.ico')
        self.assertEqual(nsis['uninstallerIcon'], 'icons/icon.ico')

    def test_upgrade_guard_precedes_uninstall_and_copy_without_ignore_or_forced_close(self):
        config = json.loads((ROOT / 'src-tauri/tauri.windows.conf.json').read_text())
        nsis = config['bundle']['windows']['nsis']
        template = (ROOT / 'src-tauri' / nsis['template']).read_text(encoding='utf-8-sig')
        before_uninstall = template.index('Call RipplePrepareUpgrade', template.index('reinst_uninstall:'))
        self.assertLess(before_uninstall, template.index("ExecWait '$R1'", before_uninstall))
        old_directory = template.index('ReadRegStr $INSTDIR SHCTX')
        self.assertLess(old_directory, before_uninstall)
        self.assertIn('Pop $INSTDIR', template[before_uninstall:])
        install = template[template.index('Section Install'):]
        self.assertLess(install.index('Call RipplePrepareUpgrade'), install.index('File "${MAINBINARYSRCPATH}"'))
        self.assertIn('AllowSkipFiles off', template)
        self.assertNotIn('!insertmacro CheckIfAppIsRunning', template)
        self.assertIn('Call un.RipplePrepareUpgrade', template)
        self.assertIn('NSIS_HOOK_PREUNINSTALL', (ROOT / 'src-tauri' / nsis['installerHooks']).read_text(encoding='utf-8-sig'))

    def test_release_binary_uses_windows_gui_subsystem(self):
        source = (ROOT / 'src-tauri/src/main.rs').read_text(encoding='utf-8')
        self.assertIn('cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")', source)


if __name__ == '__main__':
    unittest.main()
