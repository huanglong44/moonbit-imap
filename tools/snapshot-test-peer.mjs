// Scripted TCP peer only; not independent interoperability evidence.
import assert from 'node:assert/strict';
import net from 'node:net';
import {ImapClient} from './client.mjs';
export const body=Buffer.from([65,0,255,13,10,66]);
export const literal=(tag,uid,bytes=body,size=bytes.length)=>Buffer.concat([
  Buffer.from(`* 1 FETCH (BODY[] {${bytes.length}}\r\n`),bytes,
  Buffer.from(` UID ${uid} RFC822.SIZE ${size})\r\n${tag} OK fetch\r\n`),
]);
export async function peer(overrides,run){
  const state={commands:[],errors:[],selects:0,searches:0},sockets=new Set();
  const server=net.createServer(socket=>{
    sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));
    socket.write('* PREAUTH [CAPABILITY IMAP4rev1] test peer\r\n');let buffer='';
    socket.on('data',chunk=>{
      buffer+=chunk.toString('ascii');let at;
      while((at=buffer.indexOf('\r\n'))>=0){
        const line=buffer.slice(0,at);buffer=buffer.slice(at+2);
        const space=line.indexOf(' '),tag=line.slice(0,space),command=line.slice(space+1);state.commands.push(command);
        try{
          if(command.startsWith('EXAMINE '))state.selects++;
          if(command==='UID SEARCH ALL')state.searches++;
          const custom=overrides?.(tag,command,state,socket);
          if(custom!==undefined){if(custom!==null)socket.write(custom);continue;}
          if(command.startsWith('EXAMINE '))socket.write(`* 1 EXISTS\r\n* OK [UIDVALIDITY 77] valid\r\n${tag} OK [READ-ONLY] examined\r\n`);
          else if(command==='UID SEARCH ALL')socket.write(`* SEARCH 42\r\n${tag} OK searched\r\n`);
          else if(command==='UID FETCH 42 (UID RFC822.SIZE)')socket.write(`* 1 FETCH (RFC822.SIZE ${body.length} UID 42)\r\n${tag} OK fetch\r\n`);
          else if(command==='UID FETCH 42 (UID RFC822.SIZE BODY.PEEK[])')socket.write(literal(tag,'42'));
          else throw Error('Unexpected or mutating command: '+command);
        }catch(e){state.errors.push(e.stack);socket.destroy();}
      }
    });
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  let client;
  try{client=await ImapClient.connect({host:'127.0.0.1',port:server.address().port,secure:false,timeout:1000});await run(client,state);}
  finally{client?.close();for(const s of sockets)s.destroy();await new Promise(resolve=>server.close(resolve));}
  assert.deepEqual(state.errors,[]);
  assert.ok(state.commands.every(c=>c.startsWith('EXAMINE ')||c==='UID SEARCH ALL'||/^UID FETCH [0-9]+ \(UID RFC822.SIZE(?: BODY.PEEK\[\])?\)$/.test(c)));
  return state;
}
