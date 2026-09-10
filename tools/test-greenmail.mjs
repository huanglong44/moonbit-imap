import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {ImapClient, encodeMailbox} from './client.mjs';

const jar = process.env.GREENMAIL_JAR;
if (!jar) throw Error('Set GREENMAIL_JAR to greenmail-standalone-2.1.13.jar');
const checksum = createHash('sha1').update(fs.readFileSync(jar)).digest('hex');
assert.equal(checksum, '6c84bc84e76784674d07b294dc4933619de35bba', 'GreenMail artifact checksum mismatch');
const helper = fileURLToPath(new URL('./ImapReference.java', import.meta.url));
const server = spawn(process.env.JAVA ?? 'java', ['-cp', path.resolve(jar), helper], {windowsHide: true, stdio:['pipe','pipe','pipe']});
let log = ''; server.stderr.on('data', chunk => { log = (log + chunk).slice(-10000); });
const results = [], clients = [], notRun = [];
try {
  const port = await new Promise((resolve, reject) => {
    let text = '';
    const timer = setTimeout(() => reject(Error('GreenMail startup timeout: ' + log)), 20000);
    server.once('error', error => { clearTimeout(timer); reject(error); });
    server.once('exit', code => { clearTimeout(timer); reject(Error('GreenMail ended: ' + code + ' ' + log)); });
    server.stdout.on('data', chunk => { text += chunk; const match = /READY (\d+)/.exec(text); if (match) { clearTimeout(timer); resolve(Number(match[1])); } });
  });
  const connect = async () => { const client = await ImapClient.connect({host:'127.0.0.1', port, secure:false, allowInsecureAuth:true, timeout:5000}); clients.push(client); return client; };
  const c = await connect();
  await c.login('demo','test-only'); assert.equal(c.state, 'Authenticated');
  results.push({name:'greeting LOGIN and post-auth CAPABILITY', passed:true, capabilities:c.capabilities});
  const mailbox = '审查'; await c.create(mailbox);
  const listed = await c.list(); assert.ok(listed.responses.some(r => r.line.includes(encodeMailbox(mailbox))));
  results.push({name:'modified UTF-7 CREATE and LIST',passed:true});
  const message = Buffer.from('From: sender@localhost\r\nTo: demo@localhost\r\nSubject: local review\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n中文正文\r\n');
  await c.append(mailbox, message, {flags:'\\Seen'});
  await c.select(mailbox); assert.equal(c.state,'Selected');
  const status = await c.status(mailbox); assert.ok(status.responses.some(r => /MESSAGES 1/.test(r.line)));
  results.push({name:'synchronizing APPEND SELECT and STATUS',passed:true});
  const search = await c.search('ALL',{uid:true});
  const line = search.responses.find(r => /^\* SEARCH/.test(r.line))?.line;
  const uid = /^\* SEARCH (\d+)/.exec(line ?? '')?.[1]; assert.ok(uid);
  const fetched = await c.fetch(uid, '(UID FLAGS RFC822.SIZE BODY.PEEK[])', {uid:true});
  const literal = fetched.responses.flatMap(r => r.literals)[0]; assert.ok(literal);
  assert.ok(literal.includes(Buffer.from('中文正文\r\n'))); assert.ok(literal.includes(Buffer.from('Subject: local review')));
  results.push({name:'UID SEARCH and body FETCH preserve UTF-8 literal bytes',passed:true,bodyBytes:literal.length});
  await c.store(uid,'\\Flagged',{uid:true});
  const flags = await c.fetch(uid,'(UID FLAGS)',{uid:true}); assert.ok(flags.responses.some(r=>r.line.includes('\\Flagged')));
  await c.copy(uid,'INBOX',{uid:true});
  results.push({name:'UID STORE and COPY accepted by independent server',passed:true});
  assert.ok(c.capabilities.includes('IDLE'));
  const idle = await c.idle({maxDuration:1000}); await idle.done();
  results.push({name:'IDLE continuation and DONE',passed:true});
  await c.store(uid,'\\Deleted',{uid:true}); await c.command('EXPUNGE');
  await c.command('CLOSE'); await c.rename(mailbox,'已审查'); await c.deleteMailbox('已审查');
  await c.logout();
  results.push({name:'EXPUNGE CLOSE RENAME DELETE and LOGOUT',passed:true});
  const auth = await connect(); await auth.capability();
  if (auth.capabilities.includes('AUTH=PLAIN')) {
    await auth.authenticatePlain('demo','test-only'); assert.equal(auth.state,'Authenticated');
    results.push({name:'AUTHENTICATE PLAIN challenge exchange',passed:true});
  } else {
    notRun.push({name:'AUTHENTICATE PLAIN against GreenMail',reason:'Server does not advertise AUTH=PLAIN',capabilities:auth.capabilities});
  }
  await auth.logout();
} catch (error) {
  results.push({name:'independent server workflow',passed:false,error:error.stack,serverLog:log});
} finally {
  for (const client of clients) client.close();
  const stopped = once(server,'exit');
  server.stdin.on('error',()=>{}); server.stdin.end('\n');
  if (server.exitCode === null && server.signalCode === null) {
    const timer = setTimeout(()=>server.kill(),5000);
    await stopped; clearTimeout(timer);
  }
}
const report = {timestamp:new Date().toISOString(),server:'GreenMail 2.1.13',artifactSha1:checksum,transport:'Loopback TCP; TLS tested separately against purpose-built fixture',results,notRun,passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length};
fs.writeFileSync(new URL('../evidence/greenmail-validation.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));process.exitCode=report.failed?1:0;
