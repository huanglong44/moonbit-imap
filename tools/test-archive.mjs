import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {body,literal,peer} from './snapshot-test-peer.mjs';
import {streamReadOnlySnapshot} from './snapshot.mjs';
import {archiveMailbox as archive} from './archive.mjs';
const archiveMailbox=(client,output,options={})=>archive(client,output,{sourceId:'scripted-peer/test-only',...options});

const root=fs.mkdtempSync(path.join(os.tmpdir(),'imap-archive-'));
const results=[];
async function test(name,run){
  try{await run();results.push({name,passed:true});}
  catch(error){results.push({name,passed:false,error:error.stack});}
}
const filename=name=>path.join(root,name);
function incomplete(output,delivered){
  assert.equal(fs.existsSync(path.join(output,'maildir')),false);
  const report=JSON.parse(fs.readFileSync(path.join(output,'incomplete.json'),'utf8'));
  assert.equal(report.complete,false);assert.equal(report.published,false);
  assert.equal(report.delivered,delivered);
}

await test('stream awaits the sink and returns metadata without retaining bodies',async()=>{
  await peer(undefined,async(client,state)=>{
    let release,entered;
    const sinkEntered=new Promise(resolve=>{entered=resolve;});
    const sinkReady=new Promise(resolve=>{release=resolve;});
    const pending=streamReadOnlySnapshot(client,async(message,identity)=>{
      assert.deepEqual(message.body,body);assert.equal(identity.uidValidity,'77');
      entered();await sinkReady;
    });
    await sinkEntered;
    assert.equal(state.searches,1);assert.equal(state.selects,1);
    release();const result=await pending;
    assert.equal(Object.hasOwn(result.messages[0],'body'),false);
    assert.equal(state.searches,2);assert.equal(state.selects,2);
  });
});
await test('binary archive is hidden during final checks and published with a receipt',async()=>{
  const output=filename('success');
  await peer((tag,command,state)=>{
    if(command==='UID SEARCH ALL'&&state.searches===2){
      assert.equal(fs.existsSync(path.join(output,'maildir')),false);
      assert.deepEqual(fs.readFileSync(path.join(output,'.maildir.partial/new/uid-77-42')),body);
    }
  },async client=>{
    const result=await archiveMailbox(client,output,{mailbox:'../../not-a-path'});
    assert.equal(result.complete,true);assert.equal(result.remoteSnapshotAtomic,false);
    assert.equal(result.mailbox,'../../not-a-path');assert.equal(result.flagsPreserved,false);
    assert.deepEqual(fs.readFileSync(path.join(output,'maildir/new/uid-77-42')),body);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(output,'maildir/.imap-complete.json'),'utf8')),result);
    assert.equal(fs.existsSync(path.join(output,'.maildir.partial')),false);
    assert.equal(fs.existsSync(path.join(output,'incomplete.json')),false);
  });
});
await test('empty mailbox publishes a valid empty Maildir',async()=>{
  const output=filename('empty');
  await peer((tag,c)=>c==='UID SEARCH ALL'?`* SEARCH\r\n${tag} OK empty\r\n`:undefined,async client=>{
    const result=await archiveMailbox(client,output);assert.equal(result.delivered,0);
    assert.deepEqual(fs.readdirSync(path.join(output,'maildir/new')),[]);
  });
});
await test('UID additions, removals and rollover preserve only an incomplete archive',async()=>{
  for(const mode of ['addition','removal','rollover']){
    const output=filename(mode);
    await peer((tag,c,s)=>{
      if(c==='UID SEARCH ALL'&&s.searches===2&&mode!=='rollover')return `* SEARCH${mode==='addition'?' 42 43':''}\r\n${tag} OK changed\r\n`;
      if(c.startsWith('EXAMINE')&&s.selects===2&&mode==='rollover')return `* OK [UIDVALIDITY 78] changed\r\n${tag} OK [READ-ONLY] selected\r\n`;
    },async client=>{
      await assert.rejects(archiveMailbox(client,output),e=>e.code==='SNAPSHOT_CHANGED');
      incomplete(output,1);
      assert.deepEqual(fs.readFileSync(path.join(output,'.maildir.partial/new/uid-77-42')),body);
    });
  }
});
await test('sink I/O failure aborts and cannot publish or overwrite existing content',async()=>{
  const output=filename('io-failure');
  await peer((tag,c)=>{
    if(c.includes('BODY.PEEK')){
      fs.mkdirSync(path.join(output,'.maildir.partial/new/uid-77-42'));
      return literal(tag,'42');
    }
  },async(client,state)=>{
    await assert.rejects(archiveMailbox(client,output),e=>e.code==='EEXIST');
    incomplete(output,0);assert.equal(state.searches,1);
  });
  await peer(undefined,async(client,state)=>{
    await assert.rejects(archive(client,filename('missing-source')),/sourceId/);
    assert.equal(fs.existsSync(filename('missing-source')),false);
    await assert.rejects(archiveMailbox(client,output),e=>e.code==='EEXIST');
    assert.deepEqual(state.commands,[]);
  });
});
await test('publication conflict and announced byte budget cannot produce a false success',async()=>{
  const conflict=filename('conflict');
  await peer((tag,c,s)=>{
    if(c.startsWith('EXAMINE')&&s.selects===2){
      fs.mkdirSync(path.join(conflict,'maildir'));fs.writeFileSync(path.join(conflict,'maildir/owned'),'keep');
    }
  },async client=>{
    await assert.rejects(archiveMailbox(client,conflict),/already exists/);
    assert.equal(fs.readFileSync(path.join(conflict,'maildir/owned'),'utf8'),'keep');
    assert.equal(fs.existsSync(path.join(conflict,'maildir/.imap-complete.json')),false);
  });
  const budget=filename('budget');
  await peer(undefined,async(client,state)=>{
    await assert.rejects(archiveMailbox(client,budget,{maxBytes:5}),e=>e.code==='SNAPSHOT_LIMIT');
    incomplete(budget,0);assert.equal(state.commands.some(c=>c.includes('BODY.PEEK')),false);
  });
});
const report={kind:'scripted loopback TCP peers and real local filesystem; not independent server',
  passed:results.every(r=>r.passed),groups:results.length,output:root,results};
if(process.env.ARCHIVE_EVIDENCE)fs.writeFileSync(process.env.ARCHIVE_EVIDENCE,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
