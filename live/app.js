let current={type:'FeatureCollection',features:[]};
let routeData={type:'FeatureCollection',features:[]};
let endpointEvidenceData={type:'FeatureCollection',features:[]};
let sourceRouteGeometryData={type:'FeatureCollection',features:[]};
let routeCandidateData={type:'FeatureCollection',features:[]};
let routesVisible=true;
let endpointEvidenceVisible=true;
let sourceRouteGeometryVisible=true;
let routeCandidatesVisible=true;
let satelliteVisible=false;
let rankPopup=null;
let rankFinderMode='visible';

const map=new maplibregl.Map({
  container:'map',
  style:'https://tiles.openfreemap.org/styles/liberty',
  center:[24.4,-29.1],
  zoom:4.35,
  maxBounds:[[14,-36],[35,-20]]
});
map.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');

async function getJson(url){
  const response=await fetch(url,{cache:'no-store'});
  if(!response.ok) throw new Error(String(response.status));
  return response.json();
}
async function loadRankFilters(){
  const province=document.querySelector('#province').value;
  const params=new URLSearchParams();
  if(province) params.set('province',province);

  try{
    const filters=await getJson('/api/v1/rank-filters?' + params.toString());
    const provinceSelect=document.querySelector('#province');
    const citySelect=document.querySelector('#city');

    if(!provinceSelect.dataset.loaded){
      const currentProvince=provinceSelect.value;
      provinceSelect.innerHTML='<option value="">All provinces</option>' +
        filters.provinces.map(value=>'<option>'+esc(value)+'</option>').join('');
      provinceSelect.value=currentProvince;
      provinceSelect.dataset.loaded='true';
    }

    const currentCity=citySelect.value;
    citySelect.innerHTML='<option value="">All cities</option>' +
      filters.cities.map(value=>'<option>'+esc(value)+'</option>').join('');
    citySelect.value=filters.cities.includes(currentCity) ? currentCity : '';
  }catch{
    document.querySelector('#city').innerHTML='<option value="">All cities</option>';
  }
}


function esc(value=''){
  return String(value).replace(/[&<>"']/g,ch=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[ch]);
}
function rankName(p){
  return p.displayName || p.name || p.sourceCode || 'Unnamed rank';
}
function rankSubtitle(p){
  const place=[p.town,p.municipality,p.province].filter(Boolean).join(' • ') || 'Mapped rank';
  return p.sourceCode && p.sourceCode!==rankName(p) ? p.sourceCode+' • '+place : place;
}

function focusRank(feature){
  if(!feature?.geometry?.coordinates) return;
  const coordinates=feature.geometry.coordinates;
  map.easeTo({center:coordinates,zoom:15.8,duration:850});
  detail(feature.properties);

  if(rankPopup) rankPopup.remove();
  rankPopup=new maplibregl.Popup({offset:18,closeButton:true,closeOnClick:false})
    .setLngLat(coordinates)
    .setHTML(
      '<div class="rank-popup"><strong>'+esc(rankName(feature.properties))+'</strong>'+
      (feature.properties.sourceCode && feature.properties.sourceCode!==rankName(feature.properties)
        ? '<code>'+esc(feature.properties.sourceCode)+'</code>' : '')+
      '<span>'+esc(rankSubtitle(feature.properties).replace((feature.properties.sourceCode || '')+' • ',''))+'</span></div>'
    )
    .addTo(map);
}

function visibleRankFeatures(){
  if(!map || !map.getBounds) return current.features || [];
  const bounds=map.getBounds();
  return (current.features || []).filter(feature=>{
    const [lng,lat]=feature.geometry?.coordinates || [];
    return Number.isFinite(lng) && Number.isFinite(lat) && bounds.contains([lng,lat]);
  });
}

function renderRankFinder(){
  const panel=document.querySelector('#rankFinder');
  const list=document.querySelector('#rankFinderList');
  const count=document.querySelector('#rankFinderCount');
  const scope=document.querySelector('#rankFinderScope');
  if(!panel || !list || !count) return;

  const allFeatures=current.features || [];
  const features=rankFinderMode==='visible' ? visibleRankFeatures() : allFeatures;
  count.textContent=String(features.length);
  if(scope) scope.textContent=rankFinderMode==='visible' ? 'visible on map' : 'filtered total';

  if(!features.length){
    list.innerHTML='<div class="rank-finder-empty">No mapped ranks match this search.</div>';
    panel.classList.add('visible');
    return;
  }

  panel.classList.add('visible');

  list.innerHTML=features.map((feature,index)=>
    '<button class="rank-finder-item" data-rank-index="'+index+'">'+
      '<span class="rank-pin-mini">●</span>'+
      '<span><strong>'+esc(rankName(feature.properties))+'</strong><small>'+esc(rankSubtitle(feature.properties))+'</small></span>'+
      '<b>View</b>'+
    '</button>'
  ).join('');

  list.querySelectorAll('[data-rank-index]').forEach(button=>{
    button.addEventListener('click',()=>{
      const feature=features[Number(button.dataset.rankIndex)];
      focusRank(feature);
    });
  });
}

async function loadMeta(){
  try{
    const meta=await getJson('/api/v1/meta');
    document.querySelector('#rankCount').textContent=meta.mapped_ranks ?? meta.ranks;
    document.querySelector('#locationPendingCount').textContent=meta.location_pending_ranks ?? '—';
    document.querySelector('#associationCount').textContent=meta.associations;
    document.querySelector('#routeCount').textContent=meta.routes;
    document.querySelector('#dataState').textContent=meta.mode.toUpperCase();
    document.querySelector('#mode').textContent=meta.mode==='postgis'?'PostGIS live':meta.mode;
  }catch{
    document.querySelector('#rankCount').textContent='0';
    document.querySelector('#locationPendingCount').textContent='0';
    document.querySelector('#associationCount').textContent='0';
    document.querySelector('#routeCount').textContent='0';
    document.querySelector('#dataState').textContent='OFFLINE';
    document.querySelector('#mode').textContent='API unavailable';
  }
}

async function loadRanks(){
  const province=document.querySelector('#province').value;
  const city=document.querySelector('#city').value;
  const q=document.querySelector('#search').value.trim();
  const params=new URLSearchParams();
  if(province) params.set('province',province);
  if(city) params.set('city',city);
  if(q) params.set('q',q);

  try{
    current=await getJson('/api/v1/ranks?' + params.toString());
  }catch{
    current={type:'FeatureCollection',features:[]};
  }

  document.querySelector('#resultStatus').textContent =
    `${current.features.length} mapped rank${current.features.length===1?'':'s'} after filters`;

  const source=map.getSource('ranks');
  if(source) source.setData(current);

  renderRankFinder();

  if(q && current.features.length===1){
    focusRank(current.features[0]);
  }else if(q && current.features.length>1 && current.features.length<=20){
    const bounds=new maplibregl.LngLatBounds();
    current.features.forEach(feature=>bounds.extend(feature.geometry.coordinates));
    if(!bounds.isEmpty()) map.fitBounds(bounds,{padding:90,maxZoom:14,duration:650});
  }
}

async function loadRoutes(){
  const source=map.getSource('routes');
  if(!source) return;

  if(!routesVisible){
    routeData={type:'FeatureCollection',features:[]};
    source.setData(routeData);
    document.querySelector('#routeStatus').textContent='Routes hidden';
    return;
  }

  if(map.getZoom()<7){
    routeData={type:'FeatureCollection',features:[]};
    source.setData(routeData);
    return;
  }

  const b=map.getBounds();
  const params=new URLSearchParams({
    bbox:[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()].join(',')
  });

  try{
    routeData=await getJson('/api/v1/routes?' + params.toString());
  }catch{
    routeData={type:'FeatureCollection',features:[]};
  }

  source.setData(routeData);
  updateRouteStatus();
}

function updateRouteStatus(){
  const routeCount=routesVisible ? routeData.features.length : 0;
  const evidenceCount=endpointEvidenceVisible ? endpointEvidenceData.features.length : 0;
  const sourceGeometryCount=sourceRouteGeometryVisible ? sourceRouteGeometryData.features.length : 0;
  document.querySelector('#routeStatus').textContent =
    routeCount+' canonical geometr'+(routeCount===1?'y':'ies')+' • '+
    sourceGeometryCount+' source geometr'+(sourceGeometryCount===1?'y':'ies')+' • '+
    evidenceCount+' NLTIS endpoint link'+(evidenceCount===1?'':'s');
}

async function loadEndpointEvidence(){
  const source=map.getSource('nltis-endpoint-evidence');
  if(!source) return;

  if(!endpointEvidenceVisible || map.getZoom()<6){
    endpointEvidenceData={type:'FeatureCollection',features:[]};
    source.setData(endpointEvidenceData);
    updateRouteStatus();
    return;
  }

  const b=map.getBounds();
  const params=new URLSearchParams({
    bbox:[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()].join(',')
  });

  try{
    endpointEvidenceData=await getJson('/api/v1/nltis/endpoint-evidence?' + params.toString());
  }catch{
    endpointEvidenceData={type:'FeatureCollection',features:[]};
  }

  source.setData(endpointEvidenceData);
  updateRouteStatus();
}

async function loadSourceRouteGeometries(){
  const source=map.getSource('source-route-geometries');
  if(!source) return;

  if(!sourceRouteGeometryVisible || map.getZoom()<6){
    sourceRouteGeometryData={type:'FeatureCollection',features:[]};
    source.setData(sourceRouteGeometryData);
    updateRouteStatus();
    return;
  }

  const b=map.getBounds();
  const params=new URLSearchParams({
    bbox:[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()].join(',')
  });
  const province=document.querySelector('#province').value;
  if(province) params.set('province',province);

  try{
    sourceRouteGeometryData=await getJson('/api/v1/source-route-geometries?' + params.toString());
  }catch{
    sourceRouteGeometryData={type:'FeatureCollection',features:[]};
  }

  source.setData(sourceRouteGeometryData);
  updateRouteStatus();
}
async function loadRouteCandidates(){
  const source=map.getSource('route-candidates');
  if(!source) return;

  if(!routeCandidatesVisible || map.getZoom()<6){
    routeCandidateData={type:'FeatureCollection',features:[]};
    source.setData(routeCandidateData);
    updateRouteStatus();
    return;
  }

  const b=map.getBounds();
  const params=new URLSearchParams({
    bbox:[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()].join(',')
  });
  const province=document.querySelector('#province').value;
  if(province) params.set('province',province);

  try{
    routeCandidateData=await getJson('/api/v1/route-candidates?' + params.toString());
  }catch{
    routeCandidateData={type:'FeatureCollection',features:[]};
  }

  source.setData(routeCandidateData);
  updateRouteStatus();
}

async function detail(p){
  let full=null;
  try{
    full=await getJson('/api/v1/ranks/' + encodeURIComponent(p.id));
  }catch{
    full=null;
  }

  const status=full?.verificationStatus || p.verificationStatus || 'unverified';
  const associations=full?.associations || [];
  const routes=full?.routes || [];
  const sources=full?.sources || [];
  const candidateCounts=full?.routeCandidateCounts || {total:0,origin:0,destination:0};
  const displayName=full?.displayName || p.displayName || p.name;
  const sourceCode=full?.sourceCode || p.sourceCode || p.name;
  const location=[full?.town || p.town,full?.municipality || p.municipality,full?.province || p.province].filter(Boolean).join(' • ') || 'Location pending';

  const associationHtml=associations.length
    ? associations.map(a=>`
        <div class="route-row">
          <div>
            <strong>${esc(a.name)}</strong>
            <span>${esc(a.registration_number || a.acronym || 'Registration pending')}</span>
          </div>
          <span class="route-type">${esc(a.verificationStatus || 'documented')}</span>
        </div>`).join('')
    : '<div class="journey-result">No association link has been verified for this rank yet.</div>';

  const routeHtml=routes.length
    ? routes.slice(0,20).map(r=>`
        <div class="route-row">
          <div>
            <strong>${esc(r.origin)} → ${esc(r.destination)}</strong>
            <span>${esc(r.association || 'Association pending')} • ${esc(r.boardRouteCode || r.nationalRouteCode || 'Code pending')}</span>
          </div>
          <span class="route-type">${esc(r.verificationStatus)}</span>
        </div>`).join('')
    : '<div class="journey-result">No canonical source-backed route is linked to this rank yet.</div>';

  const sourceHtml=sources.length
    ? sources.map(s=>`<div class="evidence-row"><strong>${esc(s.source_name || s.source_key)}</strong><span>${esc(s.authority || 'Authority pending')}</span></div>`).join('')
    : '<div class="journey-result">No source provenance available.</div>';

  document.querySelector('#detail').innerHTML=`
    <div class="rank">
      <div class="rank-headline">
        <span class="badge ${esc(status)}">${esc(status.replaceAll('_',' '))}</span>
        ${sourceCode && sourceCode!==displayName ? `<span class="rank-code">KZN Rank Code: ${esc(sourceCode)}</span>` : ''}
      </div>
      <h2>${esc(displayName)}</h2>
      <p>${esc(location)}</p>

      <div class="evidence-summary">
        <div><span>Association</span><strong>${esc(associations[0]?.name || 'Pending')}</strong></div>
        <div><span>Candidate routes</span><strong>${Number(candidateCounts.total || 0)}</strong><small>${Number(candidateCounts.origin || 0)} origin • ${Number(candidateCounts.destination || 0)} destination</small></div>
        <div><span>Canonical routes</span><strong>${routes.length}</strong><small>linked to this rank</small></div>
      </div>

      <div class="source">
        <b>${esc(sources[0]?.source_name || p.source || 'Tenderize source registry')}</b>
        <span>${esc(sources[0]?.authority || 'Evidence provenance retained')}</span>
        <span>Candidate routes remain explicitly separate from canonical routes.</span>
      </div>

      <div class="section-block">
        <div class="section-title">Associations</div>
        <div class="route-list">${associationHtml}</div>
      </div>
      <div class="section-block">
        <div class="section-title">Source provenance</div>
        <div class="route-list">${sourceHtml}</div>
      </div>
      <div class="section-block">
        <div class="section-title">Canonical linked routes</div>
        <div class="route-list">${routeHtml}</div>
      </div>
    </div>`;
}
function routeDetail(p){
  const status=p.verificationStatus || 'unverified';
  const associationEvidence=p.associationEvidence || null;
  const originAssoc=associationEvidence?.originAssociations || [];
  const destinationAssoc=associationEvidence?.destinationAssociations || [];
  const evidenceHtml=associationEvidence
    ? `<div class="source association-evidence">
         <b>Endpoint association evidence</b>
         <span>Origin: ${originAssoc.length ? originAssoc.map(esc).join(', ') : 'none'}</span>
         <span>Destination: ${destinationAssoc.length ? destinationAssoc.map(esc).join(', ') : 'none'}</span>
         <span><strong>Evidence only — not route ownership.</strong></span>
       </div>`
    : '';

  document.querySelector('#detail').innerHTML=`
    <div class="rank">
      <span class="badge ${status}">${status.replaceAll('_',' ')}</span>
      <h2>${esc(p.origin || 'Origin pending')} → ${esc(p.destination || 'Destination pending')}</h2>
      <p>${esc(p.routeType || 'Taxi route')} • ${esc(p.geometryStatus || 'Geometry pending')}</p>
      ${p.association ? `<div class="source"><b>${esc(p.association)}</b><span>${esc(p.associationRegistration || 'Association registration pending')}</span></div>` : ''}
      ${evidenceHtml}
      <div class="source">
        <b>${esc(p.source || 'Tenderize source registry')}</b>
        <span>${p.candidateRoute
          ? (associationEvidence
              ? 'This is a TN6-J exact-endpoint route candidate using official source geometry. TN6-L has endpoint association evidence, but no route association has been assigned.'
              : 'This is a TN6-J exact-endpoint route candidate using official source geometry. It is not yet a canonical taxi route and association evidence is still pending.')
          : p.notRoutePath
            ? 'This connector only joins two exactly reconciled NLTIS rank endpoints. It is evidence of the documented origin/destination pair, not the travelled road path.'
            : 'This line is rendered from source-backed route geometry. It is not inferred from road routing.'}</span>
      </div>
    </div>`;
}

map.on('load',async()=>{
  await loadMeta();
  await loadRankFilters();
  await loadRanks();

  map.addSource('satellite-imagery',{
    type:'raster',
    tiles:[
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
    ],
    tileSize:256,
    attribution:'Esri, Maxar, Earthstar Geographics, and the GIS User Community'
  });

  map.addLayer({
    id:'satellite-imagery',
    type:'raster',
    source:'satellite-imagery',
    layout:{visibility:'none'},
    paint:{'raster-opacity':1}
  });

  map.addSource('routes',{
    type:'geojson',
    data:routeData
  });

  map.addLayer({
    id:'official-routes',
    type:'line',
    source:'routes',
    filter:['==',['get','verificationStatus'],'official'],
    paint:{
      'line-width':['interpolate',['linear'],['zoom'],7,1.6,12,4],
      'line-color':'#193b70',
      'line-opacity':0.78
    }
  });

  map.addLayer({
    id:'documented-routes',
    type:'line',
    source:'routes',
    filter:['==',['get','verificationStatus'],'documented'],
    paint:{
      'line-width':['interpolate',['linear'],['zoom'],7,1.4,12,3.4],
      'line-color':'#7356b8',
      'line-opacity':0.72,
      'line-dasharray':[2,2]
    }
  });

  map.addLayer({
    id:'inferred-routes',
    type:'line',
    source:'routes',
    filter:['==',['get','verificationStatus'],'inferred'],
    paint:{
      'line-width':['interpolate',['linear'],['zoom'],7,1.2,12,3],
      'line-color':'#b77a20',
      'line-opacity':0.68,
      'line-dasharray':[1,2]
    }
  });

  map.addSource('source-route-geometries',{
    type:'geojson',
    data:sourceRouteGeometryData
  });

  map.addLayer({
    id:'source-route-geometries',
    type:'line',
    source:'source-route-geometries',
    paint:{
      'line-width':['interpolate',['linear'],['zoom'],6,1.2,12,3.2],
      'line-color':'#0d8ca3',
      'line-opacity':0.72,
      'line-dasharray':[3,2]
    }
  });

  map.addSource('route-candidates',{
    type:'geojson',
    data:routeCandidateData
  });

  map.addLayer({
    id:'route-candidates',
    type:'line',
    source:'route-candidates',
    paint:{
      'line-width':['interpolate',['linear'],['zoom'],6,1.6,12,4],
      'line-color':'#d97706',
      'line-opacity':0.82,
      'line-dasharray':[2,1]
    }
  });

  map.addSource('nltis-endpoint-evidence',{
    type:'geojson',
    data:endpointEvidenceData
  });

  map.addLayer({
    id:'nltis-endpoint-connectors',
    type:'line',
    source:'nltis-endpoint-evidence',
    paint:{
      'line-width':['interpolate',['linear'],['zoom'],6,1.2,12,3.2],
      'line-color':'#c13c66',
      'line-opacity':0.72,
      'line-dasharray':[1,3]
    }
  });

  map.addSource('ranks',{
    type:'geojson',
    data:current,
    cluster:true,
    clusterMaxZoom:12,
    clusterRadius:42
  });

  map.addLayer({
    id:'clusters',
    type:'circle',
    source:'ranks',
    filter:['has','point_count'],
    paint:{
      'circle-color':'#0d5fd7',
      'circle-radius':['step',['get','point_count'],21,25,27,100,35],
      'circle-stroke-width':4,
      'circle-stroke-color':'#fff'
    }
  });

  map.addLayer({
    id:'cluster-count',
    type:'symbol',
    source:'ranks',
    filter:['has','point_count'],
    layout:{'text-field':['get','point_count_abbreviated'],'text-size':12},
    paint:{'text-color':'#fff'}
  });

  map.addLayer({
    id:'rank-points',
    type:'circle',
    source:'ranks',
    filter:['!',['has','point_count']],
    paint:{
      'circle-radius':['interpolate',['linear'],['zoom'],5,8,10,10,14,13,17,15],
      'circle-color':['match',['get','verificationStatus'],
        'official','#16865b','verified','#16865b','documented','#7356b8','#0d5fd7'],
      'circle-stroke-width':['interpolate',['linear'],['zoom'],5,3,14,5],
      'circle-stroke-color':'#fff'
    }
  });

  map.addLayer({
    id:'rank-halo',
    type:'circle',
    source:'ranks',
    filter:['!',['has','point_count']],
    paint:{
      'circle-radius':['interpolate',['linear'],['zoom'],5,13,10,16,14,20,17,23],
      'circle-color':'rgba(13,95,215,0.10)',
      'circle-stroke-width':2,
      'circle-stroke-color':'rgba(13,95,215,0.38)'
    }
  },'rank-points');

  map.addLayer({
    id:'rank-labels',
    type:'symbol',
    source:'ranks',
    minzoom:9.5,
    filter:['!',['has','point_count']],
    layout:{
      'text-field':['get','name'],
      'text-size':['interpolate',['linear'],['zoom'],9.5,11,15,14],
      'text-offset':[0,1.65],
      'text-anchor':'top',
      'text-max-width':16,
      'text-allow-overlap':false,
      'text-padding':4
    },
    paint:{
      'text-color':'#102a3d',
      'text-halo-color':'rgba(255,255,255,0.96)',
      'text-halo-width':2,
      'text-halo-blur':0.5
    }
  });

  await Promise.all([loadRoutes(),loadEndpointEvidence(),loadSourceRouteGeometries(),loadRouteCandidates()]);

  map.on('click','clusters',async event=>{
    const feature=map.queryRenderedFeatures(event.point,{layers:['clusters']})[0];
    if(!feature) return;
    const zoom=await map.getSource('ranks').getClusterExpansionZoom(feature.properties.cluster_id);
    map.easeTo({center:feature.geometry.coordinates,zoom});
  });

  ['rank-points','rank-labels'].forEach(rankLayer=>{
    map.on('click',rankLayer,event=>{
      const feature=event.features && event.features[0];
      if(!feature) return;
      focusRank(feature);
    });
  });

  ['official-routes','documented-routes','inferred-routes','source-route-geometries','route-candidates','nltis-endpoint-connectors'].forEach(routeLayer=>{
    map.on('click',routeLayer,event=>{
      const feature=event.features && event.features[0];
      if(!feature) return;
      routeDetail(feature.properties);
    });
  });

  ['clusters','rank-points','rank-labels','official-routes','documented-routes','inferred-routes','source-route-geometries','route-candidates','nltis-endpoint-connectors'].forEach(layer=>{
    map.on('mouseenter',layer,()=>map.getCanvas().style.cursor='pointer');
    map.on('mouseleave',layer,()=>map.getCanvas().style.cursor='');
  });

  map.on('moveend',()=>{
    renderRankFinder();
    return Promise.all([loadRoutes(),loadEndpointEvidence(),loadSourceRouteGeometries(),loadRouteCandidates()]);
  });
});

document.querySelector('#showVisibleRanks').addEventListener('click',()=>{
  rankFinderMode='visible';
  document.querySelector('#showVisibleRanks').classList.add('active-toggle');
  document.querySelector('#showAllFilteredRanks').classList.remove('active-toggle');
  renderRankFinder();
});
document.querySelector('#showAllFilteredRanks').addEventListener('click',()=>{
  rankFinderMode='all';
  document.querySelector('#showAllFilteredRanks').classList.add('active-toggle');
  document.querySelector('#showVisibleRanks').classList.remove('active-toggle');
  renderRankFinder();
});

document.querySelector('#province').addEventListener('change',async()=>{
  document.querySelector('#city').value='';
  await loadRankFilters();
  await loadRanks();
});
document.querySelector('#city').addEventListener('change',loadRanks);
let timer;
document.querySelector('#search').addEventListener('input',()=>{
  clearTimeout(timer);
  timer=setTimeout(loadRanks,180);
});
document.querySelector('#fit').addEventListener('click',()=>{
  document.querySelector('#province').value='';
  document.querySelector('#city').value='';
  document.querySelector('#search').value='';
  map.easeTo({center:[24.4,-29.1],zoom:4.35});
  loadRanks();
});


document.querySelector('#satelliteToggle').addEventListener('click',()=>{
  satelliteVisible=!satelliteVisible;
  const button=document.querySelector('#satelliteToggle');
  button.textContent=satelliteVisible?'Satellite':'Street';
  button.classList.toggle('active-toggle',satelliteVisible);
  button.setAttribute('aria-pressed',String(satelliteVisible));
  if(map.getLayer('satellite-imagery')){
    map.setLayoutProperty('satellite-imagery','visibility',satelliteVisible?'visible':'none');
  }
  document.querySelector('#basemapStatus').textContent=satelliteVisible
    ? 'Satellite imagery — verify rank marker against visible facility'
    : 'Street basemap';
});

document.querySelector('#routeToggle').addEventListener('click',()=>{
  routesVisible=!routesVisible;
  const button=document.querySelector('#routeToggle');
  button.textContent=routesVisible?'Routes on':'Routes off';
  button.classList.toggle('active-toggle',routesVisible);
  button.setAttribute('aria-pressed',String(routesVisible));
  loadRoutes();
});

document.querySelector('#routeCandidateToggle').addEventListener('click',()=>{
  routeCandidatesVisible=!routeCandidatesVisible;
  const button=document.querySelector('#routeCandidateToggle');
  button.textContent=routeCandidatesVisible?'Candidate routes on':'Candidate routes off';
  button.classList.toggle('active-toggle',routeCandidatesVisible);
  button.setAttribute('aria-pressed',String(routeCandidatesVisible));
  loadRouteCandidates();
});

document.querySelector('#sourceGeometryToggle').addEventListener('click',()=>{
  sourceRouteGeometryVisible=!sourceRouteGeometryVisible;
  const button=document.querySelector('#sourceGeometryToggle');
  button.textContent=sourceRouteGeometryVisible?'Source geometry on':'Source geometry off';
  button.classList.toggle('active-toggle',sourceRouteGeometryVisible);
  button.setAttribute('aria-pressed',String(sourceRouteGeometryVisible));
  loadSourceRouteGeometries();
});
document.querySelector('#nltisEvidenceToggle').addEventListener('click',()=>{
  endpointEvidenceVisible=!endpointEvidenceVisible;
  const button=document.querySelector('#nltisEvidenceToggle');
  button.textContent=endpointEvidenceVisible?'NLTIS evidence on':'NLTIS evidence off';
  button.classList.toggle('active-toggle',endpointEvidenceVisible);
  button.setAttribute('aria-pressed',String(endpointEvidenceVisible));
  loadEndpointEvidence();
});

document.querySelector('#capeTownRoutes').addEventListener('click',()=>{
  document.querySelector('#province').value='Western Cape';
  map.fitBounds([[18.28,-34.18],[18.98,-33.72]],{padding:40,duration:800});
  loadRanks();
  setTimeout(()=>Promise.all([loadRoutes(),loadEndpointEvidence(),loadSourceRouteGeometries(),loadRouteCandidates()]),850);
});
