# Простой локальный сервер для site/.
# Нужен потому, что браузер не загрузит WebAssembly и ES-модули с file://,
# а .wasm должен отдаваться с типом application/wasm.
import http.server, functools, os

PORT = int(os.environ.get("PORT", 8080))

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".wasm": "application/wasm",
        ".js": "text/javascript",
        ".data": "application/octet-stream",
    }

print(f"Campus Threads: http://127.0.0.1:{PORT}")
http.server.ThreadingHTTPServer(("127.0.0.1", PORT), functools.partial(Handler, directory="site")).serve_forever()
