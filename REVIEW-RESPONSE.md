# IMAP 初审复核说明 · 本地0.7.0

仓库：https://github.com/huanglong44/moonbit-imap

接受“完整性、真实场景表述与证据不一致”的问题。此前字节分帧和宿主快照不足以支持完整类型化协议或真实部署成熟度，我们已撤回这类表述。

本次进一步修改了实际核心：新增保序响应结构、literal原位绑定、UID/sequence区分、最终tagged OK后才提供高层结果，以及选择信息、SEARCH/ESEARCH和有限FETCH投影。宿主只读流程已调用这些MoonBit API，不再靠SELECT/SEARCH/FETCH正则猜测正文归属。纯MoonBit消费者在JS/Wasm-GC可运行。

输入分片、额外literal、未知扩展、非UTF8正文、重复UID、巨大范围、缺失完成/NO/BAD等均有对应验证。独立服务器执行与自编故障peer分开记录，具体当前结果见TESTING。合成测试邮件没有被写成实际用户采用；未声称厂商邮箱或长期生产运行验证。

0.7.0另补完整的有限归档任务：逐封读取写入隐藏Maildir，最终UID身份检查成功才发布，独立GreenMail与Python Maildir读取确认原始二进制和来源清单。没有把服务器互通写成已有用户采用；没有把成熟mbsync的用途写成本项目原创。

交付标题限定为“MoonBit IMAP结构响应与UID会话核心”。未知扩展在AST保存，但高层profile有明确拒绝范围；没有完整BODYSTRUCTURE、OAuth、QRESYNC、流水线或完整rev2。导出仍为非原子观测，新磁盘流程有隐藏目录发布边界，仍不保证断电持久事务或同步恢复。

请依据当前API、源码、能力矩阵和独立复现重新判断。团队需同步同一0.7.0提交和申报表；这份说明尚未发送，不代表复审通过。
