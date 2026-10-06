const BOILERPLATE=[
  /designated taxi rank or taxi stop/i,
  /at ranks, whether on/i,
  /rank permits or letters of authority/i,
  /entry or ranking on private property/i
];

function clean(value){
  return String(value || '').replace(/\r/g,'').replace(/[ \t]+/g,' ').trim();
}

function firstMatch(text,patterns){
  for(const pattern of patterns){
    const match=text.match(pattern);
    if(match?.[1]) return clean(match[1]);
  }
  return null;
}

function normalizeName(value){
  return clean(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g,' ')
    .trim()
    .replace(/\s+/g,' ');
}

function unique(values){
  return [...new Set(values.filter(Boolean))];
}

function rankMentions(block){
  const lines=block.split(/\n+/).map(clean).filter(Boolean);
  return unique(lines
    .filter(line=>/(taxi\s+rank|taxi\s+terminal|\bterminal\b|\brank\b)/i.test(line))
    .filter(line=>!BOILERPLATE.some(pattern=>pattern.test(line)))
    .map(line=>line.length>600 ? line.slice(0,600) : line));
}

function routeIdentifiers(block){
  return unique([
    ...block.matchAll(/\b(22[A-Z0-9]{8,24})\b/g)
  ].map(match=>match[1]));
}

function splitApplications(text){
  const normalized=String(text || '').replace(/\r/g,'');
  const marker=/(?=(?:^|\n)\s*(?:\d+\)\s*)?Application(?:\s+Number|\s+No\.?|\s+No)?\s*[:\-]?\s*[A-Z0-9])/gim;
  const indexes=[...normalized.matchAll(marker)].map(match=>match.index).filter(Number.isInteger);
  if(!indexes.length) return [normalized];
  const blocks=[];
  for(let i=0;i<indexes.length;i++){
    const start=indexes[i];
    const end=indexes[i+1] ?? normalized.length;
    blocks.push(normalized.slice(start,end));
  }
  return blocks;
}

export function parseGazetteText(text,source={}){
  const documentId=source.documentId || firstMatch(text,[
    /GAZETTE\s*\n?\s*([A-Z0-9-]+)/i,
    /(LGKZNG\d{1,3}-\d{4}-[A-Z]+)/i
  ]);

  const blocks=splitApplications(text);
  const rows=[];

  for(const block of blocks){
    const applicationNumber=firstMatch(block,[
      /Application(?:\s+Number|\s+No\.?|\s+No)?\s*[:\-]?\s*([A-Z0-9\/-]+)/i
    ]);
    const associationLabel=firstMatch(block,[
      /Association\s*[:\-]\s*([^\n]+)/i,
      /Taxi Association\s*[:\-]\s*([^\n]+)/i
    ]);
    const operatingLicenceNumber=firstMatch(block,[
      /Operating\s+Licence(?:\s+Number|\s+No\.?)?\s*[:\-]?\s*([A-Z0-9\/-]+)/i,
      /Licence(?:\s+Number|\s+No\.?)?\s*[:\-]?\s*([A-Z0-9\/-]+)/i
    ]);
    const region=firstMatch(block,[
      /Region\s*[:\-]\s*([^\n]+)/i
    ]);
    const applicant=firstMatch(block,[
      /Applicant\s*[:\-]\s*([^\n]+)/i
    ]);
    const mentions=rankMentions(block);
    const routeIds=routeIdentifiers(block);

    if(!applicationNumber && !associationLabel && !mentions.length && !routeIds.length) continue;

    const confidence=
      associationLabel && (mentions.length || routeIds.length) ? 1 :
      associationLabel || applicationNumber ? 0.75 :
      0.5;

    rows.push({
      evidenceType:'kzn_operating_licence_gazette',
      documentId:documentId || null,
      documentDate:source.date || null,
      sourceUrl:source.url || null,
      sourceAuthority:source.authority || 'KwaZulu-Natal Department of Transport',
      applicationNumber,
      applicant,
      associationLabel,
      normalizedAssociationLabel:associationLabel ? normalizeName(associationLabel) : null,
      operatingLicenceNumber,
      region,
      routeIdentifiers:routeIds,
      rankMentions:mentions,
      normalizedRankMentions:mentions.map(normalizeName),
      rawRouteDescription:block.slice(0,12000),
      extractionConfidence:confidence,
      canonicalWrites:false,
      rankLinkWrites:false,
      routeCandidateWrites:false
    });
  }

  return {
    documentId:documentId || null,
    sourceUrl:source.url || null,
    rows
  };
}
