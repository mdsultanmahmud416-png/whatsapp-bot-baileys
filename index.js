import makeWASocket, {
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';

import PQueue from "p-queue";
import fs from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");
import qrcode from "qrcode-terminal";



// ==============================
// AUTH (session.json)
// ==============================
const { state, saveCreds } = await useMultiFileAuthState('./auth');


// ==============================
// QUEUE SYSTEM (limit = 2)
// ==============================
const queue = new PQueue({ concurrency: 2 });

// ==============================
// PDF FORWARD TARGET NUMBER
// ==============================
const FORWARD_TO = "8801777283248@s.whatsapp.net"; // <-- এখানে আপনার নম্বর দিন

// ==============================
// PDF DOWNLOAD FOLDER
// ==============================
const DOWNLOADS = "./downloads";
if (!fs.existsSync(DOWNLOADS)) fs.mkdirSync(DOWNLOADS);

// ==============================
// MAIN BOT FUNCTION
// ==============================
async function startBot() {
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        printQRInTerminal: true,
        auth: state
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {

        if (qr) {
            console.log("📱 Scan the QR code below:");
            qrcode.generate(qr, { small: true });
        }

        if (connection === "open") console.log("BOT CONNECTED ✔");

        if (connection === "close") {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) startBot();
        }
    });


    // ==============================
    // MESSAGE HANDLER
    // ==============================
    sock.ev.on("messages.upsert", async (msgUpdate) => {
        if (msgUpdate.type !== "notify") return;

        for (let msg of msgUpdate.messages) {
            if (!msg.message) continue;

            const sender = msg.key.remoteJid;

            // অটো রিপ্লাই
            await sock.sendMessage(sender, {
                text: "আপনার মেসেজ পেয়েছি 👍\nPDF পাঠালে আমি ফরওয়ার্ড করব + টেক্সট রিড করব।"
            });

            // Document (PDF) চেক করুন
            const doc = msg.message.documentMessage;
            if (doc && doc.mimetype.includes("pdf")) {
                queue.add(() => processPDF(sock, msg));
            }
        }
    });
}

// ==============================
// HANDLE PDF PROCESSING
// ==============================
async function processPDF(sock, msg) {
    try {
        const sender = msg.key.remoteJid;
        const fileName = msg.message.documentMessage.fileName;

        console.log("📥 PDF RECEIVED:", fileName);

        // Download PDF
        const stream = await sock.downloadMediaMessage(msg);
        const bufferArray = [];
        for await (const chunk of stream) bufferArray.push(chunk);
        const fileBuffer = Buffer.concat(bufferArray);

        const savePath = path.join(DOWNLOADS, fileName);
        fs.writeFileSync(savePath, fileBuffer);

        console.log("💾 SAVED:", savePath);

        // Extract PDF Text
        let pdfText = "";
        try {
            const data = await pdfParse(fileBuffer);
            pdfText = data.text.slice(0, 800); // preview
        } catch (e) {
            pdfText = "(PDF টেক্সট রিড করা যায়নি)";
        }

        // Forward PDF to target number
        await sock.sendMessage(FORWARD_TO, {
            document: fileBuffer,
            mimetype: "application/pdf",
            fileName: fileName
        });

        console.log("📤 PDF FORWARDED:", FORWARD_TO);

        // Send confirmation
        await sock.sendMessage(sender, {
            text: `📄 PDF Forwarded Successfully!\n\n📝 Extracted Text Preview:\n${pdfText}`
        });

    } catch (err) {
        console.error("PDF PROCESS ERROR:", err);
    }
}

// START BOT
startBot();
