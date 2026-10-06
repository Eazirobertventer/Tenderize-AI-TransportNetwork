import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

const { Pool }=pg;
if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

const root=resolve(new URL('../..',import.meta.url).pathname);
const files=(process.env.NLTIS_RANK_SEED_FILES || 'apps/nltis-worker/verified-rank-seeds/armsta-h1.json')
  .split(',')
  .map(v=>v.trim())
  .filter(Boolean);

const pool=new Pool({connectionString:process.env.DATABASE_URL,max:3,ssl:false});
const client=await pool.connect();

try{
  await client.query('BEGIN');

  const summary=[];

  for(const rel of files){
    const seed=JSON.parse(await readFile(resolve(root,rel),'utf8'));

    const source=await client.query(
      `INSERT INTO source_registry
        (source_key,source_name,authority,source_class,source_url,coverage,official,legacy,last_checked_at)
       VALUES ($1,$2,$3,'nltis_olas',$4,$5,true,false,now())
       ON CONFLICT (source_key) DO UPDATE SET
         source_name=excluded.source_name,
         authority=excluded.authority,
         source_url=excluded.source_url,
         coverage=excluded.coverage,
         official=true,
         legacy=false,
         last_checked_at=now(),
         updated_at=now()
       RETURNING id`,
      [
        seed.sourceId + '-rank-seed',
        'NLTIS rank seed: ' + seed.phase,
        seed.authority,
        seed.reportUrl,
        seed.scope
      ]
    );
    const sourceId=source.rows[0].id;

    let created=0,existing=0,conflicts=0,sourceRecords=0;

    for(const rank of seed.ranks || []){
      const matches=await client.query(
        `SELECT id::text,canonical_name,province
         FROM taxi_rank
         WHERE upper(trim(canonical_name))=upper(trim($1))
           AND (province IS NULL OR lower(province)=lower($2))
         ORDER BY id`,
        [rank.canonicalName,rank.province]
      );

      let rankId=null;

      if(matches.rows.length===1){
        rankId=matches.rows[0].id;
        existing+=1;
      }else if(matches.rows.length>1){
        conflicts+=1;
        const issueKey=['nltis-rank-seed-conflict',seed.phase,rank.externalRecordId].join('|');
        await client.query(
          `INSERT INTO data_issue
            (entity_type,issue_type,severity,summary,detail,status)
           SELECT
            'taxi_rank','nltis_rank_seed_conflict','warning',$1,$2::jsonb,'open'
           WHERE NOT EXISTS (
             SELECT 1 FROM data_issue
             WHERE issue_type='nltis_rank_seed_conflict'
               AND detail->>'issueKey'=$3
               AND status IN ('open','reviewing','deferred')
           )`,
          [
            'Multiple exact canonical rank matches for ' + rank.canonicalName,
            JSON.stringify({
              issueKey,
              phase:seed.phase,
              sourceId:seed.sourceId,
              externalRecordId:rank.externalRecordId,
              canonicalName:rank.canonicalName,
              matchIds:matches.rows.map(row=>row.id),
              autoMerge:false
            }),
            issueKey
          ]
        );
        continue;
      }else{
        const inserted=await client.query(
          `INSERT INTO taxi_rank
            (canonical_name,aliases,province,verification_status,confidence,last_verified_at)
           VALUES ($1,$2::text[],$3,'documented',1.0,now())
           RETURNING id::text`,
          [rank.canonicalName,rank.aliases || [],rank.province]
        );
        rankId=inserted.rows[0].id;
        created+=1;
      }

      if(rankId){
        await client.query(
          `INSERT INTO source_record
            (source_id,entity_type,entity_id,external_record_id,source_payload,source_last_checked_at,source_confidence)
           VALUES ($1,'taxi_rank',$2::uuid,$3,$4::jsonb,now(),1.0)
           ON CONFLICT (source_id,entity_type,external_record_id) DO UPDATE SET
             entity_id=excluded.entity_id,
             source_payload=excluded.source_payload,
             source_last_checked_at=now(),
             source_retrieved_at=now(),
             source_confidence=1.0`,
          [
            sourceId,
            rankId,
            rank.externalRecordId,
            JSON.stringify({
              phase:seed.phase,
              sourceId:seed.sourceId,
              associationRegistration:seed.associationRegistration,
              canonicalName:rank.canonicalName,
              province:rank.province,
              verificationStatus:rank.verificationStatus,
              reportUrl:seed.reportUrl,
              location:null,
              coordinatesInvented:false,
              fuzzyMerge:false
            })
          ]
        );
        sourceRecords+=1;
      }
    }

    summary.push({
      phase:seed.phase,
      file:rel,
      ranks:(seed.ranks || []).length,
      created,
      existing,
      conflicts,
      sourceRecords
    });
  }

  await client.query('COMMIT');

  console.log(JSON.stringify({
    event:'nltis_rank_seed_ingest_complete',
    files:summary,
    policy:{
      exactCanonicalOnly:true,
      fuzzyMerge:false,
      coordinatesInvented:false,
      newRankVerificationStatus:'documented'
    }
  }));
}catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  console.error(JSON.stringify({event:'nltis_rank_seed_ingest_failed',error:String(error?.message || error)}));
  process.exitCode=1;
}finally{
  client.release();
  await pool.end();
}
