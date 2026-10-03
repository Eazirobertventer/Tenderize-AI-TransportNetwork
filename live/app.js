const data = window.__SEED_DATA;
const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/liberty',
  center: [24.4, -29.1],
  zoom: 4.35,
  maxBounds: [[14, -36], [35, -20]]
});
map.addControl(new maplibregl.NavigationControl({showCompass:false}), 'top-right');

document.querySelector('#rankCount').textContent = data.ranks.length;
document.querySelector('#associationCount').textContent = data.associations.length;
document.querySelector('#routeCount').textContent = data.routes.length;

function collection() {
  const province = document.querySelector('#province').value;
  const q = document.querySelector('#search').value.trim().toLowerCase();
  const rows = data.ranks.filter(rank =>
    (!province || rank.province === province) &&
    (!q || [rank.name, rank.town, rank.province].some(v => (v || '').toLowerCase().includes(q)))
  );
  document.querySelector('#resultStatus').textContent =
    `${rows.length} mapped rank${rows.length === 1 ? '' : 's'} in current view`;
  return {
    type: 'FeatureCollection',
    features: rows.map(rank => ({
      type: 'Feature',
      id: rank.id,
      geometry: {type:'Point', coordinates:[rank.lng, rank.lat]},
      properties: {
        id: rank.id,
        name: rank.name,
        town: rank.town,
        province: rank.province,
        verificationStatus: rank.status,
        source: rank.source
      }
    }))
  };
}

function refresh() {
  const source = map.getSource('ranks');
  if (source) source.setData(collection());
}

function detail(p) {
  const status = p.verificationStatus || 'unverified';
  document.querySelector('#detail').innerHTML = `
    <div class="rank">
      <span class="badge ${status}">${status.replaceAll('_',' ')}</span>
      <h2>${p.name}</h2>
      <p>${p.town || 'Location pending'} • ${p.province || 'Province pending'}</p>
      <div class="source">
        <b>${p.source || 'Tenderize source registry'}</b>
        <span>Evidence classification is retained. Candidate and inferred data are not represented as official.</span>
      </div>
    </div>`;
}

map.on('load', () => {
  map.addSource('ranks', {
    type: 'geojson',
    data: collection(),
    cluster: true,
    clusterMaxZoom: 12,
    clusterRadius: 42
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

  map.on('click','clusters', async event => {
    const feature = map.queryRenderedFeatures(event.point,{layers:['clusters']})[0];
    if (!feature) return;
    const zoom = await map.getSource('ranks').getClusterExpansionZoom(feature.properties.cluster_id);
    map.easeTo({center:feature.geometry.coordinates,zoom});
  });

  map.on('click','rank-points', event => {
    const feature = event.features && event.features[0];
    if (!feature) return;
    detail(feature.properties);
    map.easeTo({center:feature.geometry.coordinates,zoom:Math.max(map.getZoom(),11.5),duration:650});
  });

  ['clusters','rank-points'].forEach(layer => {
    map.on('mouseenter',layer,()=>map.getCanvas().style.cursor='pointer');
    map.on('mouseleave',layer,()=>map.getCanvas().style.cursor='');
  });
});

document.querySelector('#province').addEventListener('change',refresh);
let timer;
document.querySelector('#search').addEventListener('input',()=>{
  clearTimeout(timer);
  timer=setTimeout(refresh,180);
});
document.querySelector('#fit').addEventListener('click',()=>{
  document.querySelector('#province').value='';
  document.querySelector('#search').value='';
  map.easeTo({center:[24.4,-29.1],zoom:4.35});
  refresh();
});
