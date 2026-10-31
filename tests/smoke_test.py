#!/usr/bin/env python3
"""端對端冒煙測試（Playwright + 無頭 Chromium）。
流程：開啟 → 載入音檔 → 快速刻錄 → 蠟筒架分頁：新增、改名、移組、儲存選取、匯出選取 WAV、載入加入 → 3D 架換排 → 窄螢幕版面。
用法：python3 tests/smoke_test.py path/to/audio.mp3 [輸出資料夾]
需要：pip install playwright（Chromium 已安裝）。載入 dist/index.html（先執行 npm run build），不連網。"""
import sys, time, struct, json, pathlib
from playwright.sync_api import sync_playwright
root = pathlib.Path(__file__).resolve().parent.parent
audio = sys.argv[1]; out = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else '/tmp/phono_test'); out.mkdir(parents=True, exist_ok=True)
DIST = root / 'dist/index.html'
if not DIST.exists(): sys.exit('找不到 dist/index.html，請先執行 npm run build')
def log(*a): print(*a, flush=True)
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'])
    pg = b.new_page(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    pg.on('pageerror', lambda e: (errors.append(str(e)), log('PAGEERROR', e)))
    pg.on('dialog', lambda d: d.accept())
    # 無頭環境 3D 很慢：關掉場景效果
    pg.add_init_script("localStorage.setItem('phonograph.perf',JSON.stringify({quality:'off'}))")
    pg.route('**/css2**', lambda r: r.fulfill(body='', content_type='text/css'))
    pg.goto(DIST.as_uri(), wait_until='domcontentloaded'); time.sleep(4)
    J = pg.evaluate; T = lambda: J("document.getElementById('toast').textContent")
    J("document.getElementById('bStart').click()"); pg.wait_for_selector('#splash', state='detached', timeout=60000)
    pg.set_input_files('#fileIn', audio); time.sleep(3)
    J("document.getElementById('fBurn').click()")
    for i in range(120):
        time.sleep(0.5)
        if not J("document.getElementById('fBurn').disabled"): break
    log('burn:', T())
    J("document.querySelector('.dtabs [data-dt=rack]').click()"); time.sleep(0.5)
    lst = lambda: J("[...document.querySelectorAll('#rackList .grp')].map(g=>g.querySelector('.gname').textContent+'['+[...g.querySelectorAll('.cname')].map(c=>c.textContent).join(',')+']').join(' ')")
    for i in range(5): J("document.getElementById('bNewCyl2').click()"); time.sleep(0.8)
    J("document.querySelector('#rackList .gname').click()"); pg.keyboard.press('Control+A'); pg.keyboard.type('測試群組'); pg.keyboard.press('Enter')
    J("document.querySelector('#rackList .cname').click()"); pg.keyboard.press('Control+A'); pg.keyboard.type('第一段'); pg.keyboard.press('Enter')
    J("(()=>{const s=document.querySelectorAll('#rackList .grp')[2].querySelector('select.mv'); s.value=document.querySelector('#rackList .grp').dataset.g; s.dispatchEvent(new Event('change',{bubbles:true}));})()")
    log('rack:', lst())
    J("(()=>{const c=document.querySelector('#rackList .gsel'); c.checked=true; c.dispatchEvent(new Event('change',{bubbles:true}));})()")
    # 儲存與匯出會先跳出選項視窗，按確認才會開始
    with pg.expect_download(timeout=120000) as d: J("document.getElementById('bSaveSel').click(); document.getElementById('xOk').click()")
    d.value.save_as(out / 'sel.waxrack'); time.sleep(0.3); log('save:', T())
    bb = (out / 'sel.waxrack').read_bytes(); hl = struct.unpack('<I', bb[:4])[0]; h = json.loads(bb[4:4 + hl])
    log('header:', [(c['name'], c['group']) for c in h['cyls']], h.get('groupMeta'))
    with pg.expect_download(timeout=180000) as d: J("document.getElementById('bWavSel').click(); document.getElementById('xOk').click()")
    d.value.save_as(out / 'sel.wav'); log('wav bytes:', (out / 'sel.wav').stat().st_size)
    pg.set_input_files('#loadIn', str(out / 'sel.waxrack'))
    for i in range(100):
        if '加入' in T(): break
        time.sleep(0.1)
    log('load:', T()); log('rack:', lst())
    log('shelf:', J("document.getElementById('spInfo').textContent"))
    J("document.getElementById('spNext').click()"); time.sleep(0.3); log('shelf next:', J("document.getElementById('spInfo').textContent"))
    pg.screenshot(path=str(out / 'rack_tab.png'))
    pg.set_viewport_size({'width': 700, 'height': 900}); time.sleep(0.6)
    log('narrow layout, rack inside:', J("document.getElementById('rackList').closest('details')?.querySelector('summary')?.textContent"))
    b.close()
print('PASS' if not errors else f'FAIL（{len(errors)} 個頁面錯誤）'); sys.exit(1 if errors else 0)
