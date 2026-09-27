# 完整消费入口（0.7.0）

当前单向文件归档使用 `archiveMailbox(client, newDirectory, {sourceId, mailbox})`：按 UID 逐封写盘，结束复查成功后发布标准 Maildir，保留身份/哈希清单。正文不整体累积，失败暂存不能当完整成果，源邮件FLAGS不复制。

[运行与完成合同](MAILDIR-ARCHIVE.md)；[GreenMail→Maildir→Python 独立复现](examples/run-maildir-archive.mjs)。下文保留兼容的内存收集接口用法；该接口继续返回全部body，不代表新归档也在内存累积正文。

# 将限定邮箱只读导出为可追踪的原始邮件

任务：为下游邮件处理程序准备原始输入副本，同时保留邮箱身份和内容哈希。当前没有确认的真实使用方，选择这一流程是让交付范围可以被独立复现。

## 输入 → 行为 → 输出

`readOnlySnapshot(client, options)` 接受已认证且由调用方独占的 `ImapClient`。默认邮箱 INBOX、最多100封、单封1MiB、合计16MiB。可指定 `expectedUidValidity`，用于拒绝把旧UID解释为重建后邮箱的UID；本函数不读取或管理上次清单。

1. EXAMINE，要求明确READ-ONLY和唯一有效UIDVALIDITY；不符则停止。
2. UID SEARCH ALL，校验去歧义并排序；超过数量预算停止。
3. 逐UID读取RFC822.SIZE，在请求正文前检查单封与累计预算；随后读取BODY.PEEK[]，核对返回UID、大小、literal关联，保存Buffer与SHA-256。
4. 重读UID集合与UIDVALIDITY；出现观测到的新增、删除或重建则报错。返回 `atomic:false`，因为两次检查间仍可能发生无法观测的变化。

返回包含 `mailbox, uidValidity, uids, bytes, messages, readOnly, atomic, observedUidSetStable`。每封是 `{uid, size, sha256, body: Buffer}`；跨账号使用时账号身份必须由调用方单独记录。只有一次函数成功返回才有完整结果，出错不提供部分成功的messages。

## 错误与资源

| 情形 | 行为 |
|---|---|
| 数量/单封/合计超过预算 | `SnapshotError.code = SNAPSHOT_LIMIT`；已声明超限的那一封不请求正文 |
| UIDVALIDITY不符、读取中集合变化、邮件消失、大小不一致 | `SNAPSHOT_CHANGED`；调用方重新检查，不自动重试 |
| READ-ONLY/UIDVALIDITY缺失、SEARCH歧义、未知FETCH属性 | `SNAPSHOT_PROTOCOL`；不猜测或静默忽略未知正文 |
| 同时对同一客户端启动第二次导出 | `SNAPSHOT_BUSY`；仍需调用方禁止其它普通命令插入 |
| NO/BAD、超时、截断、连接中断 | 原客户端错误向上抛出；连接错误关闭传输 |

辅助函数不拥有客户端生命周期，不主动logout或close；调用方用finally关闭。它只使用EXAMINE/UID SEARCH/UID FETCH，不发送STORE/EXPUNGE/APPEND。所有正文存在内存中，不支持大邮件分段流式下载；服务器谎报大小时读取后拒绝，解析器和客户端仍有各自的响应上限。

当前流程由MoonBit结构投影解释经典SEARCH/ESEARCH、UID、RFC822.SIZE、BODY[] literal及平面FLAGS。兼容乱序属性和不带UID的未请求FLAGS更新；其它属性、多个body或身份歧义会拒绝。不是通用BODYSTRUCTURE解析器。

## 独立复现与保存证据

按 [TESTING](TESTING.md) 准备Java/GreenMail，构建引擎后运行 `node examples/run-uid-snapshot.mjs`。准备连接向本地独立GreenMail写两封合成邮件；新的只读连接导出、检查UNSEEN、重复读取。输出目录中的 `.eml` 是从服务器实际读回的原始字节，`manifest.json`含服务端指纹、UIDVALIDITY和哈希。清单最后写入，但没有跨文件原子提交或失败目录清理保证。

旧 `examples/use-case/fetch.txt` 和 `node tools/cli.mjs --file examples/use-case/fetch.txt`仍可测试离线解析；它们不能替代网络流程验证。GreenMail只监听回环TCP，新例子没有测试真实邮箱凭据、TLS部署、生产邮件、长期连接或同步恢复。
