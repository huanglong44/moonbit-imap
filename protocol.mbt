///|
pub suberror ImapError {
  Invalid(String)
} derive(Debug)

///|
pub(all) struct Response {
  line : String
  literals : Array[Bytes]
} derive(Debug, Eq)

///|
pub(all) enum State {
  Greeting
  NotAuthenticated
  Authenticated
  Selected
  Closed
} derive(Debug, Eq)
