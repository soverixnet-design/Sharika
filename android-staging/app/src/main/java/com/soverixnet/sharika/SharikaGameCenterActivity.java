package com.soverixnet.sharika;

import android.app.Activity;
import android.os.Bundle;
import android.graphics.Color;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.content.Context;
import android.content.Intent;

import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;

import org.json.JSONObject;

import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.ByteArrayOutputStream;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Isolated staging game browser. Crucially, the old SharikaNative JS interface
 * is NEVER added to this WebView. The only channel is origin-scoped and main-frame
 * only; JWTs and app permissions cannot be accessed from the hosted page.
 */
public final class SharikaGameCenterActivity extends Activity {
    private static final String SITE_ORIGIN = "https://sharika-games-web-staging.soverixnet.workers.dev";
    private final ExecutorService io = Executors.newFixedThreadPool(3);
    private final AtomicInteger outstanding = new AtomicInteger();
    private WebView web;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        if (BuildConfig.SHARIKA_PLAY_BUILD ||
            !"https://sharika-api-staging.soverixnet.workers.dev".equals(BuildConfig.SHARIKA_API_ORIGIN) ||
            FirebaseAuth.getInstance().getCurrentUser() == null) {
            finish();
            return;
        }
        FrameLayout layout = new FrameLayout(this);
        layout.setBackgroundColor(Color.rgb(15, 8, 28));
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(15, 8, 28));
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.getSettings().setAllowFileAccessFromFileURLs(false);
        web.getSettings().setAllowUniversalAccessFromFileURLs(false);
        web.getSettings().setJavaScriptCanOpenWindowsAutomatically(false);
        web.getSettings().setMediaPlaybackRequiresUserGesture(false);
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String origin = uri.getScheme() + "://" + uri.getAuthority();
                return !SITE_ORIGIN.equals(origin);
            }
        });
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            TextView unsupported = new TextView(this);
            unsupported.setText("Secure game bridge is unavailable on this Android WebView. Update Android System WebView.");
            unsupported.setTextColor(Color.WHITE);
            unsupported.setGravity(Gravity.CENTER);
            layout.addView(unsupported, new FrameLayout.LayoutParams(-1,-1));
            setContentView(layout);
            return;
        }
        WebViewCompat.addWebMessageListener(web, "SharikaGameBridge",
            Collections.singleton(SITE_ORIGIN), (view, message, sourceOrigin, isMainFrame, reply) -> {
                if (!isMainFrame || !SITE_ORIGIN.equals(sourceOrigin.toString())) return;
                if (view != web || isFinishing() || isDestroyed()) return;
                final JSONObject input;
                try { input = new JSONObject(message.getData()); }
                catch (Exception error) { return; }
                String id = input.optString("id","");
                String method = input.optString("method","");
                String path = input.optString("path","");
                if (!id.matches("[0-9]{1,9}") || !allowedGameRoute(method,path)) {
                    respond(reply,id,false,null,"game_route_not_allowed");
                    return;
                }
                if (outstanding.incrementAndGet() > 4) {
                    outstanding.decrementAndGet();
                    respond(reply,id,false,null,"too_many_game_requests");
                    return;
                }
                JSONObject body = input.optJSONObject("body");
                requestGameApi(id,method,path,body,reply);
            });
        layout.addView(web,new FrameLayout.LayoutParams(-1,-1));
        Button back = new Button(this);
        back.setText("‹ SHARIKA");
        back.setTextColor(Color.rgb(255,228,174));
        back.setBackgroundColor(Color.rgb(38,17,52));
        FrameLayout.LayoutParams pos = new FrameLayout.LayoutParams(
            (int)(118*getResources().getDisplayMetrics().density),
            (int)(43*getResources().getDisplayMetrics().density),
            Gravity.BOTTOM|Gravity.START);
        pos.setMargins(10,0,0,15);
        back.setOnClickListener(v->finish());
        // A native Back control remains available if a hosted page stops responding.
        layout.addView(back,pos);
        setContentView(layout);
        web.loadUrl(SITE_ORIGIN+"/");
    }

    private static boolean allowedGameRoute(String method,String path) {
        if (!"GET".equals(method) && !"POST".equals(method)) return false;
        if (path == null || path.length()>240 || path.contains("%") || path.contains("#")
            || path.contains("..") || path.contains("//")) return false;
        if ("GET".equals(method) && "/api/v1/game-catalog".equals(path)) return true;
        if (path.matches("^/api/v1/(royal-ace|cleopatra)/state$")) return "GET".equals(method);
        if (path.matches("^/api/superace/(state|history)$")) return "GET".equals(method);
        if (path.matches("^/api/superace/(spin|freespin|buy-bonus)$")) return "POST".equals(method);
        if (path.matches("^/api/v1/(royal-ace|cleopatra)/spin$")) return "POST".equals(method);
        if (path.matches("^/api/v1/greedy-wheel/(state|records)$")) return "GET".equals(method);
        if ("/api/v1/greedy-wheel/bet".equals(path)) return "POST".equals(method);
        if ("GET".equals(method) &&
            path.matches("^/api/v1/original-games/(sovera-food|sovera-gaddy|night-food|jackpot-fruit|food-deluxe|greedy-classic|fruit-royale)/(state|history|stats|rankings)$"))
            return true;
        if ("GET".equals(method) &&
            path.matches("^/api/v1/original-games/(sovera-food|night-food|jackpot-fruit|food-deluxe|greedy-classic|fruit-royale)/rankings\\?period=(daily|weekly|monthly)&metric=(totalWin|totalBet|profitLoss|winCount)$"))
            return true;
        return "POST".equals(method) && path.matches(
            "^/api/v1/original-games/(sovera-food|sovera-gaddy|night-food|jackpot-fruit|food-deluxe|greedy-classic|fruit-royale)/bet$");
    }

    private void requestGameApi(String id,String method,String path,JSONObject body,JavaScriptReplyProxy reply) {
        FirebaseUser user=FirebaseAuth.getInstance().getCurrentUser();
        if (user == null) {
            outstanding.decrementAndGet();
            respond(reply,id,false,null,"login_required");
            return;
        }
        user.getIdToken(false).addOnCompleteListener(this,task->{
            if (!task.isSuccessful() || task.getResult()==null ||
                task.getResult().getToken()==null) {
                outstanding.decrementAndGet();
                respond(reply,id,false,null,"firebase_token_unavailable");
                return;
            }
            final String token=task.getResult().getToken();
            io.execute(()->{
                HttpURLConnection connection=null;
                try {
                    connection=(HttpURLConnection)new URL(BuildConfig.SHARIKA_API_ORIGIN+path).openConnection();
                    connection.setRequestMethod(method);
                    connection.setConnectTimeout(12000);
                    connection.setReadTimeout(12000);
                    connection.setInstanceFollowRedirects(false);
                    connection.setRequestProperty("Authorization","Bearer "+token);
                    connection.setRequestProperty("Accept","application/json");
                    if ("POST".equals(method)) {
                        byte[] b=(body==null?"{}":body.toString()).getBytes(StandardCharsets.UTF_8);
                        if(b.length>4096)throw new IllegalArgumentException("bet_request_too_large");
                        connection.setDoOutput(true);
                        connection.setRequestProperty("Content-Type","application/json");
                        try(OutputStream os=connection.getOutputStream()){os.write(b);}
                    }
                    int code=connection.getResponseCode();
                    if(code>=300 && code<400)throw new IllegalArgumentException("game_redirect_denied");
                    try(InputStream stream=code>=400?connection.getErrorStream():connection.getInputStream()) {
                        String raw=stream==null?"{}":readLimited(stream);
                        JSONObject data=new JSONObject(raw);
                        if(code>=200&&code<300)respond(reply,id,true,data,null);
                        else respond(reply,id,false,null,data.optString("error","http_"+code));
                    }
                }catch(Exception error){
                    respond(reply,id,false,null,error instanceof IllegalArgumentException?
                        error.getMessage():"game_network_unavailable");
                }finally {
                    if(connection!=null)connection.disconnect();
                    outstanding.decrementAndGet();
                }
            });
        });
    }

    private static String readLimited(InputStream in) throws Exception {
        ByteArrayOutputStream out=new ByteArrayOutputStream();
        byte[] buffer=new byte[4096];int n;
        while((n=in.read(buffer))!=-1){
            if(out.size()+n>1024*1024)throw new IllegalArgumentException("game_response_too_large");
            out.write(buffer,0,n);
        }
        return out.toString(StandardCharsets.UTF_8.name());
    }

    private void respond(JavaScriptReplyProxy proxy,String id,boolean ok,JSONObject data,String error) {
        JSONObject response=new JSONObject();
        try {
            response.put("id",id);
            response.put("ok",ok);
            if(data!=null)response.put("data",data);
            if(error!=null)response.put("error",error);
        }catch(Exception ignored){return;}
        runOnUiThread(()->{
            if(web!=null && !isFinishing() && !isDestroyed())
                proxy.postMessage(response.toString());
        });
    }
    @Override @SuppressWarnings("deprecation") public void onBackPressed(){finish();}
    @Override protected void onDestroy(){
        if(web!=null){web.stopLoading();web.destroy();web=null;}
        io.shutdownNow();
        super.onDestroy();
    }
}
