# MoonBit IMAP 结构响应与 UID 会话核心

仓库：[https://github.com/huanglong44/moonbit-imap](https://github.com/huanglong44/moonbit-imap)

模块 `huanglong44/imap`，本地 **0.7.0**，MIT。初审驳回后的本地整改，未推送、发布或提交复申，没有已证实的真实用户部署。

MoonBit 调用方需要从增量网络字节获得与正确UID绑定的正文和状态，而不能把正文块的下标、message sequence number或未完成响应当作身份。核心提供字节Decoder、串行Session，以及新增的结构响应、成功完成门槛和有界UID读取投影。

`Response::parse()` 将literal放回结构位置，保留未知扩展；`completed_response(expected_tag, responses)`只接受匹配的最终tagged OK，再提供selection、UID SEARCH/ESEARCH和有限FETCH对象。响应字段乱序、额外literal、NUL/非UTF8正文不靠宿主正则解析。只读Node消费流程已使用这一核心，网络/TLS/文件仍由宿主负责。

## 可直接消费的 MoonBit API

```moonbit
let decoder = @imap.Decoder::new()
let responses = decoder.feed(wire_bytes)
decoder.finish()
let complete = @imap.completed_response(expected_tag, responses)
let records = complete.fetch()
```

实际独立消费例子不依赖Node解析或文件宿主：

```sh
moon run examples/typed_read --target js
moon run examples/typed_read --target wasm-gc
```

预期 `mailbox=INBOX validity=77 uid=42 sequence=12 bytes=6`。这是原创合成wire例子；独立服务器和输入界限见 [TESTING](TESTING.md)。完整契约见 [TYPED-RESPONSES](docs/TYPED-RESPONSES.md)，签名见 [公共API](pkg.generated.mbti)。

## 实际文件工作流

`tools/client.mjs`提供默认TLS的Node客户端；`tools/snapshot.mjs`按邮箱、UIDVALIDITY、UID读取小型邮箱，先核对大小，再用BODY.PEEK读取，并在结束前复查身份与UID集合。`tools/typed-result.mjs`只适配JSON/hex，SELECT/SEARCH/FETCH语法由MoonBit解释。

按TESTING设置GreenMail2.1.13制品后：

```sh
moon build --target js
node -e "require('node:fs').copyFileSync('_build/js/debug/build/cmd/web/web.js','web/engine.mjs')"
node examples/run-uid-snapshot.mjs
```

运行器启动未经修改的独立服务端，准备两封原创合成邮件；第二个连接只读导出、逐字节核对、检查仍未读和重复哈希，保存到新临时目录。这里验证真实服务器实现，邮件仍是合成数据，不是已有用户案例。

## 完整的单向磁盘归档

新增 `archiveMailbox` 逐封写入隐藏 Maildir，最终 UID 集合和 UIDVALIDITY 复查通过才发布；保存来源、身份、字节长度和 SHA-256 清单，失败目录不作为完整输出。协议解释仍由 MoonBit 核心执行，文件宿主不累积全部正文。命令、资源与失败边界见 [归档合同](MAILDIR-ARCHIVE.md)。

`node examples/run-maildir-archive.mjs` 实跑独立 GreenMail → 原字节 Maildir → Python 标准库读取，两封合成邮件包含 NUL/非 UTF-8 字节，服务器保持未读。成熟的 isync/mbsync 已提供 IMAP/Maildir 同步；这里提供 MoonBit 核心的有限单向消费流程，不主张这一场景是新发明。

## 明确边界

- 保留旧原始Response/Session接口。新AST是有界结构层；不声称完整ENVELOPE/BODYSTRUCTURE、literal8或所有扩展语义。
- UID结果严格区分sequence number与持久身份；UIDNEXT是预测值，可缺失，不能生成虚构消息。ESEARCH大集合保持范围，拒绝无界展开。
- 单literal≤1MiB、每响应≤2MiB/64个literal/64KiB UTF8语法、结构深度32、8192值；一次完成集合≤4096条/8MiB。JSON适配限制18MiB输入；不是进程内存硬配额。
- Node导出默认100封/16MiB、最多1000封/64MiB，每封≤1MiB。未知FETCH属性在通用AST保留，但只读导出profile明确拒绝。缺失正文、NIL与空正文不混同。
- 导出非原子；身份与集合复查不能证明中间从未改变。没有OAuth、QRESYNC/CONDSTORE、断点恢复、事务备份、并发命令关联或完整IMAP4rev2承诺。出错不返回部分高层成功，调用方负责关闭连接。新归档提供进程内的隐藏目录发布边界，仍不承诺崩溃持久事务。

## 已有生态与初审回应

IMAP/UID语义来自既有规范，go-imap等已有成熟客户端，MoonBit已有SMTP/MIME邻近项目。本项目不称首个/生态空白，不以网络适配或测试数量冒充算法创新。新增作用是让MoonBit应用直接组合协议结构、字节正文和UID失败契约；MIME解析可以在后续交给已有库。

本地与远端状态分开记录：[能力矩阵](CAPABILITY-MATRIX.md)、[复核说明](REVIEW-RESPONSE.md)、[申报正文](PROPOSAL.md)。旧0.5材料和测试回执为历史；申报人需将报名表、源码和附件同步到同一提交。固定工具链见 [TOOLCHAIN](TOOLCHAIN.md)。

## 本地验收与公开交付（2026-09-28）

核心实现使用 MoonBit；[固定编译器](.moonbit-version)为 `moonc 0.10.14+7d59c7ec9`。先按本文安装宿主依赖、运行 `moon update`，再从仓库根目录执行以下与 [CI](.github/workflows/ci.yml) 对齐的检查；可运行任务和适用边界见本文前面的示例与说明。

```sh
moon check --deny-warn
moon test --target wasm-gc --deny-warn
moon test --target js --deny-warn
moon build --target js --deny-warn
moon package
```

跨平台复核（2026-09-28，本地 Ubuntu-D 26.04 WSL2）：从当时的源码归档全新解包，固定 `moonc 0.10.14+7d59c7ec9` 下通过 `moon update`、`moon fmt --check`、`moon info`、严格检查、JS/Wasm-GC 测试及 JS release 构建；Node 24.21.0 跑通本仓一条宿主入口。本次补记仅修改文档，代码与 CI 未变；复核日志在本地交接包中，公开提交后的 GitHub Actions 仍须单独核对。

专项复核：经散列核验的 GreenMail 2.1.13 上，UID 快照复读一致且保留未读状态；两封合成邮件的 Maildir 原字节由 Python 3.12 `mailbox.Maildir` 独立读回。此 WSL 环境需显式设置 `PYTHON` 路径。

本地核验：JS/Wasm-GC 测试、UID 示例、网络/STARTTLS、快照归档和 GreenMail 互通检查通过。 `moon package` 已完成离线打包预检，它不等于已发布到 Mooncakes。


**公开状态（2026-09-29 核对）**：GitHub [公开仓库](https://github.com/huanglong44/moonbit-imap)、[Mooncakes 0.7.0](https://mooncakes.io/docs/huanglong44/imap@0.7.0) 已可访问；[CI 成功记录](https://github.com/huanglong44/moonbit-imap/actions/runs/36436025211) 对应 `cfdb9074db71`。本次材料更新尚未推送；该远端 CI 对应所列公开提交。报名表一致性及赛事审核结果尚未核实。
