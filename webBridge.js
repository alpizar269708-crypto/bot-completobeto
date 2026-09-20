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
        
        let pavosList = [];
        let epicasList = [];
        let legendariasList = [];

        // Palabras clave obligatorias de misiones de STW para filtrar solo tarjetas reales y descartar ruido
        const keywordsMisiones = [
            'fight the storm', 'retrieve the data', 'repair the shelter', 
            'ride the lightning', 'evacuate the shelter', 'deliver the bomb', 
            'resupply', 'eliminate and collect', 'rescue the survivors', 'hit the road'
        ];

        let tarjetasMisiones = [];

        // Buscamos contenedores o bloques que agrupen la información de la misión en la web
        $('div, section, article').each((i, el) => {
            const textoBloque = $(el).text().replace(/\s+/g, ' ').trim();
            
            // Validamos que el bloque contenga una misión real de STW y un número de poder válido
            const contieneMision = keywordsMisiones.some(k => textoBloque.toLowerCase().includes(k));
            const matchPl = textoBloque.match(/\b([1-9][0-9]|1[0-5][0-9]|160)\b/);

            if (contieneMision && matchPl) {
                // Evitamos duplicados largos asegurando que sea el bloque principal y no sub-elementos repetidos
                if (!tarjetasMisiones.some(t => t.texto === textoBloque)) {
                    tarjetasMisiones.push({
                        pl: matchPl[1],
                        texto: textoBloque
                    });
                }
            }
        });

        let misionesProcesadas = [];

        tarjetasMisiones.forEach(item => {
            let numPl = parseInt(item.pl);
            let misionTexto = item.texto;
            let recLower = misionTexto.toLowerCase();
            let recompensaTraducida = traducirRecompensa(misionTexto);

            // Identificador único para evitar duplicar la misma misión exacta
            let claveUnica = `${numPl}-${misionTexto.substring(0, 40)}`;
            if (!misionesProcesadas.includes(claveUnica)) {
                misionesProcesadas.push(claveUnica);

                if (recLower.includes('v-buck') || recLower.includes('vbuck') || recLower.includes('pavo')) {
                    const cantMatch = misionTexto.match(/(\d+)/);
                    const cantidad = cantMatch ? parseInt(cantMatch[1]) : 50;
                    pavosList.push({ pl: item.pl, mision: misionTexto, cantidad, recompensa: 'PaVos', tipo: 'STW Planner' });
                } else if ((recLower.includes('epic') || recLower.includes('épico')) && !recLower.includes('legendary') && numPl < 140) {
                    epicasList.push({ pl: item.pl, mision: misionTexto, recompensa: `🟣 Épico | ${recompensaTraducida}` });
                } else if (numPl >= 140 || recLower.includes('legendary') || recLower.includes('legendario') || recLower.includes('mythic') || recLower.includes('mítico')) {
                    let etiqueta = numPl === 160 ? '🔴 Nivel 160 (Supercargador)' : (numPl === 140 ? '⭐ Nivel 140' : '🟠 Legendario');
                    if (recLower.includes('mythic') || recLower.includes('mítico')) {
                        etiqueta = '🟡 Mítico';
                    }
                    legendariasList.push({ pl: item.pl, mision: misionTexto, recompensa: `${etiqueta} | ${recompensaTraducida}` });
                }
            }
        });

        // Guardar en la base de datos de MongoDB
        await Config.findOneAndUpdate({ clave: 'stw_pavos_activos' }, { valor: JSON.stringify(pavosList) }, { upsert: true });
        await Config.findOneAndUpdate({ clave: 'stw_epicas_activas' }, { valor: JSON.stringify(epicasList) }, { upsert: true });
        await Config.findOneAndUpdate({ clave: 'stw_legendarias_activas' }, { valor: JSON.stringify(legendariasList) }, { upsert: true });
        
        console.log(`✅ [STW PLANNER FILTRADO] Guardado -> PaVos: ${pavosList.length} | Épicas: ${epicasList.length} | Legendarias y Altas (140-160): ${legendariasList.length}`);

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