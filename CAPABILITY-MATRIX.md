# 0.7.0 当前交付边界

| 能力 | 核心/宿主与入口 | 当前证据 | 不得外推 |
|---|---|---|---|
| 增量字节/会话 | MoonBit Decoder、Session | 原22测试与新结构测试共29组；JS/Wasm-GC | 不自带网络/TLS |
| 结构响应 | MoonBit Response.parse、ImapValue | 任意切点、多literal、未知嵌套、字节保真与限额 | 不是所有扩展完整对象模型 |
| 提交边界 | MoonBit completed_response | 错tag、NO/BAD、缺完成、尾随数据拒绝 | 不支持并发命令关联 |
| 选择/身份 | selection、identity | UIDVALIDITY冲突/范围、READ-ONLY、世代变化 | UIDNEXT不是精确消息数量；不维护完整邮箱索引 |
| UID集合 | uid_search、UidSet | SEARCH/ESEARCH关联、计数、MIN/MAX、巨大范围不展开 | 非完整搜索构造器；未知return item拒绝 |
| FETCH投影 | fetch | 属性乱序、多个literal、缺失/NIL/空正文、未请求FLAGS | 未解释BODYSTRUCTURE、section/partial、MODSEQ |
| 只读文件示例 | Node readOnlySnapshot调用MoonBit投影 | 13组自编TCP故障场景、独立GreenMail两封邮件 | 非原子、不支持同步恢复，不是实际用户部署 |
| 单向Maildir归档 | Node archiveMailbox + MoonBit UID核心 | 6组故障/发布检查、GreenMail两封含二进制邮件→Python标准库读取 | 不复制FLAGS、不提供双向同步/断点续传、非原子网络快照 |
| TLS/认证 | Node ImapClient | 固定既有测试；独立服务器本轮情况见TESTING | 不等于所有提供商认证/OAuth |
| 真实用户 | 未证实 | 无 | 不编造采用、认可或生产成熟度 |

各自预算、接口契约见docs/TYPED-RESPONSES.md；源代码绑定回执保存在evidence/typed-20260927。旧日期回执仅证明历史版本，远端CI与发布未执行。

0.7.0只改Node宿主消费流程，当前证据在evidence/archive-20260927；前述MoonBit核心测试属于0.6.0基线，没有重新计作新增执行。
