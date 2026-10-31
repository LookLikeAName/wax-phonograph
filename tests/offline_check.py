#!/usr/bin/env python3
"""檢查離線版能否直接用 file:// 開啟（不連網、不開伺服器）。
用法：python3 tests/offline_check.py [dist/index.html]"""
import sys, time, pathlib
from playwright.sync_api import sync_playwright
root = pathlib.Path(__file__).resolve().parent.parent
page_path = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'dist/index.html'
if not page_path.exists(): sys.exit(f'找不到 {page_path}，請先執行 npm run build')
errors, external = [], []
with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'])
    pg = b.new_page(viewport={'width': 1440, 'height': 900})
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: m.type == 'error' and errors.append(m.text))
    pg.add_init_script("localStorage.setItem('phonograph.perf',JSON.stringify({quality:'off'}))")
    # 擋掉所有對外連線，模擬沒有網路；字型抓不到不算錯
    def block(r):
        u = r.request.url
        if not u.startswith(('file:', 'data:', 'blob:')):
            external.append(u)
            return r.abort()
        r.continue_()
    pg.route('**/*', block)
    pg.goto(page_path.resolve().as_uri(), wait_until='domcontentloaded'); time.sleep(4)
    pg.evaluate("document.getElementById('bStart').click()")
    pg.wait_for_selector('#splash', state='detached', timeout=60000); time.sleep(2)
    # 主程式（module）跑起來才會畫出蠟筒架；worklet 載入失敗會變成 pageerror
    pg.evaluate("document.querySelector('.dtabs [data-dt=rack]').click()"); time.sleep(0.5)
    ok = pg.evaluate("document.querySelectorAll('#rackList .rk[data-id]').length>0")
    pg.evaluate("document.querySelector('#rackList [data-act=play]').click()"); time.sleep(2)
    b.close()
errors = [e for e in errors if 'net::ERR_FAILED' not in e and 'fonts' not in e]
code = [u for u in external if 'fonts.g' not in u]
print('external requests:', code or 'none (fonts only)' if external else 'none')
for e in errors: print('ERROR', e)
print('PASS' if ok and not errors and not code else 'FAIL')
sys.exit(0 if ok and not errors and not code else 1)
