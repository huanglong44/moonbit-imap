# 功能与兼容性边界

| 能力 | 当前状态 | 证据/边界 |
|---|---|---|
| 响应流 | 字节增量、CRLF、任意字节 literal、多 literal、资源限制 | 16 项 JS 测试含旧分割测试及 1 MiB 分片；尚非完整 IMAP 响应 AST |
| 会话状态 | Greeting/未认证/已认证/已选择/关闭；大小写状态、标签匹配、失败后终止 | SELECT 失败会取消旧选择，CLOSE/UNSELECT 返回认证态 |
| 命令 | 常见 rev1 命令、UID FETCH/SEARCH/STORE/COPY/MOVE | 参数安全与状态校验，SEARCH/FETCH 具体语义由服务器处理 |
| 认证 | LOGIN、SASL PLAIN continuation、认证后能力更新 | PLAIN 核心/自编 TCP/TLS 场景通过；独立 GreenMail 不提供 PLAIN |
| 上传 | 同步 APPEND，等待 continuation，精确正文长度 | GreenMail 接收成功；最大 1 MiB，无 internal-date/多 literal APPEND |
| 通知 | IDLE、更新回调、DONE、自动截止、禁止插入命令 | 自编 fixture 和独立 GreenMail；无自动续订/断线重连 |
| 中文邮件夹 | RFC 3501 modified UTF-7 与严格解码，包含代理对 | RFC 向量及 GreenMail CREATE/LIST 通过；不含 UTF8=ACCEPT |
| 网络 | Node TCP/隐式 TLS、证书与主机名校验、超时、AbortSignal、收集上限 | 8 组回环验证；真实独立服务器 TCP 7 条流程 |

仍缺 STARTTLS、其它 SASL/SASLprep、完整 FETCH/ENVELOPE/BODYSTRUCTURE 对象、查询构造、流水线、selected mailbox 状态跟踪、多服务端/跨平台/长期与代表性性能证据。原型的已有工程文件不能代替这些能力。

浏览器与旧 CLI 仍是响应流离线审查。真实联网由 tools/client.mjs 提供，无需安装 MoonBit；编译产物来自本仓库源码，不依赖其它候选仓库。
