///|
pub suberror ImapError {
  Invalid(String)
} derive(Debug)

///|
pub(all) struct Response {
  line : String
  literals : Array[Bytes]
} derive(Debug, Eq)

///|
pub struct Decoder {
  mut buffer : Bytes
  mut head : String
  literals : Array[Bytes]
  mut expected : Int
  mut failed : Bool
} derive(Debug)

///|
pub fn Decoder::new() -> Decoder {
  { buffer: b"", head: "", literals: [], expected: -1, failed: false, }
}

///|
fn text(b : Bytes) -> String raise ImapError {
  @utf8.decode(b) catch {
    _ => raise Invalid("invalid UTF-8 response syntax")
  }
}

///|
fn suffix_size(line : String) -> Int raise ImapError {
  if !line.has_suffix("}") {
    return -1
  }
  let cs = line.to_array()
  let mut start = cs.length() - 2
  while start >= 0 && cs[start] != '{' {
    start -= 1
  }
  if start < 0 {
    raise Invalid("literal marker")
  }
  let size = String::from_array(cs[start + 1:cs.length() - 1])
  if size.is_empty() || !size.to_array().iter().all(c => c >= '0' && c <= '9') {
    raise Invalid("literal length")
  }
  let n = @strconv.parse_int(size) catch {
    _ => raise Invalid("literal length overflow")
  }
  if n > 1048576 {
    raise Invalid("literal limit")
  }
  n
}

///|
fn Decoder::consume(
  self : Decoder,
  bytes : Bytes,
) -> Array[Response] raise ImapError {
  if self.buffer.length() + bytes.length() > 2097152 {
    raise Invalid("buffer limit")
  }
  let mut held = 0
  for b in self.literals {
    held += b.length()
  }
  if held + self.buffer.length() + bytes.length() > 2097152 {
    raise Invalid("aggregate literal buffer limit")
  }
  self.buffer = self.buffer + bytes
  let out : Array[Response] = []
  while true {
    if self.expected >= 0 {
      if self.buffer.length() < self.expected {
        break
      }
      self.literals.push(
        Bytes::from_array(self.buffer.to_array()[:self.expected]),
      )
      self.buffer = Bytes::from_array(self.buffer.to_array()[self.expected:])
      self.expected = -1
    }
    let end = match self.buffer.find(b"\r\n") {
      Some(i) => i
      None => break
    }
    let line = text(Bytes::from_array(self.buffer.to_array()[:end]))
    if line.contains("\n") || line.contains("\r") {
      raise Invalid("bare newline")
    }
    self.buffer = Bytes::from_array(self.buffer.to_array()[end + 2:])
    self.head += line
    if self.head.length() > 65536 || self.literals.length() > 64 {
      raise Invalid("response limit")
    }
    let n = suffix_size(line)
    if n >= 0 {
      self.head += "\n"
      self.expected = n
      continue
    }
    out.push({ line: self.head, literals: self.literals.copy(), })
    self.head = ""
    self.literals.clear()
  }
  out
}

///|
pub fn Decoder::feed(
  self : Decoder,
  bytes : Bytes,
) -> Array[Response] raise ImapError {
  if self.failed {
    raise Invalid("decoder failed")
  }
  self.consume(bytes) catch {
    Invalid(s) => {
      self.failed = true
      raise Invalid(s)
    }
  }
}

///|
pub fn Decoder::finish(self : Decoder) -> Unit raise ImapError {
  if self.failed ||
    self.expected >= 0 ||
    !self.buffer.is_empty() ||
    !self.head.is_empty() {
    self.failed = true
    raise Invalid("truncated stream")
  }
}

///|
pub(all) enum State {
  Greeting
  NotAuthenticated
  Authenticated
  Selected
  Closed
} derive(Debug, Eq)

///|
pub struct Session {
  mut status : State
  mut serial : Int
  mut pending : (String, String)?
  decoder : Decoder
} derive(Debug)

///|
pub fn Session::new() -> Session {
  { status: Greeting, serial: 0, pending: None, decoder: Decoder::new(), }
}

///|
pub fn Session::state(self : Session) -> State {
  self.status
}

///|
fn quote(s : String) -> String raise ImapError {
  if s.length() > 4096 ||
    s.contains("\r") ||
    s.contains("\n") ||
    s.contains("\u0000") {
    raise Invalid("invalid command argument")
  }
  "\"" +
  s.replace_all(old="\\", new="\\\\").replace_all(old="\"", new="\\\"") +
  "\""
}

///|
pub fn Session::command(
  self : Session,
  command : String,
  args : Array[String],
) -> String raise ImapError {
  if self.status == Greeting || self.status == Closed || self.pending != None {
    raise Invalid("session not ready")
  }
  let tail = match command {
    "LOGIN" => {
      if self.status != NotAuthenticated || args.length() != 2 {
        raise Invalid("LOGIN state/arity")
      }
      quote(args[0]) + " " + quote(args[1])
    }
    "SELECT" | "EXAMINE" => {
      if (self.status != Authenticated && self.status != Selected) ||
        args.length() != 1 {
        raise Invalid("SELECT state/arity")
      }
      quote(args[0])
    }
    "FETCH" => {
      if self.status != Selected || args.length() != 1 {
        raise Invalid("FETCH state/arity")
      }
      let a = args[0]
      if !valid_sequence_set(a) {
        raise Invalid("invalid sequence set")
      }
      a + " (UID FLAGS RFC822.SIZE)"
    }
    "CAPABILITY" | "NOOP" | "LOGOUT" => {
      if !args.is_empty() {
        raise Invalid("command arity")
      }
      ""
    }
    _ => raise Invalid("unsupported command")
  }
  self.serial += 1
  let tag = "A" + self.serial.to_string()
  self.pending = Some((tag, command))
  tag + " " + command + (if tail.is_empty() { "" } else { " " + tail }) + "\r\n"
}

///|
fn Session::handle(
  self : Session,
  bytes : Bytes,
) -> Array[Response] raise ImapError {
  let responses = self.decoder.feed(bytes)
  for r in responses {
    if self.status == Greeting {
      if r.line.has_prefix("* OK") {
        self.status = NotAuthenticated
      } else if r.line.has_prefix("* PREAUTH") {
        self.status = Authenticated
      } else if r.line.has_prefix("* BYE") {
        self.status = Closed
      } else {
        raise Invalid("invalid greeting")
      }
      continue
    }
    if r.line.has_prefix("* BYE") {
      self.status = Closed
      continue
    }
    if r.line.has_prefix("* ") {
      continue
    }
    if r.line.has_prefix("+") {
      raise Invalid("unexpected continuation")
    }
    match self.pending {
      None => raise Invalid("unsolicited tagged response")
      Some((tag, cmd)) => {
        let fields = r.line.split(" ").collect()
        if fields.length() < 2 || fields[0] != tag {
          raise Invalid("tag mismatch")
        }
        if fields[1] != "OK" && fields[1] != "NO" && fields[1] != "BAD" {
          raise Invalid("completion status")
        }
        if fields[1] == "OK" && self.status != Closed {
          if cmd == "LOGIN" {
            self.status = Authenticated
          }
          if cmd == "SELECT" || cmd == "EXAMINE" {
            self.status = Selected
          }
          if cmd == "LOGOUT" {
            self.status = Closed
          }
        }
        self.pending = None
      }
    }
  }
  responses
}

///|
pub fn Session::feed(
  self : Session,
  bytes : Bytes,
) -> Array[Response] raise ImapError {
  self.handle(bytes) catch {
    Invalid(s) => {
      self.status = Closed
      self.pending = None
      raise Invalid(s)
    }
  }
}
