///|
/// Only construction after one matching final tagged OK is allowed. This does
/// not claim every untagged event belongs to the command: unsolicited events
/// remain in wire order and FETCH projections expose their optional UID.
pub struct CompletedResponse {
  priv tag : String
  priv events : Array[TypedResponse]
  priv code : Array[ImapValue]
}

///|
/// Complete an already collected serial-command response (including completion).
/// NO/BAD, mismatched tags, BYE, continuation, trailing data and oversized
/// collections fail before exposing a high-level result. No partial success.
pub fn completed_response(
  tag : String,
  responses : Array[Response],
) -> CompletedResponse raise ImapError {
  if tag.is_empty() ||
    tag == "*" ||
    tag == "+" ||
    tag.length() > 128 ||
    tag
    .iter()
    .any(c => c <= ' ' || c > '~' || "(){%*\"\\]+[".contains(c.to_string())) {
    raise Invalid("invalid command tag")
  }
  if responses.is_empty() || responses.length() > 4096 {
    raise Invalid("command response count")
  }
  let events = []
  let mut total = 0
  for i, response in responses {
    if response.line.length() > 65536 {
      raise Invalid("response syntax budget")
    }
    total += @utf8.encode(response.line).length()
    if total > 8388608 {
      raise Invalid("command response byte budget")
    }
    for literal in response.literals {
      if literal.length() > 8388608 - total {
        raise Invalid("command response byte budget")
      }
      total += literal.length()
    }
    let parsed = response.parse()
    match parsed {
      Status(received, status, code, _) if received != "*" => {
        if received != tag || status != "OK" || i != responses.length() - 1 {
          raise Invalid("command requires one matching final tagged OK")
        }
        return { tag, events, code, }
      }
      Status(_, "BYE" | "PREAUTH", _, _) =>
        raise Invalid("command interrupted by server status")
      Continuation(_) => raise Invalid("unresolved command continuation")
      _ => events.push(parsed)
    }
  }
  raise Invalid("missing command completion")
}

///|
pub(all) enum MailboxAccess {
  ReadOnly
  ReadWrite
} derive(Debug, Eq)

///|
pub struct SelectionInfo {
  uid_validity : Int64
  uid_next : Int64?
  exists : Int64?
  flags : Array[String]
  permanent_flags : Array[String]
  access : MailboxAccess
} derive(Debug, Eq)

///|
/// UIDNEXT is an optional server prediction, never a message count/last UID.
/// EXAMINE callers require ReadOnly. Session already deselects on any new
/// SELECT/EXAMINE attempt; this projection never restores a failed old selection.
pub fn CompletedResponse::selection(
  self : CompletedResponse,
  read_only? : Bool = false,
) -> SelectionInfo raise ImapError {
  let access = match self.code {
    [Atom(name)] =>
      match name.to_upper() {
        "READ-ONLY" => ReadOnly
        "READ-WRITE" => ReadWrite
        _ => raise Invalid("selection access not confirmed")
      }
    _ => raise Invalid("selection access not confirmed")
  }
  if read_only && access != ReadOnly {
    raise Invalid("EXAMINE not read-only")
  }
  let mut validity = None
  let mut next = None
  let mut exists = None
  let mut flags = None
  let mut permanent = None
  for event in self.events {
    match event {
      Status("*", "OK", [Atom(key), value], _) =>
        match key.to_upper() {
          "UIDVALIDITY" => {
            if validity != None {
              raise Invalid("duplicate UIDVALIDITY")
            }
            validity = Some(numeric_atom(value, 4294967295L, nonzero=true))
          }
          "UIDNEXT" => {
            if next != None {
              raise Invalid("duplicate UIDNEXT")
            }
            next = Some(numeric_atom(value, 4294967295L, nonzero=true))
          }
          "PERMANENTFLAGS" => {
            if permanent != None {
              raise Invalid("duplicate PERMANENTFLAGS")
            }
            permanent = Some(response_flags(value))
          }
          _ => ()
        }
      Status("*", "OK", [Atom(key), ..], _) if key.to_upper() == "UIDVALIDITY" ||
        key.to_upper() == "UIDNEXT" ||
        key.to_upper() == "PERMANENTFLAGS" =>
        raise Invalid("malformed selection response code")
      Data([Atom("*"), count, Atom(name)]) if name.to_upper() == "EXISTS" => {
        if exists != None {
          raise Invalid("duplicate EXISTS in selection")
        }
        exists = Some(numeric_atom(count, 4294967295L))
      }
      Data([Atom("*"), Atom(name), value]) if name.to_upper() == "FLAGS" => {
        if flags != None {
          raise Invalid("duplicate FLAGS in selection")
        }
        flags = Some(response_flags(value))
      }
      _ => ()
    }
  }
  let uid_validity = match validity {
    Some(v) => v
    None => raise Invalid("missing UIDVALIDITY")
  }
  {
    uid_validity,
    uid_next: next,
    exists,
    flags: flags.unwrap_or([]),
    permanent_flags: permanent.unwrap_or([]),
    access,
  }
}

///|
pub struct UidIdentity {
  mailbox : String
  uid_validity : Int64
  uid : Int64
} derive(Debug, Eq)

///|
pub fn SelectionInfo::identity(
  self : SelectionInfo,
  mailbox : String,
  uid : Int64,
) -> UidIdentity raise ImapError {
  if mailbox.is_empty() || uid < 1L || uid > 4294967295L {
    raise Invalid("UID identity range/mailbox")
  }
  { mailbox, uid_validity: self.uid_validity, uid, }
}

///|
pub(all) enum FetchBody {
  Missing
  NilBody
  Body(Bytes)
} derive(Debug, Eq)

///|
pub struct FetchInfo {
  sequence : Int64
  uid : Int64?
  size : Int64?
  flags : Array[String]?
  body : FetchBody
  unknown : Array[(String, ImapValue)]
} derive(Debug, Eq)

///|
/// FETCH data, including unsolicited flag-only updates. Unknown attributes are
/// retained with structural values. BODY[] alone is the full-body profile;
/// sections, partials and BODYSTRUCTURE stay unknown rather than being guessed.
pub fn CompletedResponse::fetch(
  self : CompletedResponse,
) -> Array[FetchInfo] raise ImapError {
  let records = []
  for event in self.events {
    match event {
      Data([Atom("*"), count, Atom(name), List(items)]) if name.to_upper() ==
        "FETCH" => {
        let sequence = numeric_atom(count, 4294967295L, nonzero=true)
        if items.length() % 2 != 0 {
          raise Invalid("FETCH attributes require values")
        }
        let mut uid = None
        let mut size = None
        let mut flags = None
        let mut body : FetchBody = Missing
        let unknown = []
        let seen : Map[String, Bool] = Map([])
        for i = 0; i < items.length(); i = i + 2 {
          let key = atom_name(items[i])
          if seen.contains(key) {
            raise Invalid("duplicate FETCH attribute")
          }
          seen[key] = true
          let value = items[i + 1]
          match key {
            "UID" => uid = Some(numeric_atom(value, 4294967295L, nonzero=true))
            "RFC822.SIZE" =>
              size = Some(numeric_atom(value, 9223372036854775807L))
            "FLAGS" => flags = Some(response_flags(value))
            "BODY[]" =>
              body = match value {
                Literal(bytes) => Body(bytes)
                Nil => NilBody
                _ => raise Invalid("BODY[] requires literal or NIL")
              }
            _ => unknown.push((key, value))
          }
        }
        if body != Missing && uid == None {
          raise Invalid("full body without UID identity")
        }
        records.push({ sequence, uid, size, flags, body, unknown, })
      }
      Data([Atom("*"), _, Atom(name), ..]) if name.to_upper() == "FETCH" =>
        raise Invalid("malformed FETCH response")
      _ => ()
    }
  }
  records
}
