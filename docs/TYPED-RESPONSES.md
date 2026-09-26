# 0.6.0 有结构响应与 UID 读取投影

问题：原 `Response { line, literals }` 虽保住二进制字节，调用方仍得猜每个 literal 对应哪个 FETCH 字段，再从字符串提取 UID。字段顺序改变、扩展带入额外 literal 或最后命令失败时，文本切片很容易错绑身份。

## 实际核心 API

`Decoder` 和 `Session` 的旧接口保留，兼容原始事件消费者。新增 `Response::parse()` 把同一份已分帧响应转换为 `TypedResponse`：状态/响应码、继续请求或按线序排列的结构值。`ImapValue` 包含 atom、quoted、NIL、literal bytes、嵌套 list。每个 literal 只进入其原始结构位置；数字保留为 atom，使用方的投影再检查精确范围。

`completed_response(expected_tag, responses)` 接收含完成行的一次串行命令响应。只有最后且唯一的匹配 tagged OK 能构造不可直接伪造的 `CompletedResponse`。NO/BAD、错误 tag、BYE、未完成 continuation、尾随数据均失败，不能把之前的部分 SEARCH/FETCH 当成功结果。

- `selection(read_only=true)`：READ-ONLY完成码、UIDVALIDITY、可选UIDNEXT、EXISTS、FLAGS/PERMANENTFLAGS。UIDVALIDITY必须非零32位，重复和畸形字段拒绝。UIDNEXT是服务器预测，不是消息数量或末尾UID+1；老服务端未给出时为None，不编造默认值。
- `identity(mailbox, uid)`：身份由调用方的邮箱标识、UIDVALIDITY和UID组成。sequence number只作为临时位置。原Session在开始新SELECT/EXAMINE时立即解除旧选择，失败不会恢复旧邮箱。
- `uid_search()`：旧式SEARCH兼容路径；ESEARCH的UID、TAG、ALL/COUNT/MIN/MAX核验。范围规范化但不自动展开；`expand(limit=...)`上限100000且必须覆盖全量，否则失败。
- `fetch()`：按顺序保留未请求的FLAGS-only更新，UID可以缺失；完整BODY[]必须有UID。字段顺序无关，重复拒绝；BODY缺失、NIL与零字节literal分别表示。未知扩展与section以结构值保留，不猜成正文。

原始文本用于保留词法拼写和诊断，因此这里的结构保真不等于重新序列化逐字节一致。它是有界语法/读取层，不是完整ENVELOPE、BODYSTRUCTURE或所有IMAP扩展的对象模型。section token只保留当前可解析的括号形式，含引号的复杂section、literal8、QRESYNC/MODSEQ等不在高层支持范围。

## 非 Node 消费者

```sh
moon run examples/typed_read --target js
moon run examples/typed_read --target wasm-gc
```

两端预期：`mailbox=INBOX validity=77 uid=42 sequence=12 bytes=6`。原创合成wire包含NUL、非UTF8、CRLF和跨块正文；不经过文本替换。真实服务端证据另外记录，不将该示例称为真实邮箱使用。

Node `tools/typed-result.mjs` 只做JSON/hex适配；`tools/snapshot.mjs`现在调用编译的MoonBit投影，不再实现SELECT/SEARCH/FETCH语法正则。旧只读工作流仍拒绝未知FETCH属性，最多1000个UID；通用核心可保留它们供其他消费者解释。

## 失败和资源边界

单literal≤1MiB，单响应literal≤2MiB/64个，UTF8语法≤64KiB；结构深度32、8192个值。完成集合≤4096条、语法加payload≤8MiB。JSON宿主适配还限制18MiB序列化输入；这些是输入/结构限额，不是整个进程内存保证。

结构解析失败不会输出部分高层结果。通用核心不把所有未请求事件归属于当前命令，也不提供多命令并发关联。只读导出仍为非原子观测，预检/末检不能证明邮箱在整个期间不变；网络、TLS、认证、文件事务属于宿主职责。

## 依据

[RFC9051 UID身份](https://www.rfc-editor.org/rfc/rfc9051.html#section-2.3.1.1)、[FETCH](https://www.rfc-editor.org/rfc/rfc9051.html#section-7.5.2)、[ESEARCH](https://www.rfc-editor.org/rfc/rfc9051.html#section-7.3.4)。协议不是原创；增量是可由MoonBit调用方直接消费的结构和失败契约。没有真实外部用户或完整rev2合规声明。
