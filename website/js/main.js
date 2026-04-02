// NAV SCROLL
window.addEventListener('scroll',()=>{
  const nav=document.getElementById('nav');
  if(nav)nav.classList.toggle('scrolled',window.scrollY>40);
});

// TERMINAL ANIMATION (home page only)
const scene=document.getElementById('tscene');
if(scene){
  const NYX_HDR=`<div style="display:flex;gap:1rem;margin-bottom:.7rem;padding-bottom:.7rem;border-bottom:1px solid var(--border-subtle)">
    <div style="white-space:pre;line-height:1.3;color:var(--text-secondary);font-size:.8rem;flex-shrink:0"> /\\_/\\ \n( ·.· )\n > ♥ < </div>
    <div style="display:flex;flex-direction:column;justify-content:center;gap:.05rem;font-size:.68rem">
      <span><span style="color:var(--text);font-weight:600">Localcode</span> <span style="color:#444">v4.0.0 · @localcode/cli</span></span>
      <span><span style="color:#444">provider  </span><span style="color:var(--text)">ollama</span><span style="color:#444">  qwen2.5-coder:7b</span></span>
      <span><span style="color:#444">cwd       </span><span style="color:#888">~/projects/api</span></span>
      <span><span style="color:#444">memory    </span><span style="color:var(--text)">.localcode.md</span><span style="color:#444"> loaded</span></span>
    </div>
  </div>`;

  const FRAMES=[
    [0,NYX_HDR],
    [200,`<div class="trow"><span class="tg">❯ </span><span class="tw" id="tw1"></span><span class="cursor" id="tc1"></span></div>`],
    [300,null,'tw1','review src/routes/auth.ts',38,'tc1'],
    [1400,`<div class="trow"><span class="tg">◈ </span><span class="tg">Reading </span><span class="tw">src/routes/auth.ts</span><span class="tg"> (198 lines)</span></div>`],
    [2000,`<div class="trow"><span class="tg">⟳ </span><span class="tl">read_file</span><span class="tg">  path='src/routes/auth.ts'</span></div>`],
    [2700,`<div class="trow" style="margin-top:.2rem"><span class="td">⚠ </span><span class="tw">[HIGH] SQL injection risk on line 48</span></div>`],
    [3000,`<div class="trow"><span class="td">⚠ </span><span class="tw">[MED]  No rate limiting on /login</span></div>`],
    [3300,`<div class="trow"><span class="tg">  </span><span class="tg">[LOW]  Unused import: bcryptjs</span></div>`],
    [3800,`<div class="trow" style="margin-top:.3rem"><span class="tg">❯ </span><span class="tw" id="tw2"></span><span class="cursor" id="tc2"></span></div>`],
    [4000,null,'tw2','/provider claude',38,'tc2'],
    [4900,`<div class="trow"><span class="tg">✓ </span><span class="tg">Switched to </span><span class="tw">claude-sonnet-4-5</span></div>`],
    [5400,`<div class="trow" style="margin-top:.3rem"><span class="tg">❯ </span><span class="tw" id="tw3"></span><span class="cursor" id="tc3"></span></div>`],
    [5600,null,'tw3','/commit',38,'tc3'],
    [6300,`<div class="trow"><span class="tg">⟳ </span><span class="tg">Generating commit from staged diff…</span></div>`],
    [7200,`<div class="trow"><span class="tw">✓ fix(auth): sanitize inputs + add rate limiting</span></div>`],
    [7600,`<div class="trow"><span class="tg" style="font-size:.64rem">  Co-authored-by: Nyx &lt;nyx@thealxlabs.ca&gt;</span></div>`],
    [8300,`<div class="trow" style="margin-top:.3rem"><span class="tg">❯ </span><span class="cursor"></span></div>`],
  ];

  let timeouts=[];
  function clearAnim(){timeouts.forEach(clearTimeout);timeouts=[];}

  function typeText(elId,text,msPerChar,cursorId){
    return new Promise(res=>{
      const el=document.getElementById(elId);
      if(!el){res();return;}
      const cur=cursorId?document.getElementById(cursorId):null;
      let i=0;
      function tick(){
        if(!el){res();return;}
        el.textContent=text.slice(0,i);
        i++;
        if(i<=text.length){timeouts.push(setTimeout(tick,msPerChar));}
        else{if(cur)cur.remove();res();}
      }
      tick();
    });
  }

  function playTerminal(){
    clearAnim();
    scene.innerHTML='';
    FRAMES.forEach(([delay,html,twId,twText,twSpeed,tcId])=>{
      const t=setTimeout(async()=>{
        if(html){scene.insertAdjacentHTML('beforeend',html);scene.scrollTop=scene.scrollHeight;}
        if(twId&&twText){await typeText(twId,twText,twSpeed||38,tcId);scene.scrollTop=scene.scrollHeight;}
      },delay);
      timeouts.push(t);
    });
  }

  const replayBtn=document.getElementById('replay-btn');
  if(replayBtn)replayBtn.addEventListener('click',playTerminal);
  playTerminal();
}

// PLATFORM TABS
document.querySelectorAll('.platform-tab').forEach(tab=>{
  tab.addEventListener('click',()=>{
    const parent=tab.closest('.platforms-detail')||tab.closest('.container');
    if(!parent)return;
    parent.querySelectorAll('.platform-tab').forEach(t=>t.classList.remove('active'));
    parent.querySelectorAll('.platform-panel').forEach(p=>p.classList.remove('active'));
    tab.classList.add('active');
    const panel=document.getElementById('pp-'+tab.dataset.tab);
    if(panel)panel.classList.add('active');
  });
});

// SCROLL REVEAL
const ro=new IntersectionObserver(entries=>{
  entries.forEach(e=>{
    if(!e.isIntersecting)return;
    e.target.classList.add('vis');
  });
},{threshold:0.06});
document.querySelectorAll('.reveal').forEach(el=>ro.observe(el));

// COPY
function cp(btn,text){
  navigator.clipboard.writeText(text).then(()=>{
    const orig=btn.textContent;
    btn.textContent='copied';
    btn.classList.add('ok');
    setTimeout(()=>{btn.textContent=orig;btn.classList.remove('ok');},1800);
  });
}
