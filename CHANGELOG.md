## 0.3.0

- 按字节处理响应分片，不再在每个分片复制整份已收到邮件。
- 修复文本末尾花括号被当 literal、宽松 greeting 前缀、状态大小写和 SELECT 失败状态。
- 常见邮件夹命令、UID 查询/修改/复制、同步 APPEND、PLAIN、IDLE/DONE。
- modified UTF-7 邮件夹编解码，含 RFC 黄金向量。
- Node TCP/隐式 TLS、固定超时、取消、资源清理、响应收集限制和能力缓存。
- 16 项 JS、8 组 TCP/TLS 通过；GreenMail 独立服务器 7 条流程通过。独立 PLAIN 未运行。
- Decoder/Session 内部字段改为私有，新增公开状态/能力/continuation 方法。

最后修补了跨 literal 的 UTF-8 语法预算累计，额外 1 个定向边界用例通过；原 16 项项目测试未重复全量运行。
