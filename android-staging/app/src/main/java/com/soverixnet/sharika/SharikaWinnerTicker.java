package com.soverixnet.sharika;

import android.app.Activity;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.BooleanSupplier;

/**
 * Top-of-screen verified Food Wheel winner ticker for Sharika home/rooms.
 * Works only on authenticated staging and never reveals a Firebase token to JS.
 * The 10-second presentation is non-interactive and does not interrupt voice.
 * The hosted Game Center has its own ticker while its activity/dialog is open.
 */
final class SharikaWinnerTicker {
    private static final String ROUTE="/api/v1/original-games/greedy-classic/winners";
    private static final String API="https://sharika-api-staging.soverixnet.workers.dev";
    private final Activity activity;
    private final BooleanSupplier coveredByGame;
    private final Handler main=new Handler(Looper.getMainLooper());
    private final ExecutorService io=Executors.newSingleThreadExecutor();
    private final ArrayDeque<JSONObject> pending=new ArrayDeque<>();
    private final LinearLayout ticker;
    private final ImageView avatar;
    private final TextView nameText;
    private final TextView idText;
    private final TextView amountText;
    private volatile boolean running=false;
    private volatile boolean closed=false;
    private volatile boolean fetching=false;
    private boolean feedStarted=false,showing=false;
    private long highestWinnerId=0;
    private long generation=0;
    private final Runnable poll=new Runnable(){
        @Override public void run(){
            if(!running||closed)return;
            if(coveredByGame.getAsBoolean()){
                pending.clear();
            }else fetchVerifiedFeed();
            main.postDelayed(this,7500);
        }
    };

    SharikaWinnerTicker(Activity host,FrameLayout root,BooleanSupplier gameVisible){
        activity=host;coveredByGame=gameVisible;
        ticker=new LinearLayout(host);
        ticker.setGravity(Gravity.CENTER_VERTICAL);
        ticker.setOrientation(LinearLayout.HORIZONTAL);
        ticker.setPadding(dp(8),dp(6),dp(8),dp(6));
        GradientDrawable bg=new GradientDrawable(
            GradientDrawable.Orientation.LEFT_RIGHT,
            new int[]{Color.rgb(77,24,80),Color.rgb(30,12,58),Color.rgb(68,25,65)});
        bg.setCornerRadius(dp(16));
        bg.setStroke(dp(1.5f),Color.rgb(250,205,105));
        ticker.setBackground(bg);
        ticker.setElevation(dp(13));
        ticker.setVisibility(View.GONE);
        // Never intercept chat, microphone, room seats, or system back.
        ticker.setClickable(false);
        ticker.setFocusable(false);
        try(InputStream in=host.getAssets().open("game-cards/hot-food.jpg")){
            Bitmap icon=BitmapFactory.decodeStream(in);
            if(icon!=null){
                ImageView logo=new ImageView(host);
                logo.setImageBitmap(icon);
                logo.setScaleType(ImageView.ScaleType.CENTER_CROP);
                ticker.addView(logo,new LinearLayout.LayoutParams(dp(36),dp(36)));
            }
        }catch(Exception ignored){ /* app may omit this optional art */ }
        avatar=new ImageView(host);
        avatar.setScaleType(ImageView.ScaleType.CENTER_CROP);
        avatar.setBackgroundColor(Color.rgb(92,64,89));
        LinearLayout.LayoutParams ap=new LinearLayout.LayoutParams(dp(37),dp(37));
        ap.setMargins(dp(6),0,dp(7),0);
        ticker.addView(avatar,ap);
        LinearLayout names=new LinearLayout(host);
        names.setOrientation(LinearLayout.VERTICAL);
        nameText=text(host,12,Color.rgb(255,239,193),true);
        idText=text(host,10,Color.rgb(231,209,190),false);
        names.addView(nameText);names.addView(idText);
        ticker.addView(names,new LinearLayout.LayoutParams(0,-2,1));
        amountText=text(host,14,Color.rgb(255,224,110),true);
        ticker.addView(amountText,new LinearLayout.LayoutParams(-2,-2));
        int width=host.getResources().getDisplayMetrics().widthPixels-dp(60);
        FrameLayout.LayoutParams pos=new FrameLayout.LayoutParams(
            Math.max(dp(190),width),dp(55),Gravity.TOP|Gravity.START);
        pos.setMargins(dp(6),dp(5),0,0);
        root.addView(ticker,pos);
    }

    private static TextView text(Activity host,int size,int color,boolean bold){
        TextView text=new TextView(host);
        text.setTextColor(color);text.setTextSize(size);
        text.setMaxLines(1);text.setSingleLine(true);
        text.setEllipsize(android.text.TextUtils.TruncateAt.END);
        if(bold)text.setTypeface(null,android.graphics.Typeface.BOLD);
        return text;
    }
    private int dp(float value){
        return Math.round(value*activity.getResources().getDisplayMetrics().density);
    }
    void start(){
        if(closed||running||BuildConfig.SHARIKA_PLAY_BUILD ||
            !API.equals(BuildConfig.SHARIKA_API_ORIGIN))return;
        running=true;main.removeCallbacks(poll);main.post(poll);
    }
    void stop(){
        running=false;
        main.removeCallbacksAndMessages(null);
        pending.clear();showing=false;generation++;
        ticker.animate().cancel();ticker.setVisibility(View.GONE);
    }
    void destroy(){
        stop();closed=true;io.shutdownNow();
    }
    private void fetchVerifiedFeed(){
        if(fetching||FirebaseAuth.getInstance().getCurrentUser()==null)return;
        fetching=true;
        FirebaseUser user=FirebaseAuth.getInstance().getCurrentUser();
        user.getIdToken(false).addOnSuccessListener(token->{
            if(!running||closed||token==null||token.getToken()==null){
                fetching=false;return;
            }
            final String jwt=token.getToken();
            io.execute(()->{
                try{
                    HttpURLConnection c=(HttpURLConnection)new URL(API+ROUTE).openConnection();
                    try{
                        c.setConnectTimeout(5500);
                        c.setReadTimeout(5500);
                        c.setInstanceFollowRedirects(false);
                        c.setRequestProperty("Authorization","Bearer "+jwt);
                        c.setRequestProperty("Accept","application/json");
                        if(c.getResponseCode()!=200)return;
                        byte[] raw=readBounded(c.getInputStream(),65536);
                        JSONArray winners=new JSONObject(new String(raw,StandardCharsets.UTF_8))
                            .optJSONArray("winners");
                        if(winners!=null)main.post(()->ingest(winners));
                    }finally{c.disconnect();}
                }catch(Exception ignored){
                    // Never fabricate winners on failed or unauthenticated reads.
                }finally{fetching=false;}
            });
        }).addOnFailureListener(error->fetching=false);
    }
    private static byte[] readBounded(InputStream in,int limit)throws Exception{
        try(InputStream body=in;ByteArrayOutputStream out=new ByteArrayOutputStream()){
            byte[] buf=new byte[4096];int n;
            while((n=body.read(buf))!=-1){
                if(out.size()+n>limit)throw new IllegalArgumentException("oversize");
                out.write(buf,0,n);
            }
            return out.toByteArray();
        }
    }
    private void ingest(JSONArray array){
        if(!running||closed)return;
        long latest=highestWinnerId;
        ArrayDeque<JSONObject> added=new ArrayDeque<>();
        // Backend sorts newest first; enqueue in chronological order.
        for(int i=array.length()-1;i>=0;i--){
            JSONObject item=array.optJSONObject(i);
            if(item==null)continue;
            long id=item.optLong("id",0),win=item.optLong("win",0);
            String uid=item.optString("userId","");
            if(id<=highestWinnerId||win<=0||!uid.matches("[0-9]{6,12}"))continue;
            latest=Math.max(latest,id);
            added.add(item);
        }
        highestWinnerId=latest;
        if(!feedStarted){feedStarted=true;return;}
        if(coveredByGame.getAsBoolean())return;
        while(!added.isEmpty()&&pending.size()<15)pending.add(added.remove());
        showNext();
    }
    private void showNext(){
        if(!running||closed||showing||pending.isEmpty())return;
        if(coveredByGame.getAsBoolean()){pending.clear();return;}
        JSONObject current=pending.remove();
        final long seq=++generation;
        showing=true;
        String player=current.optString("name","Winner");
        if(player.length()>36)player=player.substring(0,36);
        nameText.setText(player);
        idText.setText("ID: "+current.optString("userId",""));
        amountText.setText("+"+String.format(java.util.Locale.US,"%,d",current.optLong("win",0)));
        avatar.setImageDrawable(null);
        loadAvatar(current.optString("avatar",""),seq);
        int width=activity.getResources().getDisplayMetrics().widthPixels;
        ticker.setTranslationX(width);ticker.setAlpha(0);ticker.setVisibility(View.VISIBLE);
        ticker.animate().translationX(0).alpha(1).setDuration(1700).start();
        main.postDelayed(()->{
            if(!running||seq!=generation)return;
            ticker.animate().translationX(-width).alpha(0).setDuration(2000).start();
        },8000);
        main.postDelayed(()->{
            if(!running||seq!=generation)return;
            ticker.setVisibility(View.GONE);showing=false;showNext();
        },10000);
    }
    private void loadAvatar(String source,long seq){
        if(source==null||source.length()>2048)return;
        try{
            Uri uri=Uri.parse(source);
            if(!"https".equalsIgnoreCase(uri.getScheme()))return;
            final String host=uri.getHost();
            if(!("sharika-api-staging.soverixnet.workers.dev".equals(host)||
                 "lh3.googleusercontent.com".equals(host)||
                 "firebasestorage.googleapis.com".equals(host)||
                 "storage.googleapis.com".equals(host)))return;
            io.execute(()->{
                HttpURLConnection c=null;
                try{
                    c=(HttpURLConnection)new URL(source).openConnection();
                    c.setConnectTimeout(3500);c.setReadTimeout(3500);
                    c.setInstanceFollowRedirects(false);
                    if(c.getResponseCode()!=200)return;
                    byte[] bytes=readBounded(c.getInputStream(),400000);
                    BitmapFactory.Options opts=new BitmapFactory.Options();
                    opts.inSampleSize=2;
                    Bitmap pic=BitmapFactory.decodeByteArray(bytes,0,bytes.length,opts);
                    if(pic!=null)main.post(()->{
                        if(running&&generation==seq&&showing)avatar.setImageBitmap(pic);
                    });
                }catch(Exception ignored){}finally{if(c!=null)c.disconnect();}
            });
        }catch(Exception ignored){}
    }
}
