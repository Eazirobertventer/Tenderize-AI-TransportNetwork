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

const metadataUrl = source.url + '?f=pjson';
const countUrl = source.url + '/query?' + new URLSearchParams({
  where:'1=1',
  returnCountOnly:'true',
  f:'json'
}).toString();

async function getJson(url) {
  const response = await fetch(url, {
    headers:{'user-agent':'TenderizeTransportNetwork/0.2 source-contract-probe'},
    signal:AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(String(response.status) + ' ' + response.statusText);
  return response.json();
}

try {
  const [metadata,count] = await Promise.all([getJson(metadataUrl),getJson(countUrl)]);
  const fields = Array.isArray(metadata.fields) ? metadata.fields.map(f => f.name) : [];
  const result = {
    ok:true,
    sourceId:source.id,
    authority:source.authority,
    status:source.status,
    layerName:metadata.name || null,
    geometryType:metadata.geometryType || null,
    recordCount:Number.isFinite(count.count) ? count.count : null,
    maxRecordCount:metadata.maxRecordCount || null,
    expectedFields:(source.outFields || '').split(',').filter(Boolean),
    missingExpectedFields:(source.outFields || '').split(',').filter(Boolean).filter(name => !fields.includes(name)),
    checkedAt:new Date().toISOString()
  };
  console.log(JSON.stringify(result,null,2));
  if (!result.recordCount || result.missingExpectedFields.length) process.exit(3);
} catch (error) {
  console.error(JSON.stringify({
    ok:false,
    sourceId:source.id,
    error:String(error && error.message || error),
    checkedAt:new Date().toISOString()
  },null,2));
  process.exit(1);
}
