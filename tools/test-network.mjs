import net from 'node:net';
import tls from 'node:tls';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {ImapClient, ImapCommandError, encodeMailbox, decodeMailbox} from './client.mjs';

const results = [];
async function test(name, run) { try { await run(); results.push({name, passed: true}); } catch (e) { results.push({name, passed: false, error: e.stack}); } }
async function serve(handler, run, tlsOptions) {
  const sockets = new Set();
  const server = tlsOptions ? tls.createServer(tlsOptions, handler) : net.createServer(handler);
  server.on('connection', socket => { sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket)); });
  server.on('tlsClientError', () => {});
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try { await run({host: '127.0.0.1', port: server.address().port, secure: !!tlsOptions, timeout: 1500}); }
  finally { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); }
}

function mailboxServer(state, {preauth = false} = {}) {
  return socket => {
    state.connections = (state.connections ?? 0) + 1;
    socket.write(`* ${preauth ? 'PREAUTH' : 'OK'} [CAPABILITY IMAP4rev1 AUTH=PLAIN IDLE MOVE] fixture\r\n`);
    let buffer = Buffer.alloc(0), literal, auth, idle;
    socket.on('data', chunk => {
      try {
        buffer = Buffer.concat([buffer, chunk]);
        while (true) {
          if (literal) {
            if (buffer.length < literal.size + 2) break;
            assert.equal(buffer.subarray(literal.size, literal.size + 2).toString(), '\r\n');
            state.appended = Buffer.from(buffer.subarray(0, literal.size)); buffer = buffer.subarray(literal.size + 2);
            socket.write(`${literal.tag} OK [APPENDUID 1 42] appended\r\n`); literal = undefined; continue;
          }
          const at = buffer.indexOf('\r\n'); if (at < 0) break;
          const line = buffer.subarray(0, at).toString('ascii'); buffer = buffer.subarray(at + 2);
          state.commands.push(line);
          if (auth) {
            assert.equal(Buffer.from(line, 'base64').toString(), '\0demo\0test-only');
            socket.write(`${auth} OK authenticated\r\n`); auth = undefined; continue;
          }
          if (idle) { assert.equal(line, 'DONE'); socket.write(`${idle} OK idle finished\r\n`); idle = undefined; continue; }
          const space = line.indexOf(' '), tag = line.slice(0, space), command = line.slice(space + 1);
          if (command.startsWith('APPEND ')) {
            const size = /\{(\d+)\}$/.exec(command); assert.ok(size);
            literal = {tag, size: Number(size[1])}; socket.write('+ send literal\r\n');
          } else if (command === 'AUTHENTICATE PLAIN') { auth = tag; socket.write('+ \r\n'); }
          else if (command === 'CAPABILITY') socket.write(`* CAPABILITY IMAP4rev1 AUTH=PLAIN IDLE MOVE\r\n${tag} OK capability\r\n`);
          else if (command.startsWith('LOGIN ')) socket.write(`${tag} OK authenticated\r\n`);
          else if (command.startsWith('SELECT ') || command.startsWith('EXAMINE ')) {
            socket.write(command.includes('missing') ? `${tag} NO missing mailbox\r\n` : `* 1 EXISTS\r\n* OK [UIDVALIDITY 1] valid\r\n${tag} OK [READ-WRITE] selected\r\n`);
          } else if (command.startsWith('UID FETCH ') || command.startsWith('FETCH ')) {
            const body = state.appended ?? Buffer.from([65,0,255,13,10,66]);
            socket.write(`* 1 FETCH (UID 42 BODY[] {${body.length}}\r\n`);
            setImmediate(() => { socket.write(body.subarray(0, 2)); socket.write(body.subarray(2)); socket.write(`)\r\n${tag} OK fetched\r\n`); });
          } else if (command.startsWith('LIST ')) socket.write(`* LIST (\\HasNoChildren) "/" "&U,BTFw-"\r\n${tag} OK listed\r\n`);
          else if (command.startsWith('UID SEARCH ') || command.startsWith('SEARCH ')) socket.write(`* SEARCH 42\r\n${tag} OK searched\r\n`);
          else if (command === 'IDLE') { idle = tag; socket.write('+ idling\r\n* 2 EXISTS\r\n'); }
          else if (command === 'LOGOUT') socket.end(`* BYE logging out\r\n${tag} OK logout\r\n`);
          else socket.write(`${tag} OK command completed\r\n`);
        }
      } catch (error) { state.errors.push(error.stack); socket.destroy(); }
    });
  };
}

await test('TCP LOGIN, folders, UID search/store/copy, binary APPEND/FETCH and logout', async () => {
  const state = {commands: [], errors: []};
  await serve(mailboxServer(state), async options => {
    const c = await ImapClient.connect({...options, allowInsecureAuth: true});
    try {
      await c.login('demo', 'test-only'); assert.ok(c.capabilities.includes('IDLE'));
      await c.create('台北'); await c.rename('台北', '中文');
      await c.list(); await c.status('INBOX'); await c.select();
      const bytes = Buffer.from([0,255,13,10,65,66]); await c.append('INBOX', bytes, {flags: '\\Seen'});
      const fetched = await c.fetch('42', '(UID BODY.PEEK[])', {uid: true});
      assert.deepEqual(fetched.responses[0].literals[0], bytes);
      await c.search('ALL', {uid: true}); await c.store('42', '\\Seen', {uid: true}); await c.copy('42', '中文', {uid: true});
      await assert.rejects(c.select('missing'), ImapCommandError); assert.equal(c.state, 'Authenticated');
      await c.select(); await c.command('CLOSE'); assert.equal(c.state, 'Authenticated');
      await c.logout(); assert.equal(c.state, 'Closed');
    } finally { c.close(); }
  });
  assert.deepEqual(state.errors, []); assert.ok(state.commands.some(x => x.includes('CREATE "&U,BTFw-"')));
});

await test('PLAIN challenge and IDLE updates/DONE with no command interleaving', async () => {
  const state = {commands: [], errors: []}, updates = [];
  await serve(mailboxServer(state), async options => {
    const c = await ImapClient.connect({...options, allowInsecureAuth: true});
    try {
      await c.authenticatePlain('demo', 'test-only'); await c.select();
      const idle = await c.idle({onUpdate: r => updates.push(r.line)});
      await assert.rejects(c.command('NOOP'), /pending/);
      await idle.done(); await idle.done(); await c.command('NOOP');
      assert.ok(updates.includes('* 2 EXISTS'));
      const auto = await c.idle({maxDuration: 20}); await auto.completion;
      await c.logout();
    } finally { c.close(); }
  });
  assert.deepEqual(state.errors, []); assert.equal(state.commands.filter(x => x === 'DONE').length, 2);
});

await test('authentication transport guard and command injection write no credentials', async () => {
  const state = {commands: [], errors: []};
  await serve(mailboxServer(state), async options => {
    const c = await ImapClient.connect(options);
    try { await assert.rejects(c.login('demo','test-only'), /requires TLS/); await c.command('NOOP'); }
    finally { c.close(); }
  });
  assert.equal(state.commands.some(x => x.includes('LOGIN')), false);
  await serve(mailboxServer(state, {preauth: true}), async options => {
    const c = await ImapClient.connect(options);
    try { await c.select(); await assert.rejects(c.search('ALL\r\nA999 LOGOUT'), /ASCII|expression/); }
    finally { c.close(); }
  });
  assert.equal(state.commands.some(x => x.includes('A999')), false);
});

await test('timeouts, cancellation, incomplete literals and mismatched completion terminate', async () => {
  await serve(() => {}, options => assert.rejects(ImapClient.connect({...options, timeout: 30}), /timeout/));
  await serve(socket => { socket.write('* PREAUTH hi\r\n'); socket.on('data', () => socket.end('* 1 FETCH (BODY[] {8}\r\nabc')); }, async options => {
    const c = await ImapClient.connect(options); try { await assert.rejects(c.command('NOOP'), /truncated/); } finally { c.close(); }
  });
  await serve(socket => { socket.write('* OK hi\r\n'); socket.on('data', () => socket.write('wrong OK completed\r\n')); }, async options => {
    const c = await ImapClient.connect(options); try { await assert.rejects(c.command('NOOP'), /tag mismatch/); } finally { c.close(); }
  });
  await serve(() => {}, async options => {
    const controller = new AbortController(); const attempt = ImapClient.connect({...options, signal: controller.signal});
    const rejected = assert.rejects(attempt, /cancelled/); controller.abort(Error('cancelled')); await rejected;
  });
});

await test('unsolicited updates remain separate and response count is bounded', async () => {
  const state = {commands: [], errors: []}, updates = [];
  await serve(mailboxServer(state), async options => {
    const c = await ImapClient.connect({...options, onUpdate: r => updates.push(r.line)});
    try { await c.capability(); assert.ok(updates.some(x => x.startsWith('* CAPABILITY'))); } finally { c.close(); }
  });
  await serve(socket => { socket.write('* PREAUTH hi\r\n'); socket.on('data', () => socket.write('* 1 EXISTS\r\n'.repeat(4097) + 'A1 OK done\r\n')); }, async options => {
    const c = await ImapClient.connect(options); try { await assert.rejects(c.command('NOOP'), /collection limit/); } finally { c.close(); }
  });
});

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'imap-tls-'));
const keyFile = path.join(temporary, 'key.pem'), certFile = path.join(temporary, 'cert.pem');
try {
  const openssl = process.env.OPENSSL ?? (process.platform === 'win32' && fs.existsSync('C:/Program Files/Git/usr/bin/openssl.exe') ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl');
  const made = spawnSync(openssl, ['req','-x509','-newkey','rsa:2048','-nodes','-keyout',keyFile,'-out',certFile,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost'], {encoding:'utf8',timeout:10000,windowsHide:true});
  assert.equal(made.status, 0, made.stderr);
  const key = fs.readFileSync(keyFile), cert = fs.readFileSync(certFile);
  await test('trusted implicit TLS authentication and binary transfer', async () => {
    const state = {commands: [], errors: []};
    await serve(mailboxServer(state), async options => {
      const c = await ImapClient.connect({...options, tls: {ca: cert, servername: 'localhost'}});
      try { await c.authenticatePlain('demo', 'test-only'); await c.select(); await c.append('INBOX', Buffer.from('test\r\n')); assert.equal((await c.fetch('1','BODY.PEEK[]')).responses[0].literals[0].toString(), 'test\r\n'); await c.logout(); }
      finally { c.close(); }
    }, {key, cert}); assert.deepEqual(state.errors, []);
  });
  await test('TLS requires trusted certificate and matching hostname', async () => {
    await serve(() => {}, options => assert.rejects(ImapClient.connect({...options, tls:{servername:'localhost',rejectUnauthorized:false}}), /certificate|self.signed/i), {key, cert});
    await serve(() => {}, options => assert.rejects(ImapClient.connect({...options, tls:{ca:cert,servername:'wrong.example',checkServerIdentity:()=>undefined}}), /hostname|altnames|certificate.*name/i), {key, cert});
  });
  await test('TLS handshake timeout and cancellation release resources', async () => {
    await serve(() => {}, options => assert.rejects(ImapClient.connect({...options, secure:true,timeout:30}), /timeout/));
    await serve(() => {}, async options => { const abort = new AbortController(); const attempt = ImapClient.connect({...options, secure:true,signal:abort.signal}); const rejected = assert.rejects(attempt,/cancelled/); abort.abort(Error('TLS cancelled')); await rejected; });
  });
} finally { for (const f of [keyFile,certFile]) if (fs.existsSync(f)) fs.unlinkSync(f); fs.rmdirSync(temporary); }
assert.equal(decodeMailbox(encodeMailbox('中文&😀')), '中文&😀');
const report = {timestamp:new Date().toISOString(), results, passed:results.filter(r=>r.passed).length, failed:results.filter(r=>!r.passed).length, scope:'Purpose-built loopback TCP/TLS fixture; not an independent IMAP server', fullSuiteRun:false};
fs.writeFileSync(new URL('../evidence/network-focused-validation.json',import.meta.url), JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report)); process.exitCode = report.failed ? 1 : 0;
