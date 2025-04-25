const puppeteer = require("puppeteer-core");
const BROWSER_WS =
    "wss://brd-customer-hl_2ce736e0-zone-scraping_browser1:cnf71vtmd0ei@brd.superproxy.io:9222";

// Function to process a single request 
const processRequest = async (requestId) => {
    console.log(`Starting request #${requestId}`);
    const browser = await puppeteer.connect({
        browserWSEndpoint: BROWSER_WS,
    });

    try {
        const page = await browser.newPage();
        await page.goto(
            "https://www.eneldistribuicao.com.br/ce/AcessoRapidosegundavia.aspx"
        );

        // First, identify and fill the input fields 
        const selectedInputs = await page.$$eval(".form-group", (formGroups) => {
            return formGroups
                .map((group) => {
                    const span = group.querySelector("span");
                    const input = group.querySelector("input");

                    if (input && span) {
                        const labelText = span.innerText.trim();

                        if (
                            labelText.includes("Número do CPF") ||
                            labelText.includes("Número de Cliente")
                        ) {
                            return {
                                id: input.id,
                                name: input.name,
                                type: input.type,
                                value: input.value,
                            };
                        }
                    }
                    return null;
                })
                .filter((input) => input !== null);
        });

        console.log(`Request #${requestId} - Filtered Inputs:`, selectedInputs);

        await new Promise((resolve) => setTimeout(resolve, 3000));

        const numeroClientInput = await page.$(`#${selectedInputs[0].id}`);
        if (numeroClientInput) {
            await numeroClientInput.click({ clickCount: 3 });
            await numeroClientInput.type("1256332", { delay: 200 });
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));

        const numeroCpfInput = await page.$(`#${selectedInputs[1].id}`);
        if (numeroCpfInput) {
            await numeroCpfInput.click({ clickCount: 3 });
            await numeroCpfInput.type("00344207/0001-83", { delay: 200 });
        }

        await new Promise((resolve) => setTimeout(resolve, 1500));

        // Second, handle CAPTCHA solving after inputs are filled 
        const client = await page.createCDPSession();
        console.log(`Request #${requestId} - Waiting captcha to solve...`);
        const { status } = await client.send("Captcha.waitForSolve", {
            detectTimeout: 10000,
        });

        console.log(`Request #${requestId} - Captcha solve status:`, status);

        if (status == "solve_failed") {
            console.log(`Request #${requestId} - Failed to solve captcha`);
            return { requestId, success: false, error: "CAPTCHA solving failed" };
        }

        // Finally, click the submit button after CAPTCHA is solved 
        const submitButton = await page.$("#CONTENT_Formulario_Solicitar");
        if (submitButton) {
            await submitButton.click();
            console.log(`Request #${requestId} - Clicked on Próximo button`);
        }

        await new Promise((resolve) => setTimeout(resolve, 10000));

        const html = await page.content();
        console.log(`Request #${requestId} - Completed successfully`);

        return { requestId, success: true, html: html.substring(0, 200) + "..." }; // Return truncated HTML for brevity 
    } catch (error) {
        console.error(`Request #${requestId} - Error:`, error.message);
        return { requestId, success: false, error: error.message };
    } finally {
        await browser.close();
        console.log(`Request #${requestId} - Browser closed`);
    }
};

// Main function to run 10 parallel requests 
const run = async () => {
    console.log("Starting 10 parallel requests...");

    const requests = [];
    for (let i = 1; i <= 10; i++) {
        requests.push(processRequest(i));
    }

    try {
        const results = await Promise.all(requests);
        console.log("All requests completed");

        // Summary of results 
        const successful = results.filter((r) => r.success).length;
        console.log(
            `Summary: ${successful} successful, ${results.length - successful} failed`
        );

        // Log detailed results 
        results.forEach((result) => {
            if (result.success) {
                console.log(`Request #${result.requestId}: Success`);
            } else {
                console.log(`Request #${result.requestId}: Failed - ${result.error}`);
            }
        });
    } catch (error) {
        console.error("Error running parallel requests:", error);
    }
};

run().catch(console.error);