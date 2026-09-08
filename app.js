
const CFG = window.UCC_CONFIG || {};
let sb = null;
let authUser = null;
let profile = null;
let state = {
  loginRole:'manager', mode:'manager',
  staff:[], clients:[], sites:[], roster:[], timesheets:[], notes:[],
  meds:[], health:[], handovers:[], incidents:[], compliance:[],
  notifications:[], documents:[], rosterTemplates:[], settings:null, staffRates:[], accessRequests:[], incidentAttachments:[], availability:[]
};

const today = new Date().toISOString().slice(0,10);
const el = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const fmt = d => d ? new Date(String(d).length===10?d+'T12:00:00':d).toLocaleDateString('en-AU',{day:'2-digit',month:'short',year:'numeric'}) : '—';
function formatTime12(t){if(!t)return '—';const [h,m]=String(t).slice(0,5).split(':').map(Number);return `${((h+11)%12)+1}:${String(m).padStart(2,'0')} ${h>=12?'PM':'AM'}`;}
function calcHours(start,end){if(!start||!end)return '0.00';let [sh,sm]=start.split(':').map(Number),[eh,em]=end.split(':').map(Number);let a=sh*60+sm,b=eh*60+em;if(b<a)b+=1440;return ((b-a)/60).toFixed(2);}
function pill(s){let c=['Current','Active','Approved','Completed','Stable','In Progress','Given'].includes(s)?'ok':['High','Open','Overdue'].includes(s)?'bad':['Due Soon','Rostered','Upcoming','Pending'].includes(s)?'warn':'info';return `<span class="pill ${c}">${esc(s||'')}</span>`;}
function toast(m){alert(m);}
function durationFrom(iso){const mins=Math.max(0,Math.floor((Date.now()-new Date(iso).getTime())/60000));return `${Math.floor(mins/60)}h ${String(mins%60).padStart(2,'0')}m`;}
function byId(arr){return Object.fromEntries((arr||[]).map(x=>[x.id,x]));}
function mondayOf(dateStr){const d=dateStr?new Date(dateStr+'T12:00:00'):new Date();const day=d.getDay(),diff=day===0?-6:1-day;d.setDate(d.getDate()+diff);return d.toISOString().slice(0,10);}
function addDaysISO(dateStr,n){const d=new Date(dateStr+'T12:00:00');d.setDate(d.getDate()+n);return d.toISOString().slice(0,10);}
function input(label,id,extra=''){return `<div class="field"><label>${label}</label><input id="${id}" ${extra}></div>`;}
function select(label,id,opts){return `<div class="field"><label>${label}</label><select id="${id}">${opts.map(x=>`<option>${esc(x)}</option>`).join('')}</select></div>`;}
function openModal(title,body){el('modalTitle').textContent=title;el('modalBody').innerHTML=body;el('modal').classList.remove('hidden');}
function closeModal(){el('modal').classList.add('hidden');}

function initSupabase(){
  if(!CFG.SUPABASE_URL || !CFG.SUPABASE_PUBLISHABLE_KEY){
    alert('CareHub production database configuration is missing.');
    return false;
  }
  sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_PUBLISHABLE_KEY);
  return true;
}

document.querySelectorAll('#loginRoles .role-choice').forEach(b=>b.onclick=()=>{
  state.loginRole=b.dataset.role;
  document.querySelectorAll('#loginRoles .role-choice').forEach(x=>x.classList.toggle('active',x===b));
});

async function doLogin(){
  if(!sb && !initSupabase()) return;
  const email=el('loginEmail').value.trim(), password=el('loginPassword').value;
  if(!email||!password) return toast('Enter your email and password.');
  const {data,error}=await sb.auth.signInWithPassword({email,password});
  if(error) return toast(error.message);
  authUser=data.user;
  await startAuthenticatedApp();
}
async function logout(){if(sb)await sb.auth.signOut();location.reload();}

async function startAuthenticatedApp(){
  const {data:p,error}=await sb.from('profiles').select('*').eq('id',authUser.id).single();
  if(error||!p||!p.active){await sb.auth.signOut();return toast('An active CareHub staff profile was not found for this account.');}
  profile=p;
  const isManager=['manager','admin'].includes(p.role);
  const canStaff=p.role==='staff'||p.can_work_as_staff;
  if(state.loginRole==='admin' && p.role!=='admin'){await sb.auth.signOut();return toast('This account does not have Admin access.');}
  if(state.loginRole==='manager' && !isManager){await sb.auth.signOut();return toast('This account does not have Manager access.');}
  if(state.loginRole==='staff' && !canStaff){await sb.auth.signOut();return toast('This account is not enabled as a Support Worker.');}

  state.mode=state.loginRole==='staff'?'staff':'manager';
  await loadAll();
  el('login').classList.add('hidden');
  el('app').classList.remove('hidden');

  // Update hard-coded placeholder identity in the original UI.
  const avatar=document.querySelector('.avatar');
  if(avatar) avatar.textContent=(p.full_name||'UCC').split(/\s+/).map(x=>x[0]).slice(0,2).join('').toUpperCase();
  const nameNode=document.querySelector('.userchip b');
  if(nameNode) nameNode.textContent=p.full_name||p.email||'CareHub User';
  el('roleLabel').textContent = p.role==='admin'?'Admin':p.role==='manager'&&p.can_work_as_staff?'Manager + Support Worker':p.role==='manager'?'Manager':'Support Worker';

  if(p.role==='staff'){
    el('modeSwitch').classList.add('hidden');
    state.mode='staff';
  } else if(!p.can_work_as_staff) {
    el('modeSwitch').innerHTML='<option value="manager">Manager Mode</option>';
  } else {
    el('modeSwitch').classList.remove('hidden');
    el('modeSwitch').value=state.mode;
  }
  renderAll();
  switchMode(state.mode);
}

async function safeSelect(table,query='*'){
  const r=await sb.from(table).select(query);
  if(r.error){console.warn(table,r.error.message);return [];}
  return r.data||[];
}
async function loadAll(){
  const [staff,sites,clients,roster,timesheets,notes,meds,health,handovers,incidents,compliance,notifications,documents,templates,settingsRows,staffRates,accessRequests,incidentAttachments,availability] = await Promise.all([
    safeSelect('profiles'),
    safeSelect('sites'),
    safeSelect('clients'),
    safeSelect('roster_shifts'),
    safeSelect('timesheets'),
    safeSelect('progress_notes'),
    safeSelect('medication_records'),
    safeSelect('health_records'),
    safeSelect('handovers'),
    safeSelect('incidents'),
    safeSelect('compliance_records'),
    safeSelect('staff_notifications'),
    safeSelect('documents'),
    safeSelect('roster_templates'),
    safeSelect('app_settings'),
    safeSelect('staff_pay_rates'),
    safeSelect('client_access_requests'),
    safeSelect('incident_attachments'),
    safeSelect('staff_availability')
  ]);
  state.staff=staff; state.sites=sites; state.clients=clients; state.roster=roster;
  state.timesheets=timesheets; state.notes=notes; state.meds=meds; state.health=health;
  state.handovers=handovers; state.incidents=incidents; state.compliance=compliance;
  state.notifications=notifications; state.documents=documents; state.rosterTemplates=templates; state.settings=(settingsRows||[]).find(x=>x.id==='global')||settingsRows?.[0]||null; state.staffRates=staffRates||[]; state.accessRequests=accessRequests||[]; state.incidentAttachments=incidentAttachments||[]; state.availability=availability||[];
}

const allNav=[
 ['dashboard','🏠','Dashboard'],['online','🟢','Online Staff'],['staff','👥','Staff Management'],['clients','🧑‍🦽','Client Management'],['sites','🏡','Sites / Houses'],
 ['roster','📅','Roster & Shifts'],['availability','🗓️','Availability'],['timesheets','⏱️','Timesheets'],['notes','📝','Progress Notes'],['medication','💊','Medication'],
 ['health','❤️','Health Records'],['handover','🔄','Handover'],['incidents','⚠️','Incidents & Reports'],['compliance','✅','Training & Compliance'],
 ['documents','📁','Documents'],['notifications','🔔','Notifications'],['reports','📊','Reports'],['settings','⚙️','Settings']
];
const staffNav=['dashboard','clients','roster','availability','timesheets','notes','medication','health','handover','incidents','notifications'];

function makeNav(){
 let navs=state.mode==='staff'?allNav.filter(x=>staffNav.includes(x[0])):allNav;
 el('sideNav').innerHTML=navs.map(([id,ic,n])=>`<button data-id="${id}" onclick="show('${id}')">${ic} ${n}</button>`).join('');
 el('mobileNav').innerHTML=navs.filter(x=>['dashboard','roster','clients','notes','timesheets'].includes(x[0])).slice(0,5).map(([id,ic,n])=>`<button data-id="${id}" onclick="show('${id}')"><b>${ic}</b>${n.split(' ')[0]}</button>`).join('');
}
function show(id){
 document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
 const v=el(id);
 const protectedCare=['clients','notes','medication','health','handover','incidents'];
 if(v&&state.mode==='staff'&&protectedCare.includes(id)&&activeTimesheet()?.unrostered&&!unrosteredAccessApproved()){
   v.innerHTML=`${accessStatusCard()}<div class="card" style="margin-top:14px"><h2>Access approval required</h2><div class="muted">You can remain clocked in and complete your timesheet, but client care information is locked until a manager approves this unrostered shift access request.</div></div>`;
 }
 if(v)v.classList.add('active');
 document.querySelectorAll('[data-id]').forEach(b=>b.classList.toggle('active',b.dataset.id===id));
 el('pageTitle').textContent=allNav.find(x=>x[0]===id)?.[2]||'UCC CareHub';
}
function switchMode(m){
 if(m==='staff' && !(profile?.role==='staff'||profile?.can_work_as_staff)) return;
 state.mode=m; if(el('modeSwitch'))el('modeSwitch').value=m;
 el('roleLabel').textContent=m==='staff'?'Working as Support Worker':profile?.role==='admin'?'Admin':'Manager + Support Worker';
 makeNav();renderAll();show('dashboard');
}

function activeTimesheet(){return state.timesheets.find(x=>x.staff_id===profile.id&&!x.clock_out);}
function currentSite(){const t=activeTimesheet();return t?state.sites.find(s=>s.id===t.site_id):null;}
function rosterToday(){return state.roster.filter(r=>r.staff_id===profile.id&&r.shift_date===today);}
function localShiftWindow(r){
 if(!r?.shift_date||!r?.start_time||!r?.end_time)return null;
 const start=new Date(`${r.shift_date}T${String(r.start_time).slice(0,5)}:00`);
 let end=new Date(`${r.shift_date}T${String(r.end_time).slice(0,5)}:00`);
 if(end<=start)end.setDate(end.getDate()+1);
 return {start,end};
}
function rosterClockInCandidates(){
 const now=Date.now(),earlyMs=90*60000;
 return state.roster.filter(r=>{
  if(r.staff_id!==profile.id||String(r.status||'').toLowerCase()==='cancelled')return false;
  const w=localShiftWindow(r);if(!w)return false;
  return now>=w.start.getTime()-earlyMs&&now<=w.end.getTime();
 }).sort((a,b)=>Math.abs(localShiftWindow(a).start-Date.now())-Math.abs(localShiftWindow(b).start-Date.now()));
}
function currentRosterShift(){return rosterClockInCandidates()[0]||null;}
function todayRosterSite(){const r=currentRosterShift();return r?state.sites.find(s=>s.id===r.site_id):null;}
function currentAccessRequest(){
 const t=activeTimesheet(); if(!t||!t.unrostered)return null;
 return state.accessRequests.slice().sort((a,b)=>new Date(b.requested_at||b.created_at||0)-new Date(a.requested_at||a.created_at||0)).find(r=>r.staff_id===profile.id&&r.timesheet_id===t.id)||null;
}
function unrosteredAccessApproved(){
 const t=activeTimesheet(); if(!t||!t.unrostered)return true;
 const r=currentAccessRequest(); if(!r||r.status!=='Approved')return false;
 if(r.expires_at&&new Date(r.expires_at)<=new Date())return false;
 return true;
}
function accessStatusCard(){
 const t=activeTimesheet(),r=currentAccessRequest(); if(!t?.unrostered)return '';
 const cm=byId(state.clients),sm=byId(state.sites),status=r?.status||'Pending';
 const cls=status==='Approved'?'ok':status==='Denied'?'bad':'warn';
 return `<div class="card" style="border-color:${status==='Approved'?'#12b76a':status==='Denied'?'#f04438':'#f79009'};background:${status==='Approved'?'#ecfdf3':status==='Denied'?'#fef3f2':'#fffaeb'}"><div class="row between wrap"><div><b>🔐 Client access: ${esc(status)}</b><div class="muted">${esc(cm[t.client_id]?.full_name||sm[t.site_id]?.name||'Selected work location')} • Unrostered shift</div></div><span class="pill ${cls}">${esc(status)}</span></div><div class="small" style="margin-top:8px">${status==='Approved'?'Temporary access is active for this unrostered shift and ends when you clock out.':status==='Denied'?'A manager denied access to client care information for this shift.':'A manager must approve access before client history, progress notes, medication, health records, handovers or incidents can be viewed.'}</div>${status==='Denied'?'<div style="margin-top:10px"><button class="btn btn-secondary" onclick="requestClientAccessAgain()">Request Access Again</button></div>':''}</div>`;
}
function authorisedClients(){
 if(state.mode==='manager') return state.clients.filter(c=>c.active);
 const t=documentationTimesheet(); if(!t)return [];
 if(t.unrostered){
   if(!unrosteredAccessApproved())return [];
   const r=currentAccessRequest();
   if(r?.client_id)return state.clients.filter(c=>c.active&&c.id===r.client_id);
   const sid=r?.site_id||t.site_id; return state.clients.filter(c=>c.active&&c.site_id===sid);
 }
 const s=state.sites.find(z=>z.id===t.site_id); return s?state.clients.filter(c=>c.active&&c.site_id===s.id):[];
}
function onlineStaff(){return state.timesheets.filter(x=>!x.clock_out);}
function pendingDocumentationTimesheetForStaff(){
 const rows=state.timesheets.filter(x=>x.staff_id===profile.id&&x.clock_out&&String(x.status||'')==='Pending Documentation').slice().sort((a,b)=>new Date(b.clock_out||b.clock_in)-new Date(a.clock_out||a.clock_in));
 return rows.find(t=>!shiftCompliance(t).all)||null;
}
function documentationTimesheet(){return activeTimesheet()||pendingDocumentationTimesheetForStaff();}

function renderDashboard(){
 const staffMap=byId(state.staff), siteMap=byId(state.sites), clientMap=byId(state.clients);
 const active=activeTimesheet(), myShifts=state.roster.filter(r=>r.staff_id===profile.id);
 el('dashboard').innerHTML=`
 <div class="hero-card"><img src="ucc-logo.png" style="width:72px;height:72px;object-fit:contain;background:#fff;border-radius:14px"><div><h1>${state.mode==='manager'?'Manager Dashboard':'Support Worker Dashboard'}</h1><p>${state.mode==='manager'?'Manage staff, sites, clients, rosters and care operations.':'Your roster, current site and care documentation in one place.'}</p></div></div>
 ${state.mode==='manager'?`
 <div class="grid g6">
  <div class="card kpi"><b>${state.staff.filter(x=>x.active).length}</b><span>Active Staff</span></div>
  <div class="card kpi"><b>${state.clients.filter(x=>x.active).length}</b><span>Active Clients</span></div>
  <div class="card kpi"><b>${state.sites.filter(x=>x.active).length}</b><span>Sites / Houses</span></div>
  <div class="card kpi"><b>${state.roster.filter(x=>x.shift_date===today).length}</b><span>Today's Shifts</span></div>
  <div class="card kpi"><b>${onlineStaff().length}</b><span>Staff Online Now</span></div>
  <div class="card kpi"><b>${state.timesheets.filter(x=>x.status==='Pending').length}</b><span>Pending Approvals</span></div>
 </div>
 <div class="grid g2" style="margin-top:14px">
  <div class="card"><div class="row between"><h2>Today's Shifts</h2><button class="btn btn-secondary" onclick="show('roster')">View all</button></div>
   ${state.roster.filter(x=>x.shift_date===today).slice(0,8).map(x=>`<div class="item row between"><div><b>${formatTime12(x.start_time)}–${formatTime12(x.end_time)} • ${esc(staffMap[x.staff_id]?.full_name||'')}</b><div class="muted">${esc(siteMap[x.site_id]?.name||'')} ${x.client_id?'• '+esc(clientMap[x.client_id]?.full_name||''):''}</div></div>${pill(x.status||'Rostered')}</div>`).join('')||'<div class="muted">No shifts today.</div>'}
  </div>
  <div class="card"><h2>Quick Actions</h2><div class="quick">
   <button onclick="show('staff')"><span class="ico">➕👤</span>Add Staff</button><button onclick="show('clients')"><span class="ico">➕🧑‍🦽</span>Add Client</button>
   <button onclick="show('roster')"><span class="ico">📅</span>Create Roster</button><button onclick="show('incidents')"><span class="ico">⚠️</span>Incident</button>
  </div></div>
 </div>
 <div class="card" style="margin-top:14px"><div class="row between"><h2>🟢 Online Staff</h2><button class="btn btn-secondary" onclick="show('online')">View Live Staff</button></div>
 ${onlineStaff().map(t=>`<div class="item row between"><div class="row"><span class="online-dot"></span><div><b>${esc(staffMap[t.staff_id]?.full_name||'')}</b><div class="muted">${esc(siteMap[t.site_id]?.name||'')} • Clocked in ${new Date(t.clock_in).toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit'})}</div></div></div><span class="pill ok">${durationFrom(t.clock_in)} Online</span></div>`).join('')||'<div class="muted">No staff currently clocked in.</div>'}</div>
 <div class="card" style="margin-top:14px"><div class="row between wrap"><div><h2>🔐 Client Access Requests</h2><div class="muted">Approval is required when staff clock in without a roster before they can view client care information.</div></div><span class="pill warn">${state.accessRequests.filter(r=>r.status==='Pending').length} pending</span></div>
 ${state.accessRequests.filter(r=>r.status==='Pending').slice().sort((a,b)=>new Date(b.requested_at||b.created_at||0)-new Date(a.requested_at||a.created_at||0)).map(r=>`<div class="item row between wrap"><div><b>${esc(staffMap[r.staff_id]?.full_name||'Staff')}</b><div class="muted">${esc(clientMap[r.client_id]?.full_name||siteMap[r.site_id]?.name||'Site access')} • ${new Date(r.requested_at||r.created_at).toLocaleString('en-AU')}</div><div class="small">${esc(r.reason||'Unrostered work')}</div></div><div class="row"><button class="btn btn-green" onclick="approveClientAccess('${r.id}')">Approve</button><button class="btn btn-danger" onclick="denyClientAccess('${r.id}')">Deny</button></div></div>`).join('')||'<div class="muted">No pending access requests.</div>'}</div>
 `:`
 ${accessStatusCard()}
 <div class="${active?'shift-live':'shift-off'}" style="margin-top:${active?.unrostered?'14px':'0'}"><div class="row between wrap"><div><div class="row"><span class="${active?'online-dot':'offline-dot'}"></span><b>${active?'ON SHIFT':'OFF SHIFT'}</b></div>
 <div class="${active?'shift-clock':''}" style="margin-top:5px">${active?durationFrom(active.clock_in):'Not clocked in'}</div>
 <div class="muted">${active?`${esc(currentSite()?.name||'')} • Clocked in ${new Date(active.clock_in).toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit'})}`:'Clock in for your rostered site/location.'}</div></div>
 <div class="shift-actions">${active?`<button class="btn btn-danger" onclick="clockOut()">Clock Out</button>`:`<button class="btn btn-green" onclick="quickClockIn()">Clock In</button>`}<button class="btn btn-secondary" onclick="show('timesheets')">Timesheet</button></div></div></div>
 <div class="grid g4" style="margin-top:14px"><div class="card kpi"><b>${myShifts.length}</b><span>My rostered shifts</span></div><div class="card kpi"><b>${state.notes.filter(x=>x.staff_id===profile.id).length}</b><span>My progress notes</span></div><div class="card kpi"><b>${state.handovers.filter(x=>x.staff_id===profile.id).length}</b><span>My handovers</span></div><div class="card kpi"><b>${esc(currentSite()?.name||'—')}</b><span>Current site</span></div></div>
 <div class="grid g2" style="margin-top:14px"><div class="card"><h2>My Shifts</h2>${myShifts.slice(0,8).map(x=>`<div class="item row between"><div><b>${fmt(x.shift_date)} • ${formatTime12(x.start_time)}–${formatTime12(x.end_time)}</b><div class="muted">${esc(siteMap[x.site_id]?.name||'')} • ${esc(x.shift_type||'')}</div></div>${pill(x.status||'Rostered')}</div>`).join('')||'<div class="muted">No assigned shifts.</div>'}</div><div class="card"><h2>Care Actions</h2><div class="quick"><button onclick="show('notes')"><span class="ico">📝</span>Progress Note</button><button onclick="show('medication')"><span class="ico">💊</span>Medication</button><button onclick="show('handover')"><span class="ico">🔄</span>Handover</button><button onclick="show('incidents')"><span class="ico">⚠️</span>Incident</button></div></div></div>`}`;
}

function renderOnline(){
 const pm=byId(state.staff), sm=byId(state.sites), on=onlineStaff();
 el('online').innerHTML=`<div class="hero-card"><div style="font-size:40px">🟢</div><div><h1>Online Staff</h1><p>Staff appear here while clocked in. Managers can end a forgotten clock-in and CareHub will flag any missing documentation.</p></div></div>
 <div class="grid g2"><div class="card"><div class="row between wrap"><div><h2>Live Staff Status</h2><div class="muted">A manager clock-out does not remove care-documentation requirements.</div></div><span class="pill info">${on.length} online</span></div>${on.map(x=>{const ck=shiftCompliance(x);const missing=[];if(!ck.noteOk)missing.push('Progress Note');if(!ck.medOk)missing.push('Medication');if(!ck.handoverOk)missing.push('Handover');return `<div class="online-card"><div class="online-dot"></div><div style="flex:1"><b>${esc(pm[x.staff_id]?.full_name||'')}</b><div class="muted">${esc(sm[x.site_id]?.name||'')}</div><div class="small">Clocked in: ${new Date(x.clock_in).toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit'})}</div>${missing.length?`<div class="small" style="margin-top:4px;color:#b54708">Pending if clocked out now: ${esc(missing.join(', '))}</div>`:'<div class="small" style="margin-top:4px;color:#067647">Documentation currently complete</div>'}</div><div style="text-align:right"><div class="live-time">${durationFrom(x.clock_in)}</div><div class="small muted">on shift</div>${state.mode==='manager'?`<button class="btn btn-danger" style="margin-top:8px" onclick="managerClockOutStaff('${x.id}')">⏹ Offline / Clock Out</button>`:''}</div></div>`}).join('')||'<div class="muted">No staff are currently clocked in.</div>'}</div></div>`;
}
function managerClockOutStaff(id){
 if(state.mode!=='manager')return toast('Manager access required.');const t=state.timesheets.find(x=>x.id===id);if(!t)return;const pm=byId(state.staff),sm=byId(state.sites),ck=shiftCompliance(t),missing=[];if(!ck.noteOk)missing.push('Progress Note');if(!ck.medOk)missing.push('Medication record');if(!ck.handoverOk)missing.push('House handover');
 openModal('Manager Clock Out',`<div class="care-banner"><b>${esc(pm[t.staff_id]?.full_name||'Staff')} • ${esc(sm[t.site_id]?.name||'Site')}</b><div class="small">Use this only when the worker forgot or is unable to clock out.</div></div><div class="record-card" style="margin-top:12px"><div class="row between"><b>Documentation check</b>${pill(missing.length?'Pending':'Complete')}</div>${missing.length?`<div class="small" style="margin-top:8px">Missing: <b>${esc(missing.join(', '))}</b></div><div class="small muted">CareHub will clock the staff member out and keep a Pending Documentation notice until the required records are completed by the staff member or manager.</div>`:'<div class="small muted">Required documentation is complete.</div>'}</div><div class="field" style="margin-top:12px"><label>Manager reason</label><textarea id="mgr_offline_reason" placeholder="e.g. Staff forgot to clock out after leaving shift"></textarea></div><div class="form-actions"><button class="btn btn-danger" onclick="confirmManagerClockOut('${id}')">⏹ Confirm Clock Out</button><button class="btn btn-secondary" onclick="closeModal()">Cancel</button></div>`);
}
async function confirmManagerClockOut(id){
 if(state.mode!=='manager')return;const t=state.timesheets.find(x=>x.id===id);if(!t)return;const reason=el('mgr_offline_reason')?.value.trim()||'Manager ended forgotten clock-in';const ck=shiftCompliance(t),missing=[];if(!ck.noteOk)missing.push('Progress Note');if(!ck.medOk)missing.push('Medication');if(!ck.handoverOk)missing.push('Handover');const status=missing.length?'Pending Documentation':'Pending';
 let row={clock_out:new Date().toISOString(),status};
 // New audit columns are optional; retry without them if the one-time SQL has not been run yet.
 let r=await sb.from('timesheets').update({...row,forced_clock_out:true,forced_clock_out_by:profile.id,forced_clock_out_at:new Date().toISOString(),forced_clock_out_reason:reason,pending_documentation:missing}).eq('id',id);
 if(r.error)r=await sb.from('timesheets').update(row).eq('id',id);if(r.error)return toast(r.error.message);
 const msg=missing.length?`Manager clocked you out. Pending documentation: ${missing.join(', ')}. Please complete the required record(s) for this shift.`:`Manager clocked you out. Reason: ${reason}`;
 await sb.from('staff_notifications').insert({staff_id:t.staff_id,notification_type:missing.length?'Pending Documentation':'Manager Clock Out',message:msg,read:false}).catch(()=>{});
 closeModal();await loadAll();renderOnline();renderDashboard();renderTimesheets();renderNotifications();toast(missing.length?'Staff clocked out — documentation remains pending.':'Staff clocked out.');
}

function rateMoney(v){const n=Number(v);return Number.isFinite(n)&&n>0?'$'+n.toFixed(2):'—';}
function staffRateRecord(staffId){return (state.staffRates||[]).find(r=>r.staff_id===staffId)||null;}
function staffRate(staff,key){const rec=staffRateRecord(staff?.id);const direct=Number(rec?.[key]);if(Number.isFinite(direct)&&direct>0)return direct;const fallback=Number(state.settings?.[key]);return Number.isFinite(fallback)&&fallback>0?fallback:0;}
function renderStaff(){
 if(state.mode!=='manager'){el('staff').innerHTML='<div class="card">Manager access required.</div>';return;}
 el('staff').innerHTML=`<div class="card"><div class="row between wrap"><div><h2>Staff Management</h2><div class="muted">Each support worker can have their own weekday, weekend and KM reimbursement rates.</div></div><button class="btn btn-primary" onclick="addStaff()">+ Add Staff Profile</button></div>
 <div class="tablewrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Weekday</th><th>Saturday</th><th>Sunday</th><th>KM Rate</th><th>Status</th><th>Action</th></tr></thead><tbody>
 ${state.staff.map(x=>`<tr><td><b>${esc(x.full_name)}</b></td><td>${esc(x.email||'')}</td><td>${esc(x.role)}</td><td>${rateMoney(staffRate(x,'weekday_rate'))}</td><td>${rateMoney(staffRate(x,'saturday_rate'))}</td><td>${rateMoney(staffRate(x,'sunday_rate'))}</td><td>${rateMoney(staffRate(x,'km_rate'))}/km</td><td>${pill(x.active?'Active':'Inactive')}</td><td><button class="btn btn-edit" onclick="editStaffRates('${x.id}')">💰 Pay & KM Rates</button></td></tr>`).join('')}</tbody></table></div>
 <div class="muted" style="margin-top:10px">A blank staff-specific rate uses the organisation default from Settings. Rates are manager/admin only.</div></div>`;
}
function addStaff(){openModal('Add Staff Profile',`${input('Authentication User UUID','m_uid','placeholder="UUID from Supabase Authentication"')}${input('Full name','m_name')}${input('Email','m_email','type="email"')}${input('Phone','m_phone')}${select('Role','m_role',['staff','manager','admin'])}<div class="field"><label><input id="m_can" type="checkbox" style="width:auto"> Can work as Support Worker</label></div><button class="btn btn-primary" onclick="saveStaff()">Save Staff</button>`);}
async function saveStaff(){
 const row={id:el('m_uid').value.trim(),full_name:el('m_name').value.trim(),email:el('m_email').value.trim(),phone:el('m_phone').value.trim(),role:el('m_role').value,can_work_as_staff:el('m_can').checked,active:true};
 if(!row.id||!row.full_name||!row.email)return toast('UUID, name and email are required.');
 const {error}=await sb.from('profiles').upsert(row);if(error)return toast(error.message);closeModal();await loadAll();renderStaff();renderDashboard();
}
function editStaffRates(id){
 if(state.mode!=='manager')return toast('Manager access required.');
 const x=state.staff.find(s=>s.id===id);if(!x)return;const r=staffRateRecord(id)||{};
 openModal('Pay & KM Rates — '+(x.full_name||'Staff'),`<div class="care-banner"><b>Individual staff rates</b><div class="small">Leave a field blank to use the organisation default from Settings. These rates are visible only to managers/admins.</div></div><div class="care-form-grid" style="margin-top:12px">
  <div class="field"><label>Weekday hourly rate ($)</label><input id="sr_weekday" type="number" step="0.01" min="0" value="${esc(r.weekday_rate??'')}"></div>
  <div class="field"><label>Saturday hourly rate ($)</label><input id="sr_saturday" type="number" step="0.01" min="0" value="${esc(r.saturday_rate??'')}"></div>
  <div class="field"><label>Sunday hourly rate ($)</label><input id="sr_sunday" type="number" step="0.01" min="0" value="${esc(r.sunday_rate??'')}"></div>
  <div class="field"><label>Public holiday hourly rate ($)</label><input id="sr_public" type="number" step="0.01" min="0" value="${esc(r.public_holiday_rate??'')}"></div>
  <div class="field"><label>Sleepover allowance / rate ($)</label><input id="sr_sleepover" type="number" step="0.01" min="0" value="${esc(r.sleepover_rate??'')}"></div>
  <div class="field"><label>KM reimbursement rate ($ / km)</label><input id="sr_km" type="number" step="0.01" min="0" value="${esc(r.km_rate??'')}"></div>
  <div class="field"><label>Rates effective from</label><input id="sr_effective" type="date" value="${esc(r.effective_from||'')}"></div>
 </div><div class="form-actions"><button class="btn btn-primary" onclick="saveStaffRates('${id}')">💾 Save Staff Rates</button></div>`);
}
async function saveStaffRates(id){
 if(state.mode!=='manager')return;
 const num=id=>{const v=el(id).value.trim();return v===''?null:Number(v)};
 const row={staff_id:id,weekday_rate:num('sr_weekday'),saturday_rate:num('sr_saturday'),sunday_rate:num('sr_sunday'),public_holiday_rate:num('sr_public'),sleepover_rate:num('sr_sleepover'),km_rate:num('sr_km'),effective_from:el('sr_effective').value||null,updated_at:new Date().toISOString(),updated_by:profile.id};
 const {error}=await sb.from('staff_pay_rates').upsert(row,{onConflict:'staff_id'});if(error)return toast('Could not save staff rates. Run carehub-staff-rates.sql in Supabase first. '+error.message);
 closeModal();await loadAll();renderStaff();renderTimesheets();toast('Staff pay and KM rates saved.');
}

function renderSites(){
 if(state.mode!=='manager'){el('sites').innerHTML='<div class="card">Manager access required.</div>';return;}
 el('sites').innerHTML=`<div class="card"><div class="row between"><div><h2>Sites / Houses / Client Homes</h2><div class="muted">Set a GPS location so support workers can only clock in when they are physically at the authorised site/client location.</div></div><button class="btn btn-primary" onclick="addSite()">+ Add Site</button></div><div class="grid g3" style="margin-top:14px">${state.sites.map(x=>`<div class="card"><div class="row between"><h3>🏡 ${esc(x.name)}</h3><div><button class="btn btn-secondary" onclick="editSite('${x.id}')">✏️</button> <button class="btn btn-danger" onclick="deleteSite('${x.id}')">🗑</button></div></div><div>${esc(x.address||'')}</div><div class="muted">${esc(x.site_type||'')} • ${esc(x.location_kind||'')}</div><div class="small" style="margin-top:8px">📍 ${siteGeofenceReady(x)?`${Number(x.latitude).toFixed(5)}, ${Number(x.longitude).toFixed(5)} • ${Number(x.geofence_radius_m||150)} m radius`:'GPS location not configured'}</div><br>${pill(x.active?'Active':'Inactive')}</div>`).join('')}</div></div>`;
}
function siteForm(x={}){return `<div class="care-form-grid">
 <div class="field"><label>Name</label><input id="s_name" value="${esc(x.name||'')}"></div>
 <div class="field"><label>Type</label><select id="s_type">${['SIL House','Client Home','Community','Office','Other'].map(v=>`<option ${v===(x.site_type||'SIL House')?'selected':''}>${v}</option>`).join('')}</select></div>
 <div class="field wide"><label>Address</label><input id="s_address" value="${esc(x.address||'')}" placeholder="Full client/site address"></div>
 <div class="field"><label>Location kind</label><select id="s_kind">${['shared_house','client_home','community','office','other'].map(v=>`<option ${v===(x.location_kind||'shared_house')?'selected':''}>${v}</option>`).join('')}</select></div>
 <div class="field"><label>Clock-in radius (metres)</label><input id="s_radius" type="number" min="30" max="1000" value="${esc(x.geofence_radius_m||150)}"></div>
 <div class="field"><label>Latitude</label><input id="s_lat" type="number" step="any" value="${esc(x.latitude??'')}"></div>
 <div class="field"><label>Longitude</label><input id="s_lng" type="number" step="any" value="${esc(x.longitude??'')}"></div>
 <div class="field wide"><button class="btn btn-secondary" type="button" onclick="captureSiteLocation()">📍 Use My Current Location</button><div class="small muted" style="margin-top:6px">For best accuracy, use this while physically at the site/client address.</div></div>
 </div>`;}
function addSite(){openModal('Add Site / Location',`${siteForm()}<div class="form-actions"><button class="btn btn-primary" onclick="saveSite()">Save Site</button><button class="btn btn-secondary" onclick="closeModal()">Cancel</button></div>`);}
async function captureSiteLocation(){try{const g=await gps();el('s_lat').value=g.lat.toFixed(7);el('s_lng').value=g.lng.toFixed(7);toast(`Location captured (accuracy about ${Math.round(g.accuracy||0)} m).`);}catch(e){toast('Could not get your location. Allow location access in the browser and try again.');}}
function siteFormRow(){const lat=el('s_lat').value.trim(),lng=el('s_lng').value.trim();return {name:el('s_name').value.trim(),address:el('s_address').value.trim(),site_type:el('s_type').value,location_kind:el('s_kind').value,latitude:lat===''?null:Number(lat),longitude:lng===''?null:Number(lng),geofence_radius_m:Number(el('s_radius').value||150),active:true};}
async function saveSite(){const row=siteFormRow();if(!row.name)return toast('Enter site name.');if(!row.address)return toast('Enter the site/client address.');const {error}=await sb.from('sites').insert(row);if(error)return toast('Could not save site. Run carehub-shift-compliance-handover-geofence.sql first. '+error.message);closeModal();await loadAll();renderSites();}
function editSite(id){const x=state.sites.find(s=>s.id===id);if(!x)return;openModal('Edit Site / Location',`${siteForm(x)}<div class="form-actions"><button class="btn btn-primary" onclick="updateSite('${id}')">Save Changes</button><button class="btn btn-secondary" onclick="closeModal()">Cancel</button></div>`);}
async function updateSite(id){const row=siteFormRow();if(!row.name||!row.address)return toast('Name and address are required.');const {error}=await sb.from('sites').update(row).eq('id',id);if(error)return toast('Could not update site. Run carehub-shift-compliance-handover-geofence.sql first. '+error.message);closeModal();await loadAll();renderSites();}
async function deleteSite(id){if(state.clients.some(c=>c.site_id===id))return toast('Move or delete linked clients first.');if(!confirm('Delete this site?'))return;const {error}=await sb.from('sites').delete().eq('id',id);if(error)return toast(error.message);await loadAll();renderSites();}

const CLIENT_SUPPORT_TYPES=['Personal Care','Medication Assistance','Diabetes / Insulin Support','Meal Preparation','Mobility / Transfers','Community Access','Behaviour Support','Social & Community Participation','Domestic Assistance','Appointment Support','Continence Support','Communication Support','Overnight / Sleepover Support'];
const CLIENT_ALERT_TYPES=['Falls Risk','Seizure Risk','Diabetes','Allergy','Aspiration Risk','Skin Integrity','Wandering / Absconding Risk','Manual Handling Requirement'];
function clientArray(v){if(Array.isArray(v))return v; if(!v)return []; if(typeof v==='string'){try{const j=JSON.parse(v);if(Array.isArray(j))return j}catch(e){} return v.split(',').map(x=>x.trim()).filter(Boolean);} return [];}
function checkedValues(name){return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(x=>x.value);}
function clientChecks(name,items,selected=[]){const set=new Set(clientArray(selected));return `<div class="client-check-grid">${items.map(v=>`<label class="client-check"><input type="checkbox" name="${name}" value="${esc(v)}" ${set.has(v)?'checked':''}> <span>${esc(v)}</span></label>`).join('')}</div>`;}
function clientTags(items,cls='support'){return clientArray(items).map(v=>`<span class="client-tag ${cls}">${esc(v)}</span>`).join('');}
function clientProfileForm(x={}){return `<div class="care-form-grid">
 <div class="field"><label>Client name</label><input id="cp_name" value="${esc(x.full_name||'')}"></div>
 <div class="field"><label>Site / House</label><select id="cp_site"><option value="">Not assigned</option>${state.sites.filter(s=>s.active||s.id===x.site_id).map(s=>`<option value="${s.id}" ${s.id===x.site_id?'selected':''}>${esc(s.name)}</option>`).join('')}</select></div>
 <div class="field"><label>Risk level</label><select id="cp_risk">${['Low','Medium','High'].map(v=>`<option ${v===(x.risk_level||'Low')?'selected':''}>${v}</option>`).join('')}</select></div>
 <div class="field wide"><label>Short support summary</label><textarea id="cp_support" placeholder="Brief summary shown on the client card">${esc(x.support_needs||'')}</textarea></div>
 <div class="field wide"><label>Support types</label>${clientChecks('cp_support_types',CLIENT_SUPPORT_TYPES,x.support_types)}</div>
 <div class="field wide"><label>Key alerts</label>${clientChecks('cp_alerts',CLIENT_ALERT_TYPES,x.key_alerts)}</div>
 <div class="field"><label>Mobility</label><select id="cp_mobility">${['','Independent','Walking aid','Wheelchair','Hoist / transfer assistance','Other'].map(v=>`<option ${v===(x.mobility_support||'')?'selected':''}>${v}</option>`).join('')}</select></div>
 <div class="field"><label>Communication</label><select id="cp_communication">${['','Verbal','Limited verbal','Non-verbal','Interpreter / communication aid required','Other'].map(v=>`<option ${v===(x.communication_support||'')?'selected':''}>${v}</option>`).join('')}</select></div>
 <div class="field"><label>Medication support</label><select id="cp_medication">${['','Independent','Prompt only','Staff assistance','Full medication administration support'].map(v=>`<option ${v===(x.medication_support||'')?'selected':''}>${v}</option>`).join('')}</select></div>
 <div class="field"><label>BSP / behaviour support</label><select id="cp_bsp">${['','No BSP','BSP in place','Behaviour support required','Other'].map(v=>`<option ${v===(x.bsp_status||'')?'selected':''}>${v}</option>`).join('')}</select></div>
 <div class="field wide"><label>Diet / meal requirements</label><textarea id="cp_diet" placeholder="Diet, allergies, texture modification, fluid restrictions, preferences...">${esc(x.diet_requirements||'')}</textarea></div>
 <div class="field wide"><label>Behaviour support / triggers / de-escalation</label><textarea id="cp_behaviour" placeholder="Known triggers, early warning signs and helpful strategies">${esc(x.behaviour_support||'')}</textarea></div>
 <div class="field wide"><label>Preferred routine</label><textarea id="cp_routine" placeholder="Morning routine, shower preference, meals, sleep, community activities...">${esc(x.preferred_routine||'')}</textarea></div>
 <div class="field wide"><label>What staff must know before shift</label><textarea id="cp_mustknow" placeholder="Critical information staff should review before providing support">${esc(x.staff_must_know||'')}</textarea></div>
 <div class="field"><label>Emergency / family contact</label><textarea id="cp_emergency">${esc(x.emergency_contact||'')}</textarea></div>
 <div class="field"><label>Support coordinator</label><textarea id="cp_coordinator">${esc(x.support_coordinator||'')}</textarea></div>
 <div class="field wide"><label>GP / important clinical contact details</label><textarea id="cp_gp">${esc(x.gp_details||'')}</textarea></div>
 </div>`;}
function clientFormRow(){return {full_name:el('cp_name').value.trim(),site_id:el('cp_site').value||null,risk_level:el('cp_risk').value,support_needs:el('cp_support').value.trim(),support_types:checkedValues('cp_support_types'),key_alerts:checkedValues('cp_alerts'),mobility_support:el('cp_mobility').value||null,communication_support:el('cp_communication').value||null,medication_support:el('cp_medication').value||null,bsp_status:el('cp_bsp').value||null,diet_requirements:el('cp_diet').value.trim()||null,behaviour_support:el('cp_behaviour').value.trim()||null,preferred_routine:el('cp_routine').value.trim()||null,staff_must_know:el('cp_mustknow').value.trim()||null,emergency_contact:el('cp_emergency').value.trim()||null,support_coordinator:el('cp_coordinator').value.trim()||null,gp_details:el('cp_gp').value.trim()||null,care_profile_updated_at:new Date().toISOString(),care_profile_updated_by:profile.id};}
function renderClients(){
 const sm=byId(state.sites), list=authorisedClients();
 el('clients').innerHTML=`${state.mode==='staff'&&!activeTimesheet()?'<div class="card"><b>Clock in required</b><div class="muted">Clients become visible only after clocking in at the relevant site/location.</div></div>':''}
 <div class="card" style="margin-top:14px"><div class="row between wrap"><div><h2>Client Management</h2><div class="muted">Key support needs and alerts are shown here. Open the Care Profile for full details.</div></div>${state.mode==='manager'?'<button class="btn btn-primary" onclick="addClient()">+ Add Client</button>':''}</div>
 <div class="grid g2" style="margin-top:14px">${list.map(x=>{const supports=clientArray(x.support_types),alerts=clientArray(x.key_alerts);return `<div class="card client-summary-card"><div class="row between"><div><h3>${esc(x.full_name)}</h3><div class="muted">🏡 ${esc(sm[x.site_id]?.name||'Not assigned')}</div></div>${pill(x.risk_level||'Low')}</div>
 ${x.staff_must_know?`<div class="client-mustknow"><b>⚠️ Staff must know</b><div>${esc(x.staff_must_know)}</div></div>`:''}
 <div class="client-section"><b>Support</b><div class="client-tags">${supports.length?clientTags(supports.slice(0,5)):'<span class="muted">No support categories selected.</span>'}${supports.length>5?`<span class="client-tag more">+${supports.length-5} more</span>`:''}</div></div>
 ${alerts.length?`<div class="client-section"><b>Key alerts</b><div class="client-tags">${clientTags(alerts,'alert')}</div></div>`:''}
 ${x.support_needs?`<div class="client-section"><div class="muted">${esc(x.support_needs)}</div></div>`:''}
 <div class="row wrap" style="margin-top:12px"><button class="btn btn-primary" onclick="viewClientProfile('${x.id}')">👁 View Care Profile</button>${state.mode==='manager'?`<button class="btn btn-secondary" onclick="editClient('${x.id}')">✏️ Edit</button><button class="btn btn-danger" onclick="deleteClient('${x.id}')">🗑 Delete</button>`:''}</div></div>`}).join('')||'<div class="muted">No authorised clients to show.</div>'}</div></div>`;
}
function viewClientProfile(id){const x=state.clients.find(c=>c.id===id);if(!x)return;const sm=byId(state.sites),supports=clientArray(x.support_types),alerts=clientArray(x.key_alerts);openModal(`${esc(x.full_name)} — Care Profile`,`<div class="client-profile">
 <div class="client-profile-hero"><div><div class="muted">${esc(sm[x.site_id]?.name||'Not assigned')}</div><h2>${esc(x.full_name)}</h2></div>${pill(x.risk_level||'Low')}</div>
 ${x.staff_must_know?`<div class="client-priority"><h3>⚠️ What staff must know before shift</h3><div>${esc(x.staff_must_know)}</div></div>`:''}
 <div class="client-profile-grid">
  <div class="client-profile-box"><h3>🤝 Support Needs</h3><div class="client-tags">${supports.length?clientTags(supports):'<span class="muted">Not recorded.</span>'}</div>${x.support_needs?`<p>${esc(x.support_needs)}</p>`:''}</div>
  <div class="client-profile-box"><h3>🚨 Key Alerts</h3><div class="client-tags">${alerts.length?clientTags(alerts,'alert'):'<span class="muted">No key alerts recorded.</span>'}</div></div>
  <div class="client-profile-box"><h3>♿ Mobility</h3><p>${esc(x.mobility_support||'Not recorded')}</p></div>
  <div class="client-profile-box"><h3>💬 Communication</h3><p>${esc(x.communication_support||'Not recorded')}</p></div>
  <div class="client-profile-box"><h3>💊 Medication Support</h3><p>${esc(x.medication_support||'Not recorded')}</p></div>
  <div class="client-profile-box"><h3>🧠 Behaviour / BSP</h3><p><b>${esc(x.bsp_status||'Not recorded')}</b></p><p>${esc(x.behaviour_support||'')}</p></div>
  <div class="client-profile-box"><h3>🍽️ Diet / Meals</h3><p>${esc(x.diet_requirements||'Not recorded')}</p></div>
  <div class="client-profile-box"><h3>🕒 Preferred Routine</h3><p>${esc(x.preferred_routine||'Not recorded')}</p></div>
  <div class="client-profile-box"><h3>☎️ Emergency / Family</h3><p>${esc(x.emergency_contact||'Not recorded')}</p></div>
  <div class="client-profile-box"><h3>🤝 Support Coordinator</h3><p>${esc(x.support_coordinator||'Not recorded')}</p></div>
  <div class="client-profile-box wide"><h3>🩺 GP / Important Clinical Contacts</h3><p>${esc(x.gp_details||'Not recorded')}</p></div>
 </div>
 ${state.mode==='manager'?`<div class="form-actions"><button class="btn btn-primary" onclick="closeModal();editClient('${x.id}')">✏️ Edit Care Profile</button></div>`:''}</div>`);}
function addClient(){openModal('Add Client & Care Profile',`${clientProfileForm()}<div class="form-actions"><button class="btn btn-primary" onclick="saveClient()">💾 Save Client</button><button class="btn btn-secondary" onclick="closeModal()">Cancel</button></div>`);}
async function saveClient(){const row={...clientFormRow(),active:true};if(!row.full_name)return toast('Enter client name.');const {error}=await sb.from('clients').insert(row);if(error)return toast('Could not save client. Run carehub-client-care-profile.sql in Supabase first. '+error.message);closeModal();await loadAll();renderClients();}
function editClient(id){const x=state.clients.find(c=>c.id===id);if(!x)return;openModal('Edit Client & Care Profile',`${clientProfileForm(x)}<div class="form-actions"><button class="btn btn-primary" onclick="updateClient('${id}')">💾 Save Changes</button><button class="btn btn-secondary" onclick="closeModal()">Cancel</button></div>`);}
async function updateClient(id){const row=clientFormRow();if(!row.full_name)return toast('Enter client name.');const {error}=await sb.from('clients').update(row).eq('id',id);if(error)return toast('Could not update client. Run carehub-client-care-profile.sql in Supabase first. '+error.message);closeModal();await loadAll();renderClients();}
async function deleteClient(id){if(!confirm('Delete this client?'))return;const {error}=await sb.from('clients').delete().eq('id',id);if(error)return toast(error.message);await loadAll();renderClients();}

function renderRoster(){
 const pm=byId(state.staff),sm=byId(state.sites),cm=byId(state.clients),rows=state.mode==='manager'?state.roster:state.roster.filter(x=>x.staff_id===profile.id);
 el('roster').innerHTML=`<div class="roster-tabs"><button class="active" onclick="renderRoster()">📋 View Roster</button>${state.mode==='manager'?'<button onclick="renderRosterMaker()">🗓️ Create Roster</button>':''}</div>
 <div class="card"><div class="row between"><div><h2>Roster & Shifts</h2><div class="muted">Published shifts with exact start and end times.</div></div>${state.mode==='manager'?'<button class="btn btn-primary" onclick="renderRosterMaker()">+ Roster Maker</button>':''}</div>
 <div class="tablewrap"><table><thead><tr><th>Date</th><th>Staff</th><th>Assigned Site</th><th>Client</th><th>Start</th><th>End</th><th>Hours</th><th>Type</th><th>Status</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${fmt(x.shift_date)}</td><td>${esc(pm[x.staff_id]?.full_name||'')}</td><td>${esc(sm[x.site_id]?.name||'')}</td><td>${esc(cm[x.client_id]?.full_name||'—')}</td><td>${formatTime12(x.start_time)}</td><td>${formatTime12(x.end_time)}</td><td>${calcHours(String(x.start_time).slice(0,5),String(x.end_time).slice(0,5))}</td><td>${esc(x.shift_type||'')}</td><td>${pill(x.status||'Rostered')}</td></tr>`).join('')}</tbody></table></div></div>`;
}
function shiftDefaults(type){
 const s=state.settings||{};
 return {
  'Day':[String(s.day_start||'07:00').slice(0,5),String(s.day_end||'15:00').slice(0,5)],
  'Evening':[String(s.evening_start||'15:00').slice(0,5),String(s.evening_end||'23:00').slice(0,5)],
  'Night':[String(s.night_start||'23:00').slice(0,5),String(s.night_end||'07:00').slice(0,5)],
  'Sleepover':[String(s.sleepover_start||'22:00').slice(0,5),String(s.sleepover_end||'07:00').slice(0,5)],
  'Short Shift':['07:00','10:00'],'Custom':['',''],'Off':['','']
 }[type]||['',''];
}
function renderRosterMaker(){
 const week=mondayOf(today), days=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'], workers=state.staff.filter(s=>s.active&&(s.role==='staff'||s.can_work_as_staff));
 el('roster').innerHTML=`<div class="roster-tabs"><button onclick="renderRoster()">📋 View Roster</button><button class="active">🗓️ Create Roster</button></div><div class="card">
 <div class="row between wrap"><div><h2>Create Weekly Roster</h2><div class="muted">Assign staff to a site/house. Client is optional.</div></div><button class="btn btn-primary" onclick="publishRosterMaker()">Publish Roster</button></div>
 <div class="grid g3" style="margin:14px 0"><div class="field"><label>Week Commencing</label><input id="rt_week" type="date" value="${week}"></div><div class="field"><label>Site / House</label><select id="rt_site">${state.sites.filter(s=>s.active).map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div><div class="card"><b>Shift Guide</b><div class="small">Day 7 AM–3 PM • Evening 3 PM–11 PM • Night 11 PM–7 AM • Sleepover 10 PM–7 AM • Short 7 AM–10 AM</div></div></div>
 <div class="tablewrap"><table class="roster-maker-table"><thead><tr><th>Staff</th>${days.map((d,i)=>`<th>${d}<br><span class="muted">${fmt(addDaysISO(week,i))}</span></th>`).join('')}</tr></thead><tbody>
 ${workers.map((s,ri)=>`<tr><td><b>${esc(s.full_name)}</b></td>${days.map((d,di)=>`<td><div class="shift-cell"><select id="rt_type_${ri}_${di}" onchange="applyShiftType(${ri},${di})">${['Off','Day','Evening','Night','Sleepover','Short Shift','Custom'].map(x=>`<option>${x}</option>`).join('')}</select><div class="shift-times"><input id="rt_start_${ri}_${di}" type="time"><input id="rt_end_${ri}_${di}" type="time"></div></div></td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`;
 window._rosterWorkers=workers;
}
function applyShiftType(ri,di){const type=el(`rt_type_${ri}_${di}`).value,[s,e]=shiftDefaults(type);el(`rt_start_${ri}_${di}`).value=s;el(`rt_end_${ri}_${di}`).value=e;}
async function publishRosterMaker(){
 const workers=window._rosterWorkers||[],week=el('rt_week').value,site_id=el('rt_site').value,rows=[];
 workers.forEach((w,ri)=>{for(let di=0;di<7;di++){const type=el(`rt_type_${ri}_${di}`).value,start=el(`rt_start_${ri}_${di}`).value,end=el(`rt_end_${ri}_${di}`).value;if(type!=='Off'&&start&&end)rows.push({staff_id:w.id,site_id,shift_date:addDaysISO(week,di),start_time:start,end_time:end,shift_type:type,status:'Rostered',created_by:profile.id});}});
 if(!rows.length)return toast('No shifts to publish.');
 const {error}=await sb.from('roster_shifts').insert(rows);if(error)return toast(error.message);
 for(const r of rows){await sb.from('staff_notifications').insert({staff_id:r.staff_id,notification_type:'Roster Assignment',message:`New shift: ${fmt(r.shift_date)} ${formatTime12(r.start_time)}–${formatTime12(r.end_time)}`});}
 await loadAll();renderRoster();toast(`${rows.length} shifts published.`);
}
function addShift(){renderRosterMaker();}

async function gps(){return new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(p=>resolve({lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy}),reject,{enableHighAccuracy:true,timeout:12000,maximumAge:0}));}
function siteGeofenceReady(site){return site&&Number.isFinite(Number(site.latitude))&&Number.isFinite(Number(site.longitude));}
function distanceMeters(aLat,aLng,bLat,bLng){const R=6371000,toRad=x=>x*Math.PI/180;const dLat=toRad(bLat-aLat),dLng=toRad(bLng-aLng),q=Math.sin(dLat/2)**2+Math.cos(toRad(aLat))*Math.cos(toRad(bLat))*Math.sin(dLng/2)**2;return 2*R*Math.atan2(Math.sqrt(q),Math.sqrt(1-q));}
async function verifyClockInLocation(site){
 if(!site)return {ok:false,message:'The shift site/location could not be found.'};
 if(!siteGeofenceReady(site))return {ok:false,message:`GPS clock-in has not been configured for ${site.name}. Ask a manager to open Sites / Houses and set the site GPS location.`};
 let g;try{g=await gps()}catch(e){return {ok:false,message:'CareHub needs your location to clock in. Allow location access in your browser/device settings and try again.'};}
 const dist=distanceMeters(g.lat,g.lng,Number(site.latitude),Number(site.longitude)),radius=Math.max(30,Number(site.geofence_radius_m||150)),accuracy=Number(g.accuracy||0),allowed=radius+Math.min(accuracy,100);
 if(dist>allowed)return {ok:false,g,distance:dist,message:`You are about ${Math.round(dist)} m from ${site.name}. Clock in is allowed within ${radius} m of the registered address. Move closer to the site/client address or contact a manager.`};
 return {ok:true,g,distance:dist,radius};
}
function shiftClientForTimesheet(t){if(!t)return null;const rid=t.roster_shift_id?state.roster.find(r=>r.id===t.roster_shift_id):null;return state.clients.find(c=>c.id===(t.client_id||rid?.client_id))||null;}
function recordsDuringShift(rows,t,clientId=null){if(!t)return [];const a=new Date(t.clock_in).getTime(),b=t.clock_out?new Date(t.clock_out).getTime():Date.now();return (rows||[]).filter(x=>x.staff_id===t.staff_id&&(!clientId||x.client_id===clientId)&&new Date(x.created_at).getTime()>=a-60000&&new Date(x.created_at).getTime()<=b+60000);}
function shiftRelevantClients(t){if(!t)return [];const direct=shiftClientForTimesheet(t);if(direct)return [direct];return state.clients.filter(c=>c.active&&c.site_id===t.site_id);}
function medicationRequiredClients(t){return shiftRelevantClients(t).filter(c=>['Medium','High'].includes(c.risk_level)&&String(c.medication_support||'').trim()&&c.medication_support!=='Independent');}
function isHouseShift(t){const site=state.sites.find(s=>s.id===t?.site_id);return !!site&&(site.location_kind==='shared_house'||site.site_type==='SIL House');}
function shiftChecklist(t){
 const relevant=shiftRelevantClients(t);
 const noteOk=recordsDuringShift(state.notes,t).length>0;
 const medClients=medicationRequiredClients(t),medMissing=medClients.filter(c=>recordsDuringShift(state.meds,t,c.id).length===0);
 const handoverOk=!isHouseShift(t)||recordsDuringShift(state.handovers,t).some(h=>h.site_id===t.site_id);
 return {noteOk,medClients,medMissing,medOk:medMissing.length===0,handoverOk,all:noteOk&&medMissing.length===0&&handoverOk};
}
function openClockOutChecklist(){const t=activeTimesheet();if(!t)return;const ck=shiftChecklist(t),cm=byId(state.clients),site=state.sites.find(s=>s.id===t.site_id);openModal('Before Clock Out',`<div class="care-banner"><b>Shift completion checklist</b><div class="small">CareHub checks required documentation before this shift can be completed.</div></div>
 <div class="record-list" style="margin-top:14px">
  <div class="record-card"><div class="row between"><b>📝 Progress note</b>${pill(ck.noteOk?'Done':'Required')}</div><div class="small muted">At least one progress note is required for the shift before clock out.</div>${!ck.noteOk?'<div class="record-actions"><button class="btn btn-primary" onclick="closeModal();show(\'notes\')">Add Progress Note</button></div>':''}</div>
  <div class="record-card"><div class="row between"><b>💊 Medication documentation</b>${pill(ck.medOk?'Done':'Required')}</div><div class="small muted">Required for Medium/High-risk clients with staff medication support during this shift.${ck.medMissing.length?` Missing: ${ck.medMissing.map(c=>esc(c.full_name)).join(', ')}`:''}</div>${!ck.medOk?'<div class="record-actions"><button class="btn btn-primary" onclick="closeModal();show(\'medication\')">Add Medication Record</button></div>':''}</div>
  <div class="record-card"><div class="row between"><b>🔄 House handover</b>${pill(ck.handoverOk?'Done':'Required')}</div><div class="small muted">${isHouseShift(t)?`A house/site handover is required for ${esc(site?.name||'this house')}. Client is optional.`:'Not required for this shift type.'}</div>${!ck.handoverOk?'<div class="record-actions"><button class="btn btn-primary" onclick="closeModal();show(\'handover\')">Add Handover</button></div>':''}</div>
 </div><div class="form-actions">${ck.all?'<button class="btn btn-danger" onclick="closeModal();completeClockOut()">Clock Out Now</button>':'<button class="btn btn-secondary" onclick="closeModal()">Close</button>'}</div>`);}
function openUnrosteredClockIn(){
 if(activeTimesheet())return toast('You are already clocked in.');
 const sites=state.sites.filter(s=>s.active),clients=state.clients.filter(c=>c.active);
 openModal('Clock In Without Roster',`<div class="care-banner"><b>No rostered shift found</b><div class="small">Select the site/house or client you are working for. This clock-in will be marked as unrostered and can be reviewed by a manager.</div></div>
 <div class="care-form-grid" style="margin-top:14px">
  <div class="field"><label>Site / House</label><select id="ur_site" onchange="filterUnrosteredClients()"><option value="">Select site / house</option>${sites.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>
  <div class="field"><label>Client (optional if site selected)</label><select id="ur_client" onchange="syncUnrosteredSiteFromClient()"><option value="">Select client</option>${clients.map(c=>`<option value="${c.id}" data-site="${c.site_id||''}">${esc(c.full_name)}</option>`).join('')}</select></div>
  <div class="field wide"><label>Reason / work description</label><textarea id="ur_reason" placeholder="Why are you working without a rostered shift? e.g. emergency cover, client appointment, manager requested cover..."></textarea></div>
 </div>
 <div class="form-actions"><button class="btn btn-green" onclick="saveUnrosteredClockIn()">Clock In</button><button class="btn btn-secondary" onclick="closeModal()">Cancel</button></div>`);
}
function filterUnrosteredClients(){
 const site=el('ur_site')?.value||'',sel=el('ur_client');if(!sel)return;
 [...sel.options].forEach(o=>{if(!o.value)return;o.hidden=!!site&&o.dataset.site!==site;});
 if(sel.selectedOptions[0]?.hidden)sel.value='';
}
function syncUnrosteredSiteFromClient(){
 const sel=el('ur_client'),opt=sel?.selectedOptions?.[0];if(opt?.value&&opt.dataset.site&&el('ur_site'))el('ur_site').value=opt.dataset.site;
}
async function saveUnrosteredClockIn(){
 if(activeTimesheet())return toast('You are already clocked in.');
 const client_id=el('ur_client')?.value||null,client=client_id?state.clients.find(c=>c.id===client_id):null;
 const site_id=el('ur_site')?.value||client?.site_id||null,reason=el('ur_reason')?.value.trim()||'';
 if(!site_id&&!client_id)return toast('Select a site/house or client.');
 if(!reason)return toast('Enter a short reason for the unrostered shift.');
 const site=state.sites.find(s=>s.id===site_id),loc=await verifyClockInLocation(site);if(!loc.ok)return toast(loc.message);
 const g=loc.g,row={staff_id:profile.id,site_id,client_id,roster_shift_id:null,clock_in:new Date().toISOString(),clock_in_lat:g?.lat||null,clock_in_lng:g?.lng||null,clock_in_accuracy:g?.accuracy||null,status:'Open',unrostered:true,unrostered_reason:reason};
 const {data:ts,error}=await sb.from('timesheets').insert(row).select().single();if(error)return toast(error.message);
 const req={staff_id:profile.id,client_id,site_id,timesheet_id:ts.id,status:'Pending',reason,requested_at:new Date().toISOString()};
 const {error:reqErr}=await sb.from('client_access_requests').insert(req);if(reqErr){console.warn('access request',reqErr.message);toast('Clocked in, but the client access request could not be created. Please contact a manager.');}
 const managers=state.staff.filter(x=>x.active&&['manager','admin'].includes(x.role));
 for(const m of managers){await sb.from('staff_notifications').insert({staff_id:m.id,notification_type:'Client Access Request',message:`${profile.full_name||'A support worker'} requests temporary client access for unrostered work: ${reason}`}).catch(()=>{});}
 closeModal();await loadAll();renderAll();show('dashboard');toast(`Clocked in at ${site?.name||'site'}. Client care information remains locked until manager approval.`);
}
async function approveClientAccess(id){
 if(state.mode!=='manager')return;
 const expires=new Date(Date.now()+12*60*60*1000).toISOString();
 const {error}=await sb.from('client_access_requests').update({status:'Approved',approved_by:profile.id,approved_at:new Date().toISOString(),expires_at:expires}).eq('id',id);
 if(error)return toast(error.message);await loadAll();renderAll();toast('Temporary client access approved for this unrostered shift.');
}
async function denyClientAccess(id){
 if(state.mode!=='manager')return;
 const {error}=await sb.from('client_access_requests').update({status:'Denied',approved_by:profile.id,approved_at:new Date().toISOString(),expires_at:null}).eq('id',id);
 if(error)return toast(error.message);await loadAll();renderAll();toast('Client access request denied.');
}
async function requestClientAccessAgain(){
 const t=activeTimesheet();if(!t?.unrostered)return;
 const latest=currentAccessRequest();
 const req={staff_id:profile.id,client_id:t.client_id||latest?.client_id||null,site_id:t.site_id||latest?.site_id||null,timesheet_id:t.id,status:'Pending',reason:t.unrostered_reason||latest?.reason||'Unrostered work',requested_at:new Date().toISOString()};
 const {error}=await sb.from('client_access_requests').insert(req);if(error)return toast(error.message);await loadAll();renderAll();show('dashboard');toast('Access request sent to a manager.');
}

function rosterShiftChoiceCard(r){
 const site=state.sites.find(s=>s.id===r.site_id),client=state.clients.find(c=>c.id===r.client_id),w=localShiftWindow(r);
 return `<div class="record-card"><div class="row between wrap"><div><b>${esc(site?.name||'Site')}</b><div class="muted">${r.shift_date} • ${formatTime12(r.start_time)}–${formatTime12(r.end_time)}${client?` • ${esc(client.full_name)}`:''}</div></div><button class="btn btn-green" onclick="confirmRosteredClockIn('${r.id}')">Select Shift</button></div></div>`;
}
function openRosteredClockInChooser(rows){
 openModal('Choose Current Shift',`<div class="care-banner"><b>Select the shift you are clocking in for</b><div class="small">CareHub found more than one rostered shift that could be active now. Choose the correct shift before GPS verification.</div></div><div class="record-list" style="margin-top:14px">${rows.map(rosterShiftChoiceCard).join('')}</div><div class="form-actions"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button></div>`);
}
async function confirmRosteredClockIn(rosterId){
 if(activeTimesheet())return toast('You are already clocked in.');
 const r=state.roster.find(x=>x.id===rosterId&&x.staff_id===profile.id);if(!r)return toast('Rostered shift could not be found.');
 const site=state.sites.find(s=>s.id===r.site_id),client=state.clients.find(c=>c.id===r.client_id);
 closeModal();
 const loc=await verifyClockInLocation(site);if(!loc.ok)return toast(loc.message);
 const distance=Math.round(loc.distance||0);
 openModal('Confirm Clock In',`<div class="care-banner"><b>You are clocking in for:</b></div><div class="record-card" style="margin-top:14px"><h3>${esc(site?.name||'Site')}</h3><div><b>Shift:</b> ${formatTime12(r.start_time)}–${formatTime12(r.end_time)}</div>${client?`<div><b>Client:</b> ${esc(client.full_name)}</div>`:''}<div><b>Distance from site:</b> ${distance} m</div></div><div class="form-actions"><button class="btn btn-green" onclick="saveRosteredClockIn('${r.id}',${Number(loc.g?.lat||0)},${Number(loc.g?.lng||0)},${Number(loc.g?.accuracy||0)})">Confirm Clock In</button><button class="btn btn-secondary" onclick="closeModal()">Cancel</button></div>`);
}
async function saveRosteredClockIn(rosterId,lat,lng,accuracy){
 if(activeTimesheet())return toast('You are already clocked in.');
 const r=state.roster.find(x=>x.id===rosterId&&x.staff_id===profile.id);if(!r)return toast('Rostered shift could not be found.');
 const site=state.sites.find(s=>s.id===r.site_id);
 const {error}=await sb.from('timesheets').insert({staff_id:profile.id,site_id:r.site_id,client_id:r.client_id||null,roster_shift_id:r.id,clock_in:new Date().toISOString(),clock_in_lat:lat||null,clock_in_lng:lng||null,clock_in_accuracy:accuracy||null,status:'Open',unrostered:false});
 if(error)return toast(error.message);closeModal();await loadAll();renderAll();show('dashboard');toast(`Clocked in at ${site?.name||'authorised location'}.`);
}
async function quickClockIn(){
 if(activeTimesheet())return toast('You are already clocked in.');
 const candidates=rosterClockInCandidates();
 if(candidates.length===0)return openUnrosteredClockIn();
 if(candidates.length>1)return openRosteredClockInChooser(candidates);
 return confirmRosteredClockIn(candidates[0].id);
}
async function clockOut(){const t=activeTimesheet();if(!t)return toast('No open shift.');const ck=shiftChecklist(t);if(!ck.all)return openClockOutChecklist();return completeClockOut();}
async function completeClockOut(){
 const t=activeTimesheet();if(!t)return toast('No open shift.');const ck=shiftChecklist(t);if(!ck.all)return openClockOutChecklist();
 let g=null;try{g=await gps()}catch(e){}
 const {error}=await sb.from('timesheets').update({clock_out:new Date().toISOString(),clock_out_lat:g?.lat||null,clock_out_lng:g?.lng||null,clock_out_accuracy:g?.accuracy||null,status:'Pending'}).eq('id',t.id);
 if(error)return toast(error.message);
 if(t.unrostered)await sb.from('client_access_requests').update({expires_at:new Date().toISOString()}).eq('timesheet_id',t.id).eq('status','Approved');
 await loadAll();renderAll();show('dashboard');toast('Shift completed and timesheet submitted for approval.');
}
function timesheetHours(x){
 const ci=x?.clock_in?new Date(x.clock_in):null,co=x?.clock_out?new Date(x.clock_out):null;
 return ci&&co&&co>ci?(co-ci)/3600000:0;
}
function timesheetDayInfo(x){
 const d=x?.clock_in?new Date(x.clock_in):null;
 if(!d)return {day:'—',category:'—'};
 const day=d.toLocaleDateString('en-AU',{weekday:'long'}),n=d.getDay();
 return {day,category:n===6?'Saturday':n===0?'Sunday':'Weekday'};
}
function timesheetSummary(rows){
 const pm=byId(state.staff), rosterMap=byId(state.roster), map={};
 rows.forEach(x=>{
   const id=x.staff_id||'unknown', worker=pm[id]||{};
   if(!map[id])map[id]={staff:worker.full_name||'Unknown',weekday:0,saturday:0,sunday:0,total:0,shifts:0,km:0,reimbursement:0,weekdayPay:0,saturdayPay:0,sundayPay:0,sleepoverPay:0,sleepovers:0,estimatedPay:0,weekdayRate:staffRate(worker,'weekday_rate'),saturdayRate:staffRate(worker,'saturday_rate'),sundayRate:staffRate(worker,'sunday_rate'),kmRate:staffRate(worker,'km_rate'),sleepoverRate:staffRate(worker,'sleepover_rate')};
   const m=map[id],h=timesheetHours(x),cat=timesheetDayInfo(x).category.toLowerCase();
   if(cat==='weekday'){m.weekday+=h;m.weekdayPay+=h*m.weekdayRate;}else if(cat==='saturday'){m.saturday+=h;m.saturdayPay+=h*m.saturdayRate;}else if(cat==='sunday'){m.sunday+=h;m.sundayPay+=h*m.sundayRate;}
   m.total+=h;if(h>0)m.shifts++;
   const km=Number(x.km_travelled||0);m.km+=km;m.reimbursement+=km*m.kmRate;
   const shift=x.roster_shift_id?rosterMap[x.roster_shift_id]:null;if(shift?.shift_type==='Sleepover'&&h>0){m.sleepovers++;m.sleepoverPay+=m.sleepoverRate;}
 });
 Object.values(map).forEach(m=>{m.estimatedPay=m.weekdayPay+m.saturdayPay+m.sundayPay+m.sleepoverPay+m.reimbursement;});
 return Object.values(map).sort((a,b)=>a.staff.localeCompare(b.staff));
}
function renderTimesheets(){
 const pm=byId(state.staff),sm=byId(state.sites),rows=(state.mode==='manager'?state.timesheets:state.timesheets.filter(x=>x.staff_id===profile.id)).slice().sort((a,b)=>new Date(b.clock_in)-new Date(a.clock_in));
 const sums=timesheetSummary(rows);
 const managerTools=state.mode==='manager'?`<div class="row wrap"><button class="btn btn-primary" onclick="addManualTimesheet()">➕ Add Manual Timesheet</button><span class="muted">Use this when a staff member forgot to clock in or clock out.</span></div>`:'';
 el('timesheets').innerHTML=`${state.mode==='staff'?`<div class="card"><h2>My Clock</h2><h3>${esc(todayRosterSite()?.name||'No rostered shift today')}</h3><div class="muted" style="margin-bottom:8px">${todayRosterSite()?'Clock in to your rostered site.':'Not rostered? You can still clock in by selecting the site/house or client you are working for.'}</div><div class="row wrap"><button class="btn btn-green" onclick="quickClockIn()" ${activeTimesheet()?'disabled':''}>Clock In</button><button class="btn btn-danger" onclick="clockOut()" ${!activeTimesheet()?'disabled':''}>Clock Out</button></div></div>`:''}
 <div class="card" style="margin-top:14px"><div class="section-title"><div><h2>Hours Summary</h2><div class="muted">Weekday, Saturday and Sunday hours are calculated separately for payroll reporting.</div></div></div>
 <div class="tablewrap" style="margin-top:14px"><table><thead><tr><th>Staff</th><th>Shifts</th><th>Weekday Hours</th><th>Saturday Hours</th><th>Sunday Hours</th><th>Total Hours</th><th>Total KM</th><th>KM Rate</th><th>KM Reimbursement</th><th>Estimated Pay</th></tr></thead><tbody>${sums.map(s=>`<tr><td><b>${esc(s.staff)}</b></td><td>${s.shifts}</td><td>${s.weekday.toFixed(2)}</td><td>${s.saturday.toFixed(2)}</td><td>${s.sunday.toFixed(2)}</td><td><b>${s.total.toFixed(2)}</b></td><td><b>${s.km.toFixed(1)}</b></td><td>${rateMoney(s.kmRate)}/km</td><td>${s.kmRate>0?'$'+s.reimbursement.toFixed(2):'—'}</td><td><b>${s.estimatedPay>0?'$'+s.estimatedPay.toFixed(2):'—'}</b></td></tr>`).join('')||'<tr><td colspan="10" class="muted">No completed hours to summarise.</td></tr>'}</tbody></table></div><div class="muted" style="margin-top:8px">Estimated Pay uses each staff member's individual rates (or organisation defaults when an individual rate is blank). Sleepover allowance is included when the timesheet is linked to a Sleepover roster shift.</div></div>
 <div class="card" style="margin-top:14px"><div class="section-title"><div><h2>Timesheets</h2><div class="muted">Clock-in/out records, day category, worked hours and manager corrections.</div></div>${managerTools}</div>
 <div class="tablewrap" style="margin-top:14px"><table><thead><tr><th>Staff</th><th>Site</th><th>Client</th><th>Source</th><th>Day</th><th>Category</th><th>Clock In</th><th>Clock Out</th><th>Hours</th><th>KM</th><th>Travel Purpose</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows.map(x=>{
   const ci=x.clock_in?new Date(x.clock_in):null, co=x.clock_out?new Date(x.clock_out):null, info=timesheetDayInfo(x),hrs=timesheetHours(x);
   const actions=`<div class="row wrap"><button class="btn btn-view" onclick="viewTimesheet('${x.id}')">👁 View</button>${state.mode==='staff'&&x.staff_id===profile.id?`<button class="btn btn-secondary" onclick="editTravel('${x.id}')">🚗 KM / Travel</button>`:''}${state.mode==='manager'?`<button class="btn btn-edit" onclick="editTimesheet('${x.id}')">✏️ Edit</button><button class="btn btn-danger" onclick="deleteTimesheet('${x.id}')">🗑 Delete</button>${x.status==='Pending'?`<button class="btn btn-green" onclick="approveTS('${x.id}')">✓ Approve</button>`:''}`:''}</div>`;
   return `<tr><td>${esc(pm[x.staff_id]?.full_name||'')}</td><td>${esc(sm[x.site_id]?.name||'')}</td><td>${esc(byId(state.clients)[x.client_id]?.full_name||'—')}</td><td>${x.unrostered?'<span class="pill warn">Unrostered</span>':'<span class="pill ok">Rostered</span>'}</td><td>${esc(info.day)}</td><td>${esc(info.category)}</td><td>${ci?ci.toLocaleString('en-AU'):'—'}</td><td>${co?co.toLocaleString('en-AU'):'Active'}</td><td>${co?hrs.toFixed(2):'—'}</td><td>${Number(x.km_travelled||0).toFixed(1)}</td><td>${esc(x.travel_purpose||'—')}</td><td>${pill(x.status||'Open')}</td><td>${actions}</td></tr>`;
 }).join('')||'<tr><td colspan="13" class="muted">No timesheets found.</td></tr>'}</tbody></table></div></div>`;
}

function localDateTimeValue(iso){if(!iso)return '';const d=new Date(iso);const pad=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;}
function timesheetFormBody(x={}){
 const staff=state.staff.filter(s=>s.active&&(s.role==='staff'||s.can_work_as_staff));
 const sites=state.sites.filter(s=>s.active);
 return `<div class="care-form-grid">
  <div class="field"><label>Staff member</label><select id="ts_staff">${staff.map(s=>`<option value="${s.id}" ${s.id===x.staff_id?'selected':''}>${esc(s.full_name)}</option>`).join('')}</select></div>
  <div class="field"><label>Site / House</label><select id="ts_site">${sites.map(s=>`<option value="${s.id}" ${s.id===x.site_id?'selected':''}>${esc(s.name)}</option>`).join('')}</select></div>
  <div class="field"><label>Clock In</label><input id="ts_clock_in" type="datetime-local" value="${localDateTimeValue(x.clock_in)}"></div>
  <div class="field"><label>Clock Out</label><input id="ts_clock_out" type="datetime-local" value="${localDateTimeValue(x.clock_out)}"></div>
  <div class="field"><label>Status</label><select id="ts_status">${['Open','Pending','Approved'].map(v=>`<option ${v===(x.status||'Pending')?'selected':''}>${v}</option>`).join('')}</select></div>
  <div class="field"><label>KM Travelled</label><input id="ts_km" type="number" step="0.1" min="0" value="${esc(x.km_travelled??'')}" placeholder="e.g. 18.5"></div>
  <div class="field"><label>Travel Purpose</label><select id="ts_travel_purpose">${['','Client Transport','Shopping','Medical Appointment','Community Access','Client-related Errand','Other'].map(v=>`<option value="${v}" ${v===(x.travel_purpose||'')?'selected':''}>${v||'Select purpose'}</option>`).join('')}</select></div>
  <div class="field"><label>From</label><input id="ts_travel_from" value="${esc(x.travel_from||'')}" placeholder="Starting location"></div>
  <div class="field"><label>To</label><input id="ts_travel_to" value="${esc(x.travel_to||'')}" placeholder="Destination"></div>
  <div class="field" style="grid-column:1/-1"><label>Travel Notes</label><textarea id="ts_travel_notes" placeholder="Optional travel details">${esc(x.travel_notes||'')}</textarea></div>
 </div>`;
}
function addManualTimesheet(){if(state.mode!=='manager')return toast('Manager access required.');openModal('Add Manual Timesheet',`${timesheetFormBody({status:'Pending'})}<div class="care-banner" style="margin-top:12px"><b>Manager correction</b><div class="small">Enter the actual shift times when a staff member forgot to clock in or clock out. Check the times before saving.</div></div><div class="form-actions"><button class="btn btn-primary" onclick="saveManualTimesheet()">💾 Save Timesheet</button></div>`);}
async function saveManualTimesheet(){
 if(state.mode!=='manager')return;
 const clockIn=el('ts_clock_in').value, clockOut=el('ts_clock_out').value;
 if(!clockIn)return toast('Clock In date and time is required.');
 if(clockOut&&new Date(clockOut)<=new Date(clockIn))return toast('Clock Out must be after Clock In. For an overnight shift, select the next day.');
 const status=el('ts_status').value;
 const row={staff_id:el('ts_staff').value,site_id:el('ts_site').value,clock_in:new Date(clockIn).toISOString(),clock_out:clockOut?new Date(clockOut).toISOString():null,status,km_travelled:Number(el('ts_km')?.value||0),travel_purpose:el('ts_travel_purpose')?.value||null,travel_from:el('ts_travel_from')?.value.trim()||null,travel_to:el('ts_travel_to')?.value.trim()||null,travel_notes:el('ts_travel_notes')?.value.trim()||null};
 if(status==='Approved'){row.approved_by=profile.id;row.approved_at=new Date().toISOString();}
 const {error}=await sb.from('timesheets').insert(row);if(error)return toast(error.message);closeModal();await loadAll();renderTimesheets();renderDashboard();toast('Manual timesheet added.');
}
function viewTimesheet(id){const x=state.timesheets.find(t=>t.id===id);if(!x)return;const pm=byId(state.staff),sm=byId(state.sites),ci=x.clock_in?new Date(x.clock_in):null,co=x.clock_out?new Date(x.clock_out):null;const hrs=ci&&co?((co-ci)/3600000).toFixed(2):'—';openModal('Timesheet Details',`<div class="record-card"><div class="item"><b>Staff</b><div>${esc(pm[x.staff_id]?.full_name||'')}</div></div><div class="item"><b>Site / House</b><div>${esc(sm[x.site_id]?.name||'')}</div></div><div class="item"><b>Client</b><div>${esc(byId(state.clients)[x.client_id]?.full_name||'—')}</div></div><div class="item"><b>Shift Source</b><div>${x.unrostered?'Unrostered / direct clock-in':'Rostered shift'}</div></div>${x.unrostered_reason?`<div class="item"><b>Unrostered Reason</b><div>${esc(x.unrostered_reason)}</div></div>`:''}<div class="item"><b>Clock In</b><div>${ci?ci.toLocaleString('en-AU'):'—'}</div></div><div class="item"><b>Clock Out</b><div>${co?co.toLocaleString('en-AU'):'Active / not recorded'}</div></div><div class="item"><b>Total Hours</b><div>${hrs}</div></div><div class="item"><b>KM Travelled</b><div>${Number(x.km_travelled||0).toFixed(1)} km</div></div><div class="item"><b>Travel Purpose</b><div>${esc(x.travel_purpose||'—')}</div></div><div class="item"><b>Route</b><div>${esc(x.travel_from||'—')} → ${esc(x.travel_to||'—')}</div></div><div class="item"><b>Travel Notes</b><div>${esc(x.travel_notes||'—')}</div></div><div class="item"><b>Status</b><div>${esc(x.status||'Open')}</div></div></div>`);}
function editTimesheet(id){if(state.mode!=='manager')return toast('Manager access required.');const x=state.timesheets.find(t=>t.id===id);if(!x)return;openModal('Edit Timesheet',`${timesheetFormBody(x)}<div class="form-actions"><button class="btn btn-primary" onclick="saveTimesheetEdit('${id}')">💾 Save Changes</button></div>`);}
async function saveTimesheetEdit(id){
 const clockIn=el('ts_clock_in').value,clockOut=el('ts_clock_out').value;if(!clockIn)return toast('Clock In is required.');if(clockOut&&new Date(clockOut)<=new Date(clockIn))return toast('Clock Out must be after Clock In.');
 const status=el('ts_status').value;const row={staff_id:el('ts_staff').value,site_id:el('ts_site').value,clock_in:new Date(clockIn).toISOString(),clock_out:clockOut?new Date(clockOut).toISOString():null,status,km_travelled:Number(el('ts_km')?.value||0),travel_purpose:el('ts_travel_purpose')?.value||null,travel_from:el('ts_travel_from')?.value.trim()||null,travel_to:el('ts_travel_to')?.value.trim()||null,travel_notes:el('ts_travel_notes')?.value.trim()||null};
 if(status==='Approved'){row.approved_by=profile.id;row.approved_at=new Date().toISOString();}else{row.approved_by=null;row.approved_at=null;}
 const {error}=await sb.from('timesheets').update(row).eq('id',id);if(error)return toast(error.message);closeModal();await loadAll();renderTimesheets();renderDashboard();toast('Timesheet updated.');
}
function editTravel(id){
 const x=state.timesheets.find(t=>t.id===id);if(!x)return;
 if(state.mode!=='manager'&&x.staff_id!==profile.id)return toast('You can only update travel on your own timesheet.');
 openModal('KM / Client Travel',`<div class="care-form-grid"><div class="field"><label>KM Travelled</label><input id="travel_km" type="number" step="0.1" min="0" value="${esc(x.km_travelled??'')}"></div><div class="field"><label>Travel Purpose</label><select id="travel_purpose">${['','Client Transport','Shopping','Medical Appointment','Community Access','Client-related Errand','Other'].map(v=>`<option value="${v}" ${v===(x.travel_purpose||'')?'selected':''}>${v||'Select purpose'}</option>`).join('')}</select></div><div class="field"><label>From</label><input id="travel_from" value="${esc(x.travel_from||'')}"></div><div class="field"><label>To</label><input id="travel_to" value="${esc(x.travel_to||'')}"></div><div class="field" style="grid-column:1/-1"><label>Travel Notes</label><textarea id="travel_notes">${esc(x.travel_notes||'')}</textarea></div></div><div class="form-actions"><button class="btn btn-primary" onclick="saveTravel('${id}')">💾 Save KM / Travel</button></div>`);
}
async function saveTravel(id){
 const x=state.timesheets.find(t=>t.id===id);if(!x)return; if(state.mode!=='manager'&&x.staff_id!==profile.id)return toast('Not authorised.');
 const row={km_travelled:Number(el('travel_km').value||0),travel_purpose:el('travel_purpose').value||null,travel_from:el('travel_from').value.trim()||null,travel_to:el('travel_to').value.trim()||null,travel_notes:el('travel_notes').value.trim()||null};
 const {error}=await sb.from('timesheets').update(row).eq('id',id);if(error)return toast(error.message);closeModal();await loadAll();renderTimesheets();toast('KM / travel updated.');
}
async function deleteTimesheet(id){if(state.mode!=='manager')return toast('Manager access required.');const x=state.timesheets.find(t=>t.id===id);if(!x)return;if(!confirm('Delete this timesheet? This cannot be undone.'))return;const {error}=await sb.from('timesheets').delete().eq('id',id);if(error)return toast(error.message);await loadAll();renderTimesheets();renderDashboard();}
async function approveTS(id){const {error}=await sb.from('timesheets').update({status:'Approved',approved_by:profile.id,approved_at:new Date().toISOString()}).eq('id',id);if(error)return toast(error.message);await loadAll();renderTimesheets();renderDashboard();}

function requireClockIn(){if(state.mode==='staff'&&!documentationTimesheet()){toast('Clock in at your rostered site first.');return false;}if(state.mode==='staff'&&activeTimesheet()?.unrostered&&!unrosteredAccessApproved()){toast('Manager approval is required before accessing client care information for an unrostered shift.');return false;}return true;}
function canModifyCareRecord(x){return state.mode==='manager'||x.staff_id===profile.id;}
function careClientOptions(list,selected=''){return list.map(c=>`<option value="${c.id}" ${c.id===selected?'selected':''}>${esc(c.full_name)}</option>`).join('');}

function noteTimesheet(x){if(x.timesheet_id)return state.timesheets.find(t=>t.id===x.timesheet_id)||null;const created=new Date(x.created_at).getTime();return state.timesheets.find(t=>t.staff_id===x.staff_id&&t.site_id===x.site_id&&created>=new Date(t.clock_in).getTime()-60000&&created<=(t.clock_out?new Date(t.clock_out).getTime():Date.now())+60000)||null;}
function noteShiftLabel(x){const t=noteTimesheet(x);if(!t)return 'Shift time unavailable';const a=new Date(t.clock_in),b=t.clock_out?new Date(t.clock_out):null,h=b?timesheetHours(t):Math.max(0,(Date.now()-a.getTime())/3600000);return `${a.toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'})}–${b?b.toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'}):'Current'} • ${h.toFixed(2)} hrs`;}
function renderNotes(){
 const list=authorisedClients(),cm=byId(state.clients),pm=byId(state.staff),sm=byId(state.sites),visible=(state.mode==='manager'?state.notes:state.notes.filter(n=>list.some(c=>c.id===n.client_id))).slice().sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
 const locked=state.mode==='staff'&&!documentationTimesheet();
 el('notes').innerHTML=`<div class="care-page">
 ${locked?'<div class="care-banner"><b>Clock in required</b><div class="small">Progress notes are available only for clients at your current clocked-in site/location.</div></div>':`
 <div class="card care-form-card"><div class="section-title"><div><h2>Add Progress Note</h2><div class="muted">A progress note is required before clock out. Shift time and worked hours are linked automatically.</div></div></div>
   <div class="care-form-grid" style="margin-top:14px">
    <div class="field"><label>Client</label><select id="pn_client">${careClientOptions(list)}</select></div>
    <div class="field"><label>Note Type</label><select id="pn_type"><option>General Progress Note</option><option>Personal Care</option><option>Community Access</option><option>Behaviour</option><option>Health Observation</option><option>Medication Support</option><option>Appointment / Community</option></select></div>
    <div class="field wide"><label>Progress Note</label><textarea id="pn_note" placeholder="Enter clear, factual progress notes for this shift..."></textarea></div>
   </div><div class="form-actions"><button class="btn btn-primary" onclick="saveNote()">💾 Save Note</button></div>
 </div>`}
 <div class="card"><div class="section-title"><div><h2>Previous Progress Notes</h2><div class="muted">Staff, site, shift start/end and worked hours are shown for each note.</div></div><span class="pill info">${visible.length} record${visible.length===1?'':'s'}</span></div>
  <div class="record-list" style="margin-top:12px">${visible.map(x=>`<div class="record-card"><div class="record-head"><div><div class="record-title">${esc(cm[x.client_id]?.full_name||'Client')} • ${esc(x.note_type||'General Progress Note')}</div><div class="muted">🏡 ${esc(sm[x.site_id]?.name||'Site')} • ⏱️ ${esc(noteShiftLabel(x))}</div><div class="muted">${esc(pm[x.staff_id]?.full_name||'')} • ${new Date(x.created_at).toLocaleString('en-AU')}</div></div></div><div class="record-body">${esc(x.note||'')}</div><div class="record-actions"><button class="btn btn-view" onclick="viewNote('${x.id}')">👁 View</button>${canModifyCareRecord(x)?`<button class="btn btn-edit" onclick="editNote('${x.id}')">✏️ Edit</button><button class="btn btn-danger" onclick="deleteNote('${x.id}')">🗑 Delete</button>`:''}</div></div>`).join('')||'<div class="care-empty">No relevant progress notes yet.</div>'}</div>
 </div></div>`;
}
async function saveNote(){
 if(!requireClockIn())return;const t=documentationTimesheet();
 const c=el('pn_client')?.value,note=el('pn_note')?.value.trim();if(!c)return toast('Select a client.');if(!note)return toast('Enter a progress note.');
 const client=state.clients.find(x=>x.id===c);const {error}=await sb.from('progress_notes').insert({client_id:c,site_id:client?.site_id||t?.site_id||null,staff_id:profile.id,timesheet_id:t?.id||null,note_type:el('pn_type').value,note});
 if(error)return toast('Could not save progress note. Run carehub-shift-compliance-handover-geofence.sql first. '+error.message);await loadAll();renderNotes();toast('Progress note saved and linked to this shift.');
}
function viewNote(id){const x=state.notes.find(n=>n.id===id),cm=byId(state.clients),pm=byId(state.staff),sm=byId(state.sites),t=noteTimesheet(x);if(!x)return;openModal('Progress Note',`<div class="record-card"><h3>${esc(cm[x.client_id]?.full_name||'Client')}</h3><div class="record-body"><b>Staff:</b> ${esc(pm[x.staff_id]?.full_name||'—')}<br><b>Site:</b> ${esc(sm[x.site_id]?.name||'—')}<br><b>Shift:</b> ${esc(noteShiftLabel(x))}<br><b>Note type:</b> ${esc(x.note_type||'')}<br><b>Submitted:</b> ${new Date(x.created_at).toLocaleString('en-AU')}</div><div class="record-body">${esc(x.note||'')}</div></div>`);}
function editNote(id){const x=state.notes.find(n=>n.id===id);if(!x||!canModifyCareRecord(x))return toast('You cannot edit this note.');const list=state.mode==='manager'?state.clients.filter(c=>c.active):authorisedClients();openModal('Edit Progress Note',`<div class="field"><label>Client</label><select id="en_client">${careClientOptions(list,x.client_id)}</select></div><div class="field"><label>Note Type</label><select id="en_type">${['General Progress Note','Personal Care','Community Access','Behaviour','Health Observation','Medication Support','Appointment / Community'].map(v=>`<option ${v===x.note_type?'selected':''}>${v}</option>`).join('')}</select></div><div class="field"><label>Progress Note</label><textarea id="en_note">${esc(x.note||'')}</textarea></div><div class="form-actions"><button class="btn btn-primary" onclick="updateNote('${id}')">Save Changes</button><button class="btn btn-secondary" onclick="closeModal()">Cancel</button></div>`);}
async function updateNote(id){const x=state.notes.find(n=>n.id===id);if(!x||!canModifyCareRecord(x))return;const c=el('en_client').value,client=state.clients.find(z=>z.id===c),note=el('en_note').value.trim();if(!note)return toast('Progress note cannot be empty.');const {error}=await sb.from('progress_notes').update({client_id:c,site_id:client?.site_id||null,note_type:el('en_type').value,note}).eq('id',id);if(error)return toast(error.message);closeModal();await loadAll();renderNotes();toast('Progress note updated.');}
async function deleteNote(id){const x=state.notes.find(n=>n.id===id);if(!x||!canModifyCareRecord(x))return toast('You cannot delete this note.');if(!confirm('Delete this progress note? This cannot be undone.'))return;const {error}=await sb.from('progress_notes').delete().eq('id',id);if(error)return toast(error.message);await loadAll();renderNotes();toast('Progress note deleted.');}

function renderMedication(){
 const list=authorisedClients(),cm=byId(state.clients),pm=byId(state.staff),visible=(state.mode==='manager'?state.meds:state.meds.filter(x=>list.some(c=>c.id===x.client_id))).slice().sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
 const locked=state.mode==='staff'&&!documentationTimesheet();
 el('medication').innerHTML=`<div class="care-page">
 ${locked?'<div class="care-banner"><b>Clock in required</b><div class="small">Medication records are limited to clients at your current site/location.</div></div>':`
 <div class="card care-form-card"><div class="section-title"><div><h2>Medication Record</h2><div class="muted">Document medication support provided during the shift.</div></div></div>
  <div class="care-form-grid" style="margin-top:14px">
   <div class="field"><label>Client</label><select id="med_client">${careClientOptions(list)}</select></div>
   <div class="field"><label>Medication</label><input id="med_name" placeholder="Medication name"></div>
   <div class="field"><label>Dose</label><input id="med_dose" placeholder="e.g. 10 mg / 26 units"></div>
   <div class="field"><label>Scheduled Time</label><input id="med_time" type="time"></div>
   <div class="field"><label>Outcome</label><select id="med_outcome"><option>Given</option><option>Refused</option><option>PRN</option><option>Not Given</option></select></div>
   <div class="field"><label>Record Type</label><select id="med_category"><option>Medication</option><option>Insulin</option><option>PRN</option></select></div>
   <div class="field wide"><label>Notes</label><textarea id="med_notes" placeholder="Relevant notes, observations, refusal reason or PRN response..."></textarea></div>
  </div><div class="form-actions"><button class="btn btn-primary" onclick="saveMed()">💾 Save Medication Record</button></div>
 </div>`}
 <div class="card"><div class="section-title"><div><h2>Medication History</h2><div class="muted">Most recent records appear first.</div></div><span class="pill info">${visible.length} record${visible.length===1?'':'s'}</span></div>
  <div class="record-list" style="margin-top:12px">${visible.map(x=>`<div class="record-card"><div class="record-head"><div><div class="record-title">${esc(cm[x.client_id]?.full_name||'Client')} • ${esc(x.medication||'Medication')}</div><div class="muted">${esc(pm[x.staff_id]?.full_name||'')} • ${new Date(x.created_at).toLocaleString('en-AU')}</div></div><div class="med-outcome">${pill(x.outcome||'Recorded')}</div></div><div class="record-body"><b>Dose:</b> ${esc(x.dose||'—')}<br><b>Time:</b> ${x.scheduled_time?formatTime12(x.scheduled_time):'—'}${x.notes?`<br><b>Notes:</b> ${esc(x.notes)}`:''}</div><div class="record-actions"><button class="btn btn-view" onclick="viewMed('${x.id}')">👁 View</button>${canModifyCareRecord(x)?`<button class="btn btn-edit" onclick="editMed('${x.id}')">✏️ Edit</button><button class="btn btn-danger" onclick="deleteMed('${x.id}')">🗑 Delete</button>`:''}</div></div>`).join('')||'<div class="care-empty">No medication records yet.</div>'}</div>
 </div></div>`;
}
async function saveMed(){
 if(!requireClockIn())return;const c=el('med_client')?.value,cl=state.clients.find(x=>x.id===c),med=el('med_name')?.value.trim(),dose=el('med_dose')?.value.trim();if(!c)return toast('Select a client.');if(!med)return toast('Enter medication name.');
 const t=documentationTimesheet();const row={client_id:c,site_id:cl?.site_id||t?.site_id||null,staff_id:profile.id,timesheet_id:t?.id||null,medication:med,dose,scheduled_time:el('med_time').value||null,outcome:el('med_outcome').value,notes:el('med_notes').value.trim()};
 const {error}=await sb.from('medication_records').insert(row);if(error)return toast(error.message);await loadAll();renderMedication();toast('Medication record saved.');
}
function viewMed(id){const x=state.meds.find(m=>m.id===id),cm=byId(state.clients),pm=byId(state.staff);if(!x)return;openModal('Medication Record',`<div class="record-card"><h3>${esc(cm[x.client_id]?.full_name||'Client')} • ${esc(x.medication||'Medication')}</h3><div class="muted">${esc(pm[x.staff_id]?.full_name||'')} • ${new Date(x.created_at).toLocaleString('en-AU')}</div><div class="record-body"><b>Dose:</b> ${esc(x.dose||'—')}<br><b>Scheduled time:</b> ${x.scheduled_time?formatTime12(x.scheduled_time):'—'}<br><b>Outcome:</b> ${esc(x.outcome||'—')}<br><b>Notes:</b> ${esc(x.notes||'—')}</div></div>`);}
function editMed(id){const x=state.meds.find(m=>m.id===id);if(!x||!canModifyCareRecord(x))return toast('You cannot edit this medication record.');const list=state.mode==='manager'?state.clients.filter(c=>c.active):authorisedClients();openModal('Edit Medication Record',`<div class="care-form-grid"><div class="field"><label>Client</label><select id="em_client">${careClientOptions(list,x.client_id)}</select></div><div class="field"><label>Medication</label><input id="em_name" value="${esc(x.medication||'')}"></div><div class="field"><label>Dose</label><input id="em_dose" value="${esc(x.dose||'')}"></div><div class="field"><label>Scheduled Time</label><input id="em_time" type="time" value="${esc(String(x.scheduled_time||'').slice(0,5))}"></div><div class="field"><label>Outcome</label><select id="em_outcome">${['Given','Refused','PRN','Not Given'].map(v=>`<option ${v===x.outcome?'selected':''}>${v}</option>`).join('')}</select></div><div class="field wide"><label>Notes</label><textarea id="em_notes">${esc(x.notes||'')}</textarea></div></div><div class="form-actions"><button class="btn btn-primary" onclick="updateMed('${id}')">Save Changes</button><button class="btn btn-secondary" onclick="closeModal()">Cancel</button></div>`);}
async function updateMed(id){const x=state.meds.find(m=>m.id===id);if(!x||!canModifyCareRecord(x))return;const c=el('em_client').value,cl=state.clients.find(z=>z.id===c),med=el('em_name').value.trim();if(!med)return toast('Medication name is required.');const {error}=await sb.from('medication_records').update({client_id:c,site_id:cl?.site_id||null,medication:med,dose:el('em_dose').value.trim(),scheduled_time:el('em_time').value||null,outcome:el('em_outcome').value,notes:el('em_notes').value.trim()}).eq('id',id);if(error)return toast(error.message);closeModal();await loadAll();renderMedication();toast('Medication record updated.');}
async function deleteMed(id){const x=state.meds.find(m=>m.id===id);if(!x||!canModifyCareRecord(x))return toast('You cannot delete this medication record.');if(!confirm('Delete this medication record? This cannot be undone.'))return;const {error}=await sb.from('medication_records').delete().eq('id',id);if(error)return toast(error.message);await loadAll();renderMedication();toast('Medication record deleted.');}

function renderHealth(){
 const list=authorisedClients(),cm=byId(state.clients),pm=byId(state.staff),visible=(state.mode==='manager'?state.health:state.health.filter(x=>list.some(c=>c.id===x.client_id))).slice().sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
 const locked=state.mode==='staff'&&!activeTimesheet();
 el('health').innerHTML=`<div class="care-page">
 ${locked?'<div class="care-banner"><b>Clock in required</b><div class="small">Health records are limited to clients at your current site/location.</div></div>':`
 <div class="card care-form-card"><div class="section-title"><div><h2>Health Record</h2><div class="muted">Record observations and health readings taken during the shift.</div></div></div>
  <div class="care-form-grid" style="margin-top:14px">
   <div class="field"><label>Client</label><select id="hr_client">${careClientOptions(list)}</select></div>
   <div class="field"><label>Record Type</label><select id="hr_type"><option>Blood Pressure</option><option>Blood Glucose</option><option>Insulin</option><option>Temperature</option><option>Weight</option><option>Pulse</option><option>Oxygen Saturation</option></select></div>
   <div class="field wide"><label>Reading / Dose</label><input id="hr_value" placeholder="e.g. 120/80, 6.2 mmol/L, 26 units"></div>
   <div class="field wide"><label>Notes</label><textarea id="hr_notes" placeholder="Relevant observations, symptoms, action taken or follow-up required..."></textarea></div>
  </div><div class="form-actions"><button class="btn btn-primary" onclick="saveHealth()">💾 Save Health Record</button></div>
 </div>`}
 <div class="card"><div class="section-title"><div><h2>Health History</h2><div class="muted">Most recent records appear first.</div></div><span class="pill info">${visible.length} record${visible.length===1?'':'s'}</span></div>
  <div class="record-list" style="margin-top:12px">${visible.map(x=>`<div class="record-card"><div class="record-head"><div><div class="record-title">${esc(cm[x.client_id]?.full_name||'Client')} • ${esc(x.record_type||'Health Record')}</div><div class="muted">${esc(pm[x.staff_id]?.full_name||'')} • ${new Date(x.created_at).toLocaleString('en-AU')}</div></div></div><div class="record-body"><b>Reading / dose:</b> ${esc(x.value||'—')}<br>${x.notes?`<b>Notes:</b> ${esc(x.notes)}`:''}</div><div class="record-actions"><button class="btn btn-view" onclick="viewHealth('${x.id}')">👁 View</button>${canModifyCareRecord(x)?`<button class="btn btn-edit" onclick="editHealth('${x.id}')">✏️ Edit</button><button class="btn btn-danger" onclick="deleteHealth('${x.id}')">🗑 Delete</button>`:''}</div></div>`).join('')||'<div class="care-empty">No health records yet.</div>'}</div>
 </div></div>`;
}
async function saveHealth(){if(!requireClockIn())return;const c=el('hr_client')?.value,cl=state.clients.find(x=>x.id===c),value=el('hr_value')?.value.trim();if(!c)return toast('Select a client.');if(!value)return toast('Enter a reading or dose.');const {error}=await sb.from('health_records').insert({client_id:c,site_id:cl?.site_id||null,staff_id:profile.id,record_type:el('hr_type').value,value,notes:el('hr_notes').value.trim()});if(error)return toast(error.message);await loadAll();renderHealth();toast('Health record saved.');}
function viewHealth(id){const x=state.health.find(r=>r.id===id),cm=byId(state.clients),pm=byId(state.staff);if(!x)return;openModal('Health Record',`<div class="record-card"><h3>${esc(cm[x.client_id]?.full_name||'Client')} • ${esc(x.record_type||'Health Record')}</h3><div class="muted">${esc(pm[x.staff_id]?.full_name||'')} • ${new Date(x.created_at).toLocaleString('en-AU')}</div><div class="record-body"><b>Reading / dose:</b> ${esc(x.value||'—')}<br><b>Notes:</b> ${esc(x.notes||'—')}</div></div>`);}
function editHealth(id){const x=state.health.find(r=>r.id===id);if(!x||!canModifyCareRecord(x))return toast('You cannot edit this health record.');const list=state.mode==='manager'?state.clients.filter(c=>c.active):authorisedClients();const types=['Blood Pressure','Blood Glucose','Insulin','Temperature','Weight','Pulse','Oxygen Saturation'];openModal('Edit Health Record',`<div class="field"><label>Client</label><select id="eh_client">${careClientOptions(list,x.client_id)}</select></div><div class="field"><label>Record Type</label><select id="eh_type">${types.map(v=>`<option ${v===x.record_type?'selected':''}>${v}</option>`).join('')}</select></div><div class="field"><label>Reading / Dose</label><input id="eh_value" value="${esc(x.value||'')}"></div><div class="field"><label>Notes</label><textarea id="eh_notes">${esc(x.notes||'')}</textarea></div><div class="form-actions"><button class="btn btn-primary" onclick="updateHealth('${id}')">Save Changes</button><button class="btn btn-secondary" onclick="closeModal()">Cancel</button></div>`);}
async function updateHealth(id){const x=state.health.find(r=>r.id===id);if(!x||!canModifyCareRecord(x))return;const c=el('eh_client').value,cl=state.clients.find(z=>z.id===c),value=el('eh_value').value.trim();if(!value)return toast('Reading / dose cannot be empty.');const {error}=await sb.from('health_records').update({client_id:c,site_id:cl?.site_id||null,record_type:el('eh_type').value,value,notes:el('eh_notes').value.trim()}).eq('id',id);if(error)return toast(error.message);closeModal();await loadAll();renderHealth();toast('Health record updated.');}
async function deleteHealth(id){const x=state.health.find(r=>r.id===id);if(!x||!canModifyCareRecord(x))return toast('You cannot delete this health record.');if(!confirm('Delete this health record? This cannot be undone.'))return;const {error}=await sb.from('health_records').delete().eq('id',id);if(error)return toast(error.message);await loadAll();renderHealth();toast('Health record deleted.');}

function handoverStatusLabel(x){const old=['Stable','Requires Monitoring','Follow up','Other'];return old.includes(x.status)?'In Progress':(x.status||'Not Done');}
function handoverStaffCanSee(x){if(state.mode==='manager')return true;const t=activeTimesheet();if(!t||x.site_id!==t.site_id)return false;if(!x.client_id)return true;return authorisedClients().some(c=>c.id===x.client_id);}
function renderHandover(){
 const t=activeTimesheet(),list=(state.mode==='staff'&&t?.unrostered&&!unrosteredAccessApproved())?[]:authorisedClients(),cm=byId(state.clients),pm=byId(state.staff),sm=byId(state.sites),visible=state.handovers.filter(h=>handoverStaffCanSee(h)).slice().sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
 const locked=state.mode==='staff'&&!t,staffSite=t?state.sites.find(s=>s.id===t.site_id):null;
 el('handover').innerHTML=`<div class="care-page">
 ${locked?'<div class="care-banner"><b>Clock in required</b><div class="small">Clock in first to create or review handover for your current house/site.</div></div>':`
 <div class="card care-form-card"><div class="section-title"><div><h2>Shift Handover</h2><div class="muted">Handover belongs to the house/site. Client is optional when the information is client-specific.</div></div></div>
  <div class="care-form-grid" style="margin-top:14px">
   <div class="field"><label>Site / House *</label>${state.mode==='staff'?`<input value="${esc(staffSite?.name||'Current site')}" disabled><input id="ho_site" type="hidden" value="${esc(t?.site_id||'')}">`:`<select id="ho_site"><option value="">Select site</option>${state.sites.filter(s=>s.active).map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>`}</div>
   <div class="field"><label>Client (optional)</label><select id="ho_client"><option value="">House / site handover</option>${careClientOptions(list)}</select></div>
   <div class="field"><label>Category</label><select id="ho_category"><option>General House</option><option>Client-specific</option><option>Medication</option><option>Health</option><option>Behaviour</option><option>Appointment</option><option>Maintenance</option><option>Other</option></select></div>
   <div class="field"><label>Priority</label><select id="ho_priority"><option>Routine</option><option>Important</option><option>Urgent</option></select></div>
   <div class="field"><label>Task Status</label><select id="ho_status"><option>Not Done</option><option>In Progress</option><option>Done</option><option>Not Required</option></select></div>
   <div class="field wide"><label>Handover Information</label><textarea id="ho_text" placeholder="House information, changes, concerns, appointments, tasks or follow-up for the next support worker..."></textarea></div>
  </div><div class="form-actions"><button class="btn btn-primary" onclick="saveHandover()">💾 Save Handover</button></div>
 </div>`}
 <div class="card"><div class="section-title"><div><h2>Recent Handover</h2><div class="muted">Acknowledge when read and mark tasks Done when completed.</div></div><span class="pill info">${visible.length} record${visible.length===1?'':'s'}</span></div>
  <div class="record-list" style="margin-top:12px">${visible.map(x=>{const st=handoverStatusLabel(x);return `<div class="record-card"><div class="record-head"><div><div class="record-title">🏠 ${esc(sm[x.site_id]?.name||'Site')}${x.client_id?' • '+esc(cm[x.client_id]?.full_name||'Client'):''}</div><div class="muted">${esc(x.category||'General House')} • ${esc(x.priority||'Routine')} • ${esc(pm[x.staff_id]?.full_name||'')} • ${new Date(x.created_at).toLocaleString('en-AU')}</div></div>${pill(st)}</div><div class="record-body">${esc(x.handover_text||'')}</div><div class="small muted">${x.acknowledged_at?`✓ Acknowledged by ${esc(pm[x.acknowledged_by]?.full_name||'staff')} • ${new Date(x.acknowledged_at).toLocaleString('en-AU')}`:'Not yet acknowledged'}${x.completed_at?`<br>✓ Completed by ${esc(pm[x.completed_by]?.full_name||'staff')} • ${new Date(x.completed_at).toLocaleString('en-AU')}${x.completion_note?' • '+esc(x.completion_note):''}`:''}</div><div class="record-actions"><button class="btn btn-view" onclick="viewHandover('${x.id}')">👁 View</button>${!x.acknowledged_at?`<button class="btn btn-secondary" onclick="acknowledgeHandover('${x.id}')">✓ Acknowledge</button>`:''}${!['Done','Not Required'].includes(st)?`<button class="btn btn-green" onclick="markHandoverDone('${x.id}')">✅ Mark Done</button>`:''}${canModifyCareRecord(x)?`<button class="btn btn-edit" onclick="editHandover('${x.id}')">✏️ Edit</button><button class="btn btn-danger" onclick="deleteHandover('${x.id}')">🗑 Delete</button>`:''}</div></div>`}).join('')||'<div class="care-empty">No relevant handover records yet.</div>'}</div>
 </div></div>`;
}
async function saveHandover(){if(state.mode==='staff'&&!documentationTimesheet())return toast('Clock in first.');const t=documentationTimesheet(),site_id=el('ho_site')?.value||t?.site_id||null,c=el('ho_client')?.value||null,text=el('ho_text')?.value.trim();if(!site_id)return toast('Select a site / house.');if(!text)return toast('Enter handover information.');const status=el('ho_status').value,row={client_id:c,site_id,staff_id:profile.id,timesheet_id:t?.id||null,category:el('ho_category').value,priority:el('ho_priority').value,status,handover_text:text};if(status==='Done'){row.completed_by=profile.id;row.completed_at=new Date().toISOString();}const {error}=await sb.from('handovers').insert(row);if(error)return toast('Could not save handover. Run carehub-shift-compliance-handover-geofence.sql first. '+error.message);await loadAll();renderHandover();toast('Handover saved.');}
function viewHandover(id){const x=state.handovers.find(r=>r.id===id),cm=byId(state.clients),pm=byId(state.staff),sm=byId(state.sites);if(!x)return;openModal('Shift Handover',`<div class="record-card"><div class="record-head"><div><h3>🏠 ${esc(sm[x.site_id]?.name||'Site')}${x.client_id?' • '+esc(cm[x.client_id]?.full_name||'Client'):''}</h3><div class="muted">${esc(x.category||'General House')} • ${esc(x.priority||'Routine')} • ${esc(pm[x.staff_id]?.full_name||'')} • ${new Date(x.created_at).toLocaleString('en-AU')}</div></div>${pill(handoverStatusLabel(x))}</div><div class="record-body">${esc(x.handover_text||'')}</div>${x.completion_note?`<div class="record-body"><b>Completion note:</b> ${esc(x.completion_note)}</div>`:''}</div>`);}
function editHandover(id){const x=state.handovers.find(r=>r.id===id);if(!x||!canModifyCareRecord(x))return toast('You cannot edit this handover.');const list=state.mode==='manager'?state.clients.filter(c=>c.active):authorisedClients(),sites=state.sites.filter(s=>s.active||s.id===x.site_id),statuses=['Not Done','In Progress','Done','Not Required'];openModal('Edit Handover',`<div class="care-form-grid"><div class="field"><label>Site / House</label><select id="eho_site">${sites.map(s=>`<option value="${s.id}" ${s.id===x.site_id?'selected':''}>${esc(s.name)}</option>`).join('')}</select></div><div class="field"><label>Client (optional)</label><select id="eho_client"><option value="">House / site handover</option>${careClientOptions(list,x.client_id)}</select></div><div class="field"><label>Category</label><select id="eho_category">${['General House','Client-specific','Medication','Health','Behaviour','Appointment','Maintenance','Other'].map(v=>`<option ${v===(x.category||'General House')?'selected':''}>${v}</option>`).join('')}</select></div><div class="field"><label>Priority</label><select id="eho_priority">${['Routine','Important','Urgent'].map(v=>`<option ${v===(x.priority||'Routine')?'selected':''}>${v}</option>`).join('')}</select></div><div class="field"><label>Task Status</label><select id="eho_status">${statuses.map(v=>`<option ${v===handoverStatusLabel(x)?'selected':''}>${v}</option>`).join('')}</select></div><div class="field wide"><label>Handover Information</label><textarea id="eho_text">${esc(x.handover_text||'')}</textarea></div></div><div class="form-actions"><button class="btn btn-primary" onclick="updateHandover('${id}')">Save Changes</button><button class="btn btn-secondary" onclick="closeModal()">Cancel</button></div>`);}
async function updateHandover(id){const x=state.handovers.find(r=>r.id===id);if(!x||!canModifyCareRecord(x))return;const site_id=el('eho_site').value,c=el('eho_client').value||null,text=el('eho_text').value.trim(),status=el('eho_status').value;if(!text)return toast('Handover information cannot be empty.');const row={client_id:c,site_id,category:el('eho_category').value,priority:el('eho_priority').value,status,handover_text:text};if(status==='Done'&&!x.completed_at){row.completed_by=profile.id;row.completed_at=new Date().toISOString();}const {error}=await sb.from('handovers').update(row).eq('id',id);if(error)return toast(error.message);closeModal();await loadAll();renderHandover();toast('Handover updated.');}
async function acknowledgeHandover(id){const x=state.handovers.find(r=>r.id===id);if(!x)return;const {error}=await sb.from('handovers').update({acknowledged_by:profile.id,acknowledged_at:new Date().toISOString()}).eq('id',id);if(error)return toast(error.message);await loadAll();renderHandover();toast('Handover acknowledged.');}
function markHandoverDone(id){const x=state.handovers.find(r=>r.id===id);if(!x)return;openModal('Mark Handover Done',`<div class="field"><label>Completion note (optional)</label><textarea id="ho_complete_note" placeholder="What was completed / outcome"></textarea></div><div class="form-actions"><button class="btn btn-green" onclick="completeHandover('${id}')">✅ Mark Done</button><button class="btn btn-secondary" onclick="closeModal()">Cancel</button></div>`);}
async function completeHandover(id){const {error}=await sb.from('handovers').update({status:'Done',completed_by:profile.id,completed_at:new Date().toISOString(),completion_note:el('ho_complete_note').value.trim()||null}).eq('id',id);if(error)return toast(error.message);closeModal();await loadAll();renderHandover();toast('Handover marked Done.');}
async function deleteHandover(id){const x=state.handovers.find(r=>r.id===id);if(!x||!canModifyCareRecord(x))return toast('You cannot delete this handover.');if(!confirm('Delete this handover? This cannot be undone.'))return;const {error}=await sb.from('handovers').delete().eq('id',id);if(error)return toast(error.message);await loadAll();renderHandover();toast('Handover deleted.');}

function incidentAttachmentCount(id){return (state.incidentAttachments||[]).filter(a=>a.incident_id===id).length;}
function incidentDefaultEmail(){return settingVal('incident_email',settingVal('email',''));}
function incidentAutoEmailEnabled(){return settingVal('incident_auto_email',true)!==false;}
function safeFileName(name){return String(name||'file').replace(/[^a-zA-Z0-9._-]+/g,'_').slice(-120);}
async function uploadIncidentFiles(incidentId,files){
 const list=Array.from(files||[]); if(!list.length)return true;
 for(const file of list){
  if(file.size>15*1024*1024){toast(`${file.name} is larger than 15 MB and was not uploaded.`);continue;}
  const path=`${authUser.id}/${incidentId}/${Date.now()}-${Math.random().toString(36).slice(2,8)}-${safeFileName(file.name)}`;
  const up=await sb.storage.from('incident-files').upload(path,file,{contentType:file.type||'application/octet-stream',upsert:false});
  if(up.error){toast(`Could not upload ${file.name}: ${up.error.message}`);continue;}
  const {error}=await sb.from('incident_attachments').insert({incident_id:incidentId,uploaded_by:profile.id,file_name:file.name,storage_path:path,mime_type:file.type||null,file_size:file.size});
  if(error){await sb.storage.from('incident-files').remove([path]);toast(`Could not save ${file.name}: ${error.message}`);}
 }
 return true;
}
async function incidentAttachmentLink(a){
 const {data,error}=await sb.storage.from('incident-files').createSignedUrl(a.storage_path,3600);
 if(error){toast(error.message);return null;} return data?.signedUrl||null;
}
async function openIncidentAttachment(id){const a=state.incidentAttachments.find(x=>x.id===id);if(!a)return;const url=await incidentAttachmentLink(a);if(url)window.open(url,'_blank','noopener');}
async function deleteIncidentAttachment(id){
 const a=state.incidentAttachments.find(x=>x.id===id);if(!a)return;
 const can=state.mode==='manager'||a.uploaded_by===profile.id;if(!can)return toast('You cannot delete this file.');
 if(!confirm(`Delete attachment ${a.file_name}?`))return;
 const {error}=await sb.from('incident_attachments').delete().eq('id',id);if(error)return toast(error.message);
 await sb.storage.from('incident-files').remove([a.storage_path]);await loadAll();renderIncidents();toast('Attachment deleted.');
}
async function emailIncident(id){
 try{
  toast('Sending incident email...');
  const {data,error}=await sb.functions.invoke('send-incident-email',{body:{incident_id:id}});
  if(error)throw error;
  if(data?.error)throw new Error(data.error);
  await loadAll();renderIncidents();
  toast(`Incident email sent${data?.to?` to ${data.to}`:''}.`);
  return true;
 }catch(err){
  console.error('Incident email error',err);
  toast(`Incident saved, but email could not be sent: ${err?.message||err}`);
  return false;
 }
}
function renderIncidents(){
 const list=authorisedClients(),cm=byId(state.clients),pm=byId(state.staff),visible=(state.mode==='manager'?state.incidents:state.incidents.filter(x=>!x.client_id||list.some(c=>c.id===x.client_id))).slice().sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
 const locked=state.mode==='staff'&&!documentationTimesheet();
 const configuredEmail=incidentDefaultEmail();
 el('incidents').innerHTML=`<div class="care-page">
 ${locked?'<div class="care-banner"><b>Clock in required</b><div class="small">Incident reporting is available while you are clocked in at the relevant site/location.</div></div>':`
 <div class="card care-form-card"><div class="section-title"><div><h2>Report Incident</h2><div class="muted">Document incidents clearly and factually. Attach supporting files before submitting; CareHub can email the completed report to UCC automatically.</div></div></div><div class="care-banner" style="margin-top:12px"><b>Submitting as ${esc(profile?.full_name||'CareHub staff')}</b><div class="small">Staff login ID: ${esc(profile?.email||authUser?.email||'')} • This identity is recorded with the incident and included in the email sent to UCC.</div></div>
  <div class="care-form-grid" style="margin-top:14px">
   <div class="field"><label>Client</label><select id="in_client"><option value="">No specific client / Site incident</option>${careClientOptions(list)}</select></div>
   <div class="field"><label>Incident Type</label><select id="in_type"><option>Health / Injury</option><option>Medication</option><option>Behaviour</option><option>Fall</option><option>Property / Environment</option><option>Other</option></select></div>
   <div class="field"><label>Severity</label><select id="in_severity"><option>Low</option><option>Medium</option><option>High</option></select></div>
   <div class="field"><label>Status</label><select id="in_status"><option>Open</option><option>In Progress</option><option>Closed</option></select></div>
   <div class="field wide"><label>Description</label><textarea id="in_desc" placeholder="Describe what happened, when and where, immediate actions taken, persons involved/witnesses and any follow-up required..."></textarea></div>
   <div class="field wide"><label>📎 Attach files (optional)</label><input id="in_files" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.txt"><div class="small muted">Choose files from your computer, phone, Files app or connected storage. Maximum 15 MB per file. Selected files are uploaded securely with the incident.</div></div>
   <div class="field wide"><label class="settings-toggle"><input id="in_email_after" type="checkbox" ${incidentAutoEmailEnabled()?'checked':''}> ✉️ Email UCC automatically after submission</label><div class="small muted">${configuredEmail?`Recipient configured by manager: ${esc(configuredEmail)}`:'Manager must configure the incident-report email address in Settings before automatic email can work.'}</div></div>
  </div><div class="form-actions"><button class="btn btn-primary" onclick="saveIncident()">💾 Submit Incident${incidentAutoEmailEnabled()?' & Send Email':''}</button></div>
 </div>`}
 <div class="card"><div class="section-title"><div><h2>Incident Register</h2><div class="muted">Most recent incidents appear first. Files and email status are shown on each record.</div></div><span class="pill info">${visible.length} record${visible.length===1?'':'s'}</span></div>
  <div class="record-list" style="margin-top:12px">${visible.map(x=>{const n=incidentAttachmentCount(x.id);const es=x.email_status||'';return `<div class="record-card"><div class="record-head"><div><div class="record-title">${esc(cm[x.client_id]?.full_name||'Site Incident')} • ${esc(x.incident_type||'Incident')}</div><div class="muted">${esc(pm[x.staff_id]?.full_name||'')} • ${new Date(x.created_at).toLocaleString('en-AU')} ${n?`• 📎 ${n} file${n===1?'':'s'}`:''}</div></div><div>${pill(x.severity||'Low')} ${pill(x.status||'Open')} ${es?pill(es==='Sent'?'Email Sent':es):''}</div></div><div class="record-body">${esc(x.description||'')}</div><div class="record-actions"><button class="btn btn-view" onclick="viewIncident('${x.id}')">👁 View</button><button class="btn btn-secondary" onclick="emailIncident('${x.id}')">✉️ ${es==='Sent'?'Resend Email':'Send Email'}</button>${canModifyCareRecord(x)?`<button class="btn btn-edit" onclick="editIncident('${x.id}')">✏️ Edit</button><button class="btn btn-danger" onclick="deleteIncident('${x.id}')">🗑 Delete</button>`:''}</div></div>`}).join('')||'<div class="care-empty">No incidents recorded.</div>'}</div>
 </div></div>`;
}
async function saveIncident(){
 if(!requireClockIn())return;
 const c=el('in_client').value||null,site_id=c?state.clients.find(x=>x.id===c)?.site_id:currentSite()?.id,description=el('in_desc').value.trim(),sendAfter=!!el('in_email_after')?.checked;
 if(!site_id)return toast('A current site is required.');if(!description)return toast('Enter the incident description.');
 const {data,error}=await sb.from('incidents').insert({client_id:c,site_id,staff_id:profile.id,incident_type:el('in_type').value,severity:el('in_severity').value,description,status:el('in_status').value,email_status:sendAfter?'Pending':null}).select().single();
 if(error)return toast(error.message);
 const files=el('in_files')?.files;if(files?.length)await uploadIncidentFiles(data.id,files);
 await loadAll();renderIncidents();
 if(sendAfter){await emailIncident(data.id);}else{toast('Incident submitted.');}
}
async function viewIncident(id){
 const x=state.incidents.find(r=>r.id===id),cm=byId(state.clients),pm=byId(state.staff);if(!x)return;
 const atts=(state.incidentAttachments||[]).filter(a=>a.incident_id===id);
 openModal('Incident Report',`<div class="record-card"><div class="record-head"><div><h3>${esc(cm[x.client_id]?.full_name||'Site Incident')} • ${esc(x.incident_type||'Incident')}</h3><div class="muted">${esc(pm[x.staff_id]?.full_name||'')} • ${new Date(x.created_at).toLocaleString('en-AU')}</div></div><div>${pill(x.severity||'Low')} ${pill(x.status||'Open')}</div></div><div class="record-body">${esc(x.description||'')}</div>${atts.length?`<div class="item"><b>📎 Attachments</b>${atts.map(a=>`<div class="row between wrap" style="margin-top:8px"><span>${esc(a.file_name)} <span class="muted">${a.file_size?`• ${(a.file_size/1024/1024).toFixed(2)} MB`:''}</span></span><span><button class="btn btn-view" onclick="openIncidentAttachment('${a.id}')">Open</button> ${(state.mode==='manager'||a.uploaded_by===profile.id)?`<button class="btn btn-danger" onclick="deleteIncidentAttachment('${a.id}')">Delete</button>`:''}</span></div>`).join('')}</div>`:''}<div class="item"><b>Email status</b><div>${esc(x.email_status||'Not sent')}${x.emailed_at?` • ${new Date(x.emailed_at).toLocaleString('en-AU')}`:''}</div>${x.email_error?`<div class="small bad">${esc(x.email_error)}</div>`:''}</div><div class="form-actions"><button class="btn btn-secondary" onclick="emailIncident('${id}')">✉️ ${x.email_status==='Sent'?'Resend Email':'Send Incident Email'}</button></div></div>`);
}
function editIncident(id){const x=state.incidents.find(r=>r.id===id);if(!x||!canModifyCareRecord(x))return toast('You cannot edit this incident.');const list=state.mode==='manager'?state.clients.filter(c=>c.active):authorisedClients();const types=['Health / Injury','Medication','Behaviour','Fall','Property / Environment','Other'],severities=['Low','Medium','High'],statuses=['Open','In Progress','Closed'];openModal('Edit Incident',`<div class="field"><label>Client</label><select id="ei_client"><option value="">No specific client / Site incident</option>${careClientOptions(list,x.client_id)}</select></div><div class="field"><label>Incident Type</label><select id="ei_type">${types.map(v=>`<option ${v===x.incident_type?'selected':''}>${v}</option>`).join('')}</select></div><div class="field"><label>Severity</label><select id="ei_severity">${severities.map(v=>`<option ${v===x.severity?'selected':''}>${v}</option>`).join('')}</select></div><div class="field"><label>Status</label><select id="ei_status">${statuses.map(v=>`<option ${v===x.status?'selected':''}>${v}</option>`).join('')}</select></div><div class="field"><label>Description</label><textarea id="ei_desc">${esc(x.description||'')}</textarea></div><div class="field"><label>📎 Add more files</label><input id="ei_files" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.txt"></div><div class="form-actions"><button class="btn btn-primary" onclick="updateIncident('${id}')">Save Changes</button><button class="btn btn-secondary" onclick="closeModal()">Cancel</button></div>`);}
async function updateIncident(id){const x=state.incidents.find(r=>r.id===id);if(!x||!canModifyCareRecord(x))return;const c=el('ei_client').value||null,site_id=c?state.clients.find(z=>z.id===c)?.site_id:(x.site_id||currentSite()?.id),description=el('ei_desc').value.trim();if(!site_id)return toast('A site is required.');if(!description)return toast('Description cannot be empty.');const {error}=await sb.from('incidents').update({client_id:c,site_id,incident_type:el('ei_type').value,severity:el('ei_severity').value,status:el('ei_status').value,description}).eq('id',id);if(error)return toast(error.message);const files=el('ei_files')?.files;if(files?.length)await uploadIncidentFiles(id,files);closeModal();await loadAll();renderIncidents();toast('Incident updated.');}
async function deleteIncident(id){const x=state.incidents.find(r=>r.id===id);if(!x||!canModifyCareRecord(x))return toast('You cannot delete this incident.');if(!confirm('Delete this incident? This cannot be undone.'))return;const paths=(state.incidentAttachments||[]).filter(a=>a.incident_id===id).map(a=>a.storage_path);const {error}=await sb.from('incidents').delete().eq('id',id);if(error)return toast(error.message);if(paths.length)await sb.storage.from('incident-files').remove(paths);await loadAll();renderIncidents();toast('Incident deleted.');}

function renderCompliance(){
 if(state.mode!=='manager'){el('compliance').innerHTML='<div class="card">Manager access required.</div>';return;}
 const pm=byId(state.staff);el('compliance').innerHTML=`<div class="card"><div class="row between"><h2>Training & Compliance</h2><button class="btn btn-primary" onclick="addCompliance()">+ Add Record</button></div><div class="tablewrap"><table><thead><tr><th>Staff</th><th>Training / Certificate</th><th>Expiry</th><th>Status</th></tr></thead><tbody>${state.compliance.map(x=>`<tr><td>${esc(pm[x.staff_id]?.full_name||'')}</td><td>${esc(x.item_name||'')}</td><td>${fmt(x.expiry_date)}</td><td>${pill(x.status||'Current')}</td></tr>`).join('')}</tbody></table></div></div>`;
}
function addCompliance(){openModal('Add Compliance Record',`${select('Staff','co_staff',state.staff.filter(x=>x.active).map(x=>x.full_name))}${input('Certificate / Training','co_item')}${input('Expiry','co_exp','type="date"')}<button class="btn btn-primary" onclick="saveCompliance()">Save</button>`);}
async function saveCompliance(){const s=state.staff.find(x=>x.full_name===el('co_staff').value);const {error}=await sb.from('compliance_records').insert({staff_id:s.id,item_name:el('co_item').value,expiry_date:el('co_exp').value||null,status:'Current'});if(error)return toast(error.message);closeModal();await loadAll();renderCompliance();}

function renderDocuments(){
 if(state.mode!=='manager'){el('documents').innerHTML='<div class="card">Manager access required.</div>';return;}
 el('documents').innerHTML=`<div class="card"><h2>Documents</h2>${state.documents.length?state.documents.map(x=>`<div class="item"><b>${esc(x.name||x.title||'Document')}</b><div class="muted">${esc(x.document_type||x.type||'')} • ${fmt(x.updated_at||x.created_at)}</div></div>`).join(''):'<div class="muted">No document records yet. The optional production upgrade SQL adds the documents table.</div>'}</div>`;
}
function renderNotifications(){
 const rows=(state.mode==='manager'?state.notifications:state.notifications.filter(x=>x.staff_id===profile.id)).slice().sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
 const unread=rows.filter(x=>!x.read).length;
 el('notifications').innerHTML=`<div class="card"><div class="row between wrap"><div><h2>Notifications</h2><div class="muted">${unread} unread • ${rows.length} recent</div></div><div class="row wrap"><button class="btn btn-secondary" onclick="markAllNotificationsRead()">✓ Mark All Read</button><button class="btn btn-danger" onclick="clearReadNotifications()">🧹 Clear Read</button></div></div>${rows.map(x=>`<div class="item"><div class="row between"><b>${esc(x.notification_type||'Notification')}</b>${pill(x.read?'Read':'New')}</div><div>${esc(x.message||'')}</div><div class="row between wrap" style="margin-top:6px"><div class="muted">${new Date(x.created_at).toLocaleString('en-AU')}</div><div class="row wrap">${!x.read?`<button class="btn btn-secondary" onclick="markNotificationRead('${x.id}')">✓ Mark Read</button>`:''}<button class="btn btn-danger" onclick="clearNotification('${x.id}')">Clear</button></div></div></div>`).join('')||'<div class="muted">No notifications.</div>'}</div>`;
}
async function markNotificationRead(id){const {error}=await sb.from('staff_notifications').update({read:true}).eq('id',id);if(error)return toast(error.message);await loadAll();renderNotifications();}
async function markAllNotificationsRead(){let q=sb.from('staff_notifications').update({read:true});if(state.mode!=='manager')q=q.eq('staff_id',profile.id);const {error}=await q;if(error)return toast(error.message);await loadAll();renderNotifications();toast('Notifications marked as read.');}
async function clearNotification(id){if(!confirm('Clear this notification?'))return;const {error}=await sb.from('staff_notifications').delete().eq('id',id);if(error)return toast(error.message);await loadAll();renderNotifications();}
async function clearReadNotifications(){if(!confirm('Clear all read notifications?'))return;let q=sb.from('staff_notifications').delete().eq('read',true);if(state.mode!=='manager')q=q.eq('staff_id',profile.id);const {error}=await q;if(error)return toast(error.message);await loadAll();renderNotifications();toast('Read notifications cleared.');}

function renderReports(){
 if(state.mode!=='manager'){el('reports').innerHTML='<div class="card">Manager access required.</div>';return;}
 el('reports').innerHTML=`<div class="hero-card"><div><h1>Reports</h1><p>Live operational summary from the production CareHub database.</p></div></div><div class="grid g4"><div class="card kpi"><b>${state.timesheets.filter(x=>x.status==='Approved').length}</b><span>Approved Timesheets</span></div><div class="card kpi"><b>${state.notes.length}</b><span>Progress Notes</span></div><div class="card kpi"><b>${state.incidents.filter(x=>x.status==='Open').length}</b><span>Open Incidents</span></div><div class="card kpi"><b>${state.compliance.filter(x=>x.status==='Due Soon'||x.status==='Overdue').length}</b><span>Compliance Attention</span></div></div>`;
}
function settingVal(k,d=''){const v=state.settings?.[k];return v===null||v===undefined?d:v;}
function checkedSetting(k,d=false){return settingVal(k,d)?'checked':'';}
function renderSettings(){
 if(state.mode!=='manager'){el('settings').innerHTML='<div class="card">Manager access required.</div>';return;}
 const s=state.settings||{};
 el('settings').innerHTML=`
 <div class="hero-card"><div style="font-size:38px">⚙️</div><div><h1>CareHub Settings</h1><p>Manage company details, payroll categories, shift defaults, notifications and care-documentation rules.</p></div></div>
 ${!state.settings?'<div class="card" style="border-color:#f79009;background:#fffaeb"><b>One-time setup required</b><div class="muted">Run the included <b>carehub-settings.sql</b> in Supabase SQL Editor, then refresh CareHub. Until then these settings cannot be saved.</div></div>':''}
 <div class="grid g2" style="margin-top:14px">
  <div class="card"><h2>🏢 Company Details</h2>
   <div class="field"><label>Company name</label><input id="set_company" value="${esc(settingVal('company_name','UNITE CANBERRA CARE SERVICES PTY. LTD.'))}"></div>
   <div class="grid g2"><div class="field"><label>ABN</label><input id="set_abn" value="${esc(settingVal('abn',''))}"></div><div class="field"><label>Phone</label><input id="set_phone" value="${esc(settingVal('phone',''))}"></div></div>
   <div class="field"><label>Email</label><input id="set_email" type="email" value="${esc(settingVal('email',''))}"></div>
   <div class="field"><label>Address</label><input id="set_address" value="${esc(settingVal('address',''))}"></div>
   <div class="field"><label>CareHub tagline</label><input id="set_tagline" value="${esc(settingVal('tagline','Care Today, Brighter Tomorrows'))}"></div>
  </div>
  <div class="card"><h2>💰 Default Pay Rate Categories</h2><div class="muted">These are fallback rates only. Individual support-worker rates can be set in Staff Management → Pay & KM Rates.</div>
   <div class="grid g2"><div class="field"><label>Weekday hourly rate ($)</label><input id="set_weekday" type="number" step="0.01" min="0" value="${esc(settingVal('weekday_rate',''))}"></div><div class="field"><label>Saturday hourly rate ($)</label><input id="set_saturday" type="number" step="0.01" min="0" value="${esc(settingVal('saturday_rate',''))}"></div></div>
   <div class="grid g2"><div class="field"><label>Sunday hourly rate ($)</label><input id="set_sunday" type="number" step="0.01" min="0" value="${esc(settingVal('sunday_rate',''))}"></div><div class="field"><label>Public holiday hourly rate ($)</label><input id="set_public" type="number" step="0.01" min="0" value="${esc(settingVal('public_holiday_rate',''))}"></div></div>
   <div class="grid g2"><div class="field"><label>Sleepover allowance / rate ($)</label><input id="set_sleepover_rate" type="number" step="0.01" min="0" value="${esc(settingVal('sleepover_rate',''))}"></div><div class="field"><label>KM reimbursement rate ($ / km)</label><input id="set_km_rate" type="number" step="0.01" min="0" value="${esc(settingVal('km_rate',''))}" placeholder="e.g. 0.99"></div></div>
  </div>
  <div class="card"><h2>🕒 Default Shift Times</h2><div class="grid g2">
   <div class="field"><label>Day start</label><input id="set_day_start" type="time" value="${String(settingVal('day_start','07:00')).slice(0,5)}"></div><div class="field"><label>Day end</label><input id="set_day_end" type="time" value="${String(settingVal('day_end','15:00')).slice(0,5)}"></div>
   <div class="field"><label>Evening start</label><input id="set_evening_start" type="time" value="${String(settingVal('evening_start','15:00')).slice(0,5)}"></div><div class="field"><label>Evening end</label><input id="set_evening_end" type="time" value="${String(settingVal('evening_end','23:00')).slice(0,5)}"></div>
   <div class="field"><label>Night start</label><input id="set_night_start" type="time" value="${String(settingVal('night_start','23:00')).slice(0,5)}"></div><div class="field"><label>Night end</label><input id="set_night_end" type="time" value="${String(settingVal('night_end','07:00')).slice(0,5)}"></div>
   <div class="field"><label>Sleepover start</label><input id="set_sleepover_start" type="time" value="${String(settingVal('sleepover_start','22:00')).slice(0,5)}"></div><div class="field"><label>Sleepover end</label><input id="set_sleepover_end" type="time" value="${String(settingVal('sleepover_end','07:00')).slice(0,5)}"></div>
  </div></div>
  <div class="card"><h2>⏱️ Timesheet Rules</h2>
   <div class="field"><label>Maximum normal shift length (hours)</label><input id="set_max_shift" type="number" min="1" max="24" step="0.5" value="${esc(settingVal('max_shift_hours',12))}"></div>
   <label class="settings-toggle"><input id="set_manual_ts" type="checkbox" ${checkedSetting('manual_timesheet_allowed',true)}> Managers can manually add/correct forgotten clock-in or clock-out</label>
   <label class="settings-toggle"><input id="set_autoapprove" type="checkbox" ${checkedSetting('auto_approve_matched',false)}> Automatically approve timesheet when clock-in/out matches roster</label>
  </div>
  <div class="card"><h2>🔔 Notifications</h2>
   <div class="field"><label>Shift reminder before start (minutes)</label><input id="set_shift_reminder" type="number" min="0" value="${esc(settingVal('shift_reminder_minutes',60))}"></div>
   <div class="field"><label>Clock-in reminder before start (minutes)</label><input id="set_clock_reminder" type="number" min="0" value="${esc(settingVal('clock_reminder_minutes',15))}"></div>
   <div class="field"><label>Certificate expiry reminder (days before)</label><input id="set_expiry_days" type="number" min="1" value="${esc(settingVal('compliance_reminder_days',30))}"></div>
  </div>
  <div class="card"><h2>🔐 Permissions & Care Documentation</h2>
   <label class="settings-toggle"><input id="set_require_clock" type="checkbox" ${checkedSetting('require_clockin_docs',true)}> Support workers must be clocked in before care documentation</label>
   <label class="settings-toggle"><input id="set_staff_edit" type="checkbox" ${checkedSetting('staff_edit_own',true)}> Support workers may edit their own records</label>
   <label class="settings-toggle"><input id="set_manager_delete" type="checkbox" ${checkedSetting('managers_delete',true)}> Managers may delete records when required</label>
   <div class="muted" style="margin-top:10px">Database RLS remains the final security control.</div>
  </div>
  <div class="card"><h2>✉️ Incident Email Notifications</h2>
   <div class="field"><label>Incident report recipient</label><input id="set_incident_email" type="email" value="${esc(settingVal('incident_email',settingVal('email','')))}" placeholder="incidents@yourcompany.com.au"></div>
   <div class="field"><label>CC recipient (optional)</label><input id="set_incident_cc" type="email" value="${esc(settingVal('incident_cc_email',''))}" placeholder="manager@yourcompany.com.au"></div>
   <label class="settings-toggle"><input id="set_incident_auto" type="checkbox" ${checkedSetting('incident_auto_email',true)}> Automatically email UCC after a staff member submits an incident</label>
   <div class="muted" style="margin-top:8px">Email is sent securely by a Supabase Edge Function. Email-service secrets are never stored in app.js or config.js.</div>
  </div>
  <div class="card"><h2>📄 Report & Export Settings</h2>
   <label class="settings-toggle"><input id="set_pdf_company" type="checkbox" ${checkedSetting('pdf_company_name',true)}> Show company name on PDF reports</label>
   <label class="settings-toggle"><input id="set_pdf_logo" type="checkbox" ${checkedSetting('pdf_logo',true)}> Show UCC branding on generated reports</label>
   <div class="item"><b>System version</b><div class="muted">UCC CareHub production • Settings are manager-only.</div></div>
  </div>
 </div>
 <div class="card" style="margin-top:14px"><div class="row between wrap"><div><h2>Save Settings</h2><div class="muted">Changes apply to CareHub after saving. Shift-time defaults are used by the roster maker.</div></div><button class="btn btn-primary" onclick="saveCareHubSettings()">💾 Save CareHub Settings</button></div></div>`;
}
async function saveCareHubSettings(){
 if(state.mode!=='manager')return toast('Manager access required.');
 const num=id=>{const v=el(id)?.value;return v===''||v===undefined?null:Number(v)};
 const row={id:'global',company_name:el('set_company').value.trim(),abn:el('set_abn').value.trim(),phone:el('set_phone').value.trim(),email:el('set_email').value.trim(),address:el('set_address').value.trim(),tagline:el('set_tagline').value.trim(),weekday_rate:num('set_weekday'),saturday_rate:num('set_saturday'),sunday_rate:num('set_sunday'),public_holiday_rate:num('set_public'),sleepover_rate:num('set_sleepover_rate'),km_rate:num('set_km_rate'),day_start:el('set_day_start').value||'07:00',day_end:el('set_day_end').value||'15:00',evening_start:el('set_evening_start').value||'15:00',evening_end:el('set_evening_end').value||'23:00',night_start:el('set_night_start').value||'23:00',night_end:el('set_night_end').value||'07:00',sleepover_start:el('set_sleepover_start').value||'22:00',sleepover_end:el('set_sleepover_end').value||'07:00',max_shift_hours:num('set_max_shift')||12,manual_timesheet_allowed:el('set_manual_ts').checked,auto_approve_matched:el('set_autoapprove').checked,shift_reminder_minutes:Math.max(0,Math.round(num('set_shift_reminder')||0)),clock_reminder_minutes:Math.max(0,Math.round(num('set_clock_reminder')||0)),compliance_reminder_days:Math.max(1,Math.round(num('set_expiry_days')||30)),require_clockin_docs:el('set_require_clock').checked,staff_edit_own:el('set_staff_edit').checked,managers_delete:el('set_manager_delete').checked,incident_email:el('set_incident_email')?.value.trim()||null,incident_cc_email:el('set_incident_cc')?.value.trim()||null,incident_auto_email:!!el('set_incident_auto')?.checked,pdf_company_name:el('set_pdf_company').checked,pdf_logo:el('set_pdf_logo').checked,updated_by:profile.id,updated_at:new Date().toISOString()};
 const {data,error}=await sb.from('app_settings').upsert(row,{onConflict:'id'}).select().single();
 if(error)return toast('Settings could not be saved. Run carehub-settings.sql in Supabase first. '+error.message);
 state.settings=data;renderSettings();toast('CareHub settings saved.');
}



function exportFileSafeName(v){return String(v||'carehub').replace(/[^a-z0-9_-]+/gi,'-').replace(/^-+|-+$/g,'').toLowerCase();}
function exportDateTime(v){if(!v)return '';try{return new Date(v).toLocaleString('en-AU');}catch(e){return String(v)}}
function exportDataFor(pageId){
 const pm=byId(state.staff),sm=byId(state.sites),cm=byId(state.clients);
 switch(pageId){
  case 'staff': return {title:'Staff Management',rows:state.staff.map(x=>({Name:x.full_name||'',Email:x.email||'',Phone:x.phone||'',Role:x.role||'',Works_as_Support_Worker:x.can_work_as_staff?'Yes':'No',Weekday_Rate:staffRate(x,'weekday_rate')||'',Saturday_Rate:staffRate(x,'saturday_rate')||'',Sunday_Rate:staffRate(x,'sunday_rate')||'',Public_Holiday_Rate:staffRate(x,'public_holiday_rate')||'',Sleepover_Rate:staffRate(x,'sleepover_rate')||'',KM_Rate:staffRate(x,'km_rate')||'',Status:x.active?'Active':'Inactive'}))};
  case 'clients': return {title:'Client Management',rows:state.clients.map(x=>({Client:x.full_name||'',Site:sm[x.site_id]?.name||'',Risk_Level:x.risk_level||'',Support_Types:clientArray(x.support_types).join('; '),Key_Alerts:clientArray(x.key_alerts).join('; '),Mobility:x.mobility_support||'',Communication:x.communication_support||'',Medication_Support:x.medication_support||'',BSP_Status:x.bsp_status||'',Diet_Requirements:x.diet_requirements||'',Preferred_Routine:x.preferred_routine||'',Staff_Must_Know:x.staff_must_know||'',Emergency_Contact:x.emergency_contact||'',Support_Coordinator:x.support_coordinator||'',GP_Clinical_Contacts:x.gp_details||'',Support_Summary:x.support_needs||'',Status:x.active?'Active':'Inactive'}))};
  case 'sites': return {title:'Sites and Houses',rows:state.sites.map(x=>({Name:x.name||'',Address:x.address||'',Site_Type:x.site_type||'',Location_Kind:x.location_kind||'',Status:x.active?'Active':'Inactive'}))};
  case 'roster': return {title:'Roster and Shifts',rows:(state.mode==='manager'?state.roster:state.roster.filter(x=>x.staff_id===profile.id)).map(x=>({Date:x.shift_date||'',Staff:pm[x.staff_id]?.full_name||'',Site:sm[x.site_id]?.name||'',Client:cm[x.client_id]?.full_name||'',Start:formatTime12(x.start_time),End:formatTime12(x.end_time),Hours:calcHours(String(x.start_time||'').slice(0,5),String(x.end_time||'').slice(0,5)),Shift_Type:x.shift_type||'',Status:x.status||''}))};
  case 'timesheets': {
   const ts=(state.mode==='manager'?state.timesheets:state.timesheets.filter(x=>x.staff_id===profile.id));
   return {title:'Timesheets',rows:ts.map(x=>{const i=timesheetDayInfo(x),h=timesheetHours(x),worker=pm[x.staff_id]||{},kmRate=staffRate(worker,'km_rate'),dayRate=i.category==='Saturday'?staffRate(worker,'saturday_rate'):i.category==='Sunday'?staffRate(worker,'sunday_rate'):staffRate(worker,'weekday_rate');return {Staff:worker.full_name||'',Site:sm[x.site_id]?.name||'',Day:i.day,Day_Category:i.category,Clock_In:exportDateTime(x.clock_in),Clock_Out:x.clock_out?exportDateTime(x.clock_out):'Active',Hours:x.clock_out?h.toFixed(2):'',Hourly_Rate:dayRate||'',Estimated_Hourly_Pay:x.clock_out&&dayRate>0?(h*dayRate).toFixed(2):'',KM_Travelled:Number(x.km_travelled||0).toFixed(1),KM_Rate:kmRate||'',Travel_Purpose:x.travel_purpose||'',From:x.travel_from||'',To:x.travel_to||'',Travel_Notes:x.travel_notes||'',KM_Reimbursement:kmRate>0?(Number(x.km_travelled||0)*kmRate).toFixed(2):'',Status:x.status||'',Approved_By:pm[x.approved_by]?.full_name||'',Approved_At:exportDateTime(x.approved_at)}}),summary:timesheetSummary(ts)};
  }
  case 'notes': return {title:'Progress Notes',rows:state.notes.map(x=>({Client:cm[x.client_id]?.full_name||'',Note_Type:x.note_type||'',Progress_Note:x.note||'',Staff:pm[x.staff_id]?.full_name||'',Created:exportDateTime(x.created_at)}))};
  case 'medication': return {title:'Medication Records',rows:state.meds.map(x=>({Client:cm[x.client_id]?.full_name||'',Medication:x.medication||'',Dose:x.dose||'',Scheduled_Time:x.scheduled_time||'',Outcome:x.outcome||'',Notes:x.notes||'',Staff:pm[x.staff_id]?.full_name||'',Created:exportDateTime(x.created_at)}))};
  case 'health': return {title:'Health Records',rows:state.health.map(x=>({Client:cm[x.client_id]?.full_name||'',Record_Type:x.record_type||'',Reading_or_Dose:x.value||'',Notes:x.notes||'',Staff:pm[x.staff_id]?.full_name||'',Created:exportDateTime(x.created_at)}))};
  case 'handover': return {title:'Handovers',rows:state.handovers.map(x=>({Site:sm[x.site_id]?.name||'',Client:cm[x.client_id]?.full_name||'',Category:x.category||'General House',Priority:x.priority||'Routine',Status:handoverStatusLabel(x),Handover:x.handover_text||'',Staff:pm[x.staff_id]?.full_name||'',Acknowledged_By:pm[x.acknowledged_by]?.full_name||'',Acknowledged_At:exportDateTime(x.acknowledged_at),Completed_By:pm[x.completed_by]?.full_name||'',Completed_At:exportDateTime(x.completed_at),Completion_Note:x.completion_note||'',Created:exportDateTime(x.created_at)}))};
  case 'incidents': return {title:'Incidents and Reports',rows:state.incidents.map(x=>({Client:cm[x.client_id]?.full_name||'Site Incident',Incident_Type:x.incident_type||'',Severity:x.severity||'',Status:x.status||'',Description:x.description||'',Staff:pm[x.staff_id]?.full_name||'',Created:exportDateTime(x.created_at)}))};
  case 'compliance': return {title:'Training and Compliance',rows:state.compliance.map(x=>({Staff:pm[x.staff_id]?.full_name||'',Training_or_Certificate:x.item_name||'',Expiry:x.expiry_date||'',Status:x.status||''}))};
  case 'notifications': return {title:'Notifications',rows:(state.mode==='manager'?state.notifications:state.notifications.filter(x=>x.staff_id===profile.id)).map(x=>({Staff:pm[x.staff_id]?.full_name||'',Type:x.notification_type||'',Message:x.message||'',Read:x.read?'Yes':'No',Created:exportDateTime(x.created_at)}))};
  case 'documents': return {title:'Documents',rows:state.documents.map(x=>({Name:x.name||x.title||'',Type:x.document_type||x.type||'',Created:exportDateTime(x.created_at),Updated:exportDateTime(x.updated_at)}))};
  case 'online': return {title:'Online Staff',rows:onlineStaff().map(x=>({Staff:pm[x.staff_id]?.full_name||'',Site:sm[x.site_id]?.name||'',Clock_In:exportDateTime(x.clock_in),Duration:durationFrom(x.clock_in),Status:'Online'}))};
  default: return {title:(allNav.find(x=>x[0]===pageId)?.[2]||'CareHub Export'),rows:[]};
 }
}
function currentViewId(){return document.querySelector('.view.active')?.id||'dashboard';}
function exportActivePage(type){
 const page=currentViewId(),data=exportDataFor(page);
 if(!data.rows.length)return toast(`No exportable records on ${data.title}.`);
 if(page==='timesheets')return type==='excel'?exportTimesheetExcel(data):exportTimesheetPDF(data);
 if(type==='excel')return exportExcelData(data.title,data.rows);
 return exportPDFData(data.title,data.rows);
}
function exportTimesheetExcel(data){
 if(!window.XLSX)return toast('Excel export library did not load. Refresh the page and try again.');
 const wb=XLSX.utils.book_new();
 const summary=(data.summary||[]).map(s=>({Staff:s.staff,Shifts:s.shifts,Weekday_Rate:s.weekdayRate||'',Weekday_Hours:s.weekday.toFixed(2),Weekday_Pay:s.weekdayPay.toFixed(2),Saturday_Rate:s.saturdayRate||'',Saturday_Hours:s.saturday.toFixed(2),Saturday_Pay:s.saturdayPay.toFixed(2),Sunday_Rate:s.sundayRate||'',Sunday_Hours:s.sunday.toFixed(2),Sunday_Pay:s.sundayPay.toFixed(2),Sleepovers:s.sleepovers,Sleepover_Pay:s.sleepoverPay.toFixed(2),Total_Hours:s.total.toFixed(2),Total_KM:s.km.toFixed(1),KM_Rate:s.kmRate||'',KM_Reimbursement:s.reimbursement.toFixed(2),Estimated_Total_Pay:s.estimatedPay.toFixed(2)}));
 XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(summary),'Hours Summary');
 XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(data.rows),'Timesheets');
 XLSX.writeFile(wb,`timesheets-hours-report-${today}.xlsx`);
}
function exportTimesheetPDF(data){
 if(!window.jspdf?.jsPDF)return toast('PDF export library did not load. Refresh the page and try again.');
 const {jsPDF}=window.jspdf,doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a4'});
 const company=state.settings?.company_name||'UCC CareHub';doc.setFontSize(16);doc.text(`${company} - Timesheet Hours Report`,14,14);doc.setFontSize(9);doc.text(`Generated: ${new Date().toLocaleString('en-AU')}`,14,20);
 const sum=(data.summary||[]).map(s=>[s.staff,String(s.shifts),rateMoney(s.weekdayRate),s.weekday.toFixed(2),rateMoney(s.saturdayRate),s.saturday.toFixed(2),rateMoney(s.sundayRate),s.sunday.toFixed(2),s.total.toFixed(2),s.km.toFixed(1),rateMoney(s.kmRate),s.kmRate>0?'$'+s.reimbursement.toFixed(2):'—',s.estimatedPay>0?'$'+s.estimatedPay.toFixed(2):'—']);
 doc.autoTable({head:[['Staff','Shifts','Weekday Rate','Weekday Hrs','Saturday Rate','Saturday Hrs','Sunday Rate','Sunday Hrs','Total Hrs','Total KM','KM Rate','KM Reimb.','Est. Pay']],body:sum,startY:25,styles:{fontSize:6.5,cellPadding:1.2},headStyles:{fontSize:6.5},margin:{left:6,right:6}});
 const y=(doc.lastAutoTable?.finalY||25)+8,keys=Object.keys(data.rows[0]||{}),body=data.rows.map(r=>keys.map(k=>String(r[k]??'')));
 doc.setFontSize(12);doc.text('Timesheet Details',14,y);
 doc.autoTable({head:[keys.map(k=>k.replaceAll('_',' '))],body,startY:y+4,styles:{fontSize:6.5,cellPadding:1.2,overflow:'linebreak'},headStyles:{fontSize:6.5},margin:{left:6,right:6}});
 doc.save(`timesheets-hours-report-${today}.pdf`);
}
function exportExcelData(title,rows){
 if(!window.XLSX)return toast('Excel export library did not load. Refresh the page and try again.');
 const ws=XLSX.utils.json_to_sheet(rows),wb=XLSX.utils.book_new();
 XLSX.utils.book_append_sheet(wb,ws,'CareHub');
 XLSX.writeFile(wb,`${exportFileSafeName(title)}-${today}.xlsx`);
}
function exportPDFData(title,rows){
 if(!window.jspdf?.jsPDF)return toast('PDF export library did not load. Refresh the page and try again.');
 const keys=Object.keys(rows[0]||{}),body=rows.map(r=>keys.map(k=>String(r[k]??'')));
 const {jsPDF}=window.jspdf;const doc=new jsPDF({orientation:keys.length>6?'landscape':'portrait',unit:'mm',format:'a4'});
 const company=state.settings?.company_name||'UCC CareHub';doc.setFontSize(16);doc.text(`${company} - ${title}`,14,14);doc.setFontSize(9);doc.text(`Generated: ${new Date().toLocaleString('en-AU')}`,14,20);
 doc.autoTable({head:[keys.map(k=>k.replaceAll('_',' '))],body,startY:25,styles:{fontSize:7,cellPadding:1.5,overflow:'linebreak'},headStyles:{fontSize:7},margin:{left:8,right:8}});
 doc.save(`${exportFileSafeName(title)}-${today}.pdf`);
}

function renderAll(){
 renderDashboard();renderOnline();renderStaff();renderClients();renderSites();renderRoster();renderAvailability();renderTimesheets();renderNotes();renderMedication();renderHealth();renderHandover();renderIncidents();renderCompliance();renderDocuments();renderNotifications();renderReports();renderSettings();
 makeNav();
}


// ===== Smart Roster, Coverage & Workforce Report upgrade =====
function shiftMinutes(start,end){
 const a=String(start||'').slice(0,5).split(':').map(Number),b=String(end||'').slice(0,5).split(':').map(Number);
 if(a.length<2||b.length<2||a.some(Number.isNaN)||b.some(Number.isNaN))return 0;
 let x=a[0]*60+a[1],y=b[0]*60+b[1]; if(y<=x)y+=1440; return y-x;
}
function shiftOverlap(aStart,aEnd,bStart,bEnd){
 let a1=Number(String(aStart||'').slice(0,2))*60+Number(String(aStart||'').slice(3,5)),a2=Number(String(aEnd||'').slice(0,2))*60+Number(String(aEnd||'').slice(3,5));
 let b1=Number(String(bStart||'').slice(0,2))*60+Number(String(bStart||'').slice(3,5)),b2=Number(String(bEnd||'').slice(0,2))*60+Number(String(bEnd||'').slice(3,5));
 if(a2<=a1)a2+=1440;if(b2<=b1)b2+=1440;return Math.max(a1,b1)<Math.min(a2,b2);
}
function staffWeekHours(staffId,week){
 return state.roster.filter(r=>r.staff_id===staffId&&r.shift_date>=week&&r.shift_date<=addDaysISO(week,6)).reduce((n,r)=>n+shiftMinutes(r.start_time,r.end_time)/60,0);
}
function availabilityDayIndex(date){return new Date(String(date)+'T12:00:00').getDay();}
function availabilityRowsForDate(staffId,date){
 const all=(state.availability||[]).filter(a=>a.staff_id===staffId);
 const exact=all.filter(a=>(a.recurrence_type||'Date')==='Date'&&a.availability_date===date);
 // A date-specific exception always overrides the normal weekly pattern for that date.
 if(exact.length)return exact;
 const dow=availabilityDayIndex(date);
 return all.filter(a=>(a.recurrence_type||'Date')==='Weekly'&&Number(a.weekday)===dow&&(!a.effective_from||a.effective_from<=date)&&(!a.effective_to||a.effective_to>=date));
}
function staffAvailabilityFor(staffId,date,start,end){
 const rows=availabilityRowsForDate(staffId,date);
 const blocked=rows.some(a=>a.availability_status==='Unavailable'&&shiftOverlap(start,end,a.start_time||'00:00',a.end_time||'23:59'));
 const available=rows.some(a=>['Available','Preferred'].includes(a.availability_status)&&shiftOverlap(start,end,a.start_time||'00:00',a.end_time||'23:59'));
 const preferred=rows.some(a=>a.availability_status==='Preferred'&&shiftOverlap(start,end,a.start_time||'00:00',a.end_time||'23:59'));
 return {blocked,available,preferred,rows,source:rows.length?((rows[0].recurrence_type||'Date')==='Weekly'?'Weekly':'Date exception'):'None'};
}
function smartAvailability(date,start,end,siteId){
 const week=mondayOf(date||today), workers=state.staff.filter(s=>s.active&&(s.role==='staff'||s.can_work_as_staff));
 return workers.map(w=>{
  const sameDay=state.roster.filter(r=>r.staff_id===w.id&&r.shift_date===date&&String(r.status||'').toLowerCase()!=='cancelled');
  const conflict=sameDay.some(r=>shiftOverlap(start,end,r.start_time,r.end_time));
  const av=staffAvailabilityFor(w.id,date,start,end);
  const hrs=staffWeekHours(w.id,week),newH=shiftMinutes(start,end)/60;
  const siteExp=state.roster.filter(r=>r.staff_id===w.id&&r.site_id===siteId).length;
  let status=conflict?'Already rostered':av.blocked?'Unavailable':hrs+newH>50?'High weekly hours':av.preferred?`Preferred (${av.source})`:av.available?`Available (${av.source})`:'No availability submitted';
  return {worker:w,status,conflict,unavailable:av.blocked,preferred:av.preferred,weekHours:hrs,siteExp};
 }).sort((a,b)=>Number(a.conflict)-Number(b.conflict)||Number(a.unavailable)-Number(b.unavailable)||Number(b.preferred)-Number(a.preferred)||b.siteExp-a.siteExp||a.weekHours-b.weekHours);
}
function rosterWarningRows(){
 const warnings=[];const pm=byId(state.staff),sm=byId(state.sites);
 const key={};state.roster.forEach(r=>{const k=r.staff_id+'|'+r.shift_date;(key[k]??=[]).push(r)});
 Object.values(key).forEach(rows=>{for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++)if(shiftOverlap(rows[i].start_time,rows[i].end_time,rows[j].start_time,rows[j].end_time))warnings.push({type:'Double booking',text:`${pm[rows[i].staff_id]?.full_name||'Staff'} has overlapping shifts on ${fmt(rows[i].shift_date)}.`});});
 const todayRows=state.roster.filter(r=>r.shift_date===today);
 todayRows.forEach(r=>{const t=state.timesheets.find(x=>x.roster_shift_id===r.id);if(!t)warnings.push({type:'Clock-in check',text:`${pm[r.staff_id]?.full_name||'Staff'} has a rostered shift at ${sm[r.site_id]?.name||'site'} today with no linked timesheet yet.`});});
 state.timesheets.filter(t=>!t.clock_out).forEach(t=>{if(!t.roster_shift_id)warnings.push({type:'Unrostered clock-in',text:`${pm[t.staff_id]?.full_name||'Staff'} is clocked in without a linked roster shift.`});});
 return warnings.slice(0,12);
}
function renderRoster(){
 const pm=byId(state.staff),sm=byId(state.sites),cm=byId(state.clients),rows=(state.mode==='manager'?state.roster:state.roster.filter(x=>x.staff_id===profile.id)).slice().sort((a,b)=>String(a.shift_date).localeCompare(String(b.shift_date))||String(a.start_time).localeCompare(String(b.start_time)));
 const warnings=state.mode==='manager'?rosterWarningRows():[];
 el('roster').innerHTML=`<div class="roster-tabs"><button class="active" onclick="renderRoster()">📋 View Roster</button>${state.mode==='manager'?'<button onclick="renderSmartRosterBuilder()">✨ Smart Roster Builder</button><button onclick="renderRosterMaker()">🗓️ Weekly Grid</button>':''}</div>
 ${state.mode==='manager'?`<div class="grid g2"><div class="card"><div class="row between"><div><h2>Smart Roster</h2><div class="muted">Build a shift, check conflicts and choose the best available staff.</div></div><button class="btn btn-primary" onclick="renderSmartRosterBuilder()">+ Build Shift</button></div></div><div class="card"><h2>Roster Health</h2>${warnings.length?warnings.map(w=>`<div class="item"><b>⚠️ ${esc(w.type)}</b><div class="muted">${esc(w.text)}</div></div>`).join(''):'<div class="muted">No roster warnings detected.</div>'}</div></div>`:''}
 <div class="card" style="margin-top:14px"><div class="row between wrap"><div><h2>Roster & Shifts</h2><div class="muted">Published shifts with exact start/end times and site coverage.</div></div>${state.mode==='manager'?'<button class="btn btn-secondary" onclick="renderHouseCoverage()">🏠 House Coverage</button>':''}</div>
 <div class="tablewrap"><table><thead><tr><th>Date</th><th>Day</th><th>Staff</th><th>Site</th><th>Client</th><th>Start</th><th>End</th><th>Hours</th><th>Type</th><th>Status</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${fmt(x.shift_date)}</td><td>${new Date(x.shift_date+'T12:00:00').toLocaleDateString('en-AU',{weekday:'long'})}</td><td>${esc(pm[x.staff_id]?.full_name||'')}</td><td>${esc(sm[x.site_id]?.name||'')}</td><td>${esc(cm[x.client_id]?.full_name||'—')}</td><td>${formatTime12(x.start_time)}</td><td>${formatTime12(x.end_time)}</td><td>${(shiftMinutes(x.start_time,x.end_time)/60).toFixed(2)}</td><td>${esc(x.shift_type||'')}</td><td>${pill(x.status||'Rostered')}</td></tr>`).join('')||'<tr><td colspan="10">No rostered shifts.</td></tr>'}</tbody></table></div></div>`;
}
function renderSmartRosterBuilder(){
 if(state.mode!=='manager')return renderRoster();
 const [ds,de]=shiftDefaults('Day');
 el('roster').innerHTML=`<div class="roster-tabs"><button onclick="renderRoster()">📋 View Roster</button><button class="active">✨ Smart Roster Builder</button><button onclick="renderRosterMaker()">🗓️ Weekly Grid</button></div>
 <div class="card"><div class="row between wrap"><div><h2>Roster Builder</h2><div class="muted">Choose the house, date and shift. CareHub checks roster conflicts and weekly hours before assignment.</div></div><button class="btn btn-secondary" onclick="renderRoster()">Back to Roster</button></div>
 <div class="grid g3" style="margin-top:12px"><div class="field"><label>Site / House</label><select id="smart_site" onchange="refreshAvailableStaff()">${state.sites.filter(s=>s.active).map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div><div class="field"><label>Shift date</label><input id="smart_date" type="date" value="${today}" onchange="refreshAvailableStaff()"></div><div class="field"><label>Shift label</label><select id="smart_type" onchange="smartApplyType()">${['Day','Evening','Night','Sleepover','Short Shift','Custom'].map(x=>`<option>${x}</option>`).join('')}</select></div></div>
 <div class="grid g3"><div class="field"><label>Start time</label><input id="smart_start" type="time" value="${ds}" onchange="refreshAvailableStaff()"></div><div class="field"><label>End time</label><input id="smart_end" type="time" value="${de}" onchange="refreshAvailableStaff()"></div><div class="field"><label>Client (optional)</label><select id="smart_client"><option value="">No specific client</option>${state.clients.filter(c=>c.active).map(c=>`<option value="${c.id}">${esc(c.full_name)}</option>`).join('')}</select></div></div>
 <div class="row wrap" style="margin:10px 0"><button class="btn btn-primary" onclick="refreshAvailableStaff()">🔎 Find Available Staff</button><button class="btn btn-green" onclick="autoAssignSmartShift()">✨ Auto Assign Best Staff</button></div></div>
 <div id="smart_available" class="card" style="margin-top:14px"></div>`;
 refreshAvailableStaff();
}
function smartApplyType(){const [s,e]=shiftDefaults(el('smart_type').value);if(s)el('smart_start').value=s;if(e)el('smart_end').value=e;refreshAvailableStaff();}
function refreshAvailableStaff(){
 const box=el('smart_available');if(!box)return;const date=el('smart_date').value,start=el('smart_start').value,end=el('smart_end').value,site=el('smart_site').value;
 if(!date||!start||!end){box.innerHTML='<div class="muted">Choose date and times.</div>';return;}
 const list=smartAvailability(date,start,end,site);window._smartAvailable=list;
 box.innerHTML=`<div class="row between wrap"><div><h2>Available Staff</h2><div class="muted">Prioritised by no conflict, experience at this site and lower weekly rostered hours.</div></div><span class="pill info">${(shiftMinutes(start,end)/60).toFixed(2)} hour shift</span></div><div class="tablewrap"><table><thead><tr><th>Staff</th><th>Status</th><th>Week Hours</th><th>Previous Shifts at Site</th><th>Action</th></tr></thead><tbody>${list.map(a=>`<tr><td><b>${esc(a.worker.full_name)}</b></td><td>${a.conflict?pill('Open').replace('Open','Already rostered'):a.status==='High weekly hours'?'<span class="pill warn">High weekly hours</span>':'<span class="pill ok">Available</span>'}</td><td>${a.weekHours.toFixed(1)}</td><td>${a.siteExp}</td><td><button class="btn ${a.conflict?'btn-secondary':'btn-primary'}" ${a.conflict?'disabled':''} onclick="addSmartShift('${a.worker.id}')">Assign</button></td></tr>`).join('')}</tbody></table></div>`;
}
async function addSmartShift(staffId){
 const due=new Date(Date.now()+24*60*60*1000).toISOString();
 const row={staff_id:staffId,site_id:el('smart_site').value,client_id:el('smart_client').value||null,shift_date:el('smart_date').value,start_time:el('smart_start').value,end_time:el('smart_end').value,shift_type:el('smart_type').value,status:'Rostered',assignment_status:'Pending',response_due_at:due,is_open:false,created_by:profile.id};
 const check=smartAvailability(row.shift_date,row.start_time,row.end_time,row.site_id).find(a=>a.worker.id===staffId);
 if(check?.conflict)return toast('This staff member already has an overlapping shift.');
 if(check?.unavailable&&!confirm('This staff member marked themselves unavailable for this time. Assign anyway?'))return;
 const {error}=await sb.from('roster_shifts').insert(row);if(error)return toast(error.message);
 await sb.from('staff_notifications').insert({staff_id:staffId,notification_type:'Roster Confirmation Required',message:`Please confirm or decline by ${new Date(due).toLocaleString('en-AU')}: ${fmt(row.shift_date)} ${formatTime12(row.start_time)}–${formatTime12(row.end_time)} at ${byId(state.sites)[row.site_id]?.name||'site'}`});
 await loadAll();refreshAvailableStaff();toast('Shift assigned — staff has 24 hours to confirm or decline.');
}
async function autoAssignSmartShift(){const a=(window._smartAvailable||[]).find(x=>!x.conflict&&x.status!=='High weekly hours')||(window._smartAvailable||[]).find(x=>!x.conflict);if(!a)return toast('No conflict-free staff available for this shift.');await addSmartShift(a.worker.id);}
function renderHouseCoverage(){
 if(state.mode!=='manager')return;const sm=byId(state.sites),pm=byId(state.staff),cm=byId(state.clients);
 el('roster').innerHTML=`<div class="roster-tabs"><button onclick="renderRoster()">📋 View Roster</button><button onclick="renderSmartRosterBuilder()">✨ Smart Roster Builder</button><button class="active">🏠 House Coverage</button></div><div class="grid g2">${state.sites.filter(s=>s.active).map(site=>{const shifts=state.roster.filter(r=>r.site_id===site.id&&r.shift_date===today).sort((a,b)=>String(a.start_time).localeCompare(String(b.start_time)));const active=state.timesheets.filter(t=>t.site_id===site.id&&!t.clock_out);const clients=state.clients.filter(c=>c.site_id===site.id&&c.active);const hos=state.handovers.filter(h=>h.site_id===site.id).slice().sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,2);return `<div class="card"><div class="row between"><h2>🏠 ${esc(site.name)}</h2><span class="pill ${active.length?'ok':'warn'}">${active.length} online</span></div><div class="muted">${clients.length} active client${clients.length===1?'':'s'} • ${shifts.length} shift${shifts.length===1?'':'s'} today</div><h3 style="margin-top:14px">Today's Coverage</h3>${shifts.map(r=>`<div class="item"><b>${formatTime12(r.start_time)}–${formatTime12(r.end_time)} • ${esc(pm[r.staff_id]?.full_name||'')}</b><div class="muted">${esc(r.shift_type||'Shift')} ${r.client_id?'• '+esc(cm[r.client_id]?.full_name||''):''}</div></div>`).join('')||'<div class="muted">No shifts rostered today.</div>'}<h3 style="margin-top:14px">Latest Handover</h3>${hos.map(h=>`<div class="item"><b>${esc(cm[h.client_id]?.full_name||'Client')}</b><div class="muted">${esc(h.handover_text||'')}</div></div>`).join('')||'<div class="muted">No recent handover.</div>'}</div>`}).join('')}</div>`;
}
function workforceReportSummary(rows){
 const sum=timesheetSummary(rows),pm=byId(state.staff),rmap=byId(state.roster);
 return sum.map(s=>{const staff=state.staff.find(x=>x.full_name===s.staff);const mine=rows.filter(x=>x.staff_id===staff?.id);const approved=mine.filter(x=>x.status==='Approved').length,pending=mine.filter(x=>x.status==='Pending').length;return {...s,approved,pending};});
}
function renderReports(){
 if(state.mode!=='manager'){el('reports').innerHTML='<div class="card">Manager access required.</div>';return;}
 const rows=state.timesheets.filter(x=>x.clock_in&&x.clock_out),sum=workforceReportSummary(rows);const total=sum.reduce((a,s)=>({hours:a.hours+s.total,km:a.km+s.km,pay:a.pay+s.estimatedPay,shifts:a.shifts+s.shifts,sleep:a.sleep+s.sleepovers,pending:a.pending+s.pending}),{hours:0,km:0,pay:0,shifts:0,sleep:0,pending:0});
 el('reports').innerHTML=`<div class="card"><div class="row between wrap"><div><h2>Staff & Payroll Summary</h2><div class="muted">Operational summary using completed timesheets and each worker's individual pay/KM rates.</div></div><div class="row wrap"><button class="btn btn-secondary" onclick="exportCurrentPage('csv')">CSV</button><button class="btn btn-primary" onclick="downloadExcelCurrent()">Download Excel</button><button class="btn btn-danger" onclick="downloadPdfCurrent()">Download PDF</button></div></div>
 <div class="grid g6" style="margin-top:14px"><div class="card kpi"><b>${sum.length}</b><span>Staff worked</span></div><div class="card kpi"><b>${total.shifts}</b><span>Total shifts</span></div><div class="card kpi"><b>${total.hours.toFixed(1)}</b><span>Total hours</span></div><div class="card kpi"><b>${total.km.toFixed(1)}</b><span>Total KM</span></div><div class="card kpi"><b>$${total.pay.toFixed(2)}</b><span>Estimated payroll</span></div><div class="card kpi"><b>${total.pending}</b><span>Pending approvals</span></div></div>
 <div class="tablewrap" style="margin-top:14px"><table><thead><tr><th>Staff</th><th>Shifts</th><th>Sleepovers</th><th>Weekdays</th><th>Saturday</th><th>Sunday</th><th>Total Hours</th><th>KM</th><th>KM Reimb.</th><th>Est. Pay</th><th>Approved</th><th>Pending</th></tr></thead><tbody>${sum.map(s=>`<tr><td><b>${esc(s.staff)}</b></td><td>${s.shifts}</td><td>${s.sleepovers}</td><td>${s.weekday.toFixed(2)}</td><td>${s.saturday.toFixed(2)}</td><td>${s.sunday.toFixed(2)}</td><td><b>${s.total.toFixed(2)}</b></td><td>${s.km.toFixed(1)}</td><td>$${s.reimbursement.toFixed(2)}</td><td><b>$${s.estimatedPay.toFixed(2)}</b></td><td>${s.approved}</td><td>${s.pending}</td></tr>`).join('')||'<tr><td colspan="12">No completed timesheets in the report.</td></tr>'}</tbody></table></div></div>
 <div class="grid g2" style="margin-top:14px"><div class="card"><h2>Roster Health</h2>${rosterWarningRows().map(w=>`<div class="item"><b>⚠️ ${esc(w.type)}</b><div class="muted">${esc(w.text)}</div></div>`).join('')||'<div class="muted">No warnings detected.</div>'}</div><div class="card"><h2>Care Documentation Watch</h2>${state.roster.filter(r=>r.shift_date===today).slice(0,10).map(r=>{const note=state.notes.some(n=>n.staff_id===r.staff_id&&String(n.created_at||'').slice(0,10)===today);return `<div class="item row between"><span>${esc(byId(state.staff)[r.staff_id]?.full_name||'Staff')} • ${esc(byId(state.sites)[r.site_id]?.name||'Site')}</span>${note?'<span class="pill ok">Note recorded</span>':'<span class="pill warn">Check note</span>'}</div>`}).join('')||'<div class="muted">No shifts today.</div>'}</div></div>`;
}
// ===== End Smart Roster upgrade =====

window.addEventListener('DOMContentLoaded',async()=>{
 if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
 if(!initSupabase()) return;
 const {data:{session}}=await sb.auth.getSession();
 if(session?.user){authUser=session.user;state.loginRole='manager';await startAuthenticatedApp();}
});

// ===== Staff Availability + Shift Confirmation + Open Shift Marketplace =====
function availabilityWeekdayName(n){return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][Number(n)]||'—';}
function availabilityWhen(a){
 if((a.recurrence_type||'Date')==='Weekly') return `${availabilityWeekdayName(a.weekday)} every week${a.effective_from?' from '+fmt(a.effective_from):''}${a.effective_to?' until '+fmt(a.effective_to):''}`;
 return `${fmt(a.availability_date)} (exception)`;
}
function renderAvailability(){
 const root=el('availability');if(!root)return;
 const mine=(state.mode==='manager'?state.availability:state.availability.filter(a=>a.staff_id===profile.id)).slice().sort((a,b)=>String(a.staff_id).localeCompare(String(b.staff_id))||String(a.recurrence_type||'Date').localeCompare(String(b.recurrence_type||'Date'))||String(a.weekday??'').localeCompare(String(b.weekday??''))||String(a.availability_date||'').localeCompare(String(b.availability_date||''))||String(a.start_time).localeCompare(String(b.start_time)));
 if(state.mode==='staff'){
  root.innerHTML=`<div class="care-banner"><b>🗓️ Persistent Availability</b><div class="small">Your regular weekly availability stays active every week until you or a manager changes it. Use a temporary exception for a specific date.</div></div>
  <div class="grid g2" style="margin-top:14px">
   <div class="card"><h2>Regular Weekly Availability</h2><div class="muted">Set once and CareHub continues using it for future rosters.</div><div class="grid g2" style="margin-top:12px"><div class="field"><label>Day</label><select id="av_weekday">${['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((d,i)=>`<option value="${i}" ${i===1?'selected':''}>${d}</option>`).join('')}</select></div><div class="field"><label>Status</label><select id="av_weekly_status"><option>Available</option><option>Preferred</option><option>Unavailable</option></select></div><div class="field"><label>From</label><input id="av_weekly_start" type="time" value="07:00"></div><div class="field"><label>To</label><input id="av_weekly_end" type="time" value="23:00"></div><div class="field"><label>Effective from</label><input id="av_effective_from" type="date" value="${today}"></div></div><div class="field"><label>Notes (optional)</label><input id="av_weekly_notes" placeholder="e.g. prefer evening shifts"></div><button class="btn btn-primary" onclick="saveWeeklyAvailability()">Save Weekly Availability</button></div>
   <div class="card"><h2>Temporary Exception</h2><div class="muted">Use this when one particular date is different from your normal weekly availability.</div><div class="grid g2" style="margin-top:12px"><div class="field"><label>Date</label><input id="av_date" type="date" min="${today}" value="${today}"></div><div class="field"><label>Status</label><select id="av_status"><option>Available</option><option>Preferred</option><option>Unavailable</option></select></div><div class="field"><label>From</label><input id="av_start" type="time" value="07:00"></div><div class="field"><label>To</label><input id="av_end" type="time" value="23:00"></div></div><div class="field"><label>Notes (optional)</label><input id="av_notes" placeholder="e.g. appointment, available only after 4 PM"></div><button class="btn btn-secondary" onclick="saveAvailabilityException()">Save Date Exception</button></div>
  </div>
  <div class="card" style="margin-top:14px"><h2>My Availability</h2><div class="muted">Weekly entries remain until changed. Date exceptions override the weekly pattern only on that date.</div>${availabilityTable(mine,false)}</div>`;
 }else{
  root.innerHTML=`<div class="card"><h2>🗓️ Staff Availability</h2><div class="muted">Regular weekly availability remains active until changed. Temporary date exceptions take priority over the weekly pattern.</div>${availabilityTable(mine,true)}</div>`;
 }
}
function availabilityTable(rows,showStaff){
 const pm=byId(state.staff);
 return `<div class="tablewrap"><table><thead><tr>${showStaff?'<th>Staff</th>':''}<th>Pattern</th><th>When</th><th>From</th><th>To</th><th>Status</th><th>Notes</th><th>Action</th></tr></thead><tbody>${rows.map(a=>`<tr>${showStaff?`<td><b>${esc(pm[a.staff_id]?.full_name||'')}</b></td>`:''}<td>${(a.recurrence_type||'Date')==='Weekly'?'<b>Weekly</b>':'Date exception'}</td><td>${esc(availabilityWhen(a))}</td><td>${formatTime12(a.start_time)}</td><td>${formatTime12(a.end_time)}</td><td>${pill(a.availability_status||'Available')}</td><td>${esc(a.notes||'')}</td><td><div class="row wrap"><button class="btn btn-secondary" onclick="editAvailability('${a.id}')">Edit</button><button class="btn btn-danger" onclick="deleteAvailability('${a.id}')">Delete</button></div></td></tr>`).join('')||`<tr><td colspan="${showStaff?8:7}">No availability submitted.</td></tr>`}</tbody></table></div>`;
}
async function saveWeeklyAvailability(){
 const effective=el('av_effective_from').value||today, weekday=Number(el('av_weekday').value);
 const row={staff_id:profile.id,availability_date:effective,recurrence_type:'Weekly',weekday,effective_from:effective,effective_to:null,start_time:el('av_weekly_start').value,end_time:el('av_weekly_end').value,availability_status:el('av_weekly_status').value,notes:el('av_weekly_notes').value.trim()||null};
 if(!row.start_time||!row.end_time)return toast('Choose start and end time.');
 // Replace the same weekly day/time pattern rather than creating endless duplicates.
 const {error:delErr}=await sb.from('staff_availability').delete().eq('staff_id',profile.id).eq('recurrence_type','Weekly').eq('weekday',weekday).eq('start_time',row.start_time).eq('end_time',row.end_time);if(delErr)return toast(delErr.message);
 const {error}=await sb.from('staff_availability').insert(row);if(error)return toast(error.message);await loadAll();renderAvailability();toast('Weekly availability saved and will remain active until changed.');
}
async function saveAvailabilityException(){
 const row={staff_id:profile.id,availability_date:el('av_date').value,recurrence_type:'Date',weekday:null,effective_from:null,effective_to:null,start_time:el('av_start').value,end_time:el('av_end').value,availability_status:el('av_status').value,notes:el('av_notes').value.trim()||null};
 if(!row.availability_date||!row.start_time||!row.end_time)return toast('Choose a date, start time and end time.');
 const {error}=await sb.from('staff_availability').insert(row);if(error)return toast(error.message);await loadAll();renderAvailability();toast('Temporary availability exception saved.');
}
async function editAvailability(id){
 const a=state.availability.find(x=>x.id===id);if(!a)return;
 const status=prompt('Status: Available, Preferred or Unavailable',a.availability_status||'Available');if(status===null)return;
 if(!['Available','Preferred','Unavailable'].includes(status))return toast('Use Available, Preferred or Unavailable.');
 const start=prompt('Start time (HH:MM)',String(a.start_time||'07:00').slice(0,5));if(start===null)return;
 const end=prompt('End time (HH:MM)',String(a.end_time||'23:00').slice(0,5));if(end===null)return;
 const notes=prompt('Notes (optional)',a.notes||'');
 const {error}=await sb.from('staff_availability').update({availability_status:status,start_time:start,end_time:end,notes:notes||null,updated_at:new Date().toISOString()}).eq('id',id);if(error)return toast(error.message);await loadAll();renderAvailability();toast('Availability updated.');
}
async function deleteAvailability(id){
 if(!confirm('Delete this availability entry?'))return;
 let q=sb.from('staff_availability').delete().eq('id',id);if(state.mode==='staff')q=q.eq('staff_id',profile.id);
 const {error}=await q;if(error)return toast(error.message);await loadAll();renderAvailability();toast('Availability deleted.');
}
function responseTimeLeft(r){if(!r.response_due_at)return '';const ms=new Date(r.response_due_at)-Date.now();if(ms<=0)return 'Response time expired';const h=Math.floor(ms/3600000),m=Math.floor((ms%3600000)/60000);return `${h}h ${m}m remaining`;}
async function respondToShift(id,decision){
 const r=state.roster.find(x=>x.id===id);if(!r||r.staff_id!==profile.id)return;
 if(r.response_due_at&&new Date(r.response_due_at)<new Date())return toast('The 24-hour response period has expired. Please contact the manager.');
 if(decision==='Declined'){
   const reason=prompt('Optional reason for declining this shift:')||null;
   const {error}=await sb.from('roster_shifts').update({assignment_status:'Declined',declined_at:new Date().toISOString(),decline_reason:reason}).eq('id',id).eq('staff_id',profile.id);if(error)return toast(error.message);
 }else{
   const {error}=await sb.from('roster_shifts').update({assignment_status:'Confirmed',accepted_at:new Date().toISOString()}).eq('id',id).eq('staff_id',profile.id);if(error)return toast(error.message);
 }
 await loadAll();renderRoster();toast(`Shift ${decision.toLowerCase()}.`);
}
async function pickOpenShift(id){
 const r=state.roster.find(x=>x.id===id);if(!r||!r.is_open)return toast('This shift is no longer open.');
 const av=staffAvailabilityFor(profile.id,r.shift_date,r.start_time,r.end_time);if(av.blocked)return toast('You are marked unavailable for this time. Update your availability or ask a manager before picking this shift.');
 const conflict=state.roster.filter(x=>x.staff_id===profile.id&&x.shift_date===r.shift_date&&x.id!==id&&String(x.status||'').toLowerCase()!=='cancelled').some(x=>shiftOverlap(r.start_time,r.end_time,x.start_time,x.end_time));
 if(conflict)return toast('You already have an overlapping shift.');
 const now=new Date().toISOString();
 const {data,error}=await sb.from('roster_shifts').update({staff_id:profile.id,is_open:false,assignment_status:'Confirmed',accepted_at:now,claimed_at:now}).eq('id',id).eq('is_open',true).is('staff_id',null).select();
 if(error)return toast(error.message);if(!data?.length){await loadAll();renderRoster();return toast('Another staff member has already picked this shift.');}
 await loadAll();renderRoster();toast('Shift successfully added to your roster.');
}
function openCreateOpenShift(){
 if(state.mode!=='manager')return;
 openModal('Create Open Shift',`<div class="care-banner"><b>Open shift</b><div class="small">Any eligible support worker can pick this shift. First successful claim gets it.</div></div><div class="grid g2"><div class="field"><label>Site / House</label><select id="os_site">${state.sites.filter(s=>s.active).map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div><div class="field"><label>Client (optional)</label><select id="os_client"><option value="">No specific client</option>${state.clients.filter(c=>c.active).map(c=>`<option value="${c.id}">${esc(c.full_name)}</option>`).join('')}</select></div><div class="field"><label>Date</label><input id="os_date" type="date" min="${today}" value="${today}"></div><div class="field"><label>Shift type</label><select id="os_type"><option>Day</option><option>Evening</option><option>Night</option><option>Sleepover</option><option>Short Shift</option><option>Custom</option></select></div><div class="field"><label>Start</label><input id="os_start" type="time" value="09:00"></div><div class="field"><label>End</label><input id="os_end" type="time" value="15:00"></div></div><div class="form-actions"><button class="btn btn-primary" onclick="saveOpenShift()">Publish Open Shift</button><button class="btn btn-secondary" onclick="closeModal()">Cancel</button></div>`);
}
async function saveOpenShift(){
 const row={staff_id:null,site_id:el('os_site').value,client_id:el('os_client').value||null,shift_date:el('os_date').value,start_time:el('os_start').value,end_time:el('os_end').value,shift_type:el('os_type').value,status:'Rostered',assignment_status:'Open',is_open:true,created_by:profile.id};
 if(!row.site_id||!row.shift_date||!row.start_time||!row.end_time)return toast('Complete the shift details.');
 const {error}=await sb.from('roster_shifts').insert(row);if(error)return toast(error.message);closeModal();await loadAll();renderRoster();toast('Open shift published.');
}
function shiftAssignmentBadge(r){
 if(r.is_open)return '<span class="pill bad">Open Shift</span>';
 const s=r.assignment_status||'Confirmed';
 if(s==='Confirmed')return '<span class="pill ok">Confirmed</span>';
 if(s==='Declined')return '<span class="pill bad">Declined</span>';
 if(s==='Pending')return '<span class="pill warn">Awaiting Confirmation</span>';
 return pill(s);
}
function rosterLinkedRecords(r){
 const ts=state.timesheets.filter(t=>t.roster_shift_id===r.id);
 const hasCare=ts.some(t=>state.notes.some(n=>n.timesheet_id===t.id)||state.handovers.some(h=>h.timesheet_id===t.id)||state.meds.some(m=>m.timesheet_id===t.id));
 return {timesheets:ts,hasCare};
}
function viewRosterShift(id){
 const r=state.roster.find(x=>x.id===id);if(!r)return;
 const pm=byId(state.staff),sm=byId(state.sites),cm=byId(state.clients),ln=rosterLinkedRecords(r);
 openModal('Roster Shift Details',`<div class="care-banner"><b>${fmt(r.shift_date)} • ${formatTime12(r.start_time)}–${formatTime12(r.end_time)}</b><div class="small">${esc(sm[r.site_id]?.name||'Site')} ${r.client_id?'• '+esc(cm[r.client_id]?.full_name||''):''}</div></div><div class="grid g2" style="margin-top:14px"><div class="record-card"><b>Staff</b><div>${esc(pm[r.staff_id]?.full_name||'Open shift')}</div></div><div class="record-card"><b>Shift type</b><div>${esc(r.shift_type||'Shift')}</div></div><div class="record-card"><b>Response</b><div>${shiftAssignmentBadge(r)}</div></div><div class="record-card"><b>Status</b><div>${pill(r.status||'Rostered')}</div></div></div><div class="small muted" style="margin-top:12px">Linked timesheets: ${ln.timesheets.length}${ln.hasCare?' • Care documentation exists':''}</div>`);
}
function editRosterShift(id){
 if(state.mode!=='manager')return toast('Manager access required.');
 const r=state.roster.find(x=>x.id===id);if(!r)return;
 const staffOpts=`<option value="">Open / unassigned</option>`+state.staff.filter(x=>x.active&&(x.role==='staff'||x.can_work_as_staff)).map(x=>`<option value="${x.id}" ${x.id===r.staff_id?'selected':''}>${esc(x.full_name)}</option>`).join('');
 const siteOpts=state.sites.filter(x=>x.active).map(x=>`<option value="${x.id}" ${x.id===r.site_id?'selected':''}>${esc(x.name)}</option>`).join('');
 const clientOpts=`<option value="">No specific client</option>`+state.clients.filter(x=>x.active).map(x=>`<option value="${x.id}" ${x.id===r.client_id?'selected':''}>${esc(x.full_name)}</option>`).join('');
 openModal('Edit / Adjust Shift',`<div class="care-banner"><b>Adjust rostered shift</b><div class="small">Roster changes do not overwrite actual worked hours already recorded in a timesheet.</div></div><div class="grid g2" style="margin-top:14px"><div class="field"><label>Staff</label><select id="er_staff">${staffOpts}</select></div><div class="field"><label>Site / House</label><select id="er_site">${siteOpts}</select></div><div class="field"><label>Client (optional)</label><select id="er_client">${clientOpts}</select></div><div class="field"><label>Date</label><input id="er_date" type="date" value="${r.shift_date}"></div><div class="field"><label>Start</label><input id="er_start" type="time" value="${String(r.start_time).slice(0,5)}"></div><div class="field"><label>End</label><input id="er_end" type="time" value="${String(r.end_time).slice(0,5)}"></div><div class="field"><label>Shift type</label><select id="er_type">${['Day','Evening','Night','Sleepover','Short Shift','Custom'].map(x=>`<option ${x===(r.shift_type||'')?'selected':''}>${x}</option>`).join('')}</select></div><div class="field"><label>Status</label><select id="er_status">${['Rostered','Cancelled'].map(x=>`<option ${x===(r.status||'Rostered')?'selected':''}>${x}</option>`).join('')}</select></div></div><div class="field"><label>Reason / manager note (optional)</label><textarea id="er_reason" placeholder="Reason for roster adjustment"></textarea></div><div class="form-actions"><button class="btn btn-primary" onclick="saveRosterShiftEdit('${id}')">Save Changes</button><button class="btn btn-secondary" onclick="closeModal()">Cancel</button></div>`);
}
async function saveRosterShiftEdit(id){
 const old=state.roster.find(x=>x.id===id);if(!old)return;
 const staff_id=el('er_staff').value||null,is_open=!el('er_staff').value;
 const row={staff_id,site_id:el('er_site').value,client_id:el('er_client').value||null,shift_date:el('er_date').value,start_time:el('er_start').value,end_time:el('er_end').value,shift_type:el('er_type').value,status:el('er_status').value,is_open,assignment_status:is_open?'Open':(staff_id===old.staff_id?(old.assignment_status||'Confirmed'):'Pending'),response_due_at:staff_id&&staff_id!==old.staff_id?new Date(Date.now()+24*3600000).toISOString():old.response_due_at};
 if(!row.site_id||!row.shift_date||!row.start_time||!row.end_time)return toast('Complete the shift details.');
 const {error}=await sb.from('roster_shifts').update(row).eq('id',id);if(error)return toast(error.message);
 if(staff_id&&staff_id!==old.staff_id)await sb.from('staff_notifications').insert({staff_id,notification_type:'Roster Confirmation Required',message:`Please confirm or decline within 24 hours: ${fmt(row.shift_date)} ${formatTime12(row.start_time)}–${formatTime12(row.end_time)} at ${byId(state.sites)[row.site_id]?.name||'site'}`});
 closeModal();await loadAll();renderRoster();toast('Roster shift updated.');
}
async function duplicateRosterShift(id){
 if(state.mode!=='manager')return toast('Manager access required.');
 const r=state.roster.find(x=>x.id===id);if(!r)return;
 const copy={staff_id:r.staff_id||null,site_id:r.site_id,client_id:r.client_id||null,shift_date:r.shift_date,start_time:r.start_time,end_time:r.end_time,shift_type:r.shift_type,status:'Rostered',created_by:profile.id,is_open:!!r.is_open,assignment_status:r.staff_id?'Pending':'Open',response_due_at:r.staff_id?new Date(Date.now()+24*3600000).toISOString():null};
 const {error}=await sb.from('roster_shifts').insert(copy);if(error)return toast(error.message);await loadAll();renderRoster();toast('Shift duplicated.');
}
async function cancelRosterShift(id){
 if(state.mode!=='manager')return toast('Manager access required.');
 if(!confirm('Cancel this rostered shift?'))return;
 const {error}=await sb.from('roster_shifts').update({status:'Cancelled'}).eq('id',id);if(error)return toast(error.message);await loadAll();renderRoster();toast('Shift cancelled.');
}
async function deleteRosterShift(id){
 if(state.mode!=='manager')return toast('Manager access required.');
 const r=state.roster.find(x=>x.id===id);if(!r)return;const ln=rosterLinkedRecords(r);
 if(ln.timesheets.length||ln.hasCare)return toast('This shift has linked timesheet/care records. Cancel it instead to preserve the audit trail.');
 if(!confirm('Permanently delete this rostered shift?'))return;
 const {error}=await sb.from('roster_shifts').delete().eq('id',id);if(error)return toast(error.message);await loadAll();renderRoster();toast('Shift deleted.');
}
function renderRoster(){
 const pm=byId(state.staff),sm=byId(state.sites),cm=byId(state.clients);
 if(state.mode==='staff'){
   const mine=state.roster.filter(r=>r.staff_id===profile.id).slice().sort((a,b)=>String(a.shift_date).localeCompare(String(b.shift_date))||String(a.start_time).localeCompare(String(b.start_time)));
   const open=state.roster.filter(r=>r.is_open&&!r.staff_id&&r.shift_date>=today&&String(r.status||'').toLowerCase()!=='cancelled').slice().sort((a,b)=>String(a.shift_date).localeCompare(String(b.shift_date))||String(a.start_time).localeCompare(String(b.start_time)));
   el('roster').innerHTML=`<div class="roster-tabs"><button class="active" onclick="renderRoster()">📋 My Roster</button><button onclick="show('availability')">🗓️ My Availability</button></div><div class="grid g2"><div class="card"><h2>My Rostered Shifts</h2><div class="muted">Confirm or decline newly assigned shifts within 24 hours.</div>${mine.map(r=>`<div class="item"><div class="row between wrap"><div><b>${fmt(r.shift_date)} • ${formatTime12(r.start_time)}–${formatTime12(r.end_time)}</b><div class="muted">${esc(sm[r.site_id]?.name||'')} ${r.client_id?'• '+esc(cm[r.client_id]?.full_name||''):''}</div></div>${shiftAssignmentBadge(r)}</div>${r.assignment_status==='Pending'?`<div class="small" style="margin-top:6px">⏳ ${esc(responseTimeLeft(r))}</div><div class="row wrap" style="margin-top:8px"><button class="btn btn-green" onclick="respondToShift('${r.id}','Confirmed')">✓ Confirm</button><button class="btn btn-danger" onclick="respondToShift('${r.id}','Declined')">Decline</button></div>`:''}</div>`).join('')||'<div class="muted">No rostered shifts.</div>'}</div><div class="card"><h2>Open Shifts</h2><div class="muted">Available shifts that have not yet been assigned. Pick one if you want to work it.</div>${open.map(r=>`<div class="item"><div class="row between wrap"><div><b>${fmt(r.shift_date)} • ${formatTime12(r.start_time)}–${formatTime12(r.end_time)}</b><div class="muted">${esc(sm[r.site_id]?.name||'')} • ${esc(r.shift_type||'Shift')} • ${(shiftMinutes(r.start_time,r.end_time)/60).toFixed(2)} hrs</div></div><button class="btn btn-primary" onclick="pickOpenShift('${r.id}')">Pick Shift</button></div></div>`).join('')||'<div class="muted">No open shifts available.</div>'}</div></div>`;
   return;
 }
 const rows=state.roster.slice().sort((a,b)=>String(a.shift_date).localeCompare(String(b.shift_date))||String(a.start_time).localeCompare(String(b.start_time)));
 const warnings=rosterWarningRows();
 el('roster').innerHTML=`<div class="care-banner"><b>✅ Consolidated roster build active</b><div class="small">Availability, open shifts, confirmation and roster actions are included in this version.</div></div><div class="roster-tabs" style="margin-top:12px"><button class="active" onclick="renderRoster()">📋 View Roster</button><button onclick="show('availability')">🗓️ Staff Availability</button><button onclick="renderSmartRosterBuilder()">✨ Smart Roster Builder</button><button onclick="renderRosterMaker()">🗓️ Weekly Grid</button></div><div class="grid g2"><div class="card"><div class="row between wrap"><div><h2>Smart Roster</h2><div class="muted">Assign staff with 24-hour confirmation or publish an open shift.</div></div><div class="row wrap"><button class="btn btn-primary" onclick="renderSmartRosterBuilder()">+ Assign Shift</button><button class="btn btn-green" onclick="openCreateOpenShift()">+ Open Shift</button></div></div></div><div class="card"><h2>Roster Health</h2>${warnings.length?warnings.map(w=>`<div class="item"><b>⚠️ ${esc(w.type)}</b><div class="muted">${esc(w.text)}</div></div>`).join(''):'<div class="muted">No roster warnings detected.</div>'}</div></div><div class="card" style="margin-top:14px"><h2>Roster & Shifts</h2><div class="tablewrap"><table><thead><tr><th>Date</th><th>Staff</th><th>Site</th><th>Start</th><th>End</th><th>Hours</th><th>Shift</th><th>Response</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${fmt(r.shift_date)}</td><td>${r.staff_id?esc(pm[r.staff_id]?.full_name||''):'<b>OPEN</b>'}</td><td>${esc(sm[r.site_id]?.name||'')}</td><td>${formatTime12(r.start_time)}</td><td>${formatTime12(r.end_time)}</td><td>${(shiftMinutes(r.start_time,r.end_time)/60).toFixed(2)}</td><td>${esc(r.shift_type||'')}</td><td>${shiftAssignmentBadge(r)}${r.assignment_status==='Pending'?`<div class="small">${esc(responseTimeLeft(r))}</div>`:''}</td><td>${pill(r.status||'Rostered')}</td><td><div class="row wrap"><button class="btn btn-secondary" onclick="viewRosterShift('${r.id}')">View</button><button class="btn btn-secondary" onclick="editRosterShift('${r.id}')">Edit</button><button class="btn btn-secondary" onclick="duplicateRosterShift('${r.id}')">Duplicate</button><button class="btn btn-danger" onclick="cancelRosterShift('${r.id}')">Cancel</button><button class="btn btn-danger" onclick="deleteRosterShift('${r.id}')">Delete</button></div></td></tr>`).join('')||'<tr><td colspan="10">No shifts.</td></tr>'}</tbody></table></div></div>`;
}
// ===== End Staff Availability + Shift Confirmation + Open Shift Marketplace =====
