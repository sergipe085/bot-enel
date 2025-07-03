import express, { Request, Response } from "express";
import { extractInvoice } from ".";
import { z } from "zod";
import { decryptBase64PdfWithQpdf } from "./utils";
import { extractInvoiceSegundaVia } from "./extract-invoice-segunda-via";
import { addExtractionJob, extractionQueue } from "./queues/extraction-queue";
import { redisConnection } from "./lib/redis";
import { PHONE_CODE_KEY } from "./phone-checker";

export const app = express();

app.use(express.json());

app.get("/", async (req, res) => {

    const schema = z.object({
        login: z.string(),
        senha: z.string(),
        codigoCliente: z.string(),
        mesReferencia: z.string()
    })

    const { login, senha, codigoCliente, mesReferencia } = schema.parse(req.query);

    // login: Comerciallugaenergy@gmail.com
    // senha: Bitu1707*
    // codigoCliente: 63456106
    // mesReferencia: 02/2025
    // url: http://localhost:3006?login=Comerciallugaenergy@gmail.com&senha=Bitu1707*&codigoCliente=63456106&mesReferencia=02/2025

    const response = await extractInvoice({
        login,
        senha,
        codigoCliente,
        mesReferencia
    });

    const decryptedPdf = await decryptBase64PdfWithQpdf(response.pdf, senha);

    res.json({
        ...response,
        pdf: decryptedPdf
    });
});


app.post("/extract-via-segunda-via", async (req, res) => {
    const schema = z.object({
        numeroCliente: z.string(),
        cpfCnpj: z.string(),
        mesReferencia: z.array(z.string()),
        webhookUrl: z.string().url().optional()
    })

    try {
        const { numeroCliente, cpfCnpj, mesReferencia, webhookUrl } = schema.parse(req.body);

        // Adicionar o job à fila de extração
        const jobId = await addExtractionJob({
            numeroCliente,
            cpfCnpj,
            mesReferencia,
            webhookUrl
        });

        // Retornar imediatamente com o ID do job
        res.json({
            success: true,
            jobId,
            message: 'Extraction job added to queue',
            status: 'processing'
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message || 'Invalid request parameters'
        });
    }
});

// app.get("/job-status/:jobId", async (req: Request, res: Response) => {
//     try {
//         const { jobId } = req.params;

//         // Buscar o job na fila
//         const job = await extractionQueue.getJob(jobId);

//         if (!job) {
//             return res.status(404).json({
//                 success: false,
//                 error: 'Job not found'
//             });
//         }

//         // Obter o estado atual do job
//         const state = await job.getState();
//         const progress = job.progress || 0;
//         const result = job.returnvalue;
//         const failReason = job.failedReason;

//         let status;
//         switch (state) {
//             case 'completed':
//                 status = 'completed';
//                 break;
//             case 'failed':
//                 status = 'failed';
//                 break;
//             case 'delayed':
//             case 'waiting':
//                 status = 'queued';
//                 break;
//             case 'active':
//                 status = 'processing';
//                 break;
//             default:
//                 status = state;
//         }

//         // Construir a resposta
//         const response: any = {
//             jobId,
//             status,
//             progress
//         };

//         // Adicionar resultado se o job estiver completo
//         if (status === 'completed' && result) {
//             // Se temos PDFs para processar
//             if (result.pdfs && result.pdfs.length > 0) {
//                 const primeiros5DigitosCnpj = req.query.cpfCnpj ? String(req.query.cpfCnpj).slice(0, 5) : null;

//                 if (primeiros5DigitosCnpj && req.query.decrypt === 'true') {
//                     // Processar cada PDF para descriptografar
//                     const decryptedPdfs = await Promise.all(
//                         result.pdfs.map(async (pdfResult) => {
//                             const decryptedContent = await decryptBase64PdfWithQpdf(pdfResult.base64Content, primeiros5DigitosCnpj);
//                             return {
//                                 ...pdfResult,
//                                 base64Content: decryptedContent
//                             };
//                         })
//                     );

//                     response.pdfs = decryptedPdfs;
//                 } else {
//                     response.pdfs = result.pdfs;
//                 }
//             }
//         }

//         // Adicionar mensagem de erro se o job falhou
//         if (status === 'failed') {
//             response.error = failReason || 'Unknown error';
//         }

//         return res.json(response);
//     } catch (error) {
//         return res.status(500).json({
//             success: false,
//             error: error.message || 'Error retrieving job status'
//         });
//     }
// });



app.post("/set-sms-code", async (req, res) => {
    const schema = z.object({
        code: z.string()
    })

    try {
        const { code } = schema.parse(req.body);
        await redisConnection.set(PHONE_CODE_KEY, code);
        res.json({ success: true });
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message || 'Invalid request parameters'
        });
    }
});

const PORT = 3006;

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});