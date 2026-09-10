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

0.3 已新增 TCP/隐式 TLS、APPEND/IDLE/PLAIN 和 GreenMail 互通；仍缺 STARTTLS、完整 FETCH 语义和更多扩展。
