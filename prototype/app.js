const data = window.__SEED_DATA || await fetch('./data/seed-network.json').then(r => r.json());

const state = {
  selectedRankId: null,
  province: 'all',
  query: '',
  layers: { routes: true, candidates: true }
};

const bounds = { minLng: 16, maxLng: 33.5, minLat: -35.2, maxLat: -22.0 };
const plot = { x: 115, y: 96, width: 790, height: 530 };
const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];

function coordToPoint(lng, lat) {
  return {
    x: plot.x + ((lng - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * plot.width,
    y: plot.y + ((bounds.maxLat - lat) / (bounds.maxLat - bounds.minLat)) * plot.height
  };
}

function esc(v='') { return String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
function sourceStatusClass(status) { return status === 'official_legacy' ? 'legacy' : ''; }
function statusLabel(status) { return status.replaceAll('_',' ').toUpperCase(); }

function fillKpis() {
  $('#rankCount').textContent = data.ranks.length;
  $('#associationCount').textContent = data.associations.length;
  $('#routeCount').textContent = data.routes.length;
  $('#sourceCount').textContent = data.sources.filter(s => s.status.startsWith('official')).length;
}

function fillProvinceFilter() {
  const provinces = [...new Set(data.ranks.map(r => r.province))].sort();
  for (const p of provinces) {
    const o = document.createElement('option'); o.value = p; o.textContent = p; $('#provinceFilter').append(o);
  }
}

function currentRanks() {
  const q = state.query.trim().toLowerCase();
  return data.ranks.filter(r => (state.province === 'all' || r.province === state.province) &&
    (!q || [r.name,r.town,r.province].some(v => (v||'').toLowerCase().includes(q))));
}

function renderMap() {
  const markerLayer = $('#markerLayer');
  const routeLayer = $('#routeLayer');
  markerLayer.innerHTML = '';
  routeLayer.innerHTML = '';
  const visibleIds = new Set(currentRanks().map(r => r.id));

  if (state.layers.routes) {
    for (const route of data.routes.filter(r => r.originRankId && r.destinationRankId)) {
      if (!visibleIds.has(route.originRankId) || !visibleIds.has(route.destinationRankId)) continue;
      const a = data.ranks.find(r => r.id === route.originRankId);
      const b = data.ranks.find(r => r.id === route.destinationRankId);
      if (!a || !b) continue;
      const p1 = coordToPoint(a.lng,a.lat), p2 = coordToPoint(b.lng,b.lat);
      const path = document.createElementNS('http://www.w3.org/2000/svg','path');
      const mx=(p1.x+p2.x)/2, my=Math.min(p1.y,p2.y)-34;
      path.setAttribute('d',`M${p1.x},${p1.y} Q${mx},${my} ${p2.x},${p2.y}`);
      path.setAttribute('class','route-line');
      routeLayer.append(path);
    }
  }

  for (const rank of currentRanks()) {
    if (!state.layers.candidates && rank.status === 'candidate') continue;
    const p = coordToPoint(rank.lng,rank.lat);
    const g = document.createElementNS('http://www.w3.org/2000/svg','g');
    g.setAttribute('class', `rank-marker ${rank.status} ${state.selectedRankId===rank.id?'selected':''}`);
    g.setAttribute('transform',`translate(${p.x} ${p.y})`);
    g.dataset.id = rank.id;
    g.innerHTML = `<circle class="outer" r="11"></circle><circle class="inner" r="5.5"></circle><text x="15" y="4">${esc(rank.name.replace(' Taxi Rank','').replace(' New Taxi Rank',''))}</text>`;
    g.addEventListener('click',()=>selectRank(rank.id));
    markerLayer.append(g);
  }
}

function selectRank(id) {
  const rank = data.ranks.find(r => r.id===id); if(!rank) return;
  state.selectedRankId=id;
  $('#detailEmpty').classList.add('hidden'); $('#detailContent').classList.remove('hidden');
  $('#detailStatus').textContent=statusLabel(rank.status);
  $('#detailName').textContent=rank.name;
  $('#detailTown').textContent=`${rank.town} • ${rank.province}`;
  $('#detailProvince').textContent=rank.province;
  $('#detailCoords').textContent=`${rank.lat.toFixed(5)}, ${rank.lng.toFixed(5)}`;
  $('#detailAssoc').textContent=rank.associations.length || 'Not linked';
  $('#detailDest').textContent=rank.destinations.length || 'Pending';
  $('#detailSource').textContent=rank.source;
  $('#detailSourceNote').textContent=rank.status==='candidate'?'Candidate — verification required':'Source-backed record';
  const routeRows = data.routes.filter(r=>r.originRankId===id||r.destinationRankId===id);
  $('#detailRoutes').innerHTML = routeRows.length ? routeRows.map(r=>`<div class="route-row"><div><strong>${esc(r.origin)} → ${esc(r.destination)}</strong><span>${esc(r.source)}</span></div><span class="route-type">${esc(r.status)}</span></div>`).join('') : `<div class="journey-result">No route edges are attached to this seed record yet.</div>`;
  renderMap();
}

function closeDetail(){ state.selectedRankId=null; $('#detailEmpty').classList.remove('hidden'); $('#detailContent').classList.add('hidden'); renderMap(); }

function fillRouteSelectors(){
  const opts = data.ranks.map(r=>`<option value="${r.id}">${esc(r.name)} — ${esc(r.province)}</option>`).join('');
  $('#fromRank').innerHTML = opts; $('#toRank').innerHTML = opts;
  if(data.ranks[1]) $('#toRank').value=data.ranks[1].id;
}

function findConnection(){
  const fromId=$('#fromRank').value, toId=$('#toRank').value;
  const a=data.ranks.find(r=>r.id===fromId), b=data.ranks.find(r=>r.id===toId);
  if(!a||!b||fromId===toId){ $('#journeyResult').textContent='Choose two different taxi ranks.'; return; }
  const direct=data.routes.find(r=>(r.originRankId===fromId&&r.destinationRankId===toId)||(r.originRankId===toId&&r.destinationRankId===fromId));
  const classification=direct?.status || 'inferred';
  const note=direct ? 'Prototype edge exists in the seed graph.' : 'No registered route relationship is loaded between these seed ranks. A road/path engine may calculate a possible connection, but it must remain inferred until source evidence is attached.';
  $('#journeyResult').innerHTML=`<div class="journey-path"><span class="node">${esc(a.name)}</span><span class="edge">${classification.toUpperCase()} →</span><span class="node">${esc(b.name)}</span></div><div style="margin-top:7px">${esc(note)}</div>`;
  state.selectedRankId=fromId; renderMap();
}

function renderSources(){
  $('#sourceList').innerHTML=data.sources.map(s=>`<div class="source-row"><div class="icon">GIS</div><div><strong>${esc(s.name)}</strong><span>${esc(s.coverage)} • ${esc(s.type)}</span></div><span class="status-chip ${sourceStatusClass(s.status)}">${esc(s.status.replace('_',' '))}</span></div>`).join('');
}

function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove('show'),1800)}

$('#provinceFilter').addEventListener('change',e=>{state.province=e.target.value;closeDetail();});
$('#globalSearch').addEventListener('input',e=>{state.query=e.target.value;renderMap();});
$('#globalSearch').addEventListener('keydown',e=>{if(e.key==='Enter'){const first=currentRanks()[0]; if(first) selectRank(first.id)}});
$('#closeDetail').addEventListener('click',closeDetail);
$('#findRoute').addEventListener('click',findConnection);
$('#openNetwork').addEventListener('click',()=>{document.querySelector('.route-explorer').scrollIntoView({behavior:'smooth'});toast('Network Explorer ready')});
$('#sourceBtn').addEventListener('click',()=>document.querySelector('.source-panel').scrollIntoView({behavior:'smooth'}));
$('#refreshSources').addEventListener('click',()=>toast('Live source refresh is handled by the ArcGIS ingestion worker'));
$('#fitBtn').addEventListener('click',()=>{state.province='all';$('#provinceFilter').value='all';state.query='';$('#globalSearch').value='';renderMap();toast('National view restored')});
$('#layersBtn').addEventListener('click',()=>{state.layers.routes=!state.layers.routes;renderMap();toast(`Route layer ${state.layers.routes?'enabled':'hidden'}`)});
$$('[data-mapmode]').forEach(btn=>btn.addEventListener('click',()=>{ $$('[data-mapmode]').forEach(b=>b.classList.remove('active'));btn.classList.add('active');toast(btn.dataset.mapmode==='network'?'Network graph mode is the TN7 build gate':'Map mode') }));
$$('.nav-icon[data-view]').forEach(btn=>btn.addEventListener('click',()=>{ $$('.nav-icon[data-view]').forEach(b=>b.classList.remove('active'));btn.classList.add('active');toast(`${btn.title} selected`) }));

document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('#globalSearch').focus()}});

fillKpis(); fillProvinceFilter(); fillRouteSelectors(); renderSources(); renderMap();
