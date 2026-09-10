///|
priv enum Phase {
  Normal
  AppendWaiting
  AppendReady
  AuthWaiting
  AuthReady
  IdleWaiting
  IdleActive
} derive(Debug, Eq)

///|
pub struct Session {
  priv mut status : State
  priv mut serial : Int
  priv mut pending : (String, String)?
  priv mut phase : Phase
  priv mut literal_size : Int
  priv decoder : Decoder
  priv caps : Array[String]
} derive(Debug)

///|
pub fn Session::new() -> Session {
  {
    status: Greeting,
    serial: 0,
    pending: None,
    phase: Normal,
    literal_size: 0,
    decoder: Decoder::new(),
    caps: [],
  }
}

///|
pub fn Session::state(self : Session) -> State {
  self.status
}

///|
pub fn Session::capabilities(self : Session) -> Array[String] {
  self.caps.copy()
}

///|
pub fn Session::has_pending(self : Session) -> Bool {
  self.pending != None
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
  let verb = command.to_upper()
  let tail = command_tail(self.status, verb, args)
  if self.serial >= 1000000000 {
    raise Invalid("session command limit")
  }
  self.serial += 1
  let tag = "A" + self.serial.to_string()
  self.pending = Some((tag, verb))
  self.phase = match verb {
    "APPEND" => AppendWaiting
    "AUTHENTICATE" => AuthWaiting
    "IDLE" => IdleWaiting
    _ => Normal
  }
  if verb == "APPEND" {
    self.literal_size = @strconv.parse_int(args[1]) catch { _ => 0 }
  }
  // A new SELECT/EXAMINE deselects the old mailbox even if the new selection fails.
  if verb == "SELECT" || verb == "EXAMINE" {
    self.status = Authenticated
  }
  tag + " " + verb + (if tail.is_empty() { "" } else { " " + tail }) + "\r\n"
}

///|
pub fn Session::append(
  self : Session,
  mailbox : String,
  size : Int,
  flags? : String = "",
) -> String raise ImapError {
  if size < 0 {
    raise Invalid("negative literal size")
  }
  self.command("APPEND", [mailbox, size.to_string(), flags])
}

///|
/// Send a synchronizing APPEND literal only after the server's continuation.
pub fn Session::literal(self : Session, bytes : Bytes) -> Bytes raise ImapError {
  if self.status == Closed ||
    self.phase != AppendReady ||
    bytes.length() != self.literal_size {
    raise Invalid("APPEND literal state/length")
  }
  self.phase = Normal
  bytes + b"\r\n"
}

///|
/// A pre-encoded PLAIN response or '*' to cancel. Credentials are encoded by the host.
pub fn Session::authenticate_response(
  self : Session,
  base64 : String,
) -> String raise ImapError {
  if self.status == Closed || self.phase != AuthReady {
    raise Invalid("authentication continuation state")
  }
  if base64 != "*" {
    if base64.is_empty() || base64.length() > 65536 || base64.length() % 4 != 0 {
      raise Invalid("SASL response length")
    }
    let mut padding = 0
    for c in base64.iter() {
      if c == '=' {
        padding += 1
      } else if padding > 0 ||
        !((c >= 'a' && c <= 'z') ||
        (c >= 'A' && c <= 'Z') ||
        (c >= '0' && c <= '9') ||
        c == '+' ||
        c == '/') {
        raise Invalid("SASL response alphabet")
      }
    }
    if padding > 2 {
      raise Invalid("SASL response padding")
    }
  }
  self.phase = Normal
  base64 + "\r\n"
}

///|
pub fn Session::done(self : Session) -> String raise ImapError {
  if self.status == Closed || self.phase != IdleActive {
    raise Invalid("IDLE is not active")
  }
  self.phase = Normal
  "DONE\r\n"
}

///|
fn Session::learn_capabilities(self : Session, line : String) -> Unit {
  let upper = line.to_upper()
  let values = if upper.has_prefix("* CAPABILITY ") || upper == "* CAPABILITY" {
    words(upper)[2:].to_owned()
  } else {
    match upper.find("[CAPABILITY ") {
      Some(start) => {
        let rest = upper[start + 12:].to_owned()
        match rest.find("]") {
          Some(end) => words(rest[:end].to_owned())
          None => return
        }
      }
      None => return
    }
  }
  self.caps.clear()
  for cap in values {
    if !self.caps.contains(cap) {
      self.caps.push(cap)
    }
  }
}

///|
pub fn Session::feed(
  self : Session,
  bytes : Bytes,
) -> Array[Response] raise ImapError {
  if self.status == Closed && self.pending == None {
    raise Invalid("session closed")
  }
  errdefer {
    self.status = Closed
    self.pending = None
    self.phase = Normal
  }
  let responses = self.decoder.feed(bytes)
  for r in responses {
    let fields = words(r.line)
    let code = response_word(r.line)
    if self.status == Greeting {
      if fields.length() < 2 || fields[0] != "*" || !r.literals.is_empty() {
        raise Invalid("invalid greeting")
      }
      self.status = match code {
        "OK" => NotAuthenticated
        "PREAUTH" => Authenticated
        "BYE" => Closed
        _ => raise Invalid("invalid greeting")
      }
      self.learn_capabilities(r.line)
      continue
    }
    if self.status == Closed {
      match self.pending {
        Some((_, "LOGOUT")) => ()
        _ => raise Invalid("response after BYE")
      }
    }
    if r.line.has_prefix("* ") {
      if code == "BYE" {
        self.status = Closed
      }
      if code == "PREAUTH" {
        raise Invalid("PREAUTH after greeting")
      }
      // Only status and CAPABILITY responses can update advertised capabilities.
      if code == "CAPABILITY" || code == "OK" {
        self.learn_capabilities(r.line)
      }
      continue
    }
    if r.line == "+" || r.line.has_prefix("+ ") {
      self.phase = match self.phase {
        AppendWaiting => AppendReady
        AuthWaiting => AuthReady
        IdleWaiting => IdleActive
        _ => raise Invalid("unexpected continuation")
      }
      continue
    }
    match self.pending {
      None => raise Invalid("unsolicited tagged response")
      Some((tag, cmd)) => {
        if fields.length() < 2 || fields[0] != tag || !r.literals.is_empty() {
          raise Invalid("tag mismatch")
        }
        if code != "OK" && code != "NO" && code != "BAD" {
          raise Invalid("completion status")
        }
        if code == "OK" && self.phase != Normal {
          raise Invalid("completion before continuation exchange finished")
        }
        if code == "OK" && self.status != Closed {
          if cmd == "LOGIN" || cmd == "AUTHENTICATE" {
            self.status = Authenticated
            self.caps.clear()
          }
          if cmd == "SELECT" || cmd == "EXAMINE" {
            self.status = Selected
          }
          if cmd == "CLOSE" || cmd == "UNSELECT" {
            self.status = Authenticated
          }
          if cmd == "LOGOUT" {
            self.status = Closed
          }
        }
        self.learn_capabilities(r.line)
        self.pending = None
        self.phase = Normal
      }
    }
  }
  responses
}

///|
pub fn Session::finish(self : Session) -> Unit raise ImapError {
  errdefer {
    self.status = Closed
    self.pending = None
  }
  self.decoder.finish()
  if self.pending != None || self.status == Greeting {
    raise Invalid("connection ended before command completion")
  }
  self.status = Closed
}
