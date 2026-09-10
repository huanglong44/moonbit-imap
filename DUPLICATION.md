# 查重范围与结论

2026-09-10 对关键词 `imap` 查询 Mooncakes 官方包索引及 GitHub `imap language:MoonBit`；后者返回 0 个仓库。

在此公开检索范围内未发现同范围直接实现。**这不是全网无重复证明**，未覆盖全代码搜索、私有仓库、别名及完整比赛报名表。原始 URL 与返回摘要见 [证据](evidence/duplication.json)。

规格参考：[https://www.rfc-editor.org/rfc/rfc3501](https://www.rfc-editor.org/rfc/rfc3501)。


## 0.3 对标补充

本次读取 go-imap 官方包文档、RFC 3501/2177 和 GreenMail 官方材料，按连接、认证、literal、IDLE、命令与状态跟踪能力确定差距。引入的是独立测试依赖，没有复制其源码。未重跑完整生态查重，也不新增“不会撞题”的保证。
