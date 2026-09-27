# MoonBit IMAP 结构响应与 UID 会话核心 · 修订申报草稿

仓库：https://github.com/huanglong44/moonbit-imap
模块：huanglong44/imap；本地0.7.0；MIT。已收到初审驳回，目前仅本地修订。

目标是供MoonBit程序安全解释网络字节：正文可能包含NUL、非UTF8和CRLF，FETCH字段可以乱序，序列号不同于UID，未标记结果也不能证明命令成功。项目在原有Decoder/Session上增加结构响应、literal原位绑定、最终tagged OK提交门槛、选择状态、经典SEARCH/ESEARCH有界UID集合与有限FETCH对象。未知属性保留，无法解释或身份冲突明确拒绝。

新增语法与身份逻辑位于MoonBit核心，JS/Wasm-GC调用方使用同一公共API。Node仅承担TCP/TLS、JSON/hex适配及示例文件流程；原来由宿主正则提取UID/正文的实现已替换。核心消费者示例和只读小邮箱导出示例分别说明库用法与宿主集成。0.7.0补齐逐封落盘、结束身份复查后发布Maildir的实际消费者任务；原字节与来源/UID身份/哈希一起保存，失败暂存不冒充成功归档。独立GreenMail和Python Maildir读取共同验证该链路，详见MAILDIR-ARCHIVE。

IMAP不是新协议，go-imap等已有成熟实现，isync/mbsync已有成熟IMAP/Maildir同步，SMTP/MIME是相邻生态能力。本项目不主张生态空白、全协议兼容或算法原创；其交付作用是可复用的MoonBit会话/结构/UID读取契约，不重写MIME。独立服务器与故障证据见TESTING和CAPABILITY-MATRIX，严格区分合成邮件、真实服务端实现和未知的真实用户采用。

边界：单literal1MiB、单响应2MiB、完成集合8MiB，深度和UID展开有限；未实现完整BODYSTRUCTURE、OAuth、QRESYNC/CONDSTORE、literal8、流水线或完整rev2。只读导出非原子，不是生产邮箱同步/备份产品。测试结果不能外推多服务商、长期生产成熟度。

希望按当前可调用核心、复现入口和明确边界重新审核。公开仓库与报名表仍须团队同步，本地修改不等于已获通过。
