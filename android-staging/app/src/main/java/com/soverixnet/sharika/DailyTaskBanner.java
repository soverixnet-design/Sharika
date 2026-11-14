package com.soverixnet.sharika;

import android.app.Activity;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;

import com.google.android.gms.ads.AdListener;
import com.google.android.gms.ads.AdRequest;
import com.google.android.gms.ads.AdSize;
import com.google.android.gms.ads.AdView;
import com.google.android.gms.ads.LoadAdError;
import com.google.android.gms.ads.MobileAds;
import com.google.android.ump.ConsentInformation;
import com.google.android.ump.ConsentRequestParameters;
import com.google.android.ump.UserMessagingPlatform;

final class DailyTaskBanner {
    private static final String BANNER_UNIT = "ca-app-pub-6081763778059200/9914794591";

    private final Activity activity;
    private final LinearLayout container;
    private final Button privacy;
    private final ConsentInformation consent;
    private AdView banner;
    private boolean visible;
    private boolean consentRequested;
    private boolean initialized;
    private boolean destroyed;

    DailyTaskBanner(Activity activity, LinearLayout parent) {
        this.activity = activity;
        container = new LinearLayout(activity);
        container.setOrientation(LinearLayout.VERTICAL);
        container.setGravity(Gravity.CENTER_HORIZONTAL);
        container.setVisibility(View.GONE);
        privacy = new Button(activity);
        privacy.setText("Ad privacy choices");
        privacy.setVisibility(View.GONE);
        privacy.setOnClickListener(view -> showPrivacyOptions());
        container.addView(privacy);
        parent.addView(container, new LinearLayout.LayoutParams(-1, -2));
        consent = UserMessagingPlatform.getConsentInformation(activity);
    }

    void setVisible(boolean visible) {
        if (destroyed) return;
        this.visible = visible;
        if (!visible) {
            container.setVisibility(View.GONE);
            clearBanner();
            return;
        }
        if (consentRequested) {
            updateVisibility();
            loadWhenAllowed();
            return;
        }
        consentRequested = true;
        consent.requestConsentInfoUpdate(activity, new ConsentRequestParameters.Builder().build(),
            () -> UserMessagingPlatform.loadAndShowConsentFormIfRequired(activity, error -> onConsentReady()),
            error -> onConsentReady());
    }

    private void showPrivacyOptions() {
        if (destroyed || !privacyRequired()) return;
        UserMessagingPlatform.showPrivacyOptionsForm(activity, error -> {
            if (destroyed) return;
            clearBanner();
            onConsentReady();
        });
    }

    private boolean privacyRequired() {
        return consent.getPrivacyOptionsRequirementStatus()
            == ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED;
    }

    private void onConsentReady() {
        if (destroyed) return;
        updateVisibility();
        loadWhenAllowed();
    }

    private void loadWhenAllowed() {
        if (!visible || !consent.canRequestAds() || banner != null) return;
        if (!initialized) {
            initialized = true;
            new Thread(() -> MobileAds.initialize(activity, status ->
                activity.runOnUiThread(() -> {
                    if (!destroyed) loadBanner();
                })), "sharika-admob-init").start();
            return;
        }
        loadBanner();
    }

    private void loadBanner() {
        if (!visible || !consent.canRequestAds() || banner != null) return;
        AdView view = new AdView(activity);
        banner = view;
        view.setAdUnitId(BANNER_UNIT);
        view.setAdSize(AdSize.BANNER);
        view.setVisibility(View.GONE);
        view.setAdListener(new AdListener() {
            @Override public void onAdLoaded() {
                if (banner != view) return;
                view.setVisibility(View.VISIBLE);
                updateVisibility();
            }
            @Override public void onAdFailedToLoad(LoadAdError error) {
                if (banner != view) return;
                clearBanner();
                updateVisibility();
            }
        });
        container.addView(view);
        view.loadAd(new AdRequest.Builder().build());
    }

    private void updateVisibility() {
        privacy.setVisibility(privacyRequired() ? View.VISIBLE : View.GONE);
        boolean loaded = banner != null && banner.getVisibility() == View.VISIBLE;
        container.setVisibility(visible && (loaded || privacyRequired()) ? View.VISIBLE : View.GONE);
    }

    private void clearBanner() {
        if (banner == null) return;
        AdView view = banner;
        banner = null;
        container.removeView(view);
        view.destroy();
    }

    void destroy() {
        destroyed = true;
        clearBanner();
    }
}
