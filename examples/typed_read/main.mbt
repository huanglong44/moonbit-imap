///|
/// Original synthetic wire data, not a captured user's email. This consumer
/// uses only the public MoonBit core; no Node regex or networking dependency.
fn main {
  try {
    let selection_decoder = @imap.Decoder::new()
    let selection = @imap.completed_response(
      "A1",
      selection_decoder.feed(
        b"* 1 EXISTS\r\n* OK [UIDVALIDITY 77] valid\r\n* OK [UIDNEXT 43] predicted\r\nA1 OK [READ-ONLY] selected\r\n",
      ),
    ).selection(read_only=true)
    selection_decoder.finish()
    let decoder = @imap.Decoder::new()
    let responses = decoder.feed(b"* 12 FETCH (BODY[] {6}\r\nA\x00")
    responses.append(
      decoder.feed(b"\xff\r\nB UID 42 RFC822.SIZE 6)\r\nA2 OK done\r\n"),
    )
    decoder.finish()
    let record = @imap.completed_response("A2", responses).fetch()[0]
    let uid = record.uid.unwrap()
    let identity = selection.identity("INBOX", uid)
    match record.body {
      Body(bytes) =>
        println(
          "mailbox=\{identity.mailbox} validity=\{identity.uid_validity} uid=\{identity.uid} sequence=\{record.sequence} bytes=\{bytes.length()}",
        )
      _ => abort("example expected body")
    }
  } catch {
    @imap.Invalid(message) => abort(message)
  }
}
