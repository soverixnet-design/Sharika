package com.soverixnet.sharika;

import android.app.Activity;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.text.InputType;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

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

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Isolated Android authentication/API smoke-test client.
 *
 * This staging tester never loads the existing Sharika/Supabase frontend,
 * never calls any financial endpoint, and never writes to D1.
 * It is not a production voice-room release.
 */
public final class MainActivity extends Activity {
    private static final String BACKEND = "https://sharika-api-staging.soverixnet.workers.dev";
    private static final int BACKGROUND = Color.rgb(15, 19, 40);
    private static final int WHITE = Color.WHITE;
    private static final int MUTED = Color.rgb(190, 197, 217);

    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private FirebaseAuth auth;
    private CredentialManager credentialManager;
    private boolean googleSignInPending;
    private TextView status;
    private TextView identity;
    private EditText email;
    private EditText password;
    // Isolated staging-only profile and room controls. Never points at the live app.
    private EditText profileName;
    private EditText profileBirthday;
    private EditText profileCountry;
    private EditText roomName;
    private EditText roomId;
    private EditText seatNo;

    private int dp(int size) {
        return Math.round(getResources().getDisplayMetrics().density * size);
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(BACKGROUND);
        getWindow().setNavigationBarColor(BACKGROUND);
        auth = FirebaseAuth.getInstance();
        credentialManager = CredentialManager.create(this);
        buildScreen();
        refreshIdentity();
        checkHealth();
    }

    private void buildScreen() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(BACKGROUND);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(22), dp(34), dp(22), dp(28));
        scroll.addView(root);
        setContentView(scroll);

        // Original user-supplied Sharika art: no generated redraw or logo changes.
        ImageView logo = new ImageView(this);
        logo.setImageResource(R.mipmap.sharika_logo);
        logo.setScaleType(ImageView.ScaleType.FIT_CENTER);
        logo.setContentDescription("Sharika app logo");
        LinearLayout.LayoutParams artwork = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, dp(210));
        artwork.bottomMargin = dp(14);
        root.addView(logo, artwork);

        TextView title = label("Sharika Voice Chat", 29, WHITE, true);
        root.addView(title);
        root.addView(label("Android staging • Firebase + Cloudflare D1", 14, MUTED, false));

        TextView warning = label(
            "PRIVATE TEST BUILD\nNot the finished voice chat app. Original Supabase users, wallet, and rooms are untouched.",
            14, Color.rgb(255, 222, 159), false);
        LinearLayout.LayoutParams warn = new LinearLayout.LayoutParams(-1, -2);
        warn.topMargin = dp(24);
        warn.bottomMargin = dp(18);
        warning.setLayoutParams(warn);
        root.addView(warning);

        email = entry("Email", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
        root.addView(email);
        password = entry("Password (12+ characters)", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        root.addView(password);

        root.addView(action("Continue with Google", this::signInGoogle, "#4285F4"));
        root.addView(action("Sign in", this::signIn, "#7862F5"));
        root.addView(action("Create staging Firebase account", this::register, "#426DE5"));
        root.addView(action("Send verification email", this::sendVerification, "#39445F"));
        root.addView(action("Refresh login and test Cloudflare API", this::testAuthenticatedApi, "#167A78"));
        root.addView(action("Check backend health", this::checkHealth, "#39445F"));
        root.addView(action("Sign out", this::signOut, "#39445F"));

        TextView stagingSection = label("Staging profile & rooms", 23, WHITE, true);
        LinearLayout.LayoutParams section = new LinearLayout.LayoutParams(-1, -2);
        section.topMargin = dp(28);
        section.bottomMargin = dp(10);
        stagingSection.setLayoutParams(section);
        root.addView(stagingSection);
        root.addView(label("These controls write ONLY to the new, isolated D1 staging database. Existing users and wallets are not migrated.", 13, MUTED, false));

        profileName = entry("Your display name (required)", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_WORDS);
        root.addView(profileName);
        profileBirthday = entry("Date of birth: YYYY-MM-DD (age 13+)", InputType.TYPE_CLASS_DATETIME);
        root.addView(profileBirthday);
        profileCountry = entry("Country (for example BD)", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS);
        root.addView(profileCountry);
        root.addView(action("Create my new staging profile", this::createStagingProfile, "#426DE5"));
        root.addView(action("Read my staging profile", this::readStagingProfile, "#39445F"));
        root.addView(action("Read my staging wallet (no transfers)", this::readStagingWallet, "#39445F"));

        TextView roomSection = label("Staging rooms (no live voice yet)", 20, WHITE, true);
        LinearLayout.LayoutParams roomHeader = new LinearLayout.LayoutParams(-1, -2);
        roomHeader.topMargin = dp(22);
        roomSection.setLayoutParams(roomHeader);
        root.addView(roomSection);
        roomName = entry("New room name", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        root.addView(roomName);
        root.addView(action("Create my staging room", this::createStagingRoom, "#426DE5"));
        root.addView(action("List staging rooms", this::listStagingRooms, "#39445F"));
        roomId = entry("8-digit room ID", InputType.TYPE_CLASS_NUMBER);
        root.addView(roomId);
        root.addView(action("Join room", this::joinStagingRoom, "#167A78"));
        root.addView(action("View room members", this::readStagingMembers, "#39445F"));
        seatNo = entry("Seat 1–20, or 0 to stand", InputType.TYPE_CLASS_NUMBER);
        root.addView(seatNo);
        root.addView(action("Take / release my room seat", this::setStagingSeat, "#167A78"));
        root.addView(action("Leave room", this::leaveStagingRoom, "#39445F"));

        identity = label("", 14, MUTED, false);
        LinearLayout.LayoutParams identityParams = new LinearLayout.LayoutParams(-1, -2);
        identityParams.topMargin = dp(20);
        identity.setLayoutParams(identityParams);
        root.addView(identity);

        status = label("Starting staging checks…", 14, WHITE, false);
        LinearLayout.LayoutParams info = new LinearLayout.LayoutParams(-1, -2);
        info.topMargin = dp(15);
        status.setLayoutParams(info);
        root.addView(status);
    }

    private TextView label(String value, int sp, int color, boolean bold) {
        TextView text = new TextView(this);
        text.setText(value);
        text.setTextSize(sp);
        text.setTextColor(color);
        if (bold) text.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        text.setLineSpacing(dp(3), 1.0f);
        return text;
    }

    private EditText entry(String hint, int inputType) {
        EditText field = new EditText(this);
        field.setHint(hint);
        field.setInputType(inputType);
        field.setSingleLine(true);
        field.setTextColor(WHITE);
        field.setHintTextColor(MUTED);
        field.setBackgroundTintList(ColorStateList.valueOf(Color.rgb(130, 119, 195)));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, dp(62));
        params.bottomMargin = dp(8);
        field.setLayoutParams(params);
        return field;
    }

    private Button action(String name, View.OnClickListener listener, String tint) {
        Button button = new Button(this);
        button.setText(name);
        button.setAllCaps(false);
        button.setTextColor(WHITE);
        button.setBackgroundTintList(ColorStateList.valueOf(Color.parseColor(tint)));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, dp(49));
        params.topMargin = dp(7);
        button.setLayoutParams(params);
        button.setOnClickListener(listener);
        return button;
    }

    private void show(String message) {
        status.setText(message);
    }

    private void refreshIdentity() {
        FirebaseUser user = auth.getCurrentUser();
        if (identity != null) {
            identity.setText(user == null ? "Firebase session: not signed in"
                : "Firebase session: " + user.getEmail()
                    + (user.isEmailVerified() ? " (email verified)" : " (email NOT verified)"));
        }
    }

    private boolean credentialsReady() {
        String address = email.getText().toString().trim();
        String secret = password.getText().toString();
        if (!android.util.Patterns.EMAIL_ADDRESS.matcher(address).matches()
            || secret.length() < 12) {
            show("Enter a valid email and a password of at least 12 characters.");
            return false;
        }
        return true;
    }

    private void register(View view) {
        if (!credentialsReady()) return;
        show("Creating a NEW Firebase staging user…");
        auth.createUserWithEmailAndPassword(
            email.getText().toString().trim(), password.getText().toString()
        ).addOnCompleteListener(this, task -> {
            refreshIdentity();
            if (!task.isSuccessful()) {
                show("Firebase registration failed: " + safeError(task.getException()));
                return;
            }
            FirebaseUser user = auth.getCurrentUser();
            if (user == null) {
                show("Registration succeeded, but no session is available.");
                return;
            }
            user.sendEmailVerification().addOnCompleteListener(this, sent ->
                show(sent.isSuccessful()
                    ? "Account created. Check your inbox and verify your email. Then refresh."
                    : "Account created, but verification email failed: " + safeError(sent.getException())));
        });
    }

    /** Explicit Google button flow; no changes to the existing app or stored users. */
    private void signInGoogle(View view) {
        if (googleSignInPending) return;
        googleSignInPending = true;
        show("Opening Google account picker for isolated Firebase staging…");
        try {
            // The Google Services Gradle plugin generates this Web OAuth client ID
            // from the verified client_type=3 entry in google-services.json.
            GetSignInWithGoogleOption option = new GetSignInWithGoogleOption.Builder(
                getString(R.string.default_web_client_id)).build();
            GetCredentialRequest request = new GetCredentialRequest.Builder()
                .addCredentialOption(option).build();
            credentialManager.getCredentialAsync(
                this, request, new CancellationSignal(), this::runOnUiThread,
                new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                    @Override
                    public void onResult(GetCredentialResponse response) {
                        Credential credential = response.getCredential();
                        if (!(credential instanceof CustomCredential)
                            || !GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
                                .equals(credential.getType())) {
                            googleSignInPending = false;
                            show("Google sign-in did not return a Google ID token.");
                            return;
                        }
                        try {
                            String idToken = GoogleIdTokenCredential
                                .createFrom(((CustomCredential) credential).getData()).getIdToken();
                            auth.signInWithCredential(GoogleAuthProvider.getCredential(idToken, null))
                                .addOnCompleteListener(MainActivity.this, task -> {
                                    googleSignInPending = false;
                                    refreshIdentity();
                                    show(task.isSuccessful()
                                        ? "Google + Firebase sign-in succeeded. Test Cloudflare API next."
                                        : "Google Firebase sign-in failed: "
                                            + safeError(task.getException()));
                                });
                        } catch (RuntimeException error) {
                            googleSignInPending = false;
                            show("Google ID token was invalid: " + safeError(error));
                        }
                    }

                    @Override
                    public void onError(GetCredentialException error) {
                        googleSignInPending = false;
                        show("Google account selection unavailable: " + safeError(error));
                    }
                });
        } catch (Exception error) {
            googleSignInPending = false;
            show("Could not start Google sign-in: " + safeError(error));
        }
    }

    private void signOut(View view) {
        auth.signOut();
        refreshIdentity();
        show("Signed out of Firebase staging.");
        // Also clear provider state so the next Google button press can choose
        // a different account. This does not revoke or delete Google accounts.
        credentialManager.clearCredentialStateAsync(
            new ClearCredentialStateRequest(), new CancellationSignal(),
            this::runOnUiThread, new CredentialManagerCallback<Void, ClearCredentialException>() {
                @Override public void onResult(Void result) { }
                @Override public void onError(ClearCredentialException error) { }
            });
    }

    private void signIn(View view) {
        if (!credentialsReady()) return;
        show("Signing in to Firebase staging…");
        auth.signInWithEmailAndPassword(
            email.getText().toString().trim(), password.getText().toString()
        ).addOnCompleteListener(this, task -> {
            refreshIdentity();
            show(task.isSuccessful()
                ? "Firebase sign-in succeeded. Verify email if needed, then test Cloudflare API."
                : "Firebase sign-in failed: " + safeError(task.getException()));
        });
    }

    private void sendVerification(View view) {
        FirebaseUser user = auth.getCurrentUser();
        if (user == null) { show("Sign in first."); return; }
        user.sendEmailVerification().addOnCompleteListener(this, task ->
            show(task.isSuccessful() ? "Verification email sent. Check your inbox."
                : "Could not send email: " + safeError(task.getException())));
    }

    private static String safeError(Exception error) {
        if (error == null) return "Unknown error";
        String value = error.getLocalizedMessage();
        return value == null ? "Unknown error" : value.replaceAll("[\\r\\n]", " ");
    }

    // Firebase identity is always verified by the Worker again. These methods
    // never use an app-supplied UID, a service key, or a Supabase session.
    private interface TokenAction { void run(String token); }

    private void afterStagingLogin(TokenAction action) {
        FirebaseUser user = auth.getCurrentUser();
        if (user == null) {
            show("Sign in with Google or email first.");
            return;
        }
        show("Checking Firebase sign-in before the staging request…");
        user.reload().addOnCompleteListener(this, refreshed -> {
            FirebaseUser current = auth.getCurrentUser();
            refreshIdentity();
            if (!refreshed.isSuccessful() || current == null) {
                show("Could not refresh login: " + safeError(refreshed.getException()));
                return;
            }
            if (!current.isEmailVerified()) {
                show("Verify your Firebase email first, or use Google login.");
                return;
            }
            current.getIdToken(false).addOnCompleteListener(this, tokenResult -> {
                if (!tokenResult.isSuccessful() || tokenResult.getResult() == null
                    || tokenResult.getResult().getToken() == null) {
                    show("Firebase token unavailable: " + safeError(tokenResult.getException()));
                    return;
                }
                action.run(tokenResult.getResult().getToken());
            });
        });
    }

    private void createStagingProfile(View ignored) {
        String name = profileName.getText().toString().trim();
        String birthday = profileBirthday.getText().toString().trim();
        String country = profileCountry.getText().toString().trim();
        if (name.isEmpty() || !birthday.matches("\\d{4}-\\d{2}-\\d{2}")) {
            show("Enter your name and birth date in YYYY-MM-DD format.");
            return;
        }
        try {
            JSONObject payload = new JSONObject().put("name", name).put("birthdate", birthday)
                .put("country", country);
            afterStagingLogin(token -> stagingRequest("POST", "/api/v1/me", token, payload, false));
        } catch (org.json.JSONException error) {
            show("Profile input is invalid.");
        }
    }

    private void readStagingProfile(View ignored) {
        afterStagingLogin(token -> stagingRequest("GET", "/api/v1/me", token, null, false));
    }

    private void readStagingWallet(View ignored) {
        afterStagingLogin(token -> stagingRequest("GET", "/api/v1/wallet", token, null, false));
    }

    private void createStagingRoom(View ignored) {
        String name = roomName.getText().toString().trim();
        if (name.isEmpty()) { show("Enter a room name."); return; }
        try {
            JSONObject payload = new JSONObject().put("name", name).put("seat_count", 12);
            afterStagingLogin(token -> stagingRequest("POST", "/api/v1/rooms", token, payload, true));
        } catch (org.json.JSONException error) {
            show("Invalid room name.");
        }
    }

    private void listStagingRooms(View ignored) {
        afterStagingLogin(token -> stagingRequest("GET", "/api/v1/rooms", token, null, false));
    }

    private String selectedRoomPath() {
        String id = roomId.getText().toString().trim();
        if (!id.matches("\\d{8}")) {
            show("Enter the exact 8-digit staging room ID.");
            return null;
        }
        return "/api/v1/rooms/" + id;
    }

    private void joinStagingRoom(View ignored) {
        String path = selectedRoomPath();
        if (path != null) afterStagingLogin(token -> stagingRequest("POST", path + "/join", token, null, false));
    }

    private void leaveStagingRoom(View ignored) {
        String path = selectedRoomPath();
        if (path != null) afterStagingLogin(token -> stagingRequest("POST", path + "/leave", token, null, false));
    }

    private void readStagingMembers(View ignored) {
        String path = selectedRoomPath();
        if (path != null) afterStagingLogin(token -> stagingRequest("GET", path + "/members", token, null, false));
    }

    private void setStagingSeat(View ignored) {
        String path = selectedRoomPath();
        if (path == null) return;
        String input = seatNo.getText().toString().trim();
        int seat;
        try { seat = Integer.parseInt(input); }
        catch (NumberFormatException e) { show("Seat must be 0–20."); return; }
        if (seat < 0 || seat > 20) { show("Seat must be 0–20."); return; }
        try {
            JSONObject body = new JSONObject().put("seat_no", seat == 0 ? JSONObject.NULL : seat);
            afterStagingLogin(token -> stagingRequest("PUT", path + "/seat", token, body, false));
        } catch (org.json.JSONException error) {
            show("Seat input is invalid.");
        }
    }

    private void stagingRequest(String method, String path, String token, JSONObject body,
                                boolean saveRoomId) {
        show("Contacting isolated staging API: " + method + " " + path);
        io.execute(() -> {
            HttpURLConnection connection = null;
            int code = -1;
            JSONObject response = null;
            String message;
            try {
                connection = (HttpURLConnection) new URL(BACKEND + path).openConnection();
                connection.setRequestMethod(method);
                connection.setConnectTimeout(12000);
                connection.setReadTimeout(12000);
                connection.setRequestProperty("Accept", "application/json");
                connection.setRequestProperty("Authorization", "Bearer " + token);
                if (body != null) {
                    connection.setDoOutput(true);
                    connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                    try (java.io.OutputStream output = connection.getOutputStream()) {
                        output.write(body.toString().getBytes(StandardCharsets.UTF_8));
                    }
                }
                code = connection.getResponseCode();
                InputStream stream = code >= 400
                    ? connection.getErrorStream() : connection.getInputStream();
                StringBuilder raw = new StringBuilder();
                if (stream != null) {
                    try (BufferedReader reader = new BufferedReader(
                        new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                        String line;
                        while ((line = reader.readLine()) != null && raw.length() < 4500)
                            raw.append(line);
                    }
                }
                response = new JSONObject(raw.toString());
                if (code >= 200 && code < 300) {
                    String shown = response.toString(2);
                    message = "Staging request succeeded (HTTP " + code + ").\n"
                        + shown.substring(0, Math.min(shown.length(), 3500));
                } else {
                    String error = response.optString("error", "unknown");
                    message = "Staging API HTTP " + code + ": " + error;
                    if (code == 404 && "profile_not_found".equals(error))
                        message += "\nCreate your staging profile first. Old users are not migrated.";
                    if (code == 501)
                        message += "\nThis feature is intentionally locked until safe migration.";
                }
            } catch (Exception error) {
                message = "Staging request failed: " + safeError(error);
            } finally {
                if (connection != null) connection.disconnect();
            }
            final String result = message;
            final String createdId = saveRoomId && code >= 200 && code < 300
                && response != null ? response.optString("id", "") : "";
            runOnUiThread(() -> {
                show(result);
                if (createdId.matches("\\d{8}")) roomId.setText(createdId);
            });
        });
    }

    private void testAuthenticatedApi(View view) {
        FirebaseUser user = auth.getCurrentUser();
        if (user == null) { show("Sign in first."); return; }
        show("Refreshing Firebase verification state…");
        user.reload().addOnCompleteListener(this, reload -> {
            refreshIdentity();
            FirebaseUser current = auth.getCurrentUser();
            if (!reload.isSuccessful() || current == null) {
                show("Could not refresh user: " + safeError(reload.getException()));
                return;
            }
            if (!current.isEmailVerified()) {
                show("Check your email verification link first; Cloudflare requires a verified account.");
                return;
            }
            current.getIdToken(true).addOnCompleteListener(this, tokenResult -> {
                if (!tokenResult.isSuccessful() || tokenResult.getResult() == null) {
                    show("Firebase ID token unavailable: " + safeError(tokenResult.getException()));
                    return;
                }
                // ID token is only sent over HTTPS to Sharika's isolated staging Worker.
                fetchJson("/api/v1/me", tokenResult.getResult().getToken());
            });
        });
    }

    private void checkHealth(View ignored) {
        checkHealth();
    }

    private void checkHealth() {
        fetchJson("/health", null);
    }

    private void fetchJson(String path, String idToken) {
        show("Checking " + path + " on isolated Cloudflare staging…");
        io.execute(() -> {
            HttpURLConnection connection = null;
            String result;
            try {
                connection = (HttpURLConnection) new URL(BACKEND + path).openConnection();
                connection.setRequestMethod("GET");
                connection.setConnectTimeout(12000);
                connection.setReadTimeout(12000);
                connection.setRequestProperty("Accept", "application/json");
                if (idToken != null && !idToken.isEmpty())
                    connection.setRequestProperty("Authorization", "Bearer " + idToken);
                int code = connection.getResponseCode();
                InputStream stream = code >= 400
                    ? connection.getErrorStream() : connection.getInputStream();
                StringBuilder body = new StringBuilder();
                if (stream != null) {
                    try (BufferedReader reader = new BufferedReader(
                        new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                        String line;
                        while ((line = reader.readLine()) != null && body.length() < 8192)
                            body.append(line);
                    }
                }
                JSONObject data = new JSONObject(body.toString());
                if (path.equals("/health")) {
                    result = code == 200 && data.optBoolean("ok")
                        ? "Cloudflare Worker + D1 online. Firebase project configured: "
                            + data.optBoolean("auth_configured")
                        : "Backend health failed (HTTP " + code + ").";
                } else if (code == 404 && "profile_not_found".equals(data.optString("error"))) {
                    result = "Firebase token verified by Cloudflare (HTTP 404)."
                        + " No D1 profile yet: expected before identity migration.";
                } else if (code == 200) {
                    result = "Authenticated Cloudflare API succeeded (HTTP 200).";
                } else {
                    result = "Cloudflare API rejected request (HTTP " + code
                        + "): " + data.optString("error", "unknown");
                }
            } catch (Exception error) {
                result = "Staging network check failed: " + safeError(error);
            } finally {
                if (connection != null) connection.disconnect();
            }
            final String message = result;
            runOnUiThread(() -> show(message));
        });
    }

    @Override
    protected void onDestroy() {
        io.shutdownNow();
        super.onDestroy();
    }
}
