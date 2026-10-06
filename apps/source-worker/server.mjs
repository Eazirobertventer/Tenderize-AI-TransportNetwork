import { createServer } from 'node:http';

const port = Number(process.env.PORT || 3000);
const sourceUrl = process.env.SOURCE_URL ||
  'https://gis.ekurhuleni.gov.za/arcgis/rest/services/GMS/Corridor_1/MapServer/52';

let last = {
  ok: false,
  state: 'not_checked',
  checkedAt: null,
  recordCount: null,
  sampleFeaturePresent: false,
  error: null
};

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'TenderizeTransportNetwork/0.2 railway-source-worker' },
    signal: AbortSignal.timeout(30000)
  });
  const text = await response.text();
  if (!response.ok) throw new Error('HTTP ' + response.status + ' ' + response.statusText);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Non-JSON response: ' + text.slice(0, 180));
  }
}

async function probe() {
  const countUrl = sourceUrl + '/query?' + new URLSearchParams({
    where: '1=1',
    returnCountOnly: 'true',
    f: 'json'
  });

  const sampleUrl = sourceUrl + '/query?' + new URLSearchParams({
    where: '1=1',
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'json'
  });

  try {
    const [count, sample] = await Promise.all([
      fetchJson(countUrl),
      fetchJson(sampleUrl)
    ]);

    const feature = Array.isArray(sample.features) ? sample.features[0] : null;
    const recordCount = Number.isFinite(count.count) ? count.count : null;

    last = {
      ok: Boolean(feature) && recordCount !== null,
      state: Boolean(feature) && recordCount !== null ? 'usable' : 'incomplete',
      checkedAt: new Date().toISOString(),
      recordCount,
      returnedFeatures: Array.isArray(sample.features) ? sample.features.length : 0,
      sampleFeaturePresent: Boolean(feature),
      sampleGeometryPresent: Boolean(feature && feature.geometry),
      sampleGeometry: feature?.geometry || null,
      sampleFields: feature?.attributes ? Object.keys(feature.attributes) : [],
      sampleAttributes: feature?.attributes || null,
      arcgisError: count.error || sample.error || null,
      error: null
    };
  } catch (error) {
    last = {
      ok: false,
      state: 'request_failed',
      checkedAt: new Date().toISOString(),
      recordCount: null,
      sampleFeaturePresent: false,
      error: String(error?.message || error)
    };
  }

  console.log(JSON.stringify({event:'source_probe',...last}));
}

await probe();
setInterval(probe, Number(process.env.PROBE_INTERVAL_MS || 900000));

createServer((req, res) => {
  res.setHeader('content-type', 'application/json; charset=utf-8');

  if (req.url === '/health') {
    res.statusCode = 200;
    res.end(JSON.stringify({ok:true,service:'source-worker',sourceReachable:last.ok}));
    return;
  }

  if (req.url === '/status') {
    res.statusCode = 200;
    res.end(JSON.stringify(last));
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({error:'not_found'}));
}).listen(port, '0.0.0.0', () => {
  console.log('source-worker listening on :' + port);
});
