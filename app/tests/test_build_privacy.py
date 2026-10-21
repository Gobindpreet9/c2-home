"""Builds must not silently bundle the developer's LAN credential."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

APP = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('build_app', APP / 'build_app.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)

class BuildPrivacyTests(unittest.TestCase):
    def test_default_build_does_not_read_private_client_config(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            client = home / '.config/c2-theme-bridge/client.json'
            client.parent.mkdir(parents=True)
            client.write_text(json.dumps({'urls':['http://192.0.2.10:8790'], 'token':'private-build-test-sentinel'}))
            out = home / 'out'
            # Isolate private build configuration without erasing setup-node's PATH.
            with patch.object(builder, 'OUT', out), patch.object(Path, 'home', return_value=home), patch.dict(os.environ, {'C2_THEME_CONFIG': ''}):
                builder.build()
            config = (out / 'theme-config.js').read_text()
            self.assertEqual(config, 'window.C2_THEME_CONFIG={"urls":[],"token":""};\n')
            self.assertFalse(any(b'private-build-test-sentinel' in f.read_bytes() for f in out.iterdir() if f.is_file()))

if __name__ == '__main__':
    unittest.main()
