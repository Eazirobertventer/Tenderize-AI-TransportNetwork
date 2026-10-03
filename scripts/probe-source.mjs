import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const sources = JSON.parse(await readFile(resolve(root, 'config/sources.json'), 'utf8'));
const sourceId = process.argv[2] || 'ekurhuleni-taxi-ranks';
const source = sources.find(item => item.id === sourceId);

if (!source) {
  console.error(JSON.stringify({ok:false,error:'source_not_found',sourceId}));
  process.exit(2);
}

async function getJson(url) {
  const response = await fetch(url, {
    headers:{'user-agent':'TenderizeTransportNetwork/0.2 source-contract-probe'},
    signal:AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(String(response.status) + ' ' + response.statusText);
  return response.json();
}

const expectedFields = (source.outFields || '').split(',').filter(Boolean);
const sampleUrl = source.url + '/query?' + new URLSearchParams({
  where:'1=1',
  outFields:expectedFields.join(','),
  returnGeometry:'true',
  outSR:'4326',
  resultRecordCount:'1',
  f:'json'
}).toString();

const countUrl = source.url + '/query?' + new URLSearchParams({
  where:'1=1',
  returnCountOnly:'true',
  f:'json'
}).toString();

try {
  const [sample,count] = await Promise.all([getJson(sampleUrl),getJson(countUrl)]);
  const feature = Array.isArray(sample.features) ? sample.features[0] : null;
  const attributes = feature && feature.attributes ? Object.keys(feature.attributes) : [];
  const missingExpectedFields = expectedFields.filter(name => !attributes.includes(name));
  const recordCount = Number.isFinite(count.count) ? count.count : null;
  const hasGeometry = Boolean(feature && feature.geometry);

  const result = {
    ok:Boolean(feature) && recordCount !== null && missingExpectedFields.length === 0,
    sourceId:source.id,
    authority:source.authority,
    status:source.status,
    recordCount,
    sampleFeaturePresent:Boolean(feature),
    sampleGeometryPresent:hasGeometry,
    expectedFields,
    missingExpectedFields,
    checkedAt:new Date().toISOString()
  };

  console.log(JSON.stringify(result,null,2));
  if (!result.ok) process.exit(3);
} catch (error) {
  console.error(JSON.stringify({
    ok:false,
    sourceId:source.id,
    error:String(error && error.message || error),
    checkedAt:new Date().toISOString()
  },null,2));
  process.exit(1);
}
