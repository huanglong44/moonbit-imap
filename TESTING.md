# 0.6.0 测试范围与复现 · 2026-09-27

当前新增结构/UID核心已在JS/Wasm-GC各29组测试通过，其中7组为分片、结构位置、完成门槛、身份、ESEARCH范围和拒绝边界。Node只读流程13组故障peer通过；纯MoonBit的examples/typed_read在两后端输出相同UID身份与6字节二进制正文长度。

独立GreenMail2.1.13实际运行两封合成邮件的只读导出，字节、未读标志、重复哈希一致。独立Dovecot2.4.2（0962ed2104）经Windows客户端/WSL服务端、已验证TLS升级完成10项流程；新增项目直接检查MoonBit EXAMINE/UID FETCH/ESEARCH投影，ESEARCH来自未经修改服务器实际响应，不是手写mock。源码/包指纹和结果见evidence/typed-20260927/dovecot.json。

Dovecot依赖仅下载并按Ubuntu包索引SHA256校验、解包到工作缓存；私有Linux挂载命名空间运行临时邮件服务，未安装系统服务。此前临时缓存已不存在，首次WSL下载超时；改用正常官方制品下载后成功。样本邮件仍是原创合成输入，没有真实用户凭据或外部邮箱采用证明。

当前回执在evidence/typed-20260927。没有把旧全量模糊/性能/所有协议兼容记录升级为当前验证。远程CI未执行。

## 0.5.0 历史记录（2026-09-23）

当前 [LOCAL-CHECKS.json](evidence/uid-snapshot-20260923/LOCAL-CHECKS.json)记录命令、退出码、工具版本及关键源码SHA-256。本轮JS/Wasm-GC各22项核心测试、新只读流程12组、既有TCP/TLS8组、STARTTLS17组、GreenMail7组既有命令及新独立UID导出通过，另跑浏览器引擎和CLI检查。

没有重跑Dovecot、旧完整覆盖率/模糊测试/基准、全部20项目合集或远程CI。旧记录及 [此前测试说明](docs/before-uid-snapshot/TESTING.md)保留，不能升级为本轮或生产验收。CI新配置不等于远程已执行。

## 常规本地命令

```sh
moon fmt
moon info
moon check --target js
moon test --target js
moon test --target wasm-gc
moon build --target js
node -e "require('node:fs').copyFileSync('_build/js/debug/build/cmd/web/web.js','web/engine.mjs')"
node tools/test-snapshot.mjs
node tools/test-network.mjs
node tools/test-starttls.mjs
node tools/test-demo.mjs
node tools/test-cli.mjs
```

网络/TLS测试用Node.js、OpenSSL、本机临时端口和临时证书；OpenSSL可用`OPENSSL`指定。仅自编peer测试的结论，不能称为独立服务器互通。

## 独立 GreenMail 2.1.13

需要Java21+（本轮Windows Java22.0.1实跑）。[GreenMail官网](https://greenmail-mail-test.github.io/greenmail/)说明其独立邮件测试服务器；固定制品在 [Maven Central](https://repo.maven.apache.org/maven2/com/icegreen/greenmail-standalone/2.1.13/greenmail-standalone-2.1.13.jar)。SHA-256：`21b361e46e8ffe83afe7915a2b01231c4a163c8d0fa5de607e32ed19732d908d`。不使用latest，不随源码分发JAR。

POSIX终端（自行选择下载位置，此处用当前工作目录）：

```sh
curl -fsSL https://repo.maven.apache.org/maven2/com/icegreen/greenmail-standalone/2.1.13/greenmail-standalone-2.1.13.jar -o greenmail-2.1.13.jar
export GREENMAIL_JAR="$PWD/greenmail-2.1.13.jar"
node examples/run-uid-snapshot.mjs
node tools/test-greenmail.mjs
```

PowerShell：

```powershell
Invoke-WebRequest 'https://repo.maven.apache.org/maven2/com/icegreen/greenmail-standalone/2.1.13/greenmail-standalone-2.1.13.jar' -OutFile greenmail-2.1.13.jar
$env:GREENMAIL_JAR = (Resolve-Path greenmail-2.1.13.jar).Path
node examples/run-uid-snapshot.mjs
node tools/test-greenmail.mjs
```

新harness启动前校验SHA-256，旧test-greenmail校验固定制品SHA-1；`JAVA`可指定Java可执行文件。`ImapReference.java`只设置随机回环端口和demo/test-only临时账号，协议由未修改的GreenMail处理。程序退出停止子进程；合成输入和输出清单保存在新临时目录。

新例子逐字节对比两封UTF-8邮件，检查仍未读、相同UIDVALIDITY下重复哈希相同。GreenMail测试使用回环TCP并显式允许测试账号明文认证；真实客户端默认TLS。此例不证明真实服务商TLS、认证策略或邮箱权限兼容。

当前原7组GreenMail流程覆盖LOGIN/能力、中文文件夹、APPEND/SELECT/STATUS、UIDSEARCH/FETCH、STORE/COPY、IDLE/DONE、EXPUNGE/CLOSE/RENAME/DELETE/LOGOUT；GreenMail未宣告AUTH=PLAIN，因此独立PLAIN被明确记为notRun。本轮没有将自编PLAIN测试冒充独立PLAIN通过。

SHA-256清单和两封导出文件保存于 [independent-example](evidence/uid-snapshot-20260923/independent-example/manifest.json)。脚本每次产生新的UIDVALIDITY/路径；固定内容哈希可比较，运行标识不要求不变。
