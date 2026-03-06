const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const Groq = require('groq-sdk');
const fs = require('fs');

// ========================================================
const TELEGRAM_TOKEN = "8097662621:AAFIGvrsFEBlqDE8J-i4BlcEU3nVV8zBnw0";
const GROQ_API_KEY = "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";
// ========================================================

const groq = new Groq({ apiKey: GROQ_API_KEY });
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('🤖 البوت يعمل!'));
app.listen(PORT, () => console.log('السيرفر شغال...'));

let waSocket = null;
let isPairing = false;

async function connectToWhatsApp(phoneNumber = null, chatId = null) {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();
    
    waSocket = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: "silent" }), 
        // 🟢 تغيير البصمة إلى ويندوز كروم عادي جداً
        browser: ['Windows', 'Chrome', '111.0.0.0'],
        syncFullHistory: false
    });

    waSocket.ev.on('creds.update', saveCreds);

    if (!waSocket.authState.creds.registered && phoneNumber && chatId && !isPairing) {
        isPairing = true;
        if (chatId) bot.sendMessage(chatId, `⏳ جاري تهيئة الاتصال... يرجى الانتظار 10 ثوانٍ لخداع حماية واتساب...`);
        
        // 🟢 تأخير طلب الكود 10 ثوانٍ كاملة
        setTimeout(async () => {
            try {
                const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
                let code = await waSocket.requestPairingCode(cleanNumber);
                code = code?.match(/.{1,4}/g)?.join('-') || code;
                
                bot.sendMessage(chatId, `✅ تم استلام الكود!\n\nالكود: \`${code}\`\n\nأدخله الآن في واتساب.`, { parse_mode: 'Markdown' });
            } catch (err) {
                bot.sendMessage(chatId, `❌ خطأ: ${err.message}`);
                isPairing = false;
            }
        }, 10000); // 10 ثواني
    }

    waSocket.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'open') {
            isPairing = false;
            if (chatId) bot.sendMessage(chatId, `🎉 تم الربط بنجاح!`);
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                connectToWhatsApp(null, chatId); 
            } else {
                if (chatId) bot.sendMessage(chatId, `🛑 تم تسجيل الخروج.`);
                isPairing = false;
            }
        }
    });

    waSocket.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const senderId = msg.key.remoteJid;
        const textMessage = msg.message.conversation || msg.message.extendedTextMessage?.text;

        if (textMessage) {
            try {
                const chatCompletion = await groq.chat.completions.create({
                    messages:[
                        { role: "system", content: "أنت مساعد ذكي ولطيف، ترد على رسائل واتساب باختصار وبطريقة ودية." },
                        { role: "user", content: textMessage }
                    ],
                    model: "llama-3.3-70b-versatile",
                });

                const aiReply = chatCompletion.choices[0]?.message?.content || "عذراً، لم أتمكن من الرد.";
                await waSocket.sendMessage(senderId, { text: aiReply });
            } catch (error) {
                console.error('خطأ في Groq:', error);
            }
        }
    });
}

bot.onText(/\/reset/, (msg) => {
    const chatId = msg.chat.id;
    try {
        if (fs.existsSync('auth_info_baileys')) {
            fs.rmSync('auth_info_baileys', { recursive: true, force: true });
        }
        isPairing = false;
        bot.sendMessage(chatId, "✅ تم مسح الجلسة. أرسل رقمك الآن.");
    } catch (err) {}
});

bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (/^\d{10,15}$/.test(text)) {
        isPairing = false;
        connectToWhatsApp(text, chatId);
    }
});