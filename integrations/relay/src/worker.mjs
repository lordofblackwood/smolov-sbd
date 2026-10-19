const ALLOWED = new Set(['https://lordofblackwood.github.io','https://smolov-sbd.micak27.chatgpt.site','http://localhost:5198','http://localhost:4173','http://localhost:5173','http://127.0.0.1:4173','http://127.0.0.1:5173']);
const LIMIT = 2_000_000;
function reply(body,status,headers={}){return new Response(body===null?null:JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});}
function snapshotEtag(object){
 // Use the version returned with this object, never a hash of response JSON.
 if(object.httpEtag!==undefined&&object.httpEtag!==null)return typeof object.httpEtag==='string'&&/^"[\x21\x23-\x5b\x5d-\x7e]+"$/.test(object.httpEtag)?object.httpEtag:null;
 return typeof object.etag==='string'&&/^[\x21\x23-\x5b\x5d-\x7e]+$/.test(object.etag)?`"${object.etag}"`:null;
}
async function boundedEnvelope(object){
 if(Number.isFinite(object.size)&&object.size>LIMIT)throw Error('Stored history too large');
 const reader=new Response(object.body).body?.getReader();if(!reader)throw Error('Missing stored history');
 const chunks=[];let length=0;
 while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>LIMIT){await reader.cancel();throw Error('Stored history too large');}chunks.push(value);}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 const payload=JSON.parse(new TextDecoder().decode(bytes));
 if(payload?.version!==1||!/^[-\w]{16}$/.test(payload.iv)||typeof payload.ciphertext!=='string'||payload.ciphertext.length<22||!/^[-\w]+$/.test(payload.ciphertext)||Object.keys(payload).sort().join(',')!=='ciphertext,iv,version')throw Error('Invalid stored encrypted envelope');
 return payload;
}
export default {async fetch(request,env){
 const origin=request.headers.get('Origin');
 const cors=origin&&ALLOWED.has(origin)?{'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Allow-Methods':'GET, PUT, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type, If-Match, If-None-Match','Access-Control-Expose-Headers':'ETag, X-Synced-At','Access-Control-Max-Age':'600'}:{};
 const path=new URL(request.url).pathname;
 if(path==='/')return reply({service:'Powerlevel encrypted history relay',version:2,privacy:'History is encrypted on the device. A private connection code is required.',sources:['bulgarian','accessory','bodyweight','smolov'],contracts:{smolov:{contract:'smolov-v1',snapshotSchema:1,conditionalWrites:true,etagTransport:'snapshot-body',corrections:'session-revision-upsert',exerciseIds:['backSquat','benchPress','deadlift']}}},200,cors);
 if(origin&&!ALLOWED.has(origin))return reply({error:'Origin not allowed'},403);
 if(!/^\/api\/history\/(bulgarian|accessory|bodyweight|smolov)$/.test(path))return reply({error:'Not found'},404,cors);
 if(request.method==='OPTIONS')return reply(null,204,cors);
 if(!['GET','PUT'].includes(request.method))return reply({error:'Method not allowed'},405,cors);
 const token=request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
 if(!token)return reply({error:'Connection required'},401,cors);
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
 const room=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
 const source=path.split('/').at(-1);
 const key=`v1/${room}/${source}.json`;
 try{
  if(request.method==='GET'){
   const object=await env.BUCKET.get(key);if(!object)return reply({error:'Not connected'},404,cors);
   if(source==='smolov'){
    const etag=snapshotEtag(object);if(!etag)return reply({error:'Snapshot version is temporarily unavailable. Read again before syncing.'},503,cors);
    const payload=await boundedEnvelope(object);
    return reply({...payload,snapshotEtag:etag},200,{...cors,ETag:etag,'X-Synced-At':object.customMetadata?.updatedAt||object.uploaded.toISOString()});
   }
   return new Response(object.body,{headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','ETag':object.httpEtag,'X-Synced-At':object.customMetadata?.updatedAt||object.uploaded.toISOString()}});
  }
  // The new source requires atomic R2 preconditions; legacy writers retain their contract.
  const ifMatch=request.headers.get('If-Match');
  const ifNoneMatch=request.headers.get('If-None-Match');
  if(source==='smolov'&&((ifMatch&&ifNoneMatch)||(!ifMatch&&ifNoneMatch!=='*')||(ifMatch&&!/^"[^"\\]+"$/.test(ifMatch))))return reply({error:'Smolov writes require an exact If-Match ETag or If-None-Match: *'},428,cors);
  if(Number(request.headers.get('Content-Length'))>LIMIT)return reply({error:'History too large'},413,cors);
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))return reply({error:'JSON required'},415,cors);
  const reader=request.body?.getReader();if(!reader)return reply({error:'Body required'},400,cors);
  const chunks=[];let length=0;while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>LIMIT){await reader.cancel();return reply({error:'History too large'},413,cors);}chunks.push(value);}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let payload;try{payload=JSON.parse(new TextDecoder().decode(bytes));}catch{return reply({error:'Invalid JSON'},400,cors);}
  if(payload?.version!==1||!/^[-\w]{16}$/.test(payload.iv)||typeof payload.ciphertext!=='string'||payload.ciphertext.length<22||!/^[-\w]+$/.test(payload.ciphertext)||Object.keys(payload).sort().join(',')!=='ciphertext,iv,version')return reply({error:'Encrypted envelope required'},400,cors);
  const updatedAt=new Date().toISOString();
  const conditional=source==='smolov'?new Headers(ifMatch?{'If-Match':ifMatch}:{'If-None-Match':'*'}):undefined;
  const stored=await env.BUCKET.put(key,JSON.stringify(payload),{...(conditional?{onlyIf:conditional}:{}),httpMetadata:{contentType:'application/json'},customMetadata:{updatedAt}});
  if(source==='smolov'&&stored===null)return reply({error:'History changed. Read and reconcile before retrying.'},412,cors);
  return reply({ok:true,updatedAt},200,{...cors,...(stored?.httpEtag?{ETag:stored.httpEtag}:{})});
 }catch{return reply({error:'Sync temporarily unavailable'},503,cors);}
}};
