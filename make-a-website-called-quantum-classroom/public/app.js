(function(){
const stars=document.getElementById('stars');if(stars){for(let i=0;i<140;i++){const s=document.createElement('span');s.className='s';s.style.left=Math.random()*100+'%';s.style.top=Math.random()*100+'%';s.style.opacity=(.3+Math.random()*.7).toFixed(2);stars.appendChild(s)}}
const page=document.body.dataset.page;document.querySelectorAll('[data-page]').forEach(a=>{if(a.dataset.page===page)a.classList.add('on')});
const aletia=q=>`https://ed.aletiatours.com/?q=${encodeURIComponent(q)}`;
function openAletia(q){window.open(aletia(q),'_blank','noopener,noreferrer')}
const g=document.getElementById('gateway-form');if(g){g.addEventListener('submit',e=>{e.preventDefault();const q=document.getElementById('gateway-query').value.trim();const s=document.getElementById('gateway-scope').value;const scoped=s==='all'?q:`site:${s} ${q}`;if(scoped)openAletia(scoped);});}
function bindSearch(formId,inputId,domain){const f=document.getElementById(formId);if(!f)return;f.addEventListener('submit',e=>{e.preventDefault();const q=document.getElementById(inputId).value.trim();if(q)openAletia(`site:${domain} ${q}`)});} 
bindSearch('movie-search-form','movie-query','cinegram.net');bindSearch('game-search-form','game-query','poki.com');bindSearch('music-search-form','music-query','playlistsound.com');
const af=document.getElementById('ai-form');if(af){const t=document.getElementById('ai-thread');const key=document.getElementById('ai-key');
function add(who,msg){const d=document.createElement('div');d.className='card';d.innerHTML=`<b>${who}</b><div class="small">${msg}</div>`;t.appendChild(d)}
af.addEventListener('submit',async e=>{e.preventDefault();const input=document.getElementById('ai-input');const model=document.getElementById('ai-model').value;const m=input.value.trim();if(!m)return;add('You',m);input.value='';const r=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json','x-openai-key':(key.value||'').trim()},body:JSON.stringify({model,message:m})});const j=await r.json();add('Quantum AI',j.reply||j.error||'No response');});}
})();
