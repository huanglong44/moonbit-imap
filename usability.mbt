///|
/// Validate RFC 3501 sequence-set syntax without interpreting mailbox contents.
pub fn valid_sequence_set(s : String) -> Bool {
  if s.is_empty() || s.length() > 4096 {
    return false
  }
  for group in s.split(",") {
    let parts = group.split(":").collect()
    if parts.length() < 1 || parts.length() > 2 {
      return false
    }
    for part in parts {
      if part == "*" {
        continue
      }
      if part.is_empty() ||
        part.has_prefix("0") ||
        !part.iter().all(c => c >= '0' && c <= '9') {
        return false
      }
      let n = @strconv.parse_uint64(part) catch { _ => return false }
      if n > 4294967295UL {
        return false
      }
    }
  }
  true
}
