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

// Traducciones oficiales de zonas y misiones
const zonasMap = {
    'stonewood': 'Bosque Pedregoso',
    'plankerton': 'Valle Plácido',
    'canny valley': 'Valle Latoso',
    'twine peaks': 'Cumbres Leñosas'
};

const misionesMap = {
    'ride the lightning': 'Monta el relámpago',
    'fight the storm': 'Lucha contra la tormenta',
    'category 1 fight the storm': 'Tormenta cat. 1',
    'category 2 fight the storm': 'Tormenta cat. 2',
    'category 3 fight the storm': 'Tormenta cat. 3',
    'category 4 fight the storm': 'Tormenta cat. 4',
    'evacuate the shelter': 'Evacua el refugio',
    'repair the shelter': 'Repara el refugio',
    'deliver the bomb': 'Entrega el pedido',
    'retrieve the data': 'Recupera los datos',
    'rescue the survivors': 'Rescata supervivientes',
    'eliminate and collect': 'Elimina y recolecta',
    'resupply': 'Reabastecimiento'
};

// 🌐 EXTRACTOR VÍA API JSON (Robusto y sin depender de HTML)
async function obtenerAlertasSTW() {
    let pavos = [];
    let legendarias = []; 

    // 1. Cargar manuales (Respaldo prioritario)
    try {
        let manualPavos = await Config.findOne({ clave: 'stw_pavos_activos' });
        if (manualPavos && manualPavos.valor) pavos = pavos.concat(JSON.parse(manualPavos.valor));

        let manualLegendarias = await Config.findOne({ clave: 'stw_legendarias_activas' });
        if (manualLegendarias && manualLegendarias.valor) legendarias = legendarias.concat(JSON.parse(manualLegendarias.valor));
    } catch (e) {}

    // 2. Consulta a API Directa
    try {
        let respuesta = await fetch('https://fortnite-api.com/v1/stw', {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        
        if (respuesta.ok) {
            let json = await respuesta.json();
            if (json && json.data && json.data.missions) {
                json.data.missions.forEach(mission => {
                    let zonaIngles = (mission.theaterId || mission.zone?.name || '').toLowerCase();
                    let zonaEs = 'Cumbres Leñosas';
                    for (let [key, val] of Object.entries(zonasMap)) {
                        if (zonaIngles.includes(key)) { zonaEs = val; break; }
                    }

                    let misionIngles = (mission.name || mission.missionAlternativeName || '').toLowerCase();
                    let misionEs = 'Misión Activa';
                    for (let [key, val] of Object.entries(misionesMap)) {
                        if (misionIngles.includes(key)) { misionEs = val; break; }
                    }

                    let pl = mission.dangerLevel || mission.pl || '??';

                    // Analizar recompensas
                    if (mission.rewards) {
                        mission.rewards.forEach(reward => {
                            let itemNombre = (reward.item?.name || reward.name || '').toLowerCase();
                            let cantidad = reward.item?.quantity || reward.quantity || 0;
                            let rareza = (reward.item?.rarity || reward.rarity || '').toLowerCase();

                            // Detección de PaVos
                            if (itemNombre.includes('v-buck') || itemNombre.includes('vbuck') || itemNombre.includes('pavo')) {
                                if (cantidad > 0 && cantidad <= 50) {
                                    pavos.push({ zona: zonaEs, cantidad: cantidad, pl: pl, mision: misionEs, tipo: 'Automático' });
                                }
                            }

                            // Detección de Legendarias / Épicas / Míticas
                            if (rareza === 'legendary' || rareza === 'epic' || rareza === 'mythic') {
                                let colorEmoji = rareza === 'mythic' ? '🟡 Mítico' : rareza === 'legendary' ? '🟠 Legendario' : '🟣 Épico';
                                let tipoItem = itemNombre.includes('survivor') ? 'Sobreviviente' :
                                               itemNombre.includes('hero') ? 'Héroe' :
                                               itemNombre.includes('defender') ? 'Defensor' :
                                               itemNombre.includes('schematic') ? 'Esquema' : 'Recompensa';

                                legendarias.push({
                                    zona: zonaEs,
                                    recompensa: `${colorEmoji} | ${tipoItem}`,
                                    pl: pl,
                                    mision: misionEs
                                });
                            }
                        });
                    }
                });
            }
        }
    } catch (e) {
        console.error("Error conectando a la API de STW:", e);
    }

    return { pavos, legendarias };
}

// 📱 FORMATO VISUAL EXACTO QUE TE GUSTA
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
                texto += `📍 *${p.zona}*\n🪙 *PaVos:* ${p.cantidad}\n⚡ *PL:* ${p.pl}\n🎯 *Misión:* ${p.mision} ${p.tipo ? `_(${p.tipo})_` : ''}\n\n`;
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
                texto += `📍 *${L.zona}*\n🎁 *Da:* ${L.recompensa}\n⚡ *PL:* ${L.pl}\n🎯 *Misión:* ${L.mision}\n\n`;
            });
        }
    }

    if (categoria !== 'pavos' && categoria !== 'legendarias' && categoria !== 'todas' && categoria !== 'importantes') {
        texto = `🤖 *CONSULTAS DE SALVAR EL MUNDO*\n\nEscribe *!pavos* o *!legendarias* para ver las misiones activas.\n\n`;
    }

    texto += `Support-a-Creator: *JASC13* ❤️`;
    await sock.sendMessage(chatId, { text: texto }, { quoted: msg });
}

// ⚙️ COMANDOS MANUALES Y CRON
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