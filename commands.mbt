///|
fn quote(s : String) -> String raise ImapError {
  if s.length() > 4096 || s.iter().any(c => c.to_int() < 32 || c.to_int() > 126) {
    raise Invalid(
      "quoted command arguments require printable ASCII; encode mailbox names with modified UTF-7",
    )
  }
  "\"" +
  s.replace_all(old="\\", new="\\\\").replace_all(old="\"", new="\\\"") +
  "\""
}

///|
/// Injection-safe ASCII expression, retaining IMAP syntax for the server to validate.
fn expression(s : String) -> String raise ImapError {
  if s.is_empty() || s.length() > 8192 {
    raise Invalid("expression length")
  }
  let mut depth = 0
  let mut quoted = false
  let mut escaped = false
  for c in s.iter() {
    if c.to_int() < 32 || c.to_int() > 126 {
      raise Invalid("expression requires printable ASCII")
    }
    if escaped {
      if c != '\\' && c != '"' {
        raise Invalid("invalid quoted escape")
      }
      escaped = false
      continue
    }
    if quoted && c == '\\' {
      escaped = true
      continue
    }
    if c == '"' {
      quoted = !quoted
      continue
    }
    if !quoted {
      if c == '{' || c == '}' {
        raise Invalid("literal markers require the APPEND API")
      }
      if c == '(' {
        depth += 1
      }
      if c == ')' {
        depth -= 1
      }
      if depth < 0 || depth > 32 {
        raise Invalid("expression nesting")
      }
    }
  }
  if quoted || escaped || depth != 0 {
    raise Invalid("unterminated expression")
  }
  s
}

///|
fn flag_list(s : String) -> String raise ImapError {
  if s.length() > 4096 {
    raise Invalid("flag list limit")
  }
  let flags = words(s)
  for flag in flags {
    let name = if flag.has_prefix("\\") { flag[1:].to_owned() } else { flag }
    if name.is_empty() ||
      !name
      .iter()
      .all(c => {
        c.to_int() >= 33 &&
        c.to_int() <= 126 &&
        !"(){%*\"\\]".contains(c.to_string())
      }) {
      raise Invalid("invalid flag")
    }
  }
  "(" + flags.join(" ") + ")"
}

///|
fn command_tail(
  state : State,
  command : String,
  args : Array[String],
) -> String raise ImapError {
  let authenticated = state == Authenticated || state == Selected
  match command {
    "STARTTLS" => {
      if state != NotAuthenticated || !args.is_empty() {
        raise Invalid("STARTTLS state/arity")
      }
      ""
    }
    "LOGIN" => {
      if state != NotAuthenticated || args.length() != 2 {
        raise Invalid("LOGIN state/arity")
      }
      quote(args[0]) + " " + quote(args[1])
    }
    "AUTHENTICATE" => {
      if state != NotAuthenticated || args != ["PLAIN"] {
        raise Invalid("only AUTHENTICATE PLAIN is supported")
      }
      "PLAIN"
    }
    "SELECT" | "EXAMINE" | "CREATE" | "DELETE" | "SUBSCRIBE" | "UNSUBSCRIBE" => {
      if !authenticated || args.length() != 1 {
        raise Invalid("mailbox command state/arity")
      }
      quote(args[0])
    }
    "RENAME" | "LIST" | "LSUB" => {
      if !authenticated || args.length() != 2 {
        raise Invalid("mailbox command state/arity")
      }
      quote(args[0]) + " " + quote(args[1])
    }
    "STATUS" => {
      if !authenticated || args.length() != 2 {
        raise Invalid("STATUS state/arity")
      }
      let items = words(args[1].to_upper())
      if items.is_empty() ||
        items.length() > 5 ||
        !items
        .iter()
        .all(s => {
          ["MESSAGES", "RECENT", "UIDNEXT", "UIDVALIDITY", "UNSEEN"].contains(s)
        }) {
        raise Invalid("STATUS items")
      }
      quote(args[0]) + " (" + items.join(" ") + ")"
    }
    "FETCH" | "UID FETCH" => {
      if state != Selected ||
        args.length() < 1 ||
        args.length() > 2 ||
        !valid_sequence_set(args[0]) {
        raise Invalid("FETCH state/arguments")
      }
      args[0] +
      " " +
      (if args.length() == 1 {
        "(UID FLAGS RFC822.SIZE)"
      } else {
        expression(args[1])
      })
    }
    "COPY" | "UID COPY" | "MOVE" | "UID MOVE" => {
      if state != Selected || args.length() != 2 || !valid_sequence_set(args[0]) {
        raise Invalid("COPY/MOVE state/arguments")
      }
      args[0] + " " + quote(args[1])
    }
    "STORE" | "UID STORE" => {
      if state != Selected || args.length() != 3 || !valid_sequence_set(args[0]) {
        raise Invalid("STORE state/arguments")
      }
      let mode = args[1].to_upper()
      if ![
          "FLAGS", "+FLAGS", "-FLAGS", "FLAGS.SILENT", "+FLAGS.SILENT", "-FLAGS.SILENT",
        ].contains(mode) {
        raise Invalid("STORE mode")
      }
      args[0] + " " + mode + " " + flag_list(args[2])
    }
    "SEARCH" | "UID SEARCH" => {
      if state != Selected || args.length() != 1 {
        raise Invalid("SEARCH state/arity")
      }
      expression(args[0])
    }
    "APPEND" => {
      if !authenticated || args.length() < 2 || args.length() > 3 {
        raise Invalid("APPEND state/arity")
      }
      if args[1].is_empty() || !args[1].iter().all(c => c >= '0' && c <= '9') {
        raise Invalid("APPEND length")
      }
      let size = @strconv.parse_int(args[1]) catch {
        _ => raise Invalid("APPEND length")
      }
      if size > 1048576 {
        raise Invalid("APPEND literal limit")
      }
      quote(args[0]) +
      (if args.length() == 3 { " " + flag_list(args[2]) } else { "" }) +
      " {" +
      size.to_string() +
      "}"
    }
    "CHECK" | "CLOSE" | "EXPUNGE" | "UNSELECT" => {
      if state != Selected || !args.is_empty() {
        raise Invalid("selected command state/arity")
      }
      ""
    }
    "IDLE" => {
      if !authenticated || !args.is_empty() {
        raise Invalid("IDLE state/arity")
      }
      ""
    }
    "CAPABILITY" | "NOOP" | "LOGOUT" => {
      if !args.is_empty() {
        raise Invalid("command arity")
      }
      ""
    }
    _ => raise Invalid("unsupported command")
  }
}
