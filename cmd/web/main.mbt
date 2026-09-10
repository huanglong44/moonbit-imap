///|
pub fn run(input : String) -> String {
  try {
    let d = @lib.Decoder::new()
    let out = d.feed(@utf8.encode(input.replace_all(old="\\r\\n", new="\r\n")))
    d.finish()
    Repr(out).to_string()
  } catch {
    e => "ERROR: " + Repr(e).to_string()
  }
}

///|
fn main {

}
