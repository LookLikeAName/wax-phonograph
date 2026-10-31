#!/usr/bin/env python3
"""檢查沒有 WebGL 時仍可啟動並正常使用聲音（3D 自動關閉）。
用法：python3 tests/nowebgl_check.py [dist/index.html] [tone.wav]"""
import sys, time, pathlib, subprocess
from playwright.sync_api import sync_playwright
root = pathlib.Path(__file__).resolve().parent.parent
page_path = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'dist/index.html'
wav = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else pathlib.Path.home() / 'phono-test/tone.wav'
if not page_path.exists(): sys.exit(f'找不到 {page_path}，請先執行 npm run build')
if not wav.exists(): subprocess.run([sys.executable, str(root / 'tests/make_test_audio.py')], check=False)
if not wav.exists(): sys.exit(f'找不到測試音檔 {wav}')
errors, fails = [], []
def check(name, cond):
    print(('ok   ' if cond else 'FAIL ') + name)
    if not cond: fails.append(name)
NOGL = """(()=>{const o=HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext=function(t,...a){ if(/webgl/i.test(t)) return null; return o.call(this,t,...a); };})();"""
with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--disable-gpu', '--disable-software-rasterizer'])
    pg = b.new_page(viewport={'width': 1440, 'height': 900})
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: m.type == 'error' and errors.append(m.text))
    pg.add_init_script(NOGL)
    pg.route('**/*', lambda r: r.continue_() if r.request.url.startswith(('file:', 'data:', 'blob:')) else r.abort())
    pg.goto(page_path.resolve().as_uri(), wait_until='domcontentloaded'); time.sleep(4)
    pg.evaluate("document.getElementById('bStart').click()")
    try: pg.wait_for_selector('#splash', state='detached', timeout=30000); check('splash 消失', True)
    except Exception: check('splash 消失', False)
    time.sleep(1.5)
    check('畫質為 off', pg.evaluate("document.getElementById('sel_quality').value")=='off')
    check('其餘畫質選項停用', pg.evaluate("[...document.getElementById('sel_quality').options].every(o=>o.value=='off'||o.disabled)"))
    check('3D 勾選停用', pg.evaluate("[...document.querySelectorAll('input[data-ck=room],input[data-ck=shadows],input[data-ck=particles]')].every(e=>e.disabled)"))
    check('顯示無 3D 說明', pg.evaluate("(()=>{const n=document.getElementById('no3dNote');return !!n&&!n.hidden&&n.offsetParent!==null||!!n&&!n.hidden})()"))
    check('開啟後出現提示', pg.evaluate("document.getElementById('toast').textContent.includes('WebGL')"))
    pg.mouse.click(300, 300)   # 點 3D 畫布不應出錯
    pg.set_input_files('#fileIn', str(wav))
    time.sleep(3)
    pg.evaluate("document.getElementById('fBurn').click()"); time.sleep(1)
    try: pg.wait_for_function("!document.getElementById('fBurn').disabled", timeout=120000)
    except Exception: pass
    check('刻錄完成', pg.evaluate("document.getElementById('toast').textContent.includes('刻成')"))
    pg.evaluate("document.getElementById('bPlay').click()"); time.sleep(1.5)
    check('播放中', pg.evaluate("document.getElementById('bPlay').classList.contains('on')"))
    b.close()
errors = [e for e in errors if 'net::ERR' not in e and 'fonts' not in e and 'WebGL' not in e and 'GPU stall' not in e]
for e in errors: print('ERROR', e)
ok = not fails and not errors
print('PASS' if ok else 'FAIL')
sys.exit(0 if ok else 1)
