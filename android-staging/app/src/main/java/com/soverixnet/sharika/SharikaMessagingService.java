package com.soverixnet.sharika;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/**
 * Verified data-only FCM alerts for the isolated staging APK.
 * The exact current Firebase UID must match the server-addressed recipient:
 * a reused device never displays notifications for a signed-out account.
 */
public final class SharikaMessagingService extends FirebaseMessagingService {
    private static final String API =
        "https://sharika-api-staging.soverixnet.workers.dev/api/v1/notifications/devices";
    private static final String OFFICIAL_CHANNEL = "sharika_official";
    private static final String MESSAGES_CHANNEL = "sharika_messages";

    @Override public void onNewToken(String token) {
        super.onNewToken(token);
        // Best-effort rotation registration; the WebView also registers on sign-in.
        FirebaseUser user = FirebaseAuth.getInstance().getCurrentUser();
        if (user == null || !user.isEmailVerified() || token == null) return;
        user.getIdToken(false).addOnSuccessListener(id -> {
            if (id.getToken() == null) return;
            final String jwt = id.getToken();
            new Thread(() -> {
                HttpURLConnection connection = null;
                try {
                    connection = (HttpURLConnection) new URL(API).openConnection();
                    connection.setRequestMethod("POST");
                    connection.setConnectTimeout(10000);
                    connection.setReadTimeout(10000);
                    connection.setDoOutput(true);
                    connection.setRequestProperty("Authorization","Bearer " + jwt);
                    connection.setRequestProperty("Content-Type","application/json");
                    JSONObject body = new JSONObject();
                    body.put("token", token);
                    try (OutputStream stream = connection.getOutputStream()) {
                        stream.write(body.toString().getBytes(StandardCharsets.UTF_8));
                    }
                    connection.getResponseCode();
                } catch (Exception ignored) {
                    // On next verified sign-in, the activity retries token registration.
                } finally {
                    if (connection != null) connection.disconnect();
                }
            }, "sharika-fcm-register").start();
        });
    }

    @Override public void onMessageReceived(RemoteMessage remote) {
        Map<String,String> data = remote.getData();
        FirebaseUser user = FirebaseAuth.getInstance().getCurrentUser();
        if (user == null || !user.getUid().equals(data.get("recipient_uid"))) return;
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
                PackageManager.PERMISSION_GRANTED) return;
        String type = data.get("kind");
        boolean message = "message".equals(type);
        String title = clipped(data.get("title"),100);
        String body = clipped(data.get("body"),180);
        if (title.isEmpty() || body.isEmpty()) return;
        String channelId = message ? MESSAGES_CHANNEL : OFFICIAL_CHANNEL;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(channelId,
            message ? "Messages" : "Official notices & rewards",
            NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription(message ?
            "New messages from Sharika members" :
            "Sharika official announcements, event, gift and reward alerts");
        manager.createNotificationChannel(channel);

        Intent open = new Intent(this, SharikaActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pending = PendingIntent.getActivity(this,0,open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new Notification.Builder(this,channelId)
            .setSmallIcon(R.mipmap.sharika_logo)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new Notification.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(pending)
            .setCategory(message ? Notification.CATEGORY_MESSAGE : Notification.CATEGORY_STATUS)
            .build();
        String key = message ? data.get("message_id") : data.get("notification_id");
        manager.notify((type + ":" + key).hashCode() & Integer.MAX_VALUE,notification);
    }
    private static String clipped(String value,int max) {
        if (value == null) return "";
        String text = value.trim();
        return text.length() > max ? text.substring(0,max) : text;
    }
}
