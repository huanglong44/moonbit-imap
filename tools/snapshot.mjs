import {createHash} from 'node:crypto';

export class SnapshotError extends Error {
  constructor(message,code='SNAPSHOT_PROTOCOL'){super(message);this.name='SnapshotError';this.code=code;}
}
const fail=(message,code)=>{throw new SnapshotError(message,code);};
const uint=text=>/^[1-9][0-9]*$/.test(text)&&BigInt(text)<=4294967295n?text:fail('invalid UID/UIDVALIDITY');
function selection(result){
  if(!/^\S+ OK \[READ-ONLY\](?: |$)/i.test(result.completion.line))fail('EXAMINE did not confirm READ-ONLY');
  const values=result.responses.map(r=>/^\* OK \[UIDVALIDITY ([0-9]+)\](?: |$)/i.exec(r.line)?.[1]).filter(Boolean);
  if(!values.length||new Set(values).size!==1)fail('missing or conflicting UIDVALIDITY');
  return uint(values[0]);
}
function uidSet(result){
  const rows=result.responses.filter(r=>/^\* SEARCH(?: |$)/i.test(r.line));
  if(rows.length!==1||rows[0].literals.length)fail('expected one ordinary UID SEARCH response');
  const text=rows[0].line.slice(8).trim(),uids=text?text.split(/ +/).map(uint):[];
  if(new Set(uids).size!==uids.length)fail('duplicate UID in SEARCH');
  return uids.sort((a,b)=>Number(a)-Number(b));
}
// Deliberately bounded FETCH profile for commands issued here. General callers
// still receive raw response lines/literals from ImapClient; this is not a full
// typed FETCH/BODYSTRUCTURE parser. Unknown attributes fail rather than misbind.
function fetchRecord(response){
  const frame=/^\* [1-9][0-9]* FETCH \(([\s\S]*)\)$/i.exec(response.line);
  if(!frame)return undefined;
  let input=frame[1],uid,size,body,seenBody=false;
  while(input.trim()){
    input=input.trimStart();let m;
    if(m=/^UID ([0-9]+)(?=\s|$)/i.exec(input)){if(uid!==undefined)fail('duplicate FETCH UID');uid=uint(m[1]);}
    else if(m=/^RFC822\.SIZE ([0-9]+)(?=\s|$)/i.exec(input)){if(size!==undefined)fail('duplicate FETCH size');size=Number(m[1]);if(!Number.isSafeInteger(size))fail('invalid message size');}
    else if(m=/^BODY\[\] \{([0-9]+)\}\n/i.exec(input)){if(seenBody||response.literals.length!==1)fail('ambiguous body literal');seenBody=true;body=response.literals[0];if(body.length!==Number(m[1]))fail('literal size mismatch');}
    else if(m=/^FLAGS \([^()\r\n]*\)(?=\s|$)/i.exec(input)){} // unsolicited flag updates may accompany FETCH
    else fail('unsupported FETCH attribute in snapshot profile');
    input=input.slice(m[0].length);
  }
  if(response.literals.length&&!seenBody)fail('unassociated literal');
  return {uid,size,body};
}
function requestedFetch(result,uid,withBody){
  const records=result.responses.map(fetchRecord).filter(Boolean);
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
