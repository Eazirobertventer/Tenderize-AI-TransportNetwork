const seed = window.__SEED_DATA;
let current = {type:'FeatureCollection',features:[]};
let mode = 'loading';

const map = new maplibregl.Map({
  container:'map',
  style:'https://tiles.openfreemap.org/styles/liberty',
  center:[24.4,-29.1],
  zoom:4.35,
  maxBounds:[[14,-36],[35,-20]]
});
map.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');

async function getJson(url){
  const response = await fetch(url,{cache:'no-store'});
  if(!response.ok) throw new Error(String(response.status));
  return response.json();
}

function seedCollection(){
  return {
    type:'FeatureCollection',
    features:seed.ranks.map(rank=>({
      type:'Feature',
      id:rank.id,
      geometry:{type:'Point',coordinates:[rank.lng,rank.lat]},
      properties:{
        id:rank.id,
        name:rank.name,
        town:rank.town || null,
        municipality:null,
        province:rank.province || null,
        verificationStatus:rank.status || 'unverified',
        source:rank.source || 'Seed dataset'
      }
    }))
  };
}

async function loadMeta(){
  try{
    const meta=await getJson('/api/v1/meta');
    mode=meta.mode;
    document.querySelector('#rankCount').textContent=meta.ranks;
    document.querySelector('#associationCount').textContent=meta.associations;
    document.querySelector('#routeCount').textContent=meta.routes;
    document.querySelector('#dataState').textContent=meta.mode.toUpperCase();
    document.querySelector('#mode').textContent=meta.mode==='postgis'?'PostGIS live':'Seed fallback';
  }catch{
    mode='seed';
    document.querySelector('#rankCount').textContent=seed.ranks.length;
    document.querySelector('#associationCount').textContent=seed.associations.length;
    document.querySelector('#routeCount').textContent=seed.routes.length;
    document.querySelector('#dataState').textContent='SEED';
    document.querySelector('#mode').textContent='Seed fallback';
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
    mode='postgis';
  }catch{
    const all=seedCollection();
    current={
      type:'FeatureCollection',
      features:all.features.filter(feature =>
        (!province || feature.properties.province===province) &&
        (!q || [feature.properties.name,feature.properties.town,feature.properties.province]
          .some(v => (v || '').toLowerCase().includes(q.toLowerCase())))
      )
    };
  }

  document.querySelector('#resultStatus').textContent =
    `${current.features.length} mapped rank${current.features.length===1?'':'s'} in current view`;

  const source=map.getSource('ranks');
  if(source) source.setData(current);
}

function detail(p){
  const status=p.verificationStatus || 'unverified';
  document.querySelector('#detail').innerHTML=`
    <div class="rank">
      <span class="badge ${status}">${status.replaceAll('_',' ')}</span>
      <h2>${p.name}</h2>
      <p>${p.town || p.municipality || 'Location pending'} • ${p.province || 'Province pending'}</p>
      <div class="source">
        <b>${p.source || 'Tenderize source registry'}</b>
        <span>Evidence classification is retained. Candidate and inferred data are never represented as official.</span>
      </div>
    </div>`;
}

map.on('load',async()=>{
  await loadMeta();
  await loadRanks();

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

  map.on('click','clusters',async event=>{
    const feature=map.queryRenderedFeatures(event.point,{layers:['clusters']})[0];
    if(!feature) return;
    const zoom=await map.getSource('ranks').getClusterExpansionZoom(feature.properties.cluster_id);
    map.easeTo({center:feature.geometry.coordinates,zoom});
  });

  map.on('click','rank-points',event=>{
    const feature=event.features && event.features[0];
    if(!feature) return;
    detail(feature.properties);
    map.easeTo({center:feature.geometry.coordinates,zoom:Math.max(map.getZoom(),11.5),duration:650});
  });

  ['clusters','rank-points'].forEach(layer=>{
    map.on('mouseenter',layer,()=>map.getCanvas().style.cursor='pointer');
    map.on('mouseleave',layer,()=>map.getCanvas().style.cursor='');
  });
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
