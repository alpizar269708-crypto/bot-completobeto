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
        console.log(`\n--- 🌐 OBTENIENDO ALERTAS DE STW PLANNER ---`);
        const urlObjetivo = 'https://stw-planner.com/mission-alerts';
        
        const response = await axios.get(urlObjetivo, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        const html = response.data;
        const $ = cheerio.load(html);
        let lineas = [];

        // Recolectamos todas las líneas de texto limpias de la web
        $('div, span, p, tr, td, h4, h5').each((i, el) => {
            const t = $(el).text().trim();
            if (t.length > 2 && !t.includes('©') && !t.includes('Twigsby') && !t.includes('Cookie')) {
                lineas.push(t);
            }
        });

        let pavosList = [];
        let epicasList = [];
        let legendariasList = [];

        // Analizamos por parejas: [Misión, Nivel de Poder]
        for (let i = 0; i < lineas.length - 1; i++) {
            let actual = lineas[i];
            let siguiente = lineas[i+1];

            let numPl = parseInt(siguiente);
            // Si el siguiente valor es un Nivel de Poder válido (10 a 160)
            if (!isNaN(numPl) && numPl >= 10 && numPl <= 160) {
                let misionEs = actual;
                let pl = siguiente.toString();
                let recLower = misionEs.toLowerCase();

                let recompensaTexto = traducirRecompensa(misionEs);

                if (recLower.includes('v-buck') || recLower.includes('vbuck') || recLower.includes('pavo')) {
                    const cantMatch = misionEs.match(/(\d+)/);
                    const cantidad = cantMatch ? parseInt(cantMatch[1]) : 50;
                    pavosList.push({ pl, mision: misionEs, cantidad, recompensa: 'PaVos', tipo: 'STW Planner' });
                } else if (recLower.includes('epic') || recLower.includes('épico')) {
                    epicasList.push({ pl, mision: misionEs, recompensa: `🟣 Épico | ${recompensaTexto}` });
                } else {
                    // Capturamos todas las demás (incluyendo niveles 140 y 160, legendarias, etc.)
                    let etiqueta = `⭐ Nivel ${pl}`;
                    if (recLower.includes('legendary') || recLower.includes('legendario')) {
                        etiqueta = '🟠 Legendario';
                    } else if (recLower.includes('mythic') || recLower.includes('mítico')) {
                        etiqueta = '🟡 Mítico';
                    }
                    legendariasList.push({ pl, mision: misionEs, recompensa: `${etiqueta} | ${recompensaTexto}` });
                }

                i++; // Saltamos el número de PL en la siguiente iteración
            }
        }

        if (pavosList.length > 0 || epicasList.length > 0 || legendariasList.length > 0) {
            await Config.findOneAndUpdate({ clave: 'stw_pavos_activos' }, { valor: JSON.stringify(pavosList) }, { upsert: true });
            await Config.findOneAndUpdate({ clave: 'stw_epicas_activas' }, { valor: JSON.stringify(epicasList) }, { upsert: true });
            await Config.findOneAndUpdate({ clave: 'stw_legendarias_activas' }, { valor: JSON.stringify(legendariasList) }, { upsert: true });
            console.log(`✅ [STW PLANNER EXITO] Guardado -> PaVos: ${pavosList.length} | Épicas: ${epicasList.length} | Legendarias/Altas (140-160): ${legendariasList.length}`);
        } else {
            console.log(`⚠️ Se leyeron las líneas pero ninguna emparejó con un PL válido.`);
        }

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