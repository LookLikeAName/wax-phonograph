#!/usr/bin/env python3
"""播放器（純播放模式）網頁版測試：刻兩首到蠟筒架 → 開播放器 → 全部加入佇列 → 播放，第一首播完會自動接到第二首。
用法（先 npm run build）：python3 tests/player_check.py [測試音檔，預設 ~/phono-test/tone.wav]"""
import sys, time, pathlib
from playwright.sync_api import sync_playwright
root = pathlib.Path(__file__).resolve().parent.parent
DIST = root / 'dist/index.html'
if not DIST.exists(): sys.exit('找不到 dist/index.html，請先執行 npm run build')
wav = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '~/phono-test/tone.wav').expanduser()
if not wav.exists(): sys.exit(f'找不到測試音檔 {wav}，請先執行 python3 tests/make_test_audio.py')
failed = False
def check(label, ok, extra=''):
    global failed
    print(('ok   ' if ok else 'FAIL ') + label + (f' — {extra}' if extra else ''))
    failed |= not ok
with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'])
    pg = b.new_page(viewport={'width': 1280, 'height': 800})
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.add_init_script("if(!localStorage.getItem('phonograph.perf')) localStorage.setItem('phonograph.perf',JSON.stringify({quality:'off'}))")   # 只在第一次設，重新整理時才看得到存下來的音量
    pg.route('**/css2**', lambda r: r.fulfill(body='', content_type='text/css'))
    pg.goto(DIST.as_uri(), wait_until='domcontentloaded'); time.sleep(3)
    J = pg.evaluate
    J("document.getElementById('bStart').click()"); pg.wait_for_selector('#splash', state='detached', timeout=60000); time.sleep(1)
    for i in range(2):   # 刻兩首（同一個音檔會變成「tone」和「tone (2)」兩組）
        pg.set_input_files('#fileIn', str(wav)); time.sleep(1.5)
        J("document.getElementById('fBurn').click()")
        for _ in range(60):
            time.sleep(0.5)
            if not J("document.getElementById('fBurn').disabled"): break
        time.sleep(0.5)
    J("document.getElementById('bPlayer').click()"); time.sleep(0.5)
    check('開啟播放器', J("document.body.classList.contains('player') && document.getElementById('player').classList.contains('on')"))
    check('3D 介面隱藏', J("getComputedStyle(document.getElementById('transport')).display==='none'"))
    side = J("""(()=>{ const s=document.getElementById('pvSide'); return {vis:getComputedStyle(s).display!=='none', vol:!!s.querySelector('.volbox #vol'),
      rpm:!!s.querySelector('input[data-k=rpm]'), apply:!!s.querySelector('input[data-ck=applyRec]'), wear:!!s.querySelector('input[data-k=wearRate]'),
      rec:s.querySelectorAll('[data-m=rec], input[data-k=rRpm]').length}; })()""")
    check('側邊欄有音量、播放設定、磨損與「裝上時套用」，沒有錄音設定', side['vis'] and side['vol'] and side['rpm'] and side['apply'] and side['wear'] and side['rec'] == 0, str(side))
    J("document.querySelector('.pv-tabs [data-pv=lib]').click()"); time.sleep(0.3)
    n = J("document.querySelectorAll('#pvLibWeb tbody tr[data-k]').length")
    check('曲庫列出蠟筒架上的歌', n == 2, f'{n} 首')
    J("document.querySelector('[data-a=queueAllWeb]').click(); document.querySelector('.pv-tabs [data-pv=now]').click()"); time.sleep(0.3)
    check('佇列有兩首', J("document.querySelectorAll('#pvQueue li[data-i]').length") == 2)
    J("document.getElementById('pvPlay').click()"); time.sleep(1.5)
    t1 = J("document.getElementById('pvTitle').textContent")
    check('開始播放第一首', J("document.getElementById('pvPlay').textContent") == '■' and t1 == 'tone', t1)
    t2 = t1
    for _ in range(40):   # 8 秒的歌，等它接到下一首
        time.sleep(0.5); t2 = J("document.getElementById('pvTitle').textContent")
        if t2 != t1: break
    check('第一首播完自動接到第二首', t2 == 'tone (2)', t2)
    check('目前播放的那首有標示', J("document.querySelector('#pvQueue li.on')?.dataset.i") == '1')
    # 在側邊欄改設定：關掉「裝上時套用」、調振膜增益與音量（和面板是同一組元件）
    J("""(()=>{ const s=document.getElementById('pvSide'), c=s.querySelector('input[data-ck=applyRec]'); c.checked=false; c.dispatchEvent(new Event('change'));
      const r=s.querySelector('input[type=range][data-k=volume]'); r.value=1.3; r.dispatchEvent(new Event('input'));
      const v=s.querySelector('#vol'); v.value=40; v.dispatchEvent(new Event('input')); })()""")
    pg.keyboard.press('p'); time.sleep(0.4)
    check('按 P 回到留聲機', not J("document.body.classList.contains('player')"))
    back = J("""({vol:!!document.querySelector('#transport .volbox'), apply:!!document.querySelector('#panel input[data-ck=applyRec], #recDock input[data-ck=applyRec]'),
      rpm:!!document.querySelector('#panel input[data-k=rpm]'), empty:!document.getElementById('pvSide').children.length,
      applyOff:!document.querySelector('input[data-ck=applyRec]').checked})""")
    check('關掉播放器後設定放回面板，值保持一致', all(back.values()), str(back))
    check('沒有頁面錯誤', not errs, '; '.join(errs[:3]))
    # 重新開啟：剛才改的設定要還在
    pg.reload(wait_until='domcontentloaded'); time.sleep(3)
    kept = J("""({apply:document.querySelector('input[data-ck=applyRec]').checked, volume:+document.querySelector('input[type=range][data-k=volume]').value,
      master:+document.getElementById('vol').value})""")
    check('重新開啟後保留播放設定與音量', kept == {'apply': False, 'volume': 1.3, 'master': 40}, str(kept))
    b.close()
print('FAIL' if failed else 'PASS'); sys.exit(1 if failed else 0)
