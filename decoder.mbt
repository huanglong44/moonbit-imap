///|
/// Incremental byte parser with bounded per-response storage; literals never pass through UTF-8.
pub struct Decoder {
  priv line : Array[Byte]
  priv segments : Array[String]
  priv literals : Array[Bytes]
  priv literal : Array[Byte]
  priv mut expected : Int
  priv mut held : Int
  priv mut syntax_size : Int
  priv mut failed : Bool
} derive(Debug)

///|
pub fn Decoder::new() -> Decoder {
  {
    line: [],
    segments: [],
    literals: [],
    literal: [],
    expected: -1,
    held: 0,
    syntax_size: 0,
    failed: false,
  }
}

///|
fn text(b : Bytes) -> String raise ImapError {
  @utf8.decode(b, ignore_bom=false) catch {
    _ => raise Invalid("invalid UTF-8 response syntax")
  }
}

///|
fn words(line : String) -> Array[String] {
  line.split(" ").filter(s => !s.is_empty()).map(s => s.to_owned()).collect()
}

///|
fn response_word(line : String) -> String {
  let fields = words(line)
  if fields.length() >= 2 {
    fields[1].to_upper()
  } else {
    ""
  }
}

///|
fn text_response(line : String) -> Bool {
  if !line.has_prefix("* ") {
    return true
  }
  match response_word(line) {
    "OK" | "NO" | "BAD" | "BYE" | "PREAUTH" => true
    _ => false
  }
}

///|
fn suffix_size(line : String) -> Int raise ImapError {
  if !line.has_suffix("}") {
    return -1
  }
  let chars = line.to_array()
  let mut quoted = false
  let mut escaped = false
  let mut start = -1
  for i, c in chars {
    if escaped {
      escaped = false
      continue
    }
    if quoted && c == '\\' {
      escaped = true
      continue
    }
    if c == '"' {
      quoted = !quoted
    }
    if !quoted && c == '{' {
      start = i
    }
  }
  if quoted || start < 0 {
    return -1
  }
  let size = String::from_array(chars[start + 1:chars.length() - 1])
  if size.is_empty() || !size.iter().all(c => c >= '0' && c <= '9') {
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
pub fn Decoder::feed(
  self : Decoder,
  bytes : Bytes,
) -> Array[Response] raise ImapError {
  if self.failed {
    raise Invalid("decoder failed")
  }
  errdefer {
    self.failed = true
  }
  let out = []
  for byte in bytes {
    if self.expected >= 0 {
      self.literal.push(byte)
      self.held += 1
      if self.literal.length() == self.expected {
        self.literals.push(Bytes::from_array(self.literal))
        self.literal.clear()
        self.expected = -1
      }
      continue
    }
    let n = self.line.length()
    if byte == 10 {
      if n == 0 || self.line[n - 1] != 13 {
        raise Invalid("bare newline")
      }
      ignore(self.line.pop())
      let line = text(Bytes::from_array(self.line))
      self.line.clear()
      self.syntax_size += n - 1
      if self.syntax_size > 65536 {
        raise Invalid("response syntax limit")
      }
      let first = if self.segments.is_empty() { line } else { self.segments[0] }
      let size = if text_response(first) { -1 } else { suffix_size(line) }
      self.segments.push(line)
      if size >= 0 {
        if self.literals.length() >= 64 || size > 2097152 - self.held {
          raise Invalid("aggregate literal limit")
        }
        if size == 0 {
          self.literals.push(b"")
        } else {
          self.expected = size
        }
      } else {
        out.push({
          line: self.segments.join("\n"),
          literals: self.literals.copy(),
        })
        self.segments.clear()
        self.literals.clear()
        self.held = 0
        self.syntax_size = 0
      }
    } else {
      if byte == 0 || (n > 0 && self.line[n - 1] == 13) {
        raise Invalid("invalid response syntax byte")
      }
      if n >= 65537 || self.syntax_size + n > 65536 {
        raise Invalid("response line limit")
      }
      self.line.push(byte)
    }
  }
  out
}

///|
pub fn Decoder::has_partial(self : Decoder) -> Bool {
  self.expected >= 0 || !self.line.is_empty() || !self.segments.is_empty()
}

///|
pub fn Decoder::finish(self : Decoder) -> Unit raise ImapError {
  if self.failed || self.has_partial() {
    self.failed = true
    raise Invalid("truncated stream")
  }
}
