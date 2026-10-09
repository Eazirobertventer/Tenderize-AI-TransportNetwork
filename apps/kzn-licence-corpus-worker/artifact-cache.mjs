import { createHash } from 'node:crypto';
import {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand
} from '@aws-sdk/client-s3';

function required(name,env=process.env){
  const value=env[name];
  if(!value) throw new Error(name+' required when evidence cache is enabled');
  return value;
}

export function evidenceCacheEnabled(env=process.env){
  return env.EVIDENCE_CACHE_ENABLED==='true';
}

export function sourceUrlHash(url){
  return createHash('sha256').update(String(url)).digest('hex');
}

export function artifactObjectKey(checksum,contentType='application/pdf'){
  const ext=/pdf/i.test(contentType)?'pdf':'bin';
  return 'artifacts/sha256/'+checksum.slice(0,2)+'/'+checksum+'.'+ext;
}

export function sourcePointerKey(url){
  return 'sources/'+sourceUrlHash(url)+'.json';
}

export function provenanceManifestKey(url,retrievedAt,checksum){
  const stamp=String(retrievedAt).replace(/[^0-9TZ]/g,'');
  return 'manifests/'+sourceUrlHash(url)+'/'+stamp+'-'+checksum+'.json';
}

function clientFromEnv(env=process.env){
  const style=(env.EVIDENCE_CACHE_URL_STYLE||'virtual-host').toLowerCase();
  return new S3Client({
    endpoint:required('EVIDENCE_CACHE_ENDPOINT',env),
    region:required('EVIDENCE_CACHE_REGION',env),
    forcePathStyle:style==='path',
    credentials:{
      accessKeyId:required('EVIDENCE_CACHE_ACCESS_KEY_ID',env),
      secretAccessKey:required('EVIDENCE_CACHE_SECRET_ACCESS_KEY',env)
    }
  });
}

async function bodyToBuffer(body){
  if(!body) return Buffer.alloc(0);
  if(typeof body.transformToByteArray==='function'){
    return Buffer.from(await body.transformToByteArray());
  }
  const chunks=[];
  for await(const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function objectExists(client,bucket,key){
  try{
    await client.send(new HeadObjectCommand({Bucket:bucket,Key:key}));
    return true;
  }catch(error){
    if(error?.$metadata?.httpStatusCode===404 || error?.name==='NotFound') return false;
    throw error;
  }
}

export async function storeEvidenceArtifact({
  buffer,
  sourceUrl,
  finalUrl=null,
  checksum,
  contentType='application/pdf',
  bytes,
  authority=null,
  sourceAdapter=null,
  documentId=null,
  retrievedAt=new Date().toISOString(),
  env=process.env
}){
  if(!evidenceCacheEnabled(env)) return {enabled:false,stored:false};
  const client=clientFromEnv(env);
  const bucket=required('EVIDENCE_CACHE_BUCKET',env);
  const artifactKey=artifactObjectKey(checksum,contentType);

  const existed=await objectExists(client,bucket,artifactKey);
  if(!existed){
    await client.send(new PutObjectCommand({
      Bucket:bucket,
      Key:artifactKey,
      Body:buffer,
      ContentType:contentType,
      Metadata:{
        sha256:checksum,
        sourceurlhash:sourceUrlHash(sourceUrl)
      }
    }));
  }

  const manifest={
    schemaVersion:1,
    immutableArtifact:true,
    checksumAlgorithm:'sha256',
    checksum,
    artifactKey,
    bytes:Number(bytes??buffer.length),
    contentType,
    sourceUrl,
    finalUrl:finalUrl||sourceUrl,
    authority,
    sourceAdapter,
    documentId,
    retrievedAt
  };
  const manifestKey=provenanceManifestKey(sourceUrl,retrievedAt,checksum);
  const pointerKey=sourcePointerKey(sourceUrl);
  const payload=Buffer.from(JSON.stringify(manifest));

  await client.send(new PutObjectCommand({
    Bucket:bucket,
    Key:manifestKey,
    Body:payload,
    ContentType:'application/json'
  }));
  await client.send(new PutObjectCommand({
    Bucket:bucket,
    Key:pointerKey,
    Body:payload,
    ContentType:'application/json'
  }));

  return {
    enabled:true,
    stored:!existed,
    reused:existed,
    bucket,
    artifactKey,
    manifestKey,
    pointerKey,
    checksum
  };
}

export async function loadCachedEvidenceArtifact(sourceUrl,{env=process.env}={}){
  if(!evidenceCacheEnabled(env)) return {enabled:false,hit:false};
  const client=clientFromEnv(env);
  const bucket=required('EVIDENCE_CACHE_BUCKET',env);
  const pointerKey=sourcePointerKey(sourceUrl);

  let pointer;
  try{
    const result=await client.send(new GetObjectCommand({Bucket:bucket,Key:pointerKey}));
    pointer=JSON.parse((await bodyToBuffer(result.Body)).toString('utf8'));
  }catch(error){
    if(error?.$metadata?.httpStatusCode===404 || error?.name==='NoSuchKey' || error?.name==='NotFound'){
      return {enabled:true,hit:false,pointerKey};
    }
    throw error;
  }

  const object=await client.send(new GetObjectCommand({Bucket:bucket,Key:pointer.artifactKey}));
  const buffer=await bodyToBuffer(object.Body);
  const actual=createHash('sha256').update(buffer).digest('hex');
  if(actual!==pointer.checksum){
    throw new Error('evidence_cache_checksum_mismatch');
  }
  return {
    enabled:true,
    hit:true,
    pointerKey,
    manifest:pointer,
    buffer,
    checksum:actual,
    bytes:buffer.length,
    contentType:pointer.contentType||object.ContentType||'application/octet-stream'
  };
}
