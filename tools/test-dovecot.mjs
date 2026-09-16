import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import net from 'node:net';
import * as api from './client.mjs';

const pop = !!api.Pop3Client, Client = api.Pop3Client ?? api.ImapClient;
const results = [], clients = [], extractedRoot = process.env.DOVECOT_ROOT;
const helper = fileURLToPath(new URL('./dovecot-reference.py', import.meta.url));
let command = process.env.PYTHON ?? 'python3', args = [helper, ...(extractedRoot ? [extractedRoot] : [])];
if (process.platform === 'win32') {
  const distro = process.env.WSL_DISTRO ?? 'Ubuntu-D';
  const converted = spawnSync('wsl.exe', ['-d',distro,'--exec','wslpath','-u',helper.replaceAll('\\','/')], {encoding:'utf8',windowsHide:true});
  assert.equal(converted.status,0,'Cannot map test harness into WSL');
  command = 'wsl.exe';
  args = ['-d',distro,...(extractedRoot ? ['-u','root'] : []),'--exec','python3',converted.stdout.trim(),...(extractedRoot ? [extractedRoot] : [])];
}
const server = spawn(command,args,{windowsHide:true,stdio:['pipe','pipe','pipe']});
let log = '', metadata;
server.stderr.on('data',chunk=>{log=(log+chunk.toString()).slice(-18000);});
server.stdin.on('error',()=>{});
async function test(name, run) { await run(); results.push({name,passed:true}); }
async function quit(c) { return pop ? c.quit() : c.logout(); }
try {
  metadata = await new Promise((resolve,reject)=>{
    let output=''; const timer=setTimeout(()=>reject(Error('Dovecot startup timeout: '+log)),20000);
    server.once('error',error=>{clearTimeout(timer);reject(error);});
    server.once('exit',code=>{clearTimeout(timer);reject(Error('Dovecot exited '+code+': '+log));});
    server.stdout.on('data',chunk=>{
      output+=chunk;
      const line=output.split('\n').find(line=>line.startsWith('READY '));
      if(line){clearTimeout(timer);resolve(JSON.parse(line.slice(6)));}
    });
  });
  const options={host:'127.0.0.1',port:pop?metadata.pop3:metadata.imap,secure:false,timeout:8000,tls:{ca:Buffer.from(metadata.certificate,'base64'),servername:'localhost'}};
  // WSL's localhost forwarding can become ready after the Linux listener does.
  const readinessDeadline=Date.now()+8000;
  for(;;){
    try{await new Promise((resolve,reject)=>{const s=net.connect({host:options.host,port:options.port});s.setTimeout(500,()=>s.destroy(Error('Listener readiness timeout')));s.once('connect',()=>{s.destroy();resolve();});s.once('error',reject);});break;}
    catch(error){if(Date.now()>=readinessDeadline)throw error;await new Promise(resolve=>setTimeout(resolve,100));}
  }
  const connect=async (extra={})=>{const c=await Client.connect({...options,...extra});clients.push(c);return c;};
  const first=await connect();
  await test('independent greeting advertises TLS upgrade',async()=>{
    const caps=pop?await first.capabilities():await first.capability();
    assert.ok(pop?caps.has('STLS'):caps.includes('STARTTLS'));
  });
  await test('verified TLS upgrade refreshes capabilities',async()=>{
    const caps=await first.startTls(); assert.equal(first.secure,true);
    assert.ok(pop?!caps.has('STLS'):!caps.includes('STARTTLS'));
    assert.ok(pop?(caps.get('SASL')??[]).includes('PLAIN'):caps.includes('AUTH=PLAIN'));
  });
  await test('PLAIN authenticates against Dovecot',async()=>{await first.authenticatePlain('demo','test-only');});
  if(pop){
    let uid;
    await test('STAT LIST UIDL and RETR preserve independent mailbox contents',async()=>{
      assert.match((await first.command('STAT')).message,/^1 \d+/);
      assert.match((await first.command('LIST')).body.toString(),/^1 \d+\r\n$/);
      uid=(await first.command('UIDL')).body.toString();assert.match(uid,/^1 \S+\r\n$/);
      const body=(await first.command('RETR',{index:1})).body;
      assert.ok(body.includes(Buffer.from('Independent Dovecot body\r\n.dot-stuffed line\r\n')));
    });
    await test('negative RETR preserves a usable session',async()=>{
      assert.equal((await first.command('RETR',{index:999})).ok,false);assert.equal((await first.command('NOOP')).ok,true);
    });
    await test('DELE followed by RSET restores message',async()=>{
      assert.equal((await first.command('DELE',{index:1})).ok,true);
      assert.match((await first.command('STAT')).message,/^0 /);
      assert.equal((await first.command('RSET')).ok,true);assert.match((await first.command('STAT')).message,/^1 /);await first.quit();
    });
    await test('required upgrade and USER PASS support reconnect with stable UIDL',async()=>{
      const c=await connect({startTls:true});await c.login('demo','test-only');assert.equal((await c.command('UIDL')).body.toString(),uid);await c.quit();
    });
    await test('QUIT commits deletion to independent mailbox',async()=>{
      const c=await connect({startTls:true});await c.authenticatePlain('demo','test-only');await c.command('DELE',{index:1});await c.quit();
      const next=await connect({startTls:true});await next.login('demo','test-only');assert.match((await next.command('STAT')).message,/^0 /);await next.quit();
    });
  }else{
    await test('SELECT and FETCH preserve independent message bytes',async()=>{
      await first.select();const fetched=await first.fetch('1','(UID FLAGS BODY.PEEK[])');
      assert.ok(fetched.responses.flatMap(r=>r.literals).some(b=>b.includes(Buffer.from('Independent Dovecot body'))));
    });
    await test('CREATE APPEND SEARCH COPY and STATUS round trip',async()=>{
      const box='独立验证';await first.create(box);
      const bytes=Buffer.from('From: local@example.test\r\nSubject: TLS round trip\r\n\r\n中文正文\r\n');
      await first.append(box,bytes);await first.select(box);const search=await first.search();assert.ok(search.responses.some(r=>r.line==='* SEARCH 1'));
      const fetched=await first.fetch('1','(BODY.PEEK[])');assert.ok(fetched.responses.flatMap(r=>r.literals).some(b=>b.equals(bytes)));
      await first.copy('1','INBOX');assert.ok((await first.status('INBOX')).responses.some(r=>r.line.includes('MESSAGES 2')));
    });
    await test('IDLE DONE STORE EXPUNGE CLOSE and DELETE',async()=>{
      const idle=await first.idle({maxDuration:1000});await idle.done();await first.store('1','\\Deleted');await first.command('EXPUNGE');
      await first.command('CLOSE');await first.deleteMailbox('独立验证');await first.logout();
    });
    await test('required upgrade and LOGIN support reconnect',async()=>{
      const c=await connect({startTls:true});await c.login('demo','test-only');await c.select();await c.logout();
    });
  }
  await test('wrong password is rejected and explicit retry succeeds',async()=>{
    const c=await connect({startTls:true});await assert.rejects(c.authenticatePlain('demo','wrong-password'));await c.authenticatePlain('demo','test-only');await quit(c);
  });
  await test('independent certificate fails without explicit trust',async()=>{
    await assert.rejects(connect({startTls:true,tls:{servername:'localhost'}}),/certificate|self.signed/i);
  });
}catch(error){results.push({name:'independent Dovecot workflow',passed:false,error:error.stack,serverLog:log});}
finally{
  for(const c of clients)c.close();
  if(server.exitCode===null&&server.signalCode===null){
    const stopped=new Promise(resolve=>server.once('exit',resolve));server.stdin.end('\n');
    const timer=setTimeout(()=>server.kill(),8000);await stopped;clearTimeout(timer);
  }
}
const sha256=file=>createHash('sha256').update(fs.readFileSync(new URL(file,import.meta.url))).digest('hex');
const report={timestamp:new Date().toISOString(),protocol:pop?'POP3':'IMAP',server:metadata?.version??'Dovecot 2.4',environment:process.platform==='win32'?'Windows Node client to isolated WSL Linux Dovecot':'Local Linux Dovecot',node:process.version,transport:'TCP upgraded to verified TLS; loopback only',packages:metadata?.packages??{},results,passed:results.filter(x=>x.passed).length,failed:results.filter(x=>!x.passed).length,sourceSha256:{client:sha256('./client.mjs'),engine:sha256('../web/engine.mjs'),harness:sha256('./dovecot-reference.py')}};
fs.writeFileSync(new URL('../evidence/dovecot-validation.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));process.exitCode=report.failed?1:0;
