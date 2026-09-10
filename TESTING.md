# Validation contract

- Explicit Wasm-GC and JS targets: no inference from the toolchain default.
- Public API tests plus compiled browser engine, CLI stdin/file/argument and failure exit-code checks.
- 307 seeded bounded malformed inputs including UTF-16 surrogates. The worker has a 20-second limit.
- Local code coverage: `moon coverage analyze -p localreview/imap -- -f summary`. No coverage upload is configured. Coverage is evidence about current code, not upstream feature coverage.
- Benchmark: 5 warmups and 30 measured documented-example executions; median and p95 recorded locally.
- Generated API and browser artifact must match the same source revision.

CI files are prepared locally; remote CI has not run because this repository has not been uploaded. Compatibility beyond README scope remains unverified.


## 0.3 定向验证

本次 16 项 JS 核心测试、8 组 TCP/TLS 场景通过。GreenMail 2.1.13 独立服务器 7 条流程通过，PLAIN 因服务器未公布该机制没有运行。未重复跑 20 项合集；新版 Wasm-GC 与长期/性能待验证。

普通项目测试不需要独立服务器。完整网络检查需要 OpenSSL，工具脚本生成临时证书并清理。`verify.ps1` 现在包含 `node tools/test-network.mjs`。

独立服务器复现：从 Maven Central 下载 `com.icegreen:greenmail-standalone:2.1.13`，SHA1 必须为 `6c84bc84e76784674d07b294dc4933619de35bba`。设置 GREENMAIL_JAR 为 JAR 绝对路径，执行 `node tools/test-greenmail.mjs`；需要支持单文件源码启动的 Java（本机 Java 22）。脚本只启动回环随机端口、测试自己的临时账号，不发送外部邮件，并在结束时停止 Java 进程。

GreenMail JAR 不随仓库分发，也不在普通构建时自动下载。它与本项目实现相互独立，测试适配器为本项目原创。

最后修补了跨 literal 的 UTF-8 语法预算累计，额外 1 个定向边界用例通过；原 16 项项目测试未重复全量运行。
