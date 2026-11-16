package com.soverixnet.sharika;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.ResultReceiver;

/** Keeps the authenticated WebView voice room eligible for background audio. */
public final class RoomAudioService extends Service {
    static final String START_LISTENING = "room.audio.listen";
    static final String PREPARE_MIC = "room.audio.mic";
    static final String RELEASE_MIC = "room.audio.releaseMic";
    static final String LEAVE = "room.audio.leave";
    static final String CALLBACK = "callback";
    static final int READY = 1;
    static final int LEFT = 2;
    static final int FAILED = 3;
    private static final String CHANNEL = "sharika_ongoing_voice_room";
    private static final int NOTIFICATION_ID = 3472;

    private ResultReceiver roomCallback;
    private PowerManager.WakeLock wakeLock;

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (LEAVE.equals(action)) {
            if (roomCallback != null) roomCallback.send(LEFT, null);
            stopSelf();
            return START_NOT_STICKY;
        }
        if (!START_LISTENING.equals(action) && !PREPARE_MIC.equals(action)
                && !RELEASE_MIC.equals(action)) {
            stopSelf();
            return START_NOT_STICKY;
        }

        ResultReceiver callback = Build.VERSION.SDK_INT >= 33
            ? intent.getParcelableExtra(CALLBACK, ResultReceiver.class)
            : intent.getParcelableExtra(CALLBACK);
        boolean microphone = PREPARE_MIC.equals(action);
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                int types = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK;
                if (microphone && Build.VERSION.SDK_INT >= 30)
                    types |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
                startForeground(NOTIFICATION_ID, notification(), types);
            } else {
                startForeground(NOTIFICATION_ID, notification());
            }
            if (START_LISTENING.equals(action)) roomCallback = callback;
            if (wakeLock == null) {
                PowerManager power = getSystemService(PowerManager.class);
                if (power != null) {
                    wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Sharika:RoomAudio");
                    wakeLock.setReferenceCounted(false);
                    wakeLock.acquire();
                }
            }
            if (callback != null) callback.send(READY, null);
        } catch (RuntimeException denied) {
            if (callback != null) callback.send(FAILED, null);
            if (roomCallback == null || START_LISTENING.equals(action)) stopSelf();
        }
        return START_NOT_STICKY;
    }

    private Notification notification() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        NotificationChannel channel = new NotificationChannel(
            CHANNEL, getString(R.string.room_audio_channel), NotificationManager.IMPORTANCE_LOW);
        manager.createNotificationChannel(channel);
        int immutable = PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT;
        Intent open = new Intent(this, SharikaActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent returnToSharika = PendingIntent.getActivity(this, 3472, open, immutable);
        PendingIntent leave = PendingIntent.getService(this, 3473,
            new Intent(this, RoomAudioService.class).setAction(LEAVE), immutable);
        return new Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle(getString(R.string.room_audio_title))
            .setContentText(getString(R.string.room_audio_active))
            .setContentIntent(returnToSharika)
            .setCategory(Notification.CATEGORY_SERVICE)
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .addAction(new Notification.Action.Builder(
                (android.graphics.drawable.Icon) null, getString(R.string.room_audio_leave), leave).build())
            .build();
    }

    @Override public void onDestroy() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        stopForeground(STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }
}
