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
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;

/** Google Play owns the price and payment UI; only the Worker may grant coins. */
final class SharikaPlayBilling implements PurchasesUpdatedListener {
    interface Reply { void complete(JSONObject value, String error); }
    private static final List<String> IDS = Arrays.asList(
        "sharika_coins_500k", "sharika_coins_2500k", "sharika_coins_5000k");
    private final Activity activity;
    private final BillingClient client;
    private final List<java.util.function.Consumer<String>> waiting = new ArrayList<>();
    private boolean connecting;
    private Reply pendingPurchase;

    SharikaPlayBilling(Activity activity) {
        this.activity = activity;
        client = BillingClient.newBuilder(activity)
            .setListener(this)
            .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            .enableAutoServiceReconnection()
            .build();
    }

    private void ready(java.util.function.Consumer<String> done) {
        if (client.isReady()) { done.accept(null); return; }
        waiting.add(done);
        if (connecting) return;
        connecting = true;
        client.startConnection(new BillingClientStateListener() {
            @Override public void onBillingSetupFinished(BillingResult result) {
                connecting = false;
                String error = result.getResponseCode() == BillingClient.BillingResponseCode.OK
                    ? null : "play_billing_unavailable_" + result.getResponseCode();
                List<java.util.function.Consumer<String>> callbacks = new ArrayList<>(waiting);
                waiting.clear();
                for (java.util.function.Consumer<String> callback : callbacks) callback.accept(error);
            }
            @Override public void onBillingServiceDisconnected() {
                connecting = false;
                if (!waiting.isEmpty()) {
                    List<java.util.function.Consumer<String>> callbacks = new ArrayList<>(waiting);
                    waiting.clear();
                    for (java.util.function.Consumer<String> callback : callbacks)
                        callback.accept("play_billing_disconnected");
                }
            }
        });
    }

    private static QueryProductDetailsParams productsParams(List<String> ids) {
        List<QueryProductDetailsParams.Product> products = new ArrayList<>();
        for (String id : ids)
            products.add(QueryProductDetailsParams.Product.newBuilder()
                .setProductId(id).setProductType(BillingClient.ProductType.INAPP).build());
        return QueryProductDetailsParams.newBuilder().setProductList(products).build();
    }

    private void queryOwned(Reply callback, JSONArray products) {
        client.queryPurchasesAsync(QueryPurchasesParams.newBuilder()
            .setProductType(BillingClient.ProductType.INAPP).build(), (result, purchases) -> {
            if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                callback.complete(null, "play_purchases_unavailable_" + result.getResponseCode());
                return;
            }
            JSONObject response = new JSONObject();
            try {
                response.put("products", products);
                response.put("purchases", purchasedItems(purchases));
            } catch (JSONException error) {
                callback.complete(null, "play_invalid_response"); return;
            }
            callback.complete(response, null);
        });
    }

    void catalog(Reply callback) {
        ready(error -> {
            if (error != null) { callback.complete(null, error); return; }
            client.queryProductDetailsAsync(productsParams(IDS), (result, details) -> {
                if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                    callback.complete(null, "play_products_unavailable_" + result.getResponseCode());
                    return;
                }
                JSONArray products = new JSONArray();
                for (ProductDetails product : details.getProductDetailsList()) {
                    if (!IDS.contains(product.getProductId())) continue;
                    List<ProductDetails.OneTimePurchaseOfferDetails> offers =
                        product.getOneTimePurchaseOfferDetailsList();
                    if (offers == null || offers.isEmpty()) continue;
                    JSONObject info = new JSONObject();
                    try {
                        info.put("id", product.getProductId());
                        info.put("title", product.getName());
                        info.put("price", offers.get(0).getFormattedPrice());
                        products.put(info);
                    } catch (JSONException ignored) {}
                }
                queryOwned(callback, products);
            });
        });
    }

    private static String accountHash(String firebaseUid) throws Exception {
        byte[] bytes = MessageDigest.getInstance("SHA-256")
            .digest(firebaseUid.getBytes(StandardCharsets.UTF_8));
        StringBuilder out = new StringBuilder(64);
        for (byte value : bytes) out.append(String.format(Locale.ROOT, "%02x", value & 0xff));
        return out.toString();
    }

    void purchase(String productId, String firebaseUid, Reply callback) {
        if (!IDS.contains(productId) || firebaseUid == null || firebaseUid.isEmpty()) {
            callback.complete(null, "invalid_play_product"); return;
        }
        if (pendingPurchase != null) {
            callback.complete(null, "play_purchase_in_progress"); return;
        }
        ready(error -> {
            if (error != null) { callback.complete(null, error); return; }
            // Always request fresh ProductDetails immediately before launch.
            client.queryProductDetailsAsync(productsParams(Arrays.asList(productId)), (result, details) -> {
                if (result.getResponseCode() != BillingClient.BillingResponseCode.OK ||
                    details.getProductDetailsList().isEmpty()) {
                    callback.complete(null, "play_product_unavailable"); return;
                }
                ProductDetails product = details.getProductDetailsList().get(0);
                List<ProductDetails.OneTimePurchaseOfferDetails> offers =
                    product.getOneTimePurchaseOfferDetailsList();
                if (!productId.equals(product.getProductId()) || offers == null || offers.isEmpty()) {
                    callback.complete(null, "play_product_unavailable"); return;
                }
                try {
                    BillingFlowParams.ProductDetailsParams detailsParams =
                        BillingFlowParams.ProductDetailsParams.newBuilder()
                            .setProductDetails(product)
                            .setOfferToken(offers.get(0).getOfferToken())
                            .build();
                    BillingFlowParams flow = BillingFlowParams.newBuilder()
                        .setProductDetailsParamsList(Arrays.asList(detailsParams))
                        .setObfuscatedAccountId(accountHash(firebaseUid)).build();
                    pendingPurchase = callback;
                    BillingResult launch = client.launchBillingFlow(activity, flow);
                    if (launch.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                        pendingPurchase = null;
                        callback.complete(null, "play_launch_failed_" + launch.getResponseCode());
                    }
                } catch (Exception invalid) {
                    pendingPurchase = null;
                    callback.complete(null, "play_purchase_unavailable");
                }
            });
        });
    }

    private static JSONArray purchasedItems(List<Purchase> purchases) {
        JSONArray out = new JSONArray();
        if (purchases == null) return out;
        for (Purchase purchase : purchases) {
            if (purchase.getPurchaseState() != Purchase.PurchaseState.PURCHASED) continue;
            for (String id : purchase.getProducts()) {
                if (!IDS.contains(id)) continue;
                JSONObject item = new JSONObject();
                try {
                    item.put("product_id", id);
                    item.put("purchase_token", purchase.getPurchaseToken());
                    out.put(item);
                } catch (JSONException ignored) {}
            }
        }
        return out;
    }

    @Override public void onPurchasesUpdated(BillingResult result, List<Purchase> purchases) {
        Reply callback = pendingPurchase;
        pendingPurchase = null;
        if (callback == null) return;
        if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
            callback.complete(null, result.getResponseCode() == BillingClient.BillingResponseCode.USER_CANCELED
                ? "play_purchase_cancelled" : "play_purchase_failed_" + result.getResponseCode());
            return;
        }
        JSONArray completed = purchasedItems(purchases);
        if (completed.length() == 0) {
            callback.complete(null, "play_purchase_pending"); return;
        }
        JSONObject response = new JSONObject();
        try { response.put("purchases", completed); }
        catch (JSONException ignored) {}
        callback.complete(response, null);
    }

    void close() {
        if (pendingPurchase != null) {
            pendingPurchase.complete(null, "play_purchase_interrupted");
            pendingPurchase = null;
        }
        client.endConnection();
    }
}
