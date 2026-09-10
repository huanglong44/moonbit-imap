///|
test "literal byte count every possible split" {
  let wire = b"* 1 FETCH (BODY[] {5}\r\nhe\r\nx)\r\nA1 OK done\r\n"
  for n in 0..<=wire.length() {
    let d = @imap.Decoder::new()
    let a = d.feed(Bytes::from_array(wire.to_array()[:n]))
    let b = d.feed(Bytes::from_array(wire.to_array()[n:]))
    let all = a + b
    d.finish()
    assert_eq(all.length(), 2)
    assert_eq(all[0].literals, [b"he\r\nx"])
    assert_eq(all[1].line, "A1 OK done")
  }
}

///|
test "zero literal and multiple literals" {
  let d = @imap.Decoder::new()
  let r = d.feed(b"* X {0}\r\n {1}\r\nx)\r\n")
  assert_eq(r[0].literals, [b"", b"x"])
  d.finish()
}

///|
test "session login select fetch lifecycle" {
  let s = @imap.Session::new()
  ignore(s.feed(b"* OK ready\r\n"))
  assert_eq(
    s.command("LOGIN", ["user", "pass"]),
    "A1 LOGIN \"user\" \"pass\"\r\n",
  )
  ignore(s.feed(b"A1 OK authenticated\r\n"))
  assert_eq(s.state(), @imap.Authenticated)
  assert_eq(s.command("SELECT", ["INBOX"]), "A2 SELECT \"INBOX\"\r\n")
  ignore(s.feed(b"* 3 EXISTS\r\nA2 OK selected\r\n"))
  assert_eq(s.state(), @imap.Selected)
  assert_eq(
    s.command("FETCH", ["1:3"]),
    "A3 FETCH 1:3 (UID FLAGS RFC822.SIZE)\r\n",
  )
}

///|
test "NO completion does not authenticate" {
  let s = @imap.Session::new()
  ignore(s.feed(b"* OK hi\r\n"))
  ignore(s.command("LOGIN", ["x", "y"]))
  ignore(s.feed(b"A1 NO wrong\r\n"))
  assert_eq(s.state(), @imap.NotAuthenticated)
}

///|
test "session sequencing and injection" {
  let s = @imap.Session::new()
  assert_true(
    try {
      ignore(s.command("NOOP", []))
      false
    } catch {
      _ => true
    },
  )
  ignore(s.feed(b"* OK hi\r\n"))
  assert_true(
    try {
      ignore(s.command("LOGIN", ["x\r\nA2 LOGOUT", "y"]))
      false
    } catch {
      _ => true
    },
  )
  ignore(s.command("NOOP", []))
  assert_true(
    try {
      ignore(s.command("NOOP", []))
      false
    } catch {
      _ => true
    },
  )
}

///|
test "truncation and poison" {
  let d = @imap.Decoder::new()
  ignore(d.feed(b"* X {5}\r\nabc"))
  assert_true(
    try {
      d.finish()
      false
    } catch {
      _ => true
    },
  )
  assert_true(
    try {
      ignore(d.feed(b"de\r\n"))
      false
    } catch {
      _ => true
    },
  )
}

///|
test "oversized marker and bad newline" {
  for b in [b"* X {99999999}\r\n", b"* OK\nBAD\r\n"] {
    let d = @imap.Decoder::new()
    assert_true(
      try {
        ignore(d.feed(b))
        false
      } catch {
        _ => true
      },
    )
  }
}

///|
test "all quoted command escapes" {
  let s = @imap.Session::new()
  ignore(s.feed(b"* OK hi\r\n"))
  assert_eq(
    s.command("LOGIN", ["a\"b\"c", "x\\y\\z"]),
    "A1 LOGIN \"a\\\"b\\\"c\" \"x\\\\y\\\\z\"\r\n",
  )
}
