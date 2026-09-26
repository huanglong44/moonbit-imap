import {createHash} from 'node:crypto';
import {projectResult} from './typed-result.mjs';

export class SnapshotError extends Error {
  constructor(message,code='SNAPSHOT_PROTOCOL'){super(message);this.name='SnapshotError';this.code=code;}
}
const fail=(message,code)=>{throw new SnapshotError(message,code);};
const uint=text=>/^[1-9][0-9]*$/.test(text)&&BigInt(text)<=4294967295n?text:fail('invalid UID/UIDVALIDITY');
function project(result,kind){
  try{return projectResult(result,kind);}catch(error){fail(error.message);}
}
function selection(result){return project(result,'selection').uidValidity;}
function uidSet(result){
  const search=project(result,'search');
  if(search.uids===null)fail('UID set exceeds snapshot message limit','SNAPSHOT_LIMIT');
  return search.uids;
}
// MoonBit owns syntax, UID ranges, BODY[] association and final-OK gating.
// This host profile continues to reject unknown attributes rather than claiming
// general synchronization, and performs file/workflow limits on typed values.
function fetchRecords(result){
  return project(result,'fetch').map(record=>{
    if(record.unknownAttributes.length)fail('unsupported FETCH attribute in snapshot profile');
    const size=record.size===null?undefined:Number(record.size);
    if(size!==undefined&&!Number.isSafeInteger(size))fail('message size exceeds host integer range');
    return {uid:record.uid??undefined,size,
      body:record.bodyState==='bytes'?Buffer.from(record.bodyHex,'hex'):undefined};
  });
}
function requestedFetch(result,uid,withBody){
  const records=fetchRecords(result);
  if(!withBody&&records.some(r=>r.body!==undefined))fail('unsolicited body during size preflight');
  const target=records.filter(r=>r.uid===uid&&r.size!==undefined&&(withBody?r.body!==undefined:true));
  if(target.length!==1)fail('requested UID disappeared or reply is ambiguous','SNAPSHOT_CHANGED');
  if(records.some(r=>r.body!==undefined&&r.uid!==uid))fail('unexpected UID body');
  return target[0];
}
const active=new WeakSet();
/** Bounded read-only export for an authenticated, exclusively owned client.
 * UID-set/UIDVALIDITY checks detect observed races; IMAP does not give this helper
 * an atomic mailbox snapshot. No STORE, EXPUNGE, APPEND or automatic retry. */
export async function readOnlySnapshot(client,{mailbox='INBOX',expectedUidValidity,maxMessages=100,maxMessageBytes=1048576,maxBytes=16777216}={}){
  for(const [name,value,max] of [['maxMessages',maxMessages,1000],['maxMessageBytes',maxMessageBytes,1048576],['maxBytes',maxBytes,67108864]])if(!Number.isSafeInteger(value)||value<1||value>max)throw RangeError(`${name} out of range`);
  if(expectedUidValidity!==undefined)expectedUidValidity=uint(String(expectedUidValidity));
  if(typeof mailbox!=='string'||!mailbox.length)throw TypeError('mailbox must be nonempty');
  if(active.has(client))fail('snapshot already active','SNAPSHOT_BUSY');active.add(client);
  try{
    const uidValidity=selection(await client.select(mailbox,{readOnly:true}));
    if(expectedUidValidity!==undefined&&uidValidity!==expectedUidValidity)fail('UIDVALIDITY changed; previous UID identities are invalid','SNAPSHOT_CHANGED');
    const uids=uidSet(await client.search('ALL',{uid:true}));
    if(uids.length>maxMessages)fail('message count exceeds limit','SNAPSHOT_LIMIT');
    const messages=[];let bytes=0;
    for(const uid of uids){
      const metadata=requestedFetch(await client.fetch(uid,'(UID RFC822.SIZE)',{uid:true}),uid,false);
      if(metadata.size>maxMessageBytes||bytes+metadata.size>maxBytes)fail('message/aggregate size exceeds limit','SNAPSHOT_LIMIT');
      const item=requestedFetch(await client.fetch(uid,'(UID RFC822.SIZE BODY.PEEK[])',{uid:true}),uid,true);
      if(item.size!==metadata.size||item.body.length!==metadata.size)fail('message size changed or disagrees with literal','SNAPSHOT_CHANGED');
      bytes+=item.body.length;
      messages.push({uid,size:item.body.length,sha256:createHash('sha256').update(item.body).digest('hex'),body:item.body});
    }
    const finalUids=uidSet(await client.search('ALL',{uid:true}));
    if(JSON.stringify(uids)!==JSON.stringify(finalUids))fail('UID set changed during read','SNAPSHOT_CHANGED');
    if(selection(await client.select(mailbox,{readOnly:true}))!==uidValidity)fail('UIDVALIDITY changed during read','SNAPSHOT_CHANGED');
    return {mailbox,uidValidity,uids,bytes,messages,readOnly:true,atomic:false,observedUidSetStable:true};
  }finally{active.delete(client);}
}
