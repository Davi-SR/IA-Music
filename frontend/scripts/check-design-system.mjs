import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

await page.goto("http://127.0.0.1:8000/", { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);

const result = await page.evaluate(() => {
  const icons = [...document.querySelectorAll("svg.iconify")];
  const bodyStyle = getComputedStyle(document.body);
  const headingStyle = getComputedStyle(document.querySelector("h1"));
  const brandStyle = getComputedStyle(document.querySelector(".brand__name"));
  const buttonStyle = getComputedStyle(document.querySelector(".button"));

  return {
    bodyFont: bodyStyle.fontFamily,
    headingFont: headingStyle.fontFamily,
    brandFont: brandStyle.fontFamily,
    brandWeight: brandStyle.fontWeight,
    buttonFont: buttonStyle.fontFamily,
    buttonWeight: buttonStyle.fontWeight,
    renderedIcons: icons.length,
    emptyIcons: icons.filter(
      (icon) =>
        !icon.querySelector("path, rect, circle, line, polyline, polygon"),
    ).length,
    openSansLoaded: document.fonts.check('16px "Open Sans"'),
    montserratLoaded: document.fonts.check("600 48px Montserrat"),
  };
});

console.log(JSON.stringify(result, null, 2));
await browser.close();
