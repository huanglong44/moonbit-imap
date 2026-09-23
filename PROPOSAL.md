# MoonBit IMAP 会话库与只读 UID 邮件导出 · 修订申报草稿

本项目仓库：https://github.com/huanglong44/moonbit-imap
模块 / 本地版本：`huanglong44/imap` / `0.5.0`；MIT。
状态：已收到初审驳回；本地整改，未推送或提交复申。

## 具体任务与交付
将小型邮箱中的原始邮件按邮箱、UIDVALIDITY、UID导出，并记录大小和SHA-256，不改变已读标记。
MoonBit负责Decoder/Session、字节literal与会话约束；Node负责TCP/TLS/STARTTLS、文件和流程编排。
新增readOnlySnapshot：EXAMINE确认只读、UID SEARCH、大小预检、BODY.PEEK读取、末次集合/UIDVALIDITY检查；异常不返回部分成功。
交付库源码、Node入口、独立服务器复现脚本、原始邮件产物、逐项能力证据矩阵及失败测试。

## 已有工作与本项目关系
IMAP及UID语义来自既有规范；go-imap等已有成熟客户端，MoonBit生态已有SMTP/MIME项目，不再宣称生态空白。
新增内容是既有MoonBit会话核心上的有界只读流程及失败处理，不把协议、Node网络I/O、测试服务器或通用脚本计作原创算法。
未直接复用SMTP/MIME解析器，也未宣称上游认可或已有用户；相邻项目与本实现分工见DUPLICATION.md。

## 可复现实证
按TESTING.md准备固定GreenMail2.1.13后，构建并运行node examples/run-uid-snapshot.mjs。
真实独立服务端、两次连接、两封原创合成邮件：字节相同、未读标记保持、重复读取哈希一致，产出.eml与manifest。
2026-09-23核心JS/Wasm-GC各22项、12组新边界、8组TCP/TLS、17组STARTTLS、7组既有GreenMail流程通过。
测试环境是回环TCP；TLS/STARTTLS来自自编测试端。旧Dovecot记录本轮未重跑；无真实用户或生产邮箱验收。

## 范围与成熟度
单封最多1MiB，默认100封/16MiB；只接受明确的SEARCH/FETCH响应子集，未知属性拒绝。
这是非原子只读导出：不支持大附件流式下载、断点续传、全量增量同步、OAuth、QRESYNC/CONDSTORE、完整IMAP4rev2或MIME应用。
尚需实际使用方输入与多服务商接入验证；不得据本地测试承诺通用生产成熟度或初审通过。
对接团队需替换旧申报表正文，并将仓库、材料和本地提交统一后再复申。
