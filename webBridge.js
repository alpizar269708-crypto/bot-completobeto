require('dotenv').config();
const axios = require('axios');
const cheerio =ريخ = require('cheerio'); // (mantén cheerio normal)
const { Config } = require('./database/modelos');

let chatWhatsAppActivo = null;
let sockWhatsApp = null;

async function probarFortniteDB() {
    try {
        console.log(`\n--- 🌐 CONSULTANDO FORTNITEDB ---`);
        const urlObjetivo = 'https://fortnitedb.com/';
        
        const response = await axios.get(urlObjetivo, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            }
        });

        const html = response.data;
        const $ = cheerio.load(html);
        let textoCrudo = '';

        // Buscamos elementos que contengan texto de misiones o niveles de poder altos
        $('div, span, p, tr, td').each((i, el) => {
            const t = $(el).text().trim();
            if (t.length > 3 && t.length < 100 && (t.includes('140') || t.includes('160') || t.includes('⚡') || t.toLowerCase().includes('fight') || t.toLowerCase().includes('retrieve'))) {
                textoCrudo += t + '\n';
            }
        });

        console.log(`\n--- 🔍 MUESTRA DE TEXTO DE FORTNITEDB ---\n${textoCrudo.substring(0, 1500)}\n--------------------------------------------\n`);

        if (textoCrudo.includes('140') || textoCrudo.includes('160')) {
            console.log("🔥 ¡Excelente! FortniteDB sí devolvió menciones de los niveles 140 y 160 en el HTML estático.");
        } else {
            console.log("⚠️ FortniteDB parece requerir carga por JavaScript al igual que la otra, revisaremos el formato.");
        }

    } catch (e) {
        console.error("❌ Error consultando FortniteDB:", e.message);
    }
}

function iniciarPuenteDiscord(sock) {
    sockWhatsApp = sock;
    probarFortniteDB();
    setInterval(probarFortniteDB, 60 * 60 * 1000);
}

function vincularChatWhatsApp(chatId) {
    chatWhatsAppActivo = chatId;
    console.log(`🔗 Chat vinculado: ${chatId}`);
}

module.exports = { iniciarPuenteDiscord, vincularChatWhatsApp };