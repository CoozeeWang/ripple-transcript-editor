"""Keep packaging declarations aligned with the shared segment channel contract."""
import json
import unittest
from pathlib import Path

DESKTOP = Path(__file__).resolve().parents[1]

class SegmentChannelTest(unittest.TestCase):
    def test_windows_protocol_is_guarded_and_owned(self):
        channel = json.loads((DESKTOP / 'segment-link-config.json').read_text(encoding="utf-8"))['production']
        windows = DESKTOP / 'src-tauri/windows'
        header = (windows / 'segment-link.nsh').read_text(encoding="utf-8")
        hook = (windows / 'upgrade-hooks.nsh').read_text(encoding='utf-8-sig')
        installer = (windows / 'installer.nsi').read_text(encoding="utf-8")
        self.assertIn(f'!define RIPPLE_SEGMENT_SCHEME "{channel["scheme"]}"', header)
        self.assertEqual(header.count(f'!if "${{BUNDLEID}}" == "{channel["bundleId"]}"'), 2)
        self.assertIn('ReadRegStr $R7', header)
        self.assertIn('${If} $R7 ==', header)
        self.assertIn('!include "${__FILEDIR__}\\segment-link.nsh"', hook)
        self.assertGreater(installer.index('!insertmacro RippleRegisterSegmentLink'), installer.index('File "${MAINBINARYSRCPATH}"'))
        self.assertIn('!insertmacro RippleUnregisterSegmentLink', installer)

    def test_channels_have_distinct_identity_and_scheme(self):
        channels = json.loads((DESKTOP / 'segment-link-config.json').read_text(encoding="utf-8"))
        for field in ('bundleId', 'scheme'):
            self.assertNotEqual(channels['production'][field], channels['development'][field])
        self.assertEqual(channels['production']['bundleId'], json.loads((DESKTOP / 'src-tauri/tauri.conf.json').read_text(encoding="utf-8"))['identifier'])
        self.assertEqual(channels['development']['bundleId'], json.loads((DESKTOP / 'src-tauri/tauri.dev.conf.json').read_text(encoding="utf-8"))['identifier'])
