(function () {
  "use strict";

  function Ent() { return window.Entitlement || null; }

  var backing = null;
  try { backing = window.localStorage; } catch (e) { backing = null; }

  function allowed() {
    var E = Ent();
    if (!E || typeof E.isOwner !== "function") return false;
    var id = null;
    try { id = E.identity({ backing: backing }); } catch (e) { id = null; }

    try {
      return !!E.isOwner(backing, id ? { role: id.role, uid: id.uid } : undefined);
    } catch (e) {
      return false;
    }
  }

  function deny() {
    var page = document.getElementById("selfcheck-page");
    if (page) page.hidden = true;
    var denyBox = document.getElementById("selfcheck-deny");
    if (denyBox) denyBox.hidden = false;
    var back = document.getElementById("btn-selfcheck-back");
    if (back) {
      back.addEventListener("click", function () { location.href = "/mine/"; });
    }
  }

  function arm() {

    var page = document.getElementById("selfcheck-page");
    if (page) page.hidden = false;

    var holder = document.getElementById("self-check-script");
    if (!holder) return;
    var s = document.createElement("script");
    s.src = holder.getAttribute("data-src") || "/js/self-check.js";
    holder.parentNode.replaceChild(s, holder);
  }

  function init() {
    if (allowed()) { arm(); return; }
    deny();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.SelfCheckGate = { allowed: allowed };
})();
