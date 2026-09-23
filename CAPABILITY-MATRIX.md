# 0.5.0 交付边界与证据矩阵

本页是当前承诺，优先于旧申报和历史记录。没有完整兼容或生产成熟声明。

| 层 / 能力 | 实际入口 | 本轮证据 | 明确边界 |
|---|---|---|---|
| MoonBit 响应与 literal 字节 | `Decoder.feed/finish` | JS/Wasm-GC各22项整体核心测试；新辅助函数经同一引擎读二进制 | 原始行+literal数组；不是完整 FETCH/BODYSTRUCTURE 对象树 |
| MoonBit 会话和命令 | `Session.command/feed/literal/done` | 核心测试、原网络/STARTTLS流程 | 每次一个命令；字节输出不等于自身有网络能力 |
| 邮箱名字 / sequence-set | `encode_mailbox/decode_mailbox/valid_sequence_set` | 核心测试；GreenMail中文邮箱实际 CREATE/LIST | modified UTF-7；非所有命名扩展 |
| Node 网络与认证 | `ImapClient.connect/login/authenticatePlain/startTls` | 8组网络+17组升级测试；GreenMail LOGIN | TLS强制信任及主机名检查；PLAIN独立GreenMail未advertise故未跑；无OAuth |
| 常见读写命令 | `select/list/status/create/rename/deleteMailbox/fetch/search/store/copy/append/idle` | GreenMail7组独立命令流程 | 不是所有协议扩展；MOVE能力守卫存在，但不据此声称本轮独立MOVE验证 |
| 新只读导出 | `readOnlySnapshot` | GreenMail新例子：独立读连接、原始字节、仍未读、重复哈希 | Node编排；限定FETCH配置；预检/末检不是原子事务 |
| 失败与预算 | `tools/test-snapshot.mjs` | 12组自编TCP端，包含身份变化、消失、超限、截断、歧义 | 自编恶意/竞态服务端，不冒充独立实现或生产故障 |
| `.eml` / 清单文件 | `examples/run-uid-snapshot.mjs` | 保存两封原始邮件及实际manifest | 新临时目录，清单最后写；失败可留目录；无恢复、去重存储/事务提交 |
| 历史独立TLS互通 | `tools/test-dovecot.mjs` | 2026-09-16的Dovecot2.4.2九项记录 | 2026-09-23未重跑，不覆盖新增辅助函数 |
| 真实用户 / 外部邮箱部署 | 无 | 无 | 未证实，不作为申报亮点 |

核心解析器上限来自 `decoder.mbt`：单literal 1MiB，单响应literal总量2MiB/最多64个，语法64KiB。Node单命令响应收集上限8MiB/4096条；新辅助函数单封1MiB、默认100封/16MiB，最大1000封/64MiB。声明大小在下载前检查，实际大小下载后核对。以上不等于整个进程峰值内存受同样数值严格约束。

从申报中撤回或不得外推：完整IMAP解释/全协议覆盖、生产可用完整邮箱同步、真实多服务商验证、任意大小附件、自动恢复同步状态。IDLE事件和UID原语存在，也不足以组成持久化增量同步系统。

完整返回结构、错误分类、原子性限制见 [USE-CASE](USE-CASE.md)。所有当前执行项与指纹见 [LOCAL-CHECKS](evidence/uid-snapshot-20260923/LOCAL-CHECKS.json)；旧证据保留原时间范围。
