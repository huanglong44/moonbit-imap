import net from 'node:net';
import tls from 'node:tls';
import {randomUUID} from 'node:crypto';
import * as core from '../web/engine.mjs';

function checked(value) { if (value.startsWith('ERROR:')) throw Error(value); return value; }
export const encodeMailbox = name => checked(core.mailbox_name(name, false));
export const decodeMailbox = name => checked(core.mailbox_name(name, true));
export class ImapCommandError extends Error {
  constructor(result) { super(result.completion.line); this.name = 'ImapCommandError'; this.result = result; }
}

/** One command at a time. Binary literals are Buffers; untagged responses are retained.
 * TLS defaults on, with mandatory trust and hostname checks. No automatic command retries.
 */
export class ImapClient {
  #key = randomUUID(); #socket; #pending; #closed = false; #state = 'Greeting';
  #caps = []; #timeout; #secure; #allowAuth; #signal; #abort; #onUpdate; #onClose;
  #tls; #handlers; #upgradeToken;
  constructor(options = {}) {
    const {host = 'localhost', secure = true, port = secure ? 993 : 143, timeout = 10000,
      signal, tls: tlsOptions = {}, allowInsecureAuth = false, onUpdate, onClose, startTls = false} = options;
    if (typeof host !== 'string' || !host || typeof secure !== 'boolean' || !Number.isInteger(port) || port < 1 || port > 65535 || !Number.isInteger(timeout) || timeout < 1 || timeout > 2147483647) throw Error('Invalid host, secure, port or timeout');
    if (onUpdate !== undefined && typeof onUpdate !== 'function') throw Error('onUpdate must be a function');
    if (onClose !== undefined && typeof onClose !== 'function') throw Error('onClose must be a function');
    if (typeof startTls !== 'boolean' || (startTls && secure)) throw Error('startTls requires secure:false');
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : Error('Aborted');
    this.#timeout = timeout; this.#secure = secure; this.#allowAuth = allowInsecureAuth === true;
    this.#signal = signal; this.#onUpdate = onUpdate; this.#onClose = onClose;
    checked(core.session_open(this.#key));
    this.greeting = this.#wait('GREETING', null).promise;
    this.greeting.catch(() => {});
    try {
      const allowedTls = {};
      for (const field of ['ca', 'cert', 'key', 'passphrase', 'minVersion', 'maxVersion']) if (tlsOptions[field] !== undefined) allowedTls[field] = tlsOptions[field];
      this.#tls = {...allowedTls, host,
        servername: tlsOptions.servername ?? (net.isIP(host) ? undefined : host),
        rejectUnauthorized: true, checkServerIdentity: tls.checkServerIdentity};
      this.#socket = secure ? tls.connect({...this.#tls, port}) : net.connect({host, port});
      this.#bind();
      this.#abort = () => this.#fail(signal.reason instanceof Error ? signal.reason : Error('Aborted'));
      signal?.addEventListener('abort', this.#abort, {once: true});
    } catch (error) { this.#fail(error); }
  }
  #bind() {
    this.#handlers = {
      data: chunk => this.#receive(chunk),
      error: error => this.#fail(error),
      end: () => {
        try { checked(core.session_finish(this.#key)); } catch (error) { this.#fail(error); return; }
        this.#fail(Error('Connection ended'));
      },
      close: () => this.#fail(Error('Connection closed')),
    };
    for (const [event, handler] of Object.entries(this.#handlers)) this.#socket.on(event, handler);
  }
  static async connect(options = {}) {
    const client = new ImapClient(options); await client.greeting;
    if (client.#closed) throw Error('Connection closed during greeting');
    if (options.startTls) await client.startTls();
    return client;
  }
  get state() { return this.#closed ? 'Closed' : this.#state; }
  get secure() { return !this.#closed && this.#secure && this.#socket?.authorized === true; }
  get capabilities() { return [...this.#caps]; }
  #arm(pending, duration = this.#timeout) {
    clearTimeout(pending.timer);
    pending.timer = setTimeout(() => this.#fail(Error('IMAP response timeout')), duration);
  }
  #wait(verb, tag, continuation) {
    const pending = {verb, tag, continuation, responses: [], bytes: 0};
    pending.promise = new Promise((resolve, reject) => { pending.resolve = resolve; pending.reject = reject; });
    // IDLE exposes a separate readiness promise; retain a handler for eventual completion.
    pending.promise.catch(() => {});
    this.#pending = pending; this.#arm(pending); return pending;
  }
  #fail(error) {
    if (this.#closed) return;
    this.#closed = true;
    const pending = this.#pending; this.#pending = undefined;
    if (pending) { clearTimeout(pending.timer); pending.reject(error); pending.rejectReady?.(error); }
    this.#signal?.removeEventListener('abort', this.#abort);
    core.session_close(this.#key); this.#socket?.destroy();
    if (this.#onClose) { try { this.#onClose(error); } catch {} }
  }
  #write(data) { this.#socket.write(data, error => { if (error) this.#fail(error); }); }
  #receive(chunk) {
    if (this.#closed) return;
    try {
      const batch = JSON.parse(checked(core.session_feed(this.#key, chunk.toString('hex'))));
      this.#state = batch.state; this.#caps = batch.capabilities;
      for (const raw of batch.responses) {
        const response = {line: raw.line, literals: raw.literals.map(hex => Buffer.from(hex, 'hex'))};
        const pending = this.#pending;
        if (pending?.verb === 'GREETING') {
          if (!/^\* (?:OK|PREAUTH)(?: |$)/i.test(response.line)) throw Error('Server rejected connection: ' + response.line);
          clearTimeout(pending.timer); this.#pending = undefined; pending.resolve(response); continue;
        }
        if (/^\+(?: |$)/.test(response.line)) {
          // A coalesced NO/BAD may cancel a just-issued continuation before we send.
          if (!batch.pending) continue;
          if (!pending?.continuation) throw Error('Unexpected continuation');
          if (pending.verb === 'IDLE') {
            clearTimeout(pending.timer); pending.idleActive = true;
            pending.timer = setTimeout(() => this.#done(pending).catch(() => {}), pending.maxDuration);
            pending.resolveReady({done: () => this.#done(pending), completion: pending.promise});
          } else {
            const {kind} = pending.continuation;
            let {data} = pending.continuation;
            if (kind === 'auth' && response.line !== '+' && response.line !== '+ ') {
              data = '*'; pending.authError = Error('PLAIN server sent a nonempty challenge');
            }
            this.#write(Buffer.from(checked(core.session_continue(this.#key, kind, data)), 'hex'));
            pending.continuation = undefined;
          }
          continue;
        }
        if (response.line.startsWith('* ')) {
          if (pending && pending.verb !== 'IDLE') this.#collect(pending, response);
          (pending?.onUpdate ?? this.#onUpdate)?.(response);
          if (/^\* BYE(?: |$)/i.test(response.line) && pending?.verb !== 'LOGOUT') throw Error('Server closed session: ' + response.line);
          continue;
        }
        if (!pending) throw Error('Unsolicited completion');
        const match = /^(\S+) (OK|NO|BAD)(?: |$)/i.exec(response.line);
        if (!match || match[1] !== pending.tag) throw Error('Unexpected completion');
        clearTimeout(pending.timer); this.#pending = undefined;
        const result = {ok: match[2].toUpperCase() === 'OK', status: match[2].toUpperCase(), completion: response, responses: pending.responses};
        if (pending.verb === 'STARTTLS' && result.ok) this.#socket.pause();
        if (result.ok) pending.resolve(result); else { const error = pending.authError ?? new ImapCommandError(result); pending.reject(error); pending.rejectReady?.(error); }
      }
    } catch (error) { this.#fail(error); }
  }
  #collect(pending, response) {
    pending.bytes += Buffer.byteLength(response.line) + response.literals.reduce((n, b) => n + b.length, 0);
    if (pending.bytes > 8388608 || pending.responses.length >= 4096) throw Error('Command response collection limit');
    pending.responses.push(response);
  }
  #issue(verb, args, continuation, token) {
    if (this.#closed || this.#pending || (this.#upgradeToken && token !== this.#upgradeToken)) throw Error('Client is closed or a command is pending');
    if (typeof verb !== 'string' || !Array.isArray(args) || !args.every(x => typeof x === 'string') || JSON.stringify(args).length > 65536) throw Error('Invalid command arguments');
    verb = verb.toUpperCase();
    if (['LOGIN', 'AUTHENTICATE'].includes(verb) && !this.#secure && !this.#allowAuth) throw Error('Authentication requires TLS or explicit allowInsecureAuth');
    const wire = checked(core.session_issue(this.#key, verb, JSON.stringify(args)));
    if (verb === 'SELECT' || verb === 'EXAMINE') this.#state = 'Authenticated';
    const pending = this.#wait(verb, wire.split(' ', 1)[0], continuation);
    this.#write(wire); return pending;
  }
  async command(verb, args = []) {
    if (typeof verb !== 'string') throw Error('Command must be a string');
    if (['APPEND', 'AUTHENTICATE', 'IDLE', 'STARTTLS'].includes(verb.toUpperCase())) throw Error('Use append, authenticatePlain, idle or startTls for continuation commands');
    return this.#issue(verb, args).promise;
  }
  async capability() { await this.command('CAPABILITY'); return this.capabilities; }
  async startTls() {
    if (this.#secure) throw Error('TLS is already active');
    if (this.#closed || this.#pending || this.#upgradeToken || this.#state !== 'NotAuthenticated') throw Error('STARTTLS requires an idle unauthenticated session');
    const token = Symbol(); this.#upgradeToken = token;
    try {
      await this.#issue('CAPABILITY', [], undefined, token).promise;
      if (!this.#caps.includes('STARTTLS')) throw Error('Server does not advertise STARTTLS');
      await this.#issue('STARTTLS', [], undefined, token).promise;
      if (this.#closed) throw Error('Connection closed during STARTTLS');
      this.#caps = [];
      const raw = this.#socket;
      for (const [event, handler] of Object.entries(this.#handlers)) raw.off(event, handler);
      const handshake = this.#wait('TLS', null);
      try {
        this.#socket = tls.connect({...this.#tls, socket: raw}); this.#bind();
        this.#socket.once('secureConnect', () => {
          try {
            if (this.#closed) return;
            checked(core.session_continue(this.#key, 'tls', ''));
            this.#secure = true;
            this.#pending = undefined; clearTimeout(handshake.timer); handshake.resolve();
          } catch (error) { this.#fail(error); }
        });
        this.#socket.resume();
      } catch (error) { raw.destroy(); this.#fail(error); }
      await handshake.promise;
      await this.#issue('CAPABILITY', [], undefined, token).promise;
      return this.capabilities;
    } catch (error) { this.#fail(error); throw error; }
    finally { this.#upgradeToken = undefined; }
  }
  async login(user, password) {
    if (this.#caps.includes('LOGINDISABLED')) throw Error('Server disables LOGIN');
    const result = await this.command('LOGIN', [user, password]);
    if (!this.#caps.length) await this.capability();
    return result;
  }
  async authenticatePlain(user, password, authorizationId = '') {
    if (!this.#secure && !this.#allowAuth) throw Error('Authentication requires TLS or explicit allowInsecureAuth');
    if (!this.#caps.length) await this.capability();
    if (!this.#caps.includes('AUTH=PLAIN')) throw Error('Server does not advertise AUTH=PLAIN');
    if (![user, password, authorizationId].every(x => typeof x === 'string' && !x.includes('\0') && Buffer.byteLength(x) <= 12000)) throw Error('Invalid PLAIN credentials');
    const data = Buffer.from(authorizationId + '\0' + user + '\0' + password, 'utf8').toString('base64');
    const result = await this.#issue('AUTHENTICATE', ['PLAIN'], {kind: 'auth', data}).promise;
    if (!this.#caps.length) await this.capability();
    return result;
  }
  async select(mailbox = 'INBOX', {readOnly = false} = {}) { return this.command(readOnly ? 'EXAMINE' : 'SELECT', [encodeMailbox(mailbox)]); }
  async list(reference = '', pattern = '*') { return this.command('LIST', [encodeMailbox(reference), encodeMailbox(pattern)]); }
  async status(mailbox, items = 'MESSAGES UNSEEN UIDNEXT UIDVALIDITY') { return this.command('STATUS', [encodeMailbox(mailbox), items]); }
  async create(mailbox) { return this.command('CREATE', [encodeMailbox(mailbox)]); }
  async rename(from, to) { return this.command('RENAME', [encodeMailbox(from), encodeMailbox(to)]); }
  async deleteMailbox(mailbox) { return this.command('DELETE', [encodeMailbox(mailbox)]); }
  async fetch(sequence, items = '(UID FLAGS RFC822.SIZE)', {uid = false} = {}) { return this.command(uid ? 'UID FETCH' : 'FETCH', [sequence, items]); }
  async search(criteria = 'ALL', {uid = false} = {}) { return this.command(uid ? 'UID SEARCH' : 'SEARCH', [criteria]); }
  async store(sequence, flags, {uid = false, mode = '+FLAGS.SILENT'} = {}) { return this.command(uid ? 'UID STORE' : 'STORE', [sequence, mode, flags]); }
  async copy(sequence, mailbox, {uid = false} = {}) { return this.command(uid ? 'UID COPY' : 'COPY', [sequence, encodeMailbox(mailbox)]); }
  async move(sequence, mailbox, {uid = false} = {}) {
    if (!this.#caps.includes('MOVE')) throw Error('Server does not advertise MOVE');
    return this.command(uid ? 'UID MOVE' : 'MOVE', [sequence, encodeMailbox(mailbox)]);
  }
  async append(mailbox, data, {flags = ''} = {}) {
    if (!Buffer.isBuffer(data) || data.length > 1048576) throw Error('APPEND requires a Buffer up to 1 MiB');
    return this.#issue('APPEND', [encodeMailbox(mailbox), String(data.length), flags], {kind: 'literal', data: data.toString('hex')}).promise;
  }
  async idle({onUpdate, maxDuration = 29 * 60 * 1000} = {}) {
    if (!this.#caps.includes('IDLE')) throw Error('Server does not advertise IDLE');
    if (!Number.isInteger(maxDuration) || maxDuration < 1 || maxDuration > 29 * 60 * 1000 || (onUpdate !== undefined && typeof onUpdate !== 'function')) throw Error('Invalid IDLE options');
    const pending = this.#issue('IDLE', [], {kind: 'idle'});
    pending.onUpdate = onUpdate; pending.maxDuration = maxDuration;
    return new Promise((resolve, reject) => { pending.resolveReady = resolve; pending.rejectReady = reject; });
  }
  async #done(pending) {
    if (pending.done) return pending.promise;
    if (this.#pending !== pending || !pending.idleActive || this.#closed) throw Error('IDLE is no longer active');
    pending.done = true;
    try { this.#write(Buffer.from(checked(core.session_continue(this.#key, 'done', '')), 'hex')); this.#arm(pending); }
    catch (error) { this.#fail(error); }
    return pending.promise;
  }
  async logout() { try { return await this.command('LOGOUT'); } finally { this.close(); } }
  close() { this.#fail(Error('Client closed')); }
}
