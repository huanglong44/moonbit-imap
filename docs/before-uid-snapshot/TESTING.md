# 测试与复现

## 本轮 2026-09-16

IMAP 0.4.0：22 项 MoonBit 测试分别在 JS 和 Wasm-GC 通过，覆盖旧功能与 TLS 升级/认证取消状态。17 组 `test-starttls.mjs` 场景通过；既有 8 组 TCP/TLS 场景通过。Dovecot 2.4.2 的 9 项独立流程通过，实际执行 TLS 升级、认证和邮箱操作。

- `evidence/starttls-validation.json`：自编 TCP/TLS 场景，包含客户端/引擎 SHA-256。
- `evidence/dovecot-validation.json`：独立服务器版本、Ubuntu 包指纹、实际流程及源码指纹。
- `evidence/tls-auth-upgrade.json`：本版核心与宿主验证汇总。

本轮未重复 20 项合集、覆盖率/模糊测试/性能基准，未重打 ZIP/bundle。旧 evidence 保留原日期和范围；不能将旧覆盖率当成当前功能覆盖。远程 CI、长期运行和完整上游兼容没有完成。

## 常规验证

```sh
moon fmt
moon info
moon check --target js --deny-warn
moon test --target js --deny-warn
moon test --target wasm-gc --deny-warn
moon build --target js --deny-warn
# 将 _build/js/debug/build/cmd/web/web.js 复制为 web/engine.mjs 后：
node tools/test-demo.mjs
node tools/test-cli.mjs
node tools/test-network.mjs
node tools/test-starttls.mjs
```

网络测试需要 Node.js 和 OpenSSL；Windows 默认发现 Git 附带的 OpenSSL，也可用 OPENSSL 指定路径。每次生成短期 localhost 证书、只监听本机随机端口，结束后关闭 socket 并删除密钥。`verify.ps1` 和 CI 已接入专项网络检查；配置 CI 不代表远端已经运行。

## Dovecot 独立互通

`tools/dovecot-reference.py` 只准备临时账号、证书、Maildir 和服务配置，协议由未经修改的 Dovecot 2.4 二进制处理。测试数据不是外部邮件，未连接用户真实邮箱。

本次使用 Windows Node.js v24.11.0，经 localhost 访问 WSL Ubuntu 26.04 的 Dovecot 2.4.2（Ubuntu 包 1:2.4.2+dfsg1-3ubuntu2.1）。没有安装系统服务或改写主机的 /usr、/etc 文件。依赖只下载和解包到临时目录；私有 Linux 挂载命名空间提供运行路径和临时组映射。测试结束时停止子进程并撤销挂载，证书及邮箱被清理。

准备对应 Ubuntu 26.04 依赖（在 WSL 中执行；本脚本不自动安装或下载）：

```sh
mkdir -p /tmp/moonbit-dovecot-deps/packages /tmp/moonbit-dovecot-deps/root
cd /tmp/moonbit-dovecot-deps/packages
apt-get download dovecot-core dovecot-imapd dovecot-pop3d dovecot-sieve libpcre2-32-0 libexttextcat-2.0-0 libicu78 liblua5.4-0
for package in ./*.deb; do dpkg-deb -x "$package" ../root; done
```

然后在本项目的 Windows PowerShell 中执行：

```powershell
$env:WSL_DISTRO = 'Ubuntu-D'
$env:DOVECOT_ROOT = '/tmp/moonbit-dovecot-deps/root'
node tools/test-dovecot.mjs
```

提取包模式通过 WSL root 建立私有挂载命名空间；没有修改主机邮件服务或账号。Linux 原生运行可在已有 Dovecot 2.4 的隔离测试环境中以 root 运行同一 Node 脚本；本次实测的是上面的 Windows/WSL 路径。其它发行版的依赖名及 Dovecot 大版本需要单独适配。外部二进制不随本仓库分发。
