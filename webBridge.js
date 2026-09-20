require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const { Config } = require('./database/modelos');

let chatWhatsAppActivo = null;
let sockWhatsApp = null;

// Diccionario de traducción al español
const acroMap = {
    'ets': 'Evacua el refugio',
    'rtd': 'Recupera los datos',
    'rtl': 'Monta el relámpago',
    'fts': 'Lucha contra la tormenta',
    'c1s': 'Tormenta cat. 1',
    'c2s': 'Tormenta cat. 2',
    'c3s': 'Tormenta cat. 3',
    'c4s': 'Tormenta cat. 4',
    'rts': 'Repara el refugio',
    'dtb': 'Entrega el pedido',
    'etc': 'Elimina y recolecta',
    'res': 'Reabastecimiento'
};

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

async function extraerAlertasWeb() {
    try {
        console.log(`\n--- 🌐 CONSULTANDO STW PLANNER ---`);
        const url = 'https://stw-planner.com/mission-alerts';
        const { data } = await axios.get(url, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
            }
        });

        const $ = cheerio.load(data);
        let textoCrudo = '';

        // Recorremos los elementos de texto clave de la página para capturar la información
        $('div, span, p, a, td').each((i, el) => {
            const t = $(el).text().trim();
            if (t.length > 3 && t.length < 120 && (t.includes('⚡') || t.includes('PL') || t.includes('V-Bucks') || t.includes('Legendary') || t.includes('Epic'))) {
                textoCrudo += t + '\n';
            }
        });

        console.log(`\n--- 🔍 MUESTRA DE TEXTO EXTRAÍDO DE STW PLANNER ---\n${textoCrudo.substring(0, 1500)}\n----------------------------------------------------\n`);

        let pavosList = [];
        let epicasList = [];
        let legendariasList = [];

        const lineas = textoCrudo.split('\n');
        lineas.forEach(linea => {
            // Buscamos patrones de nivel de poder y misiones
            const match = linea.match(/(\d+)\s*(?:⚡|PL)?\s*([A-Za-z0-9]+)\s*[-–]?\s*(.+)/);
            if (match) {
                const pl = match[1].trim();
                const acro = match[2].trim().toLowerCase();
                let recompensa = traducirRecompensa(match[3].trim());
                const misionEs = acroMap[acro] || match[2].trim();
                const recLower = recompensa.toLowerCase();

                if (recLower.includes('v-buck') || recLower.includes('vbuck') || recLower.includes('pavo')) {
                    const cantMatch = recompensa.match(/(\d+)/);
                    const cantidad = cantMatch ? parseInt(cantMatch[1]) : 50;
                    pavosList.push({ pl, mision: misionEs, cantidad, recompensa: 'PaVos', tipo: 'STW Planner' });
                } else if (recLower.includes('epic') || recLower.includes('épico')) {
                    epicasList.push({ pl, mision: misionEs, recompensa: `🟣 Épico | ${recompensa}` });
                } else if (recLower.includes('legendary') || recLower.includes('legendario') || recLower.includes('mythic') || recLower.includes('mítico')) {
                    let colorEmoji = (recLower.includes('mythic') || recLower.includes('mítico')) ? '🟡 Mítico' : '🟠 Legendario';
                    legendariasList.push({ pl, mision: misionEs, recompensa: `${colorEmoji} | ${recompensa}` });
                }
            }
        });

        // Guardar resultados en MongoDB
        if (pavosList.length > 0 || epicasList.length > 0 || legendariasList.length > 0) {
            await Config.findOneAndUpdate({ clave: 'stw_pavos_activos' }, { valor: JSON.stringify(pavosList) }, { upsert: true });
            await Config.findOneAndUpdate({ clave: 'stw_epicas_activas' }, { valor: JSON.stringify(epicasList) }, { upsert: true });
            await Config.findOneAndUpdate({ clave: 'stw_legendarias_activas' }, { valor: JSON.stringify(legendariasList) }, { upsert: true });
            console.log(`✅ [STW PLANNER] Datos guardados -> PaVos: ${pavosList.length} | Épicas: ${epicasList.length} | Legendarias: ${legendariasList.length}`);
        } else {
            console.log(`⚠️ [STW PLANNER] Se descargó la página pero la expresión regular requiere ajuste según la muestra mostrada arriba.`);
        }

    } catch (e) {
        console.error("❌ Error haciendo scraping a STW Planner:", e.message);
    }
}

function iniciarPuenteDiscord(sock) {
    sockWhatsApp = sock;
    extraerAlertasWeb();
    setInterval(extraerAlertasWeb, 60 * 60 * 1000); // Consulta cada hora de forma automática
}

function vincularChatWhatsApp(chatId) {
    chatWhatsAppActivo = chatId;
    console.log(`🔗 Chat vinculado: ${chatId}`);
}

module.exports = { iniciarPuenteDiscord, vincularChatWhatsApp };