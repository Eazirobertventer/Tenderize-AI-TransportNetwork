import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const data = JSON.parse(await readFile(resolve(new URL('../../..', import.meta.url).pathname, 'prototype/data/seed-network.json'), 'utf8'));

createServer((req, res) => {
  res.setHeader('content-type', 'application/json; charset=utf-8');

  if (req.url === '/health') {
    res.end(JSON.stringify({ok:true,service:'transport-api',mode:'seed'}));
    return;
  }

  if (req.url === '/api/v1/meta') {
    res.end(JSON.stringify({
      mode:'seed',
      ranks:data.ranks.length,
      associations:data.associations.length,
      routes:data.routes.length,
      productionComplete:false
    }));
    return;
  }

  if (req.url === '/api/v1/ranks') {
    const features = data.ranks.map(rank => ({
      type:'Feature',
      id:rank.id,
      geometry:{type:'Point',coordinates:[rank.lng,rank.lat]},
      properties:{
        id:rank.id,
        name:rank.name,
        town:rank.town || null,
        province:rank.province || null,
        verificationStatus:rank.status,
        source:rank.source || null
      }
    }));
    res.end(JSON.stringify({type:'FeatureCollection',features}));
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({error:'not_found'}));
}).listen(Number(process.env.PORT || 8080), '127.0.0.1');
