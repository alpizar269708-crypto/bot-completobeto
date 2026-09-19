const cron = require('node-cron');
const cheerio = require('cheerio');
const { Config } = require('../database/modelos');

function obtenerFechaActual() {
    const opciones = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    return new Date().toLocaleDateString('es-ES', opciones);
}
// 🌐 Extractor de Salvar el Mundo (Directo de FortniteDB Filtrado)
// 🌐 Extractor de Salvar el Mundo (Versión Pura en Texto Plano)
async function obtenerAlertasSTW() {
    let pavos = [];
    let legendarias = []; 

    try {
        let respuesta = await fetch('https://freethevbucks.com/timed-missions/', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36' }
        });
        
        let html = await respuesta.text();

        // 1. A LA MIERDA EL HTML: Borramos de tajo cabeceras, menús, scripts y barras laterales.
        html = html.replace(/<(head|script|style|nav|footer|header|aside)[^>]*>[\s\S]*?<\/\1>/gi, '');
        
        // 2. Reemplazamos cualquier etiqueta web restante por un ESPACIO (así nada se pega accidentalmente)
        let textoPlano = html.replace(/<[^>]+>/g, ' ');
        
        // 3. Dejamos el texto totalmente limpio, en minúsculas y sin espacios dobles
        textoPlano = textoPlano.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').toLowerCase();

        // REGEX INQUEBRANTABLE: Busca la estructura exacta de Freethevbucks.
        // (25 a 50) + (basura visual) + (PL 1 a 160) + (basura visual) + (Nombre Misión) + "in" + (Zona)
        const regexMisiones = /(25|30|35|40|50)([^0-9]{1,30}?)(\d{1,3})([^a-z]{1,20}?)([a-z0-9\s\-]+?)\s+in\s+(twine peaks|canny valley|plankerton|stonewood)/gi;

        let match;
        let misionesGuardadas = new Set();

        // Diccionario oficial de misiones
        const misionesNombres = [
            { en: 'ride the lightning', es: 'Monta el relámpago' },
            { en: 'fight the storm', es: 'Lucha contra la tormenta' },
            { en: 'category 1', es: 'Tormenta cat. 1' },
            { en: 'category 2', es: 'Tormenta cat. 2' },
            { en: 'category 3', es: 'Tormenta cat. 3' },
            { en: 'category 4', es: 'Tormenta cat. 4' },
            { en: 'evacuate the shelter', es: 'Evacua el refugio' },
            { en: 'repair the shelter', es: 'Repara el refugio' },
            { en: 'deliver the bomb', es: 'Entrega el pedido' },
            { en: 'retrieve the data', es: 'Recupera los datos' },
            { en: 'rescue the survivors', es: 'Rescata supervivientes' },
            { en: 'test the suit', es: 'Prueba el traje' },
            { en: 'eliminate and collect', es: 'Elimina y recolecta' },
            { en: 'resupply', es: 'Reabastecimiento' },
            { en: 'build the radar', es: 'Construye la red de radar' }
        ];

        while ((match = regexMisiones.exec(textoPlano)) !== null) {
            let cantidad = parseInt(match[1]);
            let pl = match[3];
            let misionCruda = match[5].trim();
            let zonaCruda = match[6].trim();

            // Mapeo estricto de Zonas
            let zonaEs = '';
            if (zonaCruda === 'twine peaks') zonaEs = 'Cumbres Leñosas';
            else if (zonaCruda === 'canny valley') zonaEs = 'Valle Latoso';
            else if (zonaCruda === 'plankerton') zonaEs = 'Valle Plácido';
            else if (zonaCruda === 'stonewood') zonaEs = 'Bosque Pedregoso';

            // Validación rigurosa de Misiones
            let misionEs = '';
            let esMisionValida = false;
            for (let m of misionesNombres) {
                if (misionCruda.includes(m.en)) {
                    misionEs = m.es;
                    esMisionValida = true;
                    break;
                }
            }

            // Si atrapó un texto random de la página que no es misión, lo desecha inmediatamente
            if (!esMisionValida) continue;

            // Candado final: Nadie tiene misiones arriba de nivel 160. Descarta basura matemática.
            if (parseInt(pl) > 160) continue;

            // ID único para evitar clonación
            let idUnico = `${zonaEs}-${cantidad}-${pl}-${misionEs}`;
            if (!misionesGuardadas.has(idUnico)) {
                misionesGuardadas.add(idUnico);
                pavos.push({ zona: zonaEs, cantidad: cantidad, pl: pl, mision: misionEs, modificador: 'Estándar' });
            }
        }
    } catch (e) {
        console.error("Error al extraer alertas:", e);
    }

    // Retorno limpio
    return { pavos, legendarias };
}
async function alertasSTW(sock, chatId, msg, categoria = 'todas') {
    const datos = await obtenerAlertasSTW();
    const fechaHoy = obtenerFechaActual();
    let texto = '';

    if (categoria === 'pavos') {
        let totalPavos = 0;
        texto += `🎮 *ALERTAS DE PAVOS STW*\n`;
        texto += `📅 _${fechaHoy}_\n\n`;

        if (datos.pavos.length === 0) {
            texto += `_No hay alertas de pavos hoy._\n\n`;
        } else {
            datos.pavos.forEach(p => {
                totalPavos += p.cantidad;
                texto += `📍 *${p.zona}*\n`;
                texto += `🪙 *PaVos:* ${p.cantidad}\n`;
                texto += `⚡ *PL:* ${p.pl}\n`;
                texto += `🎯 *Misión:* ${p.mision}\n\n`;
            });
            texto += `💰 *Total del día:* ${totalPavos} paVos\n\n`;
        }
        texto += `Support-a-Creator: *JASC13* ❤️`;
    } else {
        texto += `🤖 *CONSULTAS DE SALVAR EL MUNDO*\n\n`;
        texto += `Escribe *pavos* para ver las misiones activas.\n\n`;
        texto += `Support-a-Creator: *JASC13* ❤️`;
    }

    await sock.sendMessage(chatId, { text: texto }, { quoted: msg });
}

async function comandoSetPavos(sock, chatId, msg, args) {
    const remitente = msg.key.participant || chatId;
    if (chatId.endsWith('@g.us')) {
        try {
            const groupMetadata = await sock.groupMetadata(chatId);
            const participante = groupMetadata.participants.find(p => p.id === remitente);
            if (!(participante && (participante.admin === 'admin' || participante.admin === 'superadmin'))) return;
        } catch (e) {}
    }

    const textoArgs = args.join(' ');
    const partes = textoArgs.split('|').map(p => p.trim());
    if (partes.length < 3) return;

    let actual = await Config.findOne({ clave: 'stw_pavos_activos' });
    let lista = actual ? JSON.parse(actual.valor) : [];
    
    lista.push({ zona: partes[0], mision: partes[1], cantidad: parseInt(partes[2]) || 30, pl: partes[3] || '??', modificador: 'Estándar' });
    await Config.findOneAndUpdate({ clave: 'stw_pavos_activos' }, { valor: JSON.stringify(lista) }, { upsert: true });
    await sock.sendMessage(chatId, { text: `✅ Misión manual agregada.` }, { quoted: msg });
}

async function comandoResetPavos(sock, chatId, msg) {
    await Config.findOneAndDelete({ clave: 'stw_pavos_activos' });
    await sock.sendMessage(chatId, { text: `🗑️ Alertas manuales restablecidas.` }, { quoted: msg });
}

async function comandoPreguntarAlerta(sock, chatId, msg) {
    await sock.sendMessage(chatId, { text: `🤖 Escribe *pavos* para ver las misiones activas.` }, { quoted: msg });
}

function iniciarCronAlertasDiarias(sock) {
    cron.schedule('5 18 * * *', async () => {
        try {
            const configChat = await Config.findOne({ clave: 'chat_alertas_diarias' });
            if (!configChat || !configChat.valor) return;

            const datos = await obtenerAlertasSTW();
            let total = datos.pavos.reduce((acc, p) => acc + p.cantidad, 0);

            let mensajeAuto = `🎮 *REPORTE DIARIO DE PAVOS (6:05 PM)*\n\n`;
            if (datos.pavos.length > 0) {
                datos.pavos.forEach(p => {
                    mensajeAuto += `📍 *${p.zona}* | 🪙 ${p.cantidad} PaVos | ⚡ PL: ${p.pl}\n`;
                });
                mensajeAuto += `\n💰 *Total del día:* ${total} paVos\n\n`;
            } else {
                mensajeAuto += `_No hay alertas de pavos hoy._\n\n`;
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

module.exports = { 
    obtenerAlertasSTW,
    alertasSTW, 
    comandoPreguntarAlerta, 
    iniciarCronAlertasDiarias, 
    activarAlertasDiarias, 
    comandoSetPavos,
    comandoResetPavos
};