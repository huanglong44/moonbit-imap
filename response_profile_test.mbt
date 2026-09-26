///|
fn decoded(wire : Bytes) -> Array[@imap.Response] raise {
  let decoder = @imap.Decoder::new()
  let responses = decoder.feed(wire)
  decoder.finish()
  responses
}

///|
test "typed FETCH binds two reordered literals at every byte split" {
  let bytes = b"A\x00\xff\r\nB"
  let wire = b"* 12 FETCH (X-EXT {3}\r\nUID BODY[] {6}\r\n" +
    bytes +
    b" FLAGS (\\Seen) RFC822.SIZE 6 UID 901)\r\nA1 OK done\r\n"
  for split = 0; split <= wire.length(); split = split + 1 {
    let decoder = @imap.Decoder::new()
    let responses = decoder.feed(wire[:split].to_owned())
    responses.append(decoder.feed(wire[split:].to_owned()))
    decoder.finish()
    let record = @imap.completed_response("A1", responses).fetch()[0]
    assert_eq(record.sequence, 12L)
    assert_eq(record.uid, Some(901L))
    assert_eq(record.size, Some(6L))
    assert_eq(record.body, @imap.Body(bytes))
    assert_eq(record.unknown, [("X-EXT", @imap.Literal(b"UID"))])
  }
}

///|
test "typed response preserves nested unknowns and does not reinterpret status prose" {
  let rs = decoded(
    b"* 2 FETCH (UID 7 BODY[HEADER.FIELDS (FROM TO)] {2}\r\nxy X-EXT (NIL \"a\\\"b\" (9)))\r\nA1 OK status text ends in {999999999}\r\n",
  )
  let records = @imap.completed_response("A1", rs).fetch()
  assert_eq(records[0].body, @imap.Missing)
  assert_eq(
    records[0].unknown[0],
    ("BODY[HEADER.FIELDS (FROM TO)]", @imap.Literal(b"xy")),
  )
  assert_eq(
    records[0].unknown[1],
    (
      "X-EXT",
      @imap.List([
        @imap.Nil,
        @imap.Quoted("a\"b"),
        @imap.List([@imap.Atom("9")]),
      ]),
    ),
  )
}

///|
test "typed selection commits only after matching tagged OK and identity carries epoch" {
  let input = b"* 3 EXISTS\r\n* FLAGS (\\Seen custom)\r\n* OK [PERMANENTFLAGS (\\Seen \\*)] flags\r\n* OK [UIDNEXT 4294967295] predicted\r\n* OK [UIDVALIDITY 77] valid\r\nA1 OK [READ-ONLY] ready\r\n"
  let info = @imap.completed_response("A1", decoded(input)).selection(
    read_only=true,
  )
  assert_eq(info.uid_validity, 77L)
  assert_eq(info.uid_next, Some(4294967295L))
  assert_eq(info.exists, Some(3L))
  let identity = info.identity("INBOX", 42L)
  let changed = @imap.completed_response(
    "A1",
    decoded(b"* OK [UIDVALIDITY 78] valid\r\nA1 OK [READ-ONLY] ready\r\n"),
  ).selection()
  assert_false(identity == changed.identity("INBOX", 42L))
  for
    tail in [
      b"A1 NO rejected\r\n", b"A1 BAD rejected\r\n", b"A2 OK wrong\r\n", b"",
    ] {
    let failed = try {
      ignore(@imap.completed_response("A1", decoded(b"* SEARCH 42\r\n" + tail)))
      false
    } catch {
      _ => true
    }
    assert_true(failed)
  }
  assert_true(
    try {
      ignore(
        @imap.completed_response("A1", decoded(b"A1 OK done\r\n* 4 EXISTS\r\n")),
      )
      false
    } catch {
      _ => true
    },
  )
}

///|
test "typed selection rejects invalid duplicate identity and unconfirmed access" {
  for
    code in [
      "UIDVALIDITY 0", "UIDVALIDITY 4294967296", "UIDVALIDITY 77 88", "UIDVALIDITY -1",
      "UIDVALIDITY 01",
    ] {
    let wire = @utf8.encode(
      "* OK [" + code + "] identity\r\nA1 OK [READ-ONLY] done\r\n",
    )
    assert_true(
      try {
        ignore(@imap.completed_response("A1", decoded(wire)).selection())
        false
      } catch {
        _ => true
      },
    )
  }
  assert_true(
    try {
      ignore(
        @imap.completed_response(
          "A1",
          decoded(
            b"* OK [UIDVALIDITY 77] a\r\n* OK [UIDVALIDITY 77] b\r\nA1 OK [READ-ONLY] done\r\n",
          ),
        ).selection(),
      )
      false
    } catch {
      _ => true
    },
  )
  assert_true(
    try {
      ignore(
        @imap.completed_response(
          "A1",
          decoded(b"* OK [UIDVALIDITY 77] a\r\nA1 OK [READ-WRITE] done\r\n"),
        ).selection(read_only=true),
      )
      false
    } catch {
      _ => true
    },
  )
}

///|
test "typed UID search has bounded ranges and checks ESEARCH correlation and totals" {
  let result = @imap.completed_response(
    "A2",
    decoded(
      b"* ESEARCH (TAG \"A2\") UID MAX 8 ALL 4:2,8,3:4 COUNT 4 MIN 2\r\nA2 OK done\r\n",
    ),
  ).uid_search()
  assert_eq(result.count, 4L)
  assert_eq(result.expand(limit=4), [2L, 3L, 4L, 8L])
  let huge = @imap.completed_response(
    "A2",
    decoded(
      b"* ESEARCH UID ALL 1:4294967295 COUNT 4294967295\r\nA2 OK done\r\n",
    ),
  ).uid_search()
  assert_eq(huge.count, 4294967295L)
  assert_true(
    try {
      ignore(huge.expand(limit=100000))
      false
    } catch {
      _ => true
    },
  )
  assert_eq(
    @imap.completed_response("A2", decoded(b"* SEARCH 9 2 4\r\nA2 OK done\r\n"))
    .uid_search()
    .expand(limit=3),
    [2L, 4L, 9L],
  )
  assert_eq(
    @imap.completed_response(
      "A2",
      decoded(b"* ESEARCH UID COUNT 0\r\nA2 OK done\r\n"),
    ).uid_search().count,
    0L,
  )
  for
    body in [
      "SEARCH 1 1", "SEARCH 0", "ESEARCH ALL 1 COUNT 1", "ESEARCH UID ALL 1 COUNT 2",
      "ESEARCH (TAG \"X\") UID ALL 1", "ESEARCH UID COUNT 1", "ESEARCH UID ALL 1:*",
      "ESEARCH UID ALL 1:2 MIN 3", "ESEARCH UID COUNT 0 ALL 1",
    ] {
    assert_true(
      try {
        ignore(
          @imap.completed_response(
            "A2",
            decoded(@utf8.encode("* " + body + "\r\nA2 OK done\r\n")),
          ).uid_search(),
        )
        false
      } catch {
        _ => true
      },
    )
  }
}

///|
test "typed FETCH distinguishes missing NIL empty and unsolicited sequence updates" {
  let result = @imap.completed_response(
    "A1",
    decoded(
      b"* 9 FETCH (FLAGS (\\Seen))\r\n* 1 FETCH (UID 7 BODY[] NIL)\r\n* 2 FETCH (UID 8 BODY[] {0}\r\n RFC822.SIZE 0)\r\nA1 OK done\r\n",
    ),
  ).fetch()
  assert_eq(result[0].uid, None)
  assert_eq(result[0].body, @imap.Missing)
  assert_eq(result[1].body, @imap.NilBody)
  assert_eq(result[2].body, @imap.Body(b""))
  for
    fields in [
      "UID 7 UID 8", "UID 0", "UID 7 RFC822.SIZE -1", "UID 7 BODY[] \"x\"", "UID 7 X",
      "UID 7 FLAGS (\"bad\")",
    ] {
    assert_true(
      try {
        ignore(
          @imap.completed_response(
            "A1",
            decoded(
              @utf8.encode("* 1 FETCH (" + fields + ")\r\nA1 OK done\r\n"),
            ),
          ).fetch(),
        )
        false
      } catch {
        _ => true
      },
    )
  }
}

///|
test "typed syntax rejects unbound payload malformed lists overflow and deep nesting" {
  let cases : Array[@imap.Response] = [
    { line: "* 1 FETCH (BODY[] {3}\n)", literals: [b"ab"], },
    { line: "* 1 FETCH (UID 1)", literals: [b"stray"], },
    { line: "* 1 FETCH (UID 1", literals: [], },
    { line: "* LIST () \"bad\\x\" INBOX", literals: [], },
    { line: "* X (a)(b)", literals: [], },
    { line: "* X " + "(".repeat(34) + "x" + ")".repeat(34), literals: [], },
  ]
  for response in cases {
    assert_true(
      try {
        ignore(response.parse())
        false
      } catch {
        _ => true
      },
    )
  }
}
