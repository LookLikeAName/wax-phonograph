// 主程式：3D 場景、介面、音源、剖面視窗、存檔。worklet 原始碼以字串匯入，執行時用 Blob／data URL 載入。
import './style.css';
import workletSrc from './worklet/phono.js?raw';
import { platform } from './platform/index.js';
import { initMusic } from './music.js';
// 對外連結；下載連結一律指向最新版的 Release 頁
const REPO_URL='https://github.com/LookLikeAName/wax-phonograph', RELEASES_URL=REPO_URL+'/releases/latest', WEB_URL='https://wax-phonograph.pages.dev';
document.body.classList.toggle('desktop',platform.name==='electron');   // 桌面版隱藏下載連結（.webOnly）、改顯示線上版連結（.deskOnly）
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const N=18000, TEXW=2048, PITCH=254, CIRC=174700, DX=CIRC/N, NOM=160;
const CY=10.6, RW=2.78, LWAX=10.8, GROOVE_UM=81280, V0=(1-GROOVE_UM/108000)/2, V1=1-V0;   // 蠟筒 4¼ 吋，刻紋區 3.2 吋
const XS=-LWAX/2+LWAX*V0, XE=-LWAX/2+LWAX*V1;
const $=id=>document.getElementById(id);

// ---------------- 參數 ----------------
const P={inGain:20,baseDepth:22,monitor:false,drive:'motor',rpm:160,
  rDrive:'motor',rRpm:160,rRatio:2,rCrankGov:true,rHorn:true,rFlutter:false,rFlutterAmt:0.4,ratio:2,crankGov:true,autoLift:true,overdub:'carve',waxWear:4,waxGrain:0.6,waxCutLP:8000,pitch:254,tipOn:true,stylusR:150,mistrack:true,trackAccel:2500,
  horn:true,volume:0.7,wearOn:false,wearRate:0.05,crosstalk:true,cutterR:160,ecc:true,eccMm:0.25,flutter:true,flutterAmt:0.4,
  dust:true,dustPct:0.15,scratch:true,scratchCount:3,crack:true,mold:true,moldAmt:1.5,scratches:[],crackA0:0,crackSlope:0,seed:7};
const U={dockTab:'rec',pmTab:'play',xSpeed:true,xDist:true,saveQ:'lossless',applyRec:true,showDepth:false,wheelDeg:15,chainRec:true,chainPlay:true,magTab:'both',masterVol:70,muted:false,src:'file',micDev:'',micName:'',toneFreq:440,waxColor:'brown',duration:60,exag:4,showMag:true,
  quality:'med',room:true,shadows:true,sunShadow:false,rays:false,particles:true,res:'0.75',fpsCap:'60'};
const DEF_P=JSON.parse(JSON.stringify(P)), DEF_U=JSON.parse(JSON.stringify(U));
const PRESETS={high:{room:true,shadows:true,sunShadow:true,rays:true,particles:true,res:'1',fpsCap:'60'},
  med:{room:true,shadows:true,sunShadow:false,rays:false,particles:true,res:'0.75',fpsCap:'60'},
  low:{room:false,shadows:false,sunShadow:false,rays:false,particles:false,res:'0.5',fpsCap:'30'},
  off:{}};
const PERF_KEYS=['xSpeed','xDist','saveQ','wheelDeg','masterVol','muted','quality','room','shadows','sunShadow','rays','particles','res','fpsCap'];
try{ const sv=JSON.parse(localStorage.getItem('phonograph.perf')||'null'); if(sv){ if(PRESETS[sv.quality]) Object.assign(U,PRESETS[sv.quality]); for(const k of PERF_KEYS) if(k in sv) U[k]=sv[k]; } }catch(e){}
// 錄音與播放設定：使用者自己調過的值記在這台電腦上，下次開啟時沿用（裝上蠟筒時自動套用的值不算，見 rememberSetting）
const SETTINGS_KEY='phonograph.settings';
let userSet={}; try{ userSet=JSON.parse(localStorage.getItem(SETTINGS_KEY)||'{}')||{}; }catch(e){}
for(const [k,v] of Object.entries(userSet)){ const o=k in DEF_P?P:k in DEF_U?U:null; if(o&&typeof v===typeof o[k]&&!Array.isArray(o[k])) o[k]=v; }
// WebGL 不可用時（無 GPU、驅動被封鎖）整個 3D 關閉，聲音與剖面照常；先探測，建立 renderer 失敗時再改為 false
let has3D=(()=>{ try{ const c=document.createElement('canvas'), g=c.getContext('webgl2')||c.getContext('webgl'); if(!g) return false; const x=g.getExtension('WEBGL_lose_context'); if(x) x.loseContext(); return true; }catch(e){ return false; } })();
if(!has3D) U.quality='off';
function savePerf(){ try{ const o={}; for(const k of PERF_KEYS) o[k]=U[k]; if(!has3D) o.quality='med'; localStorage.setItem('phonograph.perf',JSON.stringify(o)); }catch(e){} }
const WK=new Set(['rDrive','rRpm','rRatio','rCrankGov','rHorn','rFlutter','rFlutterAmt','autoLift','overdub','waxWear','waxGrain','waxCutLP','pitch','inGain','baseDepth','monitor','drive','rpm','ratio','crankGov','tipOn','stylusR','mistrack','trackAccel','horn','volume','wearOn','wearRate',
  'crosstalk','cutterR','ecc','eccMm','flutter','flutterAmt','dust','dustPct','scratch','crack','mold','moldAmt','scratches','crackA0','crackSlope']);
const capFor=k=>Math.round(GROOVE_UM/({brown:254,black:254,amber:127}[k]||254));   // 圈數＝刻紋區長度÷圈距
let T=capFor('brown');

function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;}}
function genDefects(){
  const r=mulberry32(P.seed), sc=[];
  for(let i=0;i<8;i++){ const k0=Math.floor(r()*T*0.6), k1=Math.min(T,k0+Math.max(1,Math.floor(T*(0.2+r()*0.6))));
    sc.push({a0:r()*N,slope:(r()-0.5)*0.5*N/T,w:1.2+r()*2.5,depth:6+r()*16,k0,k1}); }
  P.scratches=sc.slice(0,P.scratchCount); P.crackA0=r()*N; P.crackSlope=(r()-0.5)*0.08*N/T;
}
genDefects();

// ---------------- 音訊 ----------------
let ctx=null,node=null,inputBus,master,inAn,outAn,workletURL;
let st=null,stTime=0,dispS=0,mode='idle',modeAck=true,hasContent=false,recMax=0,pendingSrc=false;
// 蠟筒架：未裝上的蠟筒以 Int16（0.005 µm）壓縮保存在記憶體
let rackSeq=1, groupSeq=1; const groupOv={}, groupMeta={}, rackSel=new Set(); const rack=[{id:1,T:0,zq:null,wq:null,used:0,wax:'brown',group:1}]; let activeId=1, nextInfo=null;
let carousel=false, tour=null;
let playerMode=false;   // 純播放模式（src/music.js）：播放器蓋住整個畫面，3D 場景停止繪製   // 輪播模式：只留播放列、循環播放架上所有有錄音的蠟筒、自動運鏡
let liveSrc=[],micStream=null,micNode=null,fileBuffer=null,fileTitle='',toneOsc=null,snapResolve=null;   // fileTitle：音檔名稱（去掉副檔名），快速刻錄時當群組名

function sendParams(keys){ if(!node) return; const o={}; for(const k of keys) o[k]=P[k]; node.port.postMessage({type:'params',params:o}); }

async function initAudio(){
  ctx=new (window.AudioContext||window.webkitAudioContext)({latencyHint:'interactive'});
  if(!ctx.audioWorklet) throw new Error('這個瀏覽器不支援 AudioWorklet');
  const src=workletSrc;
  workletURL=URL.createObjectURL(new Blob([src],{type:'application/javascript'}));
  try{ await ctx.audioWorklet.addModule(workletURL); }
  catch(err){ // file:// 下 blob URL 的來源是 null，改用 data URL
    workletURL='data:application/javascript;charset=utf-8,'+encodeURIComponent(src);
    await ctx.audioWorklet.addModule(workletURL);
  }
  const params={}; for(const k of WK) params[k]=P[k];
  node=new AudioWorkletNode(ctx,'phono',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],channelCount:1,channelCountMode:'explicit',channelInterpretation:'speakers',processorOptions:{T,params}});
  inputBus=ctx.createGain(); inputBus.connect(node);
  inAn=ctx.createAnalyser(); inAn.fftSize=1024; inputBus.connect(inAn);
  master=ctx.createGain(); master.gain.value=masterGain(); node.connect(master); master.connect(ctx.destination);
  outAn=ctx.createAnalyser(); outAn.fftSize=1024; node.connect(outAn);
  node.port.onmessage=onWorkletMsg;
  await ctx.resume();
}

function onWorkletMsg(e){
  const m=e.data;
  if(m.type==='st'){ st=m; stTime=performance.now(); if(m.mode===mode) modeAck=true; if(m.mode==='record'){ recMax=Math.max(recMax,m.s); const e=rackEntry(activeId); if(e&&recMax>e.used){ e.used=recMax; }
    if(e&&m.head&&m.hg>0.9&&Math.abs(m.w)>0.005){ const ri=e.rec||(e.rec=newRecInfo()); ri.acc+=Math.abs(m.w)*60; ri.n++; } } }
  else if(m.type==='swapped'){ onSwapped(m); }
  else if(m.type==='tex'){ if(m.g0+m.d.length<=texData.length){ texData.set(m.d,m.g0); texDirty=true; depthDirty=true; } }
  else if(m.type==='headDown'){ if(m.mode==='record'){ const e=rackEntry(activeId); if(e){ const ri=e.rec||(e.rec=newRecInfo()); ri.set=captureRecSet(); } }
    if(m.mode==='record'&&pendingSrc){ pendingSrc=false; startSource().catch(err=>{toast(err.message);doStop();}); } }
  else if(m.type==='ended'){ stopSources(); mode='idle'; clearNext(); renderRack(); if(carousel&&m.reason!=='source'){ setTimeout(carouselNext,1200); return; } toast(m.reason==='source'?'音檔播完，刻刀已抬起':m.reason==='blank'?'這支的錄音已播完，唱針自動抬起':'已到蠟筒盡頭'); }
  else if(m.type==='region'){ onRegion(m); }
  else if(m.type==='snapshot'){ if(snapResolve){ snapResolve(m); snapResolve=null; } }
}

function stopSources(){ for(const n of liveSrc){ try{n.stop&&n.stop();}catch(e){} try{n.disconnect();}catch(e){} } liveSrc=[]; toneOsc=null; pendingSrc=false; }

const MEL=[[64,1],[62,1],[60,1],[62,1],[64,1],[64,1],[64,2],[62,1],[62,1],[62,2],[64,1],[67,1],[67,2],[64,1],[62,1],[60,1],[62,1],[64,1],[64,1],[64,1],[64,1],[62,1],[62,1],[64,1],[62,1],[60,4]];
function scheduleMelody(t0){
  const beat=0.42; let t=t0+0.15; const bus=ctx.createGain(); bus.gain.value=0.9; bus.connect(inputBus); liveSrc.push(bus);
  for(let rep=0;rep<6;rep++){
    for(const [m,d] of MEL){
      const f=440*Math.pow(2,(m-69)/12), dur=d*beat;
      const o1=ctx.createOscillator(), o2=ctx.createOscillator(), g=ctx.createGain(), g2=ctx.createGain();
      o1.type='triangle'; o2.type='sawtooth'; o1.frequency.value=f; o2.frequency.value=f*1.003; g2.gain.value=0.22;
      g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(0.75,t+0.015); g.gain.exponentialRampToValueAtTime(0.35,t+0.25);
      g.gain.setValueAtTime(0.35,t+dur*0.85); g.gain.exponentialRampToValueAtTime(0.001,t+dur*0.98);
      o1.connect(g); o2.connect(g2); g2.connect(g); g.connect(bus);
      o1.start(t); o2.start(t); o1.stop(t+dur); o2.stop(t+dur); liveSrc.push(o1,o2);
      t+=dur;
    }
    t+=beat*2;
  }
}

// 麥克風：用「輸入裝置」選的那一支（U.micDev，空字串是系統預設）；選的裝置不在了就改用系統預設
async function openMic(){
  const base={echoCancellation:false,noiseSuppression:false,autoGainControl:false};
  let s;
  if(U.micDev){
    try{ s=await navigator.mediaDevices.getUserMedia({audio:{...base,deviceId:{exact:U.micDev}}}); }
    catch(err){ if(err.name!=='OverconstrainedError'&&err.name!=='NotFoundError') throw err; toast('找不到選擇的輸入裝置，改用系統預設'); }
  }
  if(!s) s=await navigator.mediaDevices.getUserMedia({audio:base});
  refreshMics();   // 取得權限後才看得到裝置名稱
  return s;
}
function closeMic(){ if(micNode){ try{ micNode.disconnect(); }catch(e){} micNode=null; } if(micStream){ micStream.getTracks().forEach(t=>t.stop()); micStream=null; } }
// 重新列出輸入裝置（「default」就是系統預設，不重複列）
async function refreshMics(){
  const sel=$('sel_micDev'); if(!sel||!navigator.mediaDevices?.enumerateDevices) return;
  let all=[]; try{ all=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='audioinput'); }catch(e){}
  const devs=all.filter(d=>d.deviceId&&d.deviceId!=='default'), locked=all.some(d=>!d.deviceId);   // 還沒給麥克風權限時，瀏覽器不提供裝置 ID 和名稱
  // file:// 下（含桌面版）裝置 ID 每次開啟都會變，找不到 ID 時改用名稱對回上次選的裝置
  if(U.micDev&&!devs.some(d=>d.deviceId===U.micDev)){ const d=U.micName&&devs.find(d=>d.label===U.micName); if(d){ U.micDev=d.deviceId; rememberSetting('micDev'); } }
  const opts=[['','系統預設'],...devs.map((d,i)=>[d.deviceId,d.label||`輸入裝置 ${i+1}`])];
  if(U.micDev&&!devs.some(d=>d.deviceId===U.micDev)) opts.push([U.micDev,locked?'上次選的裝置（開始錄音後會列出所有裝置）':'（上次選的裝置，目前沒有連接）']);
  sel.replaceChildren(...opts.map(([v,t])=>{ const o=document.createElement('option'); o.value=v; o.textContent=t; return o; }));
  sel.value=U.micDev;
}
navigator.mediaDevices?.addEventListener?.('devicechange',()=>refreshMics());

async function startSource(){
  const t0=ctx.currentTime+0.01;
  switch(U.src){
    case 'mic': {
      if(!micStream) micStream=await openMic();
      if(!micNode) micNode=ctx.createMediaStreamSource(micStream);
      micNode.connect(inputBus); liveSrc.push({disconnect:()=>micNode.disconnect()}); break; }
    case 'file': {
      if(!fileBuffer) throw new Error('請先在「錄音台」選擇音檔');
      const b=ctx.createBufferSource(), fg=ctx.createGain(); b.buffer=fileBuffer; fg.gain.value=Math.pow(10,FC.gain/20);
      b.connect(fg); fg.connect(inputBus);
      // 音檔位置跟著蠟筒位置：暫停後接續、往回拉就往回對應
      const sNow=st?st.s:dispS; let off=fileCueAt(sNow);
      if(off==null){ off=FC.in; FC.anchor={s:sNow,t:FC.in}; }
      const dur=Math.max(0.01,FC.out-off); b.start(t0,off,dur);
      FC.recT0=t0; FC.recOff=off; FC.recDur=dur; FC.recGain=fg; FC.recSrc=b;
      node.port.postMessage({type:'stopAt',frame:Math.round((t0+dur)*ctx.sampleRate)+256}); // 依音訊時鐘準確收刀
      b.onended=()=>{ if(FC.recSrc===b){ FC.recT0=null; FC.recSrc=null; } if(mode==='record'&&liveSrc.includes(b)) doStop(); }; liveSrc.push(b,fg); break; }
    case 'tone': {
      const o=ctx.createOscillator(), g=ctx.createGain(); o.frequency.value=U.toneFreq; g.gain.value=0.8;
      o.connect(g); g.connect(inputBus); o.start(t0); toneOsc=o; liveSrc.push(o,g); break; }
    case 'sweep': {
      const o=ctx.createOscillator(), g=ctx.createGain(); g.gain.value=0.8;
      for(let i=0;i<30;i++){ o.frequency.setValueAtTime(40,t0+i*10); o.frequency.exponentialRampToValueAtTime(6000,t0+i*10+9.99); }
      o.connect(g); g.connect(inputBus); o.start(t0); liveSrc.push(o,g); break; }
    case 'melody': scheduleMelody(t0); break;
    case 'noise': {
      const len=ctx.sampleRate*2, b=ctx.createBuffer(1,len,ctx.sampleRate), d=b.getChannelData(0);
      for(let i=0;i<len;i++) d[i]=Math.random()*2-1;
      const s=ctx.createBufferSource(), g=ctx.createGain(); s.buffer=b; s.loop=true; g.gain.value=0.35;
      s.connect(g); g.connect(inputBus); s.start(t0); liveSrc.push(s,g); break; }
  }
}

async function doRecord(){
  if(!node) return; await ctx.resume();
  if(mode==='record'){ doStop(); return; }
  stopSources();
  if(U.src==='mic'){ try{ await startSource(); }catch(err){ toast('無法使用麥克風：'+err.message); return; } }
  else if(U.src==='file'&&!fileBuffer){ toast('請先在「錄音台」選擇音檔'); return; }
  else pendingSrc=true;   // 等刻刀落下才開始播放音源
  node.port.postMessage({type:'record'}); mode='record'; modeAck=false; hasContent=true; prepareNext();
}
async function doPlay(){ if(!node) return; await ctx.resume(); if(mode==='play'){ doStop(); return; } stopSources(); const ae=rackEntry(activeId); syncPlayRpm(ae);node.port.postMessage({type:'playEnd',s:ae&&ae.used>0?Math.max(ae.used,recMax):(hasContent?recMax:0)}); node.port.postMessage({type:'play'}); mode='play'; modeAck=false; prepareNext(); }
// 錄音與播放轉速分開後，剛錄完直接按播放也要用錄音時的轉速（這組被手動調過就沿用調過的值）
function syncPlayRpm(e){ if(!U.applyRec||!e||!(e.used>0)) return; const ov=groupOv[e.group]; if(ov&&ov.rpm!=null) return;
  const r=recRpm(e); if(!r) return; const v=Math.max(1,Math.min(240,Math.round(r))); if(v===P.rpm) return;
  applyingRec=true; try{ setRange('rpm',v); } finally{ applyingRec=false; } toast(`播放轉速改為錄音時的 ${v} rpm`); }
function doStop(){ stopSources(); if(node) node.port.postMessage({type:'stop'}); mode='idle'; clearNext(); }
function seekTo(s){ if(node) node.port.postMessage({type:'seek',s}); dispS=s; if(st) st={...st,s,w:0}; stTime=performance.now(); }

// ---------------- 介面 ----------------
const SPEC=[
 {title:'錄音 · Recording',open:true,rec:true,items:[
  {t:'select',k:'src',u:1,dock:'a',label:'音源',opts:[['file','匯入音檔'],['mic','麥克風'],['melody','旋律：瑪莉有隻小綿羊（愛迪生的第一段錄音）'],['tone','正弦波'],['sweep','掃頻 40 Hz → 6 kHz'],['noise','白噪音']]},
  {t:'html',dock:'a',when:['src','file'],html:`<div class="btns"><label class="btn">選擇音檔…<input type="file" id="fileIn" accept="audio/*,.mp3,.wav,.ogg,.oga,.m4a,.aac,.flac,.opus,.webm" hidden></label></div><div class="hint keep" id="fileName">尚未選擇音檔（支援 MP3、WAV、OGG、M4A、FLAC，也可以直接把檔案拖進視窗）</div>`},
  {t:'select',k:'micDev',u:1,dock:'a',when:['src','mic'],label:'輸入裝置',opts:[['','系統預設']]},   // 選項由 refreshMics() 填入
  {t:'range',k:'toneFreq',u:1,dock:'a',when:['src','tone'],label:'頻率',min:40,max:5000,step:1,unit:'Hz'},
  {t:'html',dock:'b',when:['src','file'],html:`<div id="fcon" class="fcon" style="display:none">
     <div class="fl"><div class="fhead"><span id="fPos">00:00.00</span><span id="fMeta"></span></div>
       <canvas id="fileWave"></canvas>
       <div class="frow"><label>起點 <input type="number" id="fIn" min="0" step="0.01"> s</label><label>終點 <input type="number" id="fOut" min="0" step="0.01"> s</label></div>
       <div class="hint keep" id="fSel"></div></div>
     <div class="fr"><div class="btns"><button class="btn" id="fPrev">▶ 試聽選取段</button><button class="btn" id="fAll">全選</button><button class="btn" id="fNorm">正規化</button></div>
       <div class="lab" style="margin-top:8px"><span>音檔增益</span><span class="v" id="fGainV">0.0 dB</span></div>
       <input type="range" id="fGain" min="-24" max="12" step="0.5" value="0">
       <div class="lab" style="margin-top:4px"><span>蠟筒起刻位置</span><span class="v" id="fCyl"></span></div>
       <div class="btns"><button class="btn" id="fCylHome">移到蠟筒開頭</button><button class="btn" id="fRestart">下次從起點重錄</button></div>
       <button class="btn burn" id="fBurn">⚡ 直接刻成蠟筒</button><div class="hint keep" id="fBurnInfo"></div></div>
     <div class="hint keep fhint">點波形設定起點、拖曳金色把手調整起訖點；刻錄時紅線與時間會跟著音檔走。要混音，先把唱頭移到想疊上去的位置再按 ●。</div>
   </div><div class="hint keep" id="fconEmpty">選擇音檔後，這裡會顯示整個檔案的波形與起訖點控制。</div>`},
  {t:'html',dock:'b',when:['src','!file'],html:`<div class="lab"><span>輸入波形</span><span class="v" id="recSrcName"></span></div><canvas id="recScope"></canvas><div class="hint keep">選擇「匯入音檔」可以顯示整個檔案的波形、設定起訖點與增益。</div>`},
  {t:'range',k:'inGain',dock:'c',label:'刻刀振幅（滿刻度）',min:2,max:60,step:0.5,unit:'µm',hint:'輸入 ±1 時刻刀上下位移的幅度。太大會刻穿溝壁。'},
  {t:'range',k:'baseDepth',dock:'c',label:'基準刻深',min:5,max:45,step:0.5,unit:'µm',hint:'無聲時刻刀切入蠟面的深度。'},
  {t:'select',k:'overdub',dock:'c',label:'疊錄方式',opts:[['carve','真實物理：只留切得最深的'],['mix','訊號相加：理想混音']]},
  {t:'check',k:'monitor',dock:'a',label:'錄音時監聽（請戴耳機）'},
  {t:'html',dock:'a',html:`<div class="lab"><span>輸入電平</span><span id="ovLamp" class="lamp">切穿</span></div><div class="meter"><div id="meterBar"></div></div>`},
 ]},
 {title:'錄放設定 · Drive & Sound',open:true,tabs:true,items:[
  {t:'html',html:`<div class="subh">驅動</div>`},
  {t:'select',k:'rDrive',m:'rec',label:'驅動方式',opts:[['motor','發條馬達（調速器）'],['crank','手搖曲柄（飛輪）']]},
  {t:'range',k:'rRpm',m:'rec',label:'錄音轉速',min:1,max:240,step:1,unit:'rpm',hint:'錄音時的目標轉速；曲柄開啟限速器時則是最高轉速。轉速越高，同一支蠟筒錄得越短、高頻越好。'},
  {t:'btns',m:'rec',b:[['bSlowR','顯微慢速 3 rpm'],['bStdR','標準 160 rpm']]},
  {t:'range',k:'rRatio',m:'rec',when:['rDrive','crank'],label:'齒輪比（曲柄 1 圈 → 蠟筒圈數）',min:0.25,max:8,step:0.25,unit:'×',hint:'數字越小越好控制。1× 時要以 160 rpm 搖曲柄才到標準速度。'},
  {t:'check',k:'rCrankGov',m:'rec',when:['rDrive','crank'],label:'限速器（最快只到錄音轉速，可輕鬆定速）'},
  {t:'select',k:'drive',m:'play',label:'驅動方式',opts:[['motor','發條馬達（調速器）'],['crank','手搖曲柄（飛輪）']]},
  {t:'range',k:'rpm',m:'play',label:'播放轉速',min:1,max:240,step:1,unit:'rpm',hint:'發條馬達的轉速；曲柄開啟限速器時則是最高轉速。和錄音轉速相同時音高才正確；裝上蠟筒時會自動套用它的錄音轉速。'},
  {t:'btns',m:'play',b:[['bSlow','顯微慢速 3 rpm'],['bStd','標準 160 rpm']]},
  {t:'range',k:'ratio',m:'play',when:['drive','crank'],label:'齒輪比（曲柄 1 圈 → 蠟筒圈數）',min:0.25,max:8,step:0.25,unit:'×',hint:'數字越小越好控制。1× 時要以 160 rpm 搖曲柄才到標準速度。'},
  {t:'check',k:'crankGov',m:'play',when:['drive','crank'],label:'限速器（最快只到播放轉速，可輕鬆定速）'},
  {t:'range',k:'wheelDeg',u:1,when:['drive|rDrive','crank'],label:'滾輪每格轉動',min:1,max:90,step:1,unit:'°',hint:'滑鼠滾輪每捲一格，曲柄轉幾度。觸控板會依捲動量等比例換算。'},
  {t:'html',when:['drive|rDrive','crank'],html:`<div class="crankwrap"><canvas id="crankPad" width="320" height="320"></canvas><div class="hint">在圓盤上順時針畫圈，或在圓盤上<b>捲動滑鼠滾輪</b>來搖曲柄（往下捲＝正轉，每格角度可在上方調整）。放手後飛輪會慢慢停下；逆向會倒轉。<br><span id="crankRo">0 rpm</span></div></div>`},
  {t:'html',html:`<div class="subh">聲學</div>`},
  {t:'check',k:'rHorn',m:'rec',label:'錄音喇叭與膜片共鳴'},
  {t:'html',m:'rec',html:`<div class="hint keep">刻刀的深度與振幅在錄音台設定；針尖、跳針與振膜增益只影響播放，請到「播放」分頁。</div>`},
  {t:'range',k:'stylusR',tog:'tipOn',m:'play',label:'針尖半徑',min:20,max:500,step:5,unit:'µm',hint:'球形針尖進不去比自己窄的凹谷，高頻被抹平。關閉時視為理想點接觸。'},
  {t:'range',k:'trackAccel',tog:'mistrack',m:'play',label:'跳針（循跡加速度上限）',min:300,max:20000,step:50,unit:'m/s²',hint:'唱針只能靠重量往下追溝底。表面下墜得比這更快時唱針會離面，落下時發出喀聲並在蠟上留下凹痕。'},
  {t:'check',k:'horn',m:'play',label:'播放喇叭與振膜共鳴'},
  {t:'range',k:'volume',m:'play',label:'振膜輸出增益',min:0,max:2,step:0.01,unit:'×',hint:'模擬振膜被推動的強弱，調高會更早進入飽和失真。單純想調大小聲請用上方的音量。'},
  {t:'html',html:`<div class="subh">失真</div>`},
  {t:'range',k:'cutterR',m:'rec',label:'刻刀半徑',min:60,max:400,step:5,unit:'µm',hint:'溝越深越寬。寬度超過圈距（棕蠟、黑蠟 254 µm；琥珀蠟 127 µm）時溝壁被切穿，播放時會聽到前後一圈（約 0.37 秒）的回音。刻刀半徑越大越容易切穿。'},
  {t:'range',k:'rFlutterAmt',tog:'rFlutter',m:'rec',label:'馬達抖動 flutter',min:0,max:2,step:0.05,unit:'%',hint:'錄音時調速器微幅追逐轉速，抖動會被刻進溝裡，之後怎麼播都在。'},
  {t:'check',k:'crosstalk',m:'play',label:'切穿回音（溝壁被切穿時聽到前後一圈）'},
  {t:'range',k:'eccMm',tog:'ecc',m:'play',label:'偏心 wow',min:0,max:1,step:0.01,unit:'mm',hint:'蠟筒沒套正，線速度每轉起伏一次，音高週期性搖擺。'},
  {t:'range',k:'flutterAmt',tog:'flutter',m:'play',label:'馬達抖動 flutter',min:0,max:2,step:0.05,unit:'%',hint:'播放時調速器微幅追逐轉速。'},
  {t:'range',k:'dustPct',tog:'dust',m:'play',label:'灰塵',min:0.01,max:2,step:0.01,unit:'%',hint:'溝底的微粒把唱針頂起，產生劈啪聲。'},
  {t:'range',k:'scratchCount',tog:'scratch',m:'play',label:'刮痕',min:1,max:8,step:1,unit:'道',hint:'橫越許多圈的刮痕，每轉一圈喀一聲。'},
  {t:'check',k:'crack',m:'play',label:'裂紋（每轉一次悶響）'},
  {t:'btns',m:'play',b:[['bReroll','重新產生刮痕與裂紋位置']]},
  {t:'range',k:'moldAmt',tog:'mold',m:'play',label:'霉斑／表面粗糙',min:0.1,max:8,step:0.1,unit:'µm',hint:'蠟面上的細微坑洞形成嘶嘶底噪。針尖越大，嘶聲越小。'},
 ]},
 {title:'磨損 · Wear',items:[
  {t:'range',k:'wearRate',tog:'wearOn',label:'播放磨損',min:0,max:1,step:0.005,unit:'µm/次',hint:'唱針壓在溝底的凸峰上，每經過一次就把峰頂磨低一點，越播越糊。'},
  {t:'btns',b:[['bClearWear','還原所有磨損']]},
 ]},
 {title:'蠟筒 · Cylinder',items:[
  {t:'select',k:'waxColor',u:1,label:'目前蠟筒的蠟材',opts:[['brown','棕蠟（約 1888–1901，軟質可重錄）'],['black','黑蠟 Gold Moulded（1902 起，硬質）'],['amber','琥珀蠟 Amberol（1908 起，4 分鐘）']]},
  {t:'html',html:`<div id="waxInfo" class="waxinfo"></div>`},

  {t:'btns',b:[['bNewCyl','新增空白蠟筒'],['bShave','刨平目前蠟筒']]},
  {t:'html',html:`<div class="hint" id="cylInfo"></div>`},
 ]},
 {title:'蠟筒架 · Rack',open:true,dockSec:true,dockCol:'r',items:[
  {t:'html',dock:'L',html:`<div class="rkTop"><span class="ro" id="rackSum"></span><span class="sp"></span><label class="ro dwl"><input type="checkbox" id="rackSelAll"> 全選</label></div><div id="rackList" class="rack"></div>
    <div class="hint keep">點名稱可以改名；按住 ⠿ 拖曳可調整順序（拖到別組就會移過去）；勾選後可在右邊儲存或匯出。同一組蠟筒會依序接續播放，你手動調過的轉速、唱針、振膜增益會沿用到整組。</div>`},
  {t:'html',dock:'r',html:`<div class="lab"><span>整理</span><span class="ro" id="selInfo">未選取</span></div>
    <div class="btns"><button class="btn" id="bNewCyl2">＋ 新增空白蠟筒</button><button class="btn" id="bSelGroup">選取的移到新群組</button><button class="btn" id="bSelDel">刪除選取</button></div>`},
  {t:'check',k:'chainRec',u:1,dock:'r',label:'錄音超過長度自動換新蠟筒'},
  {t:'check',k:'chainPlay',u:1,dock:'r',label:'播放完自動接續下一支'},
  {t:'check',k:'applyRec',u:1,dock:'r',label:'裝上時套用它的錄音轉速與唱針設定'},
  {t:'check',k:'autoLift',dock:'r',label:'播到沒有刻痕處自動抬起唱針（有下一支就換筒）'},
  {t:'btns',dock:'r',b:[['bClearOv','這組改回錄音時的設定']]},
 ]},
 {title:'檔案 · Files',dockSec:true,dockCol:'f',items:[
  {t:'select',k:'saveQ',u:1,dock:'f',label:'存檔品質',opts:[['lossless','無損（0.005 µm，與內部精度相同）'],['high','高品質（0.02 µm，約小 40%）'],['compact','精簡（0.05 µm，約小 55%）']]},
  {t:'html',dock:'f',html:`<div class="btns"><button class="btn" id="bSaveSel">儲存選取</button><button class="btn" id="bSave">儲存全部</button></div>
    <div class="btns" style="margin-top:6px"><button class="btn" id="bWavSel">匯出選取 WAV</button><button class="btn" id="bWav">匯出全部 WAV</button></div>
    <div class="btns" style="margin-top:6px"><button class="btn" id="bLoad">載入（加入架上）</button></div>
    <input type="file" id="loadIn" accept=".waxrack,.waxcyl" hidden>
    <div class="hint keep" id="fileMsg">.waxrack 保存刻痕、磨損、順序、群組與名稱、蠟材、錄音轉速與唱針刻刀設定。載入時會加到架上，不會取代現有蠟筒。匯出 WAV 依架上順序接續，套用目前的聲學與失真設定。</div>`},
 ]},
 {title:'效能 · Performance',items:[
  {t:'html',html:`<div class="hint" id="no3dNote" hidden>這台電腦無法使用 3D（WebGL），已改為無 3D 模式；聲音、剖面與所有功能照常。</div>`},
  {t:'select',k:'quality',u:1,label:'畫質預設',opts:[['high','高：窗光投影＋光束塵埃'],['med','中：洋房場景＋陰影'],['low','低：無場景、無陰影、半解析度'],['off','關閉 3D（只保留聲音與剖面）']]},
  {t:'check',k:'room',u:1,label:'洋房窗邊場景'},
  {t:'check',k:'shadows',u:1,label:'機構陰影'},
  {t:'check',k:'sunShadow',u:1,label:'窗光投影（陽光穿過窗格）'},
  {t:'check',k:'rays',u:1,label:'光束與浮塵'},
  {t:'check',k:'particles',u:1,label:'蠟屑粒子'},
  {t:'select',k:'res',u:1,label:'渲染解析度',opts:[['1','100%'],['0.75','75%'],['0.5','50%']]},
  {t:'select',k:'fpsCap',u:1,label:'幀率上限',opts:[['60','60 fps'],['30','30 fps'],['15','15 fps']]},
  {t:'html',html:`<div class="hint" id="perfInfo">這些設定只影響畫面，不影響聲音的物理運算，並會記在這台電腦上。</div>`},
 ]},
 {title:'檢視 · View',items:[
  {t:'range',k:'exag',u:1,label:'剖面垂直放大',min:1,max:20,step:1,unit:'×'},
  {t:'check',k:'showMag',u:1,label:'顯示放大剖面'},
  {t:'check',k:'showDepth',u:1,label:'顯示深度圖（目前蠟筒的刻痕資料）'},
  {t:'select',k:'magTab',u:1,label:'放大剖面內容',opts:[['both','全部同時顯示'],['groove','只看溝槽剖面'],['repro','只看唱頭剖面']]},
  {t:'btns',b:[['bClose','特寫唱針'],['bOverview','全景']]},
 ]},
 {title:'關於 · About',items:[
  {t:'html',html:`<div class="about"><b>蠟筒留聲機</b> v${__APP_VERSION__}<br>
    <span class="webOnly"><a class="relLink" target="_blank" rel="noopener">⬇ 下載 Windows 桌面版（免安裝）</a><br></span>
    <span class="deskOnly"><a href="${WEB_URL}" target="_blank" rel="noopener">線上版</a><br></span>
    <a href="${REPO_URL}" target="_blank" rel="noopener">原始碼（GitHub）</a></div>`},
 ]},
];

// 要記住的設定：錄音、錄放設定、磨損三區的所有項目，加上蠟筒架的播放開關
const SETTING_KEYS=new Set([...SPEC.filter(s=>/^(錄音|錄放設定|磨損) /.test(s.title)).flatMap(s=>s.items.flatMap(it=>[it.k,it.tog])).filter(Boolean),'chainRec','chainPlay','applyRec','autoLift']);
function rememberSetting(k){ userSet[k]=(k in P?P:U)[k]; try{ localStorage.setItem(SETTINGS_KEY,JSON.stringify(userSet)); }catch(e){} }
function fmt(v,step){ const d=step<0.01?3:step<0.1?2:step<1?1:0; return Number(v).toFixed(d); }
function placeRec(){
  const dock=$('recDock'); if(!dock) return;
  const rows=[...document.querySelectorAll('[data-dock]')], wide=innerWidth>860, TGT={a:'dockA',b:'dockB',c:'dockC',L:'rackL',r:'rackR',f:'rackF'};
  for(const r of rows){ if(r.closest('.pv-side')) continue;   // 正借給播放器側邊欄（movePlaySettings）
    const t=wide?$(TGT[r.dataset.dock]):r._home; if(t&&r.parentNode!==t) t.appendChild(r); }
  document.querySelectorAll('details[data-docked]').forEach(d=>d.style.display=wide?'none':'');
  dock.classList.toggle('on',wide);
  const compact=wide&&innerHeight<=860, mag=$('mag'); document.body.classList.toggle('compact',compact);
  if(compact&&mag.parentNode!==$('paneMag')) $('paneMag').appendChild(mag);
  else if(!compact&&mag.parentNode===$('paneMag')){ dock.after(mag); if(U.dockTab==='mag') setDockTab('rec'); }
  layoutDock();
}
// 3D 畫面置中在沒被面板蓋住的區域（上方按鈕列、右側面板、下方停駐列之間），空間小時等比縮小
function frameView(){ const W=innerWidth, H=innerHeight; camera.aspect=W/H;
  if(W<=860||carousel){ camera.clearViewOffset(); camera.updateProjectionMatrix(); return; }
  const pn=$('panel'), tp=$('transport'), dk=$('recDock'), mg=$('mag');
  const right=pn&&!pn.classList.contains('hide')?pn.getBoundingClientRect().left-8:W, top=tp?tp.getBoundingClientRect().bottom:0,
    bot=dk&&dk.classList.contains('on')?dk.getBoundingClientRect().top:H,
    left=mg&&U.showMag&&!mg.closest('#recDock')?mg.getBoundingClientRect().right+8:0;   // 浮在左下的剖面窗也算被蓋住
  const fw=Math.max(200,right-left), fh=Math.max(150,bot-top), s=Math.min(1,Math.max(0.45,Math.min(fw/W,fh/H)*1.05)), FW=W*s, FH=H*s;   // 虛擬畫面縮成 s 倍，整個場景跟著縮小
  camera.setViewOffset(FW,FH,FW/2-(left+fw/2),FH/2-(top+fh/2),W,H); camera.updateProjectionMatrix(); }
function layoutDock(){
  const dock=$('recDock'), on=dock&&dock.classList.contains('on'), h=on?dock.offsetHeight:0;
  document.documentElement.style.setProperty('--dockH',(on?h+10:0)+'px');
  if(innerWidth>860) $('mag').style.bottom=(on?h+24:14)+'px'; else $('mag').style.bottom='';
  const br=document.querySelector('.brand'), tp=$('transport');   // 標題會被上方按鈕列蓋到時就隱藏（寬度隨字型而定，所以用實際位置判斷）
  if(br&&tp){ br.style.visibility=''; br.style.visibility=br.getBoundingClientRect().right+12>tp.getBoundingClientRect().left?'hidden':''; }
  frameView();
}
function buildPanel(){
  const panel=$('panel');
  for(const sec of SPEC){
    const det=document.createElement('details'); if(sec.open) det.open=true; if(sec.rec) det.id='recDet'; if(sec.rec||sec.dockSec) det.dataset.docked='1';
    det.innerHTML=`<summary>${sec.title}</summary>`;
    if(sec.tabs){ det.dataset.pm=U.pmTab; const tb=document.createElement('div'); tb.className='mtabs';
      tb.innerHTML=`<button data-pm="rec">● 錄音</button><button data-pm="play">▶ 播放</button>`; det.appendChild(tb); }
    for(const it of sec.items){
      const row=document.createElement('div'); row.className='row';
      if(it.when) row.dataset.when=it.when.join(':'); if(it.dock) row.dataset.dock=it.dock; if(it.m) row.dataset.m=it.m;
      const obj=it.u?U:P;
      if(it.t==='range'){
        const tg=it.tog?`<label class="sw"><input type="checkbox" data-k="${it.tog}" ${P[it.tog]?'checked':''}><span></span></label>`:'';
        row.innerHTML=`<div class="lab"><span class="l">${tg}${it.label}</span><span class="vv"><button class="nudge" data-d="-1" tabindex="-1" aria-label="減少">−</button><span class="v" id="v_${it.k}">${fmt(obj[it.k],it.step)} ${it.unit}</span><button class="nudge" data-d="1" tabindex="-1" aria-label="增加">+</button></span></div>
          <input type="range" min="${it.min}" max="${it.max}" step="${it.step}" value="${obj[it.k]}" data-k="${it.k}" ${it.u?'data-u="1"':''}>${it.hint?`<div class="hint">${it.hint}</div>`:''}`;
        const r=row.querySelector('input[type=range]');
        r.addEventListener('input',()=>{ obj[it.k]=parseFloat(r.value); $('v_'+it.k).textContent=fmt(obj[it.k],it.step)+' '+it.unit; onChange(it.k); });
        if(it.tog){ const c=row.querySelector('.sw input'); const upd=()=>row.classList.toggle('off',!P[it.tog]); upd();
          c.addEventListener('change',()=>{ P[it.tog]=c.checked; upd(); onChange(it.tog); }); }
      } else if(it.t==='check'){
        row.innerHTML=`<div class="lab"><span class="l"><label class="sw"><input type="checkbox" data-ck="${it.k}" ${obj[it.k]?'checked':''}><span></span></label>${it.label}</span></div>`;
        const c=row.querySelector('input'); c.addEventListener('change',()=>{ obj[it.k]=c.checked; onChange(it.k); });
      } else if(it.t==='select'){
        row.innerHTML=`<div class="lab"><span>${it.label}</span></div><select>${it.opts.map(o=>`<option value="${o[0]}" ${obj[it.k]===o[0]?'selected':''}>${o[1]}</option>`).join('')}</select>`;
        const s=row.querySelector('select'); s.id='sel_'+it.k; s.addEventListener('change',()=>{ obj[it.k]=s.value; onChange(it.k); });
      } else if(it.t==='btns'){
        row.innerHTML=`<div class="btns">${it.b.map(b=>`<button class="btn" id="${b[0]}">${b[1]}</button>`).join('')}</div>`;
      } else row.innerHTML=it.html;
      row._home=det; det.appendChild(row);
    }
    const rkeys=sectionResetKeys(sec);
    if(rkeys.length||sec.title.startsWith('效能')){
      const tabKeys=()=>sec.tabs?sectionResetKeys(sec,U.pmTab):rkeys;
      const row=document.createElement('div'); row.className='row resetRow'; row._home=det; if(sec.rec) row.dataset.dock='c'; else if(sec.dockCol) row.dataset.dock=sec.dockCol;
      row.innerHTML=`<button class="btn resetBtn" title="${sec.title.startsWith('效能')?'回到「中」畫質預設':'只重設這一區的拉桿與開關'}">↺ 恢復本區預設</button>`;
      row.querySelector('button').onclick=()=>{ if(sec.title.startsWith('效能')){ if(!has3D){ toast('無 3D 模式，沒有可恢復的畫質設定'); return; } const q=$('sel_quality'); q.value='med'; q.dispatchEvent(new Event('change')); toast('畫質已恢復為「中」'); return; }
        resetKeys(tabKeys()); toast(`「${sec.title.split(' · ')[0]}」${sec.tabs?(U.pmTab==='rec'?'的錄音分頁':'的播放分頁'):''}已恢復預設`); };
      det.appendChild(row);
    }
    panel.appendChild(det);
  }
  updateWhen(); placeRec(); refreshMics();
  document.querySelectorAll('a.relLink').forEach(a=>a.href=RELEASES_URL);   // 開場、說明、關於裡的下載連結
}
function updateWhen(){ document.querySelectorAll('[data-when]').forEach(el=>{ const [ks,v]=el.dataset.when.split(':');   // k 可用 | 列出多個，任一個符合就顯示
    const ok=ks.split('|').some(k=>{ const cur=U[k]??P[k]; return v.startsWith('!')?cur!==v.slice(1):cur===v; }); el.style.display=ok?'':'none'; });
  const fe=$('fconEmpty'); if(fe) fe.style.display=fileBuffer?'none':''; const rn=$('recSrcName'); if(rn){ const o=document.querySelector('#sel_src option:checked'); rn.textContent=o?o.textContent.split('：')[0]:''; } }
// ---- 恢復預設 ----
const RESET_SKIP=new Set(['src','micDev','waxColor','drive','rDrive','magTab','quality','res','fpsCap','overdub','toneFreq']);   // 選擇類設定不重設
const WAX_REC_KEYS=new Set(['cutterR','baseDepth','inGain','stylusR']);   // 依目前蠟材的建議值
function sectionResetKeys(sec,m){ const ks=[]; for(const it of sec.items){ if(m&&it.m&&it.m!==m) continue; if((it.t==='range'||it.t==='check')&&it.k&&!RESET_SKIP.has(it.k)) ks.push(it.k); if(it.tog) ks.push(it.tog); } return ks; }
function defaultOf(k){ if(WAX_REC_KEYS.has(k)&&typeof WAXSPEC!=='undefined'){ const r=WAXSPEC[U.waxColor].rec; if(r&&k in r) return r[k]; } return k in DEF_P?DEF_P[k]:DEF_U[k]; }
function resetKeys(keys){
  for(const k of keys){ const v=defaultOf(k); if(v===undefined) continue;
    const rng=document.querySelector(`input[type=range][data-k="${k}"]`);
    if(rng&&typeof v==='number'){ setRange(k,v); continue; }
    const c=document.querySelector(`.sw input[data-k="${k}"]`)||document.querySelector(`input[data-ck="${k}"]`);
    if(c&&typeof v==='boolean'&&c.checked!==v){ c.checked=v; c.dispatchEvent(new Event('change')); } }
}
// 雙擊拉桿：只把這一個值恢復預設
document.addEventListener('dblclick',e=>{ const r=e.target.closest&&e.target.closest('input[type=range][data-k]'); if(!r) return; const k=r.dataset.k, v=defaultOf(k); if(typeof v!=='number') return;
  setRange(k,v); toast(`已恢復預設值 ${fmt(v,parseFloat(r.step)||1)}`); });
function setRange(k,v){ const r=document.querySelector(`input[type=range][data-k="${k}"]`); if(r){ r.value=v; r.dispatchEvent(new Event('input')); } }

function onChange(k){
  if(WK.has(k)) sendParams([k]);
  if(SETTING_KEYS.has(k)&&!applyingRec) rememberSetting(k);   // 裝上蠟筒、換蠟材時自動套用的值不記
  if(OV_KEYS.has(k)&&!applyingRec&&U.applyRec){ const e=rackEntry(activeId); if(e){ (groupOv[e.group]||(groupOv[e.group]={}))[k]=P[k]; if(k==='rpm') renderRack(); } }
  switch(k){
    case 'src': case 'drive': case 'rDrive': updateWhen(); if(k==='src'&&U.src==='mic') refreshMics(); break;
    case 'micDev': U.micName=U.micDev?($('sel_micDev').selectedOptions[0]?.textContent||''):''; rememberSetting('micName'); closeMic(); if(mode==='record'&&U.src==='mic') startSource().catch(err=>toast('無法使用麥克風：'+err.message)); break;   // 錄音中換裝置就直接接上新的
    case 'toneFreq': if(toneOsc) toneOsc.frequency.setTargetAtTime(U.toneFreq,ctx.currentTime,0.01); break;
    case 'waxColor': {
      const k=U.waxColor, ae=rackEntry(activeId), prev=(ae&&ae.wax)||'brown'; if(k===prev) break;
      if(ae&&ae.used>0){
        if(confirm(`這支蠟筒已有刻痕，圈距無法再改變。\n要另外新增一支${WAXSPEC[k].name}蠟筒並裝上嗎？`)){ addCylinder(capFor(k)).then(()=>{ applyWax(k,true); toast(`已裝上新的${WAXSPEC[k].name}蠟筒（${capFor(k)} 圈）`); }); }
        else { U.waxColor=prev; $('sel_waxColor').value=prev; }
        break; }
      applyWax(k,true); if(T!==capFor(k)) newCylinder(capFor(k));
      toast(`目前蠟筒改為${WAXSPEC[k].name}・${capFor(k)} 圈`); break; }
    case 'cutterR': waxU.uCutR.value=P.cutterR; break;
    case 'scratchCount': genDefects(); sendParams(['scratches','crackA0','crackSlope']); updateDefectUniforms(); break;
    case 'dust': case 'dustPct': case 'mold': case 'moldAmt': case 'scratch': case 'crack': updateDefectUniforms(); break;
    case 'showMag': $('mag').classList.toggle('hide',!U.showMag); $('dtMag').style.display=U.showMag?'':'none'; if(!U.showMag&&U.dockTab==='mag') setDockTab('rec'); frameView(); break;
    case 'showDepth': $('depthWin').classList.toggle('hide',!U.showDepth); depthDirty=true; break;
    case 'magTab': setMagTab(U.magTab); break;
    case 'wheelDeg': case 'saveQ': savePerf(); break;
    case 'chainRec': case 'chainPlay': if(mode!=='idle') prepareNext(); else renderRack(); break;
    case 'quality': if(PRESETS[U.quality]){ Object.assign(U,PRESETS[U.quality]); syncPerfUI(); } applyPerf(); break;
    case 'room': case 'shadows': case 'sunShadow': case 'rays': case 'particles': case 'res': case 'fpsCap':
      if(U.quality==='off'){ U.quality='med'; } syncPerfUI(); applyPerf(); break;
  }
}

function lock3DUI(){   // 無 WebGL：畫質只能是「關閉」，其餘 3D 選項停用
  const n=document.getElementById('no3dNote'); if(n) n.hidden=has3D; if(has3D) return;
  const q=document.getElementById('sel_quality'); if(q){ for(const o of q.options) o.disabled=o.value!=='off'; q.value='off'; q.disabled=true; }
  for(const k of ['room','shadows','sunShadow','rays','particles','res','fpsCap']){ const e=document.querySelector(`input[data-ck="${k}"]`)||document.getElementById('sel_'+k); if(e) e.disabled=true; }
}
function syncPerfUI(){
  const q=document.getElementById('sel_quality'); if(q) q.value=U.quality;
  for(const k of ['room','shadows','sunShadow','rays','particles']){ const c=document.querySelector(`input[data-ck="${k}"]`); if(c) c.checked=!!U[k]; }
  for(const k of ['res','fpsCap']){ const e=document.getElementById('sel_'+k); if(e) e.value=U[k]; }
  lock3DUI();
}
function masterGain(){ return U.muted?0:Math.pow(U.masterVol/100,2)*2; } // 平方曲線較符合聽感，100% ≈ +6 dB
function applyVolume(){
  if(master&&ctx) master.gain.setTargetAtTime(masterGain(),ctx.currentTime,0.03);
  $('vol').value=U.masterVol; $('volV').textContent=U.muted?'靜音':U.masterVol+'%';
  $('bMute').classList.toggle('off',U.muted); $('volWaves').style.display=U.muted?'none':'';
  savePerf();
}
// 拉桿微調：滾輪逐格、按住 Shift 一次 10 格；−/+ 按鈕可按住連續調整
function nudgeRange(r,dir,mult){
  const st=parseFloat(r.step)||1, mn=parseFloat(r.min), mx=parseFloat(r.max);
  let v=parseFloat(r.value)+dir*st*mult; v=Math.round(v/st)*st; v=Math.max(mn,Math.min(mx,v));
  const dec=(String(r.step).split('.')[1]||'').length; v=+v.toFixed(dec);
  if(v===parseFloat(r.value)) return;
  r.value=v; r.dispatchEvent(new Event('input',{bubbles:true})); r.dispatchEvent(new Event('change',{bubbles:true}));
}
document.addEventListener('wheel',e=>{
  const r=e.target.closest&&e.target.closest('input[type=range]'); if(!r||r.disabled) return;
  e.preventDefault();
  const unit=e.deltaMode===1?40:e.deltaMode===2?400:1; r._acc=(r._acc||0)+e.deltaY*unit;
  if(Math.abs(r._acc)<30) return;              // 觸控板的細碎捲動先累積
  const dir=r._acc<0?1:-1; r._acc=0; nudgeRange(r,dir,e.shiftKey?10:1);
},{passive:false});
document.addEventListener('pointerdown',e=>{
  const b=e.target.closest&&e.target.closest('.nudge'); if(!b) return; e.preventDefault();
  const r=b.closest('.row')&&b.closest('.row').querySelector('input[type=range]'); if(!r) return;
  const dir=+b.dataset.d, mult=e.shiftKey?10:1; nudgeRange(r,dir,mult);
  let t=setTimeout(function rep(){ nudgeRange(r,dir,mult); t=setTimeout(rep,70); },420);
  const stop=()=>{ clearTimeout(t); removeEventListener('pointerup',stop); removeEventListener('pointercancel',stop); };
  addEventListener('pointerup',stop); addEventListener('pointercancel',stop);
});
function toast(msg){ const t=$('toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(toast._t); toast._t=setTimeout(()=>t.classList.remove('show'),2600); }
function updateCylInfo(){
  const sec=T*60/NOM;
  $('cylInfo').innerHTML=`容量：${T} 圈・在 160 rpm 下約 ${Math.floor(sec/60)} 分 ${Math.round(sec%60)} 秒<br>刻紋區 81 mm（3.2 吋）÷ 圈距 ${P.pitch} µm（${WAXSPEC[U.waxColor].name}）<br>每圈 ${N.toLocaleString()} 格・每格 ${DX.toFixed(2)} µm<br>`+
    (hasContent?`已刻錄至 ${(recMax/(T*N)*100).toFixed(1)}%`:'空白蠟筒')+`<br><span style="opacity:.8">容量由蠟材決定，錄滿時會自動換到下一支。轉速越慢，同一支能錄的時間越長。</span>`;
}

// ---------------- 3D 場景 ----------------
let renderer;
if(has3D) try{ renderer=new THREE.WebGLRenderer({canvas:$('gl'),antialias:true,alpha:true}); }catch(e){ has3D=false; }
if(!has3D){   // 空殼 renderer：只提供場景程式會碰到的成員，全部不做事
  const nop=()=>{};
  renderer={domElement:$('gl'),setPixelRatio:nop,setSize:nop,render:nop,dispose:nop,shadowMap:{enabled:false,needsUpdate:false,type:0},toneMapping:0,toneMappingExposure:1,info:{},capabilities:{getMaxAnisotropy:()=>1}};
  U.quality='off';
}
renderer.setPixelRatio(Math.min(2,devicePixelRatio)*parseFloat(U.res)); renderer.setSize(innerWidth,innerHeight);
renderer.toneMapping=THREE.ACESFilmicToneMapping; renderer.toneMappingExposure=1.08;
renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap;
const scene=new THREE.Scene();
const pmrem=has3D?new THREE.PMREMGenerator(renderer):null;
const basicEnvTex=has3D?pmrem.fromScene(new RoomEnvironment(renderer),0.04).texture:null; scene.environment=basicEnvTex;
const camera=new THREE.PerspectiveCamera(34,innerWidth/innerHeight,0.3,600);
const HOME={pos:new THREE.Vector3(38,30,52),tgt:new THREE.Vector3(0,11.5,-3)};
camera.position.copy(HOME.pos);
const controls=new OrbitControls(camera,renderer.domElement);
controls.target.copy(HOME.tgt); controls.enableDamping=true; controls.minDistance=3; controls.maxDistance=95; controls.maxPolarAngle=Math.PI*0.49;

const hemi=new THREE.HemisphereLight(0xffe9c8,0x1a120c,0.45); scene.add(hemi);
const key=new THREE.DirectionalLight(0xffdcb0,2.3); key.position.set(18,34,22); key.castShadow=true;
key.shadow.mapSize.set(2048,2048); Object.assign(key.shadow.camera,{left:-32,right:32,top:32,bottom:-32,near:5,far:110}); key.shadow.bias=-0.0004; key.shadow.normalBias=0.03;
scene.add(key);
const rim=new THREE.DirectionalLight(0xa9c0ff,1.1); rim.position.set(-26,16,-22); scene.add(rim);
const fill=new THREE.PointLight(0xffc98a,60,40,2); fill.position.set(-6,16,12); scene.add(fill);
// 窗外陽光（從窗戶斜射進來）
const sun=new THREE.DirectionalLight(0xffe0b0,2.1); sun.position.set(-45,95,-230); sun.target.position.set(0,0,0); scene.add(sun,sun.target);
sun.shadow.mapSize.set(2048,2048); Object.assign(sun.shadow.camera,{left:-120,right:120,top:120,bottom:-120,near:100,far:460}); sun.shadow.bias=-0.0012; sun.shadow.normalBias=0.45;
const roomFill=new THREE.PointLight(0xffd7a8,2600,320,2); roomFill.position.set(60,140,80); scene.add(roomFill);

function canvasTex(w,h,draw,repeat){ const c=document.createElement('canvas'); c.width=w;c.height=h; draw(c.getContext('2d'),w,h);
  const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=8; if(repeat){t.wrapS=t.wrapT=THREE.RepeatWrapping;} return t; }
// 程序化雜訊（可平鋪）
function makeNoise(seed){ const r=mulberry32(seed), L=new Float32Array(65536); for(let i=0;i<65536;i++) L[i]=r();
  return (x,y,p)=>{ const xi=Math.floor(x), yi=Math.floor(y), xf=x-xi, yf=y-yi, u=xf*xf*(3-2*xf), v=yf*yf*(3-2*yf), m=p-1;
    const x0=((xi%p)+p)&m, x1=(x0+1)&m, y0=((yi%p)+p)&m, y1=(y0+1)&m;
    const a=L[y0*256+x0], b=L[y0*256+x1], c=L[y1*256+x0], d=L[y1*256+x1]; return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v; }; }
const NZ=makeNoise(11);
function fbm(x,y,base,oct){ let s=0,a=0.5,f=1; for(let i=0;i<oct;i++){ s+=a*NZ(x*base*f,y*base*f,base*f); f*=2; a*=0.5; } return s/(1-Math.pow(0.5,oct)); }
function pixTex(w,h,fn,srgb){ const c=document.createElement('canvas'); c.width=w; c.height=h; const g=c.getContext('2d'), id=g.createImageData(w,h), d=id.data;
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){ const o=fn(x/w,y/h), i=(y*w+x)*4; d[i]=o[0]; d[i+1]=o[1]; d[i+2]=o[2]; d[i+3]=255; }
  g.putImageData(id,0,0); const t=new THREE.CanvasTexture(c); if(srgb) t.colorSpace=THREE.SRGBColorSpace; t.wrapS=t.wrapT=THREE.RepeatWrapping; t.anisotropy=8; return t; }
const sm=(a,b,x)=>{ const t=Math.max(0,Math.min(1,(x-a)/(b-a))); return t*t*(3-2*t); };
// 指紋、手汗、氧化的粗糙度斑（灰階）
const smudgeTex=pixTex(256,256,(u,v)=>{ const n=fbm(u,v,4,5), f=fbm(u+3.1,v+1.7,16,3); const r=0.34+0.34*sm(.35,.75,n)+0.12*(f-0.5); const g=Math.max(0,Math.min(255,r*255)); return [g,g,g]; });
// 髮絲紋（鎳、鋼）
const brushTex=pixTex(256,256,(u,v)=>{ const n=fbm(u,v,64,3)*0.6+fbm(u*0.02,v,128,2)*0.4; const g=(0.2+0.28*n)*255; return [g,g,g]; });
// 黃銅氧化色：亮黃銅＋暗褐銅鏽＋偶見綠鏽
const patinaTex=pixTex(256,256,(u,v)=>{ const n=fbm(u,v,4,5), sp=fbm(u+7.3,v+2.1,8,4), t=sm(.42,.78,n), gr=sm(.72,.82,sp)*0.35;
  const r=200-70*t-60*gr, g=158-55*t-10*gr, b=82-35*t+15*gr; return [r,g,b]; },true);
// 油漆橘皮細節（凹凸）
const peelTex=pixTex(256,256,(u,v)=>{ const g=fbm(u,v,32,3)*255; return [g,g,g]; });
const woodTex=canvasTex(1024,512,(g,w,h)=>{ g.fillStyle='#5d331c'; g.fillRect(0,0,w,h);
  for(let i=0;i<300;i++){ const y=Math.random()*h, a=Math.random()*0.2; g.strokeStyle=`rgba(${25+Math.random()*30|0},${10+Math.random()*10|0},4,${a})`; g.lineWidth=0.5+Math.random()*2.5; g.beginPath();
    for(let x=0;x<=w;x+=16){ const yy=y+Math.sin(x*0.004+i)*7+Math.sin(x*0.013+i*0.7)*2; x?g.lineTo(x,yy):g.moveTo(x,yy);} g.stroke(); }
  for(let i=0;i<70;i++){ const y=Math.random()*h; g.strokeStyle=`rgba(190,120,70,${Math.random()*0.08})`; g.lineWidth=1+Math.random()*4; g.beginPath();
    for(let x=0;x<=w;x+=16){ const yy=y+Math.sin(x*0.005+i*1.3)*6; x?g.lineTo(x,yy):g.moveTo(x,yy);} g.stroke(); } },true);
const plateTex=canvasTex(1024,600,(g,w,h)=>{ g.fillStyle='#0c0a09'; g.fillRect(0,0,w,h);
  for(let i=0;i<500;i++){ g.strokeStyle=`rgba(255,240,220,${Math.random()*0.035})`; g.lineWidth=0.6; const x=Math.random()*w, y=Math.random()*h, a=Math.random()*6.28, l=10+Math.random()*60; g.beginPath(); g.moveTo(x,y); g.lineTo(x+Math.cos(a)*l,y+Math.sin(a)*l); g.stroke(); }
  g.strokeStyle='#b8944e'; g.lineWidth=3; g.strokeRect(24,24,w-48,h-48); g.lineWidth=1.2; g.strokeRect(36,36,w-72,h-72);
  g.fillStyle='#b8944e'; for(const [x,y] of [[36,36],[w-36,36],[36,h-36],[w-36,h-36]]){ g.beginPath(); g.arc(x,y,7,0,7); g.fill(); } });
const screwTex=canvasTex(256,64,(g,w,h)=>{ g.fillStyle='#8d9298'; g.fillRect(0,0,w,h); for(let x=-64;x<w+64;x+=10){ g.strokeStyle='#3b3f44'; g.lineWidth=3; g.beginPath(); g.moveTo(x,0); g.lineTo(x+16,h); g.stroke(); g.strokeStyle='#d4d8dc'; g.lineWidth=1; g.beginPath(); g.moveTo(x+4,0); g.lineTo(x+20,h); g.stroke(); } },true);
screwTex.repeat.set(40,1);

const M={
  walnut:new THREE.MeshPhysicalMaterial({map:woodTex,bumpMap:woodTex,bumpScale:0.6,roughness:.62,roughnessMap:smudgeTex,clearcoat:.28,clearcoatRoughness:.5,envMapIntensity:.4}),
  lacquer:new THREE.MeshPhysicalMaterial({map:plateTex,roughness:.7,bumpMap:peelTex,bumpScale:0.12,clearcoat:.35,clearcoatRoughness:.32,envMapIntensity:.22}),
  brass:new THREE.MeshStandardMaterial({map:patinaTex,metalness:1,roughness:1,roughnessMap:smudgeTex,envMapIntensity:1}),
  nickel:new THREE.MeshStandardMaterial({color:0xcdc8bd,metalness:1,roughness:1,roughnessMap:brushTex}),
  iron:new THREE.MeshPhysicalMaterial({color:0x17130f,metalness:.25,roughness:.68,roughnessMap:smudgeTex,bumpMap:peelTex,bumpScale:0.2,clearcoat:.12,clearcoatRoughness:.6,envMapIntensity:.6}),
  steel:new THREE.MeshStandardMaterial({map:screwTex,metalness:1,roughness:.42}),
  steelPlain:new THREE.MeshStandardMaterial({color:0x9da2a6,metalness:1,roughness:1,roughnessMap:brushTex}),
  glass:new THREE.MeshPhysicalMaterial({color:0x1a1d22,roughness:.12,metalness:0,clearcoat:.8,clearcoatRoughness:.2,envMapIntensity:1}),
  sapphire:new THREE.MeshPhysicalMaterial({color:0x7d8fff,roughness:.1,emissive:0x000000,clearcoat:1}),
  hornIn:new THREE.MeshStandardMaterial({color:0x3a110d,metalness:.15,roughness:.82,side:THREE.BackSide}),
  floor:new THREE.MeshStandardMaterial({color:0x17110d,roughness:.96}),
  knob:new THREE.MeshPhysicalMaterial({color:0x2b1408,roughness:.55,roughnessMap:smudgeTex,clearcoat:.25,clearcoatRoughness:.5}),
};
const WAXC={brown:0x5a3218,black:0x1a1512,amber:0x8a4c14};
const waxMat=new THREE.MeshPhysicalMaterial({color:WAXC.brown,roughness:.5,clearcoat:.25,clearcoatRoughness:.45,envMapIntensity:.75,sheen:.15,sheenColor:new THREE.Color(0xffd9a0)});
const waxPlain=new THREE.MeshPhysicalMaterial({color:WAXC.brown,roughness:.55,roughnessMap:smudgeTex,clearcoat:.2,clearcoatRoughness:.5,envMapIntensity:.75});
function setWaxColor(){ waxMat.color.setHex(WAXC[U.waxColor]); waxPlain.color.setHex(WAXC[U.waxColor]); }

// 刻痕貼圖：每圈一列，每列 2048 欄，值＝該欄最深刻深
let texData=new Uint8Array(TEXW*T), texDirty=false, lastTexUp=0;
function makeTex(){ const t=new THREE.DataTexture(texData,TEXW,T,THREE.RedFormat,THREE.UnsignedByteType);
  t.wrapS=THREE.RepeatWrapping; t.wrapT=THREE.ClampToEdgeWrapping; t.magFilter=THREE.LinearFilter; t.minFilter=THREE.LinearFilter; t.generateMipmaps=false; t.unpackAlignment=1; t.needsUpdate=true; return t; }
let grooveTex=makeTex();
const waxU={uGroove:{value:grooveTex},uT:{value:T},uV0:{value:V0},uV1:{value:V1},uPitch:{value:PITCH},uCutR:{value:P.cutterR},uVis:{value:0},
  uScr:{value:Array.from({length:8},()=>new THREE.Vector4())},uScrK:{value:Array.from({length:8},()=>new THREE.Vector2())},uScrN:{value:0},
  uCrack:{value:new THREE.Vector3()},uDust:{value:0},uMold:{value:0}};
function updateVis(){ waxU.uT.value=T; waxU.uVis.value=((XE-XS)/T)/PITCH*2.5; }
updateVis();
function updateDefectUniforms(){
  const sc=P.scratches; waxU.uScrN.value=P.scratch?sc.length:0;
  for(let i=0;i<8;i++){ const s=sc[i]; if(s){ waxU.uScr.value[i].set(s.a0/N,s.slope/N,s.w/N*4,s.depth); waxU.uScrK.value[i].set(s.k0,s.k1); } }
  waxU.uCrack.value.set(P.crack?1:0,P.crackA0/N,P.crackSlope/N);
  waxU.uDust.value=P.dust?P.dustPct/100:0; waxU.uMold.value=P.mold?P.moldAmt:0;
}
updateDefectUniforms();

const WAX_HEAD=`
varying vec2 vGUv;
uniform sampler2D uGroove; uniform float uT,uV0,uV1,uPitch,uCutR,uVis;
uniform vec4 uScr[8]; uniform vec2 uScrK[8]; uniform int uScrN; uniform vec3 uCrack; uniform float uDust,uMold;
float gh21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(gh21(i),gh21(i+vec2(1.,0.)),f.x),mix(gh21(i+vec2(0.,1.)),gh21(i+vec2(1.,1.)),f.x),f.y); }
float depthAt(float k,float u){ if(k<0.||k>=uT) return 0.; return texture(uGroove,vec2(u,(k+.5)/uT)).r*85.0; }
vec3 perturbN2(vec3 sp,vec3 sn,vec2 dH,float fd){ vec3 sx=dFdx(sp), sy=dFdy(sp); vec3 r1=cross(sy,sn), r2=cross(sn,sx);
  float det=dot(sx,r1)*fd; vec3 gr=sign(det)*(dH.x*r1+dH.y*r2); return normalize(abs(det)*sn-gr); }
`;
const WAX_COLOR=`
float gU=vGUv.x, gA=(vGUv.y-uV0)/(uV1-uV0), gX=gA*uT;
float gDep=0., gScr=0., gCr=0., gMold=0., gDust=0.;
if(gA>0.&&gA<1.){
  float kc=floor(gX-gU+.5);
  for(int j=-1;j<=1;j++){ float k=kc+float(j); float D=depthAt(k,gU); if(D<=0.) continue; float f=(gX-(k+gU))*uPitch; gDep=max(gDep,D-f*f/(2.*uCutR)); }
}
for(int i=0;i<8;i++){ if(i>=uScrN) break; vec4 s=uScr[i]; if(gX<uScrK[i].x||gX>uScrK[i].y) continue;
  float d=fract(gU-(s.x+s.y*gX)+.5)-.5; float w=max(s.z,fwidth(gU)*.9); float m=1.-smoothstep(w*.5,w,abs(d)); gScr=max(gScr,m); gDep+=m*s.w; }
if(uCrack.x>.5){ float d=fract(gU-(uCrack.y+uCrack.z*gX)+.5)-.5; float w=max(.0007,fwidth(gU)*1.2); gCr=1.-smoothstep(w*.4,w,abs(d)); gDep+=gCr*40.; }
if(uMold>0.){ float n=vnoise(vec2(gU*60.,vGUv.y*18.))*.6+vnoise(vec2(gU*190.,vGUv.y*55.))*.4; gMold=smoothstep(.6,.85,n)*clamp(uMold/5.,.2,1.); }
if(uDust>0.){ vec2 q=vec2(gU*1400.,vGUv.y*420.); if(gh21(floor(q))<uDust*1.2){ gDust=1.-smoothstep(.08,.22,length(fract(q)-.5)); } }
float gMask=clamp(gDep/20.,0.,1.);
float gFade=1.-smoothstep(.3,.9,fwidth(gX));
float gFar=(gA>0.&&gA<1.)?clamp(depthAt(floor(gX-gU+.5),gU)/30.,0.,1.):0.;   // 遠看：溝槽太細看不見，改以刻深呈現光澤帶
diffuseColor.rgb*=mix(1.,1.22,gMask*gFade)*mix(1.,1.16,gFar*(1.-gFade));
diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.6,.6,.52),gMold*.75);
diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.86,.8,.7),gScr*.5+gDust*.6);
diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.02),gCr*.85);
float gH=-gDep*uVis*gFade;
`;
waxMat.onBeforeCompile=(sh)=>{
  Object.assign(sh.uniforms,waxU);
  sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 vGUv;').replace('#include <uv_vertex>','#include <uv_vertex>\nvGUv=uv;');
  sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\n'+WAX_HEAD)
    .replace('#include <color_fragment>','#include <color_fragment>\n'+WAX_COLOR)
    .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=clamp(mix(roughnessFactor,.2,max(gMask*.85*gFade,gFar*.7*(1.-gFade)))+gMold*.45+gScr*.2,.04,1.);')
    .replace('#include <normal_fragment_maps>','#include <normal_fragment_maps>\n{ vec2 dH=vec2(dFdx(gH),dFdy(gH)); normal=perturbN2(-vViewPosition,normal,dH,faceDirection); }');
};

const machine=new THREE.Group(); scene.add(machine);
function mesh(geo,mat,parent,pos,rot){ const m=new THREE.Mesh(geo,mat); if(pos) m.position.set(...pos); if(rot) m.rotation.set(...rot); m.castShadow=true; m.receiveShadow=true; (parent||machine).add(m); return m; }
const cylX=(r,len,mat,parent,pos,seg=48)=>{ const g=new THREE.CylinderGeometry(r,r,len,seg); g.rotateZ(-Math.PI/2); return mesh(g,mat,parent,pos); };

// 地面與底座
const floor=new THREE.Mesh(new THREE.CircleGeometry(90,64),M.floor); floor.rotation.x=-Math.PI/2; floor.receiveShadow=true; scene.add(floor);
mesh(new THREE.BoxGeometry(33.4,0.6,20.4),M.walnut,null,[0,0.3,0]);
mesh(new THREE.BoxGeometry(32,6.4,19),M.walnut,null,[0,3.8,0]);
mesh(new THREE.BoxGeometry(32.8,0.5,19.8),M.walnut,null,[0,7.0,0]);
mesh(new THREE.BoxGeometry(30.5,0.22,17.5),M.lacquer,null,[0,7.36,0]);
// 銘牌
await document.fonts.ready.catch(()=>{});
const plaqueTex=canvasTex(1024,200,(g,w,h)=>{ const gr=g.createLinearGradient(0,0,0,h); gr.addColorStop(0,'#2a2016'); gr.addColorStop(1,'#120d09'); g.fillStyle=gr; g.fillRect(0,0,w,h);
  g.strokeStyle='#c9a45c'; g.lineWidth=4; g.strokeRect(8,8,w-16,h-16); g.lineWidth=1.5; g.strokeRect(20,20,w-40,h-40);
  g.fillStyle='#ecd59c'; g.textAlign='center'; g.font='italic 600 58px "Cormorant Garamond", serif'; g.fillText('Le Phonographe à Cylindre',w/2,92);
  g.fillStyle='#c9a45c'; g.font='30px "Noto Serif TC", serif'; g.fillText('蠟 筒 留 聲 機',w/2,152); });
mesh(new THREE.PlaneGeometry(11,2.15),new THREE.MeshStandardMaterial({map:plaqueTex,metalness:.4,roughness:.4}),null,[0,3.9,9.52]);
// 立柱與軸承
for(const sx of [-1,1]){
  mesh(new THREE.BoxGeometry(1.1,CY-7.47+0.2,7.4),M.iron,null,[sx*7.5,(CY+7.47)/2,-2.2]);
  cylX(0.75,1.3,M.brass,null,[sx*7.5,CY,0],40);
  cylX(0.55,1.3,M.brass,null,[sx*7.5,CY+1.6,-4.4],32);
  cylX(0.55,1.3,M.brass,null,[sx*7.5,CY-0.6,-4.4],32);
}
cylX(0.28,16,M.steelPlain,null,[0,CY,0]);
cylX(0.3,15,M.nickel,null,[0,CY+1.6,-4.4],24);
const feedScrew=cylX(0.33,15,M.steel,null,[0,CY-0.6,-4.4],24);

// 蠟筒（可旋轉）
const cylGroup=new THREE.Group(); cylGroup.position.set(0,CY,0); machine.add(cylGroup);
const waxGeo=new THREE.CylinderGeometry(RW,RW,LWAX,320,1,true); waxGeo.rotateZ(-Math.PI/2);
const waxMesh=mesh(waxGeo,waxMat,cylGroup);
for(const sx of [-1,1]){ const rg=new THREE.RingGeometry(2.32,RW,96); rg.rotateY(sx*Math.PI/2); mesh(rg,waxPlain,cylGroup,[sx*LWAX/2,0,0]); }
const mandrel=new THREE.CylinderGeometry(2.28,2.22,LWAX+0.4,64); mandrel.rotateZ(-Math.PI/2); mesh(mandrel,M.brass,cylGroup);
const pulley=cylX(2.0,0.6,M.brass,cylGroup,[-6.9,0,0],64);
for(let i=0;i<6;i++){ const sp=mesh(new THREE.BoxGeometry(0.2,3.6,0.3),M.brass,cylGroup,[-6.6,0,0]); sp.rotation.x=i*Math.PI/3; }

// 滑台、唱頭與喇叭
const carriage=new THREE.Group(); machine.add(carriage);
cylX(0.58,2.4,M.brass,carriage,[0,CY+1.6,-4.4],32);
mesh(new THREE.BoxGeometry(1.2,1.6,0.9),M.iron,carriage,[0,CY+0.5,-4.4]);
mesh(new THREE.BoxGeometry(0.5,2.6,0.5),M.brass,carriage,[0,CY+2.9,-4.4]);
mesh(new THREE.BoxGeometry(0.6,0.45,2.7),M.brass,carriage,[0,CY+RW+1.3,-3.1]);
const repro=new THREE.Group(); carriage.add(repro);
const REPRO_Y=CY+RW+1.3; repro.position.set(0,REPRO_Y,0);
mesh(new THREE.CylinderGeometry(2.0,2.0,0.9,64),M.nickel,repro,[0,0,0]);
mesh(new THREE.CylinderGeometry(1.72,1.72,0.06,64),M.glass,repro,[0,0.47,0]);
mesh(new THREE.TorusGeometry(1.86,0.09,12,64),M.brass,repro,[0,0.47,0],[Math.PI/2,0,0]);
const ring=mesh(new THREE.TorusGeometry(2.02,0.07,10,64),new THREE.MeshStandardMaterial({color:0x7a5e2e,emissive:0x000000,metalness:.6,roughness:.3}),repro,[0,-0.2,0],[Math.PI/2,0,0]);
const lever=mesh(new THREE.BoxGeometry(0.1,1.05,0.1),M.nickel,repro,[0,-0.95,0]);
const stylusBall=mesh(new THREE.SphereGeometry(0.075,20,14),M.sapphire,repro,[0,-1.45,0]);
// 錄音用刻刀：藍寶石鑿形刀尖（刃口橫跨溝槽、垂直於蠟面移動方向），尖端與球針底部同高
const cutterTip=new THREE.Group(); repro.add(cutterTip); cutterTip.visible=false;
{ const bladeGeo=new THREE.ConeGeometry(0.12,0.3,4,1); bladeGeo.rotateX(Math.PI); bladeGeo.scale(1,1,0.32);
  const bladeMat=new THREE.MeshPhysicalMaterial({color:0xe6ecff,roughness:.06,metalness:0,clearcoat:1,emissive:0x000000,envMapIntensity:1.2});
  const blade=new THREE.Mesh(bladeGeo,bladeMat); blade.position.y=-1.525+0.15; blade.castShadow=true; cutterTip.add(blade); cutterTip.userData.mat=bladeMat;
  const collar=new THREE.Mesh(new THREE.CylinderGeometry(0.075,0.09,0.16,16),M.brass); collar.position.y=-1.525+0.36; cutterTip.add(collar); }
mesh(new THREE.CylinderGeometry(0.42,0.5,0.7,32),M.brass,repro,[0,0.8,0]);
// 喇叭（指數型號角）
const hornPts=[]; for(let i=0;i<=60;i++){ const t=i/60, y=t*17; const r=0.4*Math.exp(Math.log(6.6/0.4)*Math.pow(t,1.6)); hornPts.push(new THREE.Vector2(r,y)); }
hornPts.push(new THREE.Vector2(6.85,17.1));
const hornGeo=new THREE.LatheGeometry(hornPts,96);
const horn=new THREE.Group(); repro.add(horn); horn.position.set(0,1.1,0);
horn.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3(0,0.42,-1).normalize());
mesh(hornGeo,M.brass,horn); mesh(hornGeo,M.hornIn,horn);
mesh(new THREE.TorusGeometry(6.85,0.14,12,96),M.brass,horn,[0,17.1,0],[Math.PI/2,0,0]);

// 調速器
const gov=new THREE.Group(); gov.position.set(11.6,7.47,-5.2); machine.add(gov);
mesh(new THREE.CylinderGeometry(1.0,1.2,0.3,40),M.brass,gov,[0,0.15,0]);
mesh(new THREE.CylinderGeometry(0.1,0.1,4.4,12),M.steelPlain,gov,[0,2.4,0]);
const govSpin=new THREE.Group(); govSpin.position.y=4.3; gov.add(govSpin);
mesh(new THREE.SphereGeometry(0.22,16,12),M.brass,govSpin);
const govArms=[];
for(const s of [-1,1]){ const a=new THREE.Group(); a.rotation.y=s>0?0:Math.PI; govSpin.add(a); const piv=new THREE.Group(); a.add(piv);
  mesh(new THREE.CylinderGeometry(0.05,0.05,1.9,8),M.steelPlain,piv,[0,-0.95,0]); mesh(new THREE.SphereGeometry(0.42,24,16),M.brass,piv,[0,-1.9,0]); govArms.push(piv); }
// 曲柄
const crank3=new THREE.Group(); crank3.position.set(16.3,4.2,3); machine.add(crank3);
cylX(0.26,1.2,M.nickel,crank3,[0,0,0],20);
mesh(new THREE.BoxGeometry(0.35,3.4,0.6),M.nickel,crank3,[0.6,1.6,0]);
cylX(0.36,1.5,M.knob,crank3,[1.4,3.1,0],24);

// 蠟屑粒子
const CHIPS=500; const chipPos=new Float32Array(CHIPS*3), chipVel=new Float32Array(CHIPS*3), chipLife=new Float32Array(CHIPS);
const chipGeo=new THREE.BufferGeometry(); chipGeo.setAttribute('position',new THREE.BufferAttribute(chipPos,3));
const chipMat=new THREE.PointsMaterial({color:0xd09a62,size:0.07,transparent:true,opacity:.9,depthWrite:false});
const chips=new THREE.Points(chipGeo,chipMat); chips.frustumCulled=false; scene.add(chips);
for(let i=0;i<CHIPS;i++){ chipPos[i*3+1]=-100; }
let chipIdx=0, chipAcc=0;

scene.traverse(o=>{ if(o.isMesh&&o!==floor){ o.castShadow=true; o.receiveShadow=true; } });

// ---------------- 洋房窗邊場景 ----------------
const room=new THREE.Group(); scene.add(room);
const FLOOR_Y=-76, CEIL_Y=190, ZB=-90, ZF=130, XL=-150, XR=150, WAIN=14;
const WIN={x0:-60,x1:40,y0:-4,y1:140};
function uvScale(geo,su,sv){ const uv=geo.attributes.uv; for(let i=0;i<uv.count;i++) uv.setXY(i,uv.getX(i)*su,uv.getY(i)*sv); return geo; }
function rmesh(geo,mat,pos,rot,cast=true){ const m=new THREE.Mesh(geo,mat); if(pos) m.position.set(...pos); if(rot) m.rotation.set(...rot); m.castShadow=cast; m.receiveShadow=true; room.add(m); return m; }
const RND=mulberry32(2024);
// 壁紙：橄欖綠底＋淡金色大馬士革花紋
const paperTex=canvasTex(512,512,(g,w,h)=>{ g.fillStyle='#2b3426'; g.fillRect(0,0,w,h);
  for(let x=0;x<w;x+=32){ g.fillStyle='rgba(255,255,255,0.018)'; g.fillRect(x,0,14,h); }
  const motif=(cx,cy,sz)=>{ g.save(); g.translate(cx,cy);
    for(const sd of [-1,1]){ g.beginPath(); g.moveTo(0,-sz); g.bezierCurveTo(sd*sz*.75,-sz*.7,sd*sz*.9,sz*.15,0,sz*.95); g.bezierCurveTo(sd*sz*.35,sz*.25,sd*sz*.3,-sz*.4,0,-sz); g.fill();
      g.beginPath(); g.moveTo(sd*sz*.15,sz*.55); g.bezierCurveTo(sd*sz*.8,sz*.5,sd*sz*.95,sz*1.0,sd*sz*.55,sz*1.15); g.bezierCurveTo(sd*sz*.6,sz*.9,sd*sz*.4,sz*.7,sd*sz*.15,sz*.55); g.fill(); }
    g.beginPath(); g.ellipse(0,-sz*1.15,sz*.12,sz*.2,0,0,7); g.fill(); g.restore(); };
  g.fillStyle='rgba(196,164,96,0.20)'; motif(w/2,h/2-20,110); motif(0,-20,110); motif(w,-20,110); motif(0,h-20,110); motif(w,h-20,110);
  g.fillStyle='rgba(0,0,0,0.18)'; motif(w/2,h/2-20,55);
  for(let i=0;i<5000;i++){ g.fillStyle=`rgba(${RND()<.5?0:255},${RND()<.5?0:255},0,0.025)`; g.fillRect(RND()*w,RND()*h,1.5,1.5); } },true);
// 護牆板：深色橡木凸框
const wainTex=canvasTex(512,512,(g,w,h)=>{ g.fillStyle='#3a2416'; g.fillRect(0,0,w,h);
  for(let i=0;i<160;i++){ g.strokeStyle=`rgba(20,10,4,${RND()*0.25})`; g.lineWidth=0.5+RND()*2; const x=RND()*w; g.beginPath(); g.moveTo(x,0); g.bezierCurveTo(x+RND()*10-5,h*.3,x+RND()*10-5,h*.7,x+RND()*8-4,h); g.stroke(); }
  const m=48; g.strokeStyle='rgba(255,210,160,0.18)'; g.lineWidth=5; g.beginPath(); g.moveTo(m,h-m); g.lineTo(m,m); g.lineTo(w-m,m); g.stroke();
  g.strokeStyle='rgba(0,0,0,0.45)'; g.beginPath(); g.moveTo(w-m,m); g.lineTo(w-m,h-m); g.lineTo(m,h-m); g.stroke();
  g.strokeStyle='rgba(0,0,0,0.35)'; g.lineWidth=3; g.strokeRect(m+12,m+12,w-2*m-24,h-2*m-24); },true);
// 木地板
const floorTex=canvasTex(1024,1024,(g,w,h)=>{ const rh=64;
  for(let y=0;y<h;y+=rh){ let x=-RND()*300; while(x<w){ const L=180+RND()*260, c=0.75+RND()*0.35;
      g.fillStyle=`rgb(${92*c|0},${56*c|0},${32*c|0})`; g.fillRect(x,y,L,rh);
      for(let k=0;k<7;k++){ g.strokeStyle=`rgba(30,14,6,${RND()*0.25})`; g.lineWidth=0.6+RND()*1.4; const yy=y+RND()*rh; g.beginPath(); g.moveTo(x,yy); g.bezierCurveTo(x+L*.3,yy+RND()*6-3,x+L*.7,yy+RND()*6-3,x+L,yy+RND()*4-2); g.stroke(); }
      g.fillStyle='rgba(10,5,2,0.8)'; g.fillRect(x,y,2,rh); x+=L; }
    g.fillStyle='rgba(10,5,2,0.85)'; g.fillRect(0,y,w,2); } },true);
// 窗外花園（柔焦）
const gardenTex=canvasTex(1024,640,(g,w,h)=>{
  const sky=g.createLinearGradient(0,0,0,h*.75); sky.addColorStop(0,'#8fb3d6'); sky.addColorStop(.55,'#e8e3cf'); sky.addColorStop(1,'#f7e6c0'); g.fillStyle=sky; g.fillRect(0,0,w,h);
  const sn=g.createRadialGradient(w*.25,h*.12,0,w*.25,h*.12,w*.45); sn.addColorStop(0,'rgba(255,250,230,1)'); sn.addColorStop(1,'rgba(255,240,205,0)'); g.fillStyle=sn; g.fillRect(0,0,w,h);
  g.filter='blur(10px)';
  for(let i=0;i<46;i++){ const x=RND()*w, y=h*(.42+RND()*.14), r=40+RND()*90; g.fillStyle=`rgba(${105+RND()*30|0},${138+RND()*25|0},${128+RND()*20|0},.55)`; g.beginPath(); g.ellipse(x,y,r,r*.8,0,0,7); g.fill(); }
  g.filter='blur(5px)';
  for(let i=0;i<60;i++){ const x=RND()*w, y=h*(.55+RND()*.12), r=30+RND()*70; g.fillStyle=`rgba(${48+RND()*30|0},${82+RND()*30|0},${40+RND()*20|0},.85)`; g.beginPath(); g.ellipse(x,y,r,r*.7,0,0,7); g.fill(); }
  for(let i=0;i<40;i++){ const x=RND()*w, y=h*(.55+RND()*.12), r=12+RND()*30; g.fillStyle='rgba(190,215,120,.25)'; g.beginPath(); g.ellipse(x-8,y-10,r,r*.6,0,0,7); g.fill(); }
  const lawn=g.createLinearGradient(0,h*.66,0,h); lawn.addColorStop(0,'#6f8f45'); lawn.addColorStop(1,'#4a6a2e'); g.fillStyle=lawn; g.fillRect(0,h*.66,w,h*.34);
  g.filter='blur(2px)';
  for(let i=0;i<220;i++){ const x=RND()*w, y=h*(.6+RND()*.12); g.fillStyle=['#f2d7df','#ffffff','#e7a3b5','#f6e3a1'][i%4]; g.beginPath(); g.arc(x,y,2+RND()*3,0,7); g.fill(); }
  g.filter='none'; },false);
gardenTex.colorSpace=THREE.SRGBColorSpace;

const RM={
  paper:new THREE.MeshStandardMaterial({map:paperTex,roughness:.92,envMapIntensity:.3}),
  wain:new THREE.MeshPhysicalMaterial({map:wainTex,roughness:.6,roughnessMap:smudgeTex,clearcoat:.15,clearcoatRoughness:.5,envMapIntensity:.4}),
  trim:new THREE.MeshStandardMaterial({color:0xe6dfcf,roughness:.62,roughnessMap:smudgeTex,bumpMap:peelTex,bumpScale:.2,envMapIntensity:.5}),
  darkwood:new THREE.MeshPhysicalMaterial({map:woodTex,color:0x8a6050,roughness:.55,clearcoat:.2,clearcoatRoughness:.5,envMapIntensity:.4}),
  floor:new THREE.MeshPhysicalMaterial({map:floorTex,roughness:.58,roughnessMap:smudgeTex,clearcoat:.2,clearcoatRoughness:.55,envMapIntensity:.45}),
  ceil:new THREE.MeshStandardMaterial({color:0xd6ccb8,roughness:.95}),
  table:new THREE.MeshPhysicalMaterial({map:woodTex,color:0xa87060,bumpMap:woodTex,bumpScale:.5,roughness:.6,roughnessMap:smudgeTex,clearcoat:.12,clearcoatRoughness:.55,envMapIntensity:.22}),
  felt:new THREE.MeshPhysicalMaterial({color:0x1d3627,roughness:.95,sheen:1,sheenRoughness:.5,sheenColor:new THREE.Color(0x5f8a6a)}),
  velvet:new THREE.MeshPhysicalMaterial({color:0x4a0f15,roughness:.9,sheen:1,sheenRoughness:.45,sheenColor:new THREE.Color(0xc0606a),side:THREE.DoubleSide}),
  glass:new THREE.MeshPhysicalMaterial({color:0xdfe9f0,roughness:.04,metalness:0,transparent:true,opacity:.1,envMapIntensity:1.2,depthWrite:false}),
  garden:new THREE.MeshBasicMaterial({map:gardenTex}),
};
RM.garden.color.setScalar(1.35);
paperTex.repeat.set(1,1); wainTex.repeat.set(1,1);
// 地板、天花板
rmesh(uvScale(new THREE.PlaneGeometry(XR-XL,ZF-ZB),(XR-XL)/120,(ZF-ZB)/120),RM.floor,[0,FLOOR_Y,(ZF+ZB)/2],[-Math.PI/2,0,0],false);
rmesh(new THREE.PlaneGeometry(XR-XL,ZF-ZB),RM.ceil,[0,CEIL_Y,(ZF+ZB)/2],[Math.PI/2,0,0],false);
// 牆段：上半壁紙、下半護牆板
function wallSeg(x0,x1,y0,y1,z,depth,face){ // face: 牆面朝向 +z
  const w=x1-x0, h=y1-y0; if(w<=0||h<=0) return;
  const mat=y1<=WAIN+0.01?RM.wain:RM.paper, sc=mat===RM.wain?60:50;
  rmesh(uvScale(new THREE.BoxGeometry(w,h,depth),w/sc,h/sc),mat,[(x0+x1)/2,(y0+y1)/2,z-depth/2]);
}
function splitWall(x0,x1,y0,y1,z,d){ if(y0<WAIN){ wallSeg(x0,x1,y0,Math.min(y1,WAIN),z,d); } if(y1>WAIN){ wallSeg(x0,x1,Math.max(y0,WAIN),y1,z,d); } }
const WD=14;
splitWall(XL,WIN.x0,FLOOR_Y,CEIL_Y,ZB,WD); splitWall(WIN.x1,XR,FLOOR_Y,CEIL_Y,ZB,WD);
splitWall(WIN.x0,WIN.x1,WIN.y1,CEIL_Y,ZB,WD); splitWall(WIN.x0,WIN.x1,FLOOR_Y,WIN.y0,ZB,WD);
// 側牆與前牆（平面，朝內）
function sideWall(len,cx,cz,ry){
  rmesh(uvScale(new THREE.PlaneGeometry(len,WAIN-FLOOR_Y),len/60,(WAIN-FLOOR_Y)/60),RM.wain,[cx,(WAIN+FLOOR_Y)/2,cz],[0,ry,0],false);
  rmesh(uvScale(new THREE.PlaneGeometry(len,CEIL_Y-WAIN),len/50,(CEIL_Y-WAIN)/50),RM.paper,[cx,(CEIL_Y+WAIN)/2,cz],[0,ry,0],false);
}
sideWall(ZF-ZB,XL,(ZF+ZB)/2,Math.PI/2); sideWall(ZF-ZB,XR,(ZF+ZB)/2,-Math.PI/2); sideWall(XR-XL,0,ZF,Math.PI);
// 腰線、踢腳板、天花線
for(const [len,cx,cz,ry] of [[XR-XL,0,ZB,0],[ZF-ZB,XL,(ZF+ZB)/2,Math.PI/2],[ZF-ZB,XR,(ZF+ZB)/2,-Math.PI/2],[XR-XL,0,ZF,Math.PI]]){
  const g=new THREE.Group(); g.position.set(cx,0,cz); g.rotation.y=ry; room.add(g);
  for(const [y,h,d,mat] of [[WAIN,3,2.5,RM.darkwood],[FLOOR_Y+7,14,1.8,RM.darkwood],[CEIL_Y-6,12,4,RM.trim]]){
    const m=new THREE.Mesh(new THREE.BoxGeometry(len,h,d),mat); m.position.set(0,y,d/2); m.receiveShadow=true; g.add(m); }
}
// 窗框：內側飾框、窗台、窗格
// 窗框：各零件刻意錯開 0.4～1 cm，避免共面造成的深度閃爍
const fw=5, LIN=1.6, cx=(WIN.x0+WIN.x1)/2, ww=WIN.x1-WIN.x0;
// 窗洞內襯（覆蓋牆洞切面）
rmesh(new THREE.BoxGeometry(LIN,WIN.y1-WIN.y0-0.4,WD+0.5),RM.trim,[WIN.x0+LIN/2,(WIN.y0+0.4+WIN.y1)/2,ZB-WD/2+0.25]);
rmesh(new THREE.BoxGeometry(LIN,WIN.y1-WIN.y0-0.4,WD+0.5),RM.trim,[WIN.x1-LIN/2,(WIN.y0+0.4+WIN.y1)/2,ZB-WD/2+0.25]);
rmesh(new THREE.BoxGeometry(ww-2*LIN,LIN,WD+0.5),RM.trim,[cx,WIN.y1-LIN/2,ZB-WD/2+0.25]);
// 窗台（深入窗洞並向室內突出）
rmesh(new THREE.BoxGeometry(ww+2*fw+8,2.8,WD+9),RM.trim,[cx,WIN.y0-1.0,ZB-WD+(WD+9)/2]);
rmesh(new THREE.BoxGeometry(ww+2*fw+2,3.5,1.6),RM.trim,[cx,WIN.y0-4.6,ZB+1.2]);
// 牆面上的飾框（側框與頭框厚度不同，避免轉角共面）
for(const sx of [-1,1]){ const xe=sx<0?WIN.x0:WIN.x1; rmesh(new THREE.BoxGeometry(fw+1,WIN.y1-WIN.y0+fw,2),RM.trim,[xe+sx*(fw/2-0.5),(WIN.y0+WIN.y1+fw)/2,ZB+1]); }
rmesh(new THREE.BoxGeometry(ww+2*fw+3,fw+1.5,2.6),RM.trim,[cx,WIN.y1+fw/2+0.25,ZB+1.3]);
// 窗格（直料略厚於橫料）
const sashZ=ZB-WD+4;
for(const fx of [1/3,2/3]) rmesh(new THREE.BoxGeometry(2.2,WIN.y1-WIN.y0-2*LIN,3.4),RM.trim,[WIN.x0+ww*fx,(WIN.y0+WIN.y1)/2,sashZ]);
for(const fy of [0.32,0.5,0.68]) rmesh(new THREE.BoxGeometry(ww-2*LIN,fy===0.5?4:2.2,fy===0.5?3.8:3),RM.trim,[cx,WIN.y0+(WIN.y1-WIN.y0)*fy,sashZ]);
rmesh(new THREE.PlaneGeometry(WIN.x1-WIN.x0,WIN.y1-WIN.y0),RM.glass,[(WIN.x0+WIN.x1)/2,(WIN.y0+WIN.y1)/2,sashZ-1.6],null,false);
// 窗外景
const gardenPlane=rmesh(new THREE.PlaneGeometry(720,450),RM.garden,[-10,55,-330],null,false); gardenPlane.receiveShadow=false;
// 窗簾（天鵝絨，有皺褶）與窗簾桿
function drape(w,h,cx,top,z,flip){ const geo=new THREE.PlaneGeometry(w,h,56,30), pos=geo.attributes.position;
  for(let i=0;i<pos.count;i++){ const x=pos.getX(i), y=pos.getY(i), t=(h/2-y)/h, xn=(x/w+0.5);
    const gather=1-0.35*Math.sin(Math.PI*Math.min(1,t*1.4))*(flip?xn:1-xn); // 中段束起
    pos.setX(i,x*gather+(flip?-1:1)*w*0.18*(1-gather)); pos.setZ(i,(3.2+1.5*t)*Math.sin(x*0.42+Math.sin(y*0.02)*0.6)+2*Math.sin(x*0.13)); }
  geo.computeVertexNormals(); const m=rmesh(geo,RM.velvet,[cx,top-h/2,z]); return m; }
drape(42,206,WIN.x0-14,CEIL_Y-22,ZB+18,false);
drape(42,206,WIN.x1+14,CEIL_Y-22,ZB+18,true);
{ const geo=new THREE.PlaneGeometry(WIN.x1-WIN.x0+70,26,60,10), pos=geo.attributes.position;
  for(let i=0;i<pos.count;i++){ const x=pos.getX(i), y=pos.getY(i); pos.setY(i,y-6*Math.pow(Math.sin(((x/(WIN.x1-WIN.x0+70))+0.5)*Math.PI*3),2)*((13-y)/26)); pos.setZ(i,1.5*Math.sin(x*0.5)); }
  geo.computeVertexNormals(); rmesh(geo,RM.velvet,[(WIN.x0+WIN.x1)/2,CEIL_Y-26,ZB+21]); }
{ const rod=new THREE.CylinderGeometry(1,1,WIN.x1-WIN.x0+90,20); rod.rotateZ(Math.PI/2); rmesh(rod,M.brass,[(WIN.x0+WIN.x1)/2,CEIL_Y-14,ZB+19]);
  for(const x of [WIN.x0-45,WIN.x1+45]) rmesh(new THREE.SphereGeometry(2.4,20,14),M.brass,[x,CEIL_Y-14,ZB+19]);
  for(const x of [WIN.x0-45,WIN.x1+45]) rmesh(new THREE.BoxGeometry(1.2,1.2,19),M.brass,[x,CEIL_Y-14,ZB+9.5]); }   // 窗簾桿支架
// 窗台上的小花瓶（瓶底貼齊窗台面，花莖從瓶口各自連到一朵花）
{ const sillTop=WIN.y0+0.4, vx=WIN.x1-26, vz=ZB+2.5, VH=16;
  const pts=[]; for(let i=0;i<=24;i++){ const t=i/24; pts.push(new THREE.Vector2(Math.max(0.45,2.6+3.0*Math.sin(t*Math.PI*1.05)-2.3*t),t*VH)); }
  pts.unshift(new THREE.Vector2(0,0));
  rmesh(new THREE.LatheGeometry(pts,48),new THREE.MeshPhysicalMaterial({color:0x6e8fa6,roughness:.22,clearcoat:1,clearcoatRoughness:.15,envMapIntensity:.9}),[vx,sillTop,vz]);
  const stemMat=new THREE.MeshStandardMaterial({color:0x4b6b2c,roughness:.8}), up=new THREE.Vector3(0,1,0);
  const heads=[[-6.5,27,-1.2],[-3.2,31,1.4],[0,33.5,-0.4],[3.4,30.5,1.6],[6.2,26.5,-1.0]], cols=[0xf2d0da,0xfaf4ea,0xe49cb0,0xf2d0da,0xfaf4ea];
  heads.forEach(([dx,dy,dz],i)=>{
    const B=new THREE.Vector3(vx+dx*0.06,sillTop+VH-0.6,vz+dz*0.05), F=new THREE.Vector3(vx+dx,sillTop+dy,vz+dz);
    const dir=new THREE.Vector3().subVectors(F,B), len=dir.length(); dir.normalize();
    const st=new THREE.Mesh(new THREE.CylinderGeometry(.13,.16,len,6),stemMat); st.position.copy(B).addScaledVector(dir,len/2); st.quaternion.setFromUnitVectors(up,dir); st.castShadow=true; room.add(st);
    const fl=new THREE.Mesh(new THREE.SphereGeometry(1.7,16,12),new THREE.MeshStandardMaterial({color:cols[i],roughness:.75})); fl.position.copy(F).addScaledVector(dir,1.2); fl.castShadow=true; room.add(fl);
    const lf=new THREE.Mesh(new THREE.SphereGeometry(1,10,6),stemMat); lf.scale.set(1.4,0.25,0.6); lf.position.copy(B).addScaledVector(dir,len*0.55); lf.quaternion.setFromUnitVectors(up,dir); lf.rotateZ(1.1*(i%2?1:-1)); room.add(lf);
  }); }
// 桌子（桃花心木）與絨布桌墊
rmesh(uvScale(new THREE.BoxGeometry(120,3.5,76),1.5,1),RM.table,[0,-1.75,-4]);
rmesh(new THREE.BoxGeometry(124,1.2,80),RM.table,[0,-3.9,-4]);
rmesh(new THREE.BoxGeometry(108,9,64),RM.table,[0,-9,-4]);
{ const pts=[]; const H=65; for(let i=0;i<=40;i++){ const t=i/40; const r=2.2+0.9*Math.sin(t*Math.PI*6)*Math.exp(-((t-0.75)**2)*30)+1.4*Math.exp(-((t-0.15)**2)*60)+0.5*(1-t); pts.push(new THREE.Vector2(r,t*H)); }
  const lg=new THREE.LatheGeometry(pts,24); for(const [x,z] of [[-50,-31],[50,-31],[-50,23],[50,23]]) rmesh(lg,RM.table,[x,FLOOR_Y,z]); }
rmesh(new THREE.PlaneGeometry(44,28),RM.felt,[0,0.02,0],[-Math.PI/2,0,0],false);
// 桌上的書
for(const [i,c] of [[0,0x5a1d1d],[1,0x1f3550],[2,0x3d4a24]].entries()){ const b=rmesh(new THREE.BoxGeometry(17-c[0],2.6,12-c[0]),new THREE.MeshPhysicalMaterial({color:c[1],roughness:.7,roughnessMap:smudgeTex,sheen:.4}),[38,1.3+i*2.6,14]); b.rotation.y=0.15*(i-1); }

// 光束與浮塵
const rays=new THREE.Group(); scene.add(rays);
const rayTex=canvasTex(64,256,(g,w,h)=>{ const gr=g.createLinearGradient(0,0,0,h); gr.addColorStop(0,'rgba(255,236,200,0)'); gr.addColorStop(.25,'rgba(255,236,200,1)'); gr.addColorStop(1,'rgba(255,236,200,0)'); g.fillStyle=gr; g.fillRect(0,0,w,h);
  const e=g.createLinearGradient(0,0,w,0); e.addColorStop(0,'rgba(0,0,0,1)'); e.addColorStop(.5,'rgba(0,0,0,0)'); e.addColorStop(1,'rgba(0,0,0,1)'); g.globalCompositeOperation='destination-out'; g.fillStyle=e; g.fillRect(0,0,w,h); });
const sunDir=new THREE.Vector3().subVectors(sun.target.position,sun.position).normalize();
const winC=new THREE.Vector3((WIN.x0+WIN.x1)/2,(WIN.y0+WIN.y1)/2+5,ZB-4);
for(let i=0;i<5;i++){ const len=170, geo=new THREE.PlaneGeometry(26+RND()*20,len); geo.rotateX(-Math.PI/2); geo.translate(0,0,len/2);
  const m=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({map:rayTex,transparent:true,opacity:.05+RND()*.04,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide}));
  m.position.copy(winC).add(new THREE.Vector3((RND()-.5)*60,(RND()-.5)*70,0)); m.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),sunDir); m.rotateZ(RND()*Math.PI); rays.add(m); }
const MOTES=260, motePos=new Float32Array(MOTES*3), moteSeed=new Float32Array(MOTES);
for(let i=0;i<MOTES;i++){ const t=RND(); const p0=winC.clone().add(new THREE.Vector3((RND()-.5)*60,(RND()-.5)*60,0)).addScaledVector(sunDir,t*150); motePos.set([p0.x,p0.y,p0.z],i*3); moteSeed[i]=RND()*100; }
const moteGeo=new THREE.BufferGeometry(); moteGeo.setAttribute('position',new THREE.BufferAttribute(motePos,3));
const moteSprite=canvasTex(32,32,(g,w,h)=>{ const gr=g.createRadialGradient(16,16,0,16,16,16); gr.addColorStop(0,'rgba(255,255,255,1)'); gr.addColorStop(.4,'rgba(255,255,255,.5)'); gr.addColorStop(1,'rgba(255,255,255,0)'); g.fillStyle=gr; g.fillRect(0,0,w,h); });
const motes=new THREE.Points(moteGeo,new THREE.PointsMaterial({map:moteSprite,color:0xfff0d0,size:.22,transparent:true,opacity:.4,blending:THREE.AdditiveBlending,depthWrite:false})); motes.frustumCulled=false; rays.add(motes);

// 環境反射：從房間內擷取一次
let roomEnvTex=null;
function captureRoomEnv(){
  const rt=new THREE.WebGLCubeRenderTarget(256,{type:THREE.HalfFloatType}), cc=new THREE.CubeCamera(1,900,rt); cc.position.set(0,18,10); scene.add(cc);
  const vis=[machine.visible,chips.visible,rays.visible,floor.visible]; machine.visible=chips.visible=rays.visible=floor.visible=false;
  scene.environment=basicEnvTex; cc.update(renderer,scene);
  [machine.visible,chips.visible,rays.visible,floor.visible]=vis; scene.remove(cc);
  if(roomEnvTex) roomEnvTex.dispose(); roomEnvTex=pmrem.fromCubemap(rt.texture).texture; rt.dispose();
}
let lastShadowCfg='';
function applyPerf(){
  if(!has3D) U.quality='off';
  const off=U.quality==='off';
  $('gl').style.visibility=off?'hidden':'visible';
  renderer.setPixelRatio(Math.min(2,devicePixelRatio)*parseFloat(U.res)); renderer.setSize(innerWidth,innerHeight);
  room.visible=!!U.room; floor.visible=!U.room; sun.visible=!!U.room; roomFill.visible=!!U.room;
  hemi.intensity=U.room?0.3:0.45;
  rays.visible=!!(U.rays&&U.room); chips.visible=!!U.particles;
  key.castShadow=!!U.shadows; sun.castShadow=!!(U.sunShadow&&U.room);
  const cfg=[key.castShadow,sun.castShadow].join();
  renderer.shadowMap.enabled=key.castShadow||sun.castShadow;
  if(cfg!==lastShadowCfg){ lastShadowCfg=cfg; renderer.shadowMap.needsUpdate=true; scene.traverse(o=>{ if(o.material){ for(const m of [].concat(o.material)) m.needsUpdate=true; } }); }
  if(U.room&&!off){ if(!roomEnvTex) captureRoomEnv(); scene.environment=roomEnvTex; } else scene.environment=basicEnvTex;
  lock3DUI(); savePerf();
}



// ---------------- 桌上的蠟筒架（顯示其他蠟筒，最多 5 支） ----------------
const shelf=new THREE.Group(); shelf.position.set(-41,0,-17); shelf.rotation.y=0.3; scene.add(shelf);
{ const bm=new THREE.Mesh(new THREE.BoxGeometry(37,1.6,10.5),M.walnut); bm.position.y=0.8; bm.castShadow=bm.receiveShadow=true; shelf.add(bm);
  const lip=new THREE.Mesh(new THREE.BoxGeometry(37,0.5,0.6),M.brass); lip.position.set(0,1.85,5.0); shelf.add(lip); }
const grooveBump=canvasTex(8,512,(g,w,h)=>{ g.fillStyle='#808080'; g.fillRect(0,0,w,h); for(let y=0;y<h;y+=4){ g.fillStyle='#2a2a2a'; g.fillRect(0,y,w,2); } },true);
grooveBump.colorSpace=THREE.NoColorSpace; grooveBump.repeat.set(1,24);
const SLOTS=[];
for(let i=0;i<5;i++){
  const g=new THREE.Group(); g.position.set(-14.4+i*7.2,1.6,0); shelf.add(g);
  const peg=new THREE.Mesh(new THREE.CylinderGeometry(1.9,2.1,9,20),M.walnut); peg.position.y=4.5; g.add(peg);
  const mat=new THREE.MeshPhysicalMaterial({color:WAXC.brown,roughness:.5,clearcoat:.25,clearcoatRoughness:.45,envMapIntensity:.7,bumpScale:0.8});
  const body=new THREE.Mesh(new THREE.CylinderGeometry(RW,RW,LWAX,64,1,true),mat); body.position.y=LWAX/2+0.05; body.castShadow=body.receiveShadow=true; g.add(body);
  const top=new THREE.Mesh(new THREE.RingGeometry(2.32,RW,48),mat); top.rotation.x=-Math.PI/2; top.position.y=LWAX+0.06; g.add(top);
  const tagC=document.createElement('canvas'); tagC.width=128; tagC.height=48; const tagT=new THREE.CanvasTexture(tagC); tagT.colorSpace=THREE.SRGBColorSpace;
  const tag=new THREE.Mesh(new THREE.PlaneGeometry(4.6,1.7),new THREE.MeshStandardMaterial({map:tagT,roughness:.6,metalness:.3}));
  tag.position.set(0,-0.75,5.27); g.add(tag);
  body.userData.slot=i; top.userData.slot=i; tag.userData.slot=i;
  SLOTS.push({g,mat,tagC,tagT,id:null,pick:[body,top,tag]});
}
let shelfSig='', shelfPage=0;
const SHELF_ARROWS=[];
for(const d of [-1,1]){ const g=new THREE.ConeGeometry(0.95,1.9,3); g.rotateZ(-d*Math.PI/2); g.scale(1,1,0.45); const m=new THREE.Mesh(g,M.brass); m.position.set(d*17.5,2.55,4.0); m.userData.arrow=d; m.castShadow=true; m.visible=false; shelf.add(m); SHELF_ARROWS.push(m); }
function updateShelf(){
  const all=rack.map((e,i)=>({e,i})).filter(x=>x.e.id!==activeId), pages=Math.max(1,Math.ceil(all.length/5));
  shelfPage=Math.max(0,Math.min(pages-1,shelfPage)); const others=all.slice(shelfPage*5,shelfPage*5+5);
  SHELF_ARROWS.forEach(m=>m.visible=pages>1); shelf.userData.pages=pages;
  const pi=$('spInfo'); if(pi) pi.textContent=`第 ${shelfPage+1}／${pages} 排`; $('shelfPager').classList.toggle('on',$('backBtn').classList.contains('on')&&pages>1);
  const sig=others.map(x=>`${x.e.id}:${x.i}:${x.e.wax}:${x.e.used>0}:${x.e.name||''}`).join('|')+'/'+(rack.length-1)+'/'+shelfPage;
  if(sig===shelfSig) return; shelfSig=sig;
  SLOTS.forEach((sl,k)=>{ const o=others[k]; sl.g.visible=!!o; sl.id=o?o.e.id:null; if(!o) return;
    const used=o.e.used>0; sl.mat.color.setHex(WAXC[o.e.wax||'brown']); sl.mat.bumpMap=used?grooveBump:null; sl.mat.roughness=used?.38:.58; sl.mat.needsUpdate=true;
    const c=sl.tagC.getContext('2d'); c.fillStyle='#1a130c'; c.fillRect(0,0,128,48); c.strokeStyle='#c9a45c'; c.lineWidth=3; c.strokeRect(3,3,122,42);
    c.fillStyle='#ecd59c'; c.textAlign='center'; c.font='600 22px "Cormorant Garamond", serif'; c.fillText(`No. ${o.i+1}`,64,24);
    c.font='13px "Noto Serif TC", serif'; c.fillStyle='#c9a45c'; const sub=o.e.name?(o.e.name.length>8?o.e.name.slice(0,7)+'…':o.e.name):(used?WAXSPEC[o.e.wax||'brown'].name:'空白'); c.fillText(sub,64,41);
    sl.tagT.needsUpdate=true; });
  const more=rack.length-1-others.length; shelf.userData.more=more;
}
const shelfPick=()=>SLOTS.filter(s=>s.g.visible).flatMap(s=>s.pick);

// ---------------- 手搖曲柄輸入 ----------------
const crank={angle:0,active:false,lastA:0,lastT:0,w:0,wheelW:0,wheelT:-1e9};
function setupCrank(){
  const pad=$('crankPad'); if(!pad) return;
  const ang=e=>{ const r=pad.getBoundingClientRect(); return Math.atan2(e.clientY-r.top-r.height/2,e.clientX-r.left-r.width/2); };
  pad.addEventListener('pointerdown',e=>{ pad.setPointerCapture(e.pointerId); crank.active=true; crank.lastA=ang(e); crank.lastT=performance.now(); });
  pad.addEventListener('pointermove',e=>{ if(!crank.active) return; const a=ang(e); let d=a-crank.lastA; if(d>Math.PI)d-=2*Math.PI; if(d<-Math.PI)d+=2*Math.PI;
    const now=performance.now(), dt=Math.max(4,now-crank.lastT)/1000; crank.w=crank.w*0.6+(d/(2*Math.PI)/dt)*0.4; crank.angle+=d; crank.lastA=a; crank.lastT=now; });
  const up=()=>{ crank.active=false; }; pad.addEventListener('pointerup',up); pad.addEventListener('pointercancel',up);
  // 滾輪：每一格轉動的角度可調
  pad.addEventListener('wheel',e=>{ e.preventDefault();
    const unit=e.deltaMode===1?40:e.deltaMode===2?400:1, d=(e.deltaY*unit/100)*(U.wheelDeg*Math.PI/180);   // 一格（deltaY≈100）轉 wheelDeg 度
    const now=performance.now(), dt=Math.min(0.25,Math.max(0.016,(now-crank.wheelT)/1000));
    const inst=d/(2*Math.PI)/dt; crank.wheelW=(now-crank.wheelT>300?0:crank.wheelW)*0.55+inst*0.45; crank.wheelT=now; crank.angle+=d; },{passive:false});
}
function drawCrankPad(){
  const pad=$('crankPad'); if(!pad||(P.drive!=='crank'&&P.rDrive!=='crank')) return; const g=pad.getContext('2d'), w=pad.width, c=w/2;
  g.clearRect(0,0,w,w);
  const gr=g.createRadialGradient(c*0.8,c*0.7,10,c,c,c); gr.addColorStop(0,'#3a2c1c'); gr.addColorStop(1,'#120d09'); g.fillStyle=gr; g.beginPath(); g.arc(c,c,c-6,0,7); g.fill();
  g.strokeStyle='#c9a45c'; g.lineWidth=3; g.beginPath(); g.arc(c,c,c-8,0,7); g.stroke();
  g.lineWidth=1; g.strokeStyle='rgba(201,164,92,.35)'; for(let i=0;i<24;i++){ const a=i/24*Math.PI*2; g.beginPath(); g.moveTo(c+Math.cos(a)*(c-20),c+Math.sin(a)*(c-20)); g.lineTo(c+Math.cos(a)*(c-12),c+Math.sin(a)*(c-12)); g.stroke(); }
  const a=crank.angle, hx=c+Math.cos(a)*(c-46), hy=c+Math.sin(a)*(c-46);
  g.strokeStyle='#d9d6cf'; g.lineWidth=12; g.lineCap='round'; g.beginPath(); g.moveTo(c,c); g.lineTo(hx,hy); g.stroke();
  g.fillStyle='#ecd59c'; g.beginPath(); g.arc(c,c,14,0,7); g.fill();
  const kg=g.createRadialGradient(hx-6,hy-6,2,hx,hy,24); kg.addColorStop(0,'#7a4a28'); kg.addColorStop(1,'#2b1408'); g.fillStyle=kg; g.beginPath(); g.arc(hx,hy,24,0,7); g.fill();
  g.strokeStyle=crank.active?'#ecd59c':'#6b5631'; g.lineWidth=2; g.stroke();
}

// ---------------- 放大剖面 ----------------
let refSm=-22;
const WAXCSS={brown:['#8a5329','#2a160a'],black:['#3a302a','#0e0b09'],amber:['#b8732c','#3a1e08']};
function drawMag(){
  if(!U.showMag) return;
  const cv=$('magCanvas'), dpr=Math.min(2,devicePixelRatio||1), w=cv.clientWidth, h=cv.clientHeight;
  if(w<120||h<60) return;   // 視窗太窄或被隱藏時不繪製
  if(cv.width!==Math.round(w*dpr)||cv.height!==Math.round(h*dpr)){ cv.width=Math.round(w*dpr); cv.height=Math.round(h*dpr); }
  const g=cv.getContext('2d'); g.setTransform(dpr,0,0,dpr,0,0); g.clearRect(0,0,w,h);
  const scopeH=34, gap=12, ph=h-scopeH-6, lw=Math.round((w-gap)*0.6), rw=w-gap-lw;
  if(!st){ g.fillStyle='#a3957d'; g.font='13px "Noto Serif TC"'; g.fillText('開啟留聲機後顯示',14,30); return; }
  const isRec=st.mode==='record'&&st.hg>0.01, isPlay=st.reading&&st.hg>0.01;
  const ref=isRec?-st.c:isPlay?st.p:(st.prof[90]||0);
  refSm+=(ref-refSm)*0.25;
  if(U.magTab==='repro') drawRepro(g,0,0,w,ph);
  else if(U.magTab==='both'){
    if(ph<300&&w>ph*2.4){ const a=Math.round(w*0.3), b=Math.round(w*0.18);   // 矮而寬（停駐列裡）：三張圖並排，避免擠在一起
      drawLong(g,0,0,a,ph,isRec,isPlay); drawCross(g,a+gap,0,b,ph,isRec,isPlay); drawRepro(g,a+b+2*gap,0,w-a-b-2*gap,ph); }
    else { const h1=Math.round((ph-8)*0.5), h2=ph-8-h1;
      drawLong(g,0,0,lw,h1,isRec,isPlay); drawCross(g,lw+gap,0,rw,h1,isRec,isPlay); drawRepro(g,0,h1+8,w,h2); } }
  else { drawLong(g,0,0,lw,ph,isRec,isPlay); drawCross(g,lw+gap,0,rw,ph,isRec,isPlay); }
  drawScope(g,0,ph+6,w,scopeH,isRec);
}
function frameBox(g,x,y,w,h,title){ g.fillStyle='#0d0a08'; g.fillRect(x,y,w,h); g.strokeStyle='rgba(201,164,92,.3)'; g.lineWidth=1; g.strokeRect(x+.5,y+.5,w-1,h-1);
  g.fillStyle='#ecd59c'; g.font='12px "Noto Serif TC",serif'; g.fillText(title,x+8,y+16); }
function vScale(h,vy){ return h*0.3-Math.max(0,-refSm*vy-h*0.42); }
function grid(g,x0,y0,w,h,Y){ g.save(); g.setLineDash([2,4]); g.font='9px "JetBrains Mono",monospace';
  for(let zz=0;zz>=-300;zz-=10){ const yy=Y(zz); if(yy>y0+h) break; if(yy<y0+20) continue; g.strokeStyle=zz===0?'rgba(236,213,156,.35)':'rgba(201,164,92,.1)'; g.beginPath(); g.moveTo(x0,yy); g.lineTo(x0+w,yy); g.stroke();
    if(zz%20===0){ g.fillStyle='rgba(163,149,125,.7)'; g.fillText((zz===0?'蠟面 ':'')+zz+'µm',x0+w-62,yy-2); } }
  g.restore(); }
function drawLong(g,x0,y0,w,h,isRec,isPlay){
  frameBox(g,x0,y0,w,h,'縱剖面 · 沿溝槽方向');
  g.save(); g.beginPath(); g.rect(x0,y0,w,h); g.clip();
  const W2=90, half=W2*DX, sx=w/(2*half), E=U.exag, vy=sx*E, yz=y0+vScale(h,vy)+18, Y=z=>yz-z*vy;
  const srr=st.sr, off=st.off, prof=st.prof, X=i=>x0+w/2+(i-srr)*DX*sx;
  grid(g,x0,y0,w,h,Y);
  const wc=WAXCSS[U.waxColor];
  g.beginPath(); g.moveTo(X(off-W2),y0+h); for(let j=0;j<prof.length;j++) g.lineTo(X(off-W2+j),Y(prof[j])); g.lineTo(X(off+W2),y0+h); g.closePath();
  const gr=g.createLinearGradient(0,yz-20,0,y0+h); gr.addColorStop(0,wc[0]); gr.addColorStop(1,wc[1]); g.fillStyle=gr; g.fill();
  g.beginPath(); for(let j=0;j<prof.length;j++){ const xx=X(off-W2+j), yy=Y(prof[j]); j?g.lineTo(xx,yy):g.moveTo(xx,yy); } g.strokeStyle='#ecd59c'; g.lineWidth=1.2; g.stroke();
  const cx=x0+w/2;
  if(isRec){
    const yb=Y(-st.c);
    const sg=g.createLinearGradient(cx-6,0,cx+16,0); sg.addColorStop(0,'#f2f2f5'); sg.addColorStop(1,'#7c8088');
    g.beginPath(); g.moveTo(cx-5,y0); g.lineTo(cx-5,yb-4); g.quadraticCurveTo(cx-5,yb,cx,yb); g.lineTo(cx+16,yb-16); g.lineTo(cx+16,y0); g.closePath(); g.fillStyle=sg; g.fill();
    g.strokeStyle='rgba(255,255,255,.6)'; g.lineWidth=1; g.stroke();
    g.strokeStyle=wc[0]; g.lineWidth=2.5; g.beginPath(); g.arc(cx+24,yb-26,10,Math.PI*0.9,Math.PI*2.3); g.stroke();
    g.fillStyle=st.ov?'#ff8a70':'#ecd59c'; g.font='11px "Noto Serif TC"'; g.fillText(`刻刀 · 深 ${st.c.toFixed(1)} µm${st.ov?' · 切穿！':''}`,cx+22,Math.min(y0+h-8,yb+16));
  } else if(isPlay){
    const R=P.tipOn?P.stylusR:3, cyc=Y(st.p+R);
    const bg=g.createRadialGradient(cx-R*sx*0.3,cyc+R*vy*0.6,2,cx,cyc,Math.max(R*sx,R*vy)); bg.addColorStop(0,'rgba(210,220,255,.95)'); bg.addColorStop(1,'rgba(60,72,140,.85)');
    g.beginPath(); g.ellipse(cx,cyc,R*sx,R*vy,0,0,Math.PI*2); g.fillStyle=bg; g.fill(); g.strokeStyle=st.air?'#ff7a60':'#c9d4ff'; g.lineWidth=1.2; g.stroke();
    if(!st.air){ const xc=X(st.ai), j=st.ai-off+W2; if(j>=0&&j<prof.length){ const yc=Y(prof[j]); const hl=g.createRadialGradient(xc,yc,0,xc,yc,9); hl.addColorStop(0,'rgba(255,236,170,1)'); hl.addColorStop(1,'rgba(255,236,170,0)'); g.fillStyle=hl; g.beginPath(); g.arc(xc,yc,9,0,7); g.fill(); } }
    else { g.fillStyle='#ff7a60'; g.font='600 12px "Noto Serif TC"'; g.fillText('唱針離面！',cx+R*sx+6,Y(st.p)+4); }
    g.fillStyle='rgba(201,212,255,.85)'; g.font='10.5px "Noto Serif TC"'; g.fillText(`唱針 ⌀${(R*2).toFixed(0)} µm${E>1?`（垂直放大，球變成橢圓）`:''}`,x0+8,y0+h-8);
  }
  // 比例尺
  g.strokeStyle='#ecd59c'; g.lineWidth=1.5; const bx=x0+w-14-100*sx, by=y0+h-12; g.beginPath(); g.moveTo(bx,by); g.lineTo(bx+100*sx,by); g.moveTo(bx,by-3); g.lineTo(bx,by+3); g.moveTo(bx+100*sx,by-3); g.lineTo(bx+100*sx,by+3); g.stroke();
  g.fillStyle='#ecd59c'; g.font='10px "JetBrains Mono"'; g.fillText('100 µm',bx,by-6);
  g.fillStyle='rgba(163,149,125,.85)'; g.font='10px "Noto Serif TC"'; g.fillText('← 已經過　　未到達 →',x0+8,y0+32);
  g.restore();
}
function drawCross(g,x0,y0,w,h,isRec,isPlay){
  frameBox(g,x0,y0,w,h,'橫剖面 · 相鄰五圈');
  g.save(); g.beginPath(); g.rect(x0,y0,w,h); g.clip();
  const PT=P.pitch, span=2.5*PT, sx=w/(2*span), E=U.exag, vy=sx*E, yz=y0+vScale(h,vy)+18, Y=z=>yz-z*vy, X=x=>x0+w/2+x*sx;
  grid(g,x0,y0,w,h,Y);
  const Rc=P.cutterR, D=Array.from(st.cross,z=>Math.max(0,-z)); if(isRec) D[2]=Math.max(D[2],st.c);
  const depthX=x=>{ let m=0; for(let k=-2;k<=2;k++){ const d=D[k+2]; if(d<=0) continue; const dx=x-k*PT, v=d-dx*dx/(2*Rc); if(v>m)m=v; } return m; };
  const wc=WAXCSS[U.waxColor];
  g.beginPath(); g.moveTo(x0,y0+h); for(let px=0;px<=w;px++){ g.lineTo(x0+px,Y(-depthX((px-w/2)/sx))); } g.lineTo(x0+w,y0+h); g.closePath();
  const gr=g.createLinearGradient(0,yz-20,0,y0+h); gr.addColorStop(0,wc[0]); gr.addColorStop(1,wc[1]); g.fillStyle=gr; g.fill();
  g.beginPath(); for(let px=0;px<=w;px++){ const yy=Y(-depthX((px-w/2)/sx)); px?g.lineTo(x0+px,yy):g.moveTo(x0+px,yy); } g.strokeStyle='#ecd59c'; g.lineWidth=1.2; g.stroke();
  for(let k=-2;k<=1;k++){ const xm=(k+0.5)*PT, dm=depthX(xm); if(dm>0&&D[k+2]>0&&D[k+3]>0){ g.fillStyle='#ff7a60'; g.beginPath(); g.arc(X(xm),Y(-dm),4,0,7); g.fill(); g.font='10px "Noto Serif TC"'; g.fillText('切穿',X(xm)-10,Y(-dm)+16); } }
  g.fillStyle='rgba(163,149,125,.85)'; g.font='10px "JetBrains Mono"';
  ['−2','−1','本圈','+1','+2'].forEach((t,i)=>{ g.fillText(t,X((i-2)*PT)-(i===2?10:6),y0+h-8); });
  if(isPlay){ const R=P.tipOn?P.stylusR:3; let zc=-1e9; for(let x=-R;x<=R;x+=R/60){ const v=-depthX(x)+Math.sqrt(Math.max(0,R*R-x*x)); if(v>zc) zc=v; }
    g.beginPath(); g.ellipse(X(0),Y(zc),R*sx,R*vy,0,0,Math.PI*2); g.fillStyle='rgba(120,135,210,.75)'; g.fill(); g.strokeStyle='#c9d4ff'; g.stroke(); }
  if(isRec){ g.beginPath(); g.ellipse(X(0),Y(-st.c+Rc),Rc*sx,Rc*vy,0,0,Math.PI); g.lineTo(X(-Rc),y0); g.lineTo(X(Rc),y0); g.closePath(); g.fillStyle='rgba(220,222,230,.55)'; g.fill(); g.strokeStyle='#fff'; g.stroke(); }
  g.strokeStyle='rgba(236,213,156,.6)'; g.lineWidth=1; const ay=y0+40; g.beginPath(); g.moveTo(X(0),ay); g.lineTo(X(PT),ay); g.stroke(); g.fillStyle='#ecd59c'; g.font='9.5px "JetBrains Mono"'; g.fillText(`${PT} µm`,X(PT*0.5)-18,ay-3);
  g.restore();
}

// ---------------- 唱頭剖面（針 → 槓桿 → 振膜 → 喇叭） ----------------
const RP={ph:0,buf:new Float32Array(1024),src:'',avg:0,last:0,lastT:0,waves:new Float32Array(56),mode:'',dd:0,maxDisp:1};
const LEVER=3; // 槓桿比（示意）
function reproSample(dt,isRec){
  const slow=Math.abs(st.w)<0.4;
  if(slow){ const v=isRec?-st.c:st.p; RP.avg+=(v-RP.avg)*Math.min(1,dt*0.6); RP.mode='即時'; return {d:v-RP.avg,slow:true}; }
  const src=isRec?'in':'out';
  RP.ph+=dt/4;
  let quiet=true; for(let i=0;i<1024;i+=16) if(Math.abs(RP.buf[i])>0.004){ quiet=false; break; }
  if(RP.ph>=1||RP.src!==src||quiet){ RP.ph%=1; if(quiet) RP.ph=0; RP.src=src; const an=isRec?inAn:outAn; if(an) an.getFloatTimeDomainData(RP.buf); }
  RP.mode='慢動作 ×190';
  return {d:0,slow:false};
}
function bufDisp(i,isRec){ const v=RP.buf[Math.max(0,Math.min(1023,i))]; return isRec?-v*P.inGain:-v*18/Math.max(0.05,P.volume); }
function drawRepro(g,x0,y0,w,h){
  const now=performance.now(), dt=Math.min(0.1,(now-(RP.lastT||now))/1000); RP.lastT=now;
  const isRec=st.mode==='record', active=isRec?st.hg>0.01:(st.reading&&st.hg>0.01);
  const lw=Math.round(w*0.64);
  frameBox(g,x0,y0,lw,h,isRec?'錄音頭剖面 · 喇叭 → 振膜 → 槓桿 → 刻刀':'唱頭剖面 · 球針 → 槓桿 → 振膜 → 喇叭');
  g.save(); g.beginPath(); g.rect(x0,y0,lw,h); g.clip();
  const smp=active?reproSample(dt,isRec):{d:0,slow:true};
  const idx=Math.floor(RP.ph*1023);
  let d=smp.slow?smp.d:bufDisp(idx,isRec); if(!active) d=0;           // 針尖位移 µm（向上為正）
  const K=0.32;                                                         // px/µm（圖面約放大 ×90）
  const DSM=26/LEVER, ds=Math.max(-DSM,Math.min(DSM,d*K)), dd=-ds*LEVER;   // 剛性連桿：振膜位移＝針位移×槓桿比
  // 版面
  const cx=x0+lw*0.4, Yh=y0+h*0.44, Rd=Math.min(lw*0.27,108), throatTop=y0+26, throatW=15;
  const brass='#b8914a', brassD='#6e5226', ink='#ecd59c', mut='rgba(163,149,125,.9)';
  // 喉管內的聲壓波
  const vel=(dd-RP.dd)/Math.max(dt,1e-3); RP.dd=dd;
  const n=RP.waves.length;
  if(isRec){ for(let i=0;i<n-1;i++) RP.waves[i]=RP.waves[i+1]; RP.waves[n-1]=active?Math.tanh(-vel/180):0; }
  else { for(let i=n-1;i>0;i--) RP.waves[i]=RP.waves[i-1]; RP.waves[0]=active?Math.tanh(-vel/180):0; }
  const tY0=Yh-26, tLen=tY0-throatTop;
  for(let i=0;i<n;i++){ const v=RP.waves[i], yy=tY0-(i+0.5)*tLen/n;
    g.fillStyle=v>0?`rgba(255,214,140,${Math.min(.85,v*.9)})`:`rgba(40,70,110,${Math.min(.7,-v*.8)})`; g.fillRect(cx-throatW+2,yy-tLen/n/2,throatW*2-4,tLen/n+0.5); }
  g.strokeStyle=brass; g.lineWidth=3; g.beginPath(); g.moveTo(cx-throatW,throatTop); g.lineTo(cx-throatW,tY0); g.moveTo(cx+throatW,throatTop); g.lineTo(cx+throatW,tY0); g.stroke();
  // 上殼與下殼
  const shell=(sgn)=>{ g.beginPath(); g.moveTo(cx-Rd-10,Yh+sgn*2); g.lineTo(cx-Rd-10,Yh+sgn*13);
    if(sgn<0){ g.lineTo(cx-throatW-6,tY0); g.lineTo(cx-throatW,tY0); g.lineTo(cx-throatW,tY0+4); g.lineTo(cx-Rd+6,Yh-5); g.lineTo(cx-Rd+6,Yh-2); }
    else { g.lineTo(cx-Rd*0.35,Yh+16); g.lineTo(cx-Rd*0.35,Yh+10); g.lineTo(cx-Rd+6,Yh+5); g.lineTo(cx-Rd+6,Yh+2); }
    g.closePath(); g.fill(); g.stroke(); };
  g.fillStyle=brassD; g.strokeStyle=brass; g.lineWidth=1.2;
  for(const sx of [1,-1]){ g.save(); g.translate(cx,0); g.scale(sx,1); g.translate(-cx,0); shell(-1); shell(1);
    g.fillStyle='#1a1410'; g.beginPath(); g.ellipse(cx-Rd-1,Yh-3.2,7,2.6,0,0,7); g.fill(); g.beginPath(); g.ellipse(cx-Rd-1,Yh+3.2,7,2.6,0,0,7); g.fill();
    g.fillStyle=brassD; g.restore(); }
  // 振膜
  g.beginPath(); for(let i=0;i<=60;i++){ const u=i/30-1, xx=cx+u*Rd, yy=Yh+dd*Math.pow(1-u*u,2); i?g.lineTo(xx,yy):g.moveTo(xx,yy); }
  g.strokeStyle='rgba(205,225,240,.95)'; g.lineWidth=2.6; g.stroke();
  // 槓桿系統
  const yL=Yh+52, a=Rd*0.95, b=a/LEVER, Px=cx+a, Sx=Px-b;
  const yLink=yL+dd, yS=yL-ds;   // 連桿端與針端都在同一根槓桿上
  g.strokeStyle='#d9d6cf'; g.lineWidth=1.6; g.beginPath(); g.moveTo(cx,Yh+dd); g.lineTo(cx,yLink); g.stroke();       // 連桿
  g.fillStyle='#d9d6cf'; g.beginPath(); g.arc(cx,Yh+dd,2.5,0,7); g.fill();
  g.strokeStyle='#cfcac0'; g.lineWidth=4; g.lineCap='round'; g.beginPath(); g.moveTo(cx-6,yLink-(6/a)*(yL-yLink)); g.lineTo(Px,yL); g.stroke(); g.lineCap='butt'; // 槓桿
  // 浮動配重與支點
  const wg=g.createLinearGradient(0,yL-22,0,yL+22); wg.addColorStop(0,'#2a2420'); wg.addColorStop(1,'#120e0b');
  g.fillStyle=wg; g.fillRect(Px-4,yL-22,Math.min(70,x0+lw-Px-8),44); g.strokeStyle='rgba(201,164,92,.4)'; g.strokeRect(Px-4,yL-22,Math.min(70,x0+lw-Px-8),44);
  g.fillStyle=ink; g.beginPath(); g.arc(Px,yL,4,0,7); g.fill();
  // 針（或刻刀）與刻痕
  const tipY=yS+30, gy=tipY+(isRec?2:7);
  g.strokeStyle='#cfcac0'; g.lineWidth=2.2; g.beginPath(); g.moveTo(Sx,yS); g.lineTo(Sx,tipY); g.stroke();
  // 刻痕：時間軸＝空間軸（每個樣本約 9.7 µm）
  const span=Math.min(150,(x0+lw-12)-Sx, Sx-(x0+12)), base=gy+(isRec?0:7);
  g.beginPath(); g.moveTo(Sx-span,y0+h);
  for(let j=-span;j<=span;j+=2){ let v=0;
    if(active){ if(smp.slow){ const k=Math.round(j/2)+90; v=(st.prof[Math.max(0,Math.min(180,k))]||0)-RP.avg; } else v=bufDisp(idx+Math.round(j/2),isRec); }
    g.lineTo(Sx+j,base-Math.max(-16,Math.min(16,v*K))); }
  g.lineTo(Sx+span,y0+h); g.closePath();
  const wc=WAXCSS[U.waxColor]; const gr=g.createLinearGradient(0,base-16,0,y0+h); gr.addColorStop(0,wc[0]); gr.addColorStop(1,wc[1]); g.fillStyle=gr; g.fill();
  if(isRec){ g.fillStyle='#e6e6ec'; g.beginPath(); g.moveTo(Sx-4,tipY-8); g.lineTo(Sx+4,tipY-8); g.lineTo(Sx+1.5,base-ds+1); g.lineTo(Sx-1.5,base-ds+1); g.closePath(); g.fill(); }
  else { g.fillStyle='#8fa0ff'; g.beginPath(); g.arc(Sx,base-ds-6,6,0,7); g.fill(); g.strokeStyle='#d6dcff'; g.lineWidth=1; g.stroke(); }
  // 標註
  g.font='10.5px "Noto Serif TC"'; g.lineWidth=0.8;
  const tag=(t,xa,ya,xb,yb)=>{ g.strokeStyle='rgba(201,164,92,.5)'; g.beginPath(); g.moveTo(xa,ya); g.lineTo(xb,yb); g.stroke(); g.fillStyle=mut; g.fillText(t,xb+(xb<xa?-g.measureText(t).width-3:3),yb+3.5); };
  tag(isRec?'喇叭喉管（聲波進入）':'喇叭喉管（聲波向上）',cx+throatW,throatTop+18,cx+throatW+26,throatTop+12);
  tag('振膜（雲母）',cx+Rd*0.55,Yh+dd*0.3,cx+Rd*0.75,Yh-28);
  tag('橡膠墊圈',cx-Rd-4,Yh+6,cx-Rd-2,Yh+38);
  tag('連桿',cx,(Yh+yLink)/2+4,cx+14,(Yh+yLink)/2+4);
  tag(`槓桿 ${LEVER}:1`,cx+a*0.3,yL+dd*0.7,cx+a*0.22,yL+24);
  tag('支點（浮動配重）',Px,yL-4,Px+8,yL-30);
  tag(isRec?'刻刀':'藍寶石球針',Sx+5,base-ds-6,Sx+16,base-ds-6);
  g.fillStyle='rgba(163,149,125,.75)'; g.fillText(`位移放大約 ×90 · ${active?RP.mode:'未接觸'}`,x0+8,y0+h-8);
  g.restore();
  // 右側：能量流
  const rx=x0+lw+12, rw2=w-lw-12;
  frameBox(g,rx,y0,rw2,h,'能量的路徑');
  const rows=isRec
    ?[['① 空氣聲壓',RP.waves[n-1]*1.0,''],['② 振膜位移',-dd/26,`${(d*LEVER).toFixed(1)} µm`],['③ 刻刀位移',-ds/DSM,`${d.toFixed(1)} µm`],['④ 蠟面刻深',-ds/DSM,`${(st.c||0).toFixed(1)} µm`]]
    :[['① 刻痕起伏',ds/DSM,`${d.toFixed(1)} µm`],['② 球針被推動',ds/DSM,`${d.toFixed(1)} µm`],['③ 振膜（經槓桿）',-dd/26,`${(d*LEVER).toFixed(1)} µm`],['④ 喉管聲壓',RP.waves[0],'']];
  const rh=(h-40)/rows.length;
  rows.forEach(([t,v,val],i)=>{ const yy=y0+30+i*rh;
    g.fillStyle=ink; g.font='12px "Noto Serif TC"'; g.fillText(t,rx+10,yy+12);
    g.fillStyle=mut; g.font='10px "JetBrains Mono"'; g.fillText(active?val:'',rx+rw2-10-g.measureText(val).width,yy+12);
    const bx=rx+10, bw=rw2-20, by=yy+18, cxm=bx+bw/2; g.fillStyle='#1b1510'; g.fillRect(bx,by,bw,7);
    const vv=Math.max(-1,Math.min(1,active?v:0)); g.fillStyle=vv>=0?'#d8b46a':'#6f8fc0'; g.fillRect(Math.min(cxm,cxm+vv*bw/2),by,Math.abs(vv*bw/2),7);
    g.fillStyle='rgba(236,213,156,.5)'; g.fillRect(cxm-0.5,by-2,1,11);
    if(i<rows.length-1){ g.fillStyle='rgba(201,164,92,.5)'; g.fillText('↓',rx+rw2/2-4,yy+rh-2); } });
}
const scopeBuf=new Float32Array(1024);
function drawScope(g,x0,y0,w,h,isRec){
  g.fillStyle='#0d0a08'; g.fillRect(x0,y0,w,h); g.strokeStyle='rgba(201,164,92,.3)'; g.strokeRect(x0+.5,y0+.5,w-1,h-1);
  const an=isRec?inAn:outAn; if(!an) return; an.getFloatTimeDomainData(scopeBuf);
  g.beginPath(); for(let i=0;i<scopeBuf.length;i++){ const xx=x0+i/(scopeBuf.length-1)*w, yy=y0+h/2-scopeBuf[i]*h*0.45; i?g.lineTo(xx,yy):g.moveTo(xx,yy); }
  g.strokeStyle=isRec?'#e0907a':'#ecd59c'; g.lineWidth=1; g.stroke();
  g.fillStyle='rgba(163,149,125,.8)'; g.font='10px "Noto Serif TC"'; g.fillText(isRec?'輸入波形':'輸出波形',x0+6,y0+12);
}

// ---------------- 檔案 ----------------
function download(blob,name){ return platform.saveFile(blob,name); }   // 網頁版是下載，桌面版會開存檔對話框
function stamp(){ const d=new Date(), p=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; }
function requestSnapshot(){ return new Promise(r=>{ snapResolve=r; node.port.postMessage({type:'snapshot'}); }); }

async function loadCylinder(file){
  let buf=await file.arrayBuffer(); const u8=new Uint8Array(buf);
  if(u8[0]===0x1f&&u8[1]===0x8b) buf=await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  const dv=new DataView(buf), hl=dv.getUint32(0,true), head=JSON.parse(new TextDecoder().decode(new Uint8Array(buf,4,hl)));
  if(head.magic!=='WAXCYL'||head.N!==N) throw new Error('不是有效的蠟筒檔');
  const L=head.T*N; let off=4+hl;
  const zi=new Int16Array(buf.slice(off,off+L*2)); off+=L*2; const wi=new Int16Array(buf.slice(off,off+L*2));
  const z=new Float32Array(L), w=new Float32Array(L); let last=0;
  for(let i=0;i<L;i++){ z[i]=zi[i]/200; w[i]=wi[i]/200; if(zi[i]) last=i; }
  if(head.waxColor&&WAXSPEC[head.waxColor]) U.waxColor=head.waxColor;
  await addCylinder(head.T,{z,w}); recMax=last;
  if(head.seed){ P.seed=head.seed; } if(head.scratchCount){ P.scratchCount=head.scratchCount; }
  genDefects(); sendParams(['scratches','crackA0','crackSlope']); updateDefectUniforms();
  applyWax(U.waxColor,false);
  updateCylInfo(); toast('蠟筒已裝上');
}
function encodeWav(buf){
  const ch=buf.numberOfChannels, len=buf.length, sr=buf.sampleRate, dv=new DataView(new ArrayBuffer(44+len*ch*2));
  const ws=(o,s)=>{ for(let i=0;i<s.length;i++) dv.setUint8(o+i,s.charCodeAt(i)); };
  ws(0,'RIFF'); dv.setUint32(4,36+len*ch*2,true); ws(8,'WAVE'); ws(12,'fmt '); dv.setUint32(16,16,true); dv.setUint16(20,1,true); dv.setUint16(22,ch,true);
  dv.setUint32(24,sr,true); dv.setUint32(28,sr*ch*2,true); dv.setUint16(32,ch*2,true); dv.setUint16(34,16,true); ws(36,'data'); dv.setUint32(40,len*ch*2,true);
  const data=[]; for(let c=0;c<ch;c++) data.push(buf.getChannelData(c));
  let o=44; for(let i=0;i<len;i++) for(let c=0;c<ch;c++){ const v=Math.max(-1,Math.min(1,data[c][i])); dv.setInt16(o,v<0?v*32768:v*32767,true); o+=2; }
  return new Blob([dv],{type:'audio/wav'});
}
async function renderRange(z,wear,cT,startS,endS,rpm,sr,tail,over){
  const secs=(endS-startS)/N/(rpm/60)+(tail?0.3:0);
  const octx=new OfflineAudioContext(2,Math.max(1,Math.ceil(secs*sr)),sr);
  await octx.audioWorklet.addModule(workletURL);
  const params={}; for(const k of WK) params[k]=P[k]; params.drive='motor'; params.rpm=rpm; if(over) Object.assign(params,over);
  const n=new AudioWorkletNode(octx,'phono',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],processorOptions:{offline:true,T:cT,z,wear,params,startS,endS}});
  n.connect(octx.destination); return await octx.startRendering();
}




// ---------------- 音檔控制台 ----------------
const FC={in:0,out:0,gain:0,env:null,peak:0,drag:null,recT0:null,recOff:0,recDur:0,recGain:null,recSrc:null,prev:null,prevT0:0,prevDur:0,anchor:null};
// 蠟筒位置 s（格）對應到音檔的哪一秒；超出這段錄音範圍就回傳 null（下次從起點開始）
function fileCueAt(sPos){ if(!FC.anchor||!fileBuffer) return null; const t=FC.anchor.t+(sPos-FC.anchor.s)/N/(Math.max(1,P.rRpm)/60);
  return (t<FC.in-0.005||t>=FC.out-0.02)?null:Math.max(FC.in,t); }
function fmtT(t){ t=Math.round(t*100)/100; const m=Math.floor(t/60), s2=t-m*60; return `${String(m).padStart(2,'0')}:${s2.toFixed(2).padStart(5,'0')}`; }
function buildEnvelope(){ const B=1200, n=fileBuffer.length, ch=fileBuffer.numberOfChannels, mn=new Float32Array(B), mx=new Float32Array(B), data=[];
  for(let c=0;c<ch;c++) data.push(fileBuffer.getChannelData(c));
  let peak=0;
  for(let b2=0;b2<B;b2++){ const a=Math.floor(b2*n/B), e=Math.floor((b2+1)*n/B); let lo=1,hi=-1; const step=Math.max(1,Math.floor((e-a)/400));
    for(let i=a;i<e;i+=step){ let v=0; for(let c=0;c<ch;c++) v+=data[c][i]; v/=ch; if(v<lo) lo=v; if(v>hi) hi=v; }
    mn[b2]=lo; mx[b2]=hi; peak=Math.max(peak,Math.abs(lo),Math.abs(hi)); }
  FC.env={mn,mx}; FC.peak=peak; }
function fileConsoleShow(){
  FC.anchor=null;
  const dur=fileBuffer.duration; FC.in=0; FC.out=dur; buildEnvelope();
  $('fcon').style.display=''; $('fIn').max=dur; $('fOut').max=dur;
  $('fMeta').textContent=`全長 ${fmtT(dur)} · ${(fileBuffer.sampleRate/1000).toFixed(1)} kHz · ${fileBuffer.numberOfChannels===1?'單聲道':'立體聲→單聲道'} · 峰值 ${(20*Math.log10(Math.max(1e-6,FC.peak))).toFixed(1)} dBFS`;
  $('fMeta').title=$('fMeta').textContent;
  syncFileUI(); drawFileWave();
}
function syncFileUI(){
  const dur=fileBuffer?fileBuffer.duration:0;
  FC.in=Math.max(0,Math.min(FC.in,dur)); FC.out=Math.max(FC.in+0.01,Math.min(FC.out,dur));
  if(document.activeElement!==$('fIn')) $('fIn').value=FC.in.toFixed(2);
  if(document.activeElement!==$('fOut')) $('fOut').value=FC.out.toFixed(2);
  const sel=FC.out-FC.in, cylLeft=(T*N-dispS)/N/(NOM/60);
  burnEstimate(sel);
  $('fSel').innerHTML=`選取 ${fmtT(sel)}（${sel.toFixed(2)} 秒）· 目前蠟筒剩餘 ${cylLeft.toFixed(1)} 秒`+(sel>cylLeft+0.05?(U.chainRec?'，超出部分會自動換到下一支蠟筒':'，<span style="color:#ff8a70">超出部分會被截斷</span>'):'');
  $('fGainV').textContent=`${FC.gain>0?'+':''}${FC.gain.toFixed(1)} dB`; $('fGain').value=FC.gain;
}
function filePlayhead(){
  if(FC.recT0!=null&&ctx&&mode==='record'){ const t=ctx.currentTime-FC.recT0; if(t>=0&&t<=FC.recDur+0.05) return {t:FC.recOff+Math.min(t,FC.recDur),kind:'rec'}; }
  if(FC.prev&&ctx){ const t=ctx.currentTime-FC.prevT0; if(t>=0&&t<=FC.prevDur) return {t:FC.in+t,kind:'prev'}; }
  if(mode!=='record'){ const c=fileCueAt(dispS); if(c!=null) return {t:c,kind:'cue'}; }
  return null;
}
function drawFileWave(){
  const cv=$('fileWave'); if(!cv||!fileBuffer||!FC.env||cv.offsetParent===null) return;
  const dpr=Math.min(2,devicePixelRatio||1), w=cv.clientWidth, h=cv.clientHeight;
  if(cv.width!==Math.round(w*dpr)||cv.height!==Math.round(h*dpr)){ cv.width=Math.round(w*dpr); cv.height=Math.round(h*dpr); }
  const g=cv.getContext('2d'); g.setTransform(dpr,0,0,dpr,0,0); g.clearRect(0,0,w,h);
  const dur=fileBuffer.duration, X=t=>t/dur*w, mid=h/2, gl=Math.pow(10,FC.gain/20), sc=(h/2-4)*gl;   // 以滿刻度 ±1 為上下緣
  g.fillStyle='#0d0a08'; g.fillRect(0,0,w,h);
  g.fillStyle='rgba(201,164,92,.10)'; g.fillRect(X(FC.in),0,X(FC.out)-X(FC.in),h);
  const B=FC.env.mn.length;
  for(let px=0;px<w;px++){ const b0=Math.floor(px/w*B), b1=Math.max(b0+1,Math.floor((px+1)/w*B)); let lo=1,hi=-1;
    for(let b2=b0;b2<b1;b2++){ if(FC.env.mn[b2]<lo) lo=FC.env.mn[b2]; if(FC.env.mx[b2]>hi) hi=FC.env.mx[b2]; }
    const t=(px+0.5)/w*dur, inSel=t>=FC.in&&t<=FC.out, y1=mid-Math.min(h/2,hi*sc), y2=mid-Math.max(-h/2,lo*sc);
    g.fillStyle=inSel?'#d8b46a':'rgba(163,149,125,.35)'; g.fillRect(px,y1,1,Math.max(1,y2-y1)); }
  if(FC.peak*gl>1){ g.fillStyle='rgba(255,90,60,.6)'; g.fillRect(0,0,w,2); g.fillRect(0,h-2,w,2); }
  g.strokeStyle='rgba(236,213,156,.25)'; g.beginPath(); g.moveTo(0,mid); g.lineTo(w,mid); g.stroke();
  for(const [t,lab] of [[FC.in,'起'],[FC.out,'訖']]){ const x=Math.round(X(t))+0.5; g.strokeStyle='#ecd59c'; g.lineWidth=1.5; g.beginPath(); g.moveTo(x,0); g.lineTo(x,h); g.stroke();
    g.fillStyle='#ecd59c'; g.fillRect(x-(lab==='起'?0:14),0,14,13); g.fillStyle='#1a120a'; g.font='600 10px "Noto Serif TC"'; g.fillText(lab,x-(lab==='起'?-2:12),10); }
  const ph=filePlayhead();
  if(ph){ const x=X(ph.t); g.strokeStyle=ph.kind==='rec'?'#ff6a50':ph.kind==='cue'?'#e8b45a':'#9fc0ff'; g.lineWidth=2; if(ph.kind==='cue') g.setLineDash([4,3]);
    g.beginPath(); g.moveTo(x,0); g.lineTo(x,h); g.stroke(); g.setLineDash([]); }
  $('fPos').textContent=ph?`${fmtT(ph.t)} ${ph.kind==='rec'?'● 刻錄中':ph.kind==='cue'?'⏸ 對應蠟筒位置，按 ● 從這裡接續':'▶ 試聽'}`:`${fmtT(FC.in)} 從起點開始`;
  $('fCyl').textContent=`${fmtT(dispS/N/(NOM/60))}（第 ${Math.floor(dispS/N)} 圈）`;
}
function setupFileConsole(){
  const cv=$('fileWave'); if(!cv) return;
  const tAt=e=>{ const r=cv.getBoundingClientRect(); return Math.max(0,Math.min(1,(e.clientX-r.left)/r.width))*fileBuffer.duration; };
  cv.addEventListener('pointerdown',e=>{ if(!fileBuffer) return; cv.setPointerCapture(e.pointerId); const t=tAt(e), r=cv.getBoundingClientRect(), pxPerS=r.width/fileBuffer.duration;
    if(!FC.drag&&mode!=='record') FC.anchor=null;
    if(Math.abs(t-FC.in)*pxPerS<8) FC.drag='in'; else if(Math.abs(t-FC.out)*pxPerS<8) FC.drag='out';
    else { FC.drag='in'; FC.in=t; if(FC.out<=t) FC.out=fileBuffer.duration; }
    syncFileUI(); drawFileWave(); });
  cv.addEventListener('pointermove',e=>{ if(!FC.drag||!fileBuffer) return; const t=tAt(e); if(FC.drag==='in') FC.in=Math.min(t,FC.out-0.01); else FC.out=Math.max(t,FC.in+0.01); syncFileUI(); drawFileWave(); });
  const up=()=>{ FC.drag=null; }; cv.addEventListener('pointerup',up); cv.addEventListener('pointercancel',up);
  $('fIn').addEventListener('change',e=>{ FC.in=+e.target.value||0; FC.anchor=null; syncFileUI(); drawFileWave(); });
  $('fOut').addEventListener('change',e=>{ FC.out=+e.target.value||0; syncFileUI(); drawFileWave(); });
  $('fAll').onclick=()=>{ FC.anchor=null; FC.in=0; FC.out=fileBuffer?fileBuffer.duration:0; syncFileUI(); drawFileWave(); };
  $('fGain').addEventListener('input',e=>{ FC.gain=+e.target.value; if(FC.recGain&&ctx) FC.recGain.gain.setTargetAtTime(Math.pow(10,FC.gain/20),ctx.currentTime,0.02); syncFileUI(); drawFileWave(); });
  $('fNorm').onclick=()=>{ if(!FC.peak) return; FC.gain=Math.round(20*Math.log10(0.9/FC.peak)*2)/2; FC.gain=Math.max(-24,Math.min(12,FC.gain)); syncFileUI(); drawFileWave(); toast(`增益設為 ${FC.gain.toFixed(1)} dB（峰值約 −1 dBFS）`); };
  $('fCylHome').onclick=()=>{ seekTo(0); syncFileUI(); };
  $('fBurn').onclick=()=>quickBurn();
  $('fRestart').onclick=()=>{ FC.anchor=null; drawFileWave(); toast('下次刻錄會從音檔起點、唱頭目前的位置開始'); };
  $('fPrev').onclick=()=>{
    if(!ctx||!fileBuffer){ toast('請先開啟留聲機並選擇音檔'); return; }
    if(FC.prev){ try{FC.prev.stop();}catch(e){} FC.prev=null; $('fPrev').textContent='▶ 試聽選取段'; return; }
    const b=ctx.createBufferSource(), g=ctx.createGain(); b.buffer=fileBuffer; g.gain.value=Math.pow(10,FC.gain/20); b.connect(g); g.connect(master);
    FC.prevT0=ctx.currentTime+0.02; FC.prevDur=FC.out-FC.in; b.start(FC.prevT0,FC.in,FC.prevDur); FC.prev=b; $('fPrev').textContent='■ 停止試聽';
    b.onended=()=>{ if(FC.prev===b){ FC.prev=null; $('fPrev').textContent='▶ 試聽選取段'; } }; };
}

// ---------------- 深度圖視窗（可縮放、平移） ----------------
// 全圖用給 3D 的縮圖（每圈 2048 欄、每欄取最深）；放大到範圍夠小時改向音訊執行緒取原始解析度（每圈 18,000 格）。
// 橫軸＝沿軸向的圈數，縱軸＝繞一圈的角度。
let depthDirty=true, depthLast=0;
const DV={x0:0,x1:0,y0:0,y1:1,auto:true,follow:false};           // 目前檢視範圍（圈、圈內比例）
const DR={id:0,pend:false,data:null,key:'',w:0,h:0,t:0};   // 原始解析度區塊
const DEPTH_LUT=(()=>{ const stops=[[0,[22,12,6]],[.18,[74,31,16]],[.42,[160,74,26]],[.7,[232,160,64]],[1,[255,242,200]]], lut=new Uint8ClampedArray(256*3);
  for(let i=0;i<256;i++){ const t=i/255; let k=0; while(k<stops.length-2&&t>stops[k+1][0]) k++; const [t0,c0]=stops[k],[t1,c1]=stops[k+1], f=(t-t0)/(t1-t0);
    for(let j=0;j<3;j++) lut[i*3+j]=c0[j]+(c1[j]-c0[j])*f; } return lut; })();
const depthOff=document.createElement('canvas');
let depthVals=null, depthPW=0, depthPH=0, depthLo=0, depthHi=60, depthSrc='';
function dvReset(){ DV.x0=0; DV.x1=T; DV.y0=0; DV.y1=1; depthDirty=true; }
function dvClamp(){
  const minX=Math.min(T,3), minY=48/N; let w=Math.max(minX,Math.min(T,DV.x1-DV.x0)), h=Math.max(minY,Math.min(1,DV.y1-DV.y0));
  const cx=(DV.x0+DV.x1)/2, cy=(DV.y0+DV.y1)/2; DV.x0=Math.max(0,Math.min(T-w,cx-w/2)); DV.x1=DV.x0+w; DV.y0=Math.max(0,Math.min(1-h,cy-h/2)); DV.y1=DV.y0+h; }
function dvZoom(f,fx=0.5,fy=0.5){ const px=DV.x0+fx*(DV.x1-DV.x0), py=DV.y0+fy*(DV.y1-DV.y0);
  DV.x0=px-(px-DV.x0)/f; DV.x1=px+(DV.x1-px)/f; DV.y0=py-(py-DV.y0)/f; DV.y1=py+(DV.y1-py)/f; dvClamp(); depthDirty=true; }
function regionWanted(pw,ph){ const cells=(DV.x1-DV.x0)*(DV.y1-DV.y0)*N; return node&&cells<=1200000; }
function onRegion(m){ if(m.id!==DR.id) return; DR.pend=false; DR.data=m.data; DR.w=m.w; DR.h=m.h; depthDirty=true; }
function rebuildDepth(pw,ph){
  const vals=depthVals&&depthVals.length===pw*ph?depthVals:new Float32Array(pw*ph);
  const key=`${DV.x0.toFixed(4)},${DV.x1.toFixed(4)},${DV.y0.toFixed(6)},${DV.y1.toFixed(6)},${pw},${ph},${activeId}`;
  if(regionWanted(pw,ph)){
    if(DR.key===key&&DR.data&&DR.w===pw&&DR.h===ph){ vals.set(DR.data); depthSrc='原始解析度'; }
    else { fillFromTex(vals,pw,ph); depthSrc='縮圖（載入中…）'; }
    const now=performance.now(), live=mode!=='idle';
    if(!DR.pend&&(DR.key!==key||(live&&now-DR.t>300))){ DR.pend=true; DR.key=key; DR.t=now; DR.id++;
      node.port.postMessage({type:'region',id:DR.id,k0:DV.x0,k1:DV.x1,a0:DV.y0,a1:DV.y1,w:pw,h:ph}); }
  } else { fillFromTex(vals,pw,ph); depthSrc='縮圖（每圈 2048 欄）'; }
  depthVals=vals; depthPW=pw; depthPH=ph;
  // 色階
  let lo=Infinity, hi=0; for(let i=0;i<vals.length;i++){ const v=vals[i]; if(v>0.05){ if(v<lo) lo=v; if(v>hi) hi=v; } }
  if(!DV.auto||hi===0){ lo=0; hi=60; } else { if(hi-lo<2){ const m=(hi+lo)/2; lo=Math.max(0,m-1); hi=m+1; } }
  depthLo=lo; depthHi=hi;
  depthOff.width=pw; depthOff.height=ph; const g=depthOff.getContext('2d'), id=g.createImageData(pw,ph), d=id.data, span=hi-lo;
  for(let i=0;i<vals.length;i++){ const v=vals[i], o=i*4; let li=0;
    if(v>0.05) li=Math.max(8,Math.min(255,Math.round((DV.auto?Math.max(0,(v-lo)/span):Math.sqrt(Math.min(1,v/60)))*255)));
    d[o]=DEPTH_LUT[li*3]; d[o+1]=DEPTH_LUT[li*3+1]; d[o+2]=DEPTH_LUT[li*3+2]; d[o+3]=255; }
  g.putImageData(id,0,0); depthDirty=false;
}
function fillFromTex(vals,pw,ph){
  for(let px=0;px<pw;px++){ const k=Math.floor(DV.x0+(px+0.5)/pw*(DV.x1-DV.x0)); const base=k*TEXW;
    for(let py=0;py<ph;py++){ const c0=Math.floor((DV.y0+py/ph*(DV.y1-DV.y0))*TEXW), c1=Math.max(c0+1,Math.floor((DV.y0+(py+1)/ph*(DV.y1-DV.y0))*TEXW)); let m=0;
      if(k>=0&&k<T) for(let c=c0;c<c1&&c<TEXW;c++){ const v=texData[base+c]; if(v>m) m=v; }
      vals[py*pw+px]=m/3; } }
}
function drawDepthWin(now){
  if(!U.showDepth) return;
  if(DV.x1===0||DV.x1>T) dvReset();
  if(DV.follow){ const tn=dispS/N, fy=tn-Math.floor(tn), wx=DV.x1-DV.x0, wy=DV.y1-DV.y0, mx=wx*0.06, my=wy*0.04; let moved=false;
    if(tn<DV.x0+mx||tn>DV.x1-mx){ DV.x0=tn-wx*0.3; DV.x1=DV.x0+wx; moved=true; }      // 讓唱頭落在畫面左側 30% 處往右走
    if(wy<0.999&&(fy<DV.y0+my||fy>DV.y1-my)){ DV.y0=fy-wy*0.15; DV.y1=DV.y0+wy; moved=true; }
    if(moved){ dvClamp(); depthDirty=true; } }
  const cv=$('dwCanvas'), dpr=Math.min(2,devicePixelRatio||1), w=cv.clientWidth, h=cv.clientHeight; if(w<40) return;
  const pw=Math.min(1000,Math.round(w*dpr)), ph=Math.min(600,Math.round(h*dpr));
  if((depthDirty||(DR.pend===false&&mode!=='idle'&&regionWanted(pw,ph)))&&now-depthLast>(mode==='record'?250:100)){ depthLast=now; rebuildDepth(pw,ph); }
  if(cv.width!==Math.round(w*dpr)||cv.height!==Math.round(h*dpr)){ cv.width=Math.round(w*dpr); cv.height=Math.round(h*dpr); }
  const g=cv.getContext('2d'); g.setTransform(dpr,0,0,dpr,0,0); g.imageSmoothingEnabled=false; g.clearRect(0,0,w,h);
  if(depthOff.width) g.drawImage(depthOff,0,0,w,h);
  // 唱頭位置
  const turn=dispS/N, fx=(turn-DV.x0)/(DV.x1-DV.x0), fy=((turn-Math.floor(turn))-DV.y0)/(DV.y1-DV.y0);
  const rec=mode==='record'||(st&&st.mode==='record');
  g.strokeStyle=rec?'rgba(255,110,80,.85)':'rgba(160,200,255,.85)'; g.lineWidth=1; g.beginPath();
  if(fx>=0&&fx<=1){ g.moveTo(fx*w,0); g.lineTo(fx*w,h); } if(fy>=0&&fy<=1){ g.moveTo(0,fy*h); g.lineTo(w,fy*h); } g.stroke();
  if(fx>=0&&fx<=1&&fy>=0&&fy<=1){ g.fillStyle=rec?'#ff6a50':'#a0c8ff'; g.beginPath(); g.arc(fx*w,fy*h,3.2,0,7); g.fill(); }
  // 座標標示
  g.fillStyle='rgba(236,213,156,.8)'; g.font='10px "JetBrains Mono"';
  g.fillText(`${(DV.y0*360).toFixed(DV.y1-DV.y0<0.1?2:0)}°`,3,11); g.fillText(`${(DV.y1*360).toFixed(DV.y1-DV.y0<0.1?2:0)}°`,3,h-4);
  const lab=`圈 ${DV.x0.toFixed(1)} – ${DV.x1.toFixed(1)}`; g.fillText(lab,w-g.measureText(lab).width-4,h-4);
  const z=Math.max(T/(DV.x1-DV.x0),1/(DV.y1-DV.y0));
  $('dwZoom').textContent=`×${z<10?z.toFixed(1):Math.round(z)}`;
  $('dwInfo').textContent=`${WAXSPEC[U.waxColor].name} · 原始 ${N.toLocaleString()}×${T} 格`;
  $('dwScale').textContent=`${depthLo.toFixed(1)} → ${depthHi.toFixed(1)} µm`;
  $('dwRange').textContent=depthSrc;
}
(function setupDepthWin(){
  const win=$('depthWin'), head=$('dwHead'), cv=$('dwCanvas'); let drag=null, pan=null;
  head.addEventListener('pointerdown',e=>{ if(e.target.id==='dwClose') return; const r=win.getBoundingClientRect(); drag={dx:e.clientX-r.left,dy:e.clientY-r.top}; head.setPointerCapture(e.pointerId); });
  head.addEventListener('pointermove',e=>{ if(!drag) return; const x=Math.max(0,Math.min(innerWidth-80,e.clientX-drag.dx)), y=Math.max(0,Math.min(innerHeight-40,e.clientY-drag.dy));
    win.style.left=x+'px'; win.style.top=y+'px'; win.style.right='auto'; });
  head.addEventListener('pointerup',()=>{ drag=null; });
  $('dwClose').onclick=()=>{ U.showDepth=false; win.classList.add('hide'); const c=document.querySelector('input[data-ck="showDepth"]'); if(c) c.checked=false; };
  const rel=e=>{ const r=cv.getBoundingClientRect(); return [(e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height]; };
  cv.addEventListener('wheel',e=>{ e.preventDefault(); const [fx,fy]=rel(e); const unit=e.deltaMode===1?40:1; dvZoom(Math.pow(1.0018,-e.deltaY*unit),fx,fy); },{passive:false});
  cv.addEventListener('pointerdown',e=>{ cv.setPointerCapture(e.pointerId); pan={x:e.clientX,y:e.clientY,x0:DV.x0,x1:DV.x1,y0:DV.y0,y1:DV.y1,moved:false,shift:e.shiftKey}; cv.classList.add('drag'); });
  cv.addEventListener('pointermove',e=>{
    const [fx,fy]=rel(e);
    if(pan){ const r=cv.getBoundingClientRect(), dx=(e.clientX-pan.x)/r.width, dy=(e.clientY-pan.y)/r.height;
      if(Math.abs(e.clientX-pan.x)+Math.abs(e.clientY-pan.y)>3) pan.moved=true;
      if(pan.moved&&DV.follow){ DV.follow=false; $('dwFollow').checked=false; }
      if(pan.moved){ const wx=pan.x1-pan.x0, wy=pan.y1-pan.y0; DV.x0=pan.x0-dx*wx; DV.x1=DV.x0+wx; DV.y0=pan.y0-dy*wy; DV.y1=DV.y0+wy; dvClamp(); depthDirty=true; } }
    const k=Math.floor(DV.x0+fx*(DV.x1-DV.x0)), a=DV.y0+fy*(DV.y1-DV.y0);
    let um=0; if(depthVals&&depthPW){ const px=Math.min(depthPW-1,Math.max(0,Math.floor(fx*depthPW))), py=Math.min(depthPH-1,Math.max(0,Math.floor(fy*depthPH))); um=depthVals[py*depthPW+px]; }
    if(k>=0&&k<T) $('dwHover').textContent=`第 ${k} 圈 · ${(a*360).toFixed(2)}° · 第 ${Math.floor(a*N)} 格 · 深 ${um.toFixed(1)} µm`; });
  const end=e=>{ if(!pan) return; cv.classList.remove('drag');
    if(!pan.moved&&(pan.shift||e.shiftKey)&&node){ const [fx,fy]=rel(e); const k=Math.floor(DV.x0+fx*(DV.x1-DV.x0)), a=DV.y0+fy*(DV.y1-DV.y0);
      seekTo(Math.max(0,Math.min(T*N-1,(k+a)*N))); toast(`唱頭移到第 ${k} 圈`); }
    pan=null; };
  cv.addEventListener('pointerup',end); cv.addEventListener('pointercancel',()=>{ pan=null; cv.classList.remove('drag'); });
  cv.addEventListener('dblclick',()=>dvReset());
  cv.addEventListener('mouseleave',()=>{ $('dwHover').textContent='滾輪縮放 · 拖曳平移 · 雙擊重置 · Shift＋點擊移動唱頭'; });
  $('dwIn').onclick=()=>dvZoom(1.6); $('dwOut').onclick=()=>dvZoom(1/1.6); $('dwReset').onclick=()=>dvReset();
  $('dwAuto').onchange=e=>{ DV.auto=e.target.checked; depthDirty=true; };
  $('dwFollow').onchange=e=>{ DV.follow=e.target.checked; depthDirty=true; };
  // 右下角拖曳調整大小
  const grip=$('dwGrip'); let rs=null;
  grip.addEventListener('pointerdown',e=>{ e.preventDefault(); e.stopPropagation(); grip.setPointerCapture(e.pointerId);
    const r=win.getBoundingClientRect(); rs={x:e.clientX,y:e.clientY,w:r.width,ch:cv.clientHeight,left:r.left,top:r.top};
    win.style.left=r.left+'px'; win.style.top=r.top+'px'; win.style.right='auto'; });
  grip.addEventListener('pointermove',e=>{ if(!rs) return;
    const w=Math.max(300,Math.min(innerWidth-rs.left-8,rs.w+e.clientX-rs.x)), ch=Math.max(120,Math.min(innerHeight-rs.top-110,rs.ch+e.clientY-rs.y));
    win.style.width=w+'px'; cv.style.height=ch+'px'; depthDirty=true; });
  grip.addEventListener('pointerup',()=>{ rs=null; });
})();

// ---------------- 快速刻錄：把音檔直接變成刻好的蠟筒 ----------------
function burnPlan(sel){ const rpm=Math.max(20,P.rRpm), cap=capFor(U.waxColor), per=cap/(rpm/60); return {rpm,cap,per,n:Math.max(1,Math.ceil((sel+0.3)/per))}; }
function burnEstimate(sel){ const el=$('fBurnInfo'); if(!el) return; const b=burnPlan(sel);
  el.textContent=`以 ${b.rpm} rpm 刻在${WAXSPEC[U.waxColor].name}上，每支約 ${fmtT(b.per).slice(0,5)}，共需 ${b.n} 支。不用等待真實時間，刻刀物理與錄音時相同。`; }
// 把一段音訊離線刻成蠟筒（不碰介面與蠟筒架）。回傳 {rpm, cyls:[{T,z,used}]}（依序）。
// waxPreset：用該蠟材的建議刻錄參數（批次轉檔用）；否則沿用目前面板上的錄音設定（快速刻錄用）
async function burnBuffer(buffer,{start=0,dur=buffer.duration-start,gainDb=0,wax=U.waxColor,rpm=Math.max(20,P.rRpm),waxPreset=false,onProgress}={}){
  const w=WAXSPEC[wax]||WAXSPEC.brown, cap=capFor(wax);
  const sr=48000, lead=N*0.04, recFrames=Math.round((dur+0.05)*sr), total=recFrames+sr*0.05;
  const octx=new OfflineAudioContext(1,Math.ceil(total),sr);
  await octx.audioWorklet.addModule(workletURL);
  const params={}; for(const k of WK) params[k]=P[k]; Object.assign(params,{rDrive:'motor',rRpm:rpm,monitor:false,overdub:'carve'});
  if(waxPreset) Object.assign(params,{waxWear:w.wear,waxGrain:w.grain,waxCutLP:w.cutLP,pitch:w.pitch},w.rec);
  const wn=new AudioWorkletNode(octx,'phono',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],channelCount:1,channelCountMode:'explicit',channelInterpretation:'speakers',
    processorOptions:{offline:true,offRec:true,T:cap,params,recFrames,startS:lead}});
  const got=[]; let finish; const done=new Promise(r=>finish=r);
  wn.port.onmessage=e=>{ const m=e.data; if(m.type!=='offCyl') return; got.push(m); if(m.final) finish(); };
  const src=octx.createBufferSource(), g=octx.createGain(); src.buffer=buffer; g.gain.value=Math.pow(10,gainDb/20);
  src.connect(g); g.connect(wn); wn.connect(octx.destination); src.start(0,start,dur);
  if(onProgress) for(let t=2;t<dur;t+=2){ octx.suspend(t).then(()=>{ onProgress(t/dur,got.length); octx.resume(); }).catch(()=>{}); }
  await octx.startRendering();
  await Promise.race([done,new Promise(r=>setTimeout(r,3000))]);
  return {rpm,cyls:got.filter(m=>m.used>0).sort((a,b)=>a.idx-b.idx).map(m=>({T:m.T,z:m.z,used:m.used}))};
}
// 讓整段音訊峰值落在 −1 dBFS 所需的增益（dB）
function normalizeGain(buffer){ let pk=1e-6; for(let c=0;c<buffer.numberOfChannels;c++){ const d=buffer.getChannelData(c); for(let i=0;i<d.length;i++){ const a=d[i]<0?-d[i]:d[i]; if(a>pk) pk=a; } }
  return Math.max(-24,Math.min(24,-1-20*Math.log10(pk))); }
async function quickBurn(){
  if(!fileBuffer){ toast('請先選擇音檔'); return; }
  if(!node){ toast('請先開啟留聲機'); return; }
  const sel=FC.out-FC.in, plan=burnPlan(sel);
  if(rack.length+plan.n>24){ toast(`需要 ${plan.n} 支蠟筒，超過蠟筒架上限 24 支`); return; }
  doStop(); await storeActive();
  const btn=$('fBurn'); btn.disabled=true; const label=btn.textContent;
  try{
    const res=await burnBuffer(fileBuffer,{start:FC.in,dur:sel,gainDb:FC.gain,rpm:plan.rpm,onProgress:(f,n)=>{ btn.textContent=n?`刻錄中… 已完成 ${n} 支・${Math.round(f*100)}%`:`刻錄中… ${Math.round(f*100)}%`; }});
    const list=res.cyls;
    if(!list.length){ toast('沒有刻到任何內容（音檔是否太小聲？）'); return; }
    // 放上蠟筒架：接在目前這支後面；若目前這支是空白的就直接用掉
    let at=rackIndex(activeId); const act=rack[at]; const replaceActive=act&&act.used===0;
    const gid=++groupSeq; const made=list.map(m=>{ const e=newEntry(m.T,gid); e.wax=U.waxColor; quantize(m.z,null,e); e.rec={acc:plan.rpm,n:1,set:captureRecSet()}; return e; });
    if(fileTitle){   // 預設群組名＝音檔名稱（重複時加編號），之後仍可點名稱改名
      const taken=new Set(groupsInOrder().map(groupName)); let nm=fileTitle; for(let i=2;taken.has(nm);i++) nm=`${fileTitle} (${i})`;
      groupMeta[gid]={name:nm}; shelfSig=''; }
    if(replaceActive){ rack.splice(at,1,...made); activeId=-1; } else { if(act) for(let i=0;i<rack.length;i++) if(rack[i].group===act.group) at=i; rack.splice(at+1,0,...made); }
    await mountFresh(made[0]); renderRack();
    toast(`已把 ${sel.toFixed(1)} 秒刻成 ${made.length} 支蠟筒，按 ▶ 播放`);
  } catch(err){ toast('快速刻錄失敗：'+err.message); }
  finally{ btn.disabled=false; btn.textContent=label; }
}
// ---------------- 蠟材 ----------------
const WAXSPEC={
  brown:{name:'棕蠟',era:'約 1888–1901 · 金屬皂蠟（軟質）',wear:4,grain:0.6,cutLP:8000,pitch:254,
    rec:{cutterR:160,baseDepth:22,inGain:20,stylusR:150},
    text:'最早的家用錄音蠟筒。蠟質軟，刻刀切得乾淨、高頻保留最好，也能刨平後重錄；代價是很不耐磨，播放幾次高頻就明顯變糊，底噪也最大，容易發霉。'},
  black:{name:'黑蠟',era:'1902 起 · Gold Moulded 硬質模壓',wear:0.6,grain:0.15,cutLP:3000,pitch:254,
    rec:{cutterR:160,baseDepth:22,inGain:20,stylusR:150},
    text:'為了量產而改用硬蠟，用模具一次壓出大量複本。安靜、耐磨，聲音比棕蠟響亮穩定；但硬蠟較難被刻刀切出細小起伏，自行刻錄時高頻會被削弱，也比較脆，溫度變化下容易龜裂。'},
  amber:{name:'琥珀蠟',era:'1908 起 · Amberol 4 分鐘蠟筒',wear:1.0,grain:0.2,cutLP:4000,pitch:127,
    rec:{cutterR:80,baseDepth:12,inGain:11,stylusR:90},
    text:'為了加長錄音時間，把圈距減半到每吋 200 圈（127 µm），同樣長度能錄 4 分鐘。溝槽更窄更淺，必須搭配更細的刻刀與唱針；因為相鄰溝槽靠得很近，刻太大聲更容易切穿溝壁、出現前後回音。'},
};
function waxStats(k){ const w=WAXSPEC[k];
  const row=(lab,v,txt)=>`<div class="stat"><span>${lab}</span><b><i style="width:${Math.round(Math.max(0.04,Math.min(1,v))*100)}%"></i></b><span>${txt}</span></div>`;
  return row('耐磨',1/(w.wear*1.3),`磨損×${w.wear}`)+row('安靜',1-w.grain/0.7,`±${w.grain} µm`)+row('刻錄高頻',w.cutLP/8500,`${(w.cutLP/1000).toFixed(1)} kHz`)+row('圈距',254/w.pitch/2,`${w.pitch} µm`); }
function renderWaxInfo(){ const el=$('waxInfo'); if(!el) return; const w=WAXSPEC[U.waxColor];
  el.innerHTML=`<div class="era">${w.era}</div>${waxStats(U.waxColor)}<p>${w.text}</p><p style="color:var(--muted);font-size:11px">切換蠟材時，刻刀半徑、基準刻深、刻刀振幅與唱針半徑會自動換成該蠟筒適用的值，之後仍可自行調整。</p>`; }
function applyWax(k,setRec){
  const w=WAXSPEC[k]||WAXSPEC.brown; U.waxColor=k;
  P.waxWear=w.wear; P.waxGrain=w.grain; P.waxCutLP=w.cutLP; P.pitch=w.pitch; sendParams(['waxWear','waxGrain','waxCutLP','pitch']);
  waxU.uPitch.value=w.pitch; setWaxColor();
  const sel=$('sel_waxColor'); if(sel) sel.value=k;
  if(setRec){ const was=applyingRec; applyingRec=true; try{ for(const [kk,v] of Object.entries(w.rec)) setRange(kk,v); } finally{ applyingRec=was; } }
  const e=rackEntry(activeId); if(e) e.wax=k;
  renderWaxInfo(); renderRack(); updateCylInfo();
}

// ---------------- 每支蠟筒的錄音設定紀錄 ----------------
const REC_KEYS=['stylusR','tipOn','volume','cutterR','baseDepth','inGain'];
function newRecInfo(){ return {acc:0,n:0,set:captureRecSet()}; }
function captureRecSet(){ const o={}; for(const k of REC_KEYS) o[k]=P[k]; o.drive=P.rDrive; o.targetRpm=P.rRpm; return o; }
function recRpm(e){ const r=e&&e.rec; if(!r) return null; if(r.n>0) return r.acc/r.n; return r.set&&r.set.targetRpm||null; }
function setToggle(k,v){ const c=document.querySelector(`.sw input[data-k="${k}"],.sw input[data-ck="${k}"]`); if(c&&c.checked!==!!v){ c.checked=!!v; c.dispatchEvent(new Event('change')); } }
// 目前模式實際使用的驅動設定：錄音中用 r 開頭那組，其餘用播放那組（與 worklet 相同）
const DUAL={drive:'rDrive',rpm:'rRpm',ratio:'rRatio',crankGov:'rCrankGov'};
function pm(k){ return mode==='record'?P[DUAL[k]]:P[k]; }
const OV_KEYS=new Set(['rpm','stylusR','tipOn','volume']);   // 播放相關、會沿用使用者調整的設定
let applyingRec=false;
function groupLabel(g){ const gs=[...new Set(rack.map(e=>e.group))]; return gs.indexOf(g)+1; }
function groupSize(g){ return rack.filter(e=>e.group===g).length; }
function applyRecSettings(e,quiet){
  applyingRec=true; try{ applyRecSettingsInner(e,quiet); } finally{ applyingRec=false; }
}
function applyRecSettingsInner(e,quiet){
  if(!U.applyRec||!e) return;
  const ov=groupOv[e.group]||{}, msg=[];
  if(e.rec){
  const rpm=ov.rpm!=null?null:recRpm(e), st2=e.rec.set||{};
  if(rpm){ const v=Math.max(1,Math.min(240,Math.round(rpm))); if(v!==P.rpm){ setRange('rpm',v); msg.push(`轉速 ${v} rpm`); } }
  for(const k of ['stylusR','volume','cutterR','baseDepth','inGain']) if(st2[k]!=null&&st2[k]!==P[k]){ setRange(k,st2[k]); if(k==='stylusR') msg.push(`唱針 ${st2[k]} µm`); }
  if(st2.tipOn!=null&&ov.tipOn==null) setToggle('tipOn',st2.tipOn);
  }
  // 這組蠟筒先前被使用者調整過的值優先
  const used=[];
  for(const [k,v] of Object.entries(ov)){ if(k==='tipOn'){ setToggle('tipOn',v); continue; } if(P[k]!==v){ setRange(k,v); } used.push(k==='rpm'?`轉速 ${v} rpm`:k==='stylusR'?`唱針 ${v} µm`:k==='volume'?`振膜增益 ${v}`:''); }
  if(!quiet){ const t=used.length?`沿用你對這組的調整：${used.filter(Boolean).join('、')}`:(msg.length?`依這支蠟筒的錄音紀錄：${msg.join('、')}`:''); if(t) setTimeout(()=>toast(t),400); }
}
function clearGroupOverride(){ const e=rackEntry(activeId); if(!e) return; delete groupOv[e.group]; applyRecSettings(e,true); renderRack(); toast('這組已改回各支蠟筒的錄音設定'); }
// ---------------- 蠟筒架 ----------------
// ---------------- 整架存檔（.waxrack） ----------------
async function readMaybeGz(file){ let buf=await file.arrayBuffer(); const u8=new Uint8Array(buf);
  if(u8[0]===0x1f&&u8[1]===0x8b) buf=await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer(); return buf; }
// ---- 刻痕壓縮：二階線性預測 ＋ 區塊自適應 Rice 編碼（無損整數） ----
const RB=4096;
function riceEncodeInts(src){            // src：Int32Array／Int16Array（量化後的深度整數）
  let cap=Math.max(1024,src.length>>1), buf=new Uint8Array(cap), p=0, acc=0, nb=0;
  const grow=k=>{ if(p+k>buf.length){ const b=new Uint8Array(Math.max(buf.length*2,p+k+1024)); b.set(buf); buf=b; } };
  const put=(v,n)=>{ acc=(acc<<n)|(v&((1<<n)-1)); nb+=n; while(nb>=8){ nb-=8; grow(1); buf[p++]=(acc>>>nb)&255; } acc&=(1<<nb)-1; };
  const ones=q=>{ while(q>=16){ put(0xFFFF,16); q-=16; } if(q) put((1<<q)-1,q); };
  const n=src.length, u=new Uint32Array(RB); let x1=0,x2=0;
  for(let s=0;s<n;s+=RB){ const e=Math.min(n,s+RB), m=e-s; let sum=0;
    for(let i=0;i<m;i++){ const v=src[s+i], r=v-(2*x1-x2); x2=x1; x1=v; const z=r>=0?2*r:-2*r-1; u[i]=z; sum+=z; }
    if(sum===0){ put(1,1); continue; }      // 整塊殘差為零（空白或完全直線）
    const mean=sum/m; let k=0; while(k<24&&(1<<(k+1))<=mean) k++;
    put(0,1); put(k,5);
    for(let i=0;i<m;i++){ const z=u[i], q=z>>>k;
      if(q<32){ ones(q); put(0,1); if(k) put(z&((1<<k)-1),k); }
      else { ones(32); put(0,1); put(z>>>16,16); put(z&0xFFFF,16); } } }   // 跳脫：直接存 32 位元
  if(nb){ grow(1); buf[p++]=(acc<<(8-nb))&255; }
  return buf.slice(0,p);
}
function riceDecodeInts(buf,n,out){      // out：Int32Array(n)
  let p=0, acc=0, nb=0;
  const fill=()=>{ while(nb<=23){ acc=((acc<<8)|(p<buf.length?buf[p]:0))>>>0; p++; nb+=8; } };
  const get=c=>{ if(nb<c) fill(); nb-=c; const v=(acc>>>nb)&((1<<c)-1); acc&=(1<<nb)-1; return v; };
  const unary=()=>{ let q=0; for(;;){ if(nb===0) fill(); const w=(acc<<(32-nb))>>>0, lz=Math.clz32((~w)>>>0);
      if(lz<nb){ q+=lz; nb-=lz+1; acc&=(1<<nb)-1; return q; } q+=nb; nb=0; acc=0; } };
  let x1=0,x2=0;
  for(let s=0;s<n;s+=RB){ const e=Math.min(n,s+RB);
    if(get(1)){ for(let i=s;i<e;i++){ const v=2*x1-x2; out[i]=v; x2=x1; x1=v; } continue; }
    const k=get(5);
    for(let i=s;i<e;i++){ const q=unary(); let z; if(q>=32) z=((get(16)<<16)|get(16))>>>0; else z=k?((q<<k)|get(k)):q;
      const r=(z&1)?-((z+1)>>>1):(z>>>1), v=r+2*x1-x2; out[i]=v; x2=x1; x1=v; } }
  return out;
}

// 存檔品質：深度量化步距（µm）。0.005 µm 與程式內部保存的精度相同，所以是無損
const SAVE_STEP={lossless:0.005,high:0.02,compact:0.05};
function encodeDepth(q16,step,sign){   // q16：以 0.005 µm 為單位的 Int16（刻痕為負、磨損為正）
  const d=new Int32Array(q16.length), f=0.005/step;
  if(step===0.005) for(let i=0;i<d.length;i++) d[i]=sign*q16[i]; else for(let i=0;i<d.length;i++) d[i]=Math.round(sign*q16[i]*f);
  return riceEncodeInts(d); }
function decodeDepth(bytes,n,step,sign){
  const d=riceDecodeInts(bytes,n,new Int32Array(n)), q=new Int16Array(n), f=step/0.005;
  for(let i=0;i<n;i++){ const v=sign*(step===0.005?d[i]:Math.round(d[i]*f)); q[i]=v>32767?32767:v<-32767?-32767:v; } return q; }
const DIST_KEYS=['crosstalk','ecc','eccMm','flutter','flutterAmt','dust','dustPct','scratch','scratchCount','crack','mold','moldAmt'];
const DIST_OFF={crosstalk:false,ecc:false,flutter:false,dust:false,scratch:false,crack:false,mold:false};
// 儲存／匯出前先問要不要包含轉速調整與失真；按確認才回傳選擇，取消回傳 null
function askExport(kind){
  const wav=kind==='wav'; $('xTitle').textContent=wav?'匯出 WAV':'儲存 .waxrack';
  $('xSpeedHint').textContent=wav?'開啟：用你調整過的播放轉速，音高會跟著變。關閉：每支都用錄音時的轉速，保持原本音高。':'把這幾組調整過的播放轉速一起存進檔案；關閉時載入後會用各支的錄音轉速。';
  $('xDistHint').textContent=wav?'切穿回音、偏心、馬達抖動、灰塵、刮痕、裂紋、霉斑（播放分頁的「失真」設定）。關閉時輸出乾淨的播放聲。':'把播放分頁的「失真」設定（含刮痕與裂紋位置）存進檔案，載入時套用。';
  $('xSpeed').checked=!!U.xSpeed; $('xDist').checked=!!U.xDist; $('expDlg').classList.remove('hide'); $('xOk').focus();
  return new Promise(res=>{ askExport.done=ok=>{ $('expDlg').classList.add('hide'); askExport.done=null;
    if(!ok) return res(null); U.xSpeed=$('xSpeed').checked; U.xDist=$('xDist').checked; savePerf(); res({speed:U.xSpeed,dist:U.xDist}); }; });
}
$('xOk').onclick=()=>askExport.done&&askExport.done(true); $('xCancel').onclick=()=>askExport.done&&askExport.done(false);
$('expDlg').addEventListener('click',e=>{ if(e.target===$('expDlg')&&askExport.done) askExport.done(false); });
// 存檔與匯出 WAV 的檔名：有群組（有命名或不只一支）用群組名，單支沒命名群組就用蠟筒名稱；多組時列前兩組
function saveBaseName(list){
  const gs=[...new Set(list.map(e=>e.group))];
  const names=gs.map(g=>{ const mem=rack.filter(e=>e.group===g); return ((groupMeta[g]&&groupMeta[g].name)||mem.length>1)?groupName(g):cylName(mem[0]); });
  const s=(names.length>2?`${names.slice(0,2).join('、')} 等 ${names.length} 組`:names.join('、')).replace(/[\\/:*?"<>|\x00-\x1f]/g,'').trim().slice(0,80);
  return s||`phonograph-rack-${stamp()}`; }
// 把蠟筒（{T,zq,wq,used,wax,rec,group,name}）打包成 .waxrack。蠟筒架存檔與批次轉檔共用。
// opt：quality、speed（寫入 groupOv）、dist（寫入失真設定）、meta（群組名稱 {gid:name}）、active（裝上的是第幾支）、onStep
async function encodeRackBlob(list,{quality=U.saveQ,speed=false,dist=false,meta={},active=0,onStep}={}){
  const q=quality in SAVE_STEP?quality:'lossless', step=SAVE_STEP[q];
  const cyls=[], blobs=[]; let raw=0;
  for(let i=0;i<list.length;i++){ const e=list[i];
    const c={T:e.T,used:e.used,wax:e.wax||'brown',rec:e.rec?{rpm:recRpm(e),set:e.rec.set}:null,group:e.group,name:e.name||null,zB:0,wB:0};
    if(e.zq){ const enc=encodeDepth(e.zq,step,-1); c.zB=enc.length; blobs.push(enc); raw+=e.zq.length*2; }
    if(e.wq){ const enc=encodeDepth(e.wq,step,1); c.wB=enc.length; blobs.push(enc); raw+=e.wq.length*2; }
    cyls.push(c); if(onStep) onStep(i,list.length); await new Promise(r=>setTimeout(r,0)); }
  const groups=[...new Set(list.map(e=>e.group))];
  const head=new TextEncoder().encode(JSON.stringify({magic:'WAXRACK',v:3,codec:'lpc2-rice',step,quality:q,N,active,cyls,
    groupOv:speed?Object.fromEntries(groups.filter(g=>groupOv[g]).map(g=>[g,groupOv[g]])):{},
    groupMeta:Object.fromEntries(groups.filter(g=>meta[g]).map(g=>[g,{name:meta[g]}])),
    ...(dist?{seed:P.seed,scratchCount:P.scratchCount,defects:Object.fromEntries(DIST_KEYS.map(k=>[k,P[k]]))}:{}),waxColor:list[0]?.wax||U.waxColor}));
  return {blob:new Blob([new Uint32Array([head.length]),head,...blobs]),raw,quality:q};
}
async function saveRack(list,opt){
  if(!node) return; list=(list&&list.length)?list:rack; opt=opt||{speed:true,dist:true};
  toast('正在封存蠟筒架…');
  await storeActive();
  const meta=Object.fromEntries(Object.entries(groupMeta).filter(([,m])=>m&&m.name).map(([g,m])=>[g,m.name]));
  const {blob,raw,quality:q}=await encodeRackBlob(list,{speed:opt.speed,dist:opt.dist,meta,active:Math.max(0,list.findIndex(e=>e.id===activeId)),
    onStep:(i,n)=>toast(`正在壓縮第 ${i+1}/${n} 支…`)});
  const act=rackEntry(activeId); if(act){ act.zq=null; act.wq=null; }   // 使用中的資料仍在音訊執行緒
  if(!await download(blob,`${saveBaseName(list)}.waxrack`)){ toast('已取消儲存'); return; }
  toast(`已儲存 ${list.length} 支蠟筒（${(blob.size/1048576).toFixed(2)} MB，${{lossless:'無損',high:'高品質',compact:'精簡'}[q]}${raw?`，為未壓縮的 ${(blob.size/raw*100).toFixed(0)}%`:''}）`);
}
// 解析 .waxrack（不碰蠟筒架）：回傳 {head, entries, gmap}；entries 已配好新的 id 與群組編號
async function parseRack(file){
  const buf=await readMaybeGz(file), dv=new DataView(buf), hl=dv.getUint32(0,true);
  const head=JSON.parse(new TextDecoder().decode(new Uint8Array(buf,4,hl)));
  if(head.N!==N) throw new Error('格式不符');
  if(head.magic!=='WAXRACK') throw new Error('不是蠟筒架檔');
  let off=4+hl; const entries=[]; const gmap=new Map();
  for(const c of head.cyls){ const L=c.T*N, e={id:++rackSeq,T:c.T,zq:null,wq:null,used:c.used||0,wax:WAXSPEC[c.wax]?c.wax:(WAXSPEC[head.waxColor]?head.waxColor:'brown'),
      rec:c.rec?{acc:c.rec.rpm||0,n:c.rec.rpm?1:0,set:c.rec.set||{}}:null, name:c.name||undefined};
    if(c.group!=null){ if(!gmap.has(c.group)) gmap.set(c.group,++groupSeq); e.group=gmap.get(c.group); } else e.group=++groupSeq;
    if(head.v>=3){   // 新格式：二階預測＋Rice
      if(c.zB){ e.zq=decodeDepth(new Uint8Array(buf,off,c.zB),L,head.step,-1); off+=c.zB; }
      if(c.wB){ e.wq=decodeDepth(new Uint8Array(buf,off,c.wB),L,head.step,1); off+=c.wB; }
    } else {
      if(c.z){ e.zq=new Int16Array(buf.slice(off,off+L*2)); off+=L*2; }
      if(c.w){ e.wq=new Int16Array(buf.slice(off,off+L*2)); off+=L*2; } }
    entries.push(e); }
  if(!entries.length) throw new Error('檔案裡沒有蠟筒');
  return {head,entries,gmap};
}
const rackFull=n=>rack.length+n>24+((rack.length===1&&rack[0].used===0)?1:0);
async function loadAny(file){
  const peek=await readMaybeGz(file), hl=new DataView(peek).getUint32(0,true);
  if(JSON.parse(new TextDecoder().decode(new Uint8Array(peek,4,hl))).magic==='WAXCYL') return loadCylinder(file);
  const {head,entries,gmap}=await parseRack(new Blob([peek]));
  if(rackFull(entries.length)){ toast(`檔案有 ${entries.length} 支蠟筒，加入後會超過上限 24 支`); return; }
  doStop(); await storeActive();
  if(rack.length===1&&rack[0].used===0){ rack.length=0; } rack.push(...entries); activeId=-1; nextInfo=null;
  if(head.groupOv) for(const [g,o] of Object.entries(head.groupOv)){ const ng=gmap.get(+g); if(ng!=null) groupOv[ng]=o; }
  if(head.groupMeta) for(const [g,o] of Object.entries(head.groupMeta)){ const ng=gmap.get(+g); if(ng!=null) groupMeta[ng]={name:o.name}; }
  if(head.seed) P.seed=head.seed; if(head.scratchCount) P.scratchCount=head.scratchCount;
  if(head.defects) for(const [k,v] of Object.entries(head.defects)){ if(!DIST_KEYS.includes(k)) continue; if(typeof v==='boolean') setToggle(k,v); else if(typeof v==='number') setRange(k,v); }
  genDefects(); sendParams(['scratches','crackA0','crackSlope']); updateDefectUniforms();
  await mountFresh(entries[Math.max(0,Math.min(entries.length-1,head.active||0))]);
  shelfSig=''; renderRack(); toast(`已加入 ${entries.length} 支蠟筒`);
}

const rackEntry=id=>rack.find(e=>e.id===id);
const rackIndex=id=>rack.findIndex(e=>e.id===id);
function quantize(z,w,e){ let used=0; const zq=new Int16Array(z.length); let anyW=false;
  for(let i=0;i<z.length;i++){ const v=z[i]; if(v<-0.001) used=i; zq[i]=v<-163?-32767:Math.round(v*200); if(w&&w[i]>0) anyW=true; }
  let wq=null; if(anyW){ wq=new Int16Array(w.length); for(let i=0;i<w.length;i++) wq[i]=Math.min(32767,Math.round(w[i]*200)); }
  e.zq=used>0?zq:null; e.wq=used>0?wq:null; e.used=used; e.T=z.length/N; }
function expand(e){ const L=e.T*N, z=new Float32Array(L), w=new Float32Array(L);
  if(e.zq) for(let i=0;i<L;i++) z[i]=e.zq[i]/200; if(e.wq) for(let i=0;i<L;i++) w[i]=e.wq[i]/200; return {z,w}; }
function newEntry(nT,group){ return {id:++rackSeq,T:nT,zq:null,wq:null,used:0,wax:U.waxColor,group:group||++groupSeq}; }
function clearNext(){ if(node) node.port.postMessage({type:'clearNext'}); nextInfo=null; renderRack(); }
function prepareNext(){
  if(!node) return; clearNext();
  const i=rackIndex(activeId);
  if(mode==='record'&&U.chainRec){
    let e=rack[i+1], virtual=false;
    if(!e||e.used>0){ e=newEntry(capFor(U.waxColor),(rack[i]&&rack[i].group)); virtual=true; }
    const {z,w}=expand(e); node.port.postMessage({type:'setNext',id:e.id,T:e.T,z,wear:w,kind:'record'},[z.buffer,w.buffer]);
    nextInfo={id:e.id,kind:'record',virtual,entry:e};
  } else if(mode==='play'&&(U.chainPlay||carousel)){
    let e=rack.slice(i+1).find(x=>x.used>0);
    if(!e&&carousel) e=rack.slice(0,i).find(x=>x.used>0);   // 輪播：繞回架上第一支有錄音的
    if(e){ const {z,w}=expand(e); node.port.postMessage({type:'setNext',id:e.id,T:e.T,z,wear:w,kind:'play',used:e.used},[z.buffer,w.buffer]); nextInfo={id:e.id,kind:'play',virtual:false,entry:e}; }
  }
  renderRack();
}
function onSwapped(m){
  if(m.kind==='record'&&FC.recT0!=null&&ctx) FC.anchor={s:0,t:FC.recOff+(ctx.currentTime-FC.recT0)}; else if(m.kind!=='record') FC.anchor=null;
  const old=rackEntry(m.oldId); if(old) quantize(m.z,m.wear,old);
  if(nextInfo&&nextInfo.virtual&&nextInfo.id===m.newId){ rack.splice(rackIndex(m.oldId)+1,0,nextInfo.entry); }
  const ne=rackEntry(m.newId); if(ne){ ne.zq=null; ne.wq=null; if(ne.wax&&ne.wax!==U.waxColor) applyWax(ne.wax,true); if(m.kind==='play') applyRecSettings(ne); }
  if(m.kind==='record'&&nextInfo&&nextInfo.entry&&!nextInfo.entry.rec) nextInfo.entry.rec=newRecInfo();
  if(m.kind==='record'&&ne&&old) ne.group=old.group;   // 連續錄音換上的蠟筒與前一支同組   // 裝上後資料在音訊執行緒
  activeId=m.newId; T=ne?ne.T:T; rebuildTex(); recMax=m.kind==='record'?0:(ne?ne.used:0); hasContent=!!(ne&&ne.used>0)||m.kind==='record';
  dispS=0; nextInfo=null; updateCylInfo();
  toast(`${m.kind==='record'?'錄音已接續到':'正在播放'}第 ${rackIndex(activeId)+1} 支蠟筒`);
  prepareNext();
}
async function storeActive(){ const e=rackEntry(activeId); if(!e||!node) return; const snap=await requestSnapshot(); quantize(snap.z,snap.wear,e); }
async function mount(id,{play=false}={}){
  FC.anchor=null;
  if(!node){ toast('請先開啟留聲機'); return; }
  doStop(); await storeActive();
  const e=rackEntry(id); const {z,w}=expand(e);
  node.port.postMessage({type:'setCylinder',id,T:e.T,z,wear:w},[z.buffer,w.buffer]);
  const used=e.used; e.zq=null; e.wq=null; e.used=used; activeId=id; T=e.T; rebuildTex(); if((e.wax||'brown')!==U.waxColor) applyWax(e.wax||'brown',true); applyRecSettings(e);
  hasContent=used>0; recMax=used; seekTo(0); updateCylInfo(); renderRack();
  if(play){ setTimeout(()=>doPlay(),60); }
}
async function addCylinder(nT,data){
  if(rack.length>=24){ toast('蠟筒架最多 24 支（記憶體考量）'); return; }
  const e=newEntry(nT); if(data) quantize(data.z,data.w,e);
  const ae=rackEntry(activeId); let at=rackIndex(activeId); if(ae) for(let i=0;i<rack.length;i++) if(rack[i].group===ae.group) at=i;
  rack.splice(at+1,0,e); await mount(e.id); return e;
}
async function removeCylinder(id){ return removeMany([id]); }
async function removeCylinderOld(id){
  if(rack.length<=1){ toast('至少要保留一支蠟筒'); return; }
  const e=rackEntry(id); if(e.used>0&&!confirm('這支蠟筒上的刻痕會消失，確定移除嗎？')) return;
  const i=rackIndex(id);
  if(id===activeId){ rack.splice(i,1); const t=rack[Math.min(i,rack.length-1)]; activeId=-1; doStop(); await mountFresh(t); }
  else { rack.splice(i,1); if(mode!=='idle') prepareNext(); }
  renderRack();
}
async function mountFresh(e){ if((e.wax||'brown')!==U.waxColor) applyWax(e.wax||'brown',true); applyRecSettings(e); const {z,w}=expand(e); node.port.postMessage({type:'setCylinder',id:e.id,T:e.T,z,wear:w},[z.buffer,w.buffer]);
  e.zq=null; e.wq=null; activeId=e.id; T=e.T; rebuildTex(); hasContent=e.used>0; recMax=e.used; seekTo(0); updateCylInfo(); }
function groupsInOrder(){ return [...new Set(rack.map(e=>e.group))]; }
function groupName(g){ return (groupMeta[g]&&groupMeta[g].name)||`第 ${groupsInOrder().indexOf(g)+1} 組`; }
function cylName(e){ if(e.name) return e.name; const m=rack.filter(x=>x.group===e.group); return m.length>1?`第 ${m.indexOf(e)+1} 支`:'單支蠟筒'; }
// 一支蠟筒有音訊部分的長度（秒），用它的錄音轉速換算；蠟筒架和上方時間軸共用
function cylSecs(e){ return e.used>0?(e.used+1)/N/((recRpm(e)||P.rpm)/60):0; }
function fmtDur(sec){ const m=Math.floor(sec/60), s2=Math.round(sec%60); return `${m}:${String(s2).padStart(2,'0')}`; }
function afterReorder(){ if(mode!=='idle') prepareNext(); shelfSig=''; renderRack(); }
let rackDrag=null;   // 拖曳中：{g} 是整組，{id} 是單支
// 拖曳排序：整組插到 tg 的前/後；單支插到 tid 的前/後（tid 為 null 時接在 g 組最後），並改屬該組
function dropGroup(g,tg,after){ if(g===tg) return; const gs=groupsInOrder().filter(x=>x!==g); gs.splice(gs.indexOf(tg)+(after?1:0),0,g);
  const nr=[]; for(const x of gs) nr.push(...rack.filter(e=>e.group===x)); rack.length=0; rack.push(...nr); afterReorder(); }
function dropCyl(id,g,tid,after){ if(id===tid) return; const e=rackEntry(id); if(!e) return; rack.splice(rackIndex(id),1); e.group=g;
  let at; if(tid!=null) at=rackIndex(tid)+(after?1:0); else { at=-1; for(let i=0;i<rack.length;i++) if(rack[i].group===g) at=i; at=at<0?rack.length:at+1; }
  rack.splice(at,0,e); afterReorder(); }
function setCylGroup(ids,g){ if(g==='new') g=++groupSeq; g=+g; const moving=rack.filter(e=>ids.includes(e.id)); for(const e of moving) e.group=g;
  const rest=rack.filter(e=>!ids.includes(e.id)); let at=-1; for(let i=0;i<rest.length;i++) if(rest[i].group===g) at=i;
  if(at<0) at=rest.length-1; rest.splice(at+1,0,...moving); rack.length=0; rack.push(...rest); afterReorder(); return g; }
async function removeMany(ids){
  ids=ids.filter(id=>rackEntry(id)); if(!ids.length) return;
  const n=ids.filter(id=>rackEntry(id).used>0).length; if(n&&!confirm(`要移除 ${ids.length} 支蠟筒嗎？其中 ${n} 支有刻痕，會一併消失。`)) return;
  const wasActive=ids.includes(activeId), idx=rackIndex(activeId);
  for(const id of ids){ const i=rackIndex(id); if(i>=0) rack.splice(i,1); rackSel.delete(id); }
  if(!rack.length){ const e=newEntry(capFor(U.waxColor)); rack.push(e); }
  if(wasActive){ doStop(); activeId=-1; await mountFresh(rack[Math.min(Math.max(0,idx),rack.length-1)]); } else if(mode!=='idle') prepareNext();
  afterReorder(); }
function startRename(el,cur,commit){ const inp=document.createElement('input'); inp.className='nameEd'; inp.value=cur; el.replaceWith(inp); inp.focus(); inp.select();
  let done=false; const fin=ok=>{ if(done) return; done=true; if(ok) commit(inp.value.trim()); inp.remove(); renderRack(); };
  inp.addEventListener('keydown',e=>{ if(e.key==='Enter') fin(true); else if(e.key==='Escape') fin(false); e.stopPropagation(); }); inp.addEventListener('blur',()=>fin(true)); }
function renderRack(){
  updateShelf();
  const el=$('rackList'); if(!el) return;
  if(el.querySelector('.nameEd')||rackDrag) return;  // 正在改名或拖曳時不重繪
  const act=rackEntry(activeId); if(act&&mode==='record') act.used=Math.max(act.used,recMax);
  const gs=groupsInOrder(), opts=gs.map(g=>`<option value="${g}">${groupName(g)}</option>`).join('')+'<option value="new">＋ 新群組</option>';
  let html='';
  for(const g of gs){ const mem=rack.filter(e=>e.group===g), secs=mem.reduce((a,e)=>a+cylSecs(e),0), ov=groupOv[g];
    const allSel=mem.every(e=>rackSel.has(e.id)), someSel=mem.some(e=>rackSel.has(e.id));
    html+=`<div class="grp${mem.some(e=>e.id===activeId)?' act':''}" data-g="${g}"><div class="gh"><span class="grip" draggable="true" title="拖曳調整整組順序">⠿</span><input type="checkbox" class="gsel" ${allSel?'checked':''} ${!allSel&&someSel?'data-ind="1"':''}>
      <span class="gname" data-act="renameG" title="點一下改名">${groupName(g)}</span><small>${mem.length} 支・${fmtDur(secs)}${ov&&ov.rpm!=null?`・<span style="color:#e8b45a">播放 ${ov.rpm} rpm（已調整）</span>`:''}</small><span class="sp"></span>
      <button class="mini" data-act="gPlay" title="從這組第一支開始播放">▶ 播放這組</button><button class="mini" data-act="gDel" title="移除整組">✕</button></div>`;
    for(const e of mem){ const pct=e.used>0?Math.min(100,(e.used+1)/(e.T*N)*100):0, on=e.id===activeId, nx=nextInfo&&nextInfo.id===e.id;
      html+=`<div class="rk${on?' on':''}" data-id="${e.id}"><span class="grip" draggable="true" title="拖曳調整順序，拖到別組就會移過去">⠿</span><input type="checkbox" class="csel" ${rackSel.has(e.id)?'checked':''}>
        <span class="nm"><span class="cname" data-act="renameC" title="點一下改名">${cylName(e)}</span>${on?' <span class="nx" style="color:var(--gold2)">・使用中</span>':''}${nx?' <span class="nx">← 下一支</span>':''}
        <small>${WAXSPEC[e.wax||'brown'].name}・${(e.T*60/NOM).toFixed(0)} 秒・${pct>0?`已刻 ${pct.toFixed(0)}%`:'空白'}${pct>0&&recRpm(e)?`・錄於 ${Math.round(recRpm(e))} rpm`:''}</small></span>
        <span class="bar"><i style="width:${pct}%"></i></span>
        <select class="mv" title="移到群組"><option value="">移到…</option>${opts.replace(`value="${g}">`,`value="${g}" disabled>`)}</select>
        ${on?'':'<button class="mini" data-act="mount" title="裝上">裝上</button>'}<button class="mini" data-act="play" title="從這支開始播放">▶</button><button class="mini" data-act="del" title="移除">✕</button></div>`; }
    html+='</div>'; }
  if(nextInfo&&nextInfo.virtual) html+=`<div class="rk"><span class="nm">待命中的新蠟筒 <span class="nx">← 下一支</span><small>錄到盡頭時自動換上</small></span></div>`;
  el.innerHTML=html;
  el.querySelectorAll('.gsel[data-ind]').forEach(c=>c.indeterminate=true);
  const used=rack.filter(e=>e.used>0).length; if($('rackSum')) $('rackSum').textContent=`${gs.length} 組・${rack.length} 支（${used} 支有內容）・上限 24`;
  const ns=[...rackSel].filter(id=>rackEntry(id)).length; if($('selInfo')) $('selInfo').textContent=ns?`已選取 ${ns} 支`:'未選取';
  const sa=$('rackSelAll'); if(sa){ sa.checked=rack.length>0&&rack.every(e=>rackSel.has(e.id)); sa.indeterminate=!sa.checked&&ns>0; }
}
document.addEventListener('change',e=>{
  const t=e.target; if(!t.closest||!t.closest('#rackList,#rackSelAll')) return;
  if(t.id==='rackSelAll'){ if(t.checked) rack.forEach(x=>rackSel.add(x.id)); else rackSel.clear(); renderRack(); return; }
  if(t.classList.contains('gsel')){ const g=+t.closest('.grp').dataset.g; rack.filter(x=>x.group===g).forEach(x=>t.checked?rackSel.add(x.id):rackSel.delete(x.id)); renderRack(); return; }
  if(t.classList.contains('csel')){ const id=+t.closest('.rk').dataset.id; t.checked?rackSel.add(id):rackSel.delete(id); renderRack(); return; }
  if(t.classList.contains('mv')&&t.value){ const id=+t.closest('.rk').dataset.id, g=setCylGroup([id],t.value); toast(`已移到「${groupName(g)}」`); }
});
document.addEventListener('click',e=>{
  const b=e.target.closest&&e.target.closest('#rackList [data-act]'); if(!b) return; const a=b.dataset.act;
  const gEl=b.closest('.grp'), g=gEl?+gEl.dataset.g:null, rk=b.closest('.rk'), id=rk?+rk.dataset.id:null;
  if(a==='renameG') startRename(b,groupName(g),v=>{ (groupMeta[g]||(groupMeta[g]={})).name=v||undefined; shelfSig=''; });
  else if(a==='renameC'){ const en=rackEntry(id); startRename(b,cylName(en),v=>{ en.name=v||undefined; shelfSig=''; }); }
  else if(a==='gPlay'){ const f=rack.find(x=>x.group===g&&x.used>0)||rack.find(x=>x.group===g); if(f) mount(f.id,{play:true}); }
  else if(a==='gDel') removeMany(rack.filter(x=>x.group===g).map(x=>x.id));
  else if(a==='mount'){ if(id!==activeId) mount(id); } else if(a==='play') mount(id,{play:true}); else if(a==='del') removeMany([id]);
});
function clearDropMarks(){ document.querySelectorAll('#rackList .dropB,#rackList .dropA,#rackList .dropIn').forEach(x=>x.classList.remove('dropB','dropA','dropIn')); }
function dropTarget(e){   // 依滑鼠位置算出放下的位置
  const rl=$('rackList'); if(!rackDrag||!rl||!rl.contains(e.target)) return null;
  const half=el=>{ const r=el.getBoundingClientRect(); return e.clientY>r.top+r.height/2; };
  if(rackDrag.g!=null){ const gEl=e.target.closest('.grp'); if(!gEl) return null; return {el:gEl,g:+gEl.dataset.g,after:half(gEl)}; }
  const rk=e.target.closest('.rk[data-id]'); if(rk) return {el:rk,g:rackEntry(+rk.dataset.id).group,tid:+rk.dataset.id,after:half(rk)};
  const gEl=e.target.closest('.grp'); if(gEl) return {el:gEl,g:+gEl.dataset.g,tid:null,inside:true};
  return null;
}
document.addEventListener('dragstart',e=>{
  const h=e.target.closest&&e.target.closest('#rackList .grip'); if(!h) return;
  const rk=h.closest('.rk'), gEl=h.closest('.grp'), src=rk||gEl;
  rackDrag=rk?{id:+rk.dataset.id}:{g:+gEl.dataset.g};
  e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain','');
  const r=src.getBoundingClientRect(); e.dataTransfer.setDragImage(src,e.clientX-r.left,e.clientY-r.top);
  requestAnimationFrame(()=>src.classList.add('dragging'));
});
document.addEventListener('dragover',e=>{
  const t=dropTarget(e); if(!t) return; e.preventDefault(); e.dataTransfer.dropEffect='move';
  clearDropMarks(); t.el.classList.add(t.inside?'dropIn':t.after?'dropA':'dropB');
  const rl=$('rackList'), r=rl.getBoundingClientRect();   // 靠近上下緣時自動捲動
  if(e.clientY<r.top+24) rl.scrollTop-=8; else if(e.clientY>r.bottom-24) rl.scrollTop+=8;
});
document.addEventListener('drop',e=>{
  const t=dropTarget(e); if(!t) return; e.preventDefault(); const d=rackDrag; rackDrag=null; clearDropMarks();
  if(d.g!=null) dropGroup(d.g,t.g,t.after); else dropCyl(d.id,t.g,t.tid,t.after);
});
document.addEventListener('dragend',()=>{ if(!rackDrag&&!document.querySelector('#rackList .dragging')) return; rackDrag=null; clearDropMarks(); renderRack(); });
const selEntries=()=>rack.filter(e=>rackSel.has(e.id));
async function exportAll(sel,opt){
  opt=opt||{speed:true,dist:true};
  if(!node) return; await storeActive();
  const list=((sel&&sel.length)?sel:rack).filter(e=>e.used>0); if(!list.length){ toast(sel?'選取的蠟筒沒有刻錄內容':'蠟筒架上沒有刻錄內容'); return; }
  const sr=48000, parts=[]; const rpmFor=e=>{ if(!opt.speed) return Math.max(20,recRpm(e)||P.rpm);   // 不含轉速調整：用錄音時的轉速
    const ov=groupOv[e.group]; if(U.applyRec&&ov&&ov.rpm) return Math.max(20,ov.rpm); return Math.max(20,(U.applyRec&&recRpm(e))||P.rpm); };
  for(let k=0;k<list.length;k++){ const e=list[k], {z,w}=expand(e), L=e.T*N; let first=0;
    if(k===0){ for(let i=0;i<L;i++) if(z[i]<-0.001){ first=i; break; } }
    const startS=k===0?Math.max(0,first-N*0.05):0, endS=k===list.length-1?Math.min(L-1,e.used+N*0.1):L-1;
    toast(`離線渲染第 ${k+1}/${list.length} 支…`); parts.push(await renderRange(z,w,e.T,startS,endS,rpmFor(e),sr,k===list.length-1,opt.dist?null:DIST_OFF)); }
  const total=parts.reduce((a,b)=>a+b.length,0), out=new AudioBuffer({numberOfChannels:2,length:total,sampleRate:sr});
  for(let c=0;c<2;c++){ const d=out.getChannelData(c); let o=0; for(const b of parts){ d.set(b.getChannelData(c),o); o+=b.length; } }
  if(!await download(encodeWav(out),`${saveBaseName(list)}.wav`)){ toast('已取消匯出'); return; } toast(`已匯出 ${list.length} 支蠟筒（${(total/sr).toFixed(1)} 秒）`);
  const act=rackEntry(activeId); if(act){ act.zq=null; act.wq=null; }
}

let newT=null;
function rebuildTex(){ depthDirty=true; DV.x1=0; DR.key=''; texData=new Uint8Array(TEXW*T); grooveTex.dispose(); grooveTex=makeTex(); waxU.uGroove.value=grooveTex; updateVis(); texDirty=false; }
function newCylinder(nT){
  if(hasContent&&!confirm('目前蠟筒上的刻痕會全部消失，確定嗎？')) return;
  doStop(); T=nT; const z=new Float32Array(T*N), w=new Float32Array(T*N);
  node.port.postMessage({type:'setCylinder',id:activeId,T,z,wear:w},[z.buffer,w.buffer]);
  const ae=rackEntry(activeId); if(ae){ ae.T=T; ae.used=0; ae.zq=null; ae.wq=null; } renderRack();
  rebuildTex(); hasContent=false; recMax=0; genDefects(); sendParams(['scratches','crackA0','crackSlope']); updateDefectUniforms(); updateCylInfo();
  seekTo(0);
}

// ---------------- 綁定事件 ----------------
$('vol').addEventListener('input',e=>{ U.masterVol=+e.target.value; U.muted=false; applyVolume(); });
$('bMute').onclick=()=>{ U.muted=!U.muted; applyVolume(); };
applyVolume();
rack[0].T=T; rack[0].wax=U.waxColor; $('mag').classList.toggle('both',U.magTab==='both'); buildPanel(); setupCrank(); setupFileConsole(); updateCylInfo(); renderRack(); renderWaxInfo(); setWaxColor(); applyPerf();
$('bRec').onclick=()=>{ stopCarousel(); doRecord(); }; $('bPlay').onclick=()=>{ if(carousel){ stopCarousel(); doStop(); } else doPlay(); }; $('bStop').onclick=()=>{ stopCarousel(); doStop(); }; $('bHome').onclick=()=>seekTo(0);
$('bTour').onclick=()=>{ if(carousel) stopCarousel(); else startCarousel(); };   // 關掉輪播只恢復介面，播放照常繼續
$('bPlayer').onclick=()=>{ if(carousel) stopCarousel(); music.open(); };
$('bHelp').onclick=()=>$('help').classList.remove('hide'); $('bHelpClose').onclick=()=>$('help').classList.add('hide');
$('help').addEventListener('click',e=>{ if(e.target.id==='help') $('help').classList.add('hide'); });
$('bSlow').onclick=()=>setRange('rpm',3); $('bStd').onclick=()=>setRange('rpm',160);
$('bSlowR').onclick=()=>setRange('rRpm',3); $('bStdR').onclick=()=>setRange('rRpm',160);
document.addEventListener('click',e=>{ const b=e.target.closest&&e.target.closest('.mtabs [data-pm]'); if(!b) return; setPmTab(b.dataset.pm); });
function setPmTab(t){ U.pmTab=t; document.querySelectorAll('details[data-pm]').forEach(d=>d.dataset.pm=t); document.querySelectorAll('.mtabs button').forEach(b=>b.classList.toggle('on',b.dataset.pm===t)); }
setPmTab(U.pmTab);
$('bClearWear').onclick=()=>{ node&&node.port.postMessage({type:'clearWear'}); toast('磨損已還原（現實中做不到）'); };
$('bReroll').onclick=()=>{ P.seed=(P.seed*1103515245+12345)&0x7fffffff; genDefects(); sendParams(['scratches','crackA0','crackSlope']); updateDefectUniforms(); toast('已重新產生刮痕與裂紋'); };
$('bNewCyl').onclick=()=>addCylinder(capFor(U.waxColor)).then(()=>toast(`已裝上新的空白${WAXSPEC[U.waxColor].name}蠟筒`));
$('bShave').onclick=()=>newCylinder(T);
$('bSave').onclick=async()=>{ const o=await askExport('save'); if(o) saveRack(null,o).catch(e=>toast('儲存失敗：'+e.message)); };
$('bSaveSel').onclick=async()=>{ const l=selEntries(); if(!l.length){ toast('請先勾選要儲存的蠟筒或群組'); return; } const o=await askExport('save'); if(o) saveRack(l,o).catch(e=>toast('儲存失敗：'+e.message)); };
$('bWavSel').onclick=async()=>{ const l=selEntries(); if(!l.length){ toast('請先勾選要匯出的蠟筒或群組'); return; } const o=await askExport('wav'); if(o) exportAll(l,o).catch(e=>toast('匯出失敗：'+e.message)); };
$('bNewCyl2').onclick=()=>addCylinder(capFor(U.waxColor)).then(()=>toast(`已新增空白${WAXSPEC[U.waxColor].name}蠟筒`));
$('bSelGroup').onclick=()=>{ const l=selEntries(); if(!l.length){ toast('請先勾選蠟筒'); return; } const g=setCylGroup(l.map(e=>e.id),'new'); toast(`已把 ${l.length} 支移到「${groupName(g)}」`); };
$('bSelDel').onclick=()=>{ const l=selEntries(); if(!l.length){ toast('請先勾選蠟筒'); return; } removeMany(l.map(e=>e.id)); };
$('bLoad').onclick=()=>$('loadIn').click();
$('loadIn').onchange=e=>{ const f=e.target.files[0]; e.target.value=''; if(f) loadAny(f).catch(err=>toast('載入失敗：'+err.message)); };
$('bWav').onclick=async()=>{ const o=await askExport('wav'); if(o) exportAll(null,o).catch(e=>toast('匯出失敗：'+e.message)); };
setDockTab(U.dockTab||'rec');
// 解碼音檔；尚未開啟留聲機時先用離線音訊環境解碼，之後播放時會自動重取樣
function decodeAudio(data){ const dec=ctx||new OfflineAudioContext(1,1,48000); return new Promise((res,rej)=>{ const pr=dec.decodeAudioData(data,res,rej); if(pr&&pr.catch) pr.catch(rej); }); }
async function importAudio(f){
  $('fileName').textContent=`正在解碼 ${f.name}…`;
  try{
    fileBuffer=await decodeAudio(await f.arrayBuffer());
    fileTitle=f.name.replace(/\.[^.]+$/,'')||f.name;
    $('fileName').textContent=`${f.name}・${fileBuffer.duration.toFixed(1)} 秒・${fileBuffer.numberOfChannels===1?'單聲道':'立體聲（錄音時混成單聲道）'}`;
    if(U.src!=='file'){ U.src='file'; $('sel_src').value='file'; updateWhen(); }
    fileConsoleShow(); updateWhen();
    toast('音檔已載入，可設定起訖點後按 ● 開始刻錄');
  }catch(err){ fileBuffer=null; fileTitle=''; $('fileName').textContent='無法解碼這個檔案'; toast('瀏覽器無法解碼這個音檔格式'); }
}
$('fileIn').onchange=e=>{ const f=e.target.files[0]; e.target.value=''; if(f) importAudio(f); };
// 拖放：音檔→刻錄來源；.waxcyl→載入蠟筒
addEventListener('dragover',e=>{ e.preventDefault(); });
addEventListener('drop',e=>{ e.preventDefault(); const f=e.dataTransfer&&e.dataTransfer.files[0]; if(!f) return;
  if(/\.wax(cyl|rack)$/i.test(f.name)){ if(!node){ toast('請先開啟留聲機'); return; } loadAny(f).catch(err=>toast('載入失敗：'+err.message)); }
  else importAudio(f); });
$('bClose').onclick=()=>{ camMode='home'; camPrev=null; $('backBtn').classList.remove('on'); $('shelfPager').classList.remove('on'); const x=carriage.position.x; flyTo(new THREE.Vector3(x+3.2,CY+RW+2.3,5.2),new THREE.Vector3(x,CY+RW,0)); };
$('bOverview').onclick=()=>{ camMode='home'; camPrev=null; $('backBtn').classList.remove('on'); $('shelfPager').classList.remove('on'); flyTo(HOME.pos.clone(),HOME.tgt.clone()); };
function setMagTab(t){ U.magTab=t; $('mag').classList.toggle('both',t==='both'); document.querySelectorAll('#magHead .tabs button').forEach(x=>x.classList.toggle('on',x.dataset.tab===t)); const sel=$('sel_magTab'); if(sel) sel.value=t;
  if(!U.showMag){ U.showMag=true; $('mag').classList.remove('hide'); const c=document.querySelector('input[data-ck="showMag"]'); if(c) c.checked=true; } }
document.querySelectorAll('#magHead .tabs button').forEach(b=>b.onclick=()=>setMagTab(b.dataset.tab));
function setDockTab(t){ U.dockTab=t; document.querySelectorAll('.dtabs button').forEach(b=>b.classList.toggle('on',b.dataset.dt===t));
  $('paneRec').classList.toggle('on',t==='rec'); $('paneRack').classList.toggle('on',t==='rack'); $('paneMag').classList.toggle('on',t==='mag'); $('dockMeter').parentNode.style.visibility=t==='rec'?'':'hidden';
  const d=$('recDock'); if(d.classList.contains('collapsed')){ d.classList.remove('collapsed'); $('dockToggle').textContent='收合 ▾'; } layoutDock(); if(t==='rack') renderRack(); }
document.querySelectorAll('.dtabs button').forEach(b=>b.onclick=()=>setDockTab(b.dataset.dt));
$('dockToggle').onclick=()=>{ const d=$('recDock'); d.classList.toggle('collapsed'); $('dockToggle').textContent=d.classList.contains('collapsed')?'展開 ▴':'收合 ▾'; layoutDock(); };
new ResizeObserver(()=>layoutDock()).observe($('recDock'));
$('panelToggle').onclick=()=>$('panel').classList.toggle('hide');
const seekEl=$('seek'); let seeking=false;
seekEl.addEventListener('input',()=>{ seeking=true; seekTo(seekEl.value/1000*(T*N-1)); });
seekEl.addEventListener('change',()=>{ seeking=false; });
addEventListener('keydown',e=>{ if(askExport.done){ if(e.key==='Escape') askExport.done(false); else if(e.key==='Enter'){ e.preventDefault(); askExport.done(true); } return; }
  if(e.target.tagName==='INPUT'&&e.target.type!=='range'||e.target.tagName==='SELECT') return;
  if(e.key==='p'||e.key==='P'){ if(playerMode) music.close(); else $('bPlayer').click(); return; }
  if(playerMode){ if(e.code==='Space'){ e.preventDefault(); $('pvPlay').click(); } else if(e.key==='m'||e.key==='M'){ U.muted=!U.muted; applyVolume(); } else if(e.key==='Escape') music.close(); return; }   // 播放器裡不錄音、不開輪播
  if(e.code==='Space'){ e.preventDefault(); $('bPlay').click(); } else if(e.key==='m'||e.key==='M'){ U.muted=!U.muted; applyVolume(); } else if(e.key==='r'||e.key==='R'){ $('bRec').click(); }
  else if(e.key==='t'||e.key==='T'){ $('bTour').click(); } else if(e.key==='Escape'){ if(carousel) stopCarousel(); else doStop(); } });

$('bStart').onclick=async()=>{
  try{ await initAudio(); $('splash').classList.add('hide'); setTimeout(()=>$('splash').remove(),700); openExternal(); music.ready(); if(!has3D) setTimeout(()=>toast('這台電腦無法使用 3D（WebGL），已改為無 3D 模式；聲音與剖面照常'),900); }
  catch(err){ $('splashMsg').textContent='音訊初始化失敗：'+err.message; }
};
// ---- 桌面版：雙擊 .waxrack／音檔交給本程式時開啟；留聲機還沒開啟就先排隊 ----
const externalFiles=[];
function openExternal(f){
  if(f) externalFiles.push(new File([f.data],f.name));
  if(!node){ if(f) toast(`已收到「${f.name}」，開啟留聲機後載入`); return; }
  for(const file of externalFiles.splice(0)){
    if(/\.(waxrack|waxcyl)$/i.test(file.name)) loadAny(file).catch(err=>toast('載入失敗：'+err.message));
    else importAudio(file);
  }
}
platform.onOpenFile?.(openExternal);

// ---------------- 給音樂播放器與曲庫（src/music.js）用的介面 ----------------
// 把一首歌（AudioBuffer）轉成 .waxrack 的 Blob；cfg：wax、rpm、normalize、quality、title
async function convertSong(buffer,cfg,onProgress){
  const wax=WAXSPEC[cfg.wax]?cfg.wax:'brown', rpm=Math.max(20,Math.min(240,+cfg.rpm||160));
  const res=await burnBuffer(buffer,{gainDb:cfg.normalize?normalizeGain(buffer):0,wax,rpm,waxPreset:true,onProgress});
  if(!res.cyls.length) throw new Error('沒有刻到任何內容（音檔可能是靜音）');
  const set={...WAXSPEC[wax].rec,tipOn:true,volume:P.volume,drive:'motor',targetRpm:rpm};
  const list=res.cyls.map(m=>{ const e={T:m.T,zq:null,wq:null,used:0,wax,group:1,rec:{acc:rpm,n:1,set}}; quantize(m.z,null,e); return e; });
  return (await encodeRackBlob(list,{quality:cfg.quality||'lossless',meta:{1:cfg.title||''}})).blob;
}
// 把一首歌（.waxrack 位元組）放到蠟筒架最後面，自成一組；不裝上。播放中會接好下一支，所以能無縫接到這首
async function loadSong(data,{name}={}){
  const {entries}=await parseRack(new Blob([data]));
  if(rackFull(entries.length)) throw new Error(`這首需要 ${entries.length} 支蠟筒，蠟筒架放不下（上限 24 支）`);
  const gid=entries[0].group; for(const e of entries) e.group=gid;
  groupMeta[gid]={name:name||groupMeta[gid]?.name};
  rack.push(...entries); afterReorder(); return gid;
}
function playGroup(gid){ const e=rack.find(x=>x.group===gid&&x.used>0)||rack.find(x=>x.group===gid); return e?mount(e.id,{play:true}):null; }
// 移除一組（使用中的那一支不動）
function removeGroup(gid){ for(let i=rack.length-1;i>=0;i--) if(rack[i].group===gid&&rack[i].id!==activeId) rack.splice(i,1); if(!rack.some(e=>e.group===gid)){ delete groupMeta[gid]; delete groupOv[gid]; } afterReorder(); }
function rackSongs(){ return groupsInOrder().map(g=>{ const mem=rack.filter(e=>e.group===g); return {gid:g,name:groupName(g),secs:mem.reduce((a,e)=>a+cylSecs(e),0),cyls:mem.length,hasContent:mem.some(e=>e.used>0)}; }); }
function musicStatus(){ const ae=rackEntry(activeId), playing=mode==='play'; if(!ae) return {playing};
  const mem=rack.filter(x=>x.group===ae.group), i=mem.indexOf(ae), before=mem.slice(0,i).reduce((a,e)=>a+cylSecs(e),0);
  return {gid:ae.group,name:groupName(ae.group),pos:before+Math.min(dispS/N/((recRpm(ae)||P.rpm)/60),cylSecs(ae)),total:mem.reduce((a,e)=>a+cylSecs(e),0),playing}; }
const music=initMusic({ platform, toast, fmtDur, hasAudio:()=>!!node, decodeAudio, convertSong, loadSong, playGroup, removeGroup, rackSongs, musicStatus,
  stop:doStop, togglePlay:()=>$('bPlay').click(), groupName,
  setPlayerMode:(on,side)=>{ playerMode=on; document.body.classList.toggle('player',on); movePlaySettings(on?side:null); if(!on) frameView(); } });
// 播放器的側邊欄：把面板上的音量、播放設定、磨損與「裝上時套用…」整列搬過去（同一組元件，所以值與變數一定一致），
// 關掉播放器時放回原位。原位留一個註解節點當記號。
let sideMoved=[];
function movePlaySettings(side){
  if(side&&sideMoved.length) return;
  if(!side){ if(!sideMoved.length) return; const box=sideMoved[0][0].closest('.pv-side');
    for(const [el,mark] of sideMoved) mark.replaceWith(el); sideMoved=[]; if(box) box.innerHTML=''; placeRec(); updateWhen(); return; }
  const take=(title,els)=>{ els=els.filter(Boolean); if(!els.length) return; const h=document.createElement('div'); h.className='pv-sideh'; h.textContent=title; side.appendChild(h);
    for(const el of els){ const mark=document.createComment('pv'); el.replaceWith(mark); side.appendChild(el); sideMoved.push([el,mark]); } };
  const rows=det=>det?[...det.children].filter(r=>r.classList.contains('row')&&!r.classList.contains('resetRow')&&r.dataset.m!=='rec'):[];
  const sec=t=>[...document.querySelectorAll('#panel>details')].find(d=>d.querySelector('summary').textContent.startsWith(t));
  take('音量',[document.querySelector('.volbox')]);
  take('播放設定',rows(sec('錄放設定')));
  take('磨損',rows(sec('磨損')));
  take('蠟筒架',[document.querySelector('input[data-ck="applyRec"]')?.closest('.row')]);
  updateWhen();
}
platform.onCommand?.(c=>{ if(c==='toggle-play') $('bPlay').click(); else if(c==='stop') $('bStop').click(); });

// 點擊蠟筒移動唱頭
const ray=new THREE.Raycaster(), pDown=new THREE.Vector2();
renderer.domElement.addEventListener('pointerdown',e=>pDown.set(e.clientX,e.clientY));
// 鏡頭模式：一般視角 / 蠟筒架視角。點蠟筒架先把鏡頭帶過去，在那裡點蠟筒才換裝；點留聲機回到原視角。
let camMode='home', camPrev=null;
function shelfView(){ const tgt=new THREE.Vector3(9,6.2,2).applyMatrix4(shelf.matrixWorld), front=new THREE.Vector3(Math.sin(shelf.rotation.y),0,Math.cos(shelf.rotation.y));
  return {pos:tgt.clone().addScaledVector(front,58).add(new THREE.Vector3(-4,22,0)),tgt}; }
function shelfFlip(d){ const pages=shelf.userData.pages||1; if(pages<2) return; shelfPage=(shelfPage+d+pages)%pages; shelfSig=''; updateShelf(); toast(`蠟筒架第 ${shelfPage+1}／${pages} 排`); }
function goShelf(){ $('backBtn').classList.add('on'); setTimeout(()=>{ $('shelfPager').classList.toggle('on',(shelf.userData.pages||1)>1); },0); if(camMode!=='shelf') camPrev={pos:camera.position.clone(),tgt:controls.target.clone()}; const v=shelfView(); flyTo(v.pos,v.tgt); camMode='shelf';
  toast(SLOTS.some(s=>s.g.visible)?'點選想裝上的蠟筒；點留聲機或上方按鈕回到原本的視角':'蠟筒架上目前沒有其他蠟筒'); }
function goBack(){ $('backBtn').classList.remove('on'); $('shelfPager').classList.remove('on'); const v=camPrev||HOME; flyTo(v.pos.clone(),v.tgt.clone()); camMode='home'; camPrev=null; }
function ancestorOf(o,root){ for(let x=o;x;x=x.parent) if(x===root) return true; return false; }
function pickAt(cx,cy){
  ray.setFromCamera(new THREE.Vector2(cx/innerWidth*2-1,-(cy/innerHeight)*2+1),camera);
  const hit=ray.intersectObjects([shelf,machine],true).find(h=>h.object.visible&&h.object.isMesh);
  if(!hit) return null;
  if(ancestorOf(hit.object,shelf)) return {kind:'shelf',slot:hit.object.userData.slot,arrow:hit.object.userData.arrow,hit};
  return {kind:'machine',wax:hit.object===waxMesh,hit};
}
$('backBtn').onclick=()=>goBack();
$('spPrev').onclick=()=>shelfFlip(-1); $('spNext').onclick=()=>shelfFlip(1);
$('bClearOv').onclick=()=>clearGroupOverride();
renderer.domElement.addEventListener('pointerup',e=>{
  if(Math.hypot(e.clientX-pDown.x,e.clientY-pDown.y)>4) return;
  const pk=pickAt(e.clientX,e.clientY); if(!pk) return;
  if(pk.kind==='shelf'){
    if(camMode!=='shelf'){ goShelf(); return; }
    if(pk.arrow){ shelfFlip(pk.arrow); return; }
    const sl=pk.slot!=null?SLOTS[pk.slot]:null;
    if(sl&&sl.id!=null){ if(!node){ toast('請先開啟留聲機'); return; } const en=rackEntry(sl.id); mount(sl.id).then(()=>toast(`已裝上「${groupName(en.group)}・${cylName(en)}」；點留聲機回到原本的視角`)); }
    return; }
  // 點到留聲機
  if(camMode==='shelf'){ goBack(); return; }
  if(pk.wax&&node&&pk.hit.uv){ const a=(pk.hit.uv.y-V0)/(V1-V0); if(a<0||a>1) return; seekTo(Math.min(T*N-1,a*T*N)); toast('唱頭已移動'); }
});
// 可點選的地方顯示手指游標
let hoverT=0;
renderer.domElement.addEventListener('pointermove',e=>{
  if(e.buttons){ renderer.domElement.style.cursor=''; return; }
  const now=performance.now(); if(now-hoverT<60) return; hoverT=now;
  const pk=pickAt(e.clientX,e.clientY); let c='';
  if(pk){ if(pk.kind==='shelf') c=(camMode!=='shelf'||(pk.slot!=null&&SLOTS[pk.slot].id!=null))?'pointer':'';
    else if(camMode==='shelf') c='pointer';
    if(pk.kind==='shelf'&&pk.arrow) c='pointer';
    else if(pk.wax&&node){ const a=(pk.hit.uv.y-V0)/(V1-V0); if(a>=0&&a<=1) c='pointer'; } }
  renderer.domElement.style.cursor=c;
});
renderer.domElement.addEventListener('pointerleave',()=>{ renderer.domElement.style.cursor=''; });

let fly=null;
function flyTo(pos,tgt){ fly={p0:camera.position.clone(),t0:controls.target.clone(),p1:pos,t1:tgt,k:0}; }

// ---------------- 輪播模式 ----------------
// 每個鏡頭從 p0 緩慢推到 p1，看著 t；函式形式的會跟著唱頭（carriage）移動。name／text 是字卡，when 不成立時跳過
const rpX=()=>carriage.position.x, shelfAt=k=>{ const v=shelfView(); return v.pos.clone().lerp(v.tgt,k).toArray(); };
const TOUR=[
  {p0:[40,28,50],p1:[24,22,56],t:[0,11,-2],name:'蠟筒留聲機',
   text:'發條馬達帶動蠟筒旋轉，唱頭沿著螺桿緩緩橫移：錄音時把聲音刻進蠟裡，播放時再從溝槽讀回來。'},
  {p0:()=>[rpX()+18,CY+10,19],p1:()=>[rpX()+11,CY+7,17],t:()=>[rpX(),CY+2.5,0],name:'蠟筒與唱頭',
   text:'聲音就是溝底的深淺起伏。唱頭裡的藍寶石球針沿著溝槽滑動，把起伏推成振膜的振動。'},
  {p0:()=>[rpX()-24,34,30],p1:()=>[rpX()-16,38,26],t:()=>[rpX(),26,0],name:'喇叭',
   text:'振膜的振動很微弱，喇叭把它和空氣耦合起來、放大成整個房間都聽得到的聲音；錄音時則反過來，把聲音集中到振膜上。'},
  {p0:()=>[rpX()-12,36,-46],p1:()=>[rpX()+10,34,-44],t:()=>[rpX(),20,-12],name:'喇叭口',
   text:'喇叭口逐漸張開，讓聲波順利傳進空氣。它對中頻最有效、低頻較弱，形成蠟筒錄音特有的明亮音色。'},
  {p0:[24,17,10],p1:[21,14,4],t:[11.6,10.5,-5.2],name:'調速器',
   text:'飛球隨轉速向外張開，轉太快時就產生摩擦煞車，讓發條馬達穩定在每分鐘約 160 轉。'},
  {p0:[-28,16,14],p1:[-22,13,8],t:[0,CY,-1],name:'進給螺桿',
   text:'螺桿和蠟筒同步旋轉，帶著唱頭每轉前進一個圈距（棕蠟約 0.25 mm），溝槽因此排成一圈圈的螺旋。'},
  {p0:[-4,10,36],p1:[14,11,34],t:[6,5,8],name:'機箱與曲柄',
   text:'機箱裡是發條馬達，側邊的曲柄用來上緊發條。在設定裡也可以改成手搖驅動，直接用曲柄轉動蠟筒。'},
  {p0:[-6,46,16],p1:[6,48,10],t:[0,9,-1],name:'俯瞰',
   text:'蠟筒、主軸、螺桿、唱頭架與調速器都裝在同一塊鋼板上，由同一個馬達驅動。'},
  {p0:()=>shelfAt(0),p1:()=>shelfAt(0.12),t:()=>shelfView().tgt.toArray(),when:()=>rack.length>1,name:'蠟筒架',
   text:'架上的蠟筒依序播放，同一組會無縫接續；輪播時播完最後一支就回到第一支。'},
];
const SHOT=9, BLEND=2.6;   // 每個鏡頭秒數、換鏡頭的過渡秒數
function tourStep(dt){
  tour.t+=dt;
  if(tour.t>=SHOT){ do tour.i=(tour.i+1)%TOUR.length; while(TOUR[tour.i].when&&!TOUR[tour.i].when());
    tour.t=0; tour.fp=camera.position.clone(); tour.ft=controls.target.clone(); }
  const sh=TOUR[tour.i], cap=$('tourCap');
  if(cap.dataset.i!==String(tour.i)){ cap.dataset.i=tour.i; cap.querySelector('b').textContent=sh.name; cap.querySelector('p').textContent=sh.text; }
  cap.classList.toggle('on',tour.t>0.8&&tour.t<SHOT-1);   // 字卡在鏡頭開始後淡入、換鏡頭前淡出
  const v=a=>new THREE.Vector3(...(typeof a==='function'?a():a));
  const p=v(sh.p0).lerp(v(sh.p1),tour.t/SHOT), tg=v(sh.t), k=Math.min(1,tour.t/BLEND), e=k*k*(3-2*k);
  camera.position.lerpVectors(tour.fp,p,e); controls.target.lerpVectors(tour.ft,tg,e);
}
async function startCarousel(){
  if(!node){ toast('請先開啟留聲機'); return; }
  const list=rack.filter(e=>e.used>0); if(!list.length){ toast('蠟筒架上還沒有錄音，無法輪播'); return; }
  carousel=true; document.body.classList.add('carousel'); $('bTour').classList.add('on');
  fly=null; camMode='home'; camPrev=null; controls.enabled=false;
  tour={i:0,t:0,fp:camera.position.clone(),ft:controls.target.clone()}; $('tourCap').dataset.i=''; frameView();
  const ae=rackEntry(activeId);
  if(mode==='play'&&ae&&ae.used>0) prepareNext();                 // 已經在播：接著播，播完繞回第一支
  else await mount((ae&&ae.used>0?ae:list[0]).id,{play:true});
  toast(U.quality==='off'?'輪播中（3D 已關閉，不會運鏡）：按 Esc 或 ■ 結束':'輪播中：按 Esc、■ 或再按一次輪播鍵結束');
}
function stopCarousel(){
  if(!carousel) return; carousel=false; tour=null; $('tourCap').classList.remove('on');
  document.body.classList.remove('carousel'); $('bTour').classList.remove('on'); controls.enabled=true;
  layoutDock(); flyTo(HOME.pos.clone(),HOME.tgt.clone()); if(mode==='play') prepareNext();
}
function carouselNext(){   // 沒有預先接好的下一支（例如架上只有一支）：裝上下一支有錄音的，最後繞回第一支
  if(!carousel) return; const i=rackIndex(activeId);
  const e=rack.slice(i+1).find(x=>x.used>0)||rack.slice(0,i+1).find(x=>x.used>0);
  if(e) mount(e.id,{play:true}); else stopCarousel();
}

addEventListener('resize',()=>{ placeRec(); renderer.setPixelRatio(Math.min(2,devicePixelRatio)*parseFloat(U.res)); renderer.setSize(innerWidth,innerHeight); frameView(); });

// ---------------- 主迴圈 ----------------
let last=performance.now(), uiT=0, pLP=-22, govA=0, lastRender=0, fpsN=0, fpsT=0;
const STATE_TXT={idle:'靜止',record:'刻錄中',play:'播放中'};
function frame(now){
  requestAnimationFrame(frame);
  const dt=Math.min(0.05,(now-last)/1000); last=now;
  if(st){ const est=Math.max(0,Math.min(T*N-1,st.s+st.w*N*(now-stTime)/1000)); if(Math.abs(est-dispS)>N*0.5) dispS=est; else dispS+=(est-dispS)*Math.min(1,dt*25); }
  const w=st?st.w:0;
  cylGroup.rotation.x=-2*Math.PI*dispS/N;
  feedScrew.rotation.x=cylGroup.rotation.x;
  carriage.position.x=XS+(dispS/N)/T*(XE-XS);
  if(st){
    const active=st.reading||st.mode==='record';
    pLP+=((st.p||0)-pLP)*Math.min(1,dt*4);
    const bob=st.reading?Math.max(-0.25,Math.min(0.25,(st.p-pLP)*0.008)):0;
    const lift=(1-st.hg)*0.5;
    repro.position.y=REPRO_Y+lift+bob+(st.mode==='record'?(-st.c+22)*-0.002:0);
    const recHead=st.mode==='record'||mode==='record';   // 錄音時換成刻刀
    stylusBall.visible=!recHead; cutterTip.visible=recHead;
    cutterTip.userData.mat.emissive.setHex(st.ov?0x8a1c10:0x000000);
    stylusBall.material.emissive.setHex(st.air?0xff3010:0x000000);
    ring.material.emissive.setHex(st.mode==='record'?0x8a1c10:st.reading?0x5a4010:0x000000);
    // 蠟屑
    if(U.particles&&st.mode==='record'&&st.hg>0.5&&Math.abs(w)>0.02){ chipAcc+=Math.abs(w)*60*dt;
      while(chipAcc>1){ chipAcc--; const i=chipIdx++%CHIPS; chipPos[i*3]=carriage.position.x+(Math.random()-.5)*0.1; chipPos[i*3+1]=CY+RW+0.02; chipPos[i*3+2]=0.05;
        chipVel[i*3]=(Math.random()-.5)*1.2; chipVel[i*3+1]=1.2+Math.random()*1.5; chipVel[i*3+2]=(w>0?1:-1)*(2+Math.random()*2); chipLife[i]=2.5; } }
    void active;
  }
  for(let i=0;i<CHIPS;i++){ if(chipLife[i]<=0) continue; chipLife[i]-=dt; chipVel[i*3+1]-=9.8*dt;
    chipPos[i*3]+=chipVel[i*3]*dt; chipPos[i*3+1]+=chipVel[i*3+1]*dt; chipPos[i*3+2]+=chipVel[i*3+2]*dt;
    if(chipPos[i*3+1]<7.5&&Math.abs(chipPos[i*3])<15&&Math.abs(chipPos[i*3+2])<8.7){ chipPos[i*3+1]=7.5; chipVel[i*3]*=0.3; chipVel[i*3+1]=0; chipVel[i*3+2]*=0.3; }
    if(chipLife[i]<=0) chipPos[i*3+1]=-100; }
  chipGeo.attributes.position.needsUpdate=true;
  govA+=w*2*Math.PI*dt*1.5; govSpin.rotation.y=govA;
  const spread=0.25+0.95*Math.min(1,Math.abs(w)/(NOM/60)); for(const a of govArms) a.rotation.x=0; govArms[0].rotation.z=spread; govArms[1].rotation.z=spread;
  if(pm('drive')==='crank'){
    const wheelOn=now-crank.wheelT<220; if(!wheelOn) crank.wheelW*=0.7;
    if(node&&ctx){ if(crank.active&&now-crank.lastT>90) crank.w*=0.8;
      const act=crank.active||wheelOn, cw=crank.active?crank.w:crank.wheelW;
      node.port.postMessage({type:'crank',w:cw,active:act}); crank.shown=act?cw:0; }
    crank3.rotation.x=-crank.angle; drawCrankPad();
  }
  if(fileBuffer&&U.src==='file'&&(filePlayhead()||now-(FC.lastDraw||0)>500)){ FC.lastDraw=now; drawFileWave(); if(now-(FC.lastSync||0)>500){ FC.lastSync=now; if(document.activeElement?.tagName!=='INPUT') syncFileUI(); } }
  if(U.src!=='file'&&inAn){ const rc=$('recScope'); if(rc&&rc.offsetParent){ const dpr=Math.min(2,devicePixelRatio||1), w=rc.clientWidth, h=rc.clientHeight; if(rc.width!==Math.round(w*dpr)){ rc.width=Math.round(w*dpr); rc.height=Math.round(h*dpr); }
    const g=rc.getContext('2d'); g.setTransform(dpr,0,0,dpr,0,0); g.clearRect(0,0,w,h); inAn.getFloatTimeDomainData(scopeBuf);
    g.strokeStyle='rgba(236,213,156,.2)'; g.beginPath(); g.moveTo(0,h/2); g.lineTo(w,h/2); g.stroke();
    g.beginPath(); for(let i=0;i<scopeBuf.length;i++){ const x=i/(scopeBuf.length-1)*w, y=h/2-scopeBuf[i]*h*0.45; i?g.lineTo(x,y):g.moveTo(x,y); } g.strokeStyle='#e0907a'; g.lineWidth=1; g.stroke(); } }
  if(st){ const dm=$('dockMeter'); if(dm) dm.style.width=Math.min(100,st.lvl*100)+'%'; }
  if(texDirty&&now-lastTexUp>50){ grooveTex.needsUpdate=true; texDirty=false; lastTexUp=now; }
  if(tour) tourStep(dt);
  if(fly){ fly.k=Math.min(1,fly.k+dt*1.4); const e=fly.k<.5?2*fly.k*fly.k:1-Math.pow(-2*fly.k+2,2)/2; camera.position.lerpVectors(fly.p0,fly.p1,e); controls.target.lerpVectors(fly.t0,fly.t1,e); if(fly.k>=1) fly=null; }
  if(rays.visible){ const tt=now/1000; for(let i=0;i<MOTES;i++){ const sd=moteSeed[i]; motePos[i*3]+=Math.sin(tt*0.3+sd)*0.01; motePos[i*3+1]+=Math.cos(tt*0.23+sd*1.7)*0.008-0.002; motePos[i*3+2]+=Math.sin(tt*0.17+sd*0.7)*0.01; } moteGeo.attributes.position.needsUpdate=true; }
  if(has3D&&!playerMode&&U.quality!=='off'&&now-lastRender>=1000/parseInt(U.fpsCap)-3){ lastRender=now; controls.update(); renderer.render(scene,camera); fpsN++; }
  if(now-fpsT>1000){ const pi=$('perfInfo'); if(pi) pi.textContent=U.quality==='off'?'3D 已關閉，聲音與剖面照常運作。':`畫面 ${fpsN} fps · 解析度 ${renderer.domElement.width}×${renderer.domElement.height} · 設定會記在這台電腦上`; fpsN=0; fpsT=now; }
  drawMag(); drawDepthWin(now);
  if(now-uiT>90){ uiT=now; updateUI(); }
}
function mmss(t){ t=Math.round(t*10)/10; const m=Math.floor(t/60), s=t-m*60; return `${String(m).padStart(2,'0')}:${s.toFixed(1).padStart(4,'0')}`; }
function updateUI(){
  const pos=dispS/N/(NOM/60), tot=T*60/NOM, turn=Math.floor(dispS/N);
  const m=st?st.mode:'idle', spinning=st&&Math.abs(st.w)>0.005;
  let s=STATE_TXT[m]||'靜止'; if(m!=='idle'&&st&&!st.head) s=pm('drive')==='crank'?'請搖動曲柄':'轉速上升中…'; if(m==='idle'&&spinning) s='慣性滑行';
  if(st&&st.air&&st.reading) s='唱針離面！';
  const rr=Math.max(1,pm('rpm')), posR=dispS/N/(rr/60), totR=T*60/rr;   // 大字：以目前設定的轉速（錄音中用錄音轉速）換算的實際時間；小字：原始（名目 160 rpm）時間
  $('clock').innerHTML=`${mmss(posR)} / ${mmss(totR)}<small>原始 ${mmss(pos)} / ${mmss(tot)} · 第 ${turn} 圈 · ${s}</small>`;
  const ae=rackEntry(activeId);
  if(ae){ const mem=rack.filter(x=>x.group===ae.group), i=mem.indexOf(ae), gn=groupName(ae.group), cn=cylName(ae);
    $('trkG').textContent=gn; $('trkC').textContent=cn; $('trkName').title=`${gn} · ${cn}`;
    let g;
    if(mem.length>1){ // 整組時間：前面幾支的音訊長度加上這支目前的位置（同樣用錄音轉速換算）
      const before=mem.slice(0,i).reduce((a,e)=>a+cylSecs(e),0), cur=Math.min(dispS/N/((recRpm(ae)||P.rpm)/60),cylSecs(ae));
      g=`整組 ${fmtDur(before+cur)} / ${fmtDur(before+mem.slice(i).reduce((a,e)=>a+cylSecs(e),0))} · ${i+1}/${mem.length}`; }   // 不顯示小數，避免擠到右邊的時間
    else g=ae.used>0?`音訊 ${fmtDur(cylSecs(ae))}`:'空白蠟筒';
    $('trkGrp').textContent=g; }
  if(!seeking) seekEl.value=Math.round(dispS/(T*N-1)*1000);
  $('bRec').classList.toggle('on',m==='record'); $('bPlay').classList.toggle('on',m==='play');
  if(m==='idle'&&mode!=='idle'&&modeAck&&st&&!st.head) mode=m;   // 剛送出錄音／播放、worklet 還沒回報新模式前，舊的 idle 狀態不算（主執行緒忙時會先跑到這裡）
  if(st){
    const rpm=st.w*60; $('magRo').textContent=`${rpm.toFixed(1)} rpm · 線速 ${(st.w*CIRC/1000).toFixed(0)} mm/s · `+(st.mode==='record'?`刻深 ${st.c.toFixed(1)} µm`:`針位 ${st.p.toFixed(1)} µm`)+` · 垂直×${U.exag}`;
    const mb=$('meterBar'); if(mb) mb.style.width=Math.min(100,st.lvl*100)+'%';
    const ov=$('ovLamp'); if(ov) ov.classList.toggle('hot',!!st.ov);
    const cr=$('crankRo'); if(cr) cr.textContent=`曲柄 ${((crank.shown||0)*60).toFixed(0)} rpm × ${pm('ratio')} → 蠟筒 ${rpm.toFixed(0)} rpm`+(pm('crankGov')?`（上限 ${pm('rpm')}）`:'');
  }
  if(hasContent&&Math.random()<0.1){ updateCylInfo(); if(mode==='record') renderRack(); }
}
requestAnimationFrame(frame);
