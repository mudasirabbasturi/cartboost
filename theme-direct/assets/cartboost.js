(function() {
  "use strict";
  if (window.__CartBoostInitialized) {
    if (window.CartBoost && typeof window.CartBoost.refresh === "function") {
      window.CartBoost.refresh();
    }
    return;
  }
  window.__CartBoostInitialized = true;

  var cachedCart = null;
  var debounceTimeout = null;

  function getDecimals(c) {
    try {
      var p = new Intl.NumberFormat(undefined, { style: "currency", currency: c || "USD" }).resolvedOptions();
      return typeof p.maximumFractionDigits === "number" ? p.maximumFractionDigits : 2;
    } catch (e) {
      return 2;
    }
  }

  function formatMoney(amount, currency) {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(amount);
    } catch (e) {
      return (currency || "$") + " " + Number(amount).toFixed(2);
    }
  }

  function renderBars(cart) {
    if (!cart) return;
    cachedCart = cart;
    var bars = document.querySelectorAll(".cb-shipping-bar");
    if (!bars.length) return;

    var currency = cart.currency || "USD";
    var decimals = getDecimals(currency);
    var divisor = Math.pow(10, decimals);
    var cartTotal = (cart.total_price || 0) / divisor;
    var itemCount = cart.item_count || 0;

    bars.forEach(function(bar) {
      var threshold = parseFloat(bar.getAttribute("data-cb-threshold")) || 50;
      var progTpl = bar.getAttribute("data-cb-message") || "You're {amount} away from FREE shipping!";
      var succTpl = bar.getAttribute("data-cb-success-message") || "Congratulations! You've unlocked FREE shipping!";
      var emptyTpl = bar.getAttribute("data-cb-empty-message") || "Free shipping on orders over {amount}!";

      var msgEl = bar.querySelector(".cb-shipping-bar__message");
      var fillEl = bar.querySelector(".cb-shipping-bar__progress-fill");
      var msg = "";
      var pct = 0;
      var rem = Math.max(0, threshold - cartTotal);

      if (itemCount === 0) {
        pct = 0;
        msg = emptyTpl.replace(/\{amount\}/g, formatMoney(threshold, currency));
        bar.classList.remove("cb-is-complete");
      } else if (cartTotal >= threshold) {
        pct = 100;
        msg = succTpl;
        bar.classList.add("cb-is-complete");
      } else {
        pct = threshold > 0 ? Math.min(100, Math.max(0, (cartTotal / threshold) * 100)) : 100;
        msg = progTpl.replace(/\{amount\}/g, formatMoney(rem, currency));
        bar.classList.remove("cb-is-complete");
      }

      if (msgEl) msgEl.textContent = msg;
      if (fillEl) {
        fillEl.style.width = pct + "%";
        fillEl.setAttribute("aria-valuenow", Math.round(pct).toString());
      }
    });
  }

  function fetchCart() {
    fetch("/cart.js?_cb=" + Date.now(), { headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" } })
      .then(function(r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function(cart) {
        renderBars(cart);
      })
      .catch(function(err) {
        console.warn("[CartBoost] Cart fetch:", err.message);
      });
  }

  function triggerCartUpdate() {
    if (debounceTimeout) clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(fetchCart, 150);
  }

  function insertTarget(el, target, pos) {
    if (!el || !target) return;
    if (target.contains(el)) return;
    if (pos === "prepend") {
      target.prepend(el);
    } else if (pos === "append") {
      target.appendChild(el);
    } else if (pos === "before" && target.parentNode) {
      target.parentNode.insertBefore(el, target);
    } else if (pos === "after" && target.parentNode) {
      target.parentNode.insertBefore(el, target.nextSibling);
    } else {
      target.prepend(el);
    }
  }

  function positionEmbedBanners() {
    var embeds = document.querySelectorAll(".cb-shipping-bar--embed");
    embeds.forEach(function(em) {
      var mode = em.getAttribute("data-cb-placement") || "top_universal";
      var sel = em.getAttribute("data-cb-custom-selector");
      var pos = em.getAttribute("data-cb-insertion") || "prepend";

      if (mode === "custom_selector" && sel) {
        var customEl = document.querySelector(sel);
        if (customEl) {
          insertTarget(em, customEl, pos);
          return;
        }
      }

      if (mode === "cart_drawer") {
        var drawerSels = [
          "cart-drawer .drawer__header",
          "cart-drawer .drawer__inner",
          "cart-drawer",
          "#CartDrawer .drawer__header",
          "#CartDrawer",
          ".cart-drawer__header",
          ".cart-drawer__body",
          "[data-cart-drawer] .drawer__header",
          "[data-cart-drawer]",
          ".ajaxcart__header",
          ".slideout-cart"
        ];
        for (var i = 0; i < drawerSels.length; i++) {
          var t = document.querySelector(drawerSels[i]);
          if (t) {
            insertTarget(em, t, "prepend");
            return;
          }
        }
      }

      if (document.body && document.body.firstElementChild !== em) {
        document.body.prepend(em);
      }
    });

    var slots = document.querySelectorAll(".cb-shipping-bar-slot, [data-cb-shipping-bar-slot]");
    if (slots.length && embeds.length) {
      slots.forEach(function(slot) {
        if (!slot.querySelector(".cb-shipping-bar")) {
          var clone = embeds[0].cloneNode(true);
          clone.classList.remove("cb-shipping-bar--embed", "cb-shipping-bar--sticky");
          slot.appendChild(clone);
        }
      });
    }
  }

  function interceptFetch() {
    if (typeof window.fetch !== "function") return;
    var orig = window.fetch;
    window.fetch = function() {
      var p = orig.apply(this, arguments);
      try {
        var u = typeof arguments[0] === "string" ? arguments[0] : (arguments[0] && arguments[0].url ? arguments[0].url : "");
        if (u && (u.indexOf("/cart/add") !== -1 || u.indexOf("/cart/change") !== -1 || u.indexOf("/cart/update") !== -1 || u.indexOf("/cart/clear") !== -1)) {
          p.then(function(r) {
            if (r && r.ok) {
              positionEmbedBanners();
              triggerCartUpdate();
            }
          }).catch(function() {});
        }
      } catch (e) {}
      return p;
    };
  }

  function interceptXHR() {
    if (typeof XMLHttpRequest === "undefined") return;
    var oOpen = XMLHttpRequest.prototype.open;
    var oSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(m, u) {
      this._cbUrl = u;
      return oOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function() {
      var u = this._cbUrl;
      if (typeof u === "string" && (u.indexOf("/cart/add") !== -1 || u.indexOf("/cart/change") !== -1 || u.indexOf("/cart/update") !== -1 || u.indexOf("/cart/clear") !== -1)) {
        this.addEventListener("load", function() {
          if (this.status >= 200 && this.status < 300) {
            positionEmbedBanners();
            triggerCartUpdate();
          }
        });
      }
      return oSend.apply(this, arguments);
    };
  }

  function attachThemeListeners() {
    ["cart:updated", "cart:refresh", "cart:change", "cart:add", "cart-updated", "cart-drawer:updated", "cart-drawer:open", "shopify:cart:updated"].forEach(function(ev) {
      document.addEventListener(ev, function() {
        positionEmbedBanners();
        triggerCartUpdate();
      });
      window.addEventListener(ev, function() {
        positionEmbedBanners();
        triggerCartUpdate();
      });
    });

    if (window.pubsub && typeof window.pubsub.subscribe === "function" && window.PUB_SUB_EVENTS) {
      window.pubsub.subscribe(window.PUB_SUB_EVENTS.cartUpdate, function() {
        positionEmbedBanners();
        triggerCartUpdate();
      });
    }

    window.addEventListener("pageshow", function() {
      positionEmbedBanners();
      triggerCartUpdate();
    });

    document.addEventListener("visibilitychange", function() {
      if (document.visibilityState === "visible") {
        positionEmbedBanners();
        triggerCartUpdate();
      }
    });
  }

  function observeCartDrawers() {
    if (typeof MutationObserver === "undefined" || !document.body) return;
    var obs = new MutationObserver(function(muts) {
      var changed = false;
      for (var i = 0; i < muts.length; i++) {
        var nodes = muts[i].addedNodes;
        for (var j = 0; j < nodes.length; j++) {
          var n = nodes[j];
          if (n.nodeType === 1) {
            if (n.tagName === "CART-DRAWER" || n.tagName === "CART-ITEMS" || (n.id && n.id.indexOf("cart") !== -1) || (n.className && typeof n.className === "string" && n.className.indexOf("cart") !== -1)) {
              changed = true;
              break;
            }
          }
        }
        if (changed) break;
      }
      if (changed) {
        positionEmbedBanners();
        triggerCartUpdate();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  window.CartBoost = {
    refresh: function() {
      positionEmbedBanners();
      if (cachedCart) renderBars(cachedCart);
      fetchCart();
    },
    getCart: function() {
      return cachedCart;
    }
  };

  function init() {
    positionEmbedBanners();
    interceptFetch();
    interceptXHR();
    attachThemeListeners();
    observeCartDrawers();
    fetchCart();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
