///|
fn nullable_integer(value : Int64?) -> Json {
  match value {
    Some(n) => n.to_string().to_json()
    None => null
  }
}

///|
/// JSON/hex adapter only. All syntax, literal ownership, numeric ranges,
/// UID-set semantics and final-OK gating are implemented by the root package.
pub fn project_result(kind : String, tag : String, input : String) -> String {
  try {
    if input.length() > 18874368 {
      raise Failure("projection JSON limit")
    }
    let rows : Array[Json] = @json.from_json(@json.parse(input))
    if rows.length() > 4096 {
      raise Failure("projection response count")
    }
    let responses : Array[@lib.Response] = []
    for row in rows {
      let object : Map[String, Json] = @json.from_json(row)
      let line : String = @json.from_json(object.get("line").unwrap_or(null))
      let values : Array[String] = @json.from_json(
        object.get("literals").unwrap_or(null),
      )
      responses.push({ line, literals: values.map(unhex), })
    }
    let completed = @lib.completed_response(tag, responses)
    let result : Json = match kind {
      "selection" => {
        let info = completed.selection(read_only=true)
        {
          "uidValidity": info.uid_validity.to_string().to_json(),
          "uidNext": nullable_integer(info.uid_next),
          "exists": nullable_integer(info.exists),
          "flags": info.flags.to_json(),
          "permanentFlags": info.permanent_flags.to_json(),
          "readOnly": true,
        }
      }
      "search" => {
        let set = completed.uid_search()
        let uids : Json = if set.count <= 1000L {
          set.expand(limit=1000).map(x => x.to_string()).to_json()
        } else {
          null
        }
        {
          "count": set.count.to_string().to_json(),
          "uids": uids,
          "ranges": set
          .ranges()
          .map(r => [r.first.to_string(), r.last.to_string()])
          .to_json(),
        }
      }
      "fetch" =>
        completed
        .fetch()
        .map(record => {
          let (state, body) : (String, Json) = match record.body {
            Missing => ("missing", null)
            NilBody => ("nil", null)
            Body(bytes) => ("bytes", hex(bytes).to_json())
          }
          let flags : Json = match record.flags {
            Some(xs) => xs.to_json()
            None => null
          }
          {
            "sequence": record.sequence.to_string().to_json(),
            "uid": nullable_integer(record.uid),
            "size": nullable_integer(record.size),
            "flags": flags,
            "bodyState": state.to_json(),
            "bodyHex": body,
            "unknownAttributes": record.unknown.map(pair => pair.0).to_json(),
          }
        })
        .to_json()
      _ => raise Failure("unknown projection")
    }
    result.stringify()
  } catch {
    error => "ERROR: " + Repr(error).to_string()
  }
}
