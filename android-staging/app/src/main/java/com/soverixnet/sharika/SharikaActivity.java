package com.soverixnet.sharika;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
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
    private final ExecutorService io = Executors.newFixedThreadPool(2);
    private FirebaseAuth auth;
    private CredentialManager credentials;
    private WebView browser;
    private PermissionRequest pendingMic;
    private boolean googlePending;

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
        });
        browser.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> requestMicrophone(request));
            }
        });
        setContentView(browser, new ViewGroup.LayoutParams(-1, -1));
        browser.loadUrl("file:///android_asset/index.html");
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
        if (path.matches("^/api/v1/rankings\\?period=(daily|weekly|monthly)&kind=(rich|charm|room)$"))
            return method.equals("GET");
        if (path.contains("?")) return false;
        if (path.equals("/api/v1/me"))
            return method.equals("GET") || method.equals("POST") || method.equals("PATCH");
        if (path.equals("/api/v1/wallet")) return method.equals("GET");
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
        if (path.matches("^/api/v1/games/(food-wheel|jackpot-fruit)/(state|history)$"))
            return method.equals("GET");
        if (path.matches("^/api/v1/games/(food-wheel|jackpot-fruit)/bet$"))
            return method.equals("POST");
        if (path.equals("/api/v1/games")) return method.equals("GET");
        if (path.equals("/api/v1/rooms"))
            return method.equals("GET") || method.equals("POST");
        if (path.matches("^/api/v1/rooms/[0-9]{8}$"))
            return method.equals("GET") || method.equals("PATCH");
        if (path.matches("^/api/v1/rooms/[0-9]{8}/members$"))
            return method.equals("GET");
        if (path.matches("^/api/v1/rooms/[0-9]{8}/(join|leave)$"))
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
        user.reload().addOnCompleteListener(this, reload -> {
            FirebaseUser current = auth.getCurrentUser();
            if (!reload.isSuccessful() || current == null) {
                sendResult(id, result(false,null,"login_refresh_failed")); return;
            }
            if (!current.isEmailVerified()) {
                sendResult(id, result(false,null,"email_verification_required")); return;
            }
            current.getIdToken(false).addOnCompleteListener(this, token -> {
                if (!token.isSuccessful() || token.getResult() == null
                    || token.getResult().getToken() == null) {
                    sendResult(id, result(false,null,"firebase_token_unavailable")); return;
                }
                JSONObject body = data.optJSONObject("body");
                io.execute(() -> stageHttp(id, method, path, body, token.getResult().getToken()));
            });
        });
    }

    private void stageHttp(String id, String method, String path, JSONObject body, String jwt) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(STAGING_API + path).openConnection();
            connection.setRequestMethod(method);
            connection.setConnectTimeout(12000);
            connection.setReadTimeout(12000);
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
