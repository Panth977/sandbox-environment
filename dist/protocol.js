/**
 * The wire protocol between a host page and a sandboxed artifact.
 *
 * Every message is a plain, structured-clone-able object tagged with
 * `$sbx: PROTOCOL`. Two layers use it:
 *
 *  - the boot layer (window.postMessage, before a private port exists):
 *    `ready` from the sandbox, `boot` from the host;
 *  - the RPC layer (on the private MessagePort): calls, results, streams,
 *    callbacks and cancellation, see {@link RpcMessage}.
 *
 * The protocol version is negotiated at boot so an old artifact keeps running
 * on a newer host for as long as the host still speaks its version.
 *
 * @module
 */

/** Current protocol version. Bumped only on a breaking wire change. */
export const PROTOCOL = 1;

/** Error codes every implementation understands. Hosts may add their own. */

/** How an error crosses the wire. Never carries a stack trace from the host. */

/** A function argument, replaced by a reference the other side can call. */

/** An AbortSignal argument; aborting it cancels the call. The callee receives the call's own signal in its place. */

/** A result that is a stream; values follow as `next` messages. */

/** Sandbox → host, on window, once the runtime script is running. */

/** Host → sandbox, on window, with the private port transferred. */

/** Everything the runtime needs to start an artifact. */

/** A theme: color scheme plus CSS custom properties set on `:root`. */

/** A component pack: an ES module that defines custom elements when imported. */

/** A pack element's synchronous definition. */

/** What the compiler produces and the render engine runs. Plain data, JSON-serialisable. */

/** Sandbox → host, on window, when the runtime itself could not start. */

/** Sandbox → host relays (on the private port, as calls to the host's `$sbx` namespace). */

export function isSbx(x         )                                   {
  return typeof x === "object" && x !== null && (x                      ).$sbx === PROTOCOL &&
    typeof (x                   ).t === "string";
}
