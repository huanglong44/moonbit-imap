///|
pub struct UidRange {
  first : Int64
  last : Int64
} derive(Debug, Eq)

///|
/// Sorted non-overlapping inclusive ranges; no unbounded UID expansion.
pub struct UidSet {
  priv spans : Array[UidRange]
  count : Int64
} derive(Debug, Eq)

///|
pub fn UidSet::ranges(self : UidSet) -> Array[UidRange] {
  self.spans.copy()
}

///|
pub fn UidSet::expand(
  self : UidSet,
  limit~ : Int,
) -> Array[Int64] raise ImapError {
  if limit < 0 || limit > 100000 || self.count > limit.to_int64() {
    raise Invalid("UID expansion budget")
  }
  let out = []
  for span in self.spans {
    for uid = span.first; uid <= span.last; uid = uid + 1L {
      out.push(uid)
    }
  }
  out
}

///|
fn uid_ranges(value : ImapValue) -> Array[UidRange] raise ImapError {
  let text = match value {
    Atom(s) => s
    _ => raise Invalid("expected UID set")
  }
  let spans = []
  for part in text.split(",") {
    let pair = part.split(":").map(x => x.to_owned()).collect()
    let a = numeric_atom(Atom(pair[0]), 4294967295L, nonzero=true)
    let b = match pair.length() {
      1 => a
      2 => numeric_atom(Atom(pair[1]), 4294967295L, nonzero=true)
      _ => raise Invalid("invalid UID range")
    }
    spans.push({
      first: if a < b {
        a
      } else {
        b
      },
      last: if a > b {
        a
      } else {
        b
      },
    })
    if spans.length() > 4096 {
      raise Invalid("UID range count limit")
    }
  }
  spans
}

///|
fn normalized_uids(
  spans : Array[UidRange],
  reject_duplicates~ : Bool,
) -> UidSet raise ImapError {
  spans.sort_by((a, b) => a.first.compare(b.first))
  let merged : Array[UidRange] = []
  for span in spans {
    if merged.is_empty() {
      merged.push(span)
      continue
    }
    let last = merged[merged.length() - 1]
    if span.first <= last.last && reject_duplicates {
      raise Invalid("duplicate SEARCH UID")
    }
    if span.first <= last.last + 1L {
      merged[merged.length() - 1] = {
        first: last.first,
        last: if span.last > last.last {
          span.last
        } else {
          last.last
        },
      }
    } else {
      merged.push(span)
    }
  }
  let mut count = 0L
  for span in merged {
    count += span.last - span.first + 1L
  }
  { spans: merged, count, }
}

///|
/// Serial UID SEARCH result. Classic SEARCH is rev1 compatibility. ESEARCH
/// requires UID and, when present, this command's TAG; COUNT/ALL must agree.
/// MIN/MAX are checked if supplied; unknown extensions are explicitly rejected
/// by this narrow profile, while Response::parse still preserves their AST.
pub fn CompletedResponse::uid_search(
  self : CompletedResponse,
) -> UidSet raise ImapError {
  let mut result = None
  for event in self.events {
    match event {
      Data([Atom("*"), Atom(name), .. values]) if name.to_upper() == "SEARCH" => {
        if result != None {
          raise Invalid("multiple SEARCH results")
        }
        let spans = values
          .to_owned()
          .map(v => {
            let uid = numeric_atom(v, 4294967295L, nonzero=true)
            UidRange::{ first: uid, last: uid, }
          })
        result = Some(normalized_uids(spans, reject_duplicates=true))
      }
      Data([Atom("*"), Atom(name), .. values]) if name.to_upper() == "ESEARCH" => {
        if result != None {
          raise Invalid("multiple SEARCH results")
        }
        let fields = values.to_owned()
        let mut at = 0
        if fields.length() > 0 && fields[0] is List(correlator) {
          match correlator {
            [Atom(key), Quoted(tag)] if key.to_upper() == "TAG" &&
              tag == self.tag => ()
            _ => raise Invalid("ESEARCH correlator mismatch")
          }
          at += 1
        }
        if at >= fields.length() || atom_name(fields[at]) != "UID" {
          raise Invalid("ESEARCH missing UID")
        }
        at += 1
        let mut all = None
        let mut count = None
        let mut minimum = None
        let mut maximum = None
        let seen : Map[String, Bool] = Map([])
        while at < fields.length() {
          if at + 1 == fields.length() {
            raise Invalid("ESEARCH missing value")
          }
          let key = atom_name(fields[at])
          if seen.contains(key) {
            raise Invalid("duplicate ESEARCH key")
          }
          seen[key] = true
          let value = fields[at + 1]
          match key {
            "ALL" =>
              all = Some(
                normalized_uids(uid_ranges(value), reject_duplicates=false),
              )
            "COUNT" => count = Some(numeric_atom(value, 4294967295L))
            "MIN" =>
              minimum = Some(numeric_atom(value, 4294967295L, nonzero=true))
            "MAX" =>
              maximum = Some(numeric_atom(value, 4294967295L, nonzero=true))
            _ => raise Invalid("unsupported ESEARCH return item")
          }
          at += 2
        }
        let set = match all {
          Some(set) => set
          None =>
            if count == Some(0L) {
              UidSet::{ spans: [], count: 0L, }
            } else {
              raise Invalid("ESEARCH lacks complete ALL set")
            }
        }
        if count is Some(n) && n != set.count {
          raise Invalid("ESEARCH COUNT disagrees with ALL")
        }
        if minimum is Some(n) &&
          (set.spans.is_empty() || set.spans[0].first != n) {
          raise Invalid("ESEARCH MIN disagrees")
        }
        if maximum is Some(n) &&
          (set.spans.is_empty() || set.spans[set.spans.length() - 1].last != n) {
          raise Invalid("ESEARCH MAX disagrees")
        }
        result = Some(set)
      }
      _ => ()
    }
  }
  match result {
    Some(set) => set
    None => raise Invalid("missing UID SEARCH result")
  }
}
