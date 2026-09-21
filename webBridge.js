require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const { Config } = require('./database/modelos');

let chatWhatsAppActivo = null;
let sockWhatsApp = null;

async function extraerAlertasAPI() {
    try {
        console.log(`\n--- 🌐 PASO 2: DIAGNÓSTICO PROFUNDO DE SEEBOT ---`);
        const urlObjetivo = 'https://seebot.dev/missions.php';
        
        const response = await axios.get(urlObjetivo, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        const $ = cheerio.load(response.data);
        
        console.log(`📄 Título de la página: ${$('title').text().trim()}`);
        console.log(`📊 Tablas encontradas en el HTML: $('table').length = $('table').length`);
        
        let filasTotales = 0;
        $('tr').each((i, el) => {
            filasTotales++;
            const textoFila = $(el).text().replace(/\s+/g, ' ').trim();
            if (i < 15 && textoFila.length > 0) {
                console.log(`🔍 [FILA ${i}] ${textoFila.substring(0, 100)}`);
            }
        });

        console.log(`✅ [DIAGNÓSTICO 2 TERMINADO] Total de filas (tr) analizadas: ${filasTotales}`);

    } catch (e) {
        console.error("❌ Error al conectar con SeeBot en el Paso 2:", e.message);
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