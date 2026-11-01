"""The sandbox side of the process bridge for Python: `from sandbox_api import ...`."""
import asyncio
import inspect
import json
import os
import re
import sys
import threading

CREDIT = 16
_out = sys.__stdout__
_lock = threading.Lock()
_spec = json.load(open(os.environ.get("SBX_API", "/app/.sbx/api.json")))
env = json.loads(os.environ.get("SBX_ENV") or "null") or {}


class SandboxError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def _send(**m):
    line = "\n" + json.dumps({"$sbx": 1, **m}, separators=(",", ":")) + "\n"
    with _lock:
        _out.write(line)
        _out.flush()


def _snake(p):
    return re.sub(r"(?<=[a-z0-9])([A-Z])", r"_\1", p.replace(".", "_")).lower()


class _Peer:
    def __init__(self):
        self.next = 1
        self.out = {}
        self.inn = {}
        self.impl = None
        self.loop = None

    def call(self, path, value):
        id = self.next
        self.next += 1
        f = self.loop.create_future()
        self.out[id] = f
        _send(t="call", id=id, path=path.split("."), args=[value])
        return f

    async def stream(self, path, value):
        id = self.next
        self.next += 1
        q = asyncio.Queue()
        self.out[id] = q
        _send(t="call", id=id, path=path.split("."), args=[value])
        seen = 0
        done = False
        try:
            while True:
                kind, v = await q.get()
                if kind == "end":
                    done = True
                    return
                if kind == "err":
                    done = True
                    raise v
                seen += 1
                if seen >= CREDIT // 2:
                    _send(t="pull", id=id, n=seen)
                    seen = 0
                yield v
        finally:
            self.out.pop(id, None)
            if not done:
                _send(t="cancel", id=id)

    async def serve(self, m):
        id = m["id"]
        path = ".".join(m["path"])
        s = _spec.get("exports", {}).get(path)
        fn = getattr(self.impl, _snake(path), None)
        if s is None or fn is None:
            _send(t="err", id=id, e={"code": "not-found", "message": "no handler: " + path})
            return
        args = m.get("args") or [None]
        kw = args[0] if isinstance(args[0], dict) else {}
        state = self.inn.setdefault(id, {})
        state.update(credit=CREDIT, wake=asyncio.Event())
        try:
            if s["kind"] == "stream":
                async for v in fn(**kw):
                    while state["credit"] <= 0:
                        state["wake"].clear()
                        await state["wake"].wait()
                    state["credit"] -= 1
                    _send(t="next", id=id, v=v)
                _send(t="end", id=id)
            else:
                v = fn(**kw)
                if inspect.isawaitable(v):
                    v = await v
                _send(t="ok", id=id, v=v)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            _send(t="err", id=id, e={"code": getattr(e, "code", "internal"), "message": str(e)})
        finally:
            self.inn.pop(id, None)

    def receive(self, m):
        t = m.get("t")
        id = m.get("id")
        if t == "call":
            self.inn[id] = {"task": None}
            task = self.loop.create_task(self.serve(m))
            self.inn[id]["task"] = task
        elif t in ("ok", "err", "next", "end"):
            o = self.out.get(id)
            err = SandboxError(m.get("e", {}).get("code", "internal"), m.get("e", {}).get("message", "failed")) if t == "err" else None
            if isinstance(o, asyncio.Queue):
                o.put_nowait(("err", err) if t == "err" else (t, m.get("v")))
            elif o is not None:
                self.out.pop(id)
                if t == "err":
                    o.set_exception(err)
                else:
                    o.set_result(m.get("v"))
        elif t == "pull":
            s = self.inn.get(id)
            if s and "credit" in s:
                s["credit"] += m.get("n", 0)
                s["wake"].set()
        elif t == "cancel":
            s = self.inn.pop(id, None)
            if s and s.get("task"):
                s["task"].cancel()


_peer = _Peer()


def _input(spec, kw):
    return kw if spec.get("input", {}).get("type") == "object" else None


class _Namespace:
    def __init__(self, prefix=""):
        self._p = prefix

    def __getattr__(self, name):
        path = self._p + name
        s = _spec.get("apis", {}).get(path)
        if s is None:
            return _Namespace(path + ".")
        if s["kind"] == "stream":
            return lambda **kw: _peer.stream(path, _input(s, kw))
        return lambda **kw: _peer.call(path, _input(s, kw))


host = _Namespace()


def expose(impl):
    """Serve your exports. Blocks until the parent closes the sandbox."""

    async def main():
        _peer.impl = impl
        _peer.loop = loop = asyncio.get_running_loop()
        stop = loop.create_future()

        def read():
            for line in sys.stdin:
                if line.strip():
                    loop.call_soon_threadsafe(_peer.receive, json.loads(line))
            loop.call_soon_threadsafe(lambda: stop.done() or stop.set_result(None))

        threading.Thread(target=read, daemon=True).start()
        _send(t="ready", protocols=[1])
        await stop

    asyncio.run(main())
