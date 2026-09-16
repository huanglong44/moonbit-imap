# 可执行 API 示例

收紧 FETCH sequence-set 语法，支持范围、星号、逗号和 32 位边界。这些例子调用公开 API，并随 `moon test` 执行。

```mbt check
///|
test "sequence sets reject invalid separators and zero" {
  for s in ["1", "1:3", "3:1", "*", "1:*,7"] {
    assert_true(@imap.valid_sequence_set(s))
  }
  for s in ["0", "01", "1:", ":2", "1,,2", "1:2:3", "4294967296"] {
    assert_true(!@imap.valid_sequence_set(s))
  }
}
```

0.4 已提供 TCP/隐式 TLS/STARTTLS、APPEND/IDLE/PLAIN 和 Dovecot/GreenMail 互通。核心升级状态用法见 starttls_test.mbt；仍缺完整 FETCH 语义、更多 SASL 和其它扩展。
