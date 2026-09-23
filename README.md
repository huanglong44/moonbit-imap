# MoonBit IMAP 会话库与只读 UID 邮件导出

**本项目仓库：[https://github.com/huanglong44/moonbit-imap](https://github.com/huanglong44/moonbit-imap)**

模块 `huanglong44/imap`，本地 **0.5.0**，MIT。当前状态：收到初审驳回后的本地整改稿，未推送、发布或提交复申；尚无实际用户部署验证。

## 一个明确的任务

在不改变邮件已读标记的前提下，把一个小型邮箱中的原始邮件按 **邮箱 + UIDVALIDITY + UID** 导出为 `.eml` 和 SHA-256 清单。适合在接入邮件处理程序之前生成可追踪的输入副本；这里提供的是可复现工程流程，没有声称已有使用方。

MoonBit 的 `Decoder` / `Session` 负责字节、命令和会话状态；Node 的 `ImapClient` 负责连接。新增 `readOnlySnapshot` 用 EXAMINE、UID SEARCH 和 BODY.PEEK 组合现有能力，先检查大小，再读取内容，最后重查 UID 集合和 UIDVALIDITY。发现身份变化、缺失或大小不一致会报错，不返回部分成功。它不是原子快照，也不是增量同步/完整备份产品。

## 独立服务器复现

安装 MoonBit、Node.js 24 和 Java 21+，按 [TESTING](TESTING.md) 下载固定 GreenMail 2.1.13 JAR 并设置 `GREENMAIL_JAR`。在仓库根目录运行：

```sh
moon build --target js
node -e "require('node:fs').copyFileSync('_build/js/debug/build/cmd/web/web.js','web/engine.mjs')"
node examples/run-uid-snapshot.mjs
```

运行器启动未经修改的 GreenMail 独立服务器，只监听本机随机端口。准备连接写入两封原创合成邮件后退出；另一个连接只读导出、核对字节、检查两封仍未读、再次读取比对哈希。结果保存到打印出的新临时目录：`1.eml`、`2.eml`、`manifest.json`。邮件和服务器是本地测试环境；没有连接真实用户邮箱。

最新保存产物：[清单](evidence/uid-snapshot-20260923/independent-example/manifest.json)、[执行记录](evidence/uid-snapshot-20260923/LOCAL-CHECKS.json)。UIDVALIDITY 与临时路径随运行变化，不作为确定性 golden。

## 调用现有邮箱

```js
import {ImapClient} from './tools/client.mjs';
import {readOnlySnapshot} from './tools/snapshot.mjs';
const client = await ImapClient.connect({host: process.env.IMAP_HOST}); // 默认 TLS / 993
try {
  await client.login(process.env.IMAP_USER, process.env.IMAP_PASSWORD);
  const result = await readOnlySnapshot(client, {mailbox: 'INBOX', maxMessages: 50});
  // result.messages 为 {uid, size, sha256, body: Buffer}；存储策略由调用方决定。
} finally { client.close(); }
```

以上是调用示意，本轮没有拿真实凭据运行。辅助函数必须独占已认证的客户端；同一客户端上的两个辅助函数会被拒绝，但调用方仍须避免穿插其它命令。出错后由调用方关闭连接或重新选择邮箱；不会自动重试或恢复旧游标。

## 当前边界

- 单封正文上限 1 MiB；默认最多 100 封、合计 16 MiB，可配置至 1000 封/64 MiB。先用服务器声明大小预检，实际字节再校验；不是流式大附件下载器或进程内存硬配额。
- 新辅助函数只接受普通 SEARCH，以及 UID / RFC822.SIZE / BODY[] literal / 平面 FLAGS 的限定 FETCH 响应；未知属性会拒绝。一般客户端仍返回原始响应行与 literal，不提供完整类型化 BODYSTRUCTURE。
- 返回 `atomic:false`：两次观测之间及末次检查之后仍可能变化；没有事务快照、QRESYNC/CONDSTORE、断点续传、OAuth、MIME 附件提取、多账号调度或 IMAP4rev2 完整兼容承诺。
- 导出例子把清单最后写入新目录；失败可能留下未完成目录，未实现跨文件事务。只读辅助函数没有 APPEND/STORE/EXPUNGE；例子的准备阶段会向临时服务器 APPEND。

[能力与证据矩阵](CAPABILITY-MATRIX.md)逐项区分 MoonBit 核心、Node 宿主、新辅助函数、本轮实跑及历史记录。[USE-CASE](USE-CASE.md)说明输入输出和失败语义。[公共核心 API](pkg.generated.mbti)与 [客户端源码](tools/client.mjs)给出实际入口。

## 验证、来源与初审回应

2026-09-23：核心 JS/Wasm-GC 各 22 项；12 组新只读流程边界、8 组原 TCP/TLS、17 组 STARTTLS、7 组 GreenMail 原流程及新独立导出均通过。GreenMail 本轮使用回环 TCP；TLS/STARTTLS 本轮来自自编测试端。旧 Dovecot 2.4.2 记录保留但本轮未重跑，不能合并称为新功能生产验收。完整命令和未执行项见 [TESTING](TESTING.md)。

IMAP 是既有协议，已有 go-imap 等成熟实现，MoonBit 邮件生态也有 SMTP/MIME 库。本项目不声称生态空白；新增价值限于可供 MoonBit 字节/会话核心调用方复用的 Node 只读流程与可检验的失败边界，Node I/O 不称为 MoonBit 原生网络栈。详见 [DUPLICATION](DUPLICATION.md)。

针对“完整性、真实场景表述与证据不一致”，已重写 [申报草稿](PROPOSAL.md) 和 [复核回应](REVIEW-RESPONSE.md)，并保存 [此前材料](docs/before-uid-snapshot/README.md)。对接团队需要让报名表、公开仓库和附件指向同一版本；本地整改不等于初审通过。
