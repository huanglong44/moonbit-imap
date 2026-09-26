import * as core from '../web/engine.mjs';

/** Adapt results from the serial ImapClient, which has already matched the
 * pending command tag. Core independently requires a matching final tagged OK.
 * Direct MoonBit consumers supply their expected tag to completed_response. */
export function projectResult(result, kind) {
  if (!result || !Array.isArray(result.responses) || typeof result.completion?.line !== 'string')
    throw TypeError('expected a completed ImapClient result');
  const tag = result.completion.line.split(' ', 1)[0];
  const rows = [...result.responses, result.completion].map(response => {
    if (typeof response.line !== 'string' || !Array.isArray(response.literals) ||
        !response.literals.every(bytes => bytes instanceof Uint8Array))
      throw TypeError('invalid framed response');
    return {line: response.line, literals: response.literals.map(bytes => Buffer.from(bytes).toString('hex'))};
  });
  const text = core.project_result(kind, tag, JSON.stringify(rows));
  if (text.startsWith('ERROR:')) throw Error(text);
  return JSON.parse(text);
}
