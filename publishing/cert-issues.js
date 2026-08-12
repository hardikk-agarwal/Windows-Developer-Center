// ============================================================================
// cert-issues.js — shared certification-FEEDBACK data.
//
// The REAL model of a Store certification failure: each item is a reviewer
// comment citing a Store Policy number, with the reviewer's free-text note and
// (optionally) media they captured (screenshot / recording). There is NO
// guaranteed mapping to a specific form field — the developer reads the feedback
// and updates their publishing details, then resubmits. `area` is a soft hint
// only; `section` is a coarse step target for a convenience "open" link.
// Policy numbers reference Microsoft Store Policies v7.19:
//   https://learn.microsoft.com/en-us/windows/apps/publish/store-policies
// Used by the in-flow feedback panel (publish-v6) and the standalone report.
// ============================================================================
window.CERT_ISSUES = [
  {
    icon: "fluent:bug-20-regular",
    kind: "rebuild",                          // needs a code fix + new package — nothing to change in the form
    policy: "10.4.2", policyTitle: "Usability",
    title: "App closed unexpectedly during testing",
    note: "On a clean Windows 11 (x64) PC the app closed a few seconds after launch \u2014 at the sign-in screen \u2014 so we couldn\u2019t continue testing. The recording shows the repro.",
    media: [{ type: "video", label: "Screen recording" }],
    area: "Your project \u2014 fix & upload a new package",
    section: "step-package"
  },
  {
    icon: "fluent:rename-20-regular",
    policy: "10.1.1", policyTitle: "Accurate representation",
    title: "Store name doesn\u2019t match the app on the device",
    note: "After install, Windows shows the app as \u201cExcel Viewer\u201d, but your Store listing name is \u201cExcel\u201d. Your listing name should match the name customers see on their device.",
    media: [{ type: "image", label: "Screenshot from review" }],
    area: "Store listing \u2014 name",
    section: "step-listing"
  },
  {
    icon: "fluent:shield-keyhole-20-regular",
    policy: "10.5.1", policyTitle: "Personal information",
    title: "Privacy policy link doesn\u2019t show a privacy policy",
    note: "The privacy policy URL opens your marketing homepage, not a privacy policy. The link must go to a page that clearly presents your app\u2019s privacy policy.",
    media: [{ type: "image", label: "Screenshot from review" }],
    area: "Store listing \u2014 privacy policy",
    section: "step-listing"
  }
];
