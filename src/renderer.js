'use strict';
const $ = s => document.querySelector(s);
const api = window.glassChat;
const auth = api?.auth;
const chat = api?.chat;
const colors = ['linear-gradient(135deg,#dfb9a7,#986fbb)','linear-gradient(135deg,#8ac9bd,#5486a9)','linear-gradient(135deg,#efbf83,#bb727e)','linear-gradient(135deg,#9e9bec,#64a6b9)','linear-gradient(135deg,#e29ebd,#926eb5)'];
let view = 'login', busy = false, currentUser = null, communities = [], channels = [], selectedChannel = null, users = [], unsubscribe = null;
function color(name='') { let n=0; for (const c of String(name)) n += c.charCodeAt(0); return colors[n % colors.length]; }
function initials(name='?') { return String(name).trim().split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase() || '?'; }
function setOnline(ok, label) { $('.server-status').classList.toggle('connected', !!ok); $('#connection-label').textContent = label; }
function errorText(e) { return String(e?.message || e?.error || 'Something went wrong. Please try again.'); }
function chatErrorText(code) { return ({CHANNEL_NOT_FOUND:'This channel is no longer available.',CHANNEL_REQUIRED:'Choose a channel before sending.',INVALID_MESSAGE:'Messages must contain 1–4,000 characters.',RATE_LIMITED:'You are sending actions too quickly. Wait a moment and retry.',CHAT_SERVICE_UNAVAILABLE:'Chat service is temporarily unavailable.'})[String(code)] || 'The chat request could not be completed.'; }
function showError(text='') { $('#auth-error').textContent=text; }
function showInfo(text='') { $('#auth-info').textContent=text; }
function setBusy(on) { busy=on; const b=$('#submit-auth'); b.disabled=on; b.textContent=on?'Please wait…':({login:'Sign in',register:'Create account',verify:'Verify email',forgot:'Send recovery instructions',reset:'Reset password'}[view]); }
const fields={identity:'#identity-field',username:'#username-field',email:'#email-field',password:'#password-field',token:'#token-field',confirm:'#confirm-field'};
function configureView(next) {
  view=next; showError(); showInfo();
  Object.values(fields).forEach(s=>$(s).classList.add('hidden'));
  const config={
    login:{eyebrow:'WELCOME BACK',title:'Sign in',desc:'Use your GlassChat account to continue.',show:['identity','password'],button:'Sign in',links:true},
    register:{eyebrow:'FIND YOUR PEOPLE',title:'Create account',desc:'Create a GlassChat account to get started.',show:['username','email','password'],button:'Create account',links:false},
    verify:{eyebrow:'ONE LAST STEP',title:'Verify your email',desc:'Paste the single-use verification token you received.',show:['email','token'],button:'Verify email',links:false},
    forgot:{eyebrow:'ACCOUNT RECOVERY',title:'Forgot password?',desc:'Enter your account email to request recovery instructions.',show:['email'],button:'Send recovery instructions',links:false},
    reset:{eyebrow:'ACCOUNT RECOVERY',title:'Choose a new password',desc:'Paste the reset token and enter a new password.',show:['token','confirm'],button:'Reset password',links:false}
  }[next];
  $('#auth-eyebrow').textContent=config.eyebrow; $('#auth-title').textContent=config.title; $('#auth-desc').textContent=config.desc;
  config.show.forEach(f=>$(fields[f]).classList.remove('hidden'));
  $('#submit-auth').textContent=config.button; $('#auth-links').classList.toggle('hidden',!config.links); $('#back-login').classList.toggle('hidden',next==='login'||next==='register'); $('#verify-resend').classList.toggle('hidden',next!=='verify');
  const focus={login:'#identity',register:'#username',verify:'#token',forgot:'#email',reset:'#token'}[next];
  setBusy(false); setTimeout(()=>$(focus).focus(),0);
}
function showAuth() { $('#chat-screen').classList.add('hidden'); $('#auth-screen').classList.remove('hidden'); }
function showChat() { $('#auth-screen').classList.add('hidden'); $('#chat-screen').classList.remove('hidden'); }
function renderChannels() {
  const nav=$('#channels'); nav.replaceChildren(); $('#channel-empty').classList.toggle('hidden',channels.length>0);
  channels.forEach(ch=>{ const b=document.createElement('button'); b.type='button'; b.className='channel'+(selectedChannel?.id===ch.id?' active':''); b.setAttribute('aria-current',selectedChannel?.id===ch.id?'page':'false');
    const hash=document.createElement('span'); hash.className='hash'; hash.textContent='#'; const name=document.createElement('span'); name.textContent=String(ch.name??''); b.append(hash,name); b.addEventListener('click',()=>join(ch)); nav.append(b); });
}
function renderUsers() { const list=$('#member-list'); list.replaceChildren(); const unique=[...new Set(users.map(x=>String(x)))]; ['#member-count','#online-count','#room-count'].forEach(sel=>$(sel).textContent=String(unique.length));
  unique.forEach(name=>{const row=document.createElement('div'); row.className='member-row'; const av=document.createElement('div'); av.className='avatar'; av.style.background=color(name); av.textContent=initials(name); const label=document.createElement('span'); label.textContent=name; const dot=document.createElement('i'); dot.className='online-dot'; row.append(av,label,dot); list.append(row);});
}
function addMessage(m) { if(!m||!$('#messages')) return; $('#welcome').classList.add('hidden'); const article=document.createElement('article'); article.className='message'; const av=document.createElement('div'); av.className='avatar'; av.style.background=color(m.user); av.textContent=initials(m.user); const body=document.createElement('div'); const head=document.createElement('div'); head.className='msg-head'; const who=document.createElement('b'); who.textContent=String(m.user??''); const tm=document.createElement('time'); const date=new Date(m.time); tm.textContent=Number.isNaN(date.getTime())?'':date.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}); head.append(who,tm); const text=document.createElement('p'); text.textContent=String(m.text??''); body.append(head,text); article.append(av,body); $('#messages').append(article); $('#messages').scrollTop=$('#messages').scrollHeight; }
function renderMessages(items=[]) { const box=$('#messages'); box.replaceChildren(); items.forEach(addMessage); $('#welcome').classList.toggle('hidden',items.length>0); }
async function join(ch) { if(!ch||!chat) return; selectedChannel=ch; renderChannels(); $('#room-name').textContent=String(ch.name??''); $('#topic').textContent=String(ch.topic??''); $('#message-input').placeholder=`Message #${String(ch.name??'')}`; $('#message-input').disabled=false; $('#send-btn').disabled=false; renderMessages([]); users=[]; renderUsers(); setOnline(false,'Connecting…'); try { await chat.joinChannel(ch.id); } catch(e) { setOnline(false,'Channel unavailable'); $('#typing').textContent=errorText(e); } }
function handleEvent(ev) {
  if(!ev||typeof ev!=='object') return;
  if(ev.type==='channel:init') { if(ev.channel) { selectedChannel=ev.channel; $('#room-name').textContent=String(ev.channel.name??''); $('#topic').textContent=String(ev.channel.topic??''); $('#message-input').placeholder=`Message #${String(ev.channel.name??'')}`; } users=Array.isArray(ev.users)?ev.users:[]; renderChannels(); renderUsers(); renderMessages(Array.isArray(ev.messages)?ev.messages:[]); }
  else if(ev.type==='message') addMessage(ev.message||ev);
  else if(ev.type==='presence') { users=Array.isArray(ev.users)?ev.users:[]; renderUsers(); }
  else if(ev.type==='typing') { $('#typing').textContent=ev.active===false?'':`${String(ev.user??'Someone')} is typing…`; clearTimeout(window.gcTypingTimer); if(ev.active!==false) window.gcTypingTimer=setTimeout(()=>$('#typing').textContent='',1700); }
  else if(ev.type==='connection') setOnline(!!ev.online,ev.online?'Connected':(ev.error?'Connection issue':'Reconnecting…'));
  else if(ev.type==='error') { $('#typing').textContent=chatErrorText(ev.error); clearTimeout(window.gcTypingTimer); window.gcTypingTimer=setTimeout(()=>$('#typing').textContent='',3000); }
  else if(ev.type==='session-expired') { if(typeof unsubscribe==='function')unsubscribe(); unsubscribe=null; $('#messages').replaceChildren(); users=[]; renderUsers(); selectedChannel=null; currentUser=null; communities=[]; channels=[]; showAuth(); configureView('login'); showError('Your session expired. Please sign in again.'); }
}
function enterChat(session) {
  currentUser=session.user; communities=Array.isArray(session.communities)?session.communities:[];
  const community=communities[0]; if(!community) { showAuth(); configureView('login'); showError('Your account has no available communities yet.'); return; }
  $('#community-name').textContent=String(community.name??'GlassChat'); const display=String(currentUser.username??currentUser.name??currentUser.email??'Member'); $('#profile-name').textContent=display; $('.current-avatar').textContent=initials(display); $('.current-avatar').style.background=color(display);
  channels=Array.isArray(community.channels)?community.channels:[]; selectedChannel=null; renderChannels(); renderMessages([]); renderUsers(); showChat(); setOnline(false,'Connecting…');
  if(typeof unsubscribe==='function') unsubscribe(); if(chat?.onEvent) unsubscribe=chat.onEvent(handleEvent);
  if(channels.length) join(channels[0]); else { $('#room-name').textContent='No channels'; $('#message-input').disabled=true; $('#send-btn').disabled=true; $('#welcome').classList.remove('hidden'); }
}
async function submitAuth(ev) {
  ev.preventDefault(); if(busy)return; showError(); showInfo(); const b=$('#submit-auth');
  try { setBusy(true);
    if(view==='login') { const res=await auth.login({identity:$('#identity').value.trim(),password:$('#password').value}); enterChat(res); }
    else if(view==='register') { const res=await auth.register({username:$('#username').value.trim(),email:$('#email').value.trim(),password:$('#password').value}); showInfo(res?.message||'Account created. Check your email, then paste your verification token here.'); configureView('verify'); showInfo(res?.message||'Account created. Check your email, then paste your verification token here.'); }
    else if(view==='verify') { const res=await auth.verifyEmail({token:$('#token').value.trim()}); enterChat(res); }
    else if(view==='forgot') { const res=await auth.forgotPassword({email:$('#email').value.trim()}); showInfo(res?.message||'If the account exists, recovery instructions have been sent.'); }
    else if(view==='reset') { const res=await auth.resetPassword({token:$('#token').value.trim(),password:$('#new-password').value}); configureView('login'); showInfo(res?.message||'Password reset. You can now sign in.'); }
  } catch(e) { showError(errorText(e)); } finally { setBusy(false); }
}
async function send() { const input=$('#message-input'), text=input.value.trim(); if(!text||!selectedChannel||busy)return; $('#send-btn').disabled=true; clearTimeout(window.gcTypingSend); window.gcTypingActive=false; chat.setTyping(false).catch(()=>{}); try { await chat.sendMessage(text); input.value=''; input.style.height='auto'; } catch(e) { $('#typing').textContent=errorText(e); } finally { $('#send-btn').disabled=false; input.focus(); } }
$('#auth-form').addEventListener('submit',submitAuth);
$('#verify-resend').addEventListener('click',async()=>{showError();showInfo();try{const result=await auth.resendVerification({email:$('#email').value.trim()});showInfo(result?.message||'If verification is needed, an email will be sent.');}catch(e){showError(errorText(e));}});
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>configureView(b.dataset.view)));
$('#message-input').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}});
$('#message-input').addEventListener('input',e=>{e.target.style.height='auto';e.target.style.height=Math.min(e.target.scrollHeight,120)+'px'; if(e.target.value.trim()){if(!window.gcTypingActive){window.gcTypingActive=true;chat.setTyping(true).catch(()=>{});}clearTimeout(window.gcTypingSend);window.gcTypingSend=setTimeout(()=>{window.gcTypingActive=false;chat.setTyping(false).catch(()=>{});},1200);}else{window.gcTypingActive=false;chat.setTyping(false).catch(()=>{});}});
$('#send-btn').addEventListener('click',send);
$('#logout').addEventListener('click',async()=>{let warning='';try{await auth.logout();}catch(e){warning=`Signed out on this device. Remote sign-out could not be confirmed: ${errorText(e)}`;} if(typeof unsubscribe==='function')unsubscribe(); unsubscribe=null; selectedChannel=null; currentUser=null; communities=[]; channels=[]; users=[]; $('#messages').replaceChildren();renderUsers();showAuth();configureView('login');if(warning)showInfo(warning);});
$('#save-endpoint').addEventListener('click',async()=>{const out=$('#endpoint-error'); out.textContent=''; const url=$('#service-url').value.trim(); if(!url){out.textContent='Enter a service URL.';return;} try { await auth.setApiBaseUrl(url); out.textContent='Service URL saved.'; } catch(e) { out.textContent=errorText(e); }});
async function initialize() {
  if(!auth||!chat) { showAuth(); configureView('login'); showError('GlassChat service is unavailable in this window.'); return; }
  configureView('login');
  try { const url=await auth.getApiBaseUrl(); if(url) $('#service-url').value=String(url); } catch(e) { $('#endpoint-error').textContent=errorText(e); }
  try { const session=await auth.status(); if(session?.user) enterChat(session); else showAuth(); } catch(e) { showAuth(); setOnline(false,'Not connected'); showError(errorText(e)); }
}
async function showAppVersion() {
  try {
    const meta=await api?.getMetadata?.();
    if(!meta?.version) return;
    const label=`v${meta.version} · build ${meta.buildId||'—'}`;
    $('#app-version-auth').textContent=label; $('#app-version-chat').textContent=label;
    document.title=`GlassChat v${meta.version}`;
  } catch {}
}
showAppVersion();
initialize();
