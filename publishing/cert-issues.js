// ============================================================================
// cert-issues.js — shared certification-report data.
//
// The plain-language issues (with Partner Center policy refs) used by BOTH the
// in-flow inline timeline summary (tdp-bridge.js) and the standalone
// certification report page (cert-report.html). Single source of truth.
// ============================================================================
window.CERT_ISSUES = [
  {
    icon: "fluent:rename-20-regular",
    title: "Your Store name doesn\u2019t match the app on the device",
    problem: "The name in your listing is different from the name Windows shows once the app is installed.",
    fix: "Use the same product name in your listing that appears on the device.",
    policy: "10.1.1.1",
    section: "step-listing"
  },
  {
    icon: "fluent:image-20-regular",
    title: "Screenshots need to be real captures of your app",
    problem: "The images in your listing aren\u2019t direct screenshots taken from the running product.",
    fix: "Replace them with actual screenshots captured from your app.",
    policy: "10.1.1.3",
    section: "step-listing"
  },
  {
    icon: "fluent:text-description-20-regular",
    title: "Your description is too short to be useful",
    problem: "The description is only the app title or a few words, so it doesn\u2019t explain what the app does.",
    fix: "Add a couple of clear sentences about what your app does and its main features.",
    policy: "10.1.4.3",
    section: "step-listing"
  },
  {
    icon: "fluent:shield-keyhole-20-regular",
    title: "Your privacy policy link doesn\u2019t show a privacy policy",
    problem: "The privacy policy URL opens a page that doesn\u2019t actually display a privacy policy.",
    fix: "Point the link to a page that clearly shows your app\u2019s privacy policy.",
    policy: "10.5.1",
    section: "step-listing"
  }
];
