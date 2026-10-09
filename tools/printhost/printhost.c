/*
 * Amplify printhost: the small Windows program that lets the till (a web page in Chrome) print on
 * the restaurant's ticket printers, without a print dialog. Cable (USB) or network (wifi / ethernet):
 * any printer installed in Windows works.
 *
 * Double-click printhost.exe once: it installs itself for the current user (no admin rights),
 * starts with Windows from then on, and replaces the old Dom's Café printhost if found.
 *   printhost.exe --uninstall   stops it and removes the automatic start.
 *
 * It listens on http://127.0.0.1:8934 (this computer only):
 *   GET  /ping      {"ok":true,"version":...}
 *   GET  /printers  {"ok":true,"printers":[{"name":"TICKET","default":true}, ...]}
 *   POST /print     {"printerName":"TICKET","title":"Ticket","dataBase64":"<raw ESC/POS bytes>"}
 *   GET  /          a small status page (for support)
 * Only the Amplify till and admin (and localhost for development) may call it: another website
 * open in the browser cannot print.
 *
 * Built with mingw-w64 (see build.sh); uses only Windows functions available since Windows XP,
 * because some restaurant PCs still run Windows 7.
 */
#define _WIN32_WINNT 0x0501
#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <windows.h>
#include <winspool.h>
#include <tlhelp32.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define VERSION "4.0.0"
#define PORT 8934
#define MAX_BODY (4 * 1024 * 1024)
#define RUN_KEY "Software\\Microsoft\\Windows\\CurrentVersion\\Run"
#define RUN_NAME "AmplifyPrinthost"
#define QUIT_EVENT "AmplifyPrinthostQuit"
#define MUTEX_NAME "AmplifyPrinthostRunning"

static HANDLE g_quit;

/* ---------- small string buffer ---------- */
typedef struct { char *p; size_t n, cap; } Buf;
static void bput(Buf *b, const char *s, size_t n) {
  if (b->n + n + 1 > b->cap) {
    size_t c = b->cap ? b->cap : 1024;
    while (c < b->n + n + 1) c *= 2;
    char *q = (char *)realloc(b->p, c);
    if (!q) return;
    b->p = q; b->cap = c;
  }
  memcpy(b->p + b->n, s, n); b->n += n; b->p[b->n] = 0;
}
static void bstr(Buf *b, const char *s) { bput(b, s, strlen(s)); }
static void bjson(Buf *b, const char *s) { /* a JSON string, quoted and escaped (input is UTF-8) */
  bstr(b, "\"");
  for (; *s; s++) {
    unsigned char c = (unsigned char)*s;
    char e[8];
    if (c == '"' || c == '\\') { e[0] = '\\'; e[1] = (char)c; bput(b, e, 2); }
    else if (c < 0x20) { sprintf(e, "\\u%04x", c); bput(b, e, 6); }
    else bput(b, (const char *)&c, 1);
  }
  bstr(b, "\"");
}
static void bhtml(Buf *b, const char *s) {
  for (; *s; s++) {
    if (*s == '<') bstr(b, "&lt;"); else if (*s == '>') bstr(b, "&gt;"); else if (*s == '&') bstr(b, "&amp;");
    else bput(b, s, 1);
  }
}

/* ---------- text conversions ---------- */
static wchar_t *to_wide(const char *utf8) {
  int n = MultiByteToWideChar(CP_UTF8, 0, utf8, -1, NULL, 0);
  wchar_t *w = (wchar_t *)calloc(n > 0 ? n : 1, sizeof(wchar_t));
  if (n > 0) MultiByteToWideChar(CP_UTF8, 0, utf8, -1, w, n);
  return w;
}
static char *to_utf8(const wchar_t *w) {
  int n = WideCharToMultiByte(CP_UTF8, 0, w, -1, NULL, 0, NULL, NULL);
  char *s = (char *)calloc(n > 0 ? n : 1, 1);
  if (n > 0) WideCharToMultiByte(CP_UTF8, 0, w, -1, s, n, NULL, NULL);
  return s;
}

/* ---------- which pages may print ---------- */
static int ends_with(const char *s, const char *suffix) {
  size_t a = strlen(s), b = strlen(suffix);
  return a >= b && _stricmp(s + a - b, suffix) == 0;
}
static int origin_allowed(const char *o) {
  char host[256];
  const char *h;
  size_t n;
  if (!strncmp(o, "http://localhost", 16) || !strncmp(o, "http://127.0.0.1", 16)) return 1;
  if (strncmp(o, "https://", 8)) return 0;
  h = o + 8;
  n = strcspn(h, ":/");
  if (n == 0 || n >= sizeof host) return 0;
  memcpy(host, h, n); host[n] = 0;
  return !_stricmp(host, "amplifygrowthstudio.com") || ends_with(host, ".amplifygrowthstudio.com")
      || !_stricmp(host, "amplify-kassa.pages.dev") || ends_with(host, ".amplify-kassa.pages.dev")
      || !_stricmp(host, "amplify-admin.pages.dev") || ends_with(host, ".amplify-admin.pages.dev")
      || !_stricmp(host, "posamplify.pages.dev") || ends_with(host, ".posamplify.pages.dev")
      || !_stricmp(host, "domscafe.pages.dev") || ends_with(host, ".domscafe.pages.dev");
}

/* ---------- minimal JSON: the string value of a top-level key ---------- */
static char *json_string(const char *js, const char *key) {
  char pat[64];
  const char *p;
  Buf out = {0};
  _snprintf(pat, sizeof pat, "\"%s\"", key);
  p = strstr(js, pat);
  if (!p) return NULL;
  p += strlen(pat);
  while (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n') p++;
  if (*p != ':') return NULL;
  p++;
  while (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n') p++;
  if (*p != '"') return NULL;
  p++;
  bstr(&out, "");
  while (*p && *p != '"') {
    if (*p == '\\' && p[1]) {
      p++;
      if (*p == 'n') bstr(&out, "\n"); else if (*p == 't') bstr(&out, "\t"); else if (*p == 'r') bstr(&out, "\r");
      else if (*p == 'b' || *p == 'f') { /* ignore */ }
      else if (*p == 'u' && p[1] && p[2] && p[3] && p[4]) {
        char hex[5] = { p[1], p[2], p[3], p[4], 0 };
        unsigned cp = (unsigned)strtoul(hex, NULL, 16);
        wchar_t w[2] = { (wchar_t)cp, 0 };
        char *u = to_utf8(w);
        bstr(&out, u); free(u);
        p += 4;
      } else bput(&out, p, 1);
      p++;
    } else { bput(&out, p, 1); p++; }
  }
  return out.p;
}

/* ---------- base64 ---------- */
static int b64v(int c) {
  if (c >= 'A' && c <= 'Z') return c - 'A';
  if (c >= 'a' && c <= 'z') return c - 'a' + 26;
  if (c >= '0' && c <= '9') return c - '0' + 52;
  if (c == '+' || c == '-') return 62;
  if (c == '/' || c == '_') return 63;
  return -1;
}
static unsigned char *b64decode(const char *s, DWORD *len) {
  size_t n = strlen(s);
  unsigned char *out = (unsigned char *)malloc(n * 3 / 4 + 4);
  DWORD o = 0;
  int acc = 0, bits = 0;
  for (; *s; s++) {
    int v = b64v((unsigned char)*s);
    if (v < 0) continue; /* '=' padding, newlines */
    acc = (acc << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; out[o++] = (unsigned char)((acc >> bits) & 0xff); }
  }
  *len = o;
  return out;
}

/* ---------- printers ---------- */
static void list_printers(Buf *json, Buf *html) {
  DWORD need = 0, count = 0, i;
  wchar_t def[512];
  DWORD dn = 512;
  char *defu = NULL;
  PRINTER_INFO_4W *pi;
  if (GetDefaultPrinterW(def, &dn)) defu = to_utf8(def);
  EnumPrintersW(PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS, NULL, 4, NULL, 0, &need, &count);
  pi = (PRINTER_INFO_4W *)malloc(need ? need : 1);
  bstr(json, "[");
  if (pi && need && EnumPrintersW(PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS, NULL, 4, (LPBYTE)pi, need, &need, &count)) {
    for (i = 0; i < count; i++) {
      char *name = to_utf8(pi[i].pPrinterName);
      int isdef = defu && !strcmp(defu, name);
      if (i) bstr(json, ",");
      bstr(json, "{\"name\":"); bjson(json, name); bstr(json, isdef ? ",\"default\":true}" : ",\"default\":false}");
      if (html) { bstr(html, "<li>"); bhtml(html, name); if (isdef) bstr(html, " (par d&eacute;faut)"); bstr(html, "</li>"); }
      free(name);
    }
  }
  bstr(json, "]");
  free(pi); free(defu);
}

static int print_raw(const char *printer, const char *title, const unsigned char *data, DWORD len, char *err, size_t errn) {
  HANDLE h = NULL;
  DOC_INFO_1W di;
  DWORD written = 0;
  wchar_t *wp = to_wide(printer), *wt = to_wide(title && *title ? title : "Amplify");
  int ok = 0;
  if (!OpenPrinterW(wp, &h, NULL)) {
    _snprintf(err, errn, "Imprimante introuvable sur ce PC : %s", printer);
    goto done;
  }
  di.pDocName = wt; di.pOutputFile = NULL; di.pDatatype = L"RAW";
  if (!StartDocPrinterW(h, 1, (LPBYTE)&di)) { _snprintf(err, errn, "Impression refusee par Windows (erreur %lu).", GetLastError()); goto done; }
  StartPagePrinter(h);
  ok = WritePrinter(h, (LPVOID)data, len, &written) && written == len;
  EndPagePrinter(h);
  EndDocPrinter(h);
  if (!ok) _snprintf(err, errn, "Echec de l'envoi a l'imprimante (erreur %lu).", GetLastError());
done:
  if (h) ClosePrinter(h);
  free(wp); free(wt);
  return ok;
}

/* ---------- HTTP ---------- */
static void send_all(SOCKET s, const char *p, size_t n) {
  while (n > 0) {
    int k = send(s, p, (int)(n > 65536 ? 65536 : n), 0);
    if (k <= 0) return;
    p += k; n -= (size_t)k;
  }
}
static void respond(SOCKET s, int code, const char *status, const char *ctype, const char *origin, const char *body) {
  Buf h = {0};
  char line[256];
  size_t blen = body ? strlen(body) : 0;
  _snprintf(line, sizeof line, "HTTP/1.1 %d %s\r\n", code, status); bstr(&h, line);
  if (origin && *origin && origin_allowed(origin)) {
    bstr(&h, "Access-Control-Allow-Origin: "); bstr(&h, origin); bstr(&h, "\r\n");
    bstr(&h, "Vary: Origin\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
             "Access-Control-Allow-Headers: Content-Type\r\nAccess-Control-Allow-Private-Network: true\r\n"
             "Access-Control-Max-Age: 600\r\n");
  }
  if (ctype) { bstr(&h, "Content-Type: "); bstr(&h, ctype); bstr(&h, "\r\n"); }
  _snprintf(line, sizeof line, "Content-Length: %lu\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n", (unsigned long)blen);
  bstr(&h, line);
  send_all(s, h.p, h.n);
  if (blen) send_all(s, body, blen);
  free(h.p);
}
static void header_value(const char *headers, const char *name, char *out, size_t outn) {
  const char *p = headers;
  size_t nl = strlen(name);
  out[0] = 0;
  while ((p = strstr(p, "\r\n")) != NULL) {
    p += 2;
    if (!_strnicmp(p, name, nl) && p[nl] == ':') {
      const char *v = p + nl + 1;
      size_t n;
      while (*v == ' ') v++;
      n = strcspn(v, "\r\n");
      if (n >= outn) n = outn - 1;
      memcpy(out, v, n); out[n] = 0;
      return;
    }
  }
}

static void handle(SOCKET c) {
  Buf req = {0};
  char tmp[8192], method[16] = "", path[256] = "", origin[512], clen[32];
  char *hend = NULL;
  size_t need = 0, hlen = 0;
  DWORD timeout = 5000;
  setsockopt(c, SOL_SOCKET, SO_RCVTIMEO, (const char *)&timeout, sizeof timeout);
  for (;;) {
    int k = recv(c, tmp, sizeof tmp, 0);
    if (k <= 0) break;
    bput(&req, tmp, (size_t)k);
    if (!hend && req.p && (hend = strstr(req.p, "\r\n\r\n")) != NULL) {
      hlen = (size_t)(hend - req.p) + 4;
      header_value(req.p, "Content-Length", clen, sizeof clen);
      need = hlen + (size_t)strtoul(clen, NULL, 10);
      if (need - hlen > MAX_BODY) break;
    }
    if (hend && req.n >= need) break;
    if (req.n > MAX_BODY + 65536) break;
  }
  if (!req.p || !hend) { free(req.p); return; }
  sscanf(req.p, "%15s %255s", method, path);
  header_value(req.p, "Origin", origin, sizeof origin);
  { char *q = strchr(path, '?'); if (q) *q = 0; }

  if (*origin && !origin_allowed(origin)) {
    respond(c, 403, "Forbidden", "application/json", NULL, "{\"ok\":false,\"error\":\"Site non autorise a imprimer.\"}");
  } else if (!strcmp(method, "OPTIONS")) {
    respond(c, 204, "No Content", NULL, origin, NULL);
  } else if (!strcmp(method, "GET") && !strcmp(path, "/ping")) {
    respond(c, 200, "OK", "application/json", origin, "{\"ok\":true,\"version\":\"" VERSION "\",\"engine\":\"amplify-printhost\",\"printers\":true}");
  } else if (!strcmp(method, "GET") && !strcmp(path, "/printers")) {
    Buf j = {0};
    bstr(&j, "{\"ok\":true,\"printers\":"); list_printers(&j, NULL); bstr(&j, "}");
    respond(c, 200, "OK", "application/json", origin, j.p);
    free(j.p);
  } else if (!strcmp(method, "GET") && !strcmp(path, "/")) {
    Buf j = {0}, h = {0};
    bstr(&h, "<!doctype html><meta charset=utf-8><title>Amplify printhost</title><body style=\"font:16px sans-serif;max-width:40rem;margin:3rem auto\">"
             "<h1>Programme d'impression Amplify</h1><p>Il fonctionne (version " VERSION "). Imprimantes vues par Windows :</p><ul>");
    list_printers(&j, &h);
    bstr(&h, "</ul><p>Pour l'arr&ecirc;ter et le retirer : lancez <code>printhost.exe --uninstall</code>.</p></body>");
    respond(c, 200, "OK", "text/html; charset=utf-8", NULL, h.p);
    free(j.p); free(h.p);
  } else if (!strcmp(method, "POST") && !strcmp(path, "/print")) {
    const char *body = req.p + hlen;
    char *printer = json_string(body, "printerName"), *title = json_string(body, "title"), *data = json_string(body, "dataBase64");
    char err[512] = "";
    if (!printer || !*printer) respond(c, 400, "Bad Request", "application/json", origin, "{\"ok\":false,\"error\":\"Nom d'imprimante manquant.\"}");
    else if (!data) respond(c, 400, "Bad Request", "application/json", origin, "{\"ok\":false,\"error\":\"Rien a imprimer.\"}");
    else {
      DWORD len = 0;
      unsigned char *bytes = b64decode(data, &len);
      if (print_raw(printer, title, bytes, len, err, sizeof err)) respond(c, 200, "OK", "application/json", origin, "{\"ok\":true}");
      else {
        Buf j = {0};
        bstr(&j, "{\"ok\":false,\"error\":"); bjson(&j, err); bstr(&j, "}");
        respond(c, 200, "OK", "application/json", origin, j.p);
        free(j.p);
      }
      free(bytes);
    }
    free(printer); free(title); free(data);
  } else {
    respond(c, 404, "Not Found", "application/json", origin, "{\"ok\":false,\"error\":\"not found\"}");
  }
  free(req.p);
}

static int serve(void) {
  WSADATA wsa;
  SOCKET l;
  struct sockaddr_in a;
  if (WSAStartup(MAKEWORD(2, 2), &wsa)) return 1;
  /* the port may still be held by an older printhost that is stopping: retry */
  for (;;) {
    BOOL excl = TRUE;
    l = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    setsockopt(l, SOL_SOCKET, SO_EXCLUSIVEADDRUSE, (const char *)&excl, sizeof excl);
    memset(&a, 0, sizeof a);
    a.sin_family = AF_INET; a.sin_port = htons(PORT); a.sin_addr.s_addr = inet_addr("127.0.0.1");
    if (bind(l, (struct sockaddr *)&a, sizeof a) == 0 && listen(l, 16) == 0) break;
    closesocket(l);
    if (WaitForSingleObject(g_quit, 3000) == WAIT_OBJECT_0) return 0;
  }
  for (;;) {
    fd_set fs;
    struct timeval tv = { 1, 0 };
    if (WaitForSingleObject(g_quit, 0) == WAIT_OBJECT_0) break;
    FD_ZERO(&fs); FD_SET(l, &fs);
    if (select(0, &fs, NULL, NULL, &tv) > 0) {
      SOCKET c = accept(l, NULL, NULL);
      if (c != INVALID_SOCKET) { handle(c); shutdown(c, SD_SEND); closesocket(c); }
    }
  }
  closesocket(l);
  WSACleanup();
  return 0;
}

/* ---------- install / uninstall ---------- */
static int ping_ok(void) {
  WSADATA wsa;
  SOCKET s;
  struct sockaddr_in a;
  char buf[512];
  int n, ok = 0;
  DWORD timeout = 1500;
  WSAStartup(MAKEWORD(2, 2), &wsa);
  s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
  setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, (const char *)&timeout, sizeof timeout);
  memset(&a, 0, sizeof a);
  a.sin_family = AF_INET; a.sin_port = htons(PORT); a.sin_addr.s_addr = inet_addr("127.0.0.1");
  if (connect(s, (struct sockaddr *)&a, sizeof a) == 0) {
    const char *r = "GET /ping HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n";
    send(s, r, (int)strlen(r), 0);
    n = recv(s, buf, sizeof buf - 1, 0);
    if (n > 0) { buf[n] = 0; ok = strstr(buf, "amplify-printhost") != NULL; }
  }
  closesocket(s);
  WSACleanup();
  return ok;
}

/* stop every other printhost.exe (an older version, or the old Dom's Café one) */
static void stop_others(void) {
  HANDLE snap, ev;
  PROCESSENTRY32 pe;
  DWORD me = GetCurrentProcessId();
  ev = OpenEventA(EVENT_MODIFY_STATE, FALSE, QUIT_EVENT);
  if (ev) { SetEvent(ev); CloseHandle(ev); Sleep(1500); }
  snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snap == INVALID_HANDLE_VALUE) return;
  pe.dwSize = sizeof pe;
  if (Process32First(snap, &pe)) do {
    if (pe.th32ProcessID != me && !_stricmp(pe.szExeFile, "printhost.exe")) {
      HANDLE p = OpenProcess(PROCESS_TERMINATE, FALSE, pe.th32ProcessID);
      if (p) { TerminateProcess(p, 0); CloseHandle(p); }
    }
  } while (Process32Next(snap, &pe));
  CloseHandle(snap);
  Sleep(500);
}

/* the old Dom's Café printhost started from the Startup folder: rename it so it no longer starts */
static void retire_old_startup(void) {
  char app[MAX_PATH], from[MAX_PATH], to[MAX_PATH];
  if (!GetEnvironmentVariableA("APPDATA", app, MAX_PATH)) return;
  _snprintf(from, MAX_PATH, "%s\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\printhost.exe", app);
  _snprintf(to, MAX_PATH, "%s\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\printhost.old", app);
  if (GetFileAttributesA(from) != INVALID_FILE_ATTRIBUTES) { DeleteFileA(to); MoveFileA(from, to); }
}

static int installed_path(char *out) {
  char app[MAX_PATH];
  if (!GetEnvironmentVariableA("APPDATA", app, MAX_PATH)) return 0;
  _snprintf(out, MAX_PATH, "%s\\Amplify", app);
  CreateDirectoryA(out, NULL);
  _snprintf(out, MAX_PATH, "%s\\Amplify\\printhost.exe", app);
  return 1;
}

static void msg(const char *text, UINT icon) {
  MessageBoxA(NULL, text, "Amplify - impression", MB_OK | MB_SETFOREGROUND | icon);
}

static int install(const char *self, const char *target) {
  HKEY k;
  char cmd[MAX_PATH + 4];
  STARTUPINFOA si;
  PROCESS_INFORMATION pi;
  int i;
  stop_others();
  retire_old_startup();
  if (!CopyFileA(self, target, FALSE)) {
    msg("Installation impossible : le fichier n'a pas pu etre copie.\nFermez les autres fenetres et relancez printhost.exe.", MB_ICONERROR);
    return 1;
  }
  _snprintf(cmd, sizeof cmd, "\"%s\"", target);
  if (RegCreateKeyExA(HKEY_CURRENT_USER, RUN_KEY, 0, NULL, 0, KEY_SET_VALUE, NULL, &k, NULL) == ERROR_SUCCESS) {
    RegSetValueExA(k, RUN_NAME, 0, REG_SZ, (const BYTE *)cmd, (DWORD)strlen(cmd) + 1);
    RegCloseKey(k);
  }
  memset(&si, 0, sizeof si); si.cb = sizeof si;
  if (!CreateProcessA(target, NULL, NULL, NULL, FALSE, 0, NULL, NULL, &si, &pi)) {
    msg("Installation faite, mais le programme n'a pas demarre. Redemarrez l'ordinateur.", MB_ICONWARNING);
    return 1;
  }
  CloseHandle(pi.hThread); CloseHandle(pi.hProcess);
  for (i = 0; i < 20 && !ping_ok(); i++) Sleep(500);
  if (ping_ok())
    msg("C'est pret.\n\nLe programme d'impression Amplify tourne maintenant en arriere-plan et demarrera avec Windows.\n\n"
        "Retournez sur la caisse : Reglages du poste > Imprimantes, et choisissez vos imprimantes.", MB_ICONINFORMATION);
  else
    msg("Le programme est installe mais ne repond pas encore.\nRedemarrez l'ordinateur, puis regardez sur la caisse : Reglages du poste > Imprimantes.", MB_ICONWARNING);
  return 0;
}

static int uninstall(void) {
  HKEY k;
  char target[MAX_PATH];
  if (RegOpenKeyExA(HKEY_CURRENT_USER, RUN_KEY, 0, KEY_SET_VALUE, &k) == ERROR_SUCCESS) {
    RegDeleteValueA(k, RUN_NAME);
    RegCloseKey(k);
  }
  stop_others();
  if (installed_path(target)) DeleteFileA(target);
  msg("Le programme d'impression Amplify est arrete et ne demarrera plus avec Windows.", MB_ICONINFORMATION);
  return 0;
}

int WINAPI WinMain(HINSTANCE inst, HINSTANCE prev, LPSTR cmdline, int show) {
  char self[MAX_PATH], target[MAX_PATH];
  HANDLE mutex;
  (void)inst; (void)prev; (void)show;
  if (cmdline && strstr(cmdline, "--uninstall")) return uninstall();
  GetModuleFileNameA(NULL, self, MAX_PATH);
  if (!installed_path(target)) { msg("Dossier APPDATA introuvable.", MB_ICONERROR); return 1; }
  /* double-clicked from Downloads (or anywhere else): install, then let the installed copy run */
  if (_stricmp(self, target)) return install(self, target);
  /* the installed copy: one at a time, in the background */
  mutex = CreateMutexA(NULL, TRUE, MUTEX_NAME);
  if (GetLastError() == ERROR_ALREADY_EXISTS) return 0;
  g_quit = CreateEventA(NULL, TRUE, FALSE, QUIT_EVENT);
  serve();
  if (mutex) CloseHandle(mutex);
  return 0;
}
