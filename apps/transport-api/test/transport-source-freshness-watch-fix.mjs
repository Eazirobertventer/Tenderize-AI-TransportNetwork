import pg from 'pg';
const {Pool}=pg;

if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');

const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:false,max:1});
const client=await pool.connect();

try{
  const result=await client.query(`
    SELECT source_key,source_name,last_checked_at,
           EXTRACT(EPOCH FROM (now()-last_checked_at))/3600.0 AS age_hours
    FROM source_registry
    WHERE source_key IN (
      'ethekwini-bus-taxi-ranks-degraded',
      'capetown-taxi-routes',
      'nltis-birchleigh-oakmoor',
      'nltis-civic-centre',
      'nltis-germiston-jane-furse',
      'nltis-hammanskraal',
      'nltis-lehlabile',
      'nltis-armsta',
      'nltis-ivory-park',
      'nltis-pretoria-plaza',
      'nltis-greater-bloemfontein',
      'kzn-taxi-ranks-degraded-tls',
      'ekurhuleni-taxi-ranks-full',
      'ekurhuleni-corridor-taxi-ranks',
      'kzn-dot-taxi-routes-2026'
    )
    ORDER BY age_hours DESC
  `);

  const normalized=result.rows.map(r=>({...r,age_hours:r.age_hours==null?null:Number(r.age_hours)}));
  const warnings=normalized.filter(r=>r.age_hours==null || r.age_hours>48);
  const critical=normalized.filter(r=>r.age_hours==null || r.age_hours>72);
  const status=critical.length>0?'CRITICAL':warnings.length>0?'WARNING':'OK';

  console.log('TRANSPORT_SOURCE_FRESHNESS '+JSON.stringify({
    status,
    monitored:15,
    found:normalized.length,
    warningCount:warnings.length,
    criticalCount:critical.length,
    warningThresholdHours:48,
    criticalThresholdHours:72,
    sources:normalized
  }));

  if(normalized.length!==15){
    console.error('TRANSPORT_SOURCE_FRESHNESS_MONITOR_ERROR '+JSON.stringify({
      error:'source_registry_monitor_set_incomplete',
      expected:15,
      found:normalized.length
    }));
    process.exitCode=1;
  }else{
    console.log('TRANSPORT_SOURCE_FRESHNESS_MONITOR_PASS '+JSON.stringify({
      status,
      criticalCount:critical.length,
      exitCode:0
    }));
  }
}finally{
  client.release();
  await pool.end();
}
