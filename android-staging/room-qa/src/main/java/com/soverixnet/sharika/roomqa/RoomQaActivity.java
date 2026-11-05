package com.soverixnet.sharika.roomqa;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/** Isolated no-network UI fixture. This class is not packaged in Sharika. */
public final class RoomQaActivity extends Activity {
    private WebView browser;
    private boolean lastImeVisible;
    private int lastImeInset = -1;

    public final class Reporter {
        @JavascriptInterface public void record(String json) {
            Log.i("SharikaRoomQa", json);
        }
    }

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING);
        getWindow().setStatusBarColor(Color.rgb(7, 3, 26));
        browser = new WebView(this);
        Log.i("SharikaRoomQa", "{\"phase\":\"native-created\"}");
        browser.getSettings().setJavaScriptEnabled(true);
        browser.getSettings().setDomStorageEnabled(true);
        browser.getSettings().setAllowFileAccess(true);
        browser.getSettings().setAllowFileAccessFromFileURLs(false);
        browser.getSettings().setAllowUniversalAccessFromFileURLs(false);
        browser.addJavascriptInterface(new Reporter(), "RoomQaReporter");
        browser.setBackgroundColor(Color.rgb(7, 3, 26));
        browser.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onConsoleMessage(ConsoleMessage message) {
                Log.i("SharikaRoomQaJs", message.messageLevel() + " " +
                    message.sourceId() + ":" + message.lineNumber() + " " + message.message());
                return true;
            }
        });
        browser.setOnApplyWindowInsetsListener((view, insets) -> {
            boolean visible = insets.isVisible(WindowInsets.Type.ime());
            int bottom = visible ? Math.max(0,
                insets.getInsets(WindowInsets.Type.ime()).bottom -
                insets.getInsets(WindowInsets.Type.navigationBars()).bottom) : 0;
            if (visible != lastImeVisible || bottom != lastImeInset) {
                lastImeVisible = visible;
                lastImeInset = bottom;
                browser.post(() -> browser.evaluateJavascript(
                    "(function(){let f=document.getElementById('rf');" +
                    "f?.contentWindow?.SharikaRoyalKeyboard?.setNativeIme(" +
                    (visible ? "true" : "false") + "," + bottom + ");" +
                    "setTimeout(()=>window.SharikaRoomQa?.report('" +
                    (visible ? "ime" : "closed") + "'),240);})()", null));
            }
            return insets;
        });
        browser.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView view, String url) {
                Log.i("SharikaRoomQa", "{\"phase\":\"page-finished\",\"url\":\"" +
                    url + "\"}");
                if (!"file:///android_asset/index.html".equals(url)) return;
                int[] origin = new int[2];
                browser.getLocationOnScreen(origin);
                browser.evaluateJavascript("window.__roomQaOriginPx=[" +
                    origin[0] + "," + origin[1] + "];", value ->
                        Log.i("SharikaRoomQa", "{\"phase\":\"native-origin-injected\"}"));
                browser.postDelayed(() -> browser.evaluateJavascript(
                    "JSON.stringify({hasOpenRoom:typeof openRoom==='function'," +
                    "hasQa:!!window.SharikaRoomQa,hasBridge:!!window.RoomQaReporter," +
                    "roomOn:!!document.getElementById('rw')?.classList.contains('on')})",
                    value -> Log.i("SharikaRoomQaState", value)), 5000);
            }
        });
        setContentView(browser);
        browser.loadUrl("file:///android_asset/index.html");
    }

    @Override protected void onDestroy() {
        if (browser != null) browser.destroy();
        super.onDestroy();
    }
}
