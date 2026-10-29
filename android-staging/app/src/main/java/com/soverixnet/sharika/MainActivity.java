package com.soverixnet.sharika;

import android.app.Activity;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import com.google.firebase.auth.FirebaseAuth;
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
    private TextView status;
    private TextView identity;
    private EditText email;
    private EditText password;

    private int dp(int size) {
        return Math.round(getResources().getDisplayMetrics().density * size);
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(BACKGROUND);
        getWindow().setNavigationBarColor(BACKGROUND);
        auth = FirebaseAuth.getInstance();
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

        root.addView(action("Sign in", this::signIn, "#7862F5"));
        root.addView(action("Create staging Firebase account", this::register, "#426DE5"));
        root.addView(action("Send verification email", this::sendVerification, "#39445F"));
        root.addView(action("Refresh login and test Cloudflare API", this::testAuthenticatedApi, "#167A78"));
        root.addView(action("Check backend health", this::checkHealth, "#39445F"));
        root.addView(action("Sign out", () -> {
            auth.signOut();
            refreshIdentity();
            show("Signed out from this staging app.");
        }, "#39445F"));

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
