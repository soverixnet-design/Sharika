package com.soverixnet.sharika;

import android.app.Activity;

import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;
import com.android.billingclient.api.ConsumeParams;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/**
 * Play Billing is available only to verified signed-in Android accounts.
 * The app never credits coins: its Cloudflare backend verifies the Google
 * purchase token and performs one D1 transaction before we consume it.
 * Product prices come from Google Play, never from client-side USD labels.
 */
public final class PlayBillingController implements PurchasesUpdatedListener {
    public interface Delegate {
        void reply(String requestId, JSONObject value, String error);
        void processPurchase(Purchase purchase);
        void event(String state, String message);
        String obfuscatedAccountId();
    }

    private static final List<String> PRODUCT_IDS = Collections.unmodifiableList(
        Arrays.asList("sharika_coins_500k", "sharika_coins_2500k", "sharika_coins_5000k"));
    private final Activity activity;
    private final Delegate delegate;
    private final BillingClient billing;
    private static final class PendingAction {
        final String id;
        final Runnable action;
        PendingAction(String id, Runnable action) { this.id=id; this.action=action; }
    }
    private final List<PendingAction> awaitingConnection = new ArrayList<>();
    private boolean connecting;

    public PlayBillingController(Activity activity, Delegate delegate) {
        this.activity = activity;
        this.delegate = delegate;
        this.billing = BillingClient.newBuilder(activity)
            .setListener(this)
            .enablePendingPurchases(PendingPurchasesParams.newBuilder()
                .enableOneTimeProducts().build())
            .enableAutoServiceReconnection()
            .build();
    }

    private void connected(String requestId, Runnable action) {
        if (billing.isReady()) { action.run(); return; }
        awaitingConnection.add(new PendingAction(requestId, action));
        if (connecting) return;
        connecting = true;
        billing.startConnection(new BillingClientStateListener() {
            @Override public void onBillingSetupFinished(BillingResult result) {
                connecting = false;
                if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                    List<PendingAction> waiting = new ArrayList<>(awaitingConnection);
                    awaitingConnection.clear();
                    for (PendingAction pending : waiting)
                        delegate.reply(pending.id, null, "play_store_billing_unavailable");
                    return;
                }
                List<PendingAction> actions = new ArrayList<>(awaitingConnection);
                awaitingConnection.clear();
                for (PendingAction queued : actions) queued.action.run();
            }
            @Override public void onBillingServiceDisconnected() { connecting = false; }
        });
    }

    private QueryProductDetailsParams productsQuery(List<String> ids) {
        List<QueryProductDetailsParams.Product> products = new ArrayList<>();
        for (String id : ids)
            products.add(QueryProductDetailsParams.Product.newBuilder()
                .setProductId(id).setProductType(BillingClient.ProductType.INAPP).build());
        return QueryProductDetailsParams.newBuilder().setProductList(products).build();
    }

    private ProductDetails.OneTimePurchaseOfferDetails offer(ProductDetails details) {
        List<ProductDetails.OneTimePurchaseOfferDetails> offers =
            details.getOneTimePurchaseOfferDetailsList();
        if (offers != null && !offers.isEmpty()) return offers.get(0);
        return details.getOneTimePurchaseOfferDetails();
    }

    public void listProducts(String requestId) {
        connected(requestId, () -> billing.queryProductDetailsAsync(
            productsQuery(PRODUCT_IDS), (result, detailsResult) -> {
                if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                    delegate.reply(requestId, null, "play_product_query_failed"); return;
                }
                JSONArray visible = new JSONArray();
                for (ProductDetails details : detailsResult.getProductDetailsList()) {
                    ProductDetails.OneTimePurchaseOfferDetails item = offer(details);
                    if (item == null || !PRODUCT_IDS.contains(details.getProductId())) continue;
                    JSONObject row = new JSONObject();
                    try {
                        row.put("id", details.getProductId());
                        row.put("name", details.getName());
                        row.put("price", item.getFormattedPrice());
                        visible.put(row);
                    } catch (Exception ignored) { }
                }
                JSONObject response = new JSONObject();
                try { response.put("products", visible); }
                catch (Exception ignored) { }
                delegate.reply(requestId, response, null);
            }));
    }

    public void buy(String requestId, String productId) {
        final String account = delegate.obfuscatedAccountId();
        if (account == null || !account.matches("[0-9a-f]{64}")) {
            delegate.reply(requestId, null, "login_required"); return;
        }
        if (!PRODUCT_IDS.contains(productId)) {
            delegate.reply(requestId, null, "invalid_play_product"); return;
        }
        connected(requestId, () -> billing.queryProductDetailsAsync(
            productsQuery(Collections.singletonList(productId)), (result, detailsResult) -> {
                if (result.getResponseCode() != BillingClient.BillingResponseCode.OK ||
                    detailsResult.getProductDetailsList().isEmpty()) {
                    delegate.reply(requestId, null, "play_product_unavailable"); return;
                }
                ProductDetails details = detailsResult.getProductDetailsList().get(0);
                ProductDetails.OneTimePurchaseOfferDetails selected = offer(details);
                if (selected == null) {
                    delegate.reply(requestId, null, "play_offer_unavailable"); return;
                }
                BillingFlowParams.ProductDetailsParams.Builder params =
                    BillingFlowParams.ProductDetailsParams.newBuilder()
                        .setProductDetails(details);
                if (selected.getOfferToken() != null && !selected.getOfferToken().isEmpty())
                    params.setOfferToken(selected.getOfferToken());
                BillingFlowParams flow = BillingFlowParams.newBuilder()
                    .setProductDetailsParamsList(Collections.singletonList(params.build()))
                    .setObfuscatedAccountId(account)
                    .build();
                BillingResult launch = billing.launchBillingFlow(activity, flow);
                if (launch.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                    delegate.reply(requestId, null, "play_purchase_not_started"); return;
                }
                JSONObject reply = new JSONObject();
                try { reply.put("started", true); }
                catch (Exception ignored) { }
                delegate.reply(requestId, reply, null);
            }));
    }

    /** Retry unconsumed verified receipts after an interrupted purchase. */
    public void restore(String requestId) {
        if (delegate.obfuscatedAccountId() == null) {
            delegate.reply(requestId, null, "login_required"); return;
        }
        connected(requestId, () -> billing.queryPurchasesAsync(
            QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build(),
            (result, purchases) -> {
                if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                    delegate.reply(requestId, null, "play_restore_failed"); return;
                }
                for (Purchase purchase : purchases) handlePurchase(purchase);
                JSONObject response = new JSONObject();
                try { response.put("checked", purchases.size()); }
                catch (Exception ignored) { }
                delegate.reply(requestId, response, null);
            }));
    }

    private void handlePurchase(Purchase purchase) {
        if (purchase.getPurchaseState() == Purchase.PurchaseState.PENDING) {
            delegate.event("pending", "Google Play payment is pending; no coins added yet.");
        } else if (purchase.getPurchaseState() == Purchase.PurchaseState.PURCHASED) {
            delegate.processPurchase(purchase);
        }
    }

    @Override public void onPurchasesUpdated(BillingResult result, List<Purchase> purchases) {
        if (result.getResponseCode() == BillingClient.BillingResponseCode.OK && purchases != null) {
            for (Purchase purchase : purchases) handlePurchase(purchase);
        } else if (result.getResponseCode() == BillingClient.BillingResponseCode.USER_CANCELED) {
            delegate.event("cancelled", "Google Play purchase cancelled.");
        } else if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
            delegate.event("error", "Google Play payment unavailable; no coins added.");
        }
    }

    public void consumeVerified(String token) {
        if (!billing.isReady()) return; // Restore will retry when Play returns.
        billing.consumeAsync(ConsumeParams.newBuilder().setPurchaseToken(token).build(),
            (result, ignored) -> {
                if (result.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                    delegate.event("credited", "Google Play payment verified. Wallet updated.");
                } else {
                    delegate.event("retry", "Coins credited. Play purchase confirmation will retry.");
                }
            });
    }

    public void close() { billing.endConnection(); }
}
