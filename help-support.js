/* =====================================================================
   help-support.js — floating AI Help & Support assistant.

   A self-contained widget: a bottom-right launcher pill that expands into
   a panel where developers can ask anything (AI chat), tap suggested
   prompts, follow "learn more" links, or raise a support ticket.

   AI runs through window.AI.supportChat (publishing/ai-client.js). If AI is
   unavailable it falls back to a local keyword responder — the widget stays
   fully usable and can always raise a ticket. No external dependencies.
   ===================================================================== */
(function () {
  "use strict";

  var LS_KEY = "msstore.help.v1";
  var TICKETS_KEY = "msstore.help.tickets.v1";
  var SEEN_KEY = "msstore.help.seen.v1";

  // Suggested starter prompts shown on the home screen.
  var STARTERS = [
    { icon: "fluent:rocket-20-regular", text: "How do I publish my first app?" },
    { icon: "fluent:certificate-20-regular", text: "Add a code-signing certificate" },
    { icon: "fluent:money-20-regular", text: "Set up payout and tax" },
    { icon: "fluent:shield-error-20-regular", text: "Why was my app rejected?" },
    { icon: "fluent:pulse-20-regular", text: "What is SmartScreen reputation?" }
  ];

  // "Learn more" documentation links (open in a new tab).
  var LEARN = [
    { icon: "fluent:book-open-20-regular", title: "Publish Windows apps", url: "https://learn.microsoft.com/windows/apps/publish/" },
    { icon: "fluent:clipboard-task-list-20-regular", title: "Microsoft Store Policies", url: "https://learn.microsoft.com/windows/apps/publish/store-policies" },
    { icon: "fluent:code-20-regular", title: "Windows developer docs", url: "https://learn.microsoft.com/windows/apps/" }
  ];

  var TICKET_CATS = [
    { v: "account", t: "Account & sign-in" },
    { v: "publishing", t: "Publishing & submissions" },
    { v: "certification", t: "App certification" },
    { v: "payout", t: "Payout & tax" },
    { v: "analytics", t: "Analytics & app health" },
    { v: "certificates", t: "Signing certificates" },
    { v: "policy", t: "Store policies" },
    { v: "other", t: "Something else" }
  ];

  // ---- state -------------------------------------------------------
  var state = loadState();
  var busy = false;          // an AI request is in flight
  var ticketFrom = "home";   // where to return when leaving the ticket form
  var els = {};              // cached element refs

  function loadState() {
    try {
      var s = JSON.parse(localStorage.getItem(LS_KEY));
      if (s && Array.isArray(s.messages)) return { open: false, messages: s.messages.slice(-40) };
    } catch (e) {}
    return { open: false, messages: [] };
  }
  function saveState() {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ messages: state.messages.slice(-40) })); } catch (e) {}
  }

  // ---- tiny helpers ------------------------------------------------
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function ico(name, size) { return '<iconify-icon icon="' + name + '" width="' + (size || 20) + '" height="' + (size || 20) + '" aria-hidden="true"></iconify-icon>'; }
  function el(id) { return els[id]; }

  // ---- build DOM ---------------------------------------------------
  function build() {
    var fab = document.createElement("button");
    fab.type = "button";
    fab.className = "hsup-fab";
    fab.setAttribute("aria-haspopup", "dialog");
    fab.setAttribute("aria-expanded", "false");
    fab.setAttribute("aria-label", "Help and support");
    var unseen = !localStorage.getItem(SEEN_KEY);
    fab.innerHTML =
      '<span class="hsup-fab__ico">' + ico("fluent:chat-help-20-regular", 18) + '</span>' +
      '<span class="hsup-fab__label">Help</span>' +
      '<span class="hsup-fab__dot"' + (unseen ? "" : " hidden") + '></span>';
    fab.addEventListener("click", toggle);

    var panel = document.createElement("section");
    panel.className = "hsup-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Help and support");
    panel.hidden = true;
    panel.innerHTML = panelHTML();

    document.body.appendChild(fab);
    document.body.appendChild(panel);

    els.fab = fab;
    els.dot = fab.querySelector(".hsup-fab__dot");
    els.panel = panel;
    els.body = panel.querySelector(".hsup-body");
    els.home = panel.querySelector(".hsup-view--home");
    els.chat = panel.querySelector(".hsup-view--chat");
    els.ticket = panel.querySelector(".hsup-view--ticket");
    els.thread = panel.querySelector(".hsup-thread");
    els.followups = panel.querySelector(".hsup-followups");
    els.composer = panel.querySelector(".hsup-composer");
    els.input = panel.querySelector(".hsup-composer__in");
    els.send = panel.querySelector(".hsup-send");
    els.foot = panel.querySelector(".hsup-foot");

    wire();
  }

  function panelHTML() {
    var starters = STARTERS.map(function (s) {
      return '<button type="button" class="hsup-chip" data-ask="' + esc(s.text) + '">' + ico(s.icon, 16) + esc(s.text) + "</button>";
    }).join("");
    var learn = LEARN.map(function (l) {
      return '<a href="' + esc(l.url) + '" target="_blank" rel="noopener">' +
        '<span class="hsup-learn__ico">' + ico(l.icon, 17) + "</span>" +
        '<span class="hsup-learn__t">' + esc(l.title) + "</span>" +
        '<span class="hsup-learn__ext">' + ico("fluent:open-16-regular", 15) + "</span></a>";
    }).join("");
    return "" +
      '<header class="hsup-head">' +
        '<span class="hsup-head__avatar">' + ico("fluent:sparkle-20-filled", 20) + "</span>" +
        '<span class="hsup-head__id">' +
          '<span class="hsup-head__title">Help &amp; support</span>' +
          '<span class="hsup-head__sub">AI assistant · replies in seconds</span>' +
        "</span>" +
        '<span class="hsup-head__actions">' +
          '<button type="button" class="hsup-iconbtn" data-restart title="New conversation" aria-label="New conversation">' + ico("fluent:compose-20-regular") + "</button>" +
          '<button type="button" class="hsup-iconbtn" data-close title="Minimize" aria-label="Close help">' + ico("fluent:dismiss-20-regular") + "</button>" +
        "</span>" +
      "</header>" +
      '<div class="hsup-body">' +
        // HOME
        '<div class="hsup-view hsup-view--home">' +
          '<div class="hsup-hero"><h3>Hi 👋 How can we help?</h3><p>Ask anything about publishing, certificates, payout, analytics, and Store policies — or raise a ticket for a person.</p></div>' +
          '<div><div class="hsup-sech">Suggested</div><div class="hsup-chips">' + starters + "</div></div>" +
          '<div><div class="hsup-sech">Learn more</div><div class="hsup-learn">' + learn + "</div></div>" +
          '<button type="button" class="hsup-ticketcta" data-ticket>' +
            '<span class="hsup-ticketcta__ico">' + ico("fluent:ticket-diagonal-20-regular", 19) + "</span>" +
            '<span class="hsup-ticketcta__t"><strong>Raise a support ticket</strong><span>Get help from a support engineer</span></span>' +
            '<span class="hsup-ticketcta__chev">' + ico("fluent:chevron-right-20-regular", 18) + "</span>" +
          "</button>" +
        "</div>" +
        // CHAT
        '<div class="hsup-view hsup-view--chat" hidden><div class="hsup-thread"></div><div class="hsup-followups"></div></div>' +
        // TICKET
        '<div class="hsup-view hsup-view--ticket" hidden></div>' +
      "</div>" +
      '<div class="hsup-composer">' +
        '<textarea class="hsup-composer__in" rows="1" placeholder="Ask a question…" aria-label="Ask a question"></textarea>' +
        '<fluent-button class="hsup-send" appearance="primary" icon-only aria-label="Send" disabled data-send>' + ico("fluent:send-20-filled", 18) + "</fluent-button>" +
      "</div>" +
      '<div class="hsup-foot"><span>AI can make mistakes — verify important info.</span><button type="button" data-ticket>Contact support</button></div>';
  }

  // ---- wiring ------------------------------------------------------
  function wire() {
    els.panel.addEventListener("click", function (e) {
      var t = e.target.closest("[data-ask],[data-ticket],[data-close],[data-restart],[data-followup],[data-back],[data-inline-ticket]");
      if (!t) return;
      if (t.hasAttribute("data-close")) return close();
      if (t.hasAttribute("data-restart")) return restart();
      if (t.hasAttribute("data-back")) return showHomeOrChat();
      if (t.hasAttribute("data-ticket") || t.hasAttribute("data-inline-ticket")) return openTicket();
      if (t.hasAttribute("data-ask")) return submit(t.getAttribute("data-ask"));
      if (t.hasAttribute("data-followup")) return submit(t.getAttribute("data-followup"));
    });

    els.send.addEventListener("click", function () { submit(els.input.value); });
    els.input.addEventListener("input", function () {
      autosize();
      setSendDisabled(!els.input.value.trim() || busy);
    });
    els.input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(els.input.value); }
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && state.open && !document.querySelector("fluent-dialog[open], dialog[open]")) close();
    });
  }

  function autosize() {
    var t = els.input;
    t.style.height = "auto";
    t.style.height = Math.min(t.scrollHeight, 120) + "px";
  }
  function setSendDisabled(b) { if (els.send) { if (b) els.send.setAttribute("disabled", ""); else els.send.removeAttribute("disabled"); } }

  // ---- open / close ------------------------------------------------
  function toggle() { state.open ? close() : open(); }
  function open() {
    state.open = true;
    els.panel.hidden = false;
    els.panel.classList.add("is-opening");
    setTimeout(function () { els.panel.classList.remove("is-opening"); }, 320);
    els.fab.classList.add("is-hidden");
    els.fab.setAttribute("aria-expanded", "true");
    if (els.dot) els.dot.hidden = true;
    try { localStorage.setItem(SEEN_KEY, "1"); } catch (e) {}
    // Restore chat if there's history, else home.
    if (state.messages.length) { renderThread(); showView("chat"); } else { showView("home"); }
    setTimeout(function () { els.input.focus(); }, 60);
  }
  function close() {
    state.open = false;
    els.panel.hidden = true;
    els.fab.classList.remove("is-hidden");
    els.fab.setAttribute("aria-expanded", "false");
    els.fab.focus();
  }
  function restart() {
    state.messages = [];
    saveState();
    els.followups.innerHTML = "";
    els.input.value = "";
    autosize();
    setSendDisabled(true);
    showView("home");
    els.input.focus();
  }

  function showView(v) {
    els.home.hidden = v !== "home";
    els.chat.hidden = v !== "chat";
    els.ticket.hidden = v !== "ticket";
    var showComposer = v === "home" || v === "chat";
    els.composer.hidden = !showComposer;
    els.foot.style.display = showComposer ? "" : "none";
    if (v === "chat") scrollDown(); else els.body.scrollTop = 0;
  }
  function showHomeOrChat() { showView(state.messages.length ? "chat" : "home"); }

  function scrollDown() { requestAnimationFrame(function () { els.body.scrollTop = els.body.scrollHeight; }); }

  // ---- chat --------------------------------------------------------
  function submit(text) {
    text = (text || "").trim();
    if (!text || busy) return;
    els.input.value = "";
    autosize();
    setSendDisabled(true);
    state.messages.push({ role: "me", text: text });
    saveState();
    showView("chat");
    renderThread();
    ask(text);
  }

  function renderThread() {
    var html = state.messages.map(function (m) {
      if (m.role === "me") {
        return '<div class="hsup-msg hsup-msg--me"><div class="hsup-bubble">' + esc(m.text) + "</div></div>";
      }
      var body = m.typing
        ? '<div class="hsup-bubble hsup-typing"><span></span><span></span><span></span></div>'
        : '<div class="hsup-bubble">' + esc(m.text) + "</div>";
      return '<div class="hsup-msg hsup-msg--ai"><span class="hsup-msg__av">' + ico("fluent:sparkle-16-filled", 15) + "</span>" + body + "</div>" +
        (m.offerTicket && !m.typing ? '<button type="button" class="hsup-inlineticket" data-inline-ticket>' + ico("fluent:ticket-diagonal-16-regular", 15) + "Raise a support ticket</button>" : "");
    }).join("");
    els.thread.innerHTML = html;
    scrollDown();
  }

  function renderFollowups(list) {
    if (!list || !list.length) { els.followups.innerHTML = ""; return; }
    els.followups.innerHTML = list.slice(0, 3).map(function (s) {
      return '<button type="button" class="hsup-followup" data-followup="' + esc(s) + '">' + esc(s) + "</button>";
    }).join("");
    scrollDown();
  }

  function ask(text) {
    busy = true;
    els.followups.innerHTML = "";
    state.messages.push({ role: "ai", typing: true });
    renderThread();

    var history = state.messages.filter(function (m) { return !m.typing; }).slice(-8).map(function (m) {
      return { role: m.role, text: m.text };
    });

    respond(text, history).then(function (res) {
      // remove typing placeholder
      state.messages = state.messages.filter(function (m) { return !m.typing; });
      state.messages.push({ role: "ai", text: res.reply, offerTicket: !!res.offerTicket, ticketDraft: res.ticketDraft || null });
      saveState();
      renderThread();
      renderFollowups(res.suggestions);
    }).catch(function () {
      state.messages = state.messages.filter(function (m) { return !m.typing; });
      state.messages.push({ role: "ai", text: "Sorry — something went wrong on my end. You can try again, or raise a ticket and a support engineer will help.", offerTicket: true });
      saveState();
      renderThread();
    }).then(function () {
      busy = false;
      setSendDisabled(!els.input.value.trim());
    });
  }

  // AI first, local fallback if unavailable/errors.
  function respond(message, history) {
    if (window.AI && window.AI.enabled && typeof window.AI.supportChat === "function") {
      return window.AI.supportChat({ message: message, history: history, context: currentContext() })
        .then(function (r) {
          return {
            reply: (r && r.reply) || localAnswer(message).reply,
            suggestions: (r && r.suggestions) || [],
            offerTicket: !!(r && r.offerTicket),
            ticketDraft: r && r.ticketDraft
          };
        })
        .catch(function () { return localAnswer(message); });
    }
    // No AI configured — brief pause so the typing indicator reads naturally.
    return new Promise(function (resolve) { setTimeout(function () { resolve(localAnswer(message)); }, 420); });
  }

  // ---- local fallback responder -----------------------------------
  function localAnswer(q) {
    var s = (q || "").toLowerCase();
    var has = function () { for (var i = 0; i < arguments.length; i++) { if (s.indexOf(arguments[i]) !== -1) return true; } return false; };
    if (has("publish", "submit", "first app", "get started"))
      return { reply: "To publish an app: open Apps → Create app, reserve a name, then add your packages (MSIX, MSI, EXE, or PWA), listing details, age rating, pricing and markets. Submit and it enters certification — usually 24–48 hours. You can track status on the Apps page.", suggestions: ["How long does certification take?", "What package types are supported?", "Why was my app rejected?"], offerTicket: false };
    if (has("certificate", "signing", "sign ", "smartscreen"))
      return { reply: "Go to Certificates → Add certificate and upload a binary signed with your code-signing certificate. We match its Authenticode signer, then discover the installed apps signed with it and unlock crash analytics and SmartScreen reputation for them — no code changes needed.", suggestions: ["What is SmartScreen reputation?", "Which apps get discovered?", "Add a certificate"], offerTicket: false };
    if (has("payout", "tax", "payment", "bank", "earning"))
      return { reply: "Payout and tax setup lives in your account settings and is required before you can earn from paid apps or in-app purchases. You'll add a payout account and complete tax forms for your region. It only appears once you have a Store app in your pipeline.", suggestions: ["When do I get paid?", "Set up payout and tax"], offerTicket: true };
    if (has("reject", "fail", "certification fail", "denied"))
      return { reply: "If an app fails certification, open it from the Apps page to see the exact policy or technical failures with notes. Fix the flagged items and resubmit — most rejections are quick to resolve (metadata, crashes on launch, or a policy mismatch).", suggestions: ["Common rejection reasons", "Store policies"], offerTicket: true };
    if (has("analytic", "crash", "hang", "health", "rating", "review"))
      return { reply: "The Analytics page shows acquisitions, crashes and hangs, ratings and reviews per app. For crashes you can drill into stack traces and top failures. Apps you bring in via a signing certificate get crash & hang analytics automatically.", suggestions: ["Reduce my crash rate", "View crash analytics"], offerTicket: false };
    return { reply: "Happy to help with that. I can walk you through publishing apps, code-signing certificates, payout and tax, certification, analytics, and Store policies. Tell me a bit more about what you're trying to do — or raise a ticket and a support engineer will follow up.", suggestions: ["How do I publish my first app?", "Add a signing certificate", "Set up payout and tax"], offerTicket: true };
  }

  // Compact grounding context from the current page (no coupling to portal internals).
  function currentContext() {
    var names = { overview: "Overview", apps: "Apps", analytics: "Analytics", certificates: "Certificates", promotions: "Promotions", groups: "Customer groups", payout: "Payout" };
    var hash = (location.hash || "").replace(/^#/, "").split("?")[0] || "overview";
    var lines = ['The developer is on the "' + (names[hash] || hash) + '" page of the Windows Developer Center.'];
    var acct = document.getElementById("accountName");
    if (acct && acct.textContent && acct.textContent.trim() && acct.textContent.trim() !== "Your organization") lines.push("Account: " + acct.textContent.trim());
    return lines.join("\n");
  }

  // ---- ticket ------------------------------------------------------
  function openTicket(draft) {
    ticketFrom = state.messages.length ? "chat" : "home";
    // Pull a draft from the last AI reply if present.
    if (!draft) { for (var i = state.messages.length - 1; i >= 0; i--) { if (state.messages[i].ticketDraft) { draft = state.messages[i].ticketDraft; break; } } }
    draft = draft || {};
    var email = "";
    var em = document.getElementById("pfAcctEmail") || document.getElementById("pfEmail");
    if (em && em.textContent) email = em.textContent.trim();

    var transcript = state.messages.filter(function (m) { return !m.typing; }).map(function (m) {
      return (m.role === "me" ? "You: " : "Assistant: ") + m.text;
    }).join("\n");
    var desc = draft.summary || "";
    if (!desc && transcript) desc = "From my chat with the assistant:\n\n" + transcript;

    var cats = TICKET_CATS.map(function (c, i) {
      var sel = draft.category ? (draft.category === c.v) : (i === 0);
      return '<fluent-option value="' + c.v + '"' + (sel ? " selected" : "") + ">" + esc(c.t) + "</fluent-option>";
    }).join("");

    els.ticket.innerHTML = "" +
      '<button type="button" class="hsup-back" data-back>' + ico("fluent:arrow-left-20-regular", 18) + "Back</button>" +
      '<div class="hsup-ticket-h"><h3>Raise a support ticket</h3><p>Tell us what\'s going on. A support engineer will reply by email, usually within one business day.</p></div>' +
      '<div class="hsup-ticket-form">' +
        '<div class="hsup-field"><label for="hsup-subj">Subject</label><fluent-text-input id="hsup-subj" appearance="outline" maxlength="120" placeholder="Briefly, what do you need help with?"></fluent-text-input></div>' +
        '<div class="hsup-row2">' +
          '<div class="hsup-field"><label for="hsup-cat">Category</label><fluent-dropdown id="hsup-cat" appearance="outline" aria-label="Category"><fluent-listbox>' + cats + "</fluent-listbox></fluent-dropdown></div>" +
          '<div class="hsup-field"><label for="hsup-pri">Priority</label><fluent-dropdown id="hsup-pri" appearance="outline" aria-label="Priority"><fluent-listbox><fluent-option value="low">Low</fluent-option><fluent-option value="normal" selected>Normal</fluent-option><fluent-option value="high">High — blocked</fluent-option></fluent-listbox></fluent-dropdown></div>' +
        "</div>" +
        '<div class="hsup-field"><label for="hsup-desc">Description</label><fluent-textarea id="hsup-desc" appearance="outline" placeholder="Share the details: what you expected, what happened, and any app or error involved."></fluent-textarea></div>' +
        '<div class="hsup-field"><label for="hsup-email">Contact email <span class="hsup-opt">(where we\'ll reply)</span></label><fluent-text-input id="hsup-email" appearance="outline" type="email" placeholder="you@example.com"></fluent-text-input></div>' +
        '<div class="hsup-ticket-actions">' +
          '<fluent-button appearance="outline" data-back>Cancel</fluent-button>' +
          '<fluent-button appearance="primary" data-ticket-submit>' + ico("fluent:send-20-filled", 16) + "Submit ticket</fluent-button>" +
        "</div>" +
      "</div>";

    // Fluent controls take their values as properties (post-upgrade); wire the submit button.
    var subjEl = document.getElementById("hsup-subj"); if (subjEl) subjEl.value = draft.subject || "";
    var descEl = document.getElementById("hsup-desc"); if (descEl) descEl.value = desc;
    var emailEl = document.getElementById("hsup-email"); if (emailEl) emailEl.value = email;
    var subBtn = els.ticket.querySelector("[data-ticket-submit]"); if (subBtn) subBtn.addEventListener("click", submitTicket);
    showView("ticket");
    els.body.scrollTop = 0;
    if (subjEl && !subjEl.value) setTimeout(function () { try { subjEl.focus(); } catch (e) {} }, 40);
  }

  // Read a Fluent dropdown's value from its selected fluent-option (mirrors the app's pattern).
  function ddVal(elm, fallback) {
    if (!elm) return fallback || "";
    var o = elm.querySelector('fluent-option[aria-selected="true"], fluent-option[selected]');
    if (o) return o.getAttribute("value") || fallback || "";
    return elm.value || fallback || "";
  }
  function submitTicket() {
    var subj = document.getElementById("hsup-subj");
    var desc = document.getElementById("hsup-desc");
    var subjV = ((subj && subj.value) || "").trim();
    var descV = ((desc && desc.value) || "").trim();
    if (!subjV) { try { subj.focus(); } catch (e) {} return; }
    if (!descV) { try { desc.focus(); } catch (e) {} return; }
    var ticket = {
      ref: "WDC-" + Math.floor(100000 + Math.random() * 900000),
      subject: subjV,
      category: ddVal(document.getElementById("hsup-cat"), "other"),
      priority: ddVal(document.getElementById("hsup-pri"), "normal"),
      description: descV,
      email: (((document.getElementById("hsup-email") || {}).value) || "").trim(),
      created: Date.now()
    };
    try {
      var all = JSON.parse(localStorage.getItem(TICKETS_KEY) || "[]");
      all.push(ticket); localStorage.setItem(TICKETS_KEY, JSON.stringify(all));
    } catch (e) {}

    els.ticket.innerHTML = "" +
      '<div class="hsup-success">' +
        '<div class="hsup-success__ring">' + ico("fluent:checkmark-circle-20-filled", 34) + "</div>" +
        "<h3>Ticket submitted</h3>" +
        '<span class="hsup-success__ref">' + esc(ticket.ref) + "</span>" +
        "<p>Thanks — we've logged your request" + (ticket.email ? " and will reply to <strong>" + esc(ticket.email) + "</strong>" : "") + ". You can keep chatting with the assistant in the meantime.</p>" +
        '<fluent-button appearance="primary" data-back>Back to help</fluent-button>' +
      "</div>";
    // Let the assistant acknowledge in-thread too.
    if (state.messages.length) {
      state.messages.push({ role: "ai", text: "Your ticket " + ticket.ref + " is in. A support engineer will follow up" + (ticket.email ? " at " + ticket.email : "") + ". Anything else I can help with?" });
      saveState();
      renderThread();
    }
  }

  // ---- init --------------------------------------------------------
  function init() { if (!document.querySelector(".hsup-fab")) build(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
