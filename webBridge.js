require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const { Config } = require('./database/modelos');

let chatWhatsAppActivo = null;
let sockWhatsApp = null;

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
        let textoCrudo = '';

        // Recorremos elementos contenedores de texto para extraer las misiones completas
        $('div, span, p, tr, td').each((i, el) => {
            const t = $(el).text().trim();
            // Filtramos líneas que contengan indicadores de nivel o recompensas clave
            if (t.length > 3 && t.length < 150 && (t.includes('⚡') || t.includes('140') || t.includes('160') || t.includes('V-Bucks') || t.includes('Legendary') || t.includes('Epic'))) {
                textoCrudo += t + '\n';
            }
        });

        console.log(`\n--- 🔍 MUESTRA DE LÍNEAS FILTRADAS --- \n${textoCrudo.substring(0, 1200)}\n----------------------------------------\n`);

        let pavosList = [];
        let epicasList = [];
        let legendariasList = [];

        const lineas = textoCrudo.split('\n');
        lineas.forEach(linea => {
            // Buscamos patrones que incluyan niveles altos (ej. 140, 160) y niveles estándar
            const match = linea.match(/(\d+)\s*(?:⚡)?\s*([A-Za-z0-9]+)?\s*[-–]?\s*(.+)/);
            if (match) {
                const pl = match[1].trim();
                // Si el PL es válido para STW (ej. mayor a 10 y menor o igual a 160)
                const numPl = parseInt(pl);
                if (numPl >= 10 && numPl <= 160) {
                    const acro = (match[2] || 'Misión').trim().toLowerCase();
                    let recompensa = traducirRecompensa((match[3] || '').trim());
                    const misionEs = acroMap[acro] || acro;
                    const recLower = recompensa.toLowerCase();

                    if (recLower.includes('v-buck') || recLower.includes('vbuck') || recLower.includes('pavo')) {
                        const cantMatch = recompensa.match(/(\d+)/);
                        const cantidad = cantMatch ? parseInt(cantMatch[1]) : 50;
                        pavosList.push({ pl, mision: misionEs, cantidad, recompensa: 'PaVos', tipo: 'STW Planner' });
                    } else if (recLower.includes('epic') || recLower.includes('épico')) {
                        epicasList.push({ pl, mision: misionEs, recompensa: `🟣 Épico | ${recompensa}` });
                    } else if (recLower.includes('legendary') || recLower.includes('legendario') || recLower.includes('mythic') || recLower.includes('mítico') || numPl >= 140) {
                        // Capturamos también las de nivel 140 y 160 aunque el texto no diga explícitamente legendario
                        let colorEmoji = (recLower.includes('mythic') || recLower.includes('mítico')) ? '🟡 Mítico' : '🟠 Legendario';
                        if (numPl >= 140 && !recLower.includes('legendary') && !recLower.includes('legendario')) {
                            colorEmoji = `⭐ Nivel Alto (${numPl})`;
                        }
                        legendariasList.push({ pl, mision: misionEs, recompensa: `${colorEmoji} | ${recompensa}` });
                    }
                }
            }
        });

        if (pavosList.length > 0 || epicasList.length > 0 || legendariasList.length > 0) {
            await Config.findOneAndUpdate({ clave: 'stw_pavos_activos' }, { valor: JSON.stringify(pavosList) }, { upsert: true });
            await Config.findOneAndUpdate({ clave: 'stw_epicas_activas' }, { valor: JSON.stringify(epicasList) }, { upsert: true });
            await Config.findOneAndUpdate({ clave: 'stw_legendarias_activas' }, { valor: JSON.stringify(legendariasList) }, { upsert: true });
            console.log(`✅ [STW PLANNER] Alertas procesadas -> PaVos: ${pavosList.length} | Épicas: ${epicasList.length} | Legendarias/Altas: ${legendariasList.length}`);
        } else {
            console.log(`⚠️ Se leyó la web pero la extracción de líneas requiere un pequeño ajuste.`);
        }

    } catch (e) {
        console.error("❌ Error procesando datos de STW Planner:", e.message);
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