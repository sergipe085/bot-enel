import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

puppeteer.use(StealthPlugin());

const run = async () => {
    const browser = await puppeteer.launch({
        headless: false, // Change to true in production
        args: [
            `--proxy-server=brd.superproxy.io:33335`,
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--ignore-certificate-errors"
        ],
    });

    const page = await browser.newPage();


    // Authenticate with BrightData proxy
    await page.authenticate({
        username: "brd-customer-hl_2ce736e0-zone-web_unlocker1",
        password: "gmvzk9mgw55b",
    });

    // Navigate to the target website
    await page.goto('https://www.eneldistribuicao.com.br/ce/AcessoRapidosegundavia.aspx', { waitUntil: "networkidle2" })

    await new Promise(resolve => setTimeout(resolve, 10000));


    console.log("Page loaded and hCaptcha bypassed!");

    await page.mouse.move(100, 100);
    await page.mouse.move(200, 200);
    await page.mouse.move(300, 300);

    // Scroll down a little
    await page.evaluate(() => {
        window.scrollBy(0, 300);
    });

    // Wait for the page to fully load

    console.log("PAGINA CARREGADA! :D")

    // await browser.close();
};

run().catch(console.error);
