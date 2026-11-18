package com.soverixnet.sharika;

import android.app.Activity;
import android.app.Dialog;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Room-only, 65%-screen secure hosted game bottom sheet.
 *
 * Important: this is a Dialog inside the existing SharikaActivity, NOT a
 * second Activity. The voice-room WebView, active WebRTC and mic service
 * stay alive in the same Activity while the game is being played.
 * The hosted page has ONLY an origin-scoped, main-frame message listener.
 * It never receives SharikaNative, Firebase tokens or arbitrary HTTP access.
 */
final class SharikaRoomGameDialog {
    private static final String SITE_ORIGIN =
        "https://sharika-games-web-staging.soverixnet.workers.dev";
    private final Activity host;
    private final ExecutorService io = Executors.newFixedThreadPool(3);
    private final AtomicInteger outstanding = new AtomicInteger();
    private final AtomicBoolean closed = new AtomicBoolean();
    private final Dialog dialog;
    private WebView gameWebView;

    private SharikaRoomGameDialog(Activity host) {
        this.host=host;
        this.dialog=new Dialog(host);
    }

    static SharikaRoomGameDialog show(Activity host) {
        if (BuildConfig.SHARIKA_PLAY_BUILD ||
            !"https://sharika-api-staging.soverixnet.workers.dev".equals(BuildConfig.SHARIKA_API_ORIGIN) ||
            FirebaseAuth.getInstance().getCurrentUser()==null)
            return null;
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            Toast.makeText(host,"Please update Android System WebView for secure games",
                Toast.LENGTH_LONG).show();
            return null;
        }
        SharikaRoomGameDialog panel = new SharikaRoomGameDialog(host);
        panel.open();
        return panel;
    }

    boolean isShowing() { return dialog.isShowing()&&!closed.get(); }

    void dismiss() { if(dialog.isShowing())dialog.dismiss(); }

    private void open() {
        FrameLayout container=new FrameLayout(host);
        // A single opaque, rounded Royal Emerald surface keeps the room
        // seats visible ABOVE the 65% sheet, never through its game icons.
        GradientDrawable sheetBg=new GradientDrawable(
            GradientDrawable.Orientation.TOP_BOTTOM,
            new int[]{Color.rgb(12,55,44),Color.rgb(3,29,23)});
        sheetBg.setCornerRadius(dp(23));
        sheetBg.setStroke(dp(1),Color.rgb(177,141,83));
        container.setBackground(sheetBg);
        container.setClipToOutline(true);

        WebView view=new WebView(host);
        gameWebView=view;
        view.setBackgroundColor(Color.TRANSPARENT);
        view.getSettings().setJavaScriptEnabled(true);
        view.getSettings().setDomStorageEnabled(true);
        view.getSettings().setAllowFileAccess(false);
        view.getSettings().setAllowContentAccess(false);
        view.getSettings().setAllowFileAccessFromFileURLs(false);
        view.getSettings().setAllowUniversalAccessFromFileURLs(false);
        view.getSettings().setJavaScriptCanOpenWindowsAutomatically(false);
        view.getSettings().setMediaPlaybackRequiresUserGesture(false);
        view.setWebChromeClient(new WebChromeClient());
        view.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView browser,WebResourceRequest req) {
                Uri uri=req.getUrl();
                String origin=uri.getScheme()+"://"+uri.getAuthority();
                return !SITE_ORIGIN.equals(origin);
            }
        });
        WebViewCompat.addWebMessageListener(view,"SharikaGameBridge",
            Collections.singleton(SITE_ORIGIN),(browser,message,sourceOrigin,isMainFrame,reply)->{
                if(closed.get()||browser!=gameWebView||!isMainFrame||
                   !SITE_ORIGIN.equals(sourceOrigin.toString()))return;
                final JSONObject input;
                try{input=new JSONObject(message.getData());}catch(Exception error){return;}
                String id=input.optString("id","");
                String method=input.optString("method","");
                String path=input.optString("path","");
                if(!id.matches("[0-9]{1,9}")||
                   !SharikaGameCenterActivity.allowedGameRoute(method,path)){
                    respond(reply,id,false,null,"game_route_not_allowed");
                    return;
                }
                if(outstanding.incrementAndGet()>4){
                    outstanding.decrementAndGet();
                    respond(reply,id,false,null,"too_many_game_requests");
                    return;
                }
                requestGameApi(id,method,path,input.optJSONObject("body"),reply);
            });

        container.addView(view,new FrameLayout.LayoutParams(-1,-1));
        TextView close=new TextView(host);
        close.setText("×");close.setTextSize(26);close.setTextColor(Color.rgb(255,229,169));
        close.setGravity(Gravity.CENTER);
        GradientDrawable closeBg=new GradientDrawable();
        closeBg.setColor(Color.rgb(10,51,39));
        closeBg.setCornerRadius(dp(18));
        closeBg.setStroke(dp(1),Color.rgb(229,184,104));
        close.setBackground(closeBg);
        close.setContentDescription("Close room game panel");
        FrameLayout.LayoutParams closePos=new FrameLayout.LayoutParams(dp(34),dp(34),
            Gravity.TOP|Gravity.END);
        closePos.setMargins(0,dp(5),dp(6),0);
        container.addView(close,closePos);
        close.setOnClickListener(v->dismiss());

        dialog.setContentView(container);
        dialog.setCancelable(true);
        dialog.setCanceledOnTouchOutside(true);
        dialog.setOnDismissListener(v->cleanup());
        Window window=dialog.getWindow();
        if(window!=null){
            window.setBackgroundDrawableResource(android.R.color.transparent);
            window.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
            window.setDimAmount(0f);
            window.setGravity(Gravity.BOTTOM);
            window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING);
        }
        dialog.show();
        if(window!=null){
            int height=Math.round(host.getResources().getDisplayMetrics().heightPixels*.65f);
            window.setLayout(WindowManager.LayoutParams.MATCH_PARENT,height);
        }
        view.loadUrl(SITE_ORIGIN+"/?view=room&surface=app");
    }

    private int dp(float value){
        return Math.round(value*host.getResources().getDisplayMetrics().density);
    }

    private void requestGameApi(String id,String method,String path,JSONObject body,
                                JavaScriptReplyProxy reply){
        FirebaseUser user=FirebaseAuth.getInstance().getCurrentUser();
        if(user==null||closed.get()){
            outstanding.decrementAndGet();
            respond(reply,id,false,null,"login_required");return;
        }
        user.getIdToken(false).addOnCompleteListener(host,task->{
            if(closed.get()||!task.isSuccessful()||task.getResult()==null||
                task.getResult().getToken()==null){
                outstanding.decrementAndGet();
                respond(reply,id,false,null,"firebase_token_unavailable");
                return;
            }
            String token=task.getResult().getToken();
            io.execute(()->{
                HttpURLConnection connection=null;
                try{
                    connection=(HttpURLConnection)new URL(BuildConfig.SHARIKA_API_ORIGIN+path)
                        .openConnection();
                    connection.setRequestMethod(method);
                    connection.setConnectTimeout(12000);
                    connection.setReadTimeout(12000);
                    connection.setInstanceFollowRedirects(false);
                    connection.setRequestProperty("Authorization","Bearer "+token);
                    connection.setRequestProperty("Accept","application/json");
                    if("POST".equals(method)){
                        byte[] bytes=(body==null?"{}":body.toString())
                            .getBytes(StandardCharsets.UTF_8);
                        if(bytes.length>4096)throw new IllegalArgumentException("game_request_too_large");
                        connection.setDoOutput(true);
                        connection.setRequestProperty("Content-Type","application/json");
                        try(OutputStream out=connection.getOutputStream()){out.write(bytes);}
                    }
                    int status=connection.getResponseCode();
                    if(status>=300&&status<400)throw new IllegalArgumentException("game_redirect_denied");
                    try(InputStream stream=status>=400?connection.getErrorStream():connection.getInputStream()){
                        JSONObject data=new JSONObject(stream==null?"{}":readLimited(stream));
                        if(status>=200&&status<300)respond(reply,id,true,data,null);
                        else respond(reply,id,false,null,data.optString("error","http_"+status));
                    }
                }catch(Exception error){
                    respond(reply,id,false,null,
                        error instanceof IllegalArgumentException?error.getMessage():
                            "game_network_unavailable");
                }finally{
                    if(connection!=null)connection.disconnect();
                    outstanding.decrementAndGet();
                }
            });
        });
    }

    private static String readLimited(InputStream stream)throws Exception{
        ByteArrayOutputStream out=new ByteArrayOutputStream();
        byte[] buffer=new byte[4096];int n;
        while((n=stream.read(buffer))!=-1){
            if(out.size()+n>1024*1024)throw new IllegalArgumentException("game_response_too_large");
            out.write(buffer,0,n);
        }
        return out.toString(StandardCharsets.UTF_8.name());
    }

    private void respond(JavaScriptReplyProxy reply,String id,boolean ok,JSONObject data,String error){
        if(closed.get())return;
        JSONObject response=new JSONObject();
        try{
            response.put("id",id);response.put("ok",ok);
            if(data!=null)response.put("data",data);
            if(error!=null)response.put("error",error);
        }catch(Exception ignored){return;}
        host.runOnUiThread(()->{
            if(!closed.get()&&gameWebView!=null)reply.postMessage(response.toString());
        });
    }

    private void cleanup(){
        if(!closed.compareAndSet(false,true))return;
        if(gameWebView!=null){
            gameWebView.stopLoading();
            gameWebView.loadUrl("about:blank");
            gameWebView.destroy();
            gameWebView=null;
        }
        io.shutdownNow();
    }
}
