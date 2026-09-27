# 有界 IMAP → Maildir 归档 · 0.7.0

用途：MoonBit 邮件处理应用读取一个小型邮箱，将协议核心确认了 UID 与正文对应关系的原字节交给磁盘消费者。最终再次观察 UID 集合和 UIDVALIDITY 后，才发布可打开的 Maildir；失败的中间文件不混入成功输出。没有已确认使用方，本例不是客户部署案例。

## 运行与消费

先构建 README 中的 JS 引擎。真实账号入口默认验证 TLS、固定 993 端口：

```sh
node tools/archive.mjs imap.example.org account INBOX NEW_OUTPUT_DIRECTORY
```

密码从调用环境的 `IMAP_ARCHIVE_PASSWORD` 读取，不放在命令行或回执中。调用方自行设置该环境变量；不在仓库保存真实凭据。CLI 退出 0 表示归档发布，退出 2 表示未完成。输出目录必须不存在，父目录须已存在；即使既有目录为空也拒绝。

程序化使用已认证且独占的客户端：

```js
import {archiveMailbox} from './tools/archive.mjs';
try {
  const receipt = await archiveMailbox(client, '/chosen/new-directory', {
    sourceId: 'chosen-server/account', mailbox: 'INBOX',
    maxMessages: 100, maxMessageBytes: 1048576, maxBytes: 16777216,
  });
  console.log(receipt.messages);
} finally {
  client.close();
}
```

`sourceId` 是调用方提供的账号来源名称，库无法独立核实账号归属；CLI 记录 host/user/port。身份范围为来源、邮箱、UIDVALIDITY、UID，不能跨账号只按 UID 去重。邮箱名仅写入清单，不拼文件路径。

成功产物为 `maildir/{tmp,new,cur}` 和 `maildir/.imap-complete.json`。每封原字节文件是 `new/uid-<UIDVALIDITY>-<UID>`，清单含长度和 SHA-256。标准 Maildir 阅读器可读取；这不是 mbsync 的 UID 状态文件格式，不能当作其增量同步数据库。

## 完成与失败合同

1. 独占建立新输出及 `.maildir.partial`；正式 `maildir` 暂不存在。
2. EXAMINE/UID SEARCH，逐封先核对大小，再 BODY.PEEK[]；MoonBit 结构响应核心确认 tagged OK、UID、literal 关联和资源预算。
3. 每封等待磁盘写入关闭后才读取下一封，不累积全部正文。内部保留有界 UID/摘要清单；单封仍整体在内存中解码，不是逐字节大附件下载。
4. 复查 UID 集合与 UIDVALIDITY；通过后写完成清单，再同目录重命名发布。

读取、预算、磁盘或身份检查失败时抛错，CLI 退出 2；留下 `.maildir.partial` 和尽力写入的 `incomplete.json` 便于诊断。不能把暂存内的完成清单单独当作发布成功，消费者要求正式 `maildir` 与其中完成清单同时存在；校验每封文件哈希可发现之后的损坏。重试用新目录，程序不会覆盖或自动清理旧输出。

调用方在全过程须独占客户端和输出目录。没有原子远程快照：两次集合检查无法排除不可见的中间变化。文件 fsync 不等于目录 fsync/断电恢复；不承诺崩溃持久事务。服务端 FLAGS 不复制，归档邮件放在 new 中，`flagsPreserved:false`；BODY.PEEK 保持服务器未读状态。无双向同步、远程删除、增量恢复、跨邮箱账号编排或 OAuth。

底层 `streamReadOnlySnapshot(client, onMessage, options)` 等待每次回调，最终只返回元数据；回调结果在函数成功返回前都是暂存数据，回调不得向同一客户端发命令。兼容的 `readOnlySnapshot` 继续收集所有正文。

## 已有工具、分工和实跑

[isync/mbsync](https://isync.sourceforge.io/mbsync.html) 已实现成熟的 IMAP 与 Maildir 双向同步；本项目不声称发明这一用途或替代它。新增交付是现有 MoonBit Decoder/Session/结构 UID 核心的可运行单向磁盘消费者，网络/TLS/文件发布由 Node 宿主负责。身份约束来自 [RFC 9051](https://www.rfc-editor.org/rfc/rfc9051.html)，MIME 交给外部现有库，未在此重写。

设置 TESTING 中固定 GreenMail JAR 后，运行：

```sh
node tools/test-archive.mjs
node examples/run-maildir-archive.mjs
```

独立 GreenMail 2.1.13 读取两封原创合成邮件，其中一封正文有 NUL/0xff；[Python mailbox.Maildir](https://docs.python.org/3/library/mailbox.html) 独立打开产物逐字节读取并核对摘要，服务器仍未读。6 组自编故障场景检查背压、二进制/空邮箱、UID增删/世代变化、磁盘失败、输出冲突及超限；它们不是独立服务端证据。当前回执见 `evidence/archive-20260927/`，远程 CI 未执行。
