const state={token:sessionStorage.getItem('tn.operator.token')||'',data:null,proposal:null};

const q=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function api(path,{method='GET',body=null,key=null}={}){
  const headers={};
  if(state.token) headers.authorization='Bearer '+state.token;
  if(key) headers['idempotency-key']=key;
  if(body!==null) headers['content-type']='application/json';
  const r=await fetch('/operator-api'+path,{method,headers,body:body===null?undefined:JSON.stringify(body),cache:'no-store'});
  const t=await r.text();let payload;try{payload=t?JSON.parse(t):null}catch{payload=t}
  if(!r.ok) throw Object.assign(new Error(payload?.error||('HTTP '+r.status)),{status:r.status,payload});
  return payload;
}
function key(prefix){return prefix+'-'+Date.now()+'-'+Math.random().toString(36).slice(2,8)}
function showView(id){
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===id));
  document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===id));
}
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.view)));

function setConnected(ok,message){
  q('.statusbar').classList.toggle('connected',ok);
  q('#connectionState').textContent=message;
}
function pill(value){return '<span class="pill '+esc(value)+'">'+esc(value)+'</span>'}
function empty(text){return '<div class="empty">'+esc(text)+'</div>'}

function render(){
  const d=state.data;if(!d) return;
  q('#actorName').textContent=d.actor?.displayName||d.actor?.subject||'Operator';
  q('#actorRoles').textContent=(d.actor?.roles||[]).join(', ');
  q('#mutationState').textContent=d.mutationEnabled?'Controlled mutations enabled in this environment':'Read-only / mutation switches disabled';
  q('#activeIssues').textContent=d.summary?.active??0;
  q('#highSeverity').textContent=d.summary?.high_severity??0;
  q('#pendingCount').textContent=d.summary?.pendingProposals??0;
  q('#auditCount').textContent=d.summary?.recentAuditEvents??0;

  const pending=d.proposals?.pending||[];
  q('#overviewProposals').innerHTML=pending.length?pending.slice(0,6).map(proposalRow).join(''):empty('No pending proposals.');
  q('#proposalList').innerHTML=pending.length?pending.map(proposalRow).join(''):empty('No proposals awaiting a decision.');

  const issues=d.queues?.dataIssues||[];
  const filter=q('#issueFilter').value;
  const filtered=filter?issues.filter(i=>i.status===filter):issues;
  q('#issueList').innerHTML=filtered.length?filtered.map(i=>`
    <div class="row">
      <div><strong>${esc(i.summary)}</strong><div class="meta">${esc(i.entity_type)} • ${esc(i.issue_type)} • ${esc(i.entity_id||'unscoped')}</div></div>
      ${pill(i.status)}
      <p>${esc(i.severity)} severity • created ${new Date(i.created_at).toLocaleString()}</p>
    </div>`).join(''):empty('No issues match this filter.');

  const audit=d.audit?.recent||[];
  q('#auditList').innerHTML=audit.length?audit.map(a=>`
    <div class="row">
      <div class="meta">#${esc(a.eventSequence)}</div>
      <div><strong>${esc(a.action)}</strong><div class="meta">${esc(a.entityType)} • ${esc(a.entityId||'—')} • ${esc(a.actor?.subject)}</div></div>
      <div class="meta">${new Date(a.occurredAt).toLocaleString()}</div>
      <p>${esc(a.rationale||'No rationale supplied')}</p>
    </div>`).join(''):empty('No audit events loaded.');

  const caps=d.capabilities||{};
  const entries=[
    ['Dual control',caps.dualControlEnabled],
    ['Defer',caps.deferIssueEnabled],
    ['Reject',caps.rejectIssueEnabled],
    ['Reopen',caps.reopenIssueEnabled],
    ['Alias promotion',caps.aliasPromotionEnabled],
    ['Association assignment',caps.associationAssignmentEnabled],
    ['Route promotion',caps.routePromotionEnabled],
    ['Rank merge',caps.rankMergeEnabled],
    ['Association merge',caps.associationMergeEnabled]
  ];
  q('#capabilityGrid').innerHTML=entries.map(([name,on])=>'<div class="cap"><span>'+esc(name)+'</span><b class="'+(on?'':'off')+'">'+(on?'ENABLED':'OFF')+'</b></div>').join('');

  q('#actionGrid').innerHTML=(d.actionCatalog||[]).map(a=>`
    <div class="action-card">
      <span>${esc(a.gate)}</span><strong>${esc(a.label)}</strong>
      <small>${esc(a.action)} • ${a.dualControl?'two-person':'direct controlled'} • ${a.enabled?'enabled':'disabled'}</small>
    </div>`).join('');
}
function proposalRow(p){
  return `<div class="row">
    <div><strong>${esc(p.action)}</strong><div class="meta">${esc(p.targetEntityType)} • ${esc(p.targetEntityId)}</div></div>
    ${pill(p.status)}
    <p>${esc(p.rationale)} • proposed by ${esc(p.proposer?.displayName||p.proposer?.subject)}</p>
    <div class="row-actions"><button data-proposal="${esc(p.id)}">Review decision</button></div>
  </div>`;
}
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-proposal]');
  if(!b||!state.data) return;
  state.proposal=state.data.proposals.pending.find(p=>p.id===b.dataset.proposal);
  if(!state.proposal) return;
  q('#modalTitle').textContent=state.proposal.action;
  q('#modalMeta').textContent=state.proposal.targetEntityType+' • '+state.proposal.targetEntityId+' • proposed by '+(state.proposal.proposer?.displayName||state.proposal.proposer?.subject);
  q('#decisionRationale').value='';
  q('#decisionEvidence').value='';
  q('#decisionResult').textContent='';
  q('#decisionModal').classList.remove('hidden');
});
q('#closeModal').onclick=()=>q('#decisionModal').classList.add('hidden');

async function decide(action){
  if(!state.proposal) return;
  const rationale=q('#decisionRationale').value.trim();
  if(rationale.length<10){q('#decisionResult').textContent='Rationale must be at least 10 characters.';return}
  const note=q('#decisionEvidence').value.trim();
  q('#decisionResult').textContent='Submitting…';
  try{
    const out=await api('/api/v1/operator/proposals/'+state.proposal.id+'/'+action,{
      method:'POST',
      key:key('workbench-'+action),
      body:{rationale,evidence:note?{operatorNote:note}:{workbench:true}}
    });
    q('#decisionResult').textContent=(out.replay?'Replay accepted':'Decision recorded')+'.';
    await load();
    setTimeout(()=>q('#decisionModal').classList.add('hidden'),500);
  }catch(e){q('#decisionResult').textContent=e.payload?.error||e.message}
}
q('#approveProposal').onclick=()=>decide('approve');
q('#rejectProposal').onclick=()=>decide('reject');
q('#withdrawProposal').onclick=()=>decide('withdraw');

async function load(){
  if(!state.token){setConnected(false,'Disconnected');return}
  setConnected(false,'Connecting…');
  try{
    const d=await api('/api/v1/operator/workbench?limit=120');
    state.data=d;render();setConnected(true,'Connected');
  }catch(e){
    state.data=null;setConnected(false,e.payload?.error||'Connection failed');
  }
}
q('#connect').onclick=()=>{
  state.token=q('#token').value.trim();
  if(state.token){sessionStorage.setItem('tn.operator.token',state.token)}
  load();
};
q('#disconnect').onclick=()=>{
  state.token='';state.data=null;sessionStorage.removeItem('tn.operator.token');q('#token').value='';setConnected(false,'Disconnected');
};
q('#refresh').onclick=load;
q('#issueFilter').onchange=render;
q('#token').value=state.token;
if(state.token) load();
