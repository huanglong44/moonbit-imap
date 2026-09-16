import net from 'node:net';
import tls from 'node:tls';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import * as api from './client.mjs';

const pop = !!api.Pop3Client, Client = api.Pop3Client ?? api.ImapClient;
const results = [], dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-starttls-'));
const keyFile = path.join(dir, 'key.pem'), certFile = path.join(dir, 'cert.pem');
let cert, key;
async function test(name, run) { try { await run(); results.push({name, passed: true}); } catch (error) { results.push({name, passed: false, error: error.stack}); } }
async function serve(config, run) {
  const state = {commands: [], errors: [], handshakes: 0}, sockets = new Set();
  const server = net.createServer(raw => {
    sockets.add(raw); raw.on('close', () => sockets.delete(raw)); raw.on('error', () => {});
    raw.write(pop ? '+OK fixture ready\r\n' : '* OK [CAPABILITY IMAP4rev1 STARTTLS LOGINDISABLED BEFORETLS] ready\r\n');
    function attach(socket, encrypted) {
      let input = '', authTag;
      const receive = chunk => {
        input += chunk.toString('ascii');
        while (input.includes('\r\n')) {
          const at = input.indexOf('\r\n'), line = input.slice(0, at); input = input.slice(at + 2);
          state.commands.push({line, encrypted});
          try {
            if (authTag !== undefined) {
              if (line === '*') socket.write(pop ? '-ERR cancelled\r\n' : `${authTag} BAD cancelled\r\n`);
              else {
                assert.equal(encrypted, true, 'credentials arrived without TLS');
                assert.equal(Buffer.from(line, 'base64').toString(), '\0demo\0test-only');
                socket.write(pop ? (config.authReject ? '-ERR rejected\r\n' : '+OK authenticated\r\n') : `${authTag} ${config.authReject ? 'NO rejected' : 'OK authenticated'}\r\n`);
              }
              authTag = undefined; continue;
            }
            const tag = pop ? '' : line.split(' ', 1)[0], command = pop ? line : line.slice(tag.length + 1);
            const ok = text => socket.write(pop ? `+OK ${text}\r\n` : `${tag} OK ${text}\r\n`);
            if (command === (pop ? 'CAPA' : 'CAPABILITY')) {
              if (config.capDelay) socket.pause();
              const caps = encrypted ? ['AUTH=PLAIN', 'AFTERTLS'] : [...(config.noAdvertise ? [] : [pop ? 'STLS' : 'STARTTLS']), 'BEFORETLS'];
              const respond = () => {
                if (pop) socket.write('+OK capabilities\r\n' + (encrypted ? 'SASL PLAIN\r\nAFTERTLS\r\n' : caps.join('\r\n') + '\r\n') + '.\r\n');
                else socket.write(`* CAPABILITY IMAP4rev1 ${caps.join(' ')}\r\n${tag} OK caps\r\n`);
                socket.resume();
              };
              if (config.capDelay) setTimeout(respond, config.capDelay); else respond();
            } else if (command === (pop ? 'STLS' : 'STARTTLS')) {
              if (config.refuse) { socket.write(pop ? '-ERR disabled\r\n' : `${tag} NO disabled\r\n`); continue; }
              if (config.silent) continue;
              raw.pause(); raw.off('data', receive);
              const completion = pop ? '+OK TLS now\r\n' : `${tag} OK TLS now\r\n`;
              if (config.smuggle !== undefined) { raw.write(completion + config.smuggle); return; }
              raw.write(completion, () => {
                if (config.stall) return;
                const wrapped = new tls.TLSSocket(raw, {isServer: true, secureContext: tls.createSecureContext({key, cert})});
                sockets.add(wrapped); wrapped.on('close', () => sockets.delete(wrapped)); wrapped.on('error', () => {});
                wrapped.on('secure', () => { state.handshakes++; });
                attach(wrapped, true); wrapped.resume();
              });
              return;
            } else if (command === (pop ? 'AUTH PLAIN' : 'AUTHENTICATE PLAIN')) {
              if (config.rejectWithChallenge) { socket.write('+ \r\n' + (pop ? '-ERR rejected\r\n' : `${tag} NO rejected\r\n`)); continue; }
              authTag = tag; socket.write(config.badChallenge ? '+ YmFk\r\n' : '+ \r\n');
            } else if (/^(USER|PASS|LOGIN)( |$)/.test(command)) {
              assert.equal(encrypted, true, 'credentials arrived without TLS'); ok('authenticated');
            } else if (command === 'STAT') ok('1 42');
            else if (command === 'NOOP') ok('alive');
            else if (command === (pop ? 'QUIT' : 'LOGOUT')) socket.end(pop ? '+OK bye\r\n' : `* BYE closing\r\n${tag} OK logged out\r\n`);
            else throw Error('Unexpected command: ' + command);
          } catch (error) { state.errors.push(error.stack); socket.destroy(); }
        }
      };
      socket.on('data', receive);
    }
    attach(raw, false);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const options = {host: '127.0.0.1', port: server.address().port, secure: false, timeout: 1500, tls: {ca: cert, servername: 'localhost'}};
  try { await run(options, state); assert.deepEqual(state.errors, []); }
  finally { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); }
}
async function closeNormally(client) { if (pop) await client.quit(); else await client.logout(); }
function noPlainCredentials(state) { assert.ok(state.commands.filter(x => !x.encrypted).every(x => !/(USER|PASS|LOGIN|AUTH) /.test(x.line))); }
try {
  const openssl = process.env.OPENSSL ?? (process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl');
  const generated = spawnSync(openssl, ['req','-x509','-newkey','rsa:2048','-nodes','-keyout',keyFile,'-out',certFile,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost'], {encoding:'utf8',timeout:15000,windowsHide:true});
  assert.equal(generated.status, 0, generated.stderr); key = fs.readFileSync(keyFile); cert = fs.readFileSync(certFile);
  await test('explicit upgrade refreshes capabilities then PLAIN authenticates', () => serve({}, async (options, state) => {
    const c = await Client.connect(options);
    try {
      assert.equal(c.secure, false);
      await assert.rejects(c.login('demo', 'test-only'), /TLS|disables LOGIN/);
      await assert.rejects(c.authenticatePlain('demo', 'test-only'), /TLS/);
      const caps = await c.startTls(); assert.equal(c.secure, true);
      assert.ok(pop ? caps.has('AFTERTLS') : caps.includes('AFTERTLS'));
      assert.ok(pop ? !caps.has('BEFORETLS') : !caps.includes('BEFORETLS'));
      await assert.rejects(c.startTls(), /already active/);
      await c.authenticatePlain('demo', 'test-only');
      await c.command(pop ? 'STAT' : 'NOOP'); await closeNormally(c);
      assert.equal(c.secure, false); noPlainCredentials(state);
    } finally { c.close(); }
  }));
  await test('connect with required upgrade returns only after TLS and permits login', () => serve({}, async (options, state) => {
    const c = await Client.connect({...options, startTls:true});
    try { assert.equal(c.secure, true); await c.login('demo','test-only'); await closeNormally(c); noPlainCredentials(state); }
    finally { c.close(); }
  }));
  await test('untrusted certificates cannot be bypassed by TLS overrides', () => serve({}, async (options, state) => {
    await assert.rejects(Client.connect({...options,startTls:true,tls:{servername:'localhost',rejectUnauthorized:false,checkServerIdentity:()=>undefined}}), /certificate|self.signed/i);
    noPlainCredentials(state);
  }));
  await test('hostname mismatch remains fatal', () => serve({}, async (options, state) => {
    await assert.rejects(Client.connect({...options,startTls:true,tls:{ca:cert,servername:'wrong.example',checkServerIdentity:()=>undefined}}), /hostname|altnames|certificate.*name/i);
    noPlainCredentials(state);
  }));
  for (const [name, config, pattern] of [
    ['capability stripping', {noAdvertise:true}, /advertise/],
    ['explicit refusal', {refuse:true}, /rejected|disabled/],
    ['upgrade response timeout', {silent:true}, /timeout/],
    ['TLS handshake timeout', {stall:true}, /timeout/],
  ]) await test(name + ' closes without authentication fallback', () => serve(config, async (options, state) => {
    const c = await Client.connect({...options,timeout:250});
    try { await assert.rejects(c.startTls(), pattern); assert.equal(c.secure,false); await assert.rejects(c.command('NOOP'), /closed/i); noPlainCredentials(state); }
    finally { c.close(); }
  }));
  for (const suffix of [pop ? '+OK injected\r\n' : '* CAPABILITY INJECTED\r\n', '+']) {
    await test('reject plaintext after successful upgrade: ' + JSON.stringify(suffix), () => serve({smuggle:suffix}, async (options, state) => {
      await assert.rejects(Client.connect({...options,startTls:true}), /plaintext|truncated/); noPlainCredentials(state);
    }));
  }
  await test('upgrade reserves the session across capability and handshake steps', () => serve({capDelay:50}, async (options, state) => {
    const c = await Client.connect(options);
    try {
      const upgrade = c.startTls();
      await assert.rejects(c.command('NOOP'), /pending/);
      await upgrade; await c.login('demo','test-only'); noPlainCredentials(state);
    } finally { c.close(); }
  }));
  await test('abort during TLS upgrade rejects and releases the session', () => serve({stall:true}, async (options, state) => {
    const abort = new AbortController(), c = await Client.connect({...options,signal:abort.signal});
    try {
      const upgrade = c.startTls(), rejected = assert.rejects(upgrade,/upgrade aborted/);
      setTimeout(() => abort.abort(Error('upgrade aborted')), 80); await rejected;
      assert.equal(c.secure,false); noPlainCredentials(state);
    } finally { c.close(); }
  }));
  await test('close during upgrade rejects the pending operation', () => serve({stall:true}, async options => {
    const c = await Client.connect(options), upgrade = c.startTls();
    const rejected = assert.rejects(upgrade,/closed/i); setTimeout(()=>c.close(),80); await rejected;
  }));
  await test('raw upgrade and authentication commands cannot bypass safe APIs', () => serve({}, async options => {
    const c = await Client.connect(options);
    try { await assert.rejects(c.command(pop ? 'STLS' : 'STARTTLS'),/Use/); await assert.rejects(c.command(pop ? 'AUTH' : 'AUTHENTICATE'),/Use/); }
    finally { c.close(); }
  }));
  await test('PLAIN rejection permits explicit retry with login', () => serve({authReject:true}, async options => {
    const c = await Client.connect({...options,startTls:true});
    try { await assert.rejects(c.authenticatePlain('demo','test-only'),/rejected/); await c.login('demo','test-only'); }
    finally { c.close(); }
  }));
  await test('coalesced rejection takes precedence over PLAIN challenge', () => serve({rejectWithChallenge:true}, async (options,state) => {
    const c = await Client.connect({...options,startTls:true});
    try {
      await assert.rejects(c.authenticatePlain('demo','test-only'),/rejected/);
      assert.ok(!state.commands.some(x=>x.line===Buffer.from('\0demo\0test-only').toString('base64')));
      await c.login('demo','test-only');
    } finally { c.close(); }
  }));
  await test('nonempty PLAIN challenge is cancelled without sending credentials', () => serve({badChallenge:true}, async (options,state) => {
    const c = await Client.connect({...options,startTls:true});
    try {
      await assert.rejects(c.authenticatePlain('demo','test-only'),/nonempty challenge/);
      assert.ok(state.commands.some(x=>x.line==='*'));
      assert.ok(!state.commands.some(x=>x.line===Buffer.from('\0demo\0test-only').toString('base64')));
      await c.login('demo','test-only');
    } finally { c.close(); }
  }));
} finally {
  for (const file of [keyFile, certFile]) if (fs.existsSync(file)) fs.unlinkSync(file);
  fs.rmdirSync(dir);
}
const sha256 = file => createHash('sha256').update(fs.readFileSync(new URL(file,import.meta.url))).digest('hex');
const report = {timestamp:new Date().toISOString(),protocol:pop?'POP3':'IMAP',node:process.version,results,passed:results.filter(x=>x.passed).length,failed:results.filter(x=>!x.passed).length,independentServer:false,sourceSha256:{client:sha256('./client.mjs'),engine:sha256('../web/engine.mjs')}};
fs.writeFileSync(new URL('../evidence/starttls-validation.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report)); process.exitCode = report.failed ? 1 : 0;
