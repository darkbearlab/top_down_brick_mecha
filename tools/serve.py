# 開發用伺服器：跟 python -m http.server 一樣，但每個檔案都加「不要快取」
# 原本的 http.server 沒有 Cache-Control，瀏覽器會照猜的時間快取 JS 模組 → 改了程式重新整理，間接載入的模組可能還是舊的
import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, must-revalidate')
        super().end_headers()

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8090
ThreadingHTTPServer(('0.0.0.0', port), NoCache).serve_forever()
