(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CertificateValidation = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function text(value) { return value == null ? "" : String(value).trim(); }
  function selfIssued(info) {
    var subject = text(info.signerSubject).toLowerCase(), issuer = text(info.issuer).toLowerCase();
    return !!(info.signerThumbprint && subject && subject === issuer);
  }
  function check(id, label, status, detail) { return { id: id, label: label, status: status, detail: detail }; }
  function waiting(active) {
    return [
      check("binary", "Original verification binary", "not-checked", "The verification service does not compare this file with your download."),
      check("signature", "Code-signing signature", active ? "running" : "waiting", active ? "Reading the signature from your file…" : "Waiting to read the file."),
      check("issuer", "Certificate issuer", "waiting", "Checking that the certificate is not self-signed."),
      check("trust", "Signature integrity and trust", "waiting", "Checking the signature and Windows trust chain.")
    ];
  }
  function evaluate(info) {
    info = info || {};
    var checks = waiting(false), signed = info.kind === "authenticode" && !!text(info.signerThumbprint);
    var selfSigned = selfIssued(info), trusted = signed && info.status === "Valid";
    if (info.offline || info.error || info.cancelled) {
      checks = checks.map(function (item) { return check(item.id, item.label, "not-checked", item.id === "binary" ? item.detail : "Validation could not be completed. Try again."); });
      return { accepted: !!(info.offline && info.fileSha256 && !info.cancelled && !info.error && info.binaryMatch !== false), verified: false, complete: false,
        outcome: info.offline ? "offline" : "error", checks: checks,
        message: info.offline ? "A file fingerprint is available, but the signature could not be verified." : "We couldn’t complete validation. Try again." };
    }
    // Only an explicit verifier result can establish a match; filenames and whole-file hashes cannot.
    if (info.binaryMatch === true) checks[0] = check("binary", checks[0].label, "passed", "Matches the verification binary issued for this account.");
    else if (info.binaryMatch === false) checks[0] = check("binary", checks[0].label, "failed", "This is not the verification binary issued for this account. Sign and upload the downloaded file.");
    checks[1] = check("signature", checks[1].label, signed ? "passed" : "failed",
      signed ? "A code-signing signature was found." : "No code-signing signature was found. Upload a signed binary, not a certificate file.");
    var issuer = text(info.issuer), subject = text(info.signerSubject);
    checks[2] = check("issuer", checks[2].label, !signed ? "skipped" : selfSigned ? "failed" : issuer && subject ? "passed" : "not-checked",
      !signed ? "A signed binary is needed for this check." : selfSigned ? "Self-signed certificates aren’t accepted. Use a certificate from a trusted certificate authority (CA)."
        : issuer && subject ? "Issued by " + ((/CN=([^,]+)/i.exec(issuer) || [null, issuer])[1]) + "." : "The verifier did not return the certificate issuer.");
    var trustDetail = trusted ? "Windows validated the signature and its trust chain."
      : !signed ? "A signed binary is needed for this check."
      : info.status === "HashMismatch" ? "The binary changed after it was signed. Sign it again and upload the signed file."
      : selfSigned ? "Use a CA-issued code-signing certificate."
      : "Windows could not validate this signature. Use a binary with a valid, trusted code-signing signature.";
    checks[3] = check("trust", checks[3].label, trusted ? "passed" : signed ? "failed" : "skipped", trustDetail);
    var accepted = trusted && !selfSigned && info.binaryMatch !== false;
    return { accepted: accepted, verified: accepted, complete: accepted && checks.every(function (item) { return item.status === "passed"; }),
      outcome: accepted ? "verified" : "failed", checks: checks,
      message: accepted ? "Certificate verified." : checks.find(function (item) { return item.status === "failed"; }).detail };
  }
  // Presentation-only success scenario. Raw verification and persisted certificate trust stay unchanged.
  function demoSuccess(info) {
    var result = evaluate(info);
    if (!result.accepted || result.complete) return result;
    var details = {
      binary: "The uploaded binary matches your download.",
      signature: "A code-signing signature was found.",
      issuer: "The certificate is CA-issued, not self-signed.",
      trust: "The signature is valid and the certificate is trusted."
    };
    return Object.assign({}, result, { simulated: true, outcome: "simulated",
      checks: result.checks.map(function (item) { return item.status === "passed" ? item : check(item.id, item.label, "passed", details[item.id]); }) });
  }
  function previewChecks(result, completed) {
    var checking = {
      binary: "Comparing the original verification binary…",
      signature: "Checking the code-signing signature…",
      issuer: "Checking the certificate issuer…",
      trust: "Checking signature integrity and trust…"
    };
    return result.checks.map(function (item, index) {
      return index < completed ? item : check(item.id, item.label, index === completed ? "running" : "waiting",
        index === completed ? checking[item.id] : "Waiting to check.");
    });
  }
  function summary(run) {
    var total = run.items.length, finished = run.items.filter(function (item) { return !!item.result; }).length;
    if (run.phase === "checking") return { tone: "running", title: total === 1 ? "Validating your signed binary" : "Validating signed binaries",
      detail: total === 1 ? "Checking the file’s signature and certificate." : "Checking file " + Math.min(finished + 1, total) + " of " + total + "." };
    if (run.saveError) return { tone: "error", title: "We couldn’t save the certificate", detail: "Free some browser storage and try again. Your files and validation results are still here." };
    var verified = run.items.filter(function (item) { return item.result && (item.result.verified || item.result.simulated); }).length;
    var rejected = run.items.filter(function (item) { return !item.result || !item.result.accepted; }).length;
    var saved = run.savedCerts.length;
    if (!saved) return { tone: "error", title: "Validation needs attention", detail: "Review the results, then try again or choose another signed binary. No certificates were added." };
    if (rejected) return { tone: "warning", title: "Some files need attention",
      detail: saved + " certificate" + (saved === 1 ? " is" : "s are") + " saved. " + rejected + " file" + (rejected === 1 ? " wasn’t" : "s weren’t") + " accepted. You can select apps for the saved certificate" + (saved === 1 ? "." : "s.") };
    if (verified !== total) return { tone: "warning", title: verified ? "Validation partially completed" : "Signature validation unavailable",
      detail: "Unverified files are saved as fingerprints only. You can retry validation or continue to app selection." };
    var complete = run.items.every(function (item) { return item.result.complete || item.result.simulated; });
    return { tone: "success", title: complete ? "Validation successful" : saved === 1 ? "Certificate verified" : "Certificates verified",
      detail: "Your certificate" + (saved === 1 ? " is" : "s are") + " saved. Select the apps you want to track, or close and do this later." };
  }

  return { waiting: waiting, evaluate: evaluate, demoSuccess: demoSuccess, previewChecks: previewChecks, summary: summary, selfIssued: selfIssued };
});