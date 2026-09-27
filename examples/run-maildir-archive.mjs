import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {ImapClient} from '../tools/client.mjs';
import {archiveMailbox} from '../tools/archive.mjs';
import {withGreenMail} from '../tools/greenmail-harness.mjs';

await withGreenMail(async options=>{
  let setup,reader;
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'imap-maildir-independent-'));
  try{
    setup=await ImapClient.connect(options);await setup.login('demo','test-only');
    const mailbox='归档示例';await setup.create(mailbox);
    const originals=[
      Buffer.from('From: local@example.test\r\nTo: demo@localhost\r\nSubject: archive-text\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n中文正文\r\n'),
      Buffer.concat([Buffer.from('From: local@example.test\r\nTo: demo@localhost\r\nSubject: archive-bytes\r\nContent-Type: application/octet-stream\r\nContent-Transfer-Encoding: binary\r\n\r\n'),Buffer.from([0,255,65,13,10])])
    ];
    for(const body of originals)await setup.append(mailbox,body);
    await setup.logout();setup=undefined;
    reader=await ImapClient.connect(options);await reader.login('demo','test-only');
    const output=path.join(root,'archive');
    const receipt=await archiveMailbox(reader,output,{sourceId:'loopback GreenMail/demo (synthetic)',mailbox,maxMessages:10,maxBytes:4096});
    assert.equal(receipt.delivered,originals.length);
    for(let i=0;i<originals.length;i++){
      const message=receipt.messages[i];
      assert.deepEqual(fs.readFileSync(path.join(output,'maildir',message.file)),originals[i]);
      assert.equal(message.sha256,createHash('sha256').update(originals[i]).digest('hex'));
    }
    const unseen=await reader.search('UNSEEN',{uid:true});
    assert.equal(unseen.responses.find(r=>r.line.startsWith('* SEARCH'))?.line,'* SEARCH '+receipt.messages.map(m=>m.uid).join(' '));
    // An independently maintained standard library reads the published Maildir.
    // Reading get_file avoids get_bytes' newline conversion and preserves CRLF.
    const py=spawnSync(process.env.PYTHON??'python',['-c',
      'import mailbox,json,hashlib,sys\np=sys.argv[1]\nr=json.load(open(p+"/.imap-complete.json",encoding="utf-8"))\nm=mailbox.Maildir(p,create=False)\nassert len(m)==r["delivered"]\nfor x in r["messages"]:\n f=m.get_file(x["file"].split("/")[-1])\n with f: b=f.read()\n assert len(b)==x["size"]\n assert hashlib.sha256(b).hexdigest()==x["sha256"]\nprint(json.dumps({"python":sys.version.split()[0],"maildirMessages":len(m),"bytesPreserved":True}))',
      path.join(output,'maildir')],{encoding:'utf8',windowsHide:true,timeout:15000});
    assert.equal(py.status,0,py.stderr);const independentReader=JSON.parse(py.stdout);
    await reader.logout();reader=undefined;
    const report={passed:true,source:'two original synthetic messages, not a customer mailbox',
      server:options.server,serverSha256:options.artifactSha256,
      transport:'loopback TCP test account',output,bodyPeekPreservedUnseen:true,
      independentReader,receipt};
    fs.writeFileSync(path.join(root,'verification.json'),JSON.stringify(report,null,2)+'\n');
    if(process.env.ARCHIVE_REFERENCE_EVIDENCE)fs.writeFileSync(process.env.ARCHIVE_REFERENCE_EVIDENCE,JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report,null,2));
  }finally{setup?.close();reader?.close();}
});
