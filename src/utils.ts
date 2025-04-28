import * as fs from 'fs';
import { PDFDocument } from 'pdf-lib';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

const execPromise = promisify(exec);

// Pure TypeScript solution using pdf-lib
async function decryptBase64PdfWithPdfLib(base64Input: string, password: string): Promise<string> {
    try {
        // Step 1: Decode the base64 input to binary PDF data
        const pdfBytes = Buffer.from(base64Input, 'base64');

        // Step 2: Load the encrypted PDF with password
        const loadOptions: { password?: string } = {};
        if (password) {
            loadOptions.password = password;
        }

        const encryptedPdfDoc = await PDFDocument.load(pdfBytes, loadOptions);

        // Step 3: Create a new PDF document
        const newPdfDoc = await PDFDocument.create();

        // Step 4: Copy all pages from encrypted document to new document
        const pageIndices = encryptedPdfDoc.getPageIndices();
        const pages = await newPdfDoc.copyPages(encryptedPdfDoc, pageIndices);
        pages.forEach(page => newPdfDoc.addPage(page));

        // Step 5: Save the new unprotected PDF
        const unprotectedPdfBytes = await newPdfDoc.save();

        // Step 6: Convert to base64
        const base64String = Buffer.from(unprotectedPdfBytes).toString('base64');

        return base64String;
    } catch (error) {
        console.error('Error processing PDF:', error);
        throw error;
    }
}

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