///|
fn run(input : String) -> String {
  try {
    let d = @lib.Decoder::new()
    let out = d.feed(@utf8.encode(input))
    d.finish()
    Repr(out).to_string()
  } catch {
    e => "ERROR: " + Repr(e).to_string()
  }
}

///|
fn main {
  println(run("* 1 FETCH (BODY[] {5}\r\nhello)\r\nA1 OK completed\r\n"))
}
