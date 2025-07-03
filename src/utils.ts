import * as fs from 'fs';
import { PDFDocument } from 'pdf-lib';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

const execPromise = promisify(exec);

// Alternative approach using qpdf external tool
export async function decryptBase64PdfWithQpdf(base64Input: string, password: string): Promise<string> {
    try {
        const uuid = uuidv4();

        // Create temporary files
        const tempInputPath = path.join(__dirname, `temp_encrypted_${uuid}.pdf`);
        const tempOutputPath = path.join(__dirname, `temp_decrypted_${uuid}.pdf`);

        // Step 1: Decode the base64 input to a temporary PDF file
        const pdfBuffer = Buffer.from(base64Input, 'base64');
        fs.writeFileSync(tempInputPath, pdfBuffer);

        // Step 2: Use qpdf to decrypt the PDF
        const qpdfCommand = `qpdf --password=${password} --decrypt ${tempInputPath} ${tempOutputPath}`;
        await execPromise(qpdfCommand);

        // Step 3: Read the decrypted PDF and convert to base64
        const decryptedPdfBuffer = fs.readFileSync(tempOutputPath);
        const base64Output = decryptedPdfBuffer.toString('base64');

        // Clean up temporary files
        fs.unlinkSync(tempInputPath);
        fs.unlinkSync(tempOutputPath);

        return base64Output;
    } catch (error) {
        console.error('Error processing PDF:', error);
        throw error;
    }
}