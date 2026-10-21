import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('guard',Path(__file__).with_name('check_public_tree.py'))
guard=importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)

class PublicationGuardTests(unittest.TestCase):
    def test_detects_forced_ignored_payloads_and_provider_tokens(self):
        self.assertTrue(guard.check_file('app/dist/index.html',b'example'))
        self.assertTrue(guard.check_file('client.json',b'{}'))
        self.assertTrue(guard.check_file('oops.txt',('ghp_'+'a'*36).encode()))
        self.assertTrue(guard.check_file('oops.txt',('-----BEGIN '+'OPENSSH PRIVATE KEY-----').encode()))
        self.assertEqual(guard.check_file('app/tests/test.cjs',b"const token='fixture-token';"),[])
        self.assertEqual(guard.check_file('README.md',b'http://192.0.2.10:8790'),[])

if __name__=='__main__':unittest.main()
