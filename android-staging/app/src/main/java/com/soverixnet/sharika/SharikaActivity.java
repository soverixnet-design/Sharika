package com.soverixnet.sharika;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.ImageDecoder;
import android.database.Cursor;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.util.Size;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.credentials.ClearCredentialStateRequest;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.ClearCredentialException;
import androidx.credentials.exceptions.GetCredentialException;

import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.GoogleAuthProvider;
import com.google.firebase.auth.FirebaseUser;

import org.json.JSONObject;
import org.json.JSONException;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Hybrid Android shell for the unchanged original Sharika HTML design.
 * Native Firebase authentication and an allowlisted Cloudflare staging HTTP
 * bridge are the only privileged capabilities. No service keys reach JS.
 *
 * The current feature branch is an isolated staging candidate, not production.
 */
public final class SharikaActivity extends Activity {
    private static final String STAGING_API = "https://sharika-api-staging.soverixnet.workers.dev";
    private static final int MIC_PERMISSION_REQUEST = 3412;
    private static final int IMAGE_PICKER_REQUEST = 3413;
    private static final int PROFILE_PHOTO_PICKER_REQUEST = 3414;
    private final ExecutorService io = Executors.newFixedThreadPool(2);
    private FirebaseAuth auth;
    private CredentialManager credentials;
    private WebView browser;
    private boolean backInProgress;
    private Runnable unregisterModernBack;
    private PermissionRequest pendingMic;
    private ValueCallback<Uri[]> pendingImageSelection;
    private String pendingProfilePhotoId;
    private boolean googlePending;
    // Firebase reload contacts the identity server; refreshing on every
    // 1.6-second live-game poll causes overlapping network calls.
    private volatile String recentlyVerifiedUserId;
    private volatile long lastVerifiedReloadMs;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN,
            WindowManager.LayoutParams.FLAG_FULLSCREEN);
        // Let the app background reach the physical top edge on phones with a
        // camera cutout. CSS keeps interactive controls below safe-area insets.
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
            WindowManager.LayoutParams window = getWindow().getAttributes();
            window.layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(window);
        }
        getWindow().setNavigationBarColor(Color.rgb(10, 7, 29));
        auth = FirebaseAuth.getInstance();
        credentials = CredentialManager.create(this);
        browser = new WebView(this);
        browser.setBackgroundColor(Color.rgb(7, 3, 26));
        browser.getSettings().setJavaScriptEnabled(true);
        browser.getSettings().setDomStorageEnabled(true);
        browser.getSettings().setAllowFileAccess(true);
        browser.getSettings().setAllowFileAccessFromFileURLs(false);
        browser.getSettings().setAllowUniversalAccessFromFileURLs(false);
        browser.getSettings().setJavaScriptCanOpenWindowsAutomatically(false);
        browser.getSettings().setMediaPlaybackRequiresUserGesture(false);
        browser.addJavascriptInterface(new NativeBridge(), "SharikaNative");
        browser.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // Never navigate the privileged JS bridge to an arbitrary website.
                if (!request.isForMainFrame()) return false;
                String destination = request.getUrl().toString();
                return !destination.startsWith("file:///android_asset/");
            }
            @Override public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (!"file:///android_asset/index.html".equals(url)) return;
                // Inject only into the packaged staging UI, never a remote page.
                view.evaluateJavascript(
                    "(function(){if(!document.getElementById('sharika-android-back')){" +
                    "var s=document.createElement('script');s.id='sharika-android-back';" +
                    "s.src='./back-navigation.js';document.head.appendChild(s);}})()",
                    null);
                // Visual-only Royal Premium layer; the native bridge and
                // verified voice/wallet/game adapters are intentionally untouched.
                view.evaluateJavascript(
                    "(function(){if(!document.getElementById('sharika-royal-ui')){" +
                    "var s=document.createElement('script');s.id='sharika-royal-ui';" +
                    "s.src='./royal-premium.js';document.head.appendChild(s);}})()",
                    null);
            }
        });
        browser.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> requestMicrophone(request));
            }
            @Override public boolean onShowFileChooser(WebView view,
                    ValueCallback<Uri[]> callback, WebChromeClient.FileChooserParams params) {
                // Android grants access only to the selected image. Do not
                // request blanket READ_MEDIA_IMAGES or storage permissions.
                if (pendingImageSelection != null) pendingImageSelection.onReceiveValue(null);
                pendingImageSelection = callback;
                Intent chooser = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                chooser.addCategory(Intent.CATEGORY_OPENABLE);
                chooser.setType("image/*");
                chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                try {
                    startActivityForResult(chooser, IMAGE_PICKER_REQUEST);
                    return true;
                } catch (RuntimeException error) {
                    pendingImageSelection = null;
                    callback.onReceiveValue(null);
                    return true;
                }
            }
        });
        setContentView(browser, new ViewGroup.LayoutParams(-1, -1));
        browser.loadUrl("file:///android_asset/index.html");
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            unregisterModernBack = Api33BackHandler.register(this);
        }
    }

    // One route handles the hardware Back key and Android 13+ back gestures.
    @Override @SuppressWarnings("deprecation")
    public void onBackPressed() {
        handleSystemBack();
    }

    private void handleSystemBack() {
        if (backInProgress || isFinishing() || isDestroyed()) return;
        if (browser == null) { confirmExit(); return; }
        backInProgress = true;
        browser.evaluateJavascript(
            "(function(){try{return typeof window.sharikaHandleAndroidBack==='function'" +
            "?window.sharikaHandleAndroidBack():'exit';}catch(e){return 'exit';}})()",
            result -> {
                backInProgress = false;
                if (!isFinishing() && !isDestroyed() && !"\"handled\"".equals(result)) {
                    confirmExit();
                }
            });
    }

    private void confirmExit() {
        if (isFinishing() || isDestroyed()) return;
        new AlertDialog.Builder(this)
            .setTitle("Exit Sharika?")
            .setMessage("Do you want to exit the app? An active voice room will disconnect.")
            .setNegativeButton("Stay", null)
            .setPositiveButton("Exit", (dialog, which) -> {
                if (browser == null) { finish(); return; }
                // Best-effort voice/seat cleanup through the existing room
                // lifecycle. Never make the Back button instantly quit a room.
                browser.evaluateJavascript(
                    "(function(){try{if(window.cur&&typeof window.leaveRoom==='function')" +
                    "window.leaveRoom();}catch(e){}})()", null);
                browser.postDelayed(this::finish, 400);
            })
            .show();
    }

    // Keep API 33-only types isolated for Android 8-12 installations.
    private static final class Api33BackHandler {
        static Runnable register(SharikaActivity activity) {
            android.window.OnBackInvokedCallback callback = activity::handleSystemBack;
            activity.getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, callback);
            return () -> activity.getOnBackInvokedDispatcher()
                .unregisterOnBackInvokedCallback(callback);
        }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == PROFILE_PHOTO_PICKER_REQUEST) {
            final String id = pendingProfilePhotoId;
            pendingProfilePhotoId = null;
            if (id == null) return;
            Uri uri = resultCode == Activity.RESULT_OK && data != null ? data.getData() : null;
            if (uri == null) {
                sendResult(id, result(false,null,"profile_photo_cancelled"));
                return;
            }
            io.execute(() -> {
                try {
                    JSONObject image = object();
                    image.put("image_data", makeProfileJpeg(uri));
                    sendResult(id, result(true,image,null));
                } catch (Exception error) {
                    sendResult(id, result(false,null,safe(error)));
                }
            });
            return;
        }
        if (requestCode != IMAGE_PICKER_REQUEST) return;
        ValueCallback<Uri[]> callback = pendingImageSelection;
        pendingImageSelection = null;
        if (callback == null) return;
        Uri selected = resultCode == Activity.RESULT_OK && data != null ? data.getData() : null;
        callback.onReceiveValue(selected == null ? null : new Uri[]{selected});
    }


    // Selected-media access only. This avoids browser-specific file:// canvas
    // decoding failures and works with JPEG, PNG and Android's HEIC photos.
    // No full gallery/storage permission is ever requested.
    private void pickNativeProfilePhoto(String id) {
        if (auth.getCurrentUser() == null) {
            sendResult(id, result(false,null,"login_required")); return;
        }
        if (pendingProfilePhotoId != null) {
            sendResult(id, result(false,null,"profile_photo_picker_busy")); return;
        }
        Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        picker.addCategory(Intent.CATEGORY_OPENABLE);
        picker.setType("image/*");
        picker.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        pendingProfilePhotoId = id;
        try {
            startActivityForResult(picker, PROFILE_PHOTO_PICKER_REQUEST);
        } catch (RuntimeException error) {
            pendingProfilePhotoId = null;
            sendResult(id, result(false,null,"gallery_unavailable"));
        }
    }

    private Bitmap decodeProfilePhoto(Uri uri) throws IOException {
        String type = getContentResolver().getType(uri);
        if (type != null && !type.startsWith("image/"))
            throw new IOException("Choose an image from the gallery");
        try (Cursor cursor = getContentResolver().query(uri,
                new String[]{OpenableColumns.SIZE}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst() && !cursor.isNull(0)
                    && cursor.getLong(0) > 15L * 1024 * 1024)
                throw new IOException("Choose a photo smaller than 15 MB");
        } catch (SecurityException error) {
            throw new IOException("Gallery photo permission expired");
        }
        if (android.os.Build.VERSION.SDK_INT >= 28) {
            ImageDecoder.Source source = ImageDecoder.createSource(getContentResolver(), uri);
            return ImageDecoder.decodeBitmap(source, (decoder, info, imageSource) -> {
                Size dimensions = info.getSize();
                float fraction = Math.min(1f, 960f /
                    Math.max(dimensions.getWidth(), dimensions.getHeight()));
                decoder.setTargetSize(Math.max(1, Math.round(dimensions.getWidth() * fraction)),
                    Math.max(1, Math.round(dimensions.getHeight() * fraction)));
                decoder.setAllocator(ImageDecoder.ALLOCATOR_SOFTWARE);
            });
        }
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        try (InputStream stream = getContentResolver().openInputStream(uri)) {
            if (stream == null) throw new IOException("Gallery photo unavailable");
            BitmapFactory.decodeStream(stream, null, bounds);
        }
        if (bounds.outWidth < 1 || bounds.outHeight < 1)
            throw new IOException("Invalid gallery image");
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = 1;
        while ((Math.max(bounds.outWidth,bounds.outHeight) / options.inSampleSize) > 960)
            options.inSampleSize *= 2;
        try (InputStream stream = getContentResolver().openInputStream(uri)) {
            if (stream == null) throw new IOException("Gallery photo unavailable");
            Bitmap bitmap = BitmapFactory.decodeStream(stream, null, options);
            if (bitmap == null) throw new IOException("Could not decode gallery photo");
            return bitmap;
        }
    }

    private String makeProfileJpeg(Uri uri) throws IOException {
        Bitmap source = decodeProfilePhoto(uri);
        try {
            if (source.getWidth() < 1 || source.getHeight() < 1)
                throw new IOException("Invalid gallery photo");
            for (int maximum : new int[]{880,720,560,440,320,240}) {
                float scale = Math.min(1f, maximum /
                    (float)Math.max(source.getWidth(),source.getHeight()));
                int width=Math.max(1,Math.round(source.getWidth()*scale));
                int height=Math.max(1,Math.round(source.getHeight()*scale));
                Bitmap output=Bitmap.createBitmap(width,height,Bitmap.Config.ARGB_8888);
                try {
                    Canvas canvas=new Canvas(output);
                    canvas.drawColor(Color.rgb(22,16,41));
                    canvas.drawBitmap(source,null,new Rect(0,0,width,height),
                        new Paint(Paint.FILTER_BITMAP_FLAG));
                    for (int quality : new int[]{78,65,50,38}) {
                        ByteArrayOutputStream bytes=new ByteArrayOutputStream();
                        if (!output.compress(Bitmap.CompressFormat.JPEG,quality,bytes))
                            throw new IOException("Could not prepare profile photo");
                        if (bytes.size() > 32 && bytes.size() <= 88000)
                            return "data:image/jpeg;base64,"+
                                Base64.encodeToString(bytes.toByteArray(),Base64.NO_WRAP);
                    }
                } finally {
                    output.recycle();
                }
            }
            throw new IOException("Photo is too large after resizing");
        } finally {
            source.recycle();
        }
    }

    private void requestMicrophone(PermissionRequest request) {
        // Grant only microphone, only after the Android runtime permission.
        boolean isAudio = false;
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) isAudio = true;
            else { request.deny(); return; }
        }
        if (!isAudio) { request.deny(); return; }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            request.grant(new String[] { PermissionRequest.RESOURCE_AUDIO_CAPTURE });
        } else {
            pendingMic = request;
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, MIC_PERMISSION_REQUEST);
        }
    }

    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] grants) {
        super.onRequestPermissionsResult(code, permissions, grants);
        if (code != MIC_PERMISSION_REQUEST || pendingMic == null) return;
        PermissionRequest request = pendingMic;
        pendingMic = null;
        if (grants.length > 0 && grants[0] == PackageManager.PERMISSION_GRANTED)
            request.grant(new String[]{ PermissionRequest.RESOURCE_AUDIO_CAPTURE });
        else request.deny();
    }

    private JSONObject object() { return new JSONObject(); }
    private JSONObject result(boolean ok, JSONObject data, String error) {
        JSONObject output = object();
        try {
            output.put("ok", ok);
            if (data != null) output.put("data", data);
            if (error != null) output.put("error", error);
        } catch (JSONException ignored) {}
        return output;
    }
    private JSONObject identity(FirebaseUser user) {
        JSONObject data = object();
        try {
            data.put("signedIn", user != null);
            if (user != null) {
                data.put("email", user.getEmail() == null ? "" : user.getEmail());
                data.put("emailVerified", user.isEmailVerified());
                data.put("displayName", user.getDisplayName() == null ? "" : user.getDisplayName());
            }
        } catch (JSONException ignored) {}
        return data;
    }
    private String safe(Exception exception) {
        if (exception == null) return "unknown_error";
        String message = exception.getLocalizedMessage();
        if (message == null) return "unknown_error";
        String cleaned = message.replaceAll("[\\r\\n]", " ");
        return cleaned.substring(0, Math.min(cleaned.length(), 240));
    }

    private void sendResult(String id, JSONObject response) {
        // JSON.quote ensures an untrusted request ID/response cannot inject JS.
        String expression = "window.SharikaNativeReply && window.SharikaNativeReply("
            + JSONObject.quote(id) + "," + JSONObject.quote(response.toString()) + ");";
        runOnUiThread(() -> {
            if (browser != null) browser.evaluateJavascript(expression, null);
        });
    }

    private final class NativeBridge {
        @JavascriptInterface public void call(String id, String action, String json) {
            if (id == null || id.length() > 50 || !id.matches("[0-9]+")) return;
            final JSONObject input;
            try {
                input = json == null ? object() : new JSONObject(json);
            } catch (JSONException error) {
                sendResult(id, result(false, null, "invalid_request"));
                return;
            }
            runOnUiThread(() -> handle(id, action, input));
        }
    }

    private void handle(String id, String action, JSONObject data) {
        if (action == null) { sendResult(id, result(false,null,"unknown_action")); return; }
        switch (action) {
            case "session":
                FirebaseUser signedIn = auth.getCurrentUser();
                if (signedIn == null) {
                    sendResult(id, result(true, identity(null), null));
                    return;
                }
                signedIn.reload().addOnCompleteListener(this, task -> {
                    FirebaseUser user = auth.getCurrentUser();
                    if (!task.isSuccessful() || user == null)
                        sendResult(id, result(false, null, safe(task.getException())));
                    else sendResult(id, result(true, identity(user), null));
                });
                break;
            case "emailSignIn": emailSignIn(id, data); break;
            case "emailSignUp": emailSignUp(id, data); break;
            case "googleSignIn": googleSignIn(id); break;
            case "signOut":
                auth.signOut();
                credentials.clearCredentialStateAsync(
                    new ClearCredentialStateRequest(), new CancellationSignal(),
                    this::runOnUiThread, new CredentialManagerCallback<Void, ClearCredentialException>() {
                        @Override public void onResult(Void ignored) {}
                        @Override public void onError(ClearCredentialException error) {}
                    });
                sendResult(id, result(true, identity(null), null));
                break;
            case "api": callStagingApi(id, data); break;
            case "pickProfilePhoto": pickNativeProfilePhoto(id); break;
            case "copyInviteCode":
                String inviteCode = data.optString("code", "");
                if (!inviteCode.matches("[0-9]{8}")) {
                    sendResult(id, result(false, null, "invalid_invite_code"));
                    break;
                }
                android.content.ClipboardManager clipboard =
                    (android.content.ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                clipboard.setPrimaryClip(android.content.ClipData.newPlainText("Sharika invite code", inviteCode));
                sendResult(id, result(true, object(), null));
                break;
            case "shareInvite":
                String invitation = data.optString("text", "");
                if (invitation.length() < 10 || invitation.length() > 320 ||
                    !invitation.startsWith("Join me on Sharika")) {
                    sendResult(id, result(false, null, "invalid_invite_message"));
                    break;
                }
                Intent share = new Intent(Intent.ACTION_SEND);
                share.setType("text/plain");
                share.putExtra(Intent.EXTRA_TEXT, invitation);
                try {
                    startActivity(Intent.createChooser(share, "Invite friends to Sharika"));
                    sendResult(id, result(true, object(), null));
                } catch (Exception error) {
                    sendResult(id, result(false, null, "share_unavailable"));
                }
                break;
            default: sendResult(id, result(false, null, "unsupported_action"));
        }
    }

    private void emailSignIn(String id, JSONObject data) {
        String email = data.optString("email", "").trim();
        String password = data.optString("password", "");
        if (!android.util.Patterns.EMAIL_ADDRESS.matcher(email).matches()) {
            sendResult(id, result(false, null, "valid_email_required"));
            return;
        }
        auth.signInWithEmailAndPassword(email, password).addOnCompleteListener(this, task -> {
            if (!task.isSuccessful())
                sendResult(id, result(false, null, safe(task.getException())));
            else {
                FirebaseUser current = auth.getCurrentUser();
                if (current == null) {
                    sendResult(id, result(false,null,"firebase_session_missing"));
                    return;
                }
                current.reload().addOnCompleteListener(this, refreshed -> {
                    FirebaseUser updated = auth.getCurrentUser();
                    if (!refreshed.isSuccessful() || updated == null)
                        sendResult(id, result(false,null,"firebase_session_refresh_failed"));
                    else sendResult(id, result(true, identity(updated), null));
                });
            }
        });
    }

    private void emailSignUp(String id, JSONObject data) {
        String email = data.optString("email", "").trim();
        String password = data.optString("password", "");
        if (!android.util.Patterns.EMAIL_ADDRESS.matcher(email).matches() || password.length() < 12) {
            sendResult(id, result(false,null,"valid_email_and_12_character_password_required"));
            return;
        }
        auth.createUserWithEmailAndPassword(email, password).addOnCompleteListener(this, task -> {
            FirebaseUser user = auth.getCurrentUser();
            if (!task.isSuccessful() || user == null) {
                sendResult(id, result(false, null, safe(task.getException())));
                return;
            }
            user.sendEmailVerification().addOnCompleteListener(this, sent -> {
                JSONObject account = identity(user);
                try { account.put("verificationSent", sent.isSuccessful()); }
                catch (JSONException ignored) {}
                sendResult(id, result(true, account, null));
            });
        });
    }

    private void googleSignIn(String id) {
        if (googlePending) {
            sendResult(id, result(false, null, "google_sign_in_in_progress")); return;
        }
        googlePending = true;
        try {
            GetSignInWithGoogleOption option = new GetSignInWithGoogleOption.Builder(
                getString(R.string.default_web_client_id)).build();
            GetCredentialRequest request = new GetCredentialRequest.Builder()
                .addCredentialOption(option).build();
            credentials.getCredentialAsync(
                this, request, new CancellationSignal(), this::runOnUiThread,
                new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                    @Override public void onResult(GetCredentialResponse response) {
                        Credential returned = response.getCredential();
                        if (!(returned instanceof CustomCredential)
                            || !GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(returned.getType())) {
                            googlePending = false;
                            sendResult(id, result(false,null,"google_token_missing"));
                            return;
                        }
                        try {
                            String token = GoogleIdTokenCredential
                                .createFrom(((CustomCredential) returned).getData()).getIdToken();
                            auth.signInWithCredential(GoogleAuthProvider.getCredential(token, null))
                                .addOnCompleteListener(SharikaActivity.this, task -> {
                                    googlePending = false;
                                    if (!task.isSuccessful())
                                        sendResult(id, result(false, null, safe(task.getException())));
                                    else sendResult(id, result(true, identity(auth.getCurrentUser()), null));
                                });
                        } catch (RuntimeException error) {
                            googlePending = false;
                            sendResult(id, result(false,null,safe(error)));
                        }
                    }
                    @Override public void onError(GetCredentialException error) {
                        googlePending = false;
                        sendResult(id, result(false,null,safe(error)));
                    }
                });
        } catch (Exception error) {
            googlePending = false;
            sendResult(id, result(false,null,safe(error)));
        }
    }

    private boolean allowedApi(String method, String path) {
        if (path == null || !path.startsWith("/api/v1/") ||
            path.contains("%") || path.contains("#") || path.contains("..") ||
            !(method.equals("GET") || method.equals("POST") ||
              method.equals("PATCH") || method.equals("PUT") || method.equals("DELETE")))
            return false;
        // A fixed-origin bridge, with explicit route/method allowlisting.
        // No /admin, arbitrary URLs, billing, redirects or platform credentials.
        if (path.matches("^/api/v1/rankings\\?period=(daily|weekly|monthly)&kind=(lucky|rich|charm|room|recharge)$"))
            return method.equals("GET");
        if (path.matches("^/api/v1/bonds/rankings\\?type=(cp|friendship)&period=(daily|weekly|monthly)$"))
            return method.equals("GET");
        if (path.matches("^/api/v1/games/(food-wheel|jackpot-fruit)/rankings\\?period=(daily|weekly|monthly)$"))
            return method.equals("GET");
        if (path.matches("^/api/v1/original-games/(sovera-food|night-food|jackpot-fruit)/rankings\\?period=(daily|weekly|monthly)$"))
            return method.equals("GET");
        // Only a numeric cursor on the verified room-chat route may carry a
        // query string. All other arbitrary query parameters stay blocked.
        if (path.matches("^/api/v1/rooms/[0-9]{8}/chat\\?after=(0|[1-9][0-9]{0,11})$"))
            return method.equals("GET");
        if (path.matches("^/api/v1/rooms/[0-9]{8}/entries\\?after=(0|[1-9][0-9]{0,11})$"))
            return method.equals("GET");
        if (path.matches("^/api/v1/rooms/[0-9]{8}/reactions\\?after=(0|[1-9][0-9]{0,11})$"))
            return method.equals("GET");
        if (path.contains("?")) return false;
        if (path.equals("/api/v1/presence/heartbeat")) return method.equals("POST");
        if (path.equals("/api/v1/me/avatar")) return method.equals("PUT");
        if (path.equals("/api/v1/me"))
            return method.equals("GET") || method.equals("POST") || method.equals("PATCH");
        if (path.equals("/api/v1/banners")) return method.equals("GET");
        if (path.equals("/api/v1/events")) return method.equals("GET");
        if (path.equals("/api/v1/cosmetics")) return method.equals("GET");
        if (path.equals("/api/v1/cosmetics/purchase") ||
            path.equals("/api/v1/cosmetics/equip")) return method.equals("POST");
        if (path.equals("/api/v1/wallet")) return method.equals("GET");
        if (path.equals("/api/v1/wallet/exchange-rate")) return method.equals("GET");
        if (path.equals("/api/v1/wallet/exchange")) return method.equals("POST");
        if (path.equals("/api/v1/follows") || path.equals("/api/v1/messages") ||
            path.equals("/api/v1/gifts")) return method.equals("GET");
        if (path.equals("/api/v1/support/messages"))
            return method.equals("GET") || method.equals("POST");
        if (path.matches("^/api/v1/users/[0-9]{8}$")) return method.equals("GET");
        if (path.matches("^/api/v1/users/[0-9]{8}/follow$"))
            return method.equals("GET") || method.equals("PUT") || method.equals("DELETE");
        if (path.matches("^/api/v1/messages/[0-9]{8}$"))
            return method.equals("GET") || method.equals("POST");
        if (path.matches("^/api/v1/games/(food-wheel|jackpot-fruit)/(state|history|rounds|stats|rankings)$"))
            return method.equals("GET");
        if (path.matches("^/api/v1/games/(food-wheel|jackpot-fruit)/bet$"))
            return method.equals("POST");
        if (path.matches("^/api/v1/original-games/(sovera-food|night-food|jackpot-fruit)/(state|history|stats|rankings)$"))
            return method.equals("GET");
        if (path.matches("^/api/v1/original-games/(sovera-food|night-food|jackpot-fruit)/bet$"))
            return method.equals("POST");
        if (path.matches("^/api/v1/greedy-wheel/(state|records)$"))
            return method.equals("GET");
        if (path.equals("/api/v1/greedy-wheel/bet"))
            return method.equals("POST");
        if (path.equals("/api/v1/games")) return method.equals("GET");
        if (path.equals("/api/v1/daily")) return method.equals("GET");
        if (path.equals("/api/v1/invites")) return method.equals("GET");
        if (path.equals("/api/v1/invites/rankings")) return method.equals("GET");
        if (path.equals("/api/v1/invites/redeem")) return method.equals("POST");
        if (path.equals("/api/v1/daily/check-in")) return method.equals("POST");
        if (path.equals("/api/v1/daily/tasks/claim")) return method.equals("POST");
        if (path.equals("/api/v1/premium")) return method.equals("GET");
        if (path.equals("/api/v1/premium/purchase") ||
            path.equals("/api/v1/premium/daily/claim")) return method.equals("POST");
        if (path.equals("/api/v1/bonds/catalog") || path.equals("/api/v1/bonds/me"))
            return method.equals("GET");
        if (path.matches("^/api/v1/bonds/profile/[0-9]{8}$") ||
            path.matches("^/api/v1/bonds/room/[0-9]{8}$"))
            return method.equals("GET");
        if (path.matches("^/api/v1/bonds/visits/[0-9]{8}$") ||
            path.equals("/api/v1/bonds/invite") ||
            path.equals("/api/v1/bonds/gift") ||
            path.matches("^/api/v1/bonds/invites/[1-9][0-9]{0,11}/respond$") ||
            path.matches("^/api/v1/bonds/[1-9][0-9]{0,11}/unbind$"))
            return method.equals("POST");
        if (path.equals("/api/v1/sellers") || path.equals("/api/v1/sellers/me") ||
            path.equals("/api/v1/sellers/transfers") || path.equals("/api/v1/sellers/allocations"))
            return method.equals("GET");
        if (path.equals("/api/v1/sellers/transfer")) return method.equals("POST");
        if (path.equals("/api/v1/rooms"))
            return method.equals("GET") || method.equals("POST");
        if (path.matches("^/api/v1/rooms/[0-9]{8}$"))
            return method.equals("GET") || method.equals("PATCH");
        if (path.matches("^/api/v1/rooms/[0-9]{8}/members$"))
            return method.equals("GET");
        if (path.matches("^/api/v1/rooms/[0-9]{8}/rewards$"))
            return method.equals("GET");
        if (path.matches("^/api/v1/rooms/[0-9]{8}/cover$"))
            return method.equals("PUT");
        if (path.matches("^/api/v1/rooms/[0-9]{8}/theme-image$"))
            return method.equals("PUT");
        if (path.matches("^/api/v1/rooms/[0-9]{8}/locks$"))
            return method.equals("PUT");
        if (path.matches("^/api/v1/rooms/[0-9]{8}/invitations$"))
            return method.equals("GET") || method.equals("POST");
        if (path.matches("^/api/v1/rooms/[0-9]{8}/invitations/respond$"))
            return method.equals("POST");
        if (path.matches("^/api/v1/rooms/[0-9]{8}/chat$"))
            return method.equals("POST");
        if (path.matches("^/api/v1/rooms/[0-9]{8}/reactions$"))
            return method.equals("POST");
        if (path.matches("^/api/v1/rooms/[0-9]{8}/(join|leave)$"))
            return method.equals("POST");
        if (path.matches("^/api/v1/rooms/[0-9]{8}/moderate$"))
            return method.equals("POST");
        if (path.matches("^/api/v1/rooms/[0-9]{8}/seat$"))
            return method.equals("PUT");
        if (path.matches("^/api/v1/rooms/[0-9]{8}/gifts$"))
            return method.equals("GET") || method.equals("POST");
        if (path.matches("^/api/v1/rooms/[0-9]{8}/voice-token$"))
            return method.equals("POST");
        // Preserve the already permitted voice transport routes byte-for-byte.
        return path.matches("^/api/v1/rooms/[0-9]{8}/voice/(config|session|publish|subscribe|renegotiate|publications|heartbeat|leave)$")
            && (method.equals("GET") || method.equals("POST") || method.equals("PUT"));
    }

    private void callStagingApi(String id, JSONObject data) {
        String method = data.optString("method", "GET").toUpperCase(java.util.Locale.ROOT);
        String path = data.optString("path", "");
        if (!allowedApi(method, path)) {
            sendResult(id, result(false,null,"staging_route_not_available"));
            return;
        }
        FirebaseUser user = auth.getCurrentUser();
        if (user == null) {
            sendResult(id, result(false,null,"login_required")); return;
        }
        // Check verified email with Firebase regularly, not on every live-game
        // state poll. Every individual API call still gets a Firebase ID token;
        // the Worker validates that token and the user on each request.
        long now = android.os.SystemClock.elapsedRealtime();
        if (user.getUid().equals(recentlyVerifiedUserId)
            && user.isEmailVerified() && now - lastVerifiedReloadMs < 60000L) {
            requestStagingToken(id, method, path, data, user);
            return;
        }
        user.reload().addOnCompleteListener(this, reload -> {
            FirebaseUser current = auth.getCurrentUser();
            if (!reload.isSuccessful() || current == null) {
                sendResult(id, result(false,null,"login_refresh_failed")); return;
            }
            if (!current.isEmailVerified()) {
                sendResult(id, result(false,null,"email_verification_required")); return;
            }
            recentlyVerifiedUserId = current.getUid();
            lastVerifiedReloadMs = android.os.SystemClock.elapsedRealtime();
            requestStagingToken(id, method, path, data, current);
        });
    }

    private void requestStagingToken(String id, String method, String path,
                                    JSONObject data, FirebaseUser user) {
        user.getIdToken(false).addOnCompleteListener(this, token -> {
            if (!token.isSuccessful() || token.getResult() == null
                || token.getResult().getToken() == null) {
                sendResult(id, result(false,null,"firebase_token_unavailable")); return;
            }
            JSONObject body = data.optJSONObject("body");
            io.execute(() -> stageHttp(id, method, path, body, token.getResult().getToken()));
        });
    }

    private void stageHttp(String id, String method, String path, JSONObject body, String jwt) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(STAGING_API + path).openConnection();
            connection.setRequestMethod(method);
            // Photo uploads carry an optimized JPEG across a mobile connection.
            // Keep normal requests short, but allow a slower gallery save to
            // finish and return its server commit confirmation.
            boolean savingImage = method.equals("PUT") &&
                (path.equals("/api/v1/me/avatar") ||
                 path.matches("^/api/v1/rooms/[0-9]{8}/(cover|theme-image)$"));
            connection.setConnectTimeout(savingImage ? 20000 : 12000);
            connection.setReadTimeout(savingImage ? 60000 : 12000);
            connection.setRequestProperty("Accept","application/json");
            connection.setRequestProperty("Authorization","Bearer " + jwt);
            if (body != null) {
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type","application/json; charset=utf-8");
                try (OutputStream stream = connection.getOutputStream()) {
                    stream.write(body.toString().getBytes(StandardCharsets.UTF_8));
                }
            }
            int status = connection.getResponseCode();
            InputStream raw = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            StringBuilder data = new StringBuilder();
            if (raw != null) {
                try (BufferedReader lines = new BufferedReader(
                    new InputStreamReader(raw, StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = lines.readLine()) != null && data.length() < 100_000)
                        data.append(line);
                }
            }
            JSONObject payload = new JSONObject(data.toString());
            if (status >= 200 && status < 300) {
                sendResult(id, result(true, payload, null));
            } else {
                sendResult(id, result(false, null,
                    payload.optString("error", "http_" + status)));
            }
        } catch (Exception error) {
            sendResult(id, result(false,null,safe(error)));
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    @Override protected void onDestroy() {
        if (unregisterModernBack != null) {
            unregisterModernBack.run();
            unregisterModernBack = null;
        }
        if (pendingMic != null) { pendingMic.deny(); pendingMic = null; }
        if (browser != null) {
            browser.removeJavascriptInterface("SharikaNative");
            browser.destroy();
            browser = null;
        }
        io.shutdownNow();
        super.onDestroy();
    }
}
