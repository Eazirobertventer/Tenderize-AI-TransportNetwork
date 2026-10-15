import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { resolveAssociationIdentity } from './association-identity-resolution.mjs';

const root=resolve(new URL('.',import.meta.url).pathname);
const evidencePath=resolve(root,'../data/kzn-bhamshela-appelsbosch-identity-evidence.json');

export async function loadKznBhamshelaIdentityResolution(pool){
  if(!pool) return null;
  const evidence=JSON.parse(await readFile(evidencePath,'utf8'));
  const resolution=await resolveAssociationIdentity(pool,{
    label:evidence.label,
    province:evidence.province,
    region:evidence.region,
    officialEvidence:evidence.evidence,
    linkedRouteCodes:evidence.linkedGazetteRouteCodes
  });
  return {
    ...resolution,
    mode:'tn7_national_6_bhamshela_appelsbosch_identity_resolution',
    gate:'TN7-NATIONAL-6',
    evidencePack:{
      label:evidence.label,
      province:evidence.province,
      region:evidence.region,
      locality:evidence.locality,
      linkedGazetteRouteCodes:evidence.linkedGazetteRouteCodes,
      officialEvidenceRows:evidence.evidence.length
    }
  };
}
