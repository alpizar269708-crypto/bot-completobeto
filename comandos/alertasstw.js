const cron = require('node-cron');
const cheerio = require('cheerio');
const { Config } = require('../database/modelos');

function obtenerFechaActual() {
    const opciones = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    return new Date().toLocaleDateString('es-ES', opciones);
}

function determinarZona(plStr) {
    const pl = parseInt(plStr);
    if (isNaN(pl)) return 'Zona Desconocida';
    if (pl <= 19) return 'Bosque Pedregoso';
    if (pl <= 46) return 'Valle Plácido';
    if (pl <= 70) return 'Valle Latoso';
    return 'Cumbres Leñosas';
}

function extraerNombreMision(texto) {
    const misiones = [
        'Ride the Lightning', 'Fight the Storm', 'Category 1', 'Category 2', 'Category 3', 'Category 4', 
        'Evacuate the Shelter', 'Repair the Shelter', 'Deliver the Bomb', 'Retrieve the Data', 
        'Rescue the Survivors', 'Test the Suit', 'Eliminate and Collect', 'Resupply', 'Build the Radar'
    ];
    for (let m of misiones) {
        if (texto.toLowerCase().includes(m.toLowerCase())) return m;
    }
    return 'Misión de Alerta';
}

// 🌐 SCRAPER AUTOMÁTICO CLASIFICADO POR COLORES
async function obtenerAlertasSTW() {
    let pavos = [];
    let destacadas = []; 

    try {
        const res = await fetch('https://freethevbucks.com/timed-missions/', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        const html = await res.text();
        const $ = cheerio.load(html);

        $('table tbody tr').each((i, el) => {
            const textoFila = $(el).text().replace(/\s+/g, ' ').trim();
            const matchPL = textoFila.match(/\b([1-9]|[1-9]\d|1[0-6]\d)\b/);
            const pl = matchPL ? matchPL[1] : '??';
            const zona = determinarZona(pl);
            const mision = extraerNombreMision(textoFila);

            // 🔵 Búsqueda de PaVos
            if (textoFila.toLowerCase().includes('v-bucks')) {
                const matchVbucks = textoFila.match(/(\d{2,3})\s*v-bucks/i);
                const cantidad = matchVbucks ? parseInt(matchVbucks[1]) : 30;
                if (cantidad >= 25 && cantidad <= 100) {
                    pavos.push({ rareza: '🔵 V-Bucks', pl, zona, mision, recompensa: `${cantidad} PaVos` });
                }
            }

            // 🟡 Búsqueda de Míticas
            if (textoFila.toLowerCase().includes('mythic')) {
                destacadas.push({ rareza: '🟡 Mítico', pl, zona, mision, recompensa: 'Líder Sobreviviente Mítico' });
            }
            // 🟠 Búsqueda de Legendarias (Filtrando basuras como el Perk-UP)
            else if (textoFila.toLowerCase().includes('legendary') && !textoFila.toLowerCase().includes('perk-up')) {
                let tipo = 'Recompensa Legendaria';
                if (textoFila.toLowerCase().includes('survivor')) tipo = 'Sobreviviente Legendario';
                if (textoFila.toLowerCase().includes('hero')) tipo = 'Héroe Legendario';
                if (textoFila.toLowerCase().includes('defender')) tipo = 'Defensor Legendario';
                if (textoFila.toLowerCase().includes('schematic')) tipo = 'Esquema Legendario';

                destacadas.push({ rareza: '🟠 Legendario', pl, zona, mision, recompensa: tipo });
            }
        });

        // Eliminar duplicados en caso de que la página repita tablas
        pavos = pavos.filter((v,i,a)=>a.findIndex(t=>(t.pl === v.pl && t.mision === v.mision))===i);
        destacadas = destacadas.filter((v,i,a)=>a.findIndex(t=>(t.pl === v.pl && t.mision === v.mision && t.recompensa === v.recompensa))===i);

    } catch (e) {
        console.error("Error al extraer alertas automáticas:", e);
    }

    return { pavos, destacadas };
}

// 📱 FORMATEADOR DE MENSAJES PARA WHATSAPP
async function alertasSTW(sock, chatId, msg, categoria = 'todas') {
    const datos = await obtenerAlertasSTW();
    const fechaHoy = obtenerFechaActual();
    let texto = `📅 _${fechaHoy}_\n\n`;

    if (categoria === 'pavos' || categoria === 'todas') {
        texto += `🔵 *ALERTAS DE PAVOS*\n`;
        if (datos.pavos.length === 0) {
            texto += `_No hay alertas de pavos hoy._\n\n`;
        } else {
            let totalPavos = 0;
            datos.pavos.forEach(p => {
                totalPavos += parseInt(p.recompensa);
                texto += `📍 *${p.zona}* (PL ${p.pl})\n🎁 ${p.recompensa}\n🎯 ${p.mision}\n\n`;
            });
            texto += `💰 *Total del día:* ${totalPavos} PaVos\n\n`;
        }
    }

    if (categoria === 'destacadas' || categoria === 'todas') {
        texto += `🌟 *ALERTAS MÍTICAS Y LEGENDARIAS*\n`;
        if (datos.destacadas.length === 0) {
            texto += `_No se encontraron recompensas destacadas hoy._\n\n`;
        } else {
            datos.destacadas.forEach(a => {
                texto += `📍 *${a.zona}* (PL ${a.pl})\n🎁 ${a.rareza}: *${a.recompensa}*\n🎯 ${a.mision}\n\n`;
            });
        }
    }

    texto += `Support-a-Creator: *JASC13* ❤️`;
    await sock.sendMessage(chatId, { text: texto }, { quoted: msg });
}

// CRON JOB AUTOMÁTICO (6:05 PM)
function iniciarCronAlertasDiarias(sock) {
    cron.schedule('5 18 * * *', async () => {
        try {
            const configChat = await Config.findOne({ clave: 'chat_alertas_diarias' });
            if (!configChat || !configChat.valor) return;

            const datos = await obtenerAlertasSTW();
            let total = datos.pavos.reduce((acc, p) => acc + parseInt(p.recompensa), 0);

            let mensajeAuto = `🎮 *REPORTE DIARIO STW (6:05 PM)*\n\n`;
            
            mensajeAuto += `*🔵 PAVOS 🔵*\n`;
            if (datos.pavos.length > 0) {
                datos.pavos.forEach(p => {
                    mensajeAuto += `📍 *${p.zona}* | 🎁 ${p.recompensa} | ⚡ PL: ${p.pl}\n`;
                });
                mensajeAuto += `💰 Total: ${total} PaVos\n\n`;
            } else {
                mensajeAuto += `_No hay pavos hoy._\n\n`;
            }

            mensajeAuto += `*🌟 MÍTICAS Y LEGENDARIAS 🌟*\n`;
            if (datos.destacadas.length > 0) {
                datos.destacadas.forEach(a => {
                    mensajeAuto += `📍 *${a.zona}* | ${a.rareza} | ⚡ PL: ${a.pl}\n`;
                });
                mensajeAuto += `\n`;
            } else {
                mensajeAuto += `_No hay recompensas destacadas hoy._\n\n`;
            }

            mensajeAuto += `Support-a-Creator: *JASC13* ❤️`;
            
            await sock.sendMessage(configChat.valor, { text: mensajeAuto });
        } catch (error) {}
    }, { scheduled: true, timezone: "America/Mexico_City" });
}

async function activarAlertasDiarias(sock, chatId, msg) {
    await Config.findOneAndUpdate({ clave: 'chat_alertas_diarias' }, { valor: chatId }, { upsert: true });
    await sock.sendMessage(chatId, { text: `✅ *Grupo vinculado.* Reportes automáticos diarios a las 6:05 PM configurados.` }, { quoted: msg });
}

module.exports = { alertasSTW, iniciarCronAlertasDiarias, activarAlertasDiarias };