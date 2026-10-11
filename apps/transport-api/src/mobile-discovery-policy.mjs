export const CONSUMER_ELIGIBLE_VERIFICATION_STATUSES=Object.freeze([
  'official',
  'verified',
  'documented',
  'community_verified'
]);

const eligible=new Set(CONSUMER_ELIGIBLE_VERIFICATION_STATUSES);

export function isConsumerEligibleVerificationStatus(value){
  return eligible.has(value);
}

function visible(value){
  return typeof value==='string' && value.trim().length>0 ? value.trim() : null;
}

export function rankDisplayName(row){
  const aliases=Array.isArray(row.aliases) ? row.aliases : [];
  return visible(aliases[0]) || visible(row.canonicalName);
}

export function localityLabel(row){
  return visible(row.town) || visible(row.municipality);
}

export function publishedRouteCode(row){
  return visible(row.nationalRouteCode) || visible(row.boardRouteCode) || visible(row.sourceRouteCode);
}

export function publishedRouteName(row){
  return visible(row.routeName);
}

export function canonicalCoordinate(latitude,longitude){
  if(latitude==null && longitude==null) return undefined;
  if(!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if(latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return {latitude,longitude};
}
