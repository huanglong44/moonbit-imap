///|
let sessions : Map[String, @lib.Session] = Map([])

///|
fn hex(bytes : Bytes) -> String {
  let digits = "0123456789abcdef".to_array()
  let out = StringBuilder()
  for b in bytes {
    out.write_char(digits[b.to_int() / 16])
    out.write_char(digits[b.to_int() % 16])
  }
  out.to_string()
}

///|
fn unhex(s : String) -> Bytes raise Failure {
  if s.length() % 2 != 0 || s.length() > 2097152 {
    raise Failure("invalid chunk length")
  }
  let out = []
  let mut value = 0
  for i, c in s.to_array() {
    let n = if c >= '0' && c <= '9' {
      c.to_int() - 48
    } else if c >= 'a' && c <= 'f' {
      c.to_int() - 87
    } else {
      -1
    }
    if n < 0 {
      raise Failure("invalid hex")
    }
    value = value * 16 + n
    if i % 2 == 1 {
      out.push(value.to_byte())
      value = 0
    }
  }
  Bytes::from_array(out)
}

///|
fn session(key : String) -> @lib.Session raise Failure {
  match sessions.get(key) {
    Some(s) => s
    None => raise Failure("unknown session")
  }
}

///|
pub fn session_open(key : String) -> String {
  if key.length() > 128 || sessions.length() >= 64 || sessions.contains(key) {
    return "ERROR: session limit or duplicate"
  }
  sessions[key] = @lib.Session::new()
  ""
}

///|
pub fn session_close(key : String) -> Unit {
  sessions.remove(key)
}

///|
pub fn session_feed(key : String, chunk : String) -> String {
  try {
    let s = session(key)
    let responses : Array[Json] = s
      .feed(unhex(chunk))
      .map(r => {
        "line": r.line.to_json(),
        "literals": r.literals.map(hex).to_json(),
      })
    let result : Json = {
      "state": Repr(s.state()).to_string().to_json(),
      "pending": s.has_pending().to_json(),
      "capabilities": s.capabilities().to_json(),
      "responses": responses.to_json(),
    }
    result.stringify()
  } catch {
    e => "ERROR: " + Repr(e).to_string()
  }
}

///|
pub fn session_issue(key : String, verb : String, arguments : String) -> String {
  try {
    if arguments.length() > 65536 {
      raise Failure("argument JSON limit")
    }
    let args : Array[String] = []
    match @json.parse(arguments) {
      Array(values) =>
        for v in values {
          match v {
            String(s) => args.push(s)
            _ => raise Failure("arguments must be strings")
          }
        }
      _ => raise Failure("arguments must be an array")
    }
    session(key).command(verb, args)
  } catch {
    e => "ERROR: " + Repr(e).to_string()
  }
}

///|
pub fn session_continue(key : String, kind : String, data : String) -> String {
  try {
    let s = session(key)
    match kind {
      "literal" => hex(s.literal(unhex(data)))
      "auth" => hex(@utf8.encode(s.authenticate_response(data)))
      "done" => hex(@utf8.encode(s.done()))
      _ => raise Failure("unknown continuation kind")
    }
  } catch {
    e => "ERROR: " + Repr(e).to_string()
  }
}

///|
pub fn session_finish(key : String) -> String {
  try {
    session(key).finish()
    ""
  } catch {
    e => "ERROR: " + Repr(e).to_string()
  }
}

///|
pub fn mailbox_name(name : String, decode : Bool) -> String {
  try {
    if decode {
      @lib.decode_mailbox(name)
    } else {
      @lib.encode_mailbox(name)
    }
  } catch {
    e => "ERROR: " + Repr(e).to_string()
  }
}
