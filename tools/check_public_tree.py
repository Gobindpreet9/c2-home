#!/usr/bin/env python3
"""Conservative tracked-file publication guard; never prints matched values.

Not a complete secret scanner. Review diffs and image contents separately.
"""
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]
PRIVATE_DIRS={'node_modules','dist','homeapp','releases','root-run','cleanup-run','performance-audit','backups','private','__pycache__','.venv','builds'}
PRIVATE_NAMES={'client.json','token','theme-config.js','known_hosts','known_hosts_dev','.env'}
PRIVATE_SUFFIXES=('.key','.pem','.key.pub','.ipk','.tar','.tar.gz','.tgz','.zip','.log','.pyc')
PATTERNS={
    'private key':re.compile(rb'-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----'),
    'GitHub token':re.compile(rb'(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})'),
    'AWS access key':re.compile(rb'(?:AKIA|ASIA)[A-Z0-9]{16}'),
    'JWT':re.compile(rb'eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}'),
    'authenticated URL':re.compile(rb'https?://[^\s/\x22\x27]+:[^\s/\x22\x27]+@'),
    'home directory':re.compile(rb'/home/[a-z_][a-z0-9_-]*/'),
}

def check_file(name,body):
    path=PurePosixPath(name)
    reasons=[]
    if (set(path.parts)&PRIVATE_DIRS or path.name in PRIVATE_NAMES
        or path.name.startswith('.env.') and path.name!='.env.example'
        or path.name.endswith(PRIVATE_SUFFIXES) or path.name.startswith(('id_rsa','id_ed25519'))):
        reasons.append('private/generated artifact path')
    scan_body=body
    if name in ('app/tests/connections.test.cjs','app/tests/native-jellyfin.test.cjs'):
        # Explicitly invalid input fixture used to verify userinfo URL rejection.
        scan_body=scan_body.replace(b'http://'+b'user:pass@',b'http://invalid-userinfo-fixture/')
    reasons.extend(label for label,pattern in PATTERNS.items() if pattern.search(scan_body))
    return reasons

def main():
    names=subprocess.check_output(['git','ls-files','--cached','-z'],cwd=ROOT).split(b'\0')
    checked=0;findings=[]
    for raw in filter(None,names):
        name=raw.decode('utf-8');checked+=1
        mode=subprocess.check_output(['git','ls-files','-s','--',name],cwd=ROOT).split()[0]
        if mode==b'120000':
            findings.append((name,['symbolic links require manual publication review']));continue
        body=subprocess.check_output(['git','show',':'+name],cwd=ROOT)
        reasons=check_file(name,body)
        if reasons:findings.append((name,reasons))
    for name,reasons in findings:
        print(name+': '+', '.join(reasons),file=sys.stderr)
    print(f'Publication guard: {checked} tracked files; {len(findings)} flagged files.')
    return 1 if findings or not checked else 0

if __name__=='__main__':sys.exit(main())
