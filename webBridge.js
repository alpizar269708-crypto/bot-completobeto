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
        console.log(`\n--- 🌐 BUSCANDO DATOS INTERNOS EN STW PLANNER ---`);
        const urlObjetivo = 'https://stw-planner.com/mission-alerts';
        
        const response = await axios.get(urlObjetivo, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        const html = response.data;
        const $ = cheerio.load(html);

        let pavosList = [];
        let epicasList = [];
        let legendariasList = [];
        let datosEncontrados = false;

        // Buscamos dentro de todas las etiquetas <script> si hay un JSON con misiones
        $('script').each((i, el) => {
            const contenidoScript = $(el).html() || '';
            if (contenidoScript.includes('160') || contenidoScript.includes('140') || contenidoScript.includes('mission')) {
                // Intentamos extraer bloques que parezcan arrays u objetos de misiones
                const matches = contenidoScript.match(/\{[^}]*["'](?:powerLevel|plin|mission|reward)[^}]*\}/g);
                if (matches) {
                    datosEncontrados = true;
                    matches.forEach(m => {
                        if (m.includes('160') || m.includes('140') || m.toLowerCase().includes('v-buck') || m.toLowerCase().includes('legendary')) {
                            let textoLimpio = traducirRecompensa(m);
                            if (m.includes('160')) {
                                legendariasList.push({ pl: '160', mision: 'Misión Nivel 160 (Supercargador)', recompensa: '🔴 Nivel 160 | ' + textoLimpio });
                            } else if (m.includes('140')) {
                                legendariasList.push({ pl: '140', mision: 'Misión Nivel 140', recompensa: '⭐ Nivel 140 | ' + textoLimpio });
                            }
                        }
                    });
                }
            }
        });

        // Si el método de scripts no capturó por formato, hacemos un respaldo rápido buscando textos directos de tarjetas
        if (legendariasList.length === 0) {
            console.log("⚠️ Extrayendo por estructura visual directa...");
            // Buscamos elementos que contengan la estructura de Cumbres (PL 140 y 160)
            $('*').each((i, el) => {
                const txt = $(el).text().trim();
                if ((txt.includes('140') || txt.includes('160')) && (txt.includes('Fight the Storm') || txt.includes('Retrieve the Data') || txt.includes('Repair the Shelter') || txt.includes('Ride the Lightning'))) {
                    if (txt.length < 150) {
                        const plMatch = txt.match(/(140|160)/);
                        if (plMatch) {
                            const pl = plMatch[1];
                            const clave = `${pl}-${txt}`;
                            if (!legendariasList.some(item => `${item.pl}-${item.mision}` === clave)) {
                                let etiqueta = pl === '160' ? '🔴 Nivel 160 (Supercargador)' : '⭐ Nivel 140';
                                legendariasList.push({
                                    pl,
                                    mision: txt,
                                    recompensa: `${etiqueta} | ${traducirRecompensa(txt)}`
                                });
                            }
                        }
                    }
                }
            });
        }

        // Guardar en MongoDB
        await Config.findOneAndUpdate({ clave: 'stw_pavos_activos' }, { valor: JSON.stringify(pavosList) }, { upsert: true });
        await Config.findOneAndUpdate({ clave: 'stw_epicas_activas' }, { valor: JSON.stringify(epicasList) }, { upsert: true });
        await Config.findOneAndUpdate({ clave: 'stw_legendarias_activas' }, { valor: JSON.stringify(legendariasList) }, { upsert: true });
        
        console.log(`✅ [STW PLANNER JSON/RESPALDO] PaVos: ${pavosList.length} | Épicas: ${epicasList.length} | Nivel 140 y 160: ${legendariasList.length}`);

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