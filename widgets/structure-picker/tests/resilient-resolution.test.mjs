import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,stat} from 'node:fs/promises';
import {setImmediate as settle} from 'node:timers/promises';
import {extractOfficialCandidates} from '../search.js';
import {resolveEstablishmentForEnrichment} from '../establishment-service.js';
import {resolveIdentityForEnrichment} from '../identity-service.js';
import {findOfficialRegistrySites,normalizeRegistryRecords,verifiedRegistryLink,resetRegistryCacheForTests} from '../official-site-registry.js';
import {registrySiteMatches,registryLinkValid,decideIdentity} from '../identity-resolution.js';
import {findIndexedEducationPositions,assessEducationPosition,interiorSitePoint} from '../registry-site-positions.js';
import {findIndexedSitePositions} from '../site-position-sources.js';
import {resolveSitePosition} from '../establishment-position.js';
import {buildEnrichmentProposals} from '../enrichment.js';
import {findOfficialPublicSites} from '../public-sites.js';
import {boundedSource} from '../bounded-source.js';
import {fetchOfficialRequest,resetOfficialClientForTests} from '../enterprise-client.js';

const fixture=async name=>JSON.parse(await readFile(new URL(`./fixtures/resolution/${name}.json`,import.meta.url),'utf8'));
const cases=[
 {id:'alliance',name:"École de l'Alliance",address:'55 boulevard Jean XXIII, 85300 Challans',siret:'',expected:'32548690000062',status:'MATCH_VERIFIED'},
 {id:'guillonneau',name:'Résidence Marie et Albert Guillonneau',address:'27 rue de la Gazonnière, 85300 Challans',siret:'',expected:'26850050100070',status:'MATCH_VERIFIED'},
 {id:'marie-no-postal',name:'École Sainte Marie',address:'9 rue de la Paix, Saint-Lumine-de-Coutais',siret:'78605938600015',expected:'78605938600023',status:'MATCH_VERIFIED'},
 {id:'marie-postal',name:'École Sainte Marie',address:'9 rue de la Paix, 44310 Saint-Lumine-de-Coutais',siret:'78605938600015',expected:'78605938600023',status:'MATCH_VERIFIED'},
 {id:'enfance',name:"Maison de l'enfance",address:'10 ter place du Champ de Foire, 44650 Legé',siret:'',expected:null,status:'MATCH_VERIFIED'},
];
const rowOf=c=>({NomCommercial:c.name,Adresse:c.address,SirenSiret:c.siret});
const localFetch=async input=>{const url=new URL(input);if(url.protocol!=='file:')return new Response('',{status:503});url.search='';try{return new Response(await readFile(url,'utf8'),{headers:{'Content-Type':'application/json'}});}catch{return new Response('',{status:404});}};
const payloads=new Map(await Promise.all([['32548690000062','alliance-annuaire'],['26850050100070','guillonneau-annuaire'],['78605938600023','marie-site-annuaire'],['78605938600015','marie-seat-annuaire']].map(async([id,name])=>[id,await fixture(name)])));
const registry=input=>findOfficialRegistrySites({row:input.row??input,fetchImpl:localFetch,allowLive:false});
async function options(c,extra={}){
 const base=c.id.startsWith('marie')?'marie':c.id;
 return {row:rowOf(c),findPublicSites:args=>findOfficialPublicSites({...args,fetchImpl:localFetch}),findRegistrySites:registry,findPublishedLinks:async()=>({candidates:[]}),findSectorLinks:null,
  geocode:async()=>[],fetchOfficial:async request=>{const p=payloads.get(request.requestedSiret||request.query)||await fixture(base==='alliance'?'alliance-text-annuaire':base==='guillonneau'?'guillonneau-text-annuaire':'enfance-annuaire');return {...extractOfficialCandidates(p,{requestedSiret:request.requestedSiret}),cached:false};},
  findIndexedPositions:args=>findIndexedSitePositions({...args,fetchImpl:localFetch}),findOsmPositions:async()=>({observations:[],coverage:[]}),...extra};
}

test('real source replay: all five new rows finish without the former global timeout',async t=>{
 for(const c of cases)await t.test(c.id,async()=>{
  const r=await resolveEstablishmentForEnrichment(await options(c));
  assert.equal(r.decision.status,c.status);assert.equal(r.candidate?.siret??null,c.expected);
  assert.ok(!r.diagnostics.some(d=>/délai maximal/.test(d)));
  if(c.id==='enfance'){assert.equal(r.candidate.identityScope,'PUBLIC_SITE');assert.equal(r.candidate.siret,null);assert.deepEqual([r.candidate.latitude,r.candidate.longitude],[46.8861988,-1.5975397]);}
  if(c.id==='alliance'){assert.equal(r.candidate.position.status,'SITE_CONFIRMED');assert.equal(r.candidate.position.source.id,'ign-bdtopo');}
  if(c.id==='guillonneau'){assert.equal(r.candidate.position.status,'SITE_CONFIRMED');assert.equal(r.candidate.position.source.recordId,'way:1098104437');assert.ok(r.candidate.position.proof.some(p=>p.finess==='850025917'));}
  if(c.id.startsWith('marie')){assert.equal(r.decision.identifierWarning.entered,c.siret);assert.equal(r.candidate.position.status,'SITE_CONFIRMED');const proposals=buildEnrichmentProposals(rowOf(c),r.candidate,{identityStatus:r.decision.status});assert.equal(proposals.find(p=>p.field==='SirenSiret').selectedByDefault,false);}
  assert.ok(r.trace.some(e=>e.source==='identity:plan'&&e.state==='ok'));
 });
});

test('both Sainte Marie spellings identify the same school site independently of a wrong, absent or corrected SIRET',async()=>{
 const results=[];
 for(const c of cases.filter(c=>c.id.startsWith('marie')).flatMap(c=>['','78605938600015','78605938600023','786059386','00000000000000','erroné'].map(siret=>({...c,siret})))){
  const r=await resolveEstablishmentForEnrichment(await options(c));
  assert.equal(r.decision.status,'MATCH_VERIFIED');assert.equal(r.candidate.siret,'78605938600023');
  assert.equal(r.candidate.position.status,'SITE_CONFIRMED');assert.equal(r.candidate.position.source.recordId,'way:373841583');
  assert.ok(r.candidate.position.proof.some(p=>p.kind==='OFFICIAL_ADDRESS_INSIDE_SITE'));results.push([r.candidate.latitude,r.candidate.longitude]);
 }
 for(const result of results)assert.deepEqual(result,results[0]);
});

test('education evidence refuses another SIRET, own UAI missing, closed school and wrong public name',async()=>{
 const row=rowOf(cases[0]);const {records}=await registry(row);const record=records[0];const candidate=extractOfficialCandidates(payloads.get(record.siret)).items[0];
 const link=verifiedRegistryLink(record,candidate,{checkedAt:new Date().toISOString(),url:'https://recherche-entreprises.api.gouv.fr/search?q='+record.siret});
 assert.ok(registryLinkValid(link,candidate,row));
 for(const mutate of [c=>c.siret='32548690000013',c=>c.uaiIds=[],c=>c.etatAdministratif='F']){
  const other=structuredClone(candidate);mutate(other);const result=decideIdentity({row,candidates:[other],links:[link]});assert.notEqual(result.status,'MATCH_VERIFIED');
 }
 for(const mutate of [r=>r.native.siren_siret='32548690000013',r=>r.native.etat='FERME',r=>r.native.identifiant_de_l_etablissement='0850000A',r=>r.name='Ecole du voisin']){
  const altered=structuredClone(link);mutate(altered.registryRecord);assert.equal(registryLinkValid(altered,candidate,row),false);
 }
 const next=structuredClone(record);next.adresse=next.adresse.replace('55','57');assert.equal(registrySiteMatches(row,next),false);
 const college=structuredClone(record);college.name=college.publicNames[0]='Collège privé de l’Alliance';college.siteType='Collège';assert.equal(registrySiteMatches(row,college),false);
});

test('a nearby campus, a partial address, a street point or a contradictory UAI never locates the school',async()=>{
 const c={...cases[3],siret:'78605938600023'};const r=await resolveIdentityForEnrichment(await options(c));const candidate=r.decision.candidate;
 const {observations}=await findIndexedEducationPositions({candidate,links:r.links,identityStatus:r.decision.status,fetchImpl:localFetch});
 assert.equal(observations.length,2);
 const alternate=observations.find(p=>p.source.recordId==='way:373842165');assert.equal(assessEducationPosition(candidate,alternate,{links:r.links,identityStatus:r.decision.status}).accepted,false);
 const accepted=observations.find(p=>p.source.recordId==='way:373841583');
 for(const mutate of [p=>{p.shape=null;p.adresse='';},p=>p.qualityError=true,p=>p.uaiIds=['0440000A'],p=>p.name='Collège Sainte Marie']){
  const poi=structuredClone(accepted);mutate(poi);assert.equal(assessEducationPosition(candidate,poi,{links:r.links,identityStatus:r.decision.status}).accepted,false);
 }
 const contradict=structuredClone(accepted);contradict.name='Autre école';
 assert.equal(resolveSitePosition(candidate,{observations:[accepted,contradict],links:r.links,identityStatus:r.decision.status}).status,'CONFLICT');
});

test('a slow published source cannot prevent independent registry/Annuaire confirmation or later replace its result',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});let release;let oldSignal;
 const pending=resolveIdentityForEnrichment(await options(cases[0],{row:{...rowOf(cases[0]),NomCommercial:"L'Alliance"},findPublishedLinks:({signal})=>{oldSignal=signal;return new Promise(resolve=>{release=resolve;});}}));
 const result=await pending;assert.equal(result.decision.status,'MATCH_VERIFIED');assert.equal(oldSignal.aborted,true);
 const text=JSON.stringify(result);release({candidates:[{siret:'11111111111111'}]});await settle();assert.equal(JSON.stringify(result),text);
});

test('unavailable Annuaire retains the public site as incomplete without proposing legal or coordinate writes',async()=>{
 const r=await resolveEstablishmentForEnrichment(await options(cases[0],{fetchOfficial:async()=>{throw new Error('HTTP 503');}}));
 assert.equal(r.decision.status,'INCOMPLETE');assert.equal(r.candidate.siret,'32548690000062');assert.equal(r.candidate.registryOnly,true);assert.equal(r.candidate.latitude,null);
 assert.deepEqual(buildEnrichmentProposals(rowOf(cases[0]),r.candidate,{identityStatus:r.decision.status}),[]);
 assert.match(r.diagnostics.join(' '),/503/);
});

test('all source requests ignoring cancellation still produce an explicit bounded incomplete result',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});let officialSignal;
 const pending=resolveEstablishmentForEnrichment(await options(cases[4],{findPublicSites:null,findRegistrySites:async()=>({records:[],complete:true}),fetchOfficial:(_,{signal})=>{officialSignal=signal;return new Promise(()=>{});}}));
 await settle();t.mock.timers.tick(6500);await settle();
 const result=await pending;assert.equal(result.decision.status,'INCOMPLETE');assert.equal(officialSignal.aborted,true);assert.equal(result.candidate,null);assert.ok(result.trace.some(e=>e.state==='timeout'));
});

test('source cancellation and rate-limit waits release their queue slots without exposing stale responses',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.UTC(2026,9,26)});resetOfficialClientForTests();t.after(resetOfficialClientForTests);
 let calls=0;let release;
 const req={url:'https://example.test/search',kind:'siret',requestedSiret:'78605938600023'};
 const first=fetchOfficialRequest(req,{fetchImpl:()=>{calls++;return new Promise(resolve=>{release=resolve;});},timeoutMs:500});
 const rejected=assert.rejects(first,{name:'TimeoutError'});await settle();t.mock.timers.tick(500);await rejected;
 const controller=new AbortController();const queued=fetchOfficialRequest(req,{signal:controller.signal,fetchImpl:async()=>{calls++;return Response.json({results:[]});}});const canceled=assert.rejects(queued,{name:'AbortError'});controller.abort();await canceled;
 const next=fetchOfficialRequest(req,{fetchImpl:async()=>{calls++;return Response.json({results:[]});}});await settle();t.mock.timers.tick(1300);await next;assert.equal(calls,2);
 release(Response.json(payloads.get('78605938600023')));await settle();
 const stop=new AbortController();const op=boundedSource('ignores-abort',()=>new Promise(()=>{}),{signal:stop.signal});const aborted=assert.rejects(op,{name:'AbortError'});stop.abort();await aborted;
});

test('the published cohort is complete, bounded, typed and independent of reference names',async()=>{
 const base=new URL('../identity-links/site-registry/',import.meta.url);const manifest=JSON.parse(await readFile(new URL('manifest.json',base)));
 let count=0;const types=new Set();const ownership=new Set();
 for(const file of new Set(manifest.communes.flatMap(t=>t.files))){
  assert.ok((await stat(new URL(file,base))).size<=96*1024);const shard=JSON.parse(await readFile(new URL(file,base)));assert.equal(shard.records.length,shard.recordCount);
  for(const entry of shard.records){const records=normalizeRegistryRecords(entry,manifest.source);assert.ok(records.length);count++;for(const record of records){types.add(record.kind==='education'?record.siteType:record.categoryCode);if(entry.kind==='education')ownership.add(entry.native.statut_public_prive);}}
 }
 assert.ok(count>4000);assert.ok(types.has('Ecole')&&types.has('Collège')&&types.has('Lycée')&&types.has('500')&&types.has('354'));assert.ok(ownership.has('Public')&&ownership.has('Privé'));
 const osmBase=new URL('../site-position-indexes/osm-education/',import.meta.url);assert.ok((await readdir(osmBase)).length>300);
 const shape={type:'Polygon',coordinates:[[[0,47],[.01,47],[.01,47.01],[.005,47.002],[0,47.01],[0,47]]]};assert.ok(interiorSitePoint(shape));
 resetRegistryCacheForTests();
});

test('an independent real corpus covers public/private schools, college, lycée, SSIAD, residence autonomy, IME and a hospital site',async t=>{
 const captures=await fixture('diverse-public-services');
 for(const capture of captures)await t.test(capture.record.native.nom_etablissement||capture.record.native.informationsGeneralesEGE.nomEgeLong,async()=>{
  assert.equal(capture.status,200);assert.ok(capture.capturedAt&&capture.url.startsWith('https://recherche-entreprises.api.gouv.fr/'));
  const records=normalizeRegistryRecords(capture.record);assert.ok(records.length);
  const source=records[0];const row={NomCommercial:source.name,Adresse:source.adresse,SirenSiret:''};
  const result=await resolveIdentityForEnrichment({row,findRegistrySites:async()=>({records:[source],complete:true}),findPublishedLinks:async()=>({candidates:[]}),findSectorLinks:null,
   fetchOfficial:async()=>({...extractOfficialCandidates(capture.body),cached:false}),geocode:async()=>[]});
  assert.equal(result.decision.status,capture.expectation.status,capture.expectation.reason);
  if(capture.expectation.status!=='MATCH_VERIFIED'){assert.equal(result.decision.candidate,null);assert.ok(result.diagnostics.length);return;}
  assert.equal(result.decision.candidate.siret,source.siret);
  const link=result.links.find(item=>item.sourceRecordId===source.recordId);assert.ok(link);assert.ok(registryLinkValid(link,result.decision.candidate,row));
  const wrong=structuredClone(source);wrong.siret=source.siret.slice(0,9)+'99999';assert.equal(verifiedRegistryLink(wrong,result.decision.candidate,{checkedAt:capture.capturedAt,url:capture.url}),null);
 });
});

test('actual Alliance input reproduces the lowercase-l Roman numeral failure and now preserves explicit normalization evidence',async()=>{
 const actual=(await fixture('grist-inputs-2026-10-27')).rows.find(row=>row.id===5);
 assert.ok(actual.Adresse.includes('XXlll'));
 const result=await resolveEstablishmentForEnrichment(await options(cases[0],{row:actual}));
 assert.equal(result.decision.status,'MATCH_VERIFIED');assert.equal(result.candidate.siret,'32548690000062');
 assert.equal(result.candidate.position.source.id,'ign-bdtopo');
 const certificate=result.decision.certificates.find(item=>item.siret===result.candidate.siret);
 assert.deepEqual(certificate.address.target.typography,[{kind:'ROMAN_NUMERAL_HOMOGLYPH',original:'XXlll',normalized:'XXIII'}]);
 assert.ok(certificate.explanations.some(text=>text.includes('XXlll → XXIII')));
});

test('actual Sainte Marie rows are confirmed despite seat SIRET, with coordinates gated on explicit correction in the same write',async()=>{
 const inputs=(await fixture('grist-inputs-2026-10-27')).rows.filter(row=>[7,8].includes(row.id));
 for(const row of inputs){
  const result=await resolveEstablishmentForEnrichment(await options(cases[2],{row}));
  assert.equal(result.decision.status,'MATCH_VERIFIED');assert.equal(result.candidate.siret,'78605938600023');
  assert.equal(result.decision.identifierWarning.entered,'78605938600015');
  assert.equal(result.candidate.position.source.recordId,'way:373841583');
  const proposals=buildEnrichmentProposals(row,result.candidate,{identityStatus:result.decision.status});
  assert.equal(proposals.find(item=>item.field==='SirenSiret').selectedByDefault,false);
  const {selectedChanges}=await import('../enrichment.js');
  assert.deepEqual(selectedChanges(proposals,['Coordinates']),{});
  const changes=selectedChanges(proposals,['Coordinates','SirenSiret']);
  assert.equal(changes.SirenSiret,'78605938600023');assert.equal(changes.Latitude,result.candidate.latitude);assert.equal(changes.Longitude,result.candidate.longitude);
 }
});
