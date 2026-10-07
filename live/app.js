let current={type:'FeatureCollection',features:[]};
let routeData={type:'FeatureCollection',features:[]};
let endpointEvidenceData={type:'FeatureCollection',features:[]};
let sourceRouteGeometryData={type:'FeatureCollection',features:[]};
let routeCandidateData={type:'FeatureCollection',features:[]};
let associationData={type:'FeatureCollection',features:[]};
let associationHighlightRanks={type:'FeatureCollection',features:[]};
let associationHighlightRoutes={type:'FeatureCollection',features:[]};
let routesVisible=true;
let associationsVisible=true;
let endpointEvidenceVisible=true;
let sourceRouteGeometryVisible=true;
let routeCandidatesVisible=true;
let satelliteVisible=false;
let rankPopup=null;
let rankFinderMode='visible';
let explorerMode='ranks';
let selectedCoverageArea='';
let selectedAssociationId=null;
let selectedRouteGeometry=null;

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

function googleMapsUrl(lat,lng){
  return 'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(lat+','+lng);
}

function streetViewUrl(lat,lng){
  return 'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint='+encodeURIComponent(lat+','+lng);
}

function routeEndpointCoordinates(geometry){
  if(!geometry) return {start:null,end:null};
  if(geometry.type==='LineString' && Array.isArray(geometry.coordinates) && geometry.coordinates.length){
    return {start:geometry.coordinates[0],end:geometry.coordinates[geometry.coordinates.length-1]};
  }
  if(geometry.type==='MultiLineString' && Array.isArray(geometry.coordinates) && geometry.coordinates.length){
    const first=geometry.coordinates.find(line=>Array.isArray(line) && line.length);
    const last=[...geometry.coordinates].reverse().find(line=>Array.isArray(line) && line.length);
    return {
      start:first ? first[0] : null,
      end:last ? last[last.length-1] : null
    };
  }
  return {start:null,end:null};
}

function setSatelliteMode(enabled){
  satelliteVisible=Boolean(enabled);
  const button=document.querySelector('#satelliteToggle');
  if(button){
    button.textContent=satelliteVisible?'Satellite':'Street';
    button.classList.toggle('active-toggle',satelliteVisible);
    button.setAttribute('aria-pressed',String(satelliteVisible));
  }
  if(map.getLayer('satellite-imagery')){
    map.setLayoutProperty('satellite-imagery','visibility',satelliteVisible?'visible':'none');
  }
  const status=document.querySelector('#basemapStatus');
  if(status){
    status.textContent=satelliteVisible
      ? 'Satellite imagery — verify mapped evidence against the visible physical environment'
      : 'Street basemap';
  }
}

function activateSatelliteAt(lat,lng){
  if(!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  setSatelliteMode(true);
  map.easeTo({center:[lng,lat],zoom:17.2,duration:700});
}

function extendGeometryBounds(bounds,geometry){
  if(!geometry) return;
  if(geometry.type==='Point'){
    const [lng,lat]=geometry.coordinates || [];
    if(Number.isFinite(lng) && Number.isFinite(lat)) bounds.extend([lng,lat]);
    return;
  }
  const visit=value=>{
    if(!Array.isArray(value)) return;
    if(value.length>=2 && Number.isFinite(value[0]) && Number.isFinite(value[1])){
      bounds.extend([value[0],value[1]]);
      return;
    }
    value.forEach(visit);
  };
  visit(geometry.coordinates);
}

function fitGeometry(geometry,{padding=70,maxZoom=15}={}){
  if(!geometry) return;
  const bounds=new maplibregl.LngLatBounds();
  extendGeometryBounds(bounds,geometry);
  if(!bounds.isEmpty()) map.fitBounds(bounds,{padding,maxZoom,duration:700});
}

function coordinateActions(lat,lng,{streetLabel='Street View',mapLabel='Open in Google Maps'}={}){
  if(!Number.isFinite(lat) || !Number.isFinite(lng)) return '';
  return `
    <div class="detail-actions three">
      <a class="button" target="_blank" rel="noopener noreferrer" href="${streetViewUrl(lat,lng)}">${esc(streetLabel)}</a>
      <button class="button secondary" type="button" data-satellite-inspect data-lat="${lat}" data-lng="${lng}">Satellite inspect</button>
      <a class="button secondary" target="_blank" rel="noopener noreferrer" href="${googleMapsUrl(lat,lng)}">${esc(mapLabel)}</a>
    </div>
    <div class="street-note">Street View and satellite imagery are field context. Provider imagery availability/date does not change the canonical evidence status.</div>`;
}

function focusRank(feature){
  if(!feature?.geometry?.coordinates) return;
  setExplorerMode('ranks');
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
    panel.classList.toggle('visible',explorerMode==='ranks');
    return;
  }

  panel.classList.toggle('visible',explorerMode==='ranks');

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

function setExplorerMode(mode){
  explorerMode=mode==='associations'?'associations':'ranks';
  const ranks=document.querySelector('#rankFinder');
  const associations=document.querySelector('#associationFinder');
  const rankTab=document.querySelector('#rankExplorerTab');
  const associationTab=document.querySelector('#associationExplorerTab');
  if(ranks) ranks.classList.toggle('visible',explorerMode==='ranks');
  if(associations) associations.classList.toggle('visible',explorerMode==='associations');
  if(rankTab) rankTab.classList.toggle('active-toggle',explorerMode==='ranks');
  if(associationTab) associationTab.classList.toggle('active-toggle',explorerMode==='associations');
}

function renderAssociationFinder(){
  const panel=document.querySelector('#associationFinder');
  const list=document.querySelector('#associationFinderList');
  const count=document.querySelector('#associationFinderCount');
  if(!panel || !list || !count) return;

  const features=associationData.features || [];
  count.textContent=String(features.length);
  panel.classList.toggle('visible',explorerMode==='associations');

  if(!features.length){
    list.innerHTML='<div class="rank-finder-empty">No mapped association geography matches the current scope.</div>';
    return;
  }

  list.innerHTML=features.map((feature,index)=>{
    const p=feature.properties || {};
    const derived=p.locationBasis==='linked_rank_centroid' || p.derivedLocation===true || p.derivedLocation==='true';
    return '<button class="rank-finder-item association-finder-item" data-association-index="'+index+'">'+
      '<span class="association-pin-mini">'+(derived?'◎':'●')+'</span>'+
      '<span><strong>'+esc(p.name || 'Taxi association')+'</strong><small>'+
        esc(p.registrationNumber || p.acronym || 'Registration pending')+' • '+
        Number(p.rankCount || 0)+' ranks • '+Number(p.routeCount || 0)+' routes'+
      '</small></span>'+
      '<b>'+esc(derived?'Coverage':'Location')+'</b>'+
    '</button>';
  }).join('');

  list.querySelectorAll('[data-association-index]').forEach(button=>{
    button.addEventListener('click',()=>{
      const feature=features[Number(button.dataset.associationIndex)];
      associationDetail(feature);
    });
  });
}

function clearAssociationHighlight(){
  selectedAssociationId=null;
  associationHighlightRanks={type:'FeatureCollection',features:[]};
  associationHighlightRoutes={type:'FeatureCollection',features:[]};
  map.getSource('association-highlight-ranks')?.setData(associationHighlightRanks);
  map.getSource('association-highlight-routes')?.setData(associationHighlightRoutes);
}

function fitAssociationNetwork(detail,associationFeature){
  const bounds=new maplibregl.LngLatBounds();
  if(associationFeature?.geometry) extendGeometryBounds(bounds,associationFeature.geometry);
  (detail?.ranks?.features || []).forEach(feature=>extendGeometryBounds(bounds,feature.geometry));
  (detail?.routes?.features || []).forEach(feature=>extendGeometryBounds(bounds,feature.geometry));
  if(!bounds.isEmpty()) map.fitBounds(bounds,{padding:80,maxZoom:13.5,duration:750});
}

async function loadQualitySummary(){
  try{
    const quality=await getJson('/api/v1/data-quality/summary');
    const node=document.querySelector('#qualityIssueCount');
    node.textContent=quality.open_issues ?? '0';
    node.title=[
      (quality.ranks_missing_location || 0)+' ranks missing coordinates',
      (quality.ranks_without_association || 0)+' ranks without association',
      (quality.route_candidates_without_association || 0)+' route candidates without association'
    ].join(' • ');
  }catch{
    document.querySelector('#qualityIssueCount').textContent='—';
  }
}

async function loadCoverage(){
  const province=document.querySelector('#province').value;
  const params=new URLSearchParams();
  if(province) params.set('province',province);

  try{
    const coverage=await getJson('/api/v1/coverage?' + params.toString());
    const n=coverage.national || {};
    document.querySelector('#coverageNational').textContent=
      (n.mapped_ranks || 0)+' mapped / '+(n.ranks || 0)+' documented ranks • '+
      (n.associations || 0)+' associations • '+(n.routes || 0)+' routes';

    const grid=document.querySelector('#coverageProvinces');
    grid.innerHTML=(coverage.provinces || []).map(row=>{
      const ranks=Number(row.ranks || 0);
      const mapped=Number(row.mapped_ranks || 0);
      const pct=ranks ? Math.round(mapped/ranks*100) : 0;
      const active=province===row.province ? ' active' : '';
      return '<button class="coverage-card'+active+'" data-coverage-province="'+esc(row.province)+'">'+
        '<strong>'+esc(row.province)+'</strong>'+
        '<span>'+mapped+' / '+ranks+' mapped</span>'+
        '<small>'+Number(row.associations || 0)+' associations • '+Number(row.routes || 0)+' routes • '+pct+'% mapped</small>'+
        '<i><b style="width:'+pct+'%"></b></i>'+
      '</button>';
    }).join('');

    grid.querySelectorAll('[data-coverage-province]').forEach(button=>{
      button.addEventListener('click',async()=>{
        selectedCoverageArea='';
        clearAssociationHighlight();
        document.querySelector('#province').value=button.dataset.coverageProvince;
        document.querySelector('#city').value='';
        setExplorerMode('ranks');
        await loadRankFilters();
        await Promise.all([loadRanks(),loadAssociations(),loadCoverage()]);
        const features=current.features || [];
        if(features.length){
          const bounds=new maplibregl.LngLatBounds();
          features.forEach(feature=>bounds.extend(feature.geometry.coordinates));
          if(!bounds.isEmpty()) map.fitBounds(bounds,{padding:70,maxZoom:10,duration:700});
        }
      });
    });

    const areas=document.querySelector('#coverageAreas');
    if(province && (coverage.areas || []).length){
      areas.innerHTML='<div class="coverage-area-title">'+esc(province)+' municipalities / cities</div>'+
        '<div class="coverage-area-list">'+coverage.areas.slice(0,30).map(row=>
          '<button class="'+(selectedCoverageArea===row.area?'active':'')+'" data-coverage-area="'+esc(row.area)+'"><strong>'+esc(row.area)+'</strong><span>'+
          Number(row.mapped_ranks || 0)+'/'+Number(row.ranks || 0)+' ranks • '+
          Number(row.associations || 0)+' associations • '+Number(row.routes || 0)+' routes</span></button>'
        ).join('')+'</div>';
      areas.querySelectorAll('[data-coverage-area]').forEach(button=>{
        button.addEventListener('click',async()=>{
          selectedCoverageArea=button.dataset.coverageArea;
          clearAssociationHighlight();
          const citySelect=document.querySelector('#city');
          if([...citySelect.options].some(option=>option.value===selectedCoverageArea)){
            citySelect.value=selectedCoverageArea;
          }else{
            citySelect.value='';
          }
          setExplorerMode('associations');
          await Promise.all([loadRanks(),loadAssociations(),loadCoverage()]);
          const features=current.features || [];
          if(features.length){
            const bounds=new maplibregl.LngLatBounds();
            features.forEach(feature=>bounds.extend(feature.geometry.coordinates));
            if(!bounds.isEmpty()) map.fitBounds(bounds,{padding:80,maxZoom:13,duration:650});
          }
        });
      });
    }else{
      areas.innerHTML='';
    }
  }catch{
    document.querySelector('#coverageNational').textContent='Coverage API unavailable';
    document.querySelector('#coverageProvinces').innerHTML='';
    document.querySelector('#coverageAreas').innerHTML='';
  }
}

async function loadAssociations(){
  const source=map.getSource('associations');
  if(!associationsVisible){
    associationData={type:'FeatureCollection',features:[]};
    if(source) source.setData(associationData);
    return;
  }

  const province=document.querySelector('#province').value;
  const city=document.querySelector('#city').value;
  const q=document.querySelector('#search').value.trim();
  const area=selectedCoverageArea || city;
  const params=new URLSearchParams();
  if(province) params.set('province',province);
  if(area) params.set('area',area);
  if(q) params.set('q',q);

  try{
    associationData=await getJson('/api/v1/associations/map?' + params.toString());
  }catch{
    associationData={type:'FeatureCollection',features:[]};
  }
  if(source) source.setData(associationData);
  renderAssociationFinder();

  if(q && associationData.features.length && !(current.features || []).length){
    setExplorerMode('associations');
  }
}

async function associationDetail(feature){
  const id=feature?.properties?.id || feature?.id;
  if(!id) return;

  setExplorerMode('associations');
  selectedAssociationId=String(id);

  let full=null;
  try{
    full=await getJson('/api/v1/associations/' + encodeURIComponent(id));
  }catch{
    full=null;
  }

  if(!full){
    document.querySelector('#detail').innerHTML='<div class="rank"><div class="journey-result">Association detail is temporarily unavailable.</div></div>';
    return;
  }

  const a=full.association || {};
  const coordinates=[
    Number.isFinite(Number(a.lng)) ? Number(a.lng) : feature?.geometry?.coordinates?.[0],
    Number.isFinite(Number(a.lat)) ? Number(a.lat) : feature?.geometry?.coordinates?.[1]
  ];
  const lng=Number(coordinates[0]);
  const lat=Number(coordinates[1]);
  const derived=a.locationBasis==='linked_rank_centroid';
  const basis=derived
    ? 'Derived coverage centroid from linked mapped ranks — not an association office location.'
    : a.locationBasis==='authoritative_association_location'
      ? 'Authoritative association coordinate.'
      : 'Association location is not yet mapped.';

  associationHighlightRanks=full.ranks || {type:'FeatureCollection',features:[]};
  associationHighlightRoutes=full.routes || {type:'FeatureCollection',features:[]};
  map.getSource('association-highlight-ranks')?.setData(associationHighlightRanks);
  map.getSource('association-highlight-routes')?.setData(associationHighlightRoutes);
  fitAssociationNetwork(full,feature);

  const rankItems=full.rankItems || [];
  const routeItems=full.routeItems || [];
  const sources=full.sources || [];

  const rankHtml=rankItems.length
    ? rankItems.slice(0,120).map((rank,index)=>
        '<button class="network-row" data-association-rank-index="'+index+'" '+(!Number.isFinite(rank.lat)||!Number.isFinite(rank.lng)?'disabled':'')+'>'+
          '<span><strong>'+esc(rank.name || rank.sourceCode || 'Taxi rank')+'</strong><small>'+
            esc([rank.town,rank.municipality,rank.province].filter(Boolean).join(' • ') || 'Location pending')+
          '</small></span>'+
          '<b>'+ (Number.isFinite(rank.lat)&&Number.isFinite(rank.lng)?'Map':'Pending') +'</b>'+
        '</button>'
      ).join('')
    : '<div class="journey-result">No canonical rank links are recorded for this association.</div>';

  const routeHtml=routeItems.length
    ? routeItems.slice(0,150).map((route,index)=>
        '<button class="network-row route-network-row" data-association-route-index="'+index+'">'+
          '<span><strong>'+esc(route.origin || 'Origin pending')+' → '+esc(route.destination || 'Destination pending')+'</strong><small>'+
            esc(route.boardRouteCode || route.nationalRouteCode || route.name || 'Route code pending')+' • '+
            esc(route.verificationStatus || 'unverified')+
          '</small></span>'+
          '<b>'+ (route.geometry?'Map':'Evidence') +'</b>'+
        '</button>'
      ).join('')
    : '<div class="journey-result">No canonical routes are linked to this association.</div>';

  const sourceHtml=sources.length
    ? sources.map(source=>
        '<div class="evidence-row"><strong>'+esc(source.source_name || source.source_key)+'</strong><span>'+
          esc(source.authority || 'Authority pending')+
        '</span></div>'
      ).join('')
    : '<div class="journey-result">No association-level source record is currently attached.</div>';

  const locationActions=Number.isFinite(lat) && Number.isFinite(lng)
    ? derived
      ? '<div class="detail-actions"><button class="button secondary" type="button" data-satellite-inspect data-lat="'+lat+'" data-lng="'+lng+'">Satellite coverage centre</button><a class="button secondary" target="_blank" rel="noopener noreferrer" href="'+googleMapsUrl(lat,lng)+'">Open coverage in Google Maps</a></div>'
      : coordinateActions(lat,lng,{streetLabel:'Street View association area'})
    : '';

  document.querySelector('#detail').innerHTML=`
    <div class="rank">
      <div class="rank-headline">
        <span class="badge ${esc(a.verificationStatus || 'documented')}">${esc((a.verificationStatus || 'documented').replaceAll('_',' '))}</span>
        <span class="rank-code">${esc(a.registrationNumber || a.acronym || 'Registration pending')}</span>
      </div>
      <h2>${esc(a.name || 'Taxi association')}</h2>
      <p>${esc([a.municipality,a.province].filter(Boolean).join(' • ') || 'Geographic coverage pending')}</p>

      <div class="evidence-summary">
        <div><span>Linked ranks</span><strong>${Number(a.rankCount || 0)}</strong><small>${Number(full.unmappedRankCount || 0)} location pending</small></div>
        <div><span>Linked routes</span><strong>${Number(a.routeCount || 0)}</strong><small>${associationHighlightRoutes.features.length} mapped geometries</small></div>
        <div><span>Location basis</span><strong>${derived?'Coverage centroid':a.locationBasis==='authoritative_association_location'?'Association location':'Unmapped'}</strong></div>
      </div>

      <div class="source association-location-note">
        <b>${derived?'Derived geographic coverage':'Association geography'}</b>
        <span>${esc(basis)}</span>
      </div>
      ${locationActions}

      <div class="detail-actions">
        <button class="button secondary" type="button" data-fit-association>Fit association network</button>
        <button class="button secondary" type="button" data-clear-association>Clear highlight</button>
      </div>

      <div class="section-block">
        <div class="section-title">Linked ranks</div>
        <div class="network-list">${rankHtml}</div>
      </div>
      <div class="section-block">
        <div class="section-title">Canonical routes</div>
        <div class="network-list">${routeHtml}</div>
      </div>
      <div class="section-block">
        <div class="section-title">Source provenance</div>
        <div class="route-list">${sourceHtml}</div>
      </div>
    </div>`;

  const panel=document.querySelector('#detail');
  panel.querySelectorAll('[data-association-rank-index]').forEach(button=>{
    button.addEventListener('click',()=>{
      const rank=rankItems[Number(button.dataset.associationRankIndex)];
      if(!rank || !Number.isFinite(rank.lat) || !Number.isFinite(rank.lng)) return;
      focusRank({
        type:'Feature',
        id:rank.id,
        geometry:{type:'Point',coordinates:[rank.lng,rank.lat]},
        properties:rank
      });
    });
  });

  panel.querySelectorAll('[data-association-route-index]').forEach(button=>{
    button.addEventListener('click',()=>{
      const route=routeItems[Number(button.dataset.associationRouteIndex)];
      if(!route) return;
      if(route.geometry) fitGeometry(route.geometry,{padding:90,maxZoom:13.5});
      routeDetail({...route,association:a.name,associationRegistration:a.registrationNumber},route.geometry);
    });
  });

  panel.querySelector('[data-fit-association]')?.addEventListener('click',()=>fitAssociationNetwork(full,feature));
  panel.querySelector('[data-clear-association]')?.addEventListener('click',()=>{
    clearAssociationHighlight();
    document.querySelector('#detail').innerHTML='<div class="empty"><div class="target">⌖</div><h2>Association highlight cleared</h2><p>Select another association, rank or route to continue exploring.</p></div>';
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
  const lat=Number(full?.lat);
  const lng=Number(full?.lng);

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
      ${coordinateActions(lat,lng)}

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
function routeDetail(p,geometry){
  selectedRouteGeometry=geometry || null;
  const status=p.verificationStatus || 'unverified';
  const endpoints=routeEndpointCoordinates(geometry);
  const startLng=Number(endpoints.start?.[0]);
  const startLat=Number(endpoints.start?.[1]);
  const endLng=Number(endpoints.end?.[0]);
  const endLat=Number(endpoints.end?.[1]);
  const endpointActions=(Number.isFinite(startLat) && Number.isFinite(startLng)) || (Number.isFinite(endLat) && Number.isFinite(endLng))
    ? `<div class="section-block">
        <div class="section-title">Street-level route inspection</div>
        <div class="detail-actions route-inspection-actions">
          ${Number.isFinite(startLat) && Number.isFinite(startLng) ? `<a class="button" target="_blank" rel="noopener noreferrer" href="${streetViewUrl(startLat,startLng)}">Street View start</a><button class="button secondary" type="button" data-satellite-inspect data-lat="${startLat}" data-lng="${startLng}">Satellite start</button>` : ''}
          ${Number.isFinite(endLat) && Number.isFinite(endLng) ? `<a class="button" target="_blank" rel="noopener noreferrer" href="${streetViewUrl(endLat,endLng)}">Street View end</a><button class="button secondary" type="button" data-satellite-inspect data-lat="${endLat}" data-lng="${endLng}">Satellite end</button>` : ''}
        </div>
        <div class="street-note">The displayed line's evidence class still governs what it means. Street View is physical-area context and does not upgrade route evidence.</div>
      </div>`
    : '';

  document.querySelector('#detail').innerHTML=`
    <div class="rank">
      <span class="badge ${esc(status)}">${esc(status.replaceAll('_',' '))}</span>
      <h2>${esc(p.origin || 'Origin pending')} → ${esc(p.destination || 'Destination pending')}</h2>
      <p>${esc(p.routeType || 'Taxi route')} • ${esc(p.geometryStatus || 'Geometry pending')}</p>
      ${p.association ? `<div class="source"><b>${esc(p.association)}</b><span>${esc(p.associationRegistration || 'Association registration pending')}</span></div>` : ''}
      <div class="detail-actions">
        ${geometry ? '<button class="button secondary" type="button" data-fit-route>Fit route on map</button>' : ''}
      </div>
      <div class="source">
        <b>${esc(p.source || 'Tenderize source registry')}</b>
        <span>${p.candidateRoute
          ? 'This is an exact-endpoint route candidate using official source geometry. It is not yet a canonical taxi route and association evidence may still be pending.'
          : p.notRoutePath
            ? 'This connector only joins two exactly reconciled rank endpoints. It is evidence of the documented origin/destination pair, not the travelled road path.'
            : 'This line is rendered from source-backed route geometry. It is not inferred from road routing.'}</span>
      </div>
      ${endpointActions}
    </div>`;
}

map.on('load',async()=>{
  await Promise.all([loadMeta(),loadQualitySummary()]);
  await loadRankFilters();
  await Promise.all([loadRanks(),loadCoverage()]);

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

  map.addSource('association-highlight-routes',{
    type:'geojson',
    data:associationHighlightRoutes
  });

  map.addLayer({
    id:'association-highlight-routes',
    type:'line',
    source:'association-highlight-routes',
    paint:{
      'line-width':['interpolate',['linear'],['zoom'],6,3.5,12,7],
      'line-color':'#f59e0b',
      'line-opacity':0.95
    }
  });

  map.addSource('association-highlight-ranks',{
    type:'geojson',
    data:associationHighlightRanks
  });

  map.addLayer({
    id:'association-highlight-ranks',
    type:'circle',
    source:'association-highlight-ranks',
    paint:{
      'circle-radius':['interpolate',['linear'],['zoom'],6,8,13,14],
      'circle-color':'#f59e0b',
      'circle-stroke-width':4,
      'circle-stroke-color':'#fff'
    }
  });

  map.addSource('associations',{
    type:'geojson',
    data:associationData
  });

  map.addLayer({
    id:'association-points',
    type:'circle',
    source:'associations',
    paint:{
      'circle-radius':['interpolate',['linear'],['zoom'],5,7,10,10,14,13],
      'circle-color':['case',['==',['get','locationBasis'],'authoritative_association_location'],'#0f766e','#d97706'],
      'circle-stroke-width':3,
      'circle-stroke-color':'#fff',
      'circle-opacity':0.92
    }
  });

  map.addLayer({
    id:'association-labels',
    type:'symbol',
    source:'associations',
    minzoom:6.5,
    layout:{
      'text-field':['get','name'],
      'text-size':['interpolate',['linear'],['zoom'],6.5,10,13,12],
      'text-offset':[0,1.45],
      'text-anchor':'top',
      'text-max-width':18,
      'text-allow-overlap':false
    },
    paint:{
      'text-color':'#7a4b00',
      'text-halo-color':'rgba(255,255,255,.96)',
      'text-halo-width':2
    }
  });

  await loadAssociations();

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

  map.on('click','association-highlight-ranks',event=>{
    const feature=event.features && event.features[0];
    if(feature) focusRank(feature);
  });

  map.on('click','association-highlight-routes',event=>{
    const feature=event.features && event.features[0];
    if(feature){
      fitGeometry(feature.geometry,{padding:90,maxZoom:13.5});
      routeDetail(feature.properties,feature.geometry);
    }
  });

  ['association-points','association-labels'].forEach(layer=>{
    map.on('click',layer,event=>{
      const feature=event.features && event.features[0];
      if(!feature) return;
      associationDetail(feature);
    });
  });

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
      routeDetail(feature.properties,feature.geometry);
    });
  });

  ['clusters','rank-points','rank-labels','association-points','association-labels','association-highlight-ranks','association-highlight-routes','official-routes','documented-routes','inferred-routes','source-route-geometries','route-candidates','nltis-endpoint-connectors'].forEach(layer=>{
    map.on('mouseenter',layer,()=>map.getCanvas().style.cursor='pointer');
    map.on('mouseleave',layer,()=>map.getCanvas().style.cursor='');
  });

  map.on('moveend',()=>{
    renderRankFinder();
    return Promise.all([loadRoutes(),loadEndpointEvidence(),loadSourceRouteGeometries(),loadRouteCandidates()]);
  });
});

document.querySelector('#rankExplorerTab').addEventListener('click',()=>setExplorerMode('ranks'));
document.querySelector('#associationExplorerTab').addEventListener('click',()=>setExplorerMode('associations'));

document.querySelector('#detail').addEventListener('click',event=>{
  const satelliteButton=event.target.closest('[data-satellite-inspect]');
  if(satelliteButton){
    activateSatelliteAt(Number(satelliteButton.dataset.lat),Number(satelliteButton.dataset.lng));
    return;
  }
  if(event.target.closest('[data-fit-route]') && selectedRouteGeometry){
    fitGeometry(selectedRouteGeometry,{padding:90,maxZoom:13.5});
  }
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
  selectedCoverageArea='';
  clearAssociationHighlight();
  document.querySelector('#city').value='';
  await loadRankFilters();
  await Promise.all([loadRanks(),loadAssociations(),loadCoverage()]);
});
document.querySelector('#city').addEventListener('change',async()=>{
  selectedCoverageArea=document.querySelector('#city').value;
  clearAssociationHighlight();
  await Promise.all([loadRanks(),loadAssociations()]);
  if(selectedCoverageArea) setExplorerMode('associations');
});
let timer;
document.querySelector('#search').addEventListener('input',()=>{
  clearTimeout(timer);
  timer=setTimeout(()=>Promise.all([loadRanks(),loadAssociations()]),180);
});
document.querySelector('#fit').addEventListener('click',()=>{
  selectedCoverageArea='';
  clearAssociationHighlight();
  setExplorerMode('ranks');
  document.querySelector('#province').value='';
  document.querySelector('#city').value='';
  document.querySelector('#search').value='';
  map.easeTo({center:[24.4,-29.1],zoom:4.35});
  Promise.all([loadRanks(),loadAssociations(),loadCoverage()]);
});


document.querySelector('#satelliteToggle').addEventListener('click',()=>{
  setSatelliteMode(!satelliteVisible);
});

document.querySelector('#associationToggle').addEventListener('click',()=>{
  associationsVisible=!associationsVisible;
  const button=document.querySelector('#associationToggle');
  button.textContent=associationsVisible?'Associations on':'Associations off';
  button.classList.toggle('active-toggle',associationsVisible);
  button.setAttribute('aria-pressed',String(associationsVisible));
  if(map.getLayer('association-points')){
    map.setLayoutProperty('association-points','visibility',associationsVisible?'visible':'none');
  }
  if(map.getLayer('association-labels')){
    map.setLayoutProperty('association-labels','visibility',associationsVisible?'visible':'none');
  }
  loadAssociations();
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
  Promise.all([loadRanks(),loadAssociations(),loadCoverage()]);
  setTimeout(()=>Promise.all([loadRoutes(),loadEndpointEvidence(),loadSourceRouteGeometries(),loadRouteCandidates()]),850);
});
