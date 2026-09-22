# IMAP UID 与 literal 邮件会话客户端

本地申报候选材料，2026-09-22；模块 `huanglong44/imap`，版本 `0.4.0`。团队的公开仓库可能还是先前提交，本次没有推送；最终表单必须指向团队实际上传版本。

## 要解决的任务

按 UID 拉取邮件头/字节内容、处理 literal 和 continuation，并用 IDLE 感知邮箱变化，作为邮箱巡检/同步应用的底层。

以下是目标任务和可复现工程证据，不虚构客户、存量部署或采用人数。

## 现有工作与新增贡献

承认 SMTP/MIME 生态已有 MoonMailKit、moonmail、MoonMIME。这里是 IMAP 同步会话层，和邮件文本解析、POP3 UIDL 备份不同。 检索原始响应在总交付包的创新性复核目录保存。

MoonBit 实现字节解析、命令校验、会话和 continuation；Node 提供 TCP/TLS、STARTTLS、超时及取消。



## 可复现路径

仓库附编译引擎；修改源码后先构建。参考工具的额外依赖与环境变量见 TESTING.md；测试创建的网络服务仅在本机。

```sh
node tools/test-network.mjs
```

本轮真实回环连接的命令、literal、IDLE 与错误路径验证通过；实际 API 和旧服务器对照范围见 README/TESTING。 本轮 JS/WasmGC 核心测试及 JS 构建通过，原始日志见 [本轮验证](evidence/innovation-review-20260922/results.json)。测试数量证明所列范围，不能代替创新性论证或推断正式审核通过。

## 边界与来源

未实现完整邮件应用或所有 IMAP 扩展；本轮本机 peer 测试不是所有真实邮箱服务商的验收。

许可证与来源沿用仓库现有 LICENSE/第三方说明，不将标准、算法、词库或参考软件写成本项目发明。查重不是对全生态不存在的证明，日期、相邻项与未覆盖范围见 [DUPLICATION.md](DUPLICATION.md)。
