# IMAP UID 与 literal 邮件会话客户端 · 修订申报草稿

本项目仓库：https://github.com/huanglong44/moonbit-imap
模块 / 本地版本：`huanglong44/imap` / `0.4.0`；许可证：MIT。
修订状态：条件复审；本轮仅本地修订，未推送或提交表单。

## 任务与选择依据
按 UID 拉取邮件头/字节内容、处理 literal 和 continuation，并用 IDLE 感知邮箱变化，作为邮箱巡检/同步应用的底层。
需要 UID、literal、邮箱状态和 IDLE 的调用方可使用；区别于 SMTP/MIME 和 POP3，不能把三者包装为三个完整邮箱应用。

## 已实现内容
MoonBit 实现字节解析、命令校验、会话和 continuation；Node 提供 TCP/TLS、STARTTLS、超时及取消。
可复现任务：读取带 literal 的 UID FETCH 报文；按 README 构建后运行 `node examples/run-use-case.mjs`，输入与输出见 USE-CASE.md。
前一轮工程验证真实回环连接的命令、literal、IDLE 与错误路径验证通过；实际 API 和旧服务器对照范围见 README/TESTING。

## 原创、复用与差异
原创实现/参考来源/第三方材料许可按 README、DUPLICATION 与仓库来源说明披露；不将既有协议、算法、词库或规范发明归于本项目。
承认 SMTP/MIME 生态已有 MoonMailKit、moonmail、MoonMIME。这里是 IMAP 同步会话层，和邮件文本解析、POP3 UIDL 备份不同。
比较项目链接单列于 DUPLICATION.md，不作为本项目提交地址。检索范围不含完整未公开报名表，不能保证无重叠。

## 边界与剩余计划
未实现完整邮件应用或所有 IMAP 扩展；本轮本机 peer 测试不是所有真实邮箱服务商的验收。
尚无完整同步调度或多服务商生产验证；离线报文和本地 peer 只能证明相应层。
剩余计划：由对接团队核对真实表单链接、公开本轮对应提交及确认选题/换题流程；按实际接入输入补验证，避免以更多规则、测试数量或改名替代用途证据。
交付：MoonBit 库、限定宿主入口、可运行任务、源码/来源说明及分层验证证据；不承诺自动通过初审。
