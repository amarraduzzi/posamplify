package com.amplify.caisse;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * Amplify Caisse for Android: the web till (always the latest version, it updates itself) in a full
 * screen window, plus a small print service on 127.0.0.1:8934 that speaks the same language as the
 * Windows printhost. The till therefore prints here exactly as on a Windows PC, to network (wifi /
 * cable), Bluetooth, USB and built-in printers.
 */
public class MainActivity extends Activity {
    static final String START = "https://caisse.amplifygrowthstudio.com/";
    private WebView web;
    private PrintServer server;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        Printers.init(this);
        server = new PrintServer(this);
        server.start();
        askBluetooth();

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#020F20"));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false); // the order chime
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW); // only for 127.0.0.1 (our own pages only)
        s.setUserAgentString(s.getUserAgentString() + " AmplifyCaisseAndroid/" + BuildConfigVersion.name(this));
        CookieManager.getInstance().setAcceptCookie(true);
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (ours(u)) return false;
                // WhatsApp, phone numbers, maps, other sites: their own app
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;
            }
        });
        web.setDownloadListener((url, ua, cd, mime, len) -> {
            try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception ignored) { }
        });
        setContentView(web);
        hideBars();
        if (state != null) web.restoreState(state); else web.loadUrl(START);
    }

    static boolean ours(Uri u) {
        String h = u.getHost();
        if (h == null) return false;
        return h.equals("amplifygrowthstudio.com") || h.endsWith(".amplifygrowthstudio.com")
            || h.endsWith(".pages.dev") || h.equals("127.0.0.1") || h.equals("localhost");
    }

    private void askBluetooth() {
        if (Build.VERSION.SDK_INT >= 31 && checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.BLUETOOTH_CONNECT}, 1);
        }
    }

    /** full screen: no status bar, no navigation bar (a swipe from the edge shows them for a moment) */
    @SuppressWarnings("deprecation")
    private void hideBars() {
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    @Override
    public void onWindowFocusChanged(boolean focus) {
        super.onWindowFocusChanged(focus);
        if (focus) hideBars();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        Printers.refreshUsb(); // a USB printer was plugged in
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        // never leaves the till by accident: the back button does nothing on the first page
    }

    @Override
    protected void onDestroy() {
        if (server != null) server.stop();
        super.onDestroy();
    }
}
