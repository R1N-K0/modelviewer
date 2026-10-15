"""Serves static/. Standard library only, so a clone runs with the Python already there."""

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import socket

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
ENV = ROOT / ".env"

# The models are rebuilt only by tools/make_models.py and committed with it; everything else
# changes with a git pull and has to reach the browser the next time it is opened.
LONG_CACHE = {".glb": "max-age=86400"}


def read_env():
    if not ENV.exists():
        return {}
    values = {}
    for line in ENV.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip()
    return values


def lan_address():
    """This machine's address on the network, to be typed on the phone.

    A UDP socket pointed outwards is given the address it would leave from; nothing is sent.
    """
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
        try:
            probe.connect(("192.0.2.1", 9))
            return probe.getsockname()[0]
        except OSError:
            return socket.gethostbyname(socket.gethostname())


class Handler(SimpleHTTPRequestHandler):
    # Windows fills mimetypes from the registry, where .js is sometimes text/plain; browsers
    # refuse to run a module served that way.
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".glb": "model/gltf-binary",
    }

    def end_headers(self):
        self.send_header("Cache-Control", LONG_CACHE.get(Path(self.path.split("?")[0]).suffix, "no-cache"))
        super().end_headers()

    # A line per request adds up on a machine left running for weeks, and a Windows console
    # holding a selection blocks whatever writes to it. Errors still go through log_error.
    def log_request(self, code="-", size="-"):
        pass


class Server(ThreadingHTTPServer):
    # With SO_REUSEADDR, Windows lets a second server bind the same port without a word, and
    # the browser keeps talking to the first. Without it the second stops with an error.
    allow_reuse_address = False


def main():
    port = int(read_env().get("PORT", "") or 5100)
    try:
        server = Server(("0.0.0.0", port), partial(Handler, directory=str(STATIC)))
    except OSError as error:
        raise SystemExit(f"cannot listen on port {port} ({error.strerror}): set another PORT in {ENV}")
    print(f"http://{lan_address()}:{port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
