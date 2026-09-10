///|
fn flush_mailbox(bytes : Array[Byte], out : StringBuilder) -> Unit {
  if !bytes.is_empty() {
    out.write_string(
      "&" +
      @base64.encode(Bytes::from_array(bytes), padding=false).replace_all(
        old="/",
        new=",",
      ) +
      "-",
    )
    bytes.clear()
  }
}

///|
/// RFC 3501 modified UTF-7, for mailbox names before UTF8=ACCEPT negotiation.
pub fn encode_mailbox(name : String) -> String raise ImapError {
  if name.length() > 4096 ||
    name.contains("\u0000") ||
    name.contains("\r") ||
    name.contains("\n") {
    raise Invalid("invalid mailbox name")
  }
  let out = StringBuilder()
  let bytes : Array[Byte] = []
  for c in name.iter() {
    let n = c.to_int()
    if n >= 32 && n <= 126 {
      flush_mailbox(bytes, out)
      if c == '&' {
        out.write_string("&-")
      } else {
        out.write_char(c)
      }
    } else if n < 65536 {
      bytes.push((n >> 8).to_byte())
      bytes.push(n.to_byte())
    } else {
      let high = 55296 + ((n - 65536) >> 10)
      let low = 56320 + ((n - 65536) & 1023)
      bytes.push((high >> 8).to_byte())
      bytes.push(high.to_byte())
      bytes.push((low >> 8).to_byte())
      bytes.push(low.to_byte())
    }
  }
  flush_mailbox(bytes, out)
  out.to_string()
}

///|
pub fn decode_mailbox(encoded : String) -> String raise ImapError {
  if encoded.length() > 16384 ||
    !encoded.iter().all(c => c.to_int() >= 32 && c.to_int() <= 126) {
    raise Invalid("invalid modified UTF-7")
  }
  let out = StringBuilder()
  let chars = encoded.to_array()
  let mut pos = 0
  while pos < chars.length() {
    if chars[pos] != '&' {
      out.write_char(chars[pos])
      pos += 1
      continue
    }
    pos += 1
    let start = pos
    while pos < chars.length() && chars[pos] != '-' {
      pos += 1
    }
    if pos == chars.length() {
      raise Invalid("unterminated modified UTF-7")
    }
    if pos == start {
      out.write_char('&')
      pos += 1
      continue
    }
    let segment = String::from_array(chars[start:pos])
    if !segment
      .iter()
      .all(c => {
        (c >= 'a' && c <= 'z') ||
        (c >= 'A' && c <= 'Z') ||
        (c >= '0' && c <= '9') ||
        c == '+' ||
        c == ','
      }) {
      raise Invalid("invalid modified base64")
    }
    let mut normal = segment.replace_all(old=",", new="/")
    while normal.length() % 4 != 0 {
      normal += "="
    }
    let bytes = @base64.decode(normal) catch {
      _ => raise Invalid("invalid modified base64")
    }
    if bytes.length() % 2 != 0 {
      raise Invalid("odd UTF-16 length")
    }
    let mut i = 0
    while i < bytes.length() {
      let mut cp = bytes[i].to_int() * 256 + bytes[i + 1].to_int()
      i += 2
      if cp >= 55296 && cp <= 56319 {
        if i + 1 >= bytes.length() {
          raise Invalid("incomplete surrogate pair")
        }
        let low = bytes[i].to_int() * 256 + bytes[i + 1].to_int()
        if low < 56320 || low > 57343 {
          raise Invalid("invalid surrogate pair")
        }
        cp = 65536 + ((cp - 55296) << 10) + low - 56320
        i += 2
      }
      let c = match cp.to_char() {
        Some(c) => c
        None => raise Invalid("invalid Unicode scalar")
      }
      out.write_char(c)
    }
    pos += 1
  }
  let decoded = out.to_string()
  if encode_mailbox(decoded) != encoded {
    raise Invalid("noncanonical modified UTF-7")
  }
  decoded
}
