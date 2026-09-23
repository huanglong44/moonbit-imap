import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ImapClient} from '../tools/client.mjs';
import {readOnlySnapshot} from '../tools/snapshot.mjs';
import {withGreenMail} from '../tools/greenmail-harness.mjs';

await withGreenMail(async options=>{
  let setup,reader;
  try{
    setup=await ImapClient.connect(options);await setup.login('demo','test-only');
    const mailbox='只读导出';await setup.create(mailbox);
    const originals=[1,2].map(n=>Buffer.from(`From: local@example.test\r\nTo: demo@localhost\r\nSubject: snapshot-${n}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n中文正文 ${n}\r\n`));
    for(const body of originals)await setup.append(mailbox,body);
    await setup.logout();setup=undefined;
    reader=await ImapClient.connect(options);await reader.login('demo','test-only');
    const snapshot=await readOnlySnapshot(reader,{mailbox,maxMessages:10,maxBytes:4096});
    assert.equal(snapshot.messages.length,2);
    for(let i=0;i<originals.length;i++)assert.deepEqual(snapshot.messages[i].body,originals[i]);
    const unseen=await reader.search('UNSEEN',{uid:true});
    assert.equal(unseen.responses.find(r=>r.line.startsWith('* SEARCH'))?.line,'* SEARCH '+snapshot.uids.join(' '));
    const repeated=await readOnlySnapshot(reader,{mailbox,expectedUidValidity:snapshot.uidValidity,maxBytes:4096});
    assert.deepEqual(repeated.messages.map(m=>m.sha256),snapshot.messages.map(m=>m.sha256));
    await reader.logout();reader=undefined;
    const output=await fs.mkdtemp(path.join(os.tmpdir(),'imap-uid-snapshot-'));
    for(const message of snapshot.messages)await fs.writeFile(path.join(output,`${message.uid}.eml`),message.body,{flag:'wx'});
    const manifest={server:options.server,artifactSha1:options.artifactSha1,artifactSha256:options.artifactSha256,transport:'loopback TCP; test-only credentials',mailbox,uidValidity:snapshot.uidValidity,readOnly:true,atomic:false,bodyPeekPreservedUnseen:true,repeatedReadMatches:true,bytes:snapshot.bytes,messages:snapshot.messages.map(({body,...m})=>({...m,file:`${m.uid}.eml`}))};
    await fs.writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify({output,...manifest}));
  }finally{setup?.close();reader?.close();}
});
