require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const { Config } = require('./database/modelos');

let chatWhatsAppActivo = null;
let sockWhatsApp = null;

async function extraerAlertasAPI() {
    try {
        console.log(`\n--- 🌐 PASO 3: INSPECCIÓN DE CONTENEDORES DIV EN SEEBOT ---`);
        const urlObjetivo = 'https://seebot.dev/missions.php';
        
        const response = await axios.get(urlObjetivo, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        const $ = cheerio.load(response.data);
        
        // Buscamos elementos div que contengan texto y tengan alguna clase asignada
        let divsConClase = 0;
        let muestrasEncontradas = 0;

        $('div').each((i, el) => {
            const cls = $(el).attr('class');
            const txt = $(el).text().replace(/\s+/g, ' ').trim();
            
            if (cls) {
                divsConClase++;
            }

            // Si el texto incluye los niveles altos que nos interesan y es un bloque conciso
            if ((txt.includes('140') || txt.includes('160')) && txt.length > 5 && txt.length < 200) {
                muestrasEncontradas++;
                if (muestrasEncontradas <= 10) {
                    console.log(`🔍 [DIV CLASE: "${cls || 'ninguna'}"] -> ${txt}`);
                }
            }
        });

        console.log(`✅ [DIAGNÓSTICO 3 TERMINADO] Divs con clase: ${divsConClase} | Coincidencias de nivel alto en divs: ${muestrasEncontradas}`);

    } catch (e) {
        console.error("❌ Error en el Paso 3 de SeeBot:", e.message);
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