#!/usr/bin/env python3
"""版面檢查：在幾種常見解析度打開每個停駐列分頁，檢查浮動面板有沒有互相重疊，並存下截圖。
用法：python3 tests/layout_check.py [截圖資料夾，預設 ~/phono-test/layout] [quality，預設 off]
（截圖要看得到中文，系統需要中文字型，例如 Linux 的 fonts-noto-cjk）"""
import sys, time, pathlib
from playwright.sync_api import sync_playwright
root = pathlib.Path(__file__).resolve().parent.parent
DIST = root / 'dist/index.html'
if not DIST.exists(): sys.exit('找不到 dist/index.html，請先執行 npm run build')
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '~/phono-test/layout').expanduser(); out.mkdir(parents=True, exist_ok=True)
q = sys.argv[2] if len(sys.argv) > 2 else 'off'
SIZES = [(1280, 720), (1366, 768), (1280, 650), (1920, 1000)]
OVERLAP_JS = """() => {
  const vis = e => { if(!e) return null; const r=e.getBoundingClientRect(), cs=getComputedStyle(e); return (r.width&&r.height&&cs.display!=='none'&&cs.visibility!=='hidden')?r:null; };
  const inDock=!!document.getElementById('mag').closest('#recDock');
  const rs=['.brand','#transport','#panel','#recDock','#mag','#backBtn','#shelfPager','#depthWin'].map(s=>[s,vis(document.querySelector(s))]).filter(x=>x[1]);
  const bad=[]; for(let i=0;i<rs.length;i++) for(let j=i+1;j<rs.length;j++){ const a=rs[i][1], b=rs[j][1];
    const ox=Math.min(a.right,b.right)-Math.max(a.left,b.left), oy=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);
    if(ox>2&&oy>2&&!(inDock&&(rs[i][0]==='#mag'||rs[j][0]==='#mag'))) bad.push(rs[i][0]+' × '+rs[j][0]); }
  return bad; }"""
fail = False
with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'])
    for (w, h) in SIZES:
        pg = b.new_page(viewport={'width': w, 'height': h})
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.add_init_script(f"localStorage.setItem('phonograph.perf',JSON.stringify({{quality:'{q}'}}))")
        pg.route('**/css2**', lambda r: r.fulfill(body='', content_type='text/css'))
        pg.goto(DIST.as_uri(), wait_until='domcontentloaded'); time.sleep(4)
        J = pg.evaluate
        J("document.getElementById('bStart').click()"); pg.wait_for_selector('#splash', state='detached', timeout=90000); time.sleep(2)
        tabs = ['rec', 'rack'] + (['mag'] if J("document.body.classList.contains('compact')") else [])
        for t in tabs:
            J(f"document.querySelector('.dtabs [data-dt={t}]').click()"); time.sleep(1.2)
            pg.screenshot(path=str(out / f'{w}x{h}-{t}.png'))
            ov = J(OVERLAP_JS); fail |= bool(ov)
            print(f'{w}x{h} {t}: ' + ('重疊 ' + ', '.join(ov) if ov else 'ok'))
        if errs: fail = True; print('   errors:', errs)
        pg.close()
    b.close()
print('截圖：', out)
print('FAIL' if fail else 'PASS'); sys.exit(1 if fail else 0)
