import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root=resolve(new URL('.',import.meta.url).pathname);
const manifestPath=resolve(root,'../../kzn-licence-corpus-worker/tn7-national-8-sources.json');

export async function loadKznHighVolumeCorpusPlan(){
  const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
  return {
    mode:'tn7_national_8_kzn_high_volume_corpus_plan',
    province:manifest.province,
    executionMode:manifest.executionMode,
    mutationEnabled:false,
    automaticPromotionEnabled:false,
    maximumDocumentsPerRun:manifest.maximumDocumentsPerRun,
    maximumQueueItems:manifest.maximumQueueItems,
    adapters:manifest.adapters.map(adapter=>({
      id:adapter.id,
      adapterType:adapter.adapterType,
      authority:adapter.authority,
      sourceClass:adapter.sourceClass,
      indexUrl:adapter.indexUrl,
      maxDocuments:adapter.maxDocuments,
      retries:adapter.retries,
      timeoutMs:adapter.timeoutMs
    })),
    nationalFramework:{
      genericDiscovery:true,
      provinceSpecificParser:true,
      provinceSpecificSourceAdapters:true,
      reusableNormalization:true,
      reusableDeduplication:true,
      reusableProvenance:true,
      reusableClassification:true
    }
  };
}
