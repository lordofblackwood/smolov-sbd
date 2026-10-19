import test from 'node:test';import assert from 'node:assert/strict';import worker from './src/worker.mjs';
const origin='https://lordofblackwood.github.io';const auth=`Bearer ${'a'.repeat(64)}`;const path='https://relay.example/api/history/bulgarian';const env={BUCKET:{get:async()=>null,put:async()=>{}}};
test('rejects unpaired reads',async()=>assert.equal((await worker.fetch(new Request(path),env)).status,401));
test('rejects foreign origins',async()=>assert.equal((await worker.fetch(new Request(path,{headers:{Origin:'https://attacker.example',Authorization:auth}}),env)).status,403));
test('permits authenticated preflight without leaking data',async()=>{const r=await worker.fetch(new Request(path,{method:'OPTIONS',headers:{Origin:origin}}),env);assert.equal(r.status,204);assert.equal(r.headers.get('Access-Control-Allow-Origin'),origin)});
test('missing history is distinct from a failure',async()=>assert.equal((await worker.fetch(new Request(path,{headers:{Authorization:auth}}),env)).status,404));
test('rejects plaintext uploads',async()=>assert.equal((await worker.fetch(new Request(path,{method:'PUT',headers:{Authorization:auth,'Content-Type':'application/json'},body:JSON.stringify({history:[]})}),env)).status,400));
test('isolates room and source; stores ciphertext only',async()=>{let saved;const fake={BUCKET:{put:async(k,v)=>{saved={k,v}}}};const body=JSON.stringify({version:1,iv:'a'.repeat(16),ciphertext:'a'.repeat(100)});const r=await worker.fetch(new Request(path,{method:'PUT',headers:{Authorization:auth,'Content-Type':'application/json',Origin:origin},body}),fake);assert.equal(r.status,200);assert.match(saved.k,/^v1\/[a-f0-9]{64}\/bulgarian.json$/);assert.equal(saved.v,body);assert.equal(r.headers.get('Cache-Control'),'no-store')});
test('rejects oversized upload before writing',async()=>assert.equal((await worker.fetch(new Request(path,{method:'PUT',headers:{Authorization:auth,'Content-Type':'application/json','Content-Length':'2000001'},body:'{}'}),env)).status,413));
test('R2 failures remain recoverable',async()=>assert.equal((await worker.fetch(new Request(path,{headers:{Authorization:auth}}),{BUCKET:{get:async()=>{throw Error('down')}}})).status,503));
test('bodyweight is a third isolated encrypted source',async()=>{let key;const fake={BUCKET:{put:async(k)=>{key=k}}};const target='https://relay.example/api/history/bodyweight';const r=await worker.fetch(new Request(target,{method:'PUT',headers:{Authorization:auth,'Content-Type':'application/json'},body:JSON.stringify({version:1,iv:'a'.repeat(16),ciphertext:'a'.repeat(100)})}),fake);assert.equal(r.status,200);assert.match(key,/\/bodyweight\.json$/);assert.equal((await worker.fetch(new Request(target),env)).status,401);assert.equal((await worker.fetch(new Request('https://relay.example/api/history/unknown',{headers:{Authorization:auth}}),env)).status,404)});
test('advertises the exact independently isolated Smolov contract',async()=>{const response=await worker.fetch(new Request('https://relay.example/',{headers:{Origin:'https://smolov-sbd.micak27.chatgpt.site'}}),env);const body=await response.json();assert.ok(body.sources.includes('smolov'));assert.equal(body.contracts.smolov.contract,'smolov-v1');assert.equal(body.contracts.smolov.conditionalWrites,true);assert.equal(body.contracts.smolov.etagTransport,'snapshot-body');assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://smolov-sbd.micak27.chatgpt.site')});
test('requires Smolov write preconditions without touching legacy source keys',async()=>{const target='https://relay.example/api/history/smolov';const body=JSON.stringify({version:1,iv:'a'.repeat(16),ciphertext:'a'.repeat(100)});assert.equal((await worker.fetch(new Request(target,{method:'PUT',headers:{Authorization:auth,'Content-Type':'application/json'},body}),env)).status,428)});
test('passes atomic creation conditions to R2 and returns its ETag',async()=>{let saved;const fake={BUCKET:{put:async(key,value,options)=>{saved={key,value,options};return{httpEtag:'"created"'}}}};const response=await worker.fetch(new Request('https://relay.example/api/history/smolov',{method:'PUT',headers:{Authorization:auth,'Content-Type':'application/json','If-None-Match':'*'},body:JSON.stringify({version:1,iv:'a'.repeat(16),ciphertext:'a'.repeat(100)})}),fake);assert.equal(response.status,200);assert.match(saved.key,/\/smolov\.json$/);assert.equal(saved.options.onlyIf.get('If-None-Match'),'*');assert.equal(response.headers.get('ETag'),'"created"')});
test('passes an exact update ETag to R2 and exposes conflict without writing',async()=>{let condition;const fake={BUCKET:{put:async(_key,_value,options)=>{condition=options.onlyIf.get('If-Match');return null}}};const response=await worker.fetch(new Request('https://relay.example/api/history/smolov',{method:'PUT',headers:{Authorization:auth,'Content-Type':'application/json','If-Match':'"stale"'},body:JSON.stringify({version:1,iv:'a'.repeat(16),ciphertext:'a'.repeat(100)})}),fake);assert.equal(response.status,412);assert.equal(condition,'"stale"')});
test('rejects wildcard update and contradictory preconditions',async()=>{for(const headers of [{'If-Match':'*'},{'If-Match':'"etag"','If-None-Match':'*'}]){const response=await worker.fetch(new Request('https://relay.example/api/history/smolov',{method:'PUT',headers:{Authorization:auth,'Content-Type':'application/json',...headers},body:'{}'}),env);assert.equal(response.status,428)}});
test('permits conditional headers only from the named allowed tracker origin',async()=>{const response=await worker.fetch(new Request('https://relay.example/api/history/smolov',{method:'OPTIONS',headers:{Origin:'https://smolov-sbd.micak27.chatgpt.site'}}),env);assert.equal(response.status,204);assert.ok(response.headers.get('Access-Control-Allow-Headers').includes('If-Match'));assert.equal((await worker.fetch(new Request('https://relay.example/api/history/smolov',{method:'OPTIONS',headers:{Origin:'https://different.chatgpt.site'}}),env)).status,403)});

const smolovPath='https://relay.example/api/history/smolov';
const envelope={version:1,iv:'a'.repeat(16),ciphertext:'a'.repeat(100)};
const storedEnvelope=JSON.stringify(envelope);
function readEnv(metadata={httpEtag:'"stored-version"'}){
 return {BUCKET:{get:async()=>({body:storedEnvelope,size:new TextEncoder().encode(storedEnvelope).length,uploaded:new Date('2026-10-19T12:00:00Z'),...metadata}),put:async()=>{throw Error('GET must not write');}}};
}
test('Smolov GET adds the exact R2 version to the old encrypted envelope and standard header',async()=>{
 const response=await worker.fetch(new Request(smolovPath,{headers:{Authorization:auth,Origin:origin}}),readEnv({httpEtag:'"actual-object-version"',etag:'different-raw-value'}));
 assert.equal(response.status,200);
 const body=await response.json();
 assert.deepEqual(body,{...envelope,snapshotEtag:'"actual-object-version"'});
 assert.equal(body.snapshotEtag,response.headers.get('ETag'));
 assert.equal(response.headers.get('Cache-Control'),'no-store');
 assert.ok(response.headers.get('Access-Control-Expose-Headers').includes('ETag'));
 assert.equal(response.headers.get('X-Synced-At'),'2026-10-19T12:00:00.000Z');
 assert.equal(storedEnvelope,JSON.stringify(envelope));
});
test('existing AES-GCM envelopes remain decryptable with additive snapshot metadata',async()=>{
 const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const additionalData=new TextEncoder().encode('smolov');
 const plaintext=new TextEncoder().encode(JSON.stringify({schema:1,source:'smolov',events:[]}));
 const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData},key,plaintext);
 const encoded={version:1,iv:Buffer.from(iv).toString('base64url'),ciphertext:Buffer.from(ciphertext).toString('base64url')};
 const original=JSON.stringify(encoded);
 const fake=readEnv();fake.BUCKET.get=async()=>({body:original,size:original.length,httpEtag:'"encrypted-version"',uploaded:new Date()});
 const response=await worker.fetch(new Request(smolovPath,{headers:{Authorization:auth}}),fake);
 const body=await response.json();
 const decrypted=await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(body.iv,'base64url'),additionalData},key,Buffer.from(body.ciphertext,'base64url'));
 assert.deepEqual(new Uint8Array(decrypted),plaintext);
 assert.equal(body.iv,encoded.iv);assert.equal(body.ciphertext,encoded.ciphertext);
});
test('Smolov GET safely quotes the actual raw R2 ETag only when httpEtag is absent',async()=>{
 for(const httpEtag of [undefined,null]){
  const response=await worker.fetch(new Request(smolovPath,{headers:{Authorization:auth}}),readEnv({httpEtag,etag:'abc123-2'}));
  assert.equal(response.status,200);assert.equal(response.headers.get('ETag'),'"abc123-2"');assert.equal((await response.json()).snapshotEtag,'"abc123-2"');
 }
});
test('unavailable or unsafe Smolov version metadata remains a recoverable read failure',async()=>{
 for(const metadata of [
  {httpEtag:undefined},{httpEtag:'undefined',etag:'valid-but-untrusted-fallback'},
  {httpEtag:'W/"weak"'},{httpEtag:'"bad\\tag"'},{httpEtag:'"bad\ntag"'},
  {httpEtag:undefined,etag:'"already-quoted"'},{httpEtag:undefined,etag:'bad tag'},
  {httpEtag:undefined,etag:'bad\\tag'},{httpEtag:undefined,etag:''},
 ]){
  const response=await worker.fetch(new Request(smolovPath,{headers:{Authorization:auth}}),readEnv(metadata));
  assert.equal(response.status,503,JSON.stringify(metadata));assert.equal(response.headers.get('ETag'),null);
  const body=await response.json();assert.match(body.error,/version.*unavailable/);assert.equal(body.snapshotEtag,undefined);
 }
});
test('Smolov GET bounds stored JSON and never serializes invalid stored envelopes',async()=>{
 for(const metadata of [{size:2_000_001},{body:'a'.repeat(2_000_001),size:1},{body:'{}',size:2}]){
  const response=await worker.fetch(new Request(smolovPath,{headers:{Authorization:auth}}),readEnv(metadata));
  assert.equal(response.status,503);assert.equal(response.headers.get('ETag'),null);assert.equal((await response.json()).snapshotEtag,undefined);
 }
});
test('Smolov GET still requires authentication before accessing stored ciphertext',async()=>{
 let reads=0;const fake={BUCKET:{get:async()=>{reads++;throw Error('Must not read');}}};
 const response=await worker.fetch(new Request(smolovPath),fake);assert.equal(response.status,401);assert.equal(reads,0);
});
test('legacy GET streams its original bytes without additive Smolov metadata',async()=>{
 for(const source of ['bulgarian','accessory','bodyweight']){
  const response=await worker.fetch(new Request(`https://relay.example/api/history/${source}`,{headers:{Authorization:auth}}),readEnv());
  assert.equal(response.status,200);assert.equal(await response.text(),storedEnvelope);assert.equal(response.headers.get('ETag'),'"stored-version"');
 }
});
test('Smolov stores only the original encryption envelope and uses its read version for atomic updates',async()=>{
 let stored=storedEnvelope;let version='"revision-1"';let writes=0;
 const fake={BUCKET:{get:async()=>({body:stored,size:stored.length,httpEtag:version,uploaded:new Date()}),put:async(_key,value,options)=>{
  assert.equal(options.onlyIf.get('If-Match'),'"revision-1"');
  if(options.onlyIf.get('If-Match')!==version)return null;
  writes++;stored=value;version='"revision-2"';return{httpEtag:version};
 }}};
 const before=await worker.fetch(new Request(smolovPath,{headers:{Authorization:auth}}),fake);const body=await before.json();
 const next={...envelope,ciphertext:'b'.repeat(100)};
 const update=()=>new Request(smolovPath,{method:'PUT',headers:{Authorization:auth,'Content-Type':'application/json','If-Match':body.snapshotEtag},body:JSON.stringify(next)});
 assert.equal((await worker.fetch(update(),fake)).status,200);assert.equal(writes,1);assert.equal(stored,JSON.stringify(next));
 assert.equal((await worker.fetch(update(),fake)).status,412);assert.equal(writes,1);
 const after=await worker.fetch(new Request(smolovPath,{headers:{Authorization:auth}}),fake);assert.deepEqual(await after.json(),{...next,snapshotEtag:version});
});
