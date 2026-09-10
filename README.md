# IMAP4 会话与客户端

本地候选版 **0.3.0**。MoonBit 负责精确字节解析、命令校验、会话与 continuation 状态；Node.js 宿主提供 TCP/隐式 TLS、超时、取消和异步命令入口。仍在完善，未上传或发布。

## 真实客户端使用

```js
import {ImapClient} from './tools/client.mjs';

const client = await ImapClient.connect({
  host: process.env.IMAP_HOST,
  // 默认隐式 TLS，端口 993，强制证书信任和主机名验证。
});
try {
  await client.login(process.env.IMAP_USER, process.env.IMAP_PASSWORD);
  await client.select('INBOX', {readOnly: true});
  const result = await client.fetch('1:*', '(UID FLAGS RFC822.SIZE BODY.PEEK[HEADER])');
  for (const response of result.responses) {
    console.log(response.line);
    for (const literal of response.literals) console.log(literal.toString('utf8'));
  }
  await client.logout();
} finally {
  client.close();
}
```

命令返回 `{ok, status, completion, responses}`，服务器 NO/BAD 抛出带完整结果的 `ImapCommandError`。每个响应含原始语法行与 `Buffer[]` literals；二进制邮件不会通过文本解码器。此 API 暂不把完整 FETCH/ENVELOPE/BODYSTRUCTURE 转成高级对象。

```js
// 上传：等待服务端 continuation 后才发送正文。
await client.append('中文邮件夹', Buffer.from('Subject: test\r\n\r\nhello\r\n'), {
  flags: '\\Seen',
});
// UID 入口不会将 32 位 UID 误当序号。
await client.search('ALL', {uid: true});
await client.store('42', '\\Flagged', {uid: true});
// 服务器公布 IDLE 后可进入通知模式；done() 等待带标签完成响应。
const idle = await client.idle({onUpdate: response => console.log(response.line)});
await idle.done();
```

客户端同一时刻仅允许一个命令。IDLE 中不能插入其它命令，默认 29 分钟自动发送 DONE；可设置更短 `maxDuration`，不自动重新进入 IDLE。支持 AbortSignal 取消整个连接。普通命令采用固定总截止时间，默认 10 秒。连接失败不自动重试，避免重复上传或修改邮件。

## 已实现命令与编码

LOGIN、AUTHENTICATE PLAIN、CAPABILITY、NOOP、LOGOUT；SELECT/EXAMINE、CREATE/DELETE/RENAME、LIST/LSUB、SUBSCRIBE/UNSUBSCRIBE、STATUS；FETCH/SEARCH/STORE/COPY/MOVE 及 UID 形式；CHECK/CLOSE/EXPUNGE/UNSELECT；同步 APPEND 和 IDLE/DONE。

Node 便捷方法自动将中文邮件夹编码成 modified UTF-7，公开 `encodeMailbox/decodeMailbox` 可独立使用。LOGIN 使用可打印 ASCII 引号字符串；UTF-8 用户名可在服务器提供 AUTH=PLAIN 时使用 `authenticatePlain`。认证成功后更新能力缓存，必要时发送 CAPABILITY。

Node `command(verb,args)` 和 MoonBit `Session::command` 是较底层入口，邮件夹参数应预先编码；SEARCH 与 FETCH 表达式检查 ASCII、引号、括号和换行注入，具体查询语法仍由服务器验证。没有宣称实现全部表达式的 AST 或语义检查。MOVE/UNSELECT 等扩展仍需要服务器支持。

## 本次验证

- **16 项 MoonBit JS 测试通过**：包含所有分割位置的旧测试、新的状态转换、literal、SASL/IDLE、UTF-7 RFC 向量、1 MiB 分片与资源边界。
- **8 组回环 TCP/TLS 场景通过**：包括认证、二进制上传/读取、IDLE、超时/取消、证书信任和主机名检查。
- **GreenMail 2.1.13 独立服务器 7 条流程通过**：登录与能力发现、中文邮件夹、上传/选择/状态、UID 查询/读取/修改/复制、IDLE、清理与退出。

GreenMail 未公布 AUTH=PLAIN，独立 PLAIN 互通没有执行；该机制仅有核心及自编回环服务器证据。独立服务器走回环 TCP，TLS 使用专门回环服务验证。尚未验证 Dovecot/Cyrus/真实邮箱服务、长时间运行或本次新版 Wasm-GC。

详见 `evidence/network-focused-validation.json`、`evidence/greenmail-validation.json` 和 `evidence/client-focused-validation.json`。有证据的子集不等于完整追平 go-imap。

## 运行、构建与限制

```sh
moon test --target js --deny-warn
node tools/test-network.mjs
node tools/cli.mjs --file sample.txt --json
```

`tools/test-network.mjs` 需要 Node.js 与 OpenSSL 生成临时测试证书；仅监听本机随机端口，结束时关闭。`./verify.ps1` 是完整项目检查入口；`./start-review.ps1` 启动已编译的离线响应解析网页。浏览器用字面量 `\r\n` 输入换行，网络路径始终使用真实字节。

解析器按字节累积，避免旧版在每个分片复制完整邮件。每个 literal 最大 1 MiB、一个响应最多 64 个 literal、总 literal 字节最多 2 MiB、语法文本 64 KiB。宿主单命令收集最多 8 MiB/4096 条响应；IDLE 更新直接回调。APPEND 最多 1 MiB，一次发送正文，尚不支持流式大邮件写入或非同步 literal。

尚缺 STARTTLS、其它 SASL 机制及 SASLprep、完整响应 AST/FETCH 语义、查询构造器、命令流水线、selected mailbox 元数据/变化跟踪、多连接管理、更多 IMAP 扩展与性能证据。Core 的 Decoder/Session 内部字段在本版改为私有，请通过公开方法访问。

显式 `secure:false` 使用明文 TCP，认证还必须显式允许 `allowInsecureAuth:true`；这两个选项用于本机测试。TLS 不支持关闭验证，用户可提供 `tls.ca` 和 `tls.servername` 信任自己的服务器。

## 来源与本地审查

依据 [RFC 3501](https://www.rfc-editor.org/rfc/rfc3501)、[RFC 2177](https://www.rfc-editor.org/rfc/rfc2177) 原创实现，对照 [go-imap 客户端能力](https://pkg.go.dev/github.com/emersion/go-imap/v2/imapclient)。GreenMail 是独立验证依赖，没有复制其源码或打包其 JAR。源码 MIT；`localreview/imap` 仅为本地命名空间。

本目录是独立 Git 主仓库。旧 ZIP/bundle 和合集清单保留原审查快照，本次未重打包；没有 Git remote，也没有公开部署或比赛验收结论。

最后修补了跨 literal 的 UTF-8 语法预算累计，额外 1 个定向边界用例通过；原 16 项项目测试未重复全量运行。
