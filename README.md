# IMAP UID 与 literal 邮件会话客户端

**本项目仓库：[https://github.com/huanglong44/moonbit-imap](https://github.com/huanglong44/moonbit-imap)**

模块 `huanglong44/imap`，本地版本 **0.4.0**，MIT。当前评审状态：**条件复审**。本文件是当前入口，旧轮次说明与详细用法保存在 [历史/完整使用说明](README-BEFORE-VALUE-REWORK.md)。

## 解决什么任务

按 UID 拉取邮件头/字节内容、处理 literal 和 continuation，并用 IDLE 感知邮箱变化，作为邮箱巡检/同步应用的底层。

需要 UID、literal、邮箱状态和 IDLE 的调用方可使用；区别于 SMTP/MIME 和 POP3，不能把三者包装为三个完整邮箱应用。

## 直接复现

安装 MoonBit 和 Node.js 24，在本仓库根目录运行：

```sh
moon build --target js
node -e "require('node:fs').copyFileSync('_build/js/debug/build/cmd/web/web.js','web/engine.mjs')"
node examples/run-use-case.mjs
```

流程：**读取带 literal 的 UID FETCH 报文**。运行器创建新的系统临时目录，保留每一步的 stdout/stderr、产物及 `report.json`，打印实际目录；重复运行不会覆盖之前产物。它只执行仓库内的本地样例，不连接公网或发送消息。`report.json` 的 `expected` 是应观察的结果，实际结果在各步输出中；成功退出不替代内容核对。

输入性质：离线合成报文；不是邮件同步客户端整体验收。

应观察：保留 UID 42、18 字节 literal 和 tagged completion；底层 TCP/TLS/IDLE 的证据另列。

具体命令和输入路径见 [使用任务](USE-CASE.md) 与 [机器可读流程](examples/use-case.json)。只把这个脚本当复现入口，不把通用运行器计作核心技术贡献。

## 实现与已有项目的关系

MoonBit 实现字节解析、命令校验、会话和 continuation；Node 提供 TCP/TLS、STARTTLS、超时及取消。

承认 SMTP/MIME 生态已有 MoonMailKit、moonmail、MoonMIME。这里是 IMAP 同步会话层，和邮件文本解析、POP3 UIDL 备份不同。

同类项目和检索边界见 [DUPLICATION](DUPLICATION.md)。查重用于避免错误的首创表述；关键词零结果不能证明生态空白，Node 宿主能力也不计为 MoonBit 原生 I/O。

库使用从 [公共 API](pkg.generated.mbti) 和根包源码开始；可在本 checkout 的消费包中导入 `"huanglong44/imap"`。源码中的网络/文件宿主入口及完整参数仍见 [完整使用说明](README-BEFORE-VALUE-REWORK.md)。是否已发布到 Mooncakes 需另核实，本文不把 `moon add` 的下载成功作为已完成事项。

## 验证与边界

前一轮工程验证真实回环连接的命令、literal、IDLE 与错误路径验证通过；实际 API 和旧服务器对照范围见 README/TESTING。

[上一轮工程验证](evidence/innovation-review-20260922/results.json) 与 [本轮最小任务回执](evidence/value-rework-20260922/use-case.json) 分开。历史参考版本、golden 重放、本机 peer、真实第三方服务端和本次样例是不同证据，不能合并成“全部生产验证”。

常规核心检查可运行 `moon check --target js`、`moon test --target js`、`moon test --target wasm-gc`。专项命令：

```sh
node tools/test-network.mjs
```

专项所需的参考环境和历史版本见原使用说明及 TESTING 文档；本轮回执只记录实际执行项，不声称上面所有参考服务在任意环境即装即跑。

未实现完整邮件应用或所有 IMAP 扩展；本轮本机 peer 测试不是所有真实邮箱服务商的验收。

## 复审材料状态

尚无完整同步调度或多服务商生产验证；离线报文和本地 peer 只能证明相应层。

2026-09-22 匿名新克隆成功；默认分支 `main`，核验公开提交 `4462b16b3a813a8011b397122b145027e8570880`。本轮源码修订仅在本地，尚未推送；此记录不证明当时报名表中的地址正确，也不证明新修订已上线。

[申报草稿](PROPOSAL.md) 已压缩为 30 行以内，并单独标明本项目仓库；[复核说明](REVIEW-RESPONSE.md) 区分材料错误、功能变化及尚未解决的问题。没有编造用户、设备接入、生产部署或评审认可。
