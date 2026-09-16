"""Launch an unmodified Dovecot 2.4 test server in a disposable local directory.

Optional argv[1] is a directory of extracted Ubuntu packages. This mode requires
root inside a private Linux mount namespace and writes no host /usr files.
No package installation, system users, global config or persistent service needed.
"""
from pathlib import Path
import base64, hashlib, json, os, pwd, shutil, signal, socket, subprocess, sys, tempfile, time

root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else None
if root and len(sys.argv) == 2:
    if os.geteuid() != 0: raise RuntimeError('Extracted packages mode needs root for a private mount namespace')
    # The parent removes this directory only after the namespace and mounts end.
    with tempfile.TemporaryDirectory(prefix='moonbit-dovecot-mount-') as mapping:
        result = subprocess.run(['unshare','--mount','--propagation','private',sys.executable,__file__,str(root),'--namespace',mapping])
    sys.exit(result.returncode)
if root:
    if len(sys.argv) != 4 or sys.argv[2] != '--namespace': raise RuntimeError('Invalid namespace arguments')
    mapping = Path(sys.argv[3])
    for name in ['lower','upper','work']: (mapping/name).mkdir()
    subprocess.run(['mount','--bind','/usr',str(mapping/'lower')],check=True)
    subprocess.run(['mount','-o','remount,bind,ro',str(mapping/'lower')],check=True)
    subprocess.run(['mount','-t','overlay','overlay','-o',f'lowerdir={mapping}/lower,upperdir={mapping}/upper,workdir={mapping}/work','/usr'],check=True)
    Path('/usr/lib/dovecot').mkdir(exist_ok=True)
    subprocess.run(['mount','--bind',str(root/'usr/lib/dovecot'),'/usr/lib/dovecot'],check=True)
    shutil.copy2(root/'usr/bin/doveconf','/usr/bin/doveconf')
    # Debian service defaults mention the dovecot group. Supply an ephemeral
    # alias to the test-only nobody group inside this namespace, not the host.
    groups = Path('/etc/group').read_text()
    if not any(line.startswith('dovecot:') for line in groups.splitlines()):
        group_file = mapping/'group'
        group_file.write_text(groups+'\ndovecot:x:65534:\n')
        subprocess.run(['mount','--bind',str(group_file),'/etc/group'],check=True)
user = pwd.getpwuid(65534 if os.getuid() == 0 else os.getuid())
env = dict(os.environ)
if root:
    env['LD_LIBRARY_PATH'] = str(root/'usr/lib/dovecot') + ':' + str(root/'usr/lib/x86_64-linux-gnu')
    prefix = []
    dovecot, doveconf = str(root/'usr/sbin/dovecot'), str(root/'usr/bin/doveconf')
else:
    prefix = []
    dovecot, doveconf = shutil.which('dovecot'), shutil.which('doveconf')
    if not dovecot or not doveconf: raise RuntimeError('Install Dovecot 2.4 or pass an extracted package root')
version = subprocess.check_output([dovecot, '--version'], env=env, text=True).strip()
if not version.startswith('2.4.'): raise RuntimeError('This harness expects Dovecot 2.4: ' + version)

def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0)); return s.getsockname()[1]

with tempfile.TemporaryDirectory(prefix='moonbit-dovecot-') as directory:
    base = Path(directory); base.chmod(0o755)
    for child in ['run','state','home','mail','mail/cur','mail/new','mail/tmp']:
        (base/child).mkdir(exist_ok=True)
    cert, key = base/'cert.pem', base/'key.pem'
    subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(key),'-out',str(cert),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    key.chmod(0o600)
    message = b'From: sender@example.test\r\nTo: demo@example.test\r\nSubject: independent protocol test\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nIndependent Dovecot body\r\n.dot-stuffed line\r\n'
    (base/'mail/new/1.codex-test').write_bytes(message)
    password_file = base/'users'; password_file.write_text('demo:{PLAIN}test-only\n'); password_file.chmod(0o600)
    if os.getuid() == 0:
        for item in [base/'home',base/'mail',*(base/'mail').rglob('*'),password_file]:
            os.chown(item,user.pw_uid,user.pw_gid)
    pop_port, imap_port = free_port(), free_port()
    while imap_port == pop_port: imap_port = free_port()
    config = base/'dovecot.conf'
    config.write_text(f'''dovecot_config_version = 2.4.0
dovecot_storage_version = 2.4.0
instance_name = moonbit-local-reference
base_dir = {base}/run
state_dir = {base}/state
protocols = imap pop3
listen = 127.0.0.1
default_internal_user = {user.pw_name}
default_login_user = {user.pw_name}
log_path = {base}/dovecot.log
mail_driver = maildir
mail_path = {base}/mail
mail_home = {base}/home
ssl = required
ssl_min_protocol = TLSv1.2
ssl_server_cert_file = {cert}
ssl_server_key_file = {key}
auth_mechanisms = plain login
auth_failure_delay = 0
import_environment {{
  LD_LIBRARY_PATH = {env.get('LD_LIBRARY_PATH','')}
}}
passdb passwd-file {{
  passwd_file_path = {password_file}
}}
userdb static {{
  fields {{
    uid = {user.pw_uid}
    gid = {user.pw_gid}
    home = {base}/home
  }}
}}
namespace inbox {{
  inbox = yes
}}
service imap-login {{
  chroot =
  inet_listener imap {{
    port = {imap_port}
  }}
  inet_listener imaps {{
    port = 0
  }}
}}
service pop3-login {{
  chroot =
  inet_listener pop3 {{
    port = {pop_port}
  }}
  inet_listener pop3s {{
    port = 0
  }}
}}
service auth {{
  user = {user.pw_name}
}}
service auth-worker {{
  user = {user.pw_name}
}}
''')
    checked = subprocess.run(prefix+[doveconf,'-c',str(config),'-n'],env=env,text=True,capture_output=True)
    if checked.returncode: raise RuntimeError('Invalid isolated config: '+str(checked.returncode)+' '+checked.stderr+' '+checked.stdout[-3000:])
    log = open(base/'launcher.log','w+')
    process = subprocess.Popen(prefix+[dovecot,'-F','-c',str(config)],env=env,stdout=log,stderr=log,start_new_session=True)
    try:
        ready = False
        for _ in range(100):
            if process.poll() is not None: break
            try:
                with socket.create_connection(('127.0.0.1',imap_port),timeout=.15): pass
                with socket.create_connection(('127.0.0.1',pop_port),timeout=.15): pass
                ready = True; break
            except OSError: time.sleep(.1)
        if not ready:
            log.flush();log.seek(0)
            error = log.read()
            if (base/'dovecot.log').exists(): error += (base/'dovecot.log').read_text()
            raise RuntimeError('Dovecot startup failed: '+error[-12000:])
        package_hashes = {}
        if root:
            for package in (root.parent/'packages').glob('*.deb'):
                if not package.name.startswith(('dovecot-','libpcre2-32-','libexttextcat-2.0-0_','libicu78_','liblua5.4-0_')): continue
                package_hashes[package.name] = hashlib.sha256(package.read_bytes()).hexdigest()
        print('READY '+json.dumps({'version':version,'pop3':pop_port,'imap':imap_port,'certificate':base64.b64encode(cert.read_bytes()).decode(),'packages':package_hashes}),flush=True)
        sys.stdin.readline()
    finally:
        if process.poll() is None:
            os.killpg(process.pid,signal.SIGTERM)
            try: process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid,signal.SIGKILL); process.wait(timeout=5)
        if (base/'dovecot.log').exists():
            content=(base/'dovecot.log').read_text()
            if 'Error:' in content or 'Fatal:' in content: print(content[-12000:],file=sys.stderr)
        log.close()
