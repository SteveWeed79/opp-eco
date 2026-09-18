import { chromium } from "@playwright/test";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext({ baseURL: "http://localhost:3000" });
await ctx.addCookies([{ name: "oe_demo_role", value: "student", url: "http://localhost:3000" }]);
const page = await ctx.newPage();
await page.goto("/demo/student", { waitUntil: "networkidle" });
const b = page.getByRole("button", { name: "Hand in again" });
console.log("hand-in button: " + await b.count());
if (await b.count()) {
  await b.first().click();
  await page.waitForTimeout(900);
  const dlg = page.getByRole("dialog").first();
  const t = (await dlg.innerText()).replace(/\s+/g, " ");
  console.log("dialog text: " + t.slice(0, 420));
  console.log("file inputs in dialog: " + await dlg.locator("input[type=file]").count());
  console.log("file inputs on page: " + await page.locator("input[type=file]").count());
}
await browser.close();
