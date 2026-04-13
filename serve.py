import os, socketserver, http.server
os.chdir(os.path.dirname(os.path.abspath(__file__)))
port = int(os.environ.get('PORT', 8080))
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(('', port), http.server.SimpleHTTPRequestHandler)
print(f'Serving book-tracker on port {port}', flush=True)
httpd.serve_forever()
