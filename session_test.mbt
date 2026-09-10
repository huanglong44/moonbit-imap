///|
test "UTF-8 syntax budget applies across literal boundaries" {
  let prefix = Array::make(14000, "中").join("")
  let suffix = Array::make(9000, "中").join("")
  let d = @imap.Decoder::new()
  assert_true(
    try {
      ignore(
        d.feed(
          @utf8.encode("* X \"" + prefix + "\" {0}\r\n\"" + suffix + "\")\r\n"),
        ),
      )
      false
    } catch {
      _ => true
    },
  )
}

///|
test "status response suffixes are text and greeting tokens are exact" {
  let d = @imap.Decoder::new()
  assert_eq(
    d
    .feed(b"* OK notice {42}\r\nA1 OK text {9}\r\n+ challenge {3}\r\n")
    .length(),
    3,
  )
  d.finish()
  let bad = @imap.Session::new()
  assert_true(
    try {
      ignore(bad.feed(b"* OKAY wrong\r\n"))
      false
    } catch {
      _ => true
    },
  )
  let s = @imap.Session::new()
  ignore(s.feed(b"* ok [CAPABILITY IMAP4rev1 IDLE AUTH=PLAIN] ready\r\n"))
  assert_eq(s.capabilities(), ["IMAP4REV1", "IDLE", "AUTH=PLAIN"])
  ignore(s.command("noop", []))
  ignore(s.feed(b"A1 ok lowercase works\r\n"))
  assert_false(s.has_pending())
}

///|
test "selection failure deselects and CLOSE returns to authenticated" {
  let s = @imap.Session::new()
  ignore(s.feed(b"* PREAUTH ready\r\n"))
  ignore(s.command("SELECT", ["INBOX"]))
  ignore(s.feed(b"A1 OK selected\r\n"))
  ignore(s.command("EXAMINE", ["missing"]))
  assert_eq(s.state(), @imap.Authenticated)
  ignore(s.feed(b"A2 NO absent\r\n"))
  assert_eq(s.state(), @imap.Authenticated)
  ignore(s.command("SELECT", ["INBOX"]))
  ignore(s.feed(b"A3 OK selected\r\n"))
  ignore(s.command("CLOSE", []))
  ignore(s.feed(b"A4 OK closed\r\n"))
  assert_eq(s.state(), @imap.Authenticated)
  ignore(s.command("LOGOUT", []))
  ignore(s.feed(b"* BYE bye\r\nA5 OK logout\r\n"))
  s.finish()
}

///|
test "APPEND synchronizes binary literal and can recover from rejection" {
  let s = @imap.Session::new()
  ignore(s.feed(b"* PREAUTH ready\r\n"))
  assert_eq(
    s.append("INBOX", 4, flags="\\Seen"),
    "A1 APPEND \"INBOX\" (\\Seen) {4}\r\n",
  )
  assert_true(
    try {
      ignore(s.literal(b"a\x00\xffb"))
      false
    } catch {
      _ => true
    },
  )
  ignore(s.feed(b"+ send literal\r\n"))
  assert_true(
    try {
      ignore(s.literal(b"short"))
      false
    } catch {
      _ => true
    },
  )
  assert_eq(s.literal(b"a\x00\xffb"), b"a\x00\xffb\r\n")
  ignore(s.feed(b"A1 OK appended\r\n"))
  ignore(s.append("INBOX", 0))
  ignore(s.feed(b"A2 NO permission denied\r\n"))
  assert_false(s.has_pending())
  ignore(s.append("INBOX", 0))
  ignore(s.feed(b"+\r\n"))
  assert_eq(s.literal(b""), b"\r\n")
  ignore(s.feed(b"A3 OK empty\r\n"))
}

///|
test "PLAIN and IDLE continuation lifecycles" {
  let s = @imap.Session::new()
  ignore(s.feed(b"* OK [CAPABILITY AUTH=PLAIN IDLE] hi\r\n"))
  assert_eq(s.command("AUTHENTICATE", ["PLAIN"]), "A1 AUTHENTICATE PLAIN\r\n")
  ignore(s.feed(b"+ \r\n"))
  assert_true(
    try {
      ignore(s.authenticate_response("bad\r\n"))
      false
    } catch {
      _ => true
    },
  )
  assert_eq(s.authenticate_response("AHVzZXIAcGFzcw=="), "AHVzZXIAcGFzcw==\r\n")
  ignore(s.feed(b"A1 OK [CAPABILITY IMAP4rev1 IDLE] logged in\r\n"))
  assert_eq(s.state(), @imap.Authenticated)
  assert_eq(s.capabilities(), ["IMAP4REV1", "IDLE"])
  ignore(s.command("IDLE", []))
  assert_true(
    try {
      ignore(s.done())
      false
    } catch {
      _ => true
    },
  )
  ignore(s.feed(b"+ idling\r\n* 1 EXISTS\r\n"))
  assert_true(
    try {
      ignore(s.command("NOOP", []))
      false
    } catch {
      _ => true
    },
  )
  assert_eq(s.done(), "DONE\r\n")
  assert_true(
    try {
      ignore(s.done())
      false
    } catch {
      _ => true
    },
  )
  ignore(s.feed(b"A2 OK idle stopped\r\n"))
  assert_false(s.has_pending())
}

///|
test "extended commands prevent injection and preserve UID sequence sets" {
  let s = @imap.Session::new()
  ignore(s.feed(b"* PREAUTH ready\r\n"))
  ignore(s.command("SELECT", ["INBOX"]))
  ignore(s.feed(b"A1 OK selected\r\n"))
  assert_eq(
    s.command("UID FETCH", [
      "1:4294967295", "(UID BODY.PEEK[HEADER.FIELDS (SUBJECT FROM)])",
    ]),
    "A2 UID FETCH 1:4294967295 (UID BODY.PEEK[HEADER.FIELDS (SUBJECT FROM)])\r\n",
  )
  ignore(s.feed(b"A2 OK fetched\r\n"))
  assert_eq(
    s.command("UID STORE", ["1:*", "+flags.silent", "\\Seen custom"]),
    "A3 UID STORE 1:* +FLAGS.SILENT (\\Seen custom)\r\n",
  )
  ignore(s.feed(b"A3 OK stored\r\n"))
  for
    expr in [
      "ALL\r\nA9 LOGOUT", "(ALL", "TEXT {2}", "TEXT \"unclosed", "TEXT \"bad\\q\"",
    ] {
    assert_true(
      try {
        ignore(s.command("SEARCH", [expr]))
        false
      } catch {
        _ => true
      },
    )
  }
  assert_eq(
    s.command("SEARCH", ["OR (UNSEEN FROM \"a@example.test\") FLAGGED"]),
    "A4 SEARCH OR (UNSEEN FROM \"a@example.test\") FLAGGED\r\n",
  )
}

///|
test "modified UTF-7 RFC vector and supplementary Unicode" {
  let name = "~peter/mail/台北/日本語"
  let encoded = "~peter/mail/&U,BTFw-/&ZeVnLIqe-"
  assert_eq(@imap.encode_mailbox(name), encoded)
  assert_eq(@imap.decode_mailbox(encoded), name)
  for name in ["INBOX", "a&b", "中文&😀文件", "Répertoire"] {
    assert_eq(@imap.decode_mailbox(@imap.encode_mailbox(name)), name)
  }
  for bad in ["&", "&AA-", "&2AA-", "&AGE-", "&AB/-", "中文"] {
    assert_true(
      try {
        ignore(@imap.decode_mailbox(bad))
        false
      } catch {
        _ => true
      },
    )
  }
}

///|
test "large fragmented literal and bounded unterminated response" {
  let payload = Bytes::from_array(Array::make(1048576, (255).to_byte()))
  let d = @imap.Decoder::new()
  ignore(d.feed(b"* 1 FETCH (BODY[] {1048576}\r\n"))
  for start = 0; start < payload.length(); start = start + 1024 {
    assert_eq(d.feed(payload[start:start + 1024].to_owned()), [])
  }
  assert_eq(d.feed(b")\r\n")[0].literals[0], payload)
  d.finish()
  let bad = @imap.Decoder::new()
  assert_true(
    try {
      ignore(bad.feed(Bytes::from_array(Array::make(65539, (65).to_byte()))))
      false
    } catch {
      _ => true
    },
  )
}
