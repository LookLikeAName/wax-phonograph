#!/usr/bin/env python3
"""用 node --check 檢查 src/ 底下所有 .js / .mjs 檔的語法（只解析，不執行；?raw、css 匯入不受影響）。
用法：python3 tools/check_syntax.py"""
import subprocess, sys, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
files = sorted(f for f in (root / 'src').rglob('*') if f.suffix in ('.js', '.mjs'))
if not files: sys.exit('src/ 底下找不到 .js / .mjs 檔')
ok = True
for f in files:
    r = subprocess.run(['node', '--check', str(f)], capture_output=True, text=True)
    print(('OK   ' if r.returncode == 0 else 'FAIL ') + f.relative_to(root).as_posix())
    if r.returncode: ok = False; print(r.stderr)
sys.exit(0 if ok else 1)
