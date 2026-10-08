import fs from 'node:fs';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const api=read('apps/transport-api/src/server.mjs');
const workbench=read('apps/transport-api/src/operator-workbench.mjs');
const server=read('apps/operator-workbench/server.mjs');
const html=read('apps/operator-workbench/index.html');
const js=read('apps/operator-workbench/app.js');
const publicWeb=read('live/server.mjs');

const checks=[
  ['authenticated workbench endpoint',api.includes("/api/v1/operator/workbench")],
  ['workbench requires operator auth',api.includes("operatorAuthOrSend(req,res,['reviewer','approver','admin'])")],
  ['workbench contract mode',workbench.includes("mode:'operator_workbench'")],
  ['ADJ1 action surfaced',workbench.includes("action:'data_issue.defer'")],
  ['ADJ2 reject surfaced',workbench.includes("action:'data_issue.reject'")],
  ['ADJ2 reopen surfaced',workbench.includes("action:'data_issue.reopen'")],
  ['ADJ4 rank alias surfaced',workbench.includes("action:'taxi_rank.alias.add'")],
  ['ADJ4 association alias surfaced',workbench.includes("action:'taxi_association.alias.add'")],
  ['ADJ5 assignment surfaced',workbench.includes("action:'taxi_rank_association.assign'")],
  ['ADJ6 route promotion surfaced',workbench.includes("action:'taxi_route.promote'")],
  ['ADJ7 rank merge surfaced',workbench.includes("action:'taxi_rank.merge'")],
  ['ADJ8 association merge surfaced',workbench.includes("action:'taxi_association.merge'")],
  ['pending proposals surfaced',workbench.includes("WHERE status='proposed'")],
  ['immutable audit surfaced',workbench.includes('FROM operator_audit_event')],
  ['quality issues surfaced',workbench.includes('FROM data_issue')],
  ['rank-association candidates surfaced',workbench.includes('FROM rank_association_candidate')],
  ['route candidates surfaced',workbench.includes('FROM route_candidate')],
  ['workbench defaults off',server.includes("OPERATOR_WORKBENCH_ENABLED==='true'")],
  ['disabled workbench returns no UI',server.includes("if(!enabled) return json(res,404")],
  ['operator proxy allowlist exists',server.includes("const allowed=[")],
  ['operator proxy preserves bearer auth',server.includes("headers.authorization=req.headers.authorization")],
  ['operator proxy preserves idempotency key',server.includes("headers['idempotency-key']=req.headers['idempotency-key']")],
  ['proposal decision routes proxied',server.includes("(approve|reject|withdraw)")],
  ['public web excludes operator workbench',!publicWeb.includes('/api/v1/operator/workbench')],
  ['public web remains GET/HEAD only',publicWeb.includes("if(!['GET','HEAD'].includes(req.method || 'GET'))")],
  ['operator UI includes proposal queue',html.includes('Pending proposals')],
  ['operator UI includes audit surface',html.includes('Recent audit events')],
  ['operator UI includes action catalogue',html.includes('Controlled action catalogue')],
  ['operator UI token stored session-only',js.includes("sessionStorage.setItem('tn.operator.token'")],
  ['operator UI supports approve',js.includes("decide('approve')")],
  ['operator UI supports reject',js.includes("decide('reject')")],
  ['operator UI supports withdraw',js.includes("decide('withdraw')")]
];

for(const [name,ok] of checks){
  if(!ok) throw new Error('TN7_ADJ9_STATIC_FAIL: '+name);
  console.log('PASS '+name);
}
console.log('TN7_ADJ9_STATIC_PASS '+checks.length+'/'+checks.length);
