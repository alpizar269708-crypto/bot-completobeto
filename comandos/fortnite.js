const cron = require('node-cron');
const { Config } = require('../database/modelos');

function obtenerFechaActual() {
    const opciones = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    return new Date().toLocaleDateString('es-ES', opciones);
}

// 🔒 FUNCIÓN DE SEGURIDAD PARA COMANDOS ADMINISTRATIVOS
async function esAdminValido(sock, chatId, msg) {
    if (!chatId.endsWith('@g.us')) {
        await sock.sendMessage(chatId, { text: `❌ Este comando solo se puede usar en grupos.` }, { quoted: msg });
        return false;
    }
    if (msg.key.fromMe) return true; 
    
    const remitente = msg.key.participant;
    try {
        const groupMetadata = await sock.groupMetadata(chatId);
        const participante = groupMetadata.participants.find(p => p.id === remitente);
        if (participante && (participante.admin === 'admin' || participante.admin === 'superadmin')) {
            return true;
        }
    } catch (e) {}

    await sock.sendMessage(chatId, { text: `❌ Comando exclusivo para administradores del grupo.` }, { quoted: msg });
    return false;
}

// 🌐 EXTRACTOR LIMPIO DE SALVAR EL MUNDO
async function obtenerAlertasSTW() {
    let pavos = [];
    let legendarias = []; 

    // 1. Cargar manuales
    try {
        let manualPavos = await Config.findOne({ clave: 'stw_pavos_activos' });
        if (manualPavos && manualPavos.valor) pavos = pavos.concat(JSON.parse(manualPavos.valor));

        let manualLegendarias = await Config.findOne({ clave: 'stw_legendarias_activas' });
        if (manualLegendarias && manualLegendarias.valor) legendarias = legendarias.concat(JSON.parse(manualLegendarias.valor));
    } catch (e) {}

    // 2. Extractor Web Directo
    try {
        let respuesta = await fetch('https://freethevbucks.com/timed-missions/', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        
        let html = await respuesta.text();
        html = html.replace(/<(head|script|style|nav|footer|header|aside)[^>]*>[\s\S]*?<\/\1>/gi, '');
        html = html.replace(/alt="([^"]+)"/gi, ' $1 ').replace(/title="([^"]+)"/gi, ' $1 ');

        let textoPlano = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').toLowerCase();

        const regexPavos = /(25|30|35|40|50)([^0-9]{1,30}?)(\d{1,3})([^a-z]{1,20}?)([a-z0-9\s\-]+?)\s+in\s+(twine peaks|canny valley|plankerton|stonewood)/gi;
        
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

        let misionesGuardadas = new Set();

        // Extraer PaVos (Con tu lógica que sí funciona)
        let match;
        while ((match = regexPavos.exec(textoPlano)) !== null) {
            let cantidad = parseInt(match[1]);
            let pl = match[3];
            let misionCruda = match[5].trim();
            let zonaCruda = match[6].trim();

            let zonaEs = zonaCruda === 'twine peaks' ? 'Cumbres Leñosas' : zonaCruda === 'canny valley' ? 'Valle Latoso' : zonaCruda === 'plankerton' ? 'Valle Plácido' : 'Bosque Pedregoso';
            let misionEs = '';
            for (let m of misionesNombres) {
                if (misionCruda.includes(m.en)) { misionEs = m.es; break; }
            }

            if (!misionEs || parseInt(pl) > 160) continue;

            let idUnico = `pavo-${zonaEs}-${cantidad}-${pl}-${misionEs}`;
            if (!misionesGuardadas.has(idUnico)) {
                misionesGuardadas.add(idUnico);
                pavos.push({ zona: zonaEs, cantidad: cantidad, pl: pl, mision: misionEs, tipo: 'Automático' });
            }
        }

        // Extraer Legendarias y Épicas por bloques de texto limpio
        let filas = html.split(/<\/tr>|<\/li>|<\/div>/i);
        for (let fila of filas) {
            let txt = fila.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase();

            let rarezaMatch = txt.match(/\b(mythic|legendary|epic)\b/);
            if (!rarezaMatch) continue;

            let zonaMatch = txt.match(/\b(twine peaks|canny valley|plankerton|stonewood)\b/);
            if (!zonaMatch) continue;

            let misionEs = '';
            for (let m of misionesNombres) {
                if (txt.includes(m.en)) { misionEs = m.es; break; }
            }
            if (!misionEs) continue;

            let numeros = txt.match(/\b\d{1,3}\b/g) || [];
            let pl = '??';
            for (let num of numeros) {
                let n = parseInt(num);
                if (n > 0 && n <= 160) { pl = n.toString(); break; }
            }

            let zonaEs = zonaMatch[1] === 'twine peaks' ? 'Cumbres Leñosas' : zonaMatch[1] === 'canny valley' ? 'Valle Latoso' : zonaMatch[1] === 'plankerton' ? 'Valle Plácido' : 'Bosque Pedregoso';
            
            let colorEmoji = rarezaMatch[1] === 'mythic' ? '🟡 Mítico' : rarezaMatch[1] === 'legendary' ? '🟠 Legendario' : '🟣 Épico';
            
            // Limpieza y traducción rápida del ítem detectado
            let itemDesc = txt.includes('survivor') ? 'Sobreviviente' :
                           txt.includes('defender') ? 'Defensor' :
                           txt.includes('hero') ? 'Héroe' :
                           txt.includes('schematic') ? 'Esquema' :
                           txt.includes('perk-up') ? 'Perk-UP' : 'Recompensa';

            let recompensaFinal = `${colorEmoji} | ${itemDesc}`;

            let idUnico = `rec-${zonaEs}-${recompensaFinal}-${pl}-${misionEs}`;
            if (!misionesGuardadas.has(idUnico)) {
                misionesGuardadas.add(idUnico);
                legendarias.push({ zona: zonaEs, recompensa: recompensaFinal, pl: pl, mision: misionEs });
            }
        }
    } catch (e) {}

    return { pavos, legendarias };
}

// 📱 FORMATEADOR DE MENSAJE LIMPIO
async function alertasSTW(sock, chatId, msg, categoria = 'todas') {
    const datos = await obtenerAlertasSTW();
    const fechaHoy = obtenerFechaActual();
    let texto = `📅 _${fechaHoy}_\n\n`;

    let hayContenido = false;

    if (categoria === 'pavos' || categoria === 'todas') {
        if (datos.pavos.length > 0) {
            hayContenido = true;
            texto += `🔵 *ALERTAS DE PAVOS*\n`;
            let totalPavos = 0;
            datos.pavos.forEach(p => {
                totalPavos += p.cantidad;
                texto += `📍 *${p.zona}* | 🪙 ${p.cantidad} PaVos | ⚡ PL: ${p.pl} | 🎯 ${p.mision}\n`;
            });
            texto += `💰 *Total:* ${totalPavos} paVos\n\n`;
        }
    }

    if (categoria === 'legendarias' || categoria === 'todas' || categoria === 'importantes') {
        if (datos.legendarias.length > 0) {
            hayContenido = true;
            texto += `🌟 *RECOMPENSAS DESTACADAS*\n`;
            datos.legendarias.forEach(L => {
                texto += `📍 *${L.zona}* | 🎁 ${L.recompensa} | ⚡ PL: ${L.pl} | 🎯 ${L.mision}\n`;
            });
            texto += `\n`;
        }
    }

    if (!hayContenido) {
        texto += `_No hay misiones de PaVos ni recompensas destacadas registradas en este momento._\n\n`;
    }

    texto += `Support-a-Creator: *JASC13* ❤️`;
    await sock.sendMessage(chatId, { text: texto }, { quoted: msg });
}

// ⚙️ COMANDOS MANUALES Y CRON (Intocables)
async function comandoSetPavos(sock, chatId, msg, args) {
    if (!(await esAdminValido(sock, chatId, msg))) return;
    const partes = args.join(' ').split('|').map(p => p.trim());
    if (partes.length < 4) return await sock.sendMessage(chatId, { text: `❌ Uso: !setpavos Zona | Misión | Cantidad | PL` }, { quoted: msg });
    let actual = await Config.findOne({ clave: 'stw_pavos_activos' });
    let lista = actual ? JSON.parse(actual.valor) : [];
    lista.push({ zona: partes[0], mision: partes[1], cantidad: parseInt(partes[2]) || 30, pl: partes[3] || '??', tipo: 'Manual' });
    await Config.findOneAndUpdate({ clave: 'stw_pavos_activos' }, { valor: JSON.stringify(lista) }, { upsert: true });
    await sock.sendMessage(chatId, { text: `✅ PaVos manuales agregados.` }, { quoted: msg });
}

async function comandoSetLegendarias(sock, chatId, msg, args) {
    if (!(await esAdminValido(sock, chatId, msg))) return;
    const partes = args.join(' ').split('|').map(p => p.trim());
    if (partes.length < 4) return await sock.sendMessage(chatId, { text: `❌ Uso: !setlegendarias Zona | Misión | Recompensa | PL` }, { quoted: msg });
    let actual = await Config.findOne({ clave: 'stw_legendarias_activas' });
    let lista = actual ? JSON.parse(actual.valor) : [];
    lista.push({ zona: partes[0], mision: partes[1], recompensa: partes[2], pl: partes[3] || '??' });
    await Config.findOneAndUpdate({ clave: 'stw_legendarias_activas' }, { valor: JSON.stringify(lista) }, { upsert: true });
    await sock.sendMessage(chatId, { text: `✅ Recompensa manual agregada.` }, { quoted: msg });
}

async function comandoResetPavos(sock, chatId, msg) {
    if (!(await esAdminValido(sock, chatId, msg))) return;
    await Config.findOneAndDelete({ clave: 'stw_pavos_activos' });
    await Config.findOneAndDelete({ clave: 'stw_legendarias_activas' });
    await sock.sendMessage(chatId, { text: `🗑️ Alertas manuales restablecidas.` }, { quoted: msg });
}

async function comandoPreguntarAlerta(sock, chatId, msg) {
    await sock.sendMessage(chatId, { text: `🤖 Escribe *!pavos*, *!legendarias* o *!stw*.` }, { quoted: msg });
}

function iniciarCronAlertasDiarias(sock) {
    cron.schedule('5 18 * * *', async () => {
        try {
            const configChat = await Config.findOne({ clave: 'chat_alertas_diarias' });
            if (!configChat || !configChat.valor) return;
            const datos = await obtenerAlertasSTW();
            let total = datos.pavos.reduce((acc, p) => acc + p.cantidad, 0);

            let mensajeAuto = `🎮 *REPORTE DIARIO STW (6:05 PM)*\n\n`;
            if (datos.pavos.length > 0) {
                mensajeAuto += `🪙 *PaVos Totales:* ${total}\n`;
                datos.pavos.forEach(p => { mensajeAuto += `• ${p.zona} | ${p.cantidad} PaVos | PL ${p.pl} | ${p.mision}\n`; });
                mensajeAuto += `\n`;
            }
            if (datos.legendarias.length > 0) {
                mensajeAuto += `🌟 *Destacadas:*\n`;
                datos.legendarias.forEach(L => { mensajeAuto += `• ${L.zona} | ${L.recompensa} | PL ${L.pl} | ${L.mision}\n`; });
            }
            mensajeAuto += `\nSupport-a-Creator: *JASC13* ❤️`;
            await sock.sendMessage(configChat.valor, { text: mensajeAuto });
        } catch (error) {}
    }, { scheduled: true, timezone: "America/Mexico_City" });
}

async function activarAlertasDiarias(sock, chatId, msg) {
    if (!(await esAdminValido(sock, chatId, msg))) return;
    await Config.findOneAndUpdate({ clave: 'chat_alertas_diarias' }, { valor: chatId }, { upsert: true });
    await sock.sendMessage(chatId, { text: `✅ *Reportes diarios a las 6:05 PM activados en este grupo.*` }, { quoted: msg });
}

async function desactivarAlertasDiarias(sock, chatId, msg) {
    if (!(await esAdminValido(sock, chatId, msg))) return;
    await Config.findOneAndDelete({ clave: 'chat_alertas_diarias' });
    await sock.sendMessage(chatId, { text: `🔕 *Reportes diarios desactivados.*` }, { quoted: msg });
}

module.exports = { 
    obtenerAlertasSTW, alertasSTW, comandoPreguntarAlerta, 
    iniciarCronAlertasDiarias, activarAlertasDiarias, desactivarAlertasDiarias, 
    comandoSetPavos, comandoSetLegendarias, comandoResetPavos
};