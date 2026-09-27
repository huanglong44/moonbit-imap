# 0.7.0 · 2026-09-27 · local only

- Add awaited per-message snapshot consumption; retain the body-collecting API for compatibility.
- Publish a new standard Maildir only after observed final UID-set and UIDVALIDITY checks; record caller source identity, byte sizes and hashes. Leave failures explicitly incomplete.
- Run the actual GreenMail server and Python standard-library Maildir reader on two original messages, including NUL/non-UTF-8 content; add bounded failure/publication checks.
- Keep the existing MoonBit core/API/engine unchanged. No synchronization, flags replication or atomic remote snapshot claim; no public release performed.

## 0.5.0

- 新增Node只读UID邮件导出辅助函数：EXAMINE/BODY.PEEK、身份与大小约束、末次观测检查，明确非原子。
- 新增独立GreenMail导出与12组失败边界，输出原始邮件及SHA-256清单；未声称真实用户部署。
- 按IMAP初审意见重写申报、能力矩阵与成熟度界限，区分本轮与历史验证。

## 0.4.0

- STARTTLS 命令与传输升级，独占会话、清空未加密能力并重新查询。
- 拒绝升级后的明文注入；握手错误、证书错误、超时或取消关闭连接。
- PLAIN 异常挑战取消；取消后的伪造成功不会进入已认证状态。
- Dovecot 2.4.2 实际 TLS/PLAIN、邮箱读写和 IDLE 互通；JS/Wasm-GC 均运行当前核心测试。
## 0.3.0

- 按字节处理响应分片，不再在每个分片复制整份已收到邮件。
- 修复文本末尾花括号被当 literal、宽松 greeting 前缀、状态大小写和 SELECT 失败状态。
- 常见邮件夹命令、UID 查询/修改/复制、同步 APPEND、PLAIN、IDLE/DONE。
- modified UTF-7 邮件夹编解码，含 RFC 黄金向量。
- Node TCP/隐式 TLS、固定超时、取消、资源清理、响应收集限制和能力缓存。
- 16 项 JS、8 组 TCP/TLS 通过；GreenMail 独立服务器 7 条流程通过。独立 PLAIN 未运行。
- Decoder/Session 内部字段改为私有，新增公开状态/能力/continuation 方法。

最后修补了跨 literal 的 UTF-8 语法预算累计，额外 1 个定向边界用例通过；原 16 项项目测试未重复全量运行。
