const cron = require('node-cron');
const { Config } = require('../database/modelos');

function obtenerFechaActual() {
    const opciones = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    return new Date().toLocaleDateString('es-ES', opciones);
}

// 🔒 SEGURIDAD ADMIN
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

// 🌐 EXTRACTOR ADAPTADO A STW-PLANNER
async function obtenerAlertasSTW() {
    let pavos = [];
    let legendarias = []; 

    // 1. Cargar manuales de respaldo
    try {
        let manualPavos = await Config.findOne({ clave: 'stw_pavos_activos' });
        if (manualPavos && manualPavos.valor) pavos = pavos.concat(JSON.parse(manualPavos.valor));

        let manualLegendarias = await Config.findOne({ clave: 'stw_legendarias_activas' });
        if (manualLegendarias && manualLegendarias.valor) legendarias = legendarias.concat(JSON.parse(manualLegendarias.valor));
    } catch (e) {}

    // 2. Extraer de STW Planner
    try {
        let respuesta = await fetch('https://stw-planner.com/mission-alerts', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        
        let html = await respuesta.text();
        // Limpieza de etiquetas innecesarias
        let textoPlano = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').toLowerCase();

        // Detección específica basada en la maquetación limpia de STW Planner
        let misionesGuardadas = new Set();

        // Buscar bloques que contengan PaVos (ej: "50" junto a zonas o iconos)
        const regexPavosPlanner = /(\d{1,3})\s*(?:v-bucks|vbucks|pavos)/gi;
        
        // Como STW Planner agrupa por zonas en el texto, podemos buscar menciones de zonas y niveles de poder (PL)
        const zonas = ['stonewood', 'plankerton', 'canny valley', 'twine peaks'];
        
        // Procesamiento general de líneas o bloques de texto de misiones
        let bloques = html.split(/<\/div>|<\/section>/i);
        for (let bloque of bloques) {
            let txtLimpio = bloque.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase();
            
            // Detectar zona
            let zonaEncontrada = zonas.find(z => txtLimpio.includes(z));
            if (!zonaEncontrada) continue;

            let zonaEs = zonaEncontrada === 'twine peaks' ? 'Cumbres Leñosas' : 
                         zonaEncontrada === 'canny valley' ? 'Valle Latoso' : 
                         zonaEncontrada === 'plankerton' ? 'Valle Plácido' : 'Bosque Pedregoso';

            // Extraer PL (Nivel de poder)
            let plMatch = txtLimpio.match(/(?:pl|⚡)\s*(\d{1,3})/);
            let pl = plMatch ? plMatch[1] : '??';

            // Detección de PaVos en el bloque
            let pavoMatch = txtLimpio.match(/\b(25|30|35|40|50)\b/);
            if (pavoMatch && (txtLimpio.includes('v-buck') || txtLimpio.includes('vbuck') || txtLimpio.includes('pavo'))) {
                let cantidad = parseInt(pavoMatch[1]);
                let idUnico = `pavo-${zonaEs}-${cantidad}-${pl}`;
                if (!misionesGuardadas.has(idUnico) && cantidad <= 50) {
                    misionesGuardadas.add(idUnico);
                    pavos.push({ zona: zonaEs, cantidad: cantidad, pl: pl, mision: 'Misión con PaVos', tipo: 'Automático' });
                }
            }

            // Detección de Legendarias / Épicas (como se ve en tus capturas de defensores/sobrevivientes)
            if (txtLimpio.includes('legendary') || txtLimpio.includes('epic') || txtLimpio.includes('mythic')) {
                let rareza = txtLimpio.includes('mythic') ? '🟡 Mítico' : txtLimpio.includes('legendary') ? '🟠 Legendario' : '🟣 Épico';
                let item = txtLimpio.includes('survivor') ? 'Sobreviviente' :
                           txtLimpio.includes('defender') ? 'Defensor' :
                           txtLimpio.includes('hero') ? 'Héroe' :
                           txt.includes('schematic') ? 'Esquema' : 'Recompensa Destacada';

                let idUnico = `rec-${zonaEs}-${rareza}-${item}-${pl}`;
                if (!misionesGuardadas.has(idUnico)) {
                    misionesGuardadas.add(idUnico);
                    legendarias.push({ zona: zonaEs, recompensa: `${rareza} | ${item}`, pl: pl, mision: 'Misión Destacada' });
                }
            }
        }
    } catch (e) {
        console.error("Error al conectar con STW Planner:", e);
    }

    return { pavos, legendarias };
}

// 📱 FORMATO VISUAL EXACTO
async function alertasSTW(sock, chatId, msg, categoria = 'todas') {
    const datos = await obtenerAlertasSTW();
    const fechaHoy = obtenerFechaActual();
    let texto = `📅 _${fechaHoy}_\n\n`;

    if (categoria === 'pavos' || categoria === 'todas') {
        texto += `🎮 *ALERTAS DE PAVOS*\n`;
        if (datos.pavos.length === 0) {
            texto += `_No hay alertas de pavos registradas._\n\n`;
        } else {
            let totalPavos = 0;
            datos.pavos.forEach(p => {
                totalPavos += p.cantidad;
                texto += `📍 *${p.zona}*\n🪙 *PaVos:* ${p.cantidad}\n⚡ *PL:* ${p.pl}\n🎯 *Misión:* ${p.mision}\n\n`;
            });
            texto += `💰 *Total del día:* ${totalPavos} paVos\n\n`;
        }
    }

    if (categoria === 'legendarias' || categoria === 'todas' || categoria === 'importantes') {
        texto += `🌟 *ALERTAS ÉPICAS Y LEGENDARIAS*\n`;
        if (datos.legendarias.length === 0) {
            texto += `_No hay alertas legendarias registradas hoy._\n\n`;
        } else {
            datos.legendarias.forEach(L => {
                texto += `📍 *${L.zona}*\n🎁 *Da:* ${L.recompensa}\n⚡ *PL:* ${L.pl}\n\n`;
            });
        }
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
    await sock.sendMessage(chatId, { text: `🤖 Escribe *!pavos* o *!legendarias*.` }, { quoted: msg });
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
                datos.pavos.forEach(p => {
                    mensajeAuto += `📍 *${p.zona}* | 🪙 ${p.cantidad} PaVos | ⚡ PL: ${p.pl}\n`;
                });
                mensajeAuto += `\n💰 *Total del día:* ${total} paVos\n\n`;
            }
            if (datos.legendarias.length > 0) {
                mensajeAuto += `🌟 *ÉPICAS Y LEGENDARIAS*\n`;
                datos.legendarias.forEach(L => {
                    mensajeAuto += `📍 *${L.zona}* | 🎁 ${L.recompensa} | ⚡ PL: ${L.pl}\n`;
                });
            }
            mensajeAuto += `\nSupport-a-Creator: *JASC13* ❤️`;
            await sock.sendMessage(configChat.valor, { text: mensajeAuto });
        } catch (error) {}
    }, { scheduled: true, timezone: "America/Mexico_City" });
}

async function activarAlertasDiarias(sock, chatId, msg) {
    if (!(await esAdminValido(sock, chatId, msg))) return;
    await Config.findOneAndUpdate({ clave: 'chat_alertas_diarias' }, { valor: chatId }, { upsert: true });
    await sock.sendMessage(chatId, { text: `✅ *Grupo vinculado.* Reportes automáticos a las 6:05 PM configurados.` }, { quoted: msg });
}

async function desactivarAlertasDiarias(sock, chatId, msg) {
    if (!(await esAdminValido(sock, chatId, msg))) return;
    await Config.findOneAndDelete({ clave: 'chat_alertas_diarias' });
    await sock.sendMessage(chatId, { text: `🔕 *Alertas desactivadas en este grupo.*` }, { quoted: msg });
}

module.exports = { 
    obtenerAlertasSTW, alertasSTW, comandoPreguntarAlerta, 
    iniciarCronAlertasDiarias, activarAlertasDiarias, desactivarAlertasDiarias, 
    comandoSetPavos, comandoSetLegendarias, comandoResetPavos
};