import puppeteer from "puppeteer";

async function run() {

    const browser = await puppeteer.launch({
        headless: false,
        args: ['--remote-debugging-port=9222']
    });
    const page = await browser.newPage();
    await page.goto('https://www.eneldistribuicao.com.br/ce/AcessoRapidosegundavia.aspx');

    const browser2 = await puppeteer.connect({
        browserURL: 'http://localhost:9222' // Conecta ao Chrome já aberto
    });

    const pages = await browser2.pages();
    if (pages.length === 0) {
        const page = await browser2.newPage();
        await page.goto('https://example.com');
    }

    console.log('Acesse: http://localhost:9222');
}

run().catch(console.error);