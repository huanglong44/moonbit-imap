///|
fn tls_session() -> @imap.Session raise {
  let s = @imap.Session::new()
  ignore(
    s.feed(b"* OK [CAPABILITY IMAP4rev1 STARTTLS LOGINDISABLED] ready\r\n"),
  )
  s
}

///|
test "STARTTLS clears unprotected capabilities and blocks commands during negotiation" {
  let s = tls_session()
  assert_eq(s.command("STARTTLS", []), "A1 STARTTLS\r\n")
  for byte in b"A1 OK [CAPABILITY STALE] ready\r\n" {
    ignore(s.feed(Bytes::from_array([byte])))
  }
  assert_eq(s.capabilities(), [])
  assert_eq(s.state(), @imap.NotAuthenticated)
  assert_true(
    try {
      ignore(s.command("LOGIN", ["u", "p"]))
      false
    } catch {
      _ => true
    },
  )
  s.tls_established()
  assert_true(
    try {
      ignore(s.command("STARTTLS", []))
      false
    } catch {
      _ => true
    },
  )
  assert_eq(s.command("CAPABILITY", []), "A2 CAPABILITY\r\n")
  ignore(s.feed(b"* CAPABILITY IMAP4rev1 AUTH=PLAIN\r\nA2 OK done\r\n"))
  assert_eq(s.capabilities(), ["IMAP4REV1", "AUTH=PLAIN"])
}

///|
test "STARTTLS state arity and refusal" {
  let s = tls_session()
  assert_true(
    try {
      s.tls_established()
      false
    } catch {
      _ => true
    },
  )
  assert_true(
    try {
      ignore(s.command("STARTTLS", ["extra"]))
      false
    } catch {
      _ => true
    },
  )
  ignore(s.command("STARTTLS", []))
  ignore(s.feed(b"A1 NO disabled\r\n"))
  assert_true(s.capabilities().contains("STARTTLS"))
  ignore(s.command("LOGIN", ["u", "p"]))
  ignore(s.feed(b"A2 OK logged in\r\n"))
  assert_true(
    try {
      ignore(s.command("STARTTLS", []))
      false
    } catch {
      _ => true
    },
  )
}

///|
test "STARTTLS rejects coalesced and partial unprotected replies after completion" {
  for
    suffix in [
      b"* CAPABILITY INJECTED\r\n", b"* CAP", b"A2 OK forged\r\n", b"\x16\x03",
    ] {
    let s = tls_session()
    ignore(s.command("STARTTLS", []))
    assert_true(
      try {
        ignore(s.feed(b"A1 OK ready\r\n" + suffix))
        false
      } catch {
        _ => true
      },
    )
    assert_eq(s.state(), @imap.Closed)
    assert_true(
      try {
        s.tls_established()
        false
      } catch {
        _ => true
      },
    )
  }
}

///|
test "STARTTLS separate plaintext and early disconnect terminate the session" {
  let s = tls_session()
  ignore(s.command("STARTTLS", []))
  ignore(s.feed(b"A1 OK ready\r\n"))
  assert_true(
    try {
      ignore(s.feed(b"*"))
      false
    } catch {
      _ => true
    },
  )
  assert_eq(s.state(), @imap.Closed)
  let eof = tls_session()
  ignore(eof.command("STARTTLS", []))
  ignore(eof.feed(b"A1 OK ready\r\n"))
  assert_true(
    try {
      eof.finish()
      false
    } catch {
      _ => true
    },
  )
  assert_eq(eof.state(), @imap.Closed)
}

///|
test "SASL cancellation cannot be followed by success or another challenge" {
  for suffix in [b"A1 OK authenticated\r\n", b"+ \r\n"] {
    let s = tls_session()
    ignore(s.command("AUTHENTICATE", ["PLAIN"]))
    ignore(s.feed(b"+ \r\n"))
    ignore(s.authenticate_response("*"))
    assert_true(
      try {
        ignore(s.feed(suffix))
        false
      } catch {
        _ => true
      },
    )
    assert_eq(s.state(), @imap.Closed)
  }
}
