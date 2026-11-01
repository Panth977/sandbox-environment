/** A remote failure. Switch on `code`. */
export class SandboxError extends Error {
  code: string;
  data?: unknown;
  constructor(code: string, message: string, data?: unknown);
}
export type Wire = Record<string, any>;
export interface Handler { kind: "unary" | "stream"; fn: (input: any, ctx: any) => any }
export class Peer {
  constructor(send: (m: Wire) => void, handler: (path: string) => Handler | undefined);
  call(path: string, input: unknown, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<any>;
  stream(path: string, input: unknown, options?: { signal?: AbortSignal; timeoutMs?: number }): AsyncIterable<any>;
  receive(m: Wire): void;
  closeAll(error: Error): void;
}
