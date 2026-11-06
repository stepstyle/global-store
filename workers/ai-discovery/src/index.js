// Worker entry point. The Workers runtime treats every named export of the main module as an entrypoint, so this
// file exports ONLY the fetch handler; helpers and constants live in handler.js (imported by the tests).
import handler from './handler.js';

export default handler;
