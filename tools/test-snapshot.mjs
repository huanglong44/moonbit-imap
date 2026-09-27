import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {body,literal,peer} from './snapshot-test-peer.mjs';
import {readOnlySnapshot} from './snapshot.mjs';

// Hand-written wire peers exercise malformed/racing servers. Independent server
// interoperability is tested separately by examples/run-uid-snapshot.mjs.
const results=[];
async function test(name,run){try{await run();results.push({name,passed:true});}catch(e){results.push({name,passed:false,error:e.stack});}}
const reject=(client,code,options)=>assert.rejects(readOnlySnapshot(client,options),e=>e.code===code);
const hasBody=s=>s.commands.some(c=>c.includes('BODY.PEEK'));

await test('binary byte identity, reordered attributes, flags update and stable UID identities',async()=>{
  await peer((tag,c)=>c.includes('BODY.PEEK')?Buffer.concat([Buffer.from('* 9 FETCH (FLAGS (\\Seen))\r\n'),literal(tag,'42')]):undefined,async client=>{
    const r=await readOnlySnapshot(client,{expectedUidValidity:'77'});
    assert.deepEqual(r.messages[0].body,body);assert.deepEqual(r.uids,['42']);assert.equal(r.uidValidity,'77');
    assert.equal(r.messages[0].sha256,createHash('sha256').update(body).digest('hex'));assert.equal(r.atomic,false);assert.equal(r.readOnly,true);
  });
});
await test('empty mailbox and zero-byte message are distinct valid outcomes',async()=>{
  await peer((tag,c)=>c==='UID SEARCH ALL'?`* SEARCH\r\n${tag} OK search\r\n`:undefined,async client=>{
    const r=await readOnlySnapshot(client);assert.deepEqual(r.messages,[]);assert.equal(r.bytes,0);
  });
  await peer((tag,c)=>c==='UID FETCH 42 (UID RFC822.SIZE)'?`* 1 FETCH (UID 42 RFC822.SIZE 0)\r\n${tag} OK fetch\r\n`:c.includes('BODY.PEEK')?literal(tag,'42',Buffer.alloc(0)):undefined,async client=>{
    const r=await readOnlySnapshot(client);assert.equal(r.messages.length,1);assert.equal(r.messages[0].body.length,0);
  });
});
await test('missing/conflicting UIDVALIDITY and unconfirmed read-only selection fail before SEARCH',async()=>{
  for(const response of ['','* OK [UIDVALIDITY 77] valid\r\n* OK [UIDVALIDITY 78] conflict\r\n','* OK [UIDVALIDITY 0] invalid\r\n']){
    const s=await peer((tag,c)=>c.startsWith('EXAMINE')?`${response}${tag} OK [READ-ONLY] selected\r\n`:undefined,c=>reject(c,'SNAPSHOT_PROTOCOL'));
    assert.equal(s.searches,0);
  }
  await peer((tag,c)=>c.startsWith('EXAMINE')?`* OK [UIDVALIDITY 77] valid\r\n${tag} OK [READ-WRITE] selected\r\n`:undefined,c=>reject(c,'SNAPSHOT_PROTOCOL'));
});
await test('UIDVALIDITY precondition mismatch prevents reading; observed rollover rejects completed data',async()=>{
  const s=await peer(undefined,c=>reject(c,'SNAPSHOT_CHANGED',{expectedUidValidity:76}));assert.equal(s.searches,0);
  await peer((tag,c,s)=>c.startsWith('EXAMINE')&&s.selects===2?`* OK [UIDVALIDITY 78] changed\r\n${tag} OK [READ-ONLY] selected\r\n`:undefined,c=>reject(c,'SNAPSHOT_CHANGED'));
});
await test('ambiguous or invalid SEARCH results are rejected',async()=>{
  for(const rows of ['* SEARCH 42 42','* SEARCH 0','* SEARCH 4294967296','* SEARCH 42\r\n* SEARCH 43'])
    await peer((tag,c)=>c==='UID SEARCH ALL'?`${rows}\r\n${tag} OK search\r\n`:undefined,c=>reject(c,'SNAPSHOT_PROTOCOL'));
});
await test('ESEARCH ranges use MoonBit UID semantics and explicit expansion limits',async()=>{
  await peer((tag,c)=>c==='UID SEARCH ALL'?`* ESEARCH (TAG "${tag}") UID COUNT 1 ALL 42 MIN 42 MAX 42\r\n${tag} OK search\r\n`:undefined,async client=>{
    const r=await readOnlySnapshot(client);assert.deepEqual(r.uids,['42']);assert.deepEqual(r.messages[0].body,body);
  });
  const s=await peer((tag,c)=>c==='UID SEARCH ALL'?`* ESEARCH UID ALL 1:4294967295 COUNT 4294967295\r\n${tag} OK search\r\n`:undefined,c=>reject(c,'SNAPSHOT_LIMIT'));
  assert.equal(hasBody(s),false);
  await peer((tag,c)=>c==='UID SEARCH ALL'?`* ESEARCH (TAG "different") UID ALL 42\r\n${tag} OK search\r\n`:undefined,c=>reject(c,'SNAPSHOT_PROTOCOL'));
});
await test('message count and announced size limits stop before body download',async()=>{
  const a=await peer((tag,c)=>c==='UID SEARCH ALL'?`* SEARCH 42 43\r\n${tag} OK search\r\n`:undefined,c=>reject(c,'SNAPSHOT_LIMIT',{maxMessages:1}));assert.equal(hasBody(a),false);
  const b=await peer(undefined,c=>reject(c,'SNAPSHOT_LIMIT',{maxMessageBytes:5}));assert.equal(hasBody(b),false);
  const c=await peer((tag,c)=>c==='UID FETCH 42 (UID RFC822.SIZE)'?`* 1 FETCH (UID 42 RFC822.SIZE 1048577)\r\n${tag} OK fetch\r\n`:undefined,c=>reject(c,'SNAPSHOT_LIMIT'));assert.equal(hasBody(c),false);
});
await test('aggregate budget refuses the next body rather than returning a partial snapshot',async()=>{
  const s=await peer((tag,c)=>c==='UID SEARCH ALL'?`* SEARCH 43 42\r\n${tag} OK search\r\n`:c==='UID FETCH 43 (UID RFC822.SIZE)'?`* 2 FETCH (UID 43 RFC822.SIZE 6)\r\n${tag} OK fetch\r\n`:undefined,c=>reject(c,'SNAPSHOT_LIMIT',{maxBytes:10}));
  assert.equal(s.commands.filter(c=>c.includes('BODY.PEEK')).length,1);
});
await test('vanished UID, wrong UID body and duplicate FETCH identity never become successful output',async()=>{
  await peer((tag,c)=>c.includes('BODY.PEEK')?`${tag} OK vanished\r\n`:undefined,c=>reject(c,'SNAPSHOT_CHANGED'));
  await peer((tag,c)=>c.includes('BODY.PEEK')?literal(tag,'43'):undefined,c=>reject(c,'SNAPSHOT_CHANGED'));
  await peer((tag,c)=>c==='UID FETCH 42 (UID RFC822.SIZE)'?`* 1 FETCH (UID 42 UID 42 RFC822.SIZE 6)\r\n${tag} OK fetch\r\n`:undefined,c=>reject(c,'SNAPSHOT_PROTOCOL'));
  await peer((tag,c)=>c==='UID FETCH 42 (UID RFC822.SIZE)'?`* 1 FETCH (UID 42 RFC822.SIZE 6 RFC822.SIZE 6)\r\n${tag} OK fetch\r\n`:undefined,c=>reject(c,'SNAPSHOT_PROTOCOL'));
});
await test('literal/advertised size mismatch and unsupported FETCH profile fail closed',async()=>{
  await peer((tag,c)=>c.includes('BODY.PEEK')?literal(tag,'42',body,7):undefined,c=>reject(c,'SNAPSHOT_CHANGED'));
  await peer((tag,c)=>c.includes('BODY.PEEK')?literal(tag,'42',Buffer.from('x'),6):undefined,c=>reject(c,'SNAPSHOT_CHANGED'));
  await peer((tag,c)=>c==='UID FETCH 42 (UID RFC822.SIZE)'?`* 1 FETCH (UID 42 RFC822.SIZE 6 X-UNKNOWN 1)\r\n${tag} OK fetch\r\n`:undefined,c=>reject(c,'SNAPSHOT_PROTOCOL'));
  await peer((tag,c)=>c==='UID FETCH 42 (UID RFC822.SIZE)'?literal(tag,'42'):undefined,c=>reject(c,'SNAPSHOT_PROTOCOL'));
});
await test('observed additions and removals during read invalidate output',async()=>{
  for(const uids of ['','42 43'])await peer((tag,c,s)=>c==='UID SEARCH ALL'&&s.searches===2?`* SEARCH${uids?' '+uids:''}\r\n${tag} OK search\r\n`:undefined,c=>reject(c,'SNAPSHOT_CHANGED'));
});
await test('truncated body propagates transport failure without automatic retry',async()=>{
  const s=await peer((tag,c,s,socket)=>{if(c.includes('BODY.PEEK')){socket.end('* 1 FETCH (UID 42 RFC822.SIZE 6 BODY[] {6}\r\nA');return null;}},async c=>{await assert.rejects(readOnlySnapshot(c));assert.equal(c.state,'Closed');});
  assert.equal(s.commands.filter(c=>c.includes('BODY.PEEK')).length,1);
});
await test('invalid caps have no network side effects; simultaneous snapshot calls are refused',async()=>{
  await peer(undefined,async(c,s)=>{
    for(const options of [{maxMessages:0},{maxMessages:1001},{maxMessageBytes:1048577},{maxBytes:67108865},{maxBytes:NaN}])await assert.rejects(readOnlySnapshot(c,options),RangeError);
    assert.deepEqual(s.commands,[]);const first=readOnlySnapshot(c);await reject(c,'SNAPSHOT_BUSY');await first;
    assert.equal((await readOnlySnapshot(c)).messages.length,1);
  });
});
const report={kind:'scripted loopback TCP peers, not an independent server',passed:results.every(r=>r.passed),groups:results.length,results};
fs.mkdirSync('evidence/uid-snapshot-20260923',{recursive:true});
fs.writeFileSync(process.env.SNAPSHOT_EVIDENCE??'evidence/uid-snapshot-20260923/snapshot-negative.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
