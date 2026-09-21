require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const { Config } = require('./database/modelos');

let chatWhatsAppActivo = null;
let sockWhatsApp = null;

async function extraerAlertasAPI() {
    try {
        console.log(`\n--- 🌐 PASO 1: DIAGNÓSTICO DE SEEBOT ---`);
        const urlObjetivo = 'https://seebot.dev/missions.php';
        
        const response = await axios.get(urlObjetivo, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        const $ = cheerio.load(response.data);
        
        // Buscamos filas o bloques que contengan 140 o 160 para ver la estructura de SeeBot
        let encontrados = 0;
        $('tr, div, table').each((i, el) => {
            const txt = $(el).text().replace(/\s+/g, ' ').trim();
            if ((txt.includes('140') || txt.includes('160')) && txt.length < 400) {
                encontrados++;
                if (encontrados <= 10) {
                    console.log(`🔍 [LOG SEEBOT] Elemento: ${txt.substring(0, 150)}`);
                }
            }
        });

        console.log(`✅ [DIAGNÓSTICO TERMINADO] Total de coincidencias de nivel alto detectadas: ${encontrados}`);

    } catch (e) {
        console.error("❌ Error al conectar con SeeBot:", e.message);
    }
}

function iniciarPuenteDiscord(sock) {
    sockWhatsApp = sock;
    extraerAlertasAPI();
    setInterval(extraerAlertasAPI, 60 * 60 * 1000);
}

function vincularChatWhatsApp(chatId) {
    chatWhatsAppActivo = chatId;
}

module.exports = { iniciarPuenteDiscord, vincularChatWhatsApp, extraerAlertasAPI };