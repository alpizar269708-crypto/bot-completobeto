require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const { Config } = require('./database/modelos');

let chatWhatsAppActivo = null;
let sockWhatsApp = null;

function traducirRecompensa(texto) {
    let t = texto;
    t = t.replace(/\(Legendary\)/gi, '(Legendario)')
         .replace(/\(Epic\)/gi, '(Épico)')
         .replace(/\(Rare\)/gi, '(Raro)')
         .replace(/\(Uncommon\)/gi, '(Poco común)')
         .replace(/\(Common\)/gi, '(Común)')
         .replace(/Survivor/gi, 'Sobreviviente')
         .replace(/Defender/gi, 'Defensor')
         .replace(/Lead/gi, 'Líder')
         .replace(/V-Bucks/gi, 'PaVos');
    return t;
}

async function extraerAlertasAPI() {
    try {
        console.log(`\n--- 🌐 OBTENIENDO ALERTAS DE STW PLANNER (ALTA PRECISIÓN) ---`);
        const urlObjetivo = 'https://stw-planner.com/mission-alerts';
        
        const response = await axios.get(urlObjetivo, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        const html = response.data;
        const $ = cheerio.load(html);
        let lineas = [];

        // Extraemos todo el texto limpio elemento por elemento
        $('div, span, p, tr, td, h4, h5').each((i, el) => {
            const t = $(el).text().trim();
            if (t.length > 2 && !t.includes('©') && !t.includes('Twigsby') && !t.includes('Cookie')) {
                lineas.push(t);
            }
        });

        let pavosList = [];
        let epicasList = [];
        let legendariasList = [];

        // Buscamos de forma exacta las líneas que contengan las misiones de 140 y 160
        for (let i = 0; i < lineas.length; i++) {
            let actual = lineas[i];

            // Si detectamos una línea que sea exactamente 140 o 160
            if (actual === '140' || actual === '160') {
                let nivelPoder = actual;
                let nombreMision = lineas[i - 1] || 'Misión Cumbres';
                let recompensaTexto = traducirRecompensa(nombreMision);

                let etiqueta = nivelPoder === '160' ? '🔴 Nivel 160 (Supercargador)' : '⭐ Nivel 140';
                
                // Evitamos duplicados si el mismo bloque se repite en el HTML
                let claveUnica = `${nivelPoder}-${nombreMision}`;
                if (!legendariasList.some(m => `${m.pl}-${m.mision}` === claveUnica)) {
                    legendariasList.push({
                        pl: nivelPoder,
                        mision: nombreMision,
                        recompensa: `${etiqueta} | ${recompensaTexto}`
                    });
                }
            }
        }

        // Guardar en MongoDB
        await Config.findOneAndUpdate({ clave: 'stw_pavos_activos' }, { valor: JSON.stringify(pavosList) }, { upsert: true });
        await Config.findOneAndUpdate({ clave: 'stw_epicas_activas' }, { valor: JSON.stringify(epicasList) }, { upsert: true });
        await Config.findOneAndUpdate({ clave: 'stw_legendarias_activas' }, { valor: JSON.stringify(legendariasList) }, { upsert: true });
        
        console.log(`✅ [STW PLANNER ÉXITO] Guardado exacto -> PaVos: ${pavosList.length} | Nivel 140 y 160 detectados: ${legendariasList.length}`);

    } catch (e) {
        console.error("❌ Error procesando STW Planner:", e.message);
    }
}

function iniciarPuenteDiscord(sock) {
    sockWhatsApp = sock;
    extraerAlertasAPI();
    setInterval(extraerAlertasAPI, 60 * 60 * 1000);
}

function vincularChatWhatsApp(chatId) {
    chatWhatsAppActivo = chatId;
    console.log(`🔗 Chat vinculado: ${chatId}`);
}

module.exports = { iniciarPuenteDiscord, vincularChatWhatsApp };