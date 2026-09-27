#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {streamReadOnlySnapshot} from './snapshot.mjs';
import {ImapClient} from './client.mjs';

function writeExclusive(filename,content){
  const fd=fs.openSync(filename,'wx',0o600);
  try{fs.writeFileSync(fd,content);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}

/** Export a bounded, read-only mailbox into a NEW exclusively owned directory.
 * Only a successful final UID/UIDVALIDITY check publishes the Maildir. This is
 * process-level publication, not an atomic remote snapshot or crash durability.
 * The caller owns the authenticated client and must close it after an error. */
export async function archiveMailbox(client,output,{sourceId,...options}={}){
  if(typeof sourceId!=='string'||!sourceId.length||sourceId.length>2048)
    throw TypeError('sourceId must name the caller account/source (1..2048 characters)');
  // Never reuse an existing output, including an empty directory or symlink.
  fs.mkdirSync(output,{mode:0o700});
  const staging=path.join(output,'.maildir.partial');
  const published=path.join(output,'maildir');
  let delivered=0;
  try{
    fs.mkdirSync(staging,{mode:0o700});
    for(const name of ['tmp','new','cur'])fs.mkdirSync(path.join(staging,name),{mode:0o700});
    const result=await streamReadOnlySnapshot(client,(message,identity)=>{
      // Only checked decimal identities form paths; mailbox names never do.
      const key=`uid-${identity.uidValidity}-${message.uid}`;
      writeExclusive(path.join(staging,'new',key),message.body);
      delivered++;
    },options);
    const manifest={format:'imap-maildir-v1',complete:true,sourceId,
      mailbox:result.mailbox,uidValidity:result.uidValidity,
      bytes:result.bytes,delivered,readOnly:true,remoteSnapshotAtomic:false,
      observedUidSetStable:result.observedUidSetStable,
      flagsPreserved:false,publication:'hidden-until-complete',
      messages:result.messages.map(message=>({...message,
        file:`new/uid-${result.uidValidity}-${message.uid}`}))};
    writeExclusive(path.join(staging,'.imap-complete.json'),JSON.stringify(manifest,null,2)+'\n');
    // The parent directory is exclusively reserved above. Do not overwrite a
    // destination created in violation of that exclusive-ownership contract.
    try{fs.lstatSync(published);throw Error('published Maildir already exists');}
    catch(error){if(error.code!=='ENOENT')throw error;}
    fs.renameSync(staging,published);
    return manifest;
  }catch(error){
    try{writeExclusive(path.join(output,'incomplete.json'),JSON.stringify({
      complete:false,delivered,published:false,staging:'.maildir.partial',
      retry:'choose a new output directory',code:error.code??null,
      error:error.message??String(error)},null,2)+'\n');}catch{}
    throw error;
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  let client;
  try{
    const args=process.argv.slice(2);
    if(args.length!==4)throw Error('Usage: node tools/archive.mjs HOST USER MAILBOX NEW_OUTPUT_DIRECTORY (password: IMAP_ARCHIVE_PASSWORD; verified TLS port 993)');
    const [host,user,mailbox,output]=args;
    const password=process.env.IMAP_ARCHIVE_PASSWORD;
    if(!password)throw Error('IMAP_ARCHIVE_PASSWORD must be set');
    client=await ImapClient.connect({host});
    await client.login(user,password);
    const result=await archiveMailbox(client,output,{mailbox,sourceId:JSON.stringify({host,user,port:993})});
    // Logout failure cannot undo a successfully published archive.
    client.close();client=undefined;
    console.log(JSON.stringify(result));
  }catch(error){
    console.error(JSON.stringify({complete:false,code:error.code??null,error:error.message??String(error)}));
    process.exitCode=2;
  }finally{client?.close();}
}
