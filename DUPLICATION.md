# IMAP 既有生态关系与新增范围 · 2026-09-23

IMAP、UID、EXAMINE和BODY.PEEK是既有协议语义，不是本项目提出。[RFC3501](https://www.rfc-editor.org/rfc/rfc3501.html)是现有实现使用的rev1语义来源；[RFC9051](https://www.rfc-editor.org/rfc/rfc9051.html)为后续rev2规范，不因引用它而声称完整rev2兼容。

[go-imap](https://github.com/emersion/go-imap)等成熟客户端已覆盖邮件访问用途。在已有宿主语言中接入邮箱时应评估这些实现，不能把新增只读流程说成无人做过。MoonBit邮件生态已有MoonMailKit、moonmail、MoonMIME等SMTP/MIME项目；旧检索及固定来源保存在 [此前说明](docs/before-uid-snapshot/DUPLICATION.md)与原创新性复核证据。

本项目核心是MoonBit的字节解析、literal与会话状态；Node提供网络和应用编排。SMTP投递、MIME解析与IMAP邮箱访问分属不同层，但这种分层本身不证明本项目具有足够创新性。

0.5.0具体增加现有核心上的`readOnlySnapshot`：UID身份/大小预检、只读读取、观测竞态拒绝和结果清单；用未经修改的GreenMail验证字节和未读状态。此处没有重新实现MIME库、没有接入或宣称扩展相关SMTP/MIME库，也不把测试服务器或Node I/O当作MoonBit原创能力。

本轮官方注册表IMAP关键词检索记录归入总交付`REGISTRY-SEARCH.json`；搜索未命中不证明生态空白。检索不覆盖私有仓库和完整报名表，不保证没有其它同范围参赛项目。

本次整改针对已收到的“完整性/真实场景证据不符”，不是新增首创声明。当前无使用方或生产邮箱部署；是否值得纳入生态应由实际接入需求、实现边界和评审判断决定。
