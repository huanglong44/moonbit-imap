///|
/// Structural values preserve order and bind each literal to its syntax position.
/// Numeric atoms remain text until a profile checks its exact range. The original
/// Response remains available for lexical spelling and diagnostic text.
pub(all) enum ImapValue {
  Atom(String)
  Quoted(String)
  Nil
  Literal(Bytes)
  List(Array[ImapValue])
} derive(Debug, Eq)

///|
pub(all) enum TypedResponse {
  Status(String, String, Array[ImapValue], String) // tag or *, status, code, text
  Data(Array[ImapValue])
  Continuation(String)
} derive(Debug, Eq)

///|
priv struct ValueParser {
  chars : Array[Char]
  literals : Array[Bytes]
  mut at : Int
  mut literal_at : Int
  mut nodes : Int
}

///|
fn ValueParser::spaces(self : ValueParser) -> Unit {
  while self.at < self.chars.length() && self.chars[self.at] == ' ' {
    self.at += 1
  }
}

///|
fn ValueParser::sequence(
  self : ValueParser,
  end : Char?,
  depth : Int,
) -> Array[ImapValue] raise ImapError {
  if depth > 32 {
    raise Invalid("response nesting limit")
  }
  let out = []
  self.spaces()
  while self.at < self.chars.length() {
    if end is Some(c) && self.chars[self.at] == c {
      self.at += 1
      return out
    }
    if self.chars[self.at] == ')' ||
      (end == Some(']') && self.chars[self.at] == ']') {
      raise Invalid("unexpected response delimiter")
    }
    self.nodes += 1
    if self.nodes > 8192 {
      raise Invalid("response node limit")
    }
    out.push(self.value(depth))
    if self.at < self.chars.length() &&
      self.chars[self.at] != ' ' &&
      !(end is Some(c) && self.chars[self.at] == c) {
      // A literal's framing CRLF is consumed inside value(); its following
      // syntax still needs the same SP/list terminator as any other value.
      raise Invalid("missing response value separator")
    }
    self.spaces()
  }
  if end != None {
    raise Invalid("unclosed response list/code")
  }
  out
}

///|
fn ValueParser::value(
  self : ValueParser,
  depth : Int,
) -> ImapValue raise ImapError {
  let start = self.at
  match self.chars[self.at] {
    '(' => {
      self.at += 1
      List(self.sequence(Some(')'), depth + 1))
    }
    '"' => {
      self.at += 1
      let out = StringBuilder()
      while self.at < self.chars.length() {
        let c = self.chars[self.at]
        self.at += 1
        if c == '"' {
          return Quoted(out.to_string())
        }
        if c == '\\' {
          if self.at == self.chars.length() ||
            !(self.chars[self.at] == '\\' || self.chars[self.at] == '"') {
            raise Invalid("invalid quoted escape")
          }
          out.write_char(self.chars[self.at])
          self.at += 1
        } else {
          if c == '\r' || c == '\n' || c == '\u0000' {
            raise Invalid("invalid quoted byte")
          }
          out.write_char(c)
        }
      }
      raise Invalid("unclosed quoted string")
    }
    '{' => {
      self.at += 1
      let digits = self.at
      while self.at < self.chars.length() &&
            self.chars[self.at] >= '0' &&
            self.chars[self.at] <= '9' {
        self.at += 1
      }
      if self.at == digits ||
        self.at + 1 >= self.chars.length() ||
        self.chars[self.at] != '}' ||
        self.chars[self.at + 1] != '\n' {
        raise Invalid("literal marker/framing mismatch")
      }
      let size = @strconv.parse_int(
        String::from_array(self.chars[digits:self.at]),
      ) catch {
        _ => raise Invalid("literal marker overflow")
      }
      if self.literal_at >= self.literals.length() ||
        self.literals[self.literal_at].length() != size {
        raise Invalid("literal payload mismatch")
      }
      let bytes = self.literals[self.literal_at]
      self.literal_at += 1
      self.at += 2
      Literal(bytes)
    }
    _ => {
      // BODY[HEADER.FIELDS (FROM TO)] is one attribute name, not an AST list.
      // Preserve section syntax opaquely; full-body projection accepts BODY[].
      let mut section = false
      while self.at < self.chars.length() {
        let c = self.chars[self.at]
        if !section && (c == ' ' || c == ')' || c == ']') {
          break
        }
        if c == '[' {
          if section || self.at == start {
            raise Invalid("invalid section token")
          }
          section = true
        } else if c == ']' {
          section = false
        } else if c == '\n' ||
          c == '\r' ||
          c == '\u0000' ||
          c == '{' ||
          c == '"' ||
          (!section && c == '(') ||
          c == '\t' {
          raise Invalid("invalid response atom")
        }
        self.at += 1
      }
      if section || self.at == start {
        raise Invalid("invalid response atom/section")
      }
      let value = String::from_array(self.chars[start:self.at])
      if value.has_suffix("~") {
        raise Invalid("literal8 is not supported")
      }
      if value.to_upper() == "NIL" {
        Nil
      } else {
        Atom(value)
      }
    }
  }
}

///|
/// Parse already framed response syntax with exact literal association. Limits:
/// 64 KiB syntax, 64 literals/2 MiB total, depth 32, 8192 structural values.
/// Unknown extensions remain structural data; this is not full extension semantics.
pub fn Response::parse(self : Response) -> TypedResponse raise ImapError {
  if self.line.length() > 65536 ||
    @utf8.encode(self.line).length() > 65536 ||
    self.literals.length() > 64 {
    raise Invalid("response limits")
  }
  let mut total = 0
  for bytes in self.literals {
    if bytes.length() > 1048576 || bytes.length() > 2097152 - total {
      raise Invalid("literal limits")
    }
    total += bytes.length()
  }
  if self.line == "+" || self.line.has_prefix("+ ") {
    if !self.literals.is_empty() {
      raise Invalid("continuation literal")
    }
    return Continuation(
      if self.line == "+" {
        ""
      } else {
        self.line[2:].to_owned()
      },
    )
  }
  let fields = words(self.line)
  if fields.length() < 2 {
    raise Invalid("response prefix")
  }
  let status = fields[1].to_upper()
  if status == "OK" ||
    status == "NO" ||
    status == "BAD" ||
    status == "BYE" ||
    status == "PREAUTH" {
    if !self.literals.is_empty() ||
      self.line.contains("\n") ||
      self.line.contains("\r") ||
      self.line.contains("\u0000") {
      raise Invalid("status response syntax")
    }
    let prefix = fields[0] + " " + fields[1]
    if !self.line.has_prefix(prefix) {
      raise Invalid("status prefix spacing")
    }
    let rest = self.line[prefix.length():].trim().to_owned()
    if rest.has_prefix("[") {
      let parser : ValueParser = {
        chars: rest.to_array(),
        literals: [],
        at: 1,
        literal_at: 0,
        nodes: 0,
      }
      let code = parser.sequence(Some(']'), 0)
      if code.is_empty() {
        raise Invalid("empty response code")
      }
      if parser.at < parser.chars.length() && parser.chars[parser.at] != ' ' {
        raise Invalid("status code separator")
      }
      return Status(
        fields[0],
        status,
        code,
        String::from_array(parser.chars[parser.at:]).trim().to_owned(),
      )
    }
    return Status(fields[0], status, [], rest)
  }
  if fields[0] != "*" {
    raise Invalid("unknown tagged response status")
  }
  let parser : ValueParser = {
    chars: self.line.to_array(),
    literals: self.literals,
    at: 0,
    literal_at: 0,
    nodes: 0,
  }
  let values = parser.sequence(None, 0)
  if parser.literal_at != self.literals.length() {
    raise Invalid("unbound response literal")
  }
  Data(values)
}

///|
fn numeric_atom(
  value : ImapValue,
  maximum : Int64,
  nonzero? : Bool = false,
) -> Int64 raise ImapError {
  let text = match value {
    Atom(s) => s
    _ => raise Invalid("expected numeric atom")
  }
  if text.is_empty() ||
    !text.iter().all(c => c >= '0' && c <= '9') ||
    (nonzero && text.has_prefix("0")) {
    raise Invalid("invalid numeric atom")
  }
  let n = @strconv.parse_int64(text) catch {
    _ => raise Invalid("numeric overflow")
  }
  if n > maximum || (nonzero && n == 0L) {
    raise Invalid("numeric range")
  }
  n
}

///|
fn atom_name(value : ImapValue) -> String raise ImapError {
  match value {
    Atom(s) => s.to_upper()
    _ => raise Invalid("expected response atom")
  }
}

///|
fn response_flags(value : ImapValue) -> Array[String] raise ImapError {
  match value {
    List(xs) =>
      xs.map(x => {
        match x {
          Atom(s) => s
          _ => raise Invalid("non-atom flag")
        }
      })
    _ => raise Invalid("expected flag list")
  }
}
