const N = 18000;            // 每圈格數（空間取樣）
const CIRC = 174700;        // 蠟筒周長 µm（直徑 55.6 mm）
const DX = CIRC / N;        // 每格長度 µm ≈ 9.7
const PITCH = 254;          // 圈距 µm（每吋 100 圈）
const TEXW = 2048;          // 視覺貼圖每圈欄數

function hash(i){ i|=0; i=Math.imul(i^(i>>>16),0x7feb352d); i=Math.imul(i^(i>>>15),0x846ca68b); i^=i>>>16; return (i>>>0)/4294967296; }

class Biquad{
  constructor(){ this.b0=1;this.b1=0;this.b2=0;this.a1=0;this.a2=0;this.z1=0;this.z2=0; }
  set(type,f,Q,g,fs){
    const w=2*Math.PI*Math.min(f,fs*0.45)/fs, cs=Math.cos(w), sn=Math.sin(w), al=sn/(2*Q), A=Math.pow(10,(g||0)/40);
    let b0,b1,b2,a0,a1,a2;
    if(type==='lp'){b0=(1-cs)/2;b1=1-cs;b2=b0;a0=1+al;a1=-2*cs;a2=1-al;}
    else if(type==='hp'){b0=(1+cs)/2;b1=-(1+cs);b2=b0;a0=1+al;a1=-2*cs;a2=1-al;}
    else {b0=1+al*A;b1=-2*cs;b2=1-al*A;a0=1+al/A;a1=-2*cs;a2=1-al/A;}
    this.b0=b0/a0;this.b1=b1/a0;this.b2=b2/a0;this.a1=a1/a0;this.a2=a2/a0; return this;
  }
  run(x){ const y=this.b0*x+this.z1; this.z1=this.b1*x-this.a1*y+this.z2; this.z2=this.b2*x-this.a2*y; return y; }
}
function makeChain(fs,spec){ return spec.map(s=>new Biquad().set(s[0],s[1],s[2],s[3],fs)); }
function runChain(c,x){ for(let i=0;i<c.length;i++) x=c[i].run(x); return x; }

class Phono extends AudioWorkletProcessor{
  constructor(options){
    super();
    const o=(options&&options.processorOptions)||{};
    this.sr=sampleRate; this.dt=1/sampleRate;
    this.P={inGain:20,baseDepth:22,monitor:false,drive:'motor',rpm:160,
      rDrive:'motor',rRpm:160,rRatio:2,rCrankGov:true,rHorn:true,rFlutter:false,rFlutterAmt:0.4,ratio:2,crankGov:true,autoLift:true,overdub:'carve',waxWear:4,waxGrain:0.6,waxCutLP:8000,pitch:254,tipOn:true,stylusR:150,mistrack:true,trackAccel:2500,
      horn:true,volume:0.7,wearOn:false,wearRate:0.05,crosstalk:true,cutterR:160,ecc:true,eccMm:0.25,flutter:true,flutterAmt:0.4,
      dust:true,dustPct:0.15,scratch:true,crack:true,mold:true,moldAmt:1.5,scratches:[],crackA0:0,crackSlope:0};
    Object.assign(this.P,o.params||{});
    this.T=o.T||160; this.L=this.T*N;
    this.z=o.z||new Float32Array(this.L);       // 刻痕高度（µm，負值＝切入深度）
    this.wear=o.wear||new Float32Array(this.L); // 磨損量（µm，向下）
    this.s=o.startS||0; this.omega=0; this.next=null; this.curId=1; this.playEnd=null; this.mode='idle'; this.motorOn=false; this.head=false; this.hg=0; this.reading=false;
    this.p=0; this.v=0; this.air=false; this.hPrev=0; this.ai=0; this.sInit=false; this.srLast=0;
    this.cPrev=0; this.crankW=0; this.crankOn=false; this.ph1=0; this.ph2=1.7; this.lp1=0; this.lp2=0;
    this.ck=new Int32Array(4096).fill(-1); this.cv=new Float32Array(4096);
    this.dLo=1e15; this.dHi=-1; this.blk=0; this.lvl=0; this.ovHold=0; this.fullPos=-1;
    const fs=this.sr;
    this.rec=makeChain(fs,[['hp',180,.7],['pk',900,1,3],['pk',2400,2.2,6],['lp',4200,.8]]);
    this.ply=makeChain(fs,[['hp',140,.7],['pk',1100,1.2,3],['pk',2800,2.5,5],['lp',5200,.7]]);
    this.cutLP=new Biquad().set('lp',this.P.waxCutLP,0.7,0,fs);   // 蠟越硬，刻刀越難切出高頻
    const dt=this.dt;
    this.kMotor=1-Math.exp(-dt/0.35); this.kCoast=1-Math.exp(-dt/0.9); this.kCrank=1-Math.exp(-dt/0.12); this.kFly=Math.exp(-dt/3.5);
    this.kHead=1-Math.exp(-dt/0.008); this.kDC=1-Math.exp(-2*Math.PI*18*dt);
    this.offline=!!o.offline; this.endS=o.endS||(this.L-1);
    if(this.offline){ this.mode='play'; this.motorOn=true; this.omega=this.P.rpm/60; this.head=true; this.hg=1; }
    // 快速刻錄：離線環境中把整段音檔刻上去，刻滿一支就自己換新的一支
    this.offRec=!!o.offRec; this.recFrames=o.recFrames||0; this.offIdx=0; this.offDone=false;
    if(this.offRec){ this.mode='record'; this.omega=this.P.rRpm/60; this.cPrev=0; this.sPrev=0; this.lastMix=-1; }
    this.port.onmessage=e=>this.msg(e.data);
  }

  msg(m){
    switch(m.type){
      case 'params': Object.assign(this.P,m.params); this.ck.fill(-1); if('waxCutLP' in m.params) this.cutLP.set('lp',this.P.waxCutLP,0.7,0,this.sr); break;
      case 'record': case 'play': this.lastMix=-1; this.sPrev=0;
        if(this.mode!==m.type){ this.mode=m.type; this.head=false; }
        this.motorOn=true; break;
      case 'stop': this.mode='idle'; this.head=false; this.motorOn=false; this.stopAt=0; break;
      case 'stopAt': this.stopAt=m.frame; break;
      case 'playEnd': this.playEnd=m.s; break;
      case 'seek': if(this.dHi>=0) this.flushDirty(); this.s=Math.max(0,Math.min(this.L-1,m.s)); this.head=false; this.ck.fill(-1); break;
      case 'crank': this.crankW=m.w; this.crankOn=m.active; break;
      case 'setNext': this.next={id:m.id,T:m.T,z:m.z,wear:m.wear,kind:m.kind,used:m.used}; break;
      case 'clearNext': this.next=null; break;
      case 'setCylinder':
        this.T=m.T; this.L=m.T*N; this.endS=this.L-1; this.z=m.z; this.wear=m.wear; this.s=Math.min(this.s,this.L-1);   // 終點跟著新蠟筒的容量更新
        this.mode='idle'; this.head=false; this.motorOn=false; this.ck.fill(-1); this.dLo=1e15; this.dHi=-1; this.fullPos=0; if(m.id!=null) this.curId=m.id; break;
      case 'clearWear': this.wear.fill(0); this.ck.fill(-1); this.fullPos=0; break;
      case 'snapshot': { const z=this.z.slice(), w=this.wear.slice(); this.port.postMessage({type:'snapshot',T:this.T,z,wear:w},[z.buffer,w.buffer]); break; }
      case 'fullTex': this.fullPos=0; break;
      case 'region': {   // 深度圖放大時，回傳畫面範圍內的原始解析度深度（每像素取最深）
        const {k0,k1,a0,a1,w,h,id}=m, out=new Float32Array(w*h), z=this.z, wr=this.wear, T=this.T;
        for(let px=0;px<w;px++){ const k=Math.floor(k0+(px+0.5)/w*(k1-k0)); if(k<0||k>=T) continue; const b=k*N;
          for(let py=0;py<h;py++){ const ca=Math.floor((a0+py/h*(a1-a0))*N), cb=Math.max(ca+1,Math.floor((a0+(py+1)/h*(a1-a0))*N)); let mx=0;
            for(let c=ca;c<cb;c++){ const i=b+((c%N)+N)%N, d=wr[i]-z[i]; if(d>mx) mx=d; } out[py*w+px]=mx; } }
        this.port.postMessage({type:'region',id,w,h,data:out},[out.buffer]); break; }
    }
  }

  markDirty(i){ if(i<this.dLo)this.dLo=i; if(i>this.dHi)this.dHi=i; }
  rawZ(i){ return (i<0||i>=this.L)?0:this.z[i]-this.wear[i]; }

  // 有效表面高度 = 刻痕 − 磨損 + 各種缺陷（以快取加速）
  getZ(i){
    if(i<0||i>=this.L) return 0;
    const k=i&4095; if(this.ck[k]===i) return this.cv[k];
    let v=this.z[i]-this.wear[i]; const P=this.P;
    if(P.waxGrain>0) v+=(hash(i*5+3)-0.5)*2*P.waxGrain;   // 蠟材本身的顆粒（底噪）
    if(P.mold&&P.moldAmt>0){ const patch=hash(((i/1500)|0)*7919+13)>0.55?1:0.3; v+=(hash(i*3+1)-0.5)*2*P.moldAmt*patch; }
    if(P.dust&&P.dustPct>0){ const b=i>>2; if(hash(Math.imul(b,0x9E3779B1)^0x2545F491)<P.dustPct/100){ const hh=2+9*hash(b*31+7); const q=i&3; v+=hh*((q===1||q===2)?1:0.55); } }
    if(P.scratch||P.crack){
      const t=(i/N)|0, a=i-t*N;
      if(P.scratch){ const sc=P.scratches; for(let j=0;j<sc.length;j++){ const s=sc[j]; if(t<s.k0||t>s.k1) continue;
        let d=a-(s.a0+s.slope*t); d-=Math.round(d/N)*N; const ad=Math.abs(d);
        if(ad<s.w) v-=s.depth*(1-ad/s.w); else if(ad<s.w*2.2) v+=2.5*(1-(ad-s.w)/(s.w*1.2)); } }
      if(P.crack){ let d=a-(P.crackA0+P.crackSlope*t); d-=Math.floor(d/N)*N; if(d<2) v-=35; else v+=6*(1-d/N); }
    }
    this.ck[k]=i; this.cv[k]=v; return v;
  }

  // 球形針尖與高度場的接觸：灰階膨脹，回傳針尖最低點高度
  tip(sr){
    const P=this.P;
    if(!P.tipOn){ const i=Math.floor(sr), f=sr-i; this.ai=f<0.5?i:i+1; return this.getZ(i)*(1-f)+this.getZ(i+1)*f; }
    const R=P.stylusR, R2=R*R, W=Math.ceil(R/DX)+1, c=Math.round(sr);
    let best=-1e9, bi=c;
    for(let i=c-W;i<=c+W;i++){ const d=(i-sr)*DX, q=R2-d*d; if(q<=0) continue; const hv=this.getZ(i)+Math.sqrt(q)-R; if(hv>best){best=hv;bi=i;} }
    this.ai=bi; return best;
  }

  // 溝寬超過圈距時溝壁被切穿：混入相鄰圈的高度（前／後回音）
  xtalk(sr){
    const P=this.P, i=Math.round(sr), zc=this.rawZ(i), dc=-zc; if(dc<=0) return 0;
    const Rc=P.cutterR, wc=Math.sqrt(2*Rc*dc); let acc=0;
    for(let s=-1;s<=1;s+=2){ const j=i+s*N; if(j<0||j>=this.L) continue; const zn=this.rawZ(j), dn=-zn; if(dn<=0) continue;
      const pt=P.pitch, ov=(wc+Math.sqrt(2*Rc*dn)-pt)/(0.5*pt); if(ov>0) acc+=0.45*(ov>1?1:ov)*(zn-zc); }
    return acc;
  }

  cutCell(i,c){
    if(i<0||i>=this.L) return;
    const d=this.wear[i]-this.z[i];
    if(c>d){ this.z[i]=-c; this.wear[i]=0; this.ck[i&4095]=-1; this.markDirty(i); }
  }
  // 訊號相加的疊錄：在既有刻痕上加上新的起伏（每格每次經過只加一次）
  mixRange(a,b,sa,sb,c){
    let lo=a,hi=b,slo=sa,shi=sb; if(lo>hi){ lo=b;hi=a;slo=sb;shi=sa; }
    const i0=Math.ceil(lo), i1=Math.floor(hi), span=(hi-lo)||1;
    for(let i=i0;i<=i1;i++){ if(i<0||i>=this.L||i===this.lastMix) continue; this.lastMix=i;
      const sg=slo+(shi-slo)*((i-lo)/span), d=this.wear[i]-this.z[i];
      if(d<=0.001){ this.cutCell(i,c); continue; }
      const nd=Math.max(0,Math.min(150,d+sg)); this.z[i]=-nd; this.wear[i]=0; this.ck[i&4095]=-1; this.markDirty(i); }
  }
  cutRange(a,b,ca,cb){
    let lo=a,hi=b,clo=ca,chi=cb; if(lo>hi){ lo=b;hi=a;clo=cb;chi=ca; }
    const i0=Math.ceil(lo), i1=Math.floor(hi);
    if(i0>i1){ this.cutCell(Math.round(b),cb); return; }
    const span=(hi-lo)||1;
    for(let i=i0;i<=i1;i++) this.cutCell(i, clo+(chi-clo)*((i-lo)/span));
  }
  addWear(i,a){ if(i<0||i>=this.L||!(a>0)) return; this.wear[i]+=a; this.ck[i&4095]=-1; this.markDirty(i); }

  swapCyl(){
    const n=this.next; this.next=null;
    if(n.kind==='record'&&this.L>1&&this.z[this.L-1]===0) this.z[this.L-1]=this.z[this.L-2];   // 補上最後一格
    this.port.postMessage({type:'swapped',oldId:this.curId,newId:n.id,kind:n.kind,T:this.T,z:this.z,wear:this.wear},[this.z.buffer,this.wear.buffer]);
    this.z=n.z; this.wear=n.wear; this.T=n.T; this.L=n.T*N; this.endS=this.L-1; this.curId=n.id; this.playEnd=n.used!=null?n.used:null;
    this.ck.fill(-1); this.dLo=1e15; this.dHi=-1; this.fullPos=0; this.sInit=false;
  }
  endRun(){ if(this.mode!=='idle'){ this.mode='idle'; this.head=false; this.motorOn=false; if(!this.offline) this.port.postMessage({type:'ended'}); } this.omega=0; }

  offEmit(final){
    let used=0; for(let i=this.L-1;i>=0;i--){ if(this.z[i]<-0.001){ used=i; break; } }
    this.port.postMessage({type:'offCyl',idx:this.offIdx++,T:this.T,used,final,z:this.z},[this.z.buffer]);
  }
  process(inputs,outputs){
    if(this.offRec&&this.offDone) return true;
    if(this.offRec&&currentFrame>=this.recFrames){ this.offDone=true; this.offEmit(true); return true; }
    if(this.stopAt&&currentFrame>=this.stopAt){ this.stopAt=0; if(this.mode==='record'){ this.mode='idle'; this.head=false; this.motorOn=false; this.port.postMessage({type:'ended',reason:'source'}); } }
    const out=outputs[0], L0=out[0], R0=out[1]||out[0];
    const inp=inputs[0]&&inputs[0][0];
    const P=this.P, dt=this.dt, n=L0.length, TW=2*Math.PI;
    // 驅動與抖動分成錄音、播放兩組（r 開頭的是錄音用）；靜止時沿用播放那組
    const RM=this.mode==='record', drive=RM?P.rDrive:P.drive, rpm=RM?P.rRpm:P.rpm, ratio=RM?P.rRatio:P.ratio, gov=RM?P.rCrankGov:P.crankGov,
      flut=RM?P.rFlutter:P.flutter, flutA=RM?P.rFlutterAmt:P.flutterAmt;
    if(this.mode!=='idle'&&!this.head){
      if((drive==='crank'&&Math.abs(this.omega)>0.03)||this.offline||(drive!=='crank'&&Math.abs(this.omega)>=0.97*rpm/60)){   // 曲柄：蠟筒真的轉起來才落刀
        this.head=true; this.sInit=false; this.cPrev=0;
        if(!this.offline) this.port.postMessage({type:'headDown',mode:this.mode});
      }
    }
    const eccK=(P.eccMm*1000/(CIRC/TW))*(N/TW);
    const brk=(P.pitch*P.pitch/4)/(2*P.cutterR);
    for(let k=0;k<n;k++){
      // ---- 主軸：發條馬達＋調速器，或手搖曲柄＋飛輪
      if(this.offline||drive==='motor'){
        if(this.motorOn){
          let tg=rpm/60;
          if(flut){ this.ph1+=TW*6.3*dt; this.ph2+=TW*0.83*dt; tg*=1+flutA/100*(0.65*Math.sin(this.ph1)+0.35*Math.sin(this.ph2)); }
          this.omega+=(tg-this.omega)*(this.offline?1:this.kMotor);
        } else this.omega+=(0-this.omega)*this.kCoast;
      } else {
        if(this.crankOn){ let tg=this.crankW*ratio; if(gov){ const mx=rpm/60; if(tg>mx) tg=mx; else if(tg<-mx) tg=-mx; } this.omega+=(tg-this.omega)*this.kCrank; } else this.omega*=this.kFly;
      }
      const ds=this.omega*N*dt; let s0=this.s, s1=s0+ds;
      const lim=Math.min(this.endS,this.L-1);
      // 自動抬起：播放越過最後一道刻痕約 0.3 圈後，有下一支就直接換筒，沒有就抬起唱針
      if(P.autoLift&&!this.offline&&this.mode==='play'&&this.head&&this.playEnd!=null&&s1>this.playEnd+N*0.3&&ds>0){
        if(this.next&&this.next.kind==='play'){ this.swapCyl(); s0=0; s1=0; }
        else { this.mode='idle'; this.head=false; this.motorOn=false; this.port.postMessage({type:'ended',reason:'blank'}); } }
      if(s1>=lim){ if(this.next&&!this.offline&&this.mode===this.next.kind){ this.swapCyl(); s0=0; s1=Math.min(s1-lim,1); }
        else if(this.offRec){ if(this.L>1&&this.z[this.L-1]===0) this.z[this.L-1]=this.z[this.L-2]; this.offEmit(false);
          this.z=new Float32Array(this.L); this.wear=new Float32Array(this.L); this.ck.fill(-1); s0=0; s1=Math.min(s1-lim,1); }
        else { s1=lim; this.endRun(); } } else if(s1<0){ s1=0; this.endRun(); }
      this.s=s1;
      this.hg+=((this.head?1:0)-this.hg)*this.kHead;
      const x=inp?inp[k]:0;
      let y=0;
      if(this.mode==='record'){
        const ax=x<0?-x:x; if(ax>this.lvl) this.lvl=ax;
        if(this.head||this.hg>0.001){
          const xf=this.cutLP.run(P.rHorn?runChain(this.rec,x):x);
          let c=(P.baseDepth+P.inGain*xf)*this.hg; if(c<0)c=0; else if(c>150)c=150;
          if(c>brk) this.ovHold=0.25*this.sr;
          const sg=P.inGain*xf*this.hg;
          if(P.overdub==='mix') this.mixRange(s0,s1,this.sPrev||0,sg,c); else this.cutRange(s0,s1,this.cPrev,c);
          this.cPrev=c; this.sPrev=sg;
        }
        if(P.monitor) y=x*P.volume;
      }
      if(this.mode==='play'&&this.head) this.reading=true;
      const playing=this.reading&&(this.head||this.hg>0.001)&&this.mode!=='record';
      if(!playing) this.reading=false;
      if(playing){
        const sr=P.ecc?s1+eccK*Math.sin(TW*s1/N):s1; this.srLast=sr;
        let h=this.tip(sr);
        if(P.crosstalk) h+=this.xtalk(sr);
        if(!this.sInit){ this.p=h; this.v=0; this.hPrev=h; this.lp1=h; this.lp2=h; this.air=false; this.sInit=true; }
        const vs=(h-this.hPrev)/dt;
        if(P.mistrack){
          const aMax=P.trackAccel*1e6, vf=this.v-aMax*dt, pf=this.p+vf*dt;
          if(pf<=h){
            if(this.air){ const imp=vs-vf; if(P.wearOn&&imp>0) this.addWear(this.ai,Math.min(4,imp*2e-6*P.waxWear)); }
            this.p=h; this.v=vs; this.air=false;
          } else { this.p=pf; this.v=vf; this.air=true; }
        } else { this.p=h; this.v=vs; this.air=false; }
        this.hPrev=h;
        if(P.wearOn&&!this.air&&P.wearRate>0&&this.head) this.addWear(this.ai,P.wearRate*P.waxWear*(150/Math.max(20,P.stylusR))*Math.min(1,Math.abs(ds)));
        this.lp1+=(this.p-this.lp1)*this.kDC; this.lp2+=(this.lp1-this.lp2)*this.kDC;
        let o=this.p-this.lp2;
        if(P.horn) o=runChain(this.ply,o);
        o=-o/18*P.volume;
        y+=Math.tanh(o)*this.hg;
      } else this.srLast=s1;
      L0[k]=y; if(R0!==L0) R0[k]=y;
    }
    this.blk++;
    if(this.ovHold>0) this.ovHold-=n;
    if(!this.offline){
      if(this.fullPos>=0) this.flushFull();
      if((this.blk&7)===0&&this.dHi>=0) this.flushDirty();
      if((this.blk&3)===0) this.postState();
    }
    return true;
  }

  gcol(i){ const t=(i/N)|0; return t*TEXW+Math.floor((i-t*N)*TEXW/N); }
  colVal(g){
    const t=(g/TEXW)|0, c=g-t*TEXW, b=t*N, i0=b+Math.floor(c*N/TEXW), i1=b+Math.floor((c+1)*N/TEXW);
    let m=0; const z=this.z, w=this.wear;
    for(let i=i0;i<i1;i++){ const d=w[i]-z[i]; if(d>m)m=d; }
    const v=Math.round(m*3); return v>255?255:v;
  }
  flushDirty(){
    const g0=this.gcol(Math.max(0,this.dLo)), g1=this.gcol(Math.min(this.L-1,this.dHi));
    if(g1>=g0){ const d=new Uint8Array(g1-g0+1); for(let g=g0;g<=g1;g++) d[g-g0]=this.colVal(g); this.port.postMessage({type:'tex',g0,d},[d.buffer]); }
    this.dLo=1e15; this.dHi=-1;
  }
  flushFull(){
    const tot=this.T*TEXW, g0=this.fullPos, g1=Math.min(tot,g0+16384);
    const d=new Uint8Array(g1-g0); for(let g=g0;g<g1;g++) d[g-g0]=this.colVal(g);
    this.port.postMessage({type:'tex',g0,d},[d.buffer]);
    this.fullPos=g1>=tot?-1:g1;
  }
  postState(){
    const W2=90, c=Math.round(this.s), prof=new Float32Array(2*W2+1);
    for(let j=0;j<prof.length;j++) prof[j]=this.getZ(c-W2+j);
    const cross=new Float32Array(5); for(let k=-2;k<=2;k++) cross[k+2]=this.getZ(c+k*N);
    this.port.postMessage({type:'st',s:this.s,w:this.omega,mode:this.mode,head:this.head,hg:this.hg,p:this.p,air:this.air,
      c:this.cPrev,ov:this.ovHold>0,lvl:this.lvl,off:c,ai:this.ai,sr:this.srLast,reading:this.reading,prof,cross},[prof.buffer,cross.buffer]);
    this.lvl*=0.6;
  }
}
registerProcessor('phono',Phono);
