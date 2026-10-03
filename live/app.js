let current={type:'FeatureCollection',features:[]};
let routeData={type:'FeatureCollection',features:[]};
let routesVisible=true;

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

function esc(value=''){
  return String(value).replace(/[&<>"']/g,ch=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[ch]);
}

async function loadMeta(){
  try{
    const meta=await getJson('/api/v1/meta');
    document.querySelector('#rankCount').textContent=meta.ranks;
    document.querySelector('#associationCount').textContent=meta.associations;
    document.querySelector('#routeCount').textContent=meta.routes;
    document.querySelector('#dataState').textContent=meta.mode.toUpperCase();
    document.querySelector('#mode').textContent=meta.mode==='postgis'?'PostGIS live':meta.mode;
  }catch{
    document.querySelector('#rankCount').textContent='0';
    document.querySelector('#associationCount').textContent='0';
    document.querySelector('#routeCount').textContent='0';
    document.querySelector('#dataState').textContent='OFFLINE';
    document.querySelector('#mode').textContent='API unavailable';
  }
}

async function loadRanks(){
  const province=document.querySelector('#province').value;
  const q=document.querySelector('#search').value.trim();
  const params=new URLSearchParams();
  if(province) params.set('province',province);
  if(q) params.set('q',q);

  try{
    current=await getJson('/api/v1/ranks?' + params.toString());
  }catch{
    current={type:'FeatureCollection',features:[]};
  }

  document.querySelector('#resultStatus').textContent =
    `${current.features.length} mapped rank${current.features.length===1?'':'s'} in current view`;

  const source=map.getSource('ranks');
  if(source) source.setData(current);
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
  document.querySelector('#routeStatus').textContent=`${routeData.features.length} route${routeData.features.length===1?'':'s'} in viewport`;
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
    : '<div class="journey-result">No source-backed route is linked to this rank yet.</div>';

  document.querySelector('#detail').innerHTML=`
    <div class="rank">
      <span class="badge ${esc(status)}">${esc(status.replaceAll('_',' '))}</span>
      <h2>${esc(full?.name || p.name)}</h2>
      <p>${esc(full?.town || p.town || full?.municipality || p.municipality || 'Location pending')} • ${esc(full?.province || p.province || 'Province pending')}</p>
      <div class="source">
        <b>${esc(p.source || 'Tenderize source registry')}</b>
        <span>Evidence classification is retained. Candidate and inferred data are never represented as official.</span>
      </div>
      <div class="section-block">
        <div class="section-title">Associations</div>
        <div class="route-list">${associationHtml}</div>
      </div>
      <div class="section-block">
        <div class="section-title">Linked routes</div>
        <div class="route-list">${routeHtml}</div>
      </div>
    </div>`;
}
function routeDetail(p){
  const status=p.verificationStatus || 'unverified';
  document.querySelector('#detail').innerHTML=`
    <div class="rank">
      <span class="badge ${status}">${status.replaceAll('_',' ')}</span>
      <h2>${esc(p.origin || 'Origin pending')} → ${esc(p.destination || 'Destination pending')}</h2>
      <p>${esc(p.routeType || 'Taxi route')} • ${esc(p.geometryStatus || 'Geometry pending')}</p>
      ${p.association ? `<div class="source"><b>${esc(p.association)}</b><span>${esc(p.associationRegistration || 'Association registration pending')}</span></div>` : ''}
      <div class="source">
        <b>${esc(p.source || 'Tenderize source registry')}</b>
        <span>This line is rendered from source-backed route geometry. It is not inferred from road routing.</span>
      </div>
    </div>`;
}

map.on('load',async()=>{
  await loadMeta();
  await loadRanks();

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
      'circle-radius':['step',['get','point_count'],18,25,24,100,31],
      'circle-stroke-width':3,
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
      'circle-radius':7,
      'circle-color':['match',['get','verificationStatus'],
        'official','#16865b','verified','#16865b','documented','#7356b8','#0d5fd7'],
      'circle-stroke-width':2,
      'circle-stroke-color':'#fff'
    }
  });

  await loadRoutes();

  map.on('click','clusters',async event=>{
    const feature=map.queryRenderedFeatures(event.point,{layers:['clusters']})[0];
    if(!feature) return;
    const zoom=await map.getSource('ranks').getClusterExpansionZoom(feature.properties.cluster_id);
    map.easeTo({center:feature.geometry.coordinates,zoom});
  });

  map.on('click','rank-points',async event=>{
    const feature=event.features && event.features[0];
    if(!feature) return;
    await detail(feature.properties);
    map.easeTo({center:feature.geometry.coordinates,zoom:Math.max(map.getZoom(),11.5),duration:650});
  });

  ['official-routes','documented-routes','inferred-routes'].forEach(routeLayer=>{
    map.on('click',routeLayer,event=>{
      const feature=event.features && event.features[0];
      if(!feature) return;
      routeDetail(feature.properties);
    });
  });

  ['clusters','rank-points','official-routes','documented-routes','inferred-routes'].forEach(layer=>{
    map.on('mouseenter',layer,()=>map.getCanvas().style.cursor='pointer');
    map.on('mouseleave',layer,()=>map.getCanvas().style.cursor='');
  });

  map.on('moveend',loadRoutes);
});

document.querySelector('#province').addEventListener('change',loadRanks);
let timer;
document.querySelector('#search').addEventListener('input',()=>{
  clearTimeout(timer);
  timer=setTimeout(loadRanks,180);
});
document.querySelector('#fit').addEventListener('click',()=>{
  document.querySelector('#province').value='';
  document.querySelector('#search').value='';
  map.easeTo({center:[24.4,-29.1],zoom:4.35});
  loadRanks();
});


document.querySelector('#routeToggle').addEventListener('click',()=>{
  routesVisible=!routesVisible;
  const button=document.querySelector('#routeToggle');
  button.textContent=routesVisible?'Routes on':'Routes off';
  button.classList.toggle('active-toggle',routesVisible);
  button.setAttribute('aria-pressed',String(routesVisible));
  loadRoutes();
});

document.querySelector('#capeTownRoutes').addEventListener('click',()=>{
  document.querySelector('#province').value='Western Cape';
  map.fitBounds([[18.28,-34.18],[18.98,-33.72]],{padding:40,duration:800});
  loadRanks();
  setTimeout(loadRoutes,850);
});
