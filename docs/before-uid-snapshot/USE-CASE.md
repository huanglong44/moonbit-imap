# 读取带 literal 的 UID FETCH 报文

按 UID 拉取邮件头/字节内容、处理 literal 和 continuation，并用 IDLE 感知邮箱变化，作为邮箱巡检/同步应用的底层。

## 输入、操作、输出

离线合成报文；不是邮件同步客户端整体验收。

最简运行：先按 README 构建，然后 `node examples/run-use-case.mjs`。它自动创建输出目录并执行下面命令。下列 `{out}` 是运行器替换的实际目录，不是直接输入 shell 的变量；stdin 文件由运行器传递，以避免 Windows 与 POSIX 重定向差异。

```text
node tools/cli.mjs --file examples/use-case/fetch.txt
```

观察：保留 UID 42、18 字节 literal 和 tagged completion；底层 TCP/TLS/IDLE 的证据另列。

每一步输出见实际目录下 `step-N.stdout.txt` / `step-N.stderr.txt`；本轮已保存回执见 `evidence/value-rework-20260922/use-case.json`。

## 为什么保留这个实现

需要 UID、literal、邮箱状态和 IDLE 的调用方可使用；区别于 SMTP/MIME 和 POP3，不能把三者包装为三个完整邮箱应用。

承认 SMTP/MIME 生态已有 MoonMailKit、moonmail、MoonMIME。这里是 IMAP 同步会话层，和邮件文本解析、POP3 UIDL 备份不同。

## 不能由样例推出的结论

未实现完整邮件应用或所有 IMAP 扩展；本轮本机 peer 测试不是所有真实邮箱服务商的验收。

该样例是可修改的使用入口，不能证明存在真实用户、全部兼容或性能领先。继续投入的依据应是明确的输入或接入需求；若对接任务用既有成熟库即可完成，应优先复用而不是为保留参赛数量扩张本项目。
