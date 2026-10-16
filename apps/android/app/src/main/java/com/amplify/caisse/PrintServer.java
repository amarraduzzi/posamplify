package com.amplify.caisse;

import android.content.Context;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The print service on http://127.0.0.1:8934, the same API as the Windows printhost:
 *   GET  /ping      {"ok":true,"version":...,"engine":"amplify-android","printers":true}
 *   GET  /printers  {"ok":true,"printers":[{"name":"Wifi 192.168.1.50","default":true,"kind":"network"}, ...]}
 *   POST /print     {"printerName":"...","title":"...","dataBase64":"<raw ESC/POS bytes>"}
 * and for the Android settings:
 *   POST /scan      looks for printers on the network (a few seconds), then answers like /printers
 *   POST /add       {"ip":"192.168.1.50","port":9100} adds a network printer by hand
 *   POST /forget    {"printerName":"..."} removes a network printer added before
 * Only the Amplify sites may call it (other origins: 403), and only from this tablet (127.0.0.1).
 */
final class PrintServer {
    static final String VERSION = "android-1";
    private final Context ctx;
    private ServerSocket socket;
    private final ExecutorService pool = Executors.newCachedThreadPool();
    private volatile boolean running;

    PrintServer(Context ctx) { this.ctx = ctx; }

    void start() {
        running = true;
        pool.execute(() -> {
            for (int attempt = 0; running && attempt < 30 && socket == null; attempt++) {
                try {
                    ServerSocket s = new ServerSocket();
                    s.setReuseAddress(true);
                    s.bind(new java.net.InetSocketAddress(InetAddress.getByName("127.0.0.1"), 8934), 50);
                    socket = s;
                } catch (Exception e) {
                    try { Thread.sleep(500); } catch (InterruptedException ignored) { return; }
                }
            }
            while (running && socket != null) {
                try {
                    Socket c = socket.accept();
                    pool.execute(() -> handle(c));
                } catch (Exception e) {
                    if (!running) return;
                }
            }
        });
    }

    void stop() {
        running = false;
        try { if (socket != null) socket.close(); } catch (Exception ignored) { }
        pool.shutdownNow();
    }

    static boolean originAllowed(String o) {
        if (o == null || o.isEmpty()) return true; // same device, no browser origin
        try {
            String host = android.net.Uri.parse(o).getHost();
            if (host == null) return false;
            host = host.toLowerCase(Locale.ROOT);
            return host.equals("amplifygrowthstudio.com") || host.endsWith(".amplifygrowthstudio.com")
                || host.equals("amplify-kassa.pages.dev") || host.endsWith(".amplify-kassa.pages.dev")
                || host.equals("amplify-admin.pages.dev") || host.endsWith(".amplify-admin.pages.dev")
                || host.equals("posamplify.pages.dev") || host.endsWith(".posamplify.pages.dev")
                || host.equals("localhost") || host.equals("127.0.0.1");
        } catch (Exception e) { return false; }
    }

    private void handle(Socket c) {
        try {
            c.setSoTimeout(15000);
            InputStream in = new BufferedInputStream(c.getInputStream());
            String requestLine = readLine(in);
            if (requestLine == null) { c.close(); return; }
            String[] parts = requestLine.split(" ");
            String method = parts.length > 0 ? parts[0] : "";
            String path = parts.length > 1 ? parts[1] : "/";
            int q = path.indexOf('?');
            if (q >= 0) path = path.substring(0, q);
            Map<String, String> headers = new HashMap<>();
            String line;
            while ((line = readLine(in)) != null && !line.isEmpty()) {
                int i = line.indexOf(':');
                if (i > 0) headers.put(line.substring(0, i).trim().toLowerCase(Locale.ROOT), line.substring(i + 1).trim());
            }
            int len = 0;
            try { len = Integer.parseInt(headers.getOrDefault("content-length", "0")); } catch (Exception ignored) { }
            byte[] body = new byte[Math.max(0, Math.min(len, 8 * 1024 * 1024))];
            int read = 0;
            while (read < body.length) {
                int n = in.read(body, read, body.length - read);
                if (n < 0) break;
                read += n;
            }
            String origin = headers.getOrDefault("origin", "");
            OutputStream out = c.getOutputStream();
            if (!origin.isEmpty() && !originAllowed(origin)) {
                respond(out, 403, origin, "{\"ok\":false,\"error\":\"Site non autorise.\"}");
            } else if (method.equals("OPTIONS")) {
                respond(out, 204, origin, null);
            } else if (method.equals("GET") && path.equals("/ping")) {
                respond(out, 200, origin, "{\"ok\":true,\"version\":\"" + VERSION + "\",\"engine\":\"amplify-android\",\"printers\":true}");
            } else if (method.equals("GET") && path.equals("/printers")) {
                respond(out, 200, origin, printersJson());
            } else if (method.equals("POST") && path.equals("/scan")) {
                Printers.scanNetwork();
                respond(out, 200, origin, printersJson());
            } else if (method.equals("POST") && path.equals("/add")) {
                JSONObject j = new JSONObject(new String(body, StandardCharsets.UTF_8));
                String err = Printers.addNetwork(j.optString("ip", ""), j.optInt("port", 9100));
                respond(out, 200, origin, err == null ? printersJson() : error(err));
            } else if (method.equals("POST") && path.equals("/forget")) {
                JSONObject j = new JSONObject(new String(body, StandardCharsets.UTF_8));
                Printers.forget(j.optString("printerName", ""));
                respond(out, 200, origin, printersJson());
            } else if (method.equals("POST") && path.equals("/print")) {
                JSONObject j = new JSONObject(new String(body, StandardCharsets.UTF_8));
                String name = j.optString("printerName", "");
                String data = j.optString("dataBase64", "");
                if (data.isEmpty()) respond(out, 400, origin, error("Rien a imprimer."));
                else {
                    byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                    String err = Printers.print(name, bytes);
                    respond(out, err == null ? 200 : 500, origin, err == null ? "{\"ok\":true}" : error(err));
                }
            } else if (method.equals("GET") && path.equals("/")) {
                respond(out, 200, origin, "{\"ok\":true,\"engine\":\"amplify-android\"}");
            } else {
                respond(out, 404, origin, error("Introuvable."));
            }
            out.flush();
            c.close();
        } catch (Exception e) {
            try { c.close(); } catch (Exception ignored) { }
        }
    }

    private static String error(String msg) {
        try { return new JSONObject().put("ok", false).put("error", msg).toString(); }
        catch (Exception e) { return "{\"ok\":false}"; }
    }

    private static String printersJson() {
        try {
            JSONArray a = new JSONArray();
            boolean first = true;
            for (Printers.Printer p : Printers.list()) {
                a.put(new JSONObject().put("name", p.name).put("default", first).put("kind", p.kind));
                first = false;
            }
            return new JSONObject().put("ok", true).put("printers", a).toString();
        } catch (Exception e) { return "{\"ok\":true,\"printers\":[]}"; }
    }

    private static String readLine(InputStream in) throws java.io.IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        int c;
        while ((c = in.read()) != -1) {
            if (c == '\n') break;
            if (c != '\r') b.write(c);
            if (b.size() > 16384) break;
        }
        if (c == -1 && b.size() == 0) return null;
        return b.toString("UTF-8");
    }

    private static void respond(OutputStream out, int code, String origin, String json) throws java.io.IOException {
        String reason = code == 200 ? "OK" : code == 204 ? "No Content" : code == 400 ? "Bad Request" : code == 403 ? "Forbidden" : code == 404 ? "Not Found" : "Error";
        StringBuilder h = new StringBuilder();
        h.append("HTTP/1.1 ").append(code).append(' ').append(reason).append("\r\n");
        if (origin != null && !origin.isEmpty() && originAllowed(origin)) {
            h.append("Access-Control-Allow-Origin: ").append(origin).append("\r\n")
             .append("Vary: Origin\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\n")
             .append("Access-Control-Allow-Headers: Content-Type\r\nAccess-Control-Allow-Private-Network: true\r\n")
             .append("Access-Control-Max-Age: 600\r\n");
        }
        byte[] b = json == null ? new byte[0] : json.getBytes(StandardCharsets.UTF_8);
        if (json != null) h.append("Content-Type: application/json; charset=utf-8\r\n");
        h.append("Content-Length: ").append(b.length).append("\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n");
        out.write(h.toString().getBytes(StandardCharsets.UTF_8));
        out.write(b);
    }
}
