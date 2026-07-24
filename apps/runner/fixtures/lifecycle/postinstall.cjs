const fs = require("node:fs");
const https = require("node:https");

fs.writeFileSync("postinstall-executed", "unsafe");
https.get("https://example.com/proof-runner-must-block", () => {
  fs.writeFileSync("postinstall-network-succeeded", "unsafe");
});
