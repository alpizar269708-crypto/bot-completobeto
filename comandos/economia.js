const { User, EconomiaGrupo } = require('../database/modelos');
const { resolverContactoWhatsApp, resolverJidUsuario, etiquetaUsuario } = require('../utils/whatsapp');

async function obtenerEconomia(chatId, numero) {
    if (!chatId || !numero) throw new Error('Faltan chatId o numero para la economía.');
    let economia = await EconomiaGrupo.findOne({ chatId, numero });
    if (economia) return economia;

    // Migración única desde la antigua cartera global del usuario.
    const legado = await User.findOne({ numero }).select('cartera banco inventario ultimoDaily ultimoWeekly ultimoTrabajo').lean();
    const datosLegado = legado ? {
        cartera: Number(legado.cartera) || 0,
        banco: Number(legado.banco) || 0,
        inventario: Array.isArray(legado.inventario) ? legado.inventario : [],
        ultimoDaily: legado.ultimoDaily || null,
        ultimoWeekly: legado.ultimoWeekly || null,
        ultimoTrabajo: legado.ultimoTrabajo || null
    } : {};

    try {
        economia = await EconomiaGrupo.create({ chatId, numero, ...datosLegado });
    } catch (e) {
        if (e?.code === 11000) economia = await EconomiaGrupo.findOne({ chatId, numero });
        else throw e;
    }

    if (legado && (legado.cartera !== undefined || legado.banco !== undefined || legado.inventario !== undefined || legado.ultimoDaily || legado.ultimoWeekly || legado.ultimoTrabajo)) {
        await User.updateOne({ numero }, { $unset: { cartera: 1, banco: 1, inventario: 1, ultimoDaily: 1, ultimoWeekly: 1, ultimoTrabajo: 1 } });
    }
    return economia;
}


async function limpiarEconomiaAlSalir(chatId, participantes = []) {
    if (!chatId?.endsWith('@g.us') || !Array.isArray(participantes) || participantes.length === 0) return;
    const numeros = participantes.map(p => typeof p === 'string' ? p : p?.id).filter(Boolean);
    if (numeros.length === 0) return;

    const resultado = await EconomiaGrupo.deleteMany({ chatId, numero: { $in: numeros } });
    if (resultado.deletedCount > 0) {
        console.log(`🧹 Economía limpiada: ${resultado.deletedCount} registro(s) de integrantes que salieron de ${chatId}.`);
    }
}

async function obtenerObjetivo(sock, msg, args = []) {
    const citado = msg.message?.extendedTextMessage?.contextInfo;
    const mencionadoPorEtiqueta = citado?.mentionedJid?.[0];
    const mencionadoPorRespuesta = citado?.participant;
    
    if (mencionadoPorEtiqueta) return mencionadoPorEtiqueta;
    if (mencionadoPorRespuesta) return mencionadoPorRespuesta;

    if (args && args.length > 0) {
        const textoUnido = args.join('');
        const numeros = textoUnido.replace(/[^0-9]/g, '');
        if (numeros.length > 5) return await resolverJidUsuario(sock, numeros);
    }
    return null;
}

// 🪙 Cartera y Banco
async function comandoCartera(sock, chatId, msg, usuarioBD) {
    const cartera = usuarioBD.cartera || 0;
    const banco = usuarioBD.banco || 0;
    const total = cartera + banco;
    const remitente = msg.key.participant || chatId;

    const contacto = await resolverContactoWhatsApp(sock, remitente, chatId);
    let texto = `💰 *ESTADO FINANCIERO*\n\n` +
                `👤 Usuario: @${etiquetaUsuario(contacto)}\n` +
                `📱 Teléfono: *${contacto.numeroVisible}*\n` +
                `💵 En mano: *${cartera} monedas*\n` +
                `🏦 En banco: *${banco} monedas*\n` +
                `💎 Total neto: *${total} monedas*`;

    await sock.sendMessage(chatId, { text: texto, mentions: contacto.mentionJid ? [contacto.mentionJid] : [] }, { quoted: msg });
}

async function comandoBanco(sock, chatId, msg, args, usuarioBD) {
    const accion = args[0]?.toLowerCase();
    const cantidadStr = args[1];

    if (!['depositar', 'retirar', 'dep', 'ret'].includes(accion) || !cantidadStr) {
        await sock.sendMessage(chatId, { text: `⚠️ Uso correcto:\n• \`banco depositar [cantidad / todo]\`\n• \`banco retirar [cantidad / todo]\`` }, { quoted: msg });
        return;
    }

    let cantidad = 0;
    if (cantidadStr.toLowerCase() === 'todo' || cantidadStr.toLowerCase() === 'all') {
        cantidad = (accion.startsWith('dep')) ? (usuarioBD.cartera || 0) : (usuarioBD.banco || 0);
    } else {
        cantidad = parseInt(cantidadStr);
    }

    if (isNaN(cantidad) || cantidad <= 0) {
        await sock.sendMessage(chatId, { text: '❌ Cantidad inválida.' }, { quoted: msg });
        return;
    }

    if (accion.startsWith('dep')) {
        if ((usuarioBD.cartera || 0) < cantidad) {
            await sock.sendMessage(chatId, { text: '❌ No tienes suficiente dinero en la cartera.' }, { quoted: msg });
            return;
        }
        usuarioBD.cartera -= cantidad;
        usuarioBD.banco = (usuarioBD.banco || 0) + cantidad;
        await usuarioBD.save();
        await sock.sendMessage(chatId, { text: `🏦 Has depositado *${cantidad} monedas* al banco de forma segura.` }, { quoted: msg });
    } else {
        if ((usuarioBD.banco || 0) < cantidad) {
            await sock.sendMessage(chatId, { text: '❌ No tienes tanto dinero guardado en el banco.' }, { quoted: msg });
            return;
        }
        usuarioBD.banco -= cantidad;
        usuarioBD.cartera = (usuarioBD.cartera || 0) + cantidad;
        await usuarioBD.save();
        await sock.sendMessage(chatId, { text: `💵 Has retirado *${cantidad} monedas* del banco a tu cartera.` }, { quoted: msg });
    }
}

async function comandoPay(sock, chatId, msg, args, usuarioBD) {
    const objetivo = await obtenerObjetivo(sock, msg, args);
    const cantidad = parseInt(args[args.length - 1]);

    if (!objetivo || isNaN(cantidad) || cantidad <= 0) {
        await sock.sendMessage(chatId, { text: '⚠️ Uso correcto: `pay @usuario [cantidad]`' }, { quoted: msg });
        return;
    }

    if ((usuarioBD.cartera || 0) < cantidad) {
        await sock.sendMessage(chatId, { text: '❌ No tienes suficiente dinero en mano para transferir.' }, { quoted: msg });
        return;
    }

    let objetivoBD = await obtenerEconomia(chatId, objetivo);

    usuarioBD.cartera -= cantidad;
    objetivoBD.cartera = (objetivoBD.cartera || 0) + cantidad;

    await usuarioBD.save();
    await objetivoBD.save();

    const contactoObjetivo = await resolverContactoWhatsApp(sock, objetivo, chatId);
    await sock.sendMessage(chatId, { text: `✅ Has transferido exitosamente *${cantidad} monedas* a @${etiquetaUsuario(contactoObjetivo)} (📱 ${contactoObjetivo.numeroVisible}).`, mentions: contactoObjetivo.mentionJid ? [contactoObjetivo.mentionJid] : [] }, { quoted: msg });
}

async function comandoTop(sock, chatId, msg) {
    const topUsuarios = await EconomiaGrupo.find({ chatId }).sort({ cartera: -1, banco: -1 }).limit(10);
    if (!topUsuarios || topUsuarios.length === 0) {
        await sock.sendMessage(chatId, { text: '📋 Aún no hay registros en el ranking.' }, { quoted: msg });
        return;
    }

    let texto = `🏆 *TOP 10 - LOS MÁS RICOS*\n\n`;
    let mentions = [];

    for (const [index, u] of topUsuarios.entries()) {
        const total = (u.cartera || 0) + (u.banco || 0);
        const numero = u.numero;
        const contacto = await resolverContactoWhatsApp(sock, numero, chatId);
        texto += `*${index + 1}.* @${etiquetaUsuario(contacto)} · 📱 ${contacto.numeroVisible} — 💎 *${total}* mon.\n`;
        mentions.push(u.numero);
    }

    await sock.sendMessage(chatId, { text: texto, mentions }, { quoted: msg });
}

// 📅 Recompensas Diarias y Semanales
async function comandoDaily(sock, chatId, msg, usuarioBD) {
    const ahora = Date.now();
    const cooldown = 24 * 60 * 60 * 1000;
    if (usuarioBD.ultimoDaily && ahora - usuarioBD.ultimoDaily < cooldown) {
        const restante = Math.ceil((cooldown - (ahora - usuarioBD.ultimoDaily)) / (1000 * 60 * 60));
        await sock.sendMessage(chatId, { text: `⏳ Ya reclamaste tu daily. Vuelve en aprox. *${restante} horas*.` }, { quoted: msg });
        return;
    }
    const recompensa = 500;
    usuarioBD.cartera = (usuarioBD.cartera || 0) + recompensa;
    usuarioBD.ultimoDaily = ahora;
    await usuarioBD.save();
    await sock.sendMessage(chatId, { text: `🎁 ¡Recompensa diaria reclamada: *${recompensa} monedas*!` }, { quoted: msg });
}

async function comandoWeekly(sock, chatId, msg, usuarioBD) {
    const ahora = Date.now();
    const cooldown = 7 * 24 * 60 * 60 * 1000;
    if (usuarioBD.ultimoWeekly && ahora - usuarioBD.ultimoWeekly < cooldown) {
        await sock.sendMessage(chatId, { text: `⏳ Ya reclamaste tu recompensa semanal. Ten paciencia.` }, { quoted: msg });
        return;
    }
    const recompensa = 4000;
    usuarioBD.cartera = (usuarioBD.cartera || 0) + recompensa;
    usuarioBD.ultimoWeekly = ahora;
    await usuarioBD.save();
    await sock.sendMessage(chatId, { text: `💎 ¡Recompensa semanal entregada: *${recompensa} monedas*!` }, { quoted: msg });
}

// 🛠️ Farmeo y Trabajos
async function ejecutarFarmeo(sock, chatId, msg, usuarioBD, tipo) {
    const ahora = Date.now();
    const cooldown = 60 * 1000;
    if (usuarioBD.ultimoTrabajo && ahora - usuarioBD.ultimoTrabajo < cooldown) {
        const segundos = Math.ceil((cooldown - (ahora - usuarioBD.ultimoTrabajo)) / 1000);
        await sock.sendMessage(chatId, { text: `⏳ Estás cansado. Descansa *${segundos} segundos*.` }, { quoted: msg });
        return;
    }
    usuarioBD.ultimoTrabajo = ahora;
    let ganancia = 0;
    let texto = '';

    if (tipo === 'work') {
        ganancia = Math.floor(Math.random() * 150) + 50;
        usuarioBD.cartera = (usuarioBD.cartera || 0) + ganancia;
        texto = `💼 Trabajaste duro y ganaste *${ganancia} monedas*.`;
    } else if (tipo === 'crime') {
        if (Math.random() > 0.4) {
            ganancia = Math.floor(Math.random() * 400) + 100;
            usuarioBD.cartera = (usuarioBD.cartera || 0) + ganancia;
            texto = `🦹 ¡Robo exitoso! Botín de *${ganancia} monedas*.`;
        } else {
            ganancia = Math.floor(Math.random() * 200) + 50;
            usuarioBD.cartera = Math.max(0, (usuarioBD.cartera || 0) - ganancia);
            texto = `🚨 ¡Te atrapó la policía! Multa de *${ganancia} monedas*.`;
        }
    } else if (tipo === 'mendigar') {
        ganancia = Math.floor(Math.random() * 50) + 10;
        usuarioBD.cartera = (usuarioBD.cartera || 0) + ganancia;
        texto = `🤲 Te dieron caridad: *${ganancia} monedas*.`;
    } else {
        ganancia = Math.floor(Math.random() * 200) + 80;
        usuarioBD.cartera = (usuarioBD.cartera || 0) + ganancia;
        texto = `🌲 Fuiste a ${tipo} y recolectaste recursos por *${ganancia} monedas*.`;
    }
    await usuarioBD.save();
    await sock.sendMessage(chatId, { text: texto }, { quoted: msg });
}

// 🎰 Casino y Apuestas Avanzadas
async function comandoRuleta(sock, chatId, msg, args, usuarioBD) {
    const color = args[0]?.toLowerCase();
    const apuesta = parseInt(args[1]);
    if (!['rojo', 'negro', 'verde'].includes(color) || isNaN(apuesta) || apuesta <= 0 || (usuarioBD.cartera || 0) < apuesta) {
        await sock.sendMessage(chatId, { text: '⚠️ Uso correcto: `ruleta [rojo/negro/verde] [apuesta]`' }, { quoted: msg });
        return;
    }
    const opciones = ['rojo', 'rojo', 'rojo', 'negro', 'negro', 'negro', 'verde'];
    const resultado = opciones[Math.floor(Math.random() * opciones.length)];
    if (color === resultado) {
        const ganado = apuesta * (resultado === 'verde' ? 14 : 2);
        usuarioBD.cartera += (ganado - apuesta);
        await usuarioBD.save();
        await sock.sendMessage(chatId, { text: `🎰 Cayó en *${resultado.toUpperCase()}*. ¡Ganaste *${ganado} monedas*!` }, { quoted: msg });
    } else {
        usuarioBD.cartera -= apuesta;
        await usuarioBD.save();
        await sock.sendMessage(chatId, { text: `🎰 Cayó en *${resultado.toUpperCase()}*. Perdiste *${apuesta} monedas*.` }, { quoted: msg });
    }
}

async function comandoCf(sock, chatId, msg, args, usuarioBD) {
    const eleccion = args[0]?.toLowerCase();
    const apuesta = parseInt(args[1]);
    if (!['cara', 'cruz'].includes(eleccion) || isNaN(apuesta) || apuesta <= 0 || (usuarioBD.cartera || 0) < apuesta) {
        await sock.sendMessage(chatId, { text: '⚠️ Uso correcto: `cf [cara/cruz] [apuesta]`' }, { quoted: msg });
        return;
    }
    const resultado = Math.random() < 0.5 ? 'cara' : 'cruz';
    if (eleccion === resultado) {
        usuarioBD.cartera += apuesta;
        await usuarioBD.save();
        await sock.sendMessage(chatId, { text: `🪙 Salió *${resultado.toUpperCase()}*. ¡Ganaste *${apuesta * 2} monedas*!` }, { quoted: msg });
    } else {
        usuarioBD.cartera -= apuesta;
        await usuarioBD.save();
        await sock.sendMessage(chatId, { text: `🪙 Salió *${resultado.toUpperCase()}*. Perdiste *${apuesta} monedas*.` }, { quoted: msg });
    }
}

async function comandoSlots(sock, chatId, msg, args, usuarioBD) {
    const apuesta = parseInt(args[0]);
    if (isNaN(apuesta) || apuesta <= 0 || (usuarioBD.cartera || 0) < apuesta) {
        await sock.sendMessage(chatId, { text: '⚠️ Uso correcto: `slots [apuesta]`' }, { quoted: msg });
        return;
    }
    const s = ['🍒', '🍋', '🔔', '💎', '7️⃣'];
    const r1 = s[Math.floor(Math.random() * s.length)];
    const r2 = s[Math.floor(Math.random() * s.length)];
    const r3 = s[Math.floor(Math.random() * s.length)];
    let txt = `🎰 [ ${r1} | ${r2} | ${r3} ]\n\n`;
    if (r1 === r2 && r2 === r3) {
        const premio = apuesta * 5;
        usuarioBD.cartera += (premio - apuesta);
        txt += `🎉 ¡JACKPOT! Ganaste *${premio} monedas*.`;
    } else if (r1 === r2 || r2 === r3 || r1 === r3) {
        const premio = Math.floor(apuesta * 1.5);
        usuarioBD.cartera += (premio - apuesta);
        txt += `✨ ¡Dos iguales! Ganaste *${premio} monedas*.`;
    } else {
        usuarioBD.cartera -= apuesta;
        txt += `😢 Perdiste *${apuesta} monedas*.`;
    }
    await usuarioBD.save();
    await sock.sendMessage(chatId, { text: txt }, { quoted: msg });
}

async function comandoDados(sock, chatId, msg, args, usuarioBD) {
    const apuesta = parseInt(args[0]);
    if (isNaN(apuesta) || apuesta <= 0 || (usuarioBD.cartera || 0) < apuesta) {
        await sock.sendMessage(chatId, { text: '⚠️ Uso correcto: `dados [apuesta]`' }, { quoted: msg });
        return;
    }
    const userDado = Math.floor(Math.random() * 6) + 1;
    const botDado = Math.floor(Math.random() * 6) + 1;
    let txt = `🎲 Tiraste: *${userDado}* | Bot tiró: *${botDado}*\n\n`;
    if (userDado > botDado) {
        usuarioBD.cartera += apuesta;
        txt += `🎉 ¡Sacaste mayor número! Ganaste *${apuesta * 2} monedas*.`;
    } else if (userDado < botDado) {
        usuarioBD.cartera -= apuesta;
        txt += `😢 El bot sacó más. Perdiste *${apuesta} monedas*.`;
    } else {
        txt += `🤝 ¡Empate! Recuperas tu apuesta.`;
    }
    await usuarioBD.save();
    await sock.sendMessage(chatId, { text: txt }, { quoted: msg });
}

async function comandoAdivina(sock, chatId, msg, args, usuarioBD) {
    const num = parseInt(args[0]);
    const apuesta = parseInt(args[1]);
    if (isNaN(num) || num < 1 || num > 10 || isNaN(apuesta) || apuesta <= 0 || (usuarioBD.cartera || 0) < apuesta) {
        await sock.sendMessage(chatId, { text: '⚠️ Uso correcto: `adivina [1-10] [apuesta]`' }, { quoted: msg });
        return;
    }
    const secreto = Math.floor(Math.random() * 10) + 1;
    if (num === secreto) {
        const premio = apuesta * 5;
        usuarioBD.cartera += (premio - apuesta);
        await usuarioBD.save();
        await sock.sendMessage(chatId, { text: `🎯 ¡Adivinaste el número secreto (${secreto})! Ganaste *${premio} monedas* (x5).` }, { quoted: msg });
    } else {
        usuarioBD.cartera -= apuesta;
        await usuarioBD.save();
        await sock.sendMessage(chatId, { text: `❌ Fallaste. El número era el *${secreto}*. Perdiste *${apuesta} monedas*.` }, { quoted: msg });
    }
}

async function comandoBuscaminas(sock, chatId, msg, args, usuarioBD) {
    const apuesta = parseInt(args[0]);
    if (isNaN(apuesta) || apuesta <= 0 || (usuarioBD.cartera || 0) < apuesta) {
        await sock.sendMessage(chatId, { text: '⚠️ Uso correcto: `buscaminas [apuesta]`' }, { quoted: msg });
        return;
    }
    if (Math.random() < 0.45) {
        const premio = Math.floor(apuesta * 2);
        usuarioBD.cartera += (premio - apuesta);
        await usuarioBD.save();
        await sock.sendMessage(chatId, { text: `💣 Elegiste una casilla segura en el campo minado.\n🎉 ¡Ganaste *${premio} monedas*!` }, { quoted: msg });
    } else {
        usuarioBD.cartera -= apuesta;
        await usuarioBD.save();
        await sock.sendMessage(chatId, { text: `💥 ¡Pisaste una mina! Explotaste y perdiste *${apuesta} monedas*.` }, { quoted: msg });
    }
}

// ⚔️ Interacción PvP y Retos
async function comandoRob(sock, chatId, msg, args, usuarioBD) {
    const objetivo = await obtenerObjetivo(sock, msg, args);
    if (!objetivo || (usuarioBD.cartera || 0) < 100) {
        await sock.sendMessage(chatId, { text: '⚠️ Etiqueta a alguien. Necesitas al menos 100 monedas en mano para robar.' }, { quoted: msg });
        return;
    }
    let objetivoBD = await obtenerEconomia(chatId, objetivo);
    if (!objetivoBD || (objetivoBD.cartera || 0) < 50) {
        await sock.sendMessage(chatId, { text: '❌ El objetivo no tiene suficiente dinero en mano.' }, { quoted: msg });
        return;
    }
    if (Math.random() < 0.5) {
        const robado = Math.floor(Math.random() * (objetivoBD.cartera * 0.4)) + 20;
        objetivoBD.cartera -= robado;
        usuarioBD.cartera += robado;
        await objetivoBD.save();
        await usuarioBD.save();
        await sock.sendMessage(chatId, { text: `🦹 ¡Robo exitoso! Robaste *${robado} monedas* a @${etiquetaUsuario(await resolverContactoWhatsApp(sock, objetivo, chatId))}.`, mentions: [objetivo] }, { quoted: msg });
    } else {
        usuarioBD.cartera -= 100;
        await usuarioBD.save();
        await sock.sendMessage(chatId, { text: `🚨 ¡Te atraparon! Pagaste 100 monedas de multa.` }, { quoted: msg });
    }
}

async function comandoPpt(sock, chatId, msg, args, usuarioBD) {
    const eleccion = args[0]?.toLowerCase();
    const apuesta = parseInt(args[1]);
    if (!['piedra', 'papel', 'tijera'].includes(eleccion) || isNaN(apuesta) || apuesta <= 0 || (usuarioBD.cartera || 0) < apuesta) {
        await sock.sendMessage(chatId, { text: '⚠️ Uso correcto: `ppt [piedra/papel/tijera] [apuesta]`' }, { quoted: msg });
        return;
    }
    const opciones = ['piedra', 'papel', 'tijera'];
    const botJugada = opciones[Math.floor(Math.random() * opciones.length)];
    let txt = `✂️ Elegiste *${eleccion}* | El bot eligió *${botJugada}*\n\n`;
    if (eleccion === botJugada) {
        txt += `🤝 ¡Empate!`;
    } else if (
        (eleccion === 'piedra' && botJugada === 'tijera') ||
        (eleccion === 'papel' && botJugada === 'piedra') ||
        (eleccion === 'tijera' && botJugada === 'papel')
    ) {
        usuarioBD.cartera += apuesta;
        txt += `🎉 ¡Ganaste *${apuesta * 2} monedas*!`;
    } else {
        usuarioBD.cartera -= apuesta;
        txt += `😢 Perdiste *${apuesta} monedas*.`;
    }
    await usuarioBD.save();
    await sock.sendMessage(chatId, { text: txt }, { quoted: msg });
}

async function comandoPelea(sock, chatId, msg, args, usuarioBD) {
    const objetivo = await obtenerObjetivo(sock, msg, args);
    const apuesta = parseInt(args[args.length - 1]);
    if (!objetivo || isNaN(apuesta) || apuesta <= 0 || (usuarioBD.cartera || 0) < apuesta) {
        await sock.sendMessage(chatId, { text: '⚠️ Uso correcto: `pelea @usuario [apuesta]`' }, { quoted: msg });
        return;
    }
    let objetivoBD = await obtenerEconomia(chatId, objetivo);
    if (!objetivoBD || (objetivoBD.cartera || 0) < apuesta) {
        await sock.sendMessage(chatId, { text: '❌ El contrincante no tiene fondos suficientes para la pelea.' }, { quoted: msg });
        return;
    }
    const ganaUser = Math.random() < 0.5;
    if (ganaUser) {
        usuarioBD.cartera += apuesta;
        objetivoBD.cartera -= apuesta;
        await objetivoBD.save();
        await usuarioBD.save();
        await sock.sendMessage(chatId, { text: `⚔️ ¡Duelo épico! Derrotaste a @${etiquetaUsuario(await resolverContactoWhatsApp(sock, objetivo, chatId))} y ganaste *${apuesta * 2} monedas*.`, mentions: [objetivo] }, { quoted: msg });
    } else {
        usuarioBD.cartera -= apuesta;
        objetivoBD.cartera += apuesta;
        await objetivoBD.save();
        await usuarioBD.save();
        await sock.sendMessage(chatId, { text: `⚔️ ¡Duelo épico! @${etiquetaUsuario(await resolverContactoWhatsApp(sock, objetivo, chatId))} te dio una paliza y perdiste *${apuesta} monedas*.`, mentions: [objetivo] }, { quoted: msg });
    }
}

async function comandoCarrera(sock, chatId, msg, args, usuarioBD) {
    const apuesta = parseInt(args[0]);
    if (isNaN(apuesta) || apuesta <= 0 || (usuarioBD.cartera || 0) < apuesta) {
        await sock.sendMessage(chatId, { text: '⚠️ Uso correcto: `carrera [apuesta]`' }, { quoted: msg });
        return;
    }
    const corredores = ['🏎️ Rayo', '🏍️ MotoTurbo', '🚲 BiciPro', '🛹 SkaterX'];
    const ganador = corredores[Math.floor(Math.random() * corredores.length)];
    const eleccion = corredores[Math.floor(Math.random() * corredores.length)]; // Simulación rápida
    if (Math.random() < 0.3) {
        const premio = apuesta * 3;
        usuarioBD.cartera += (premio - apuesta);
        await usuarioBD.save();
        await sock.sendMessage(chatId, { text: `🏁 ¡La carrera la ganó *${ganador}*!\n🎉 ¡Acertaste y ganaste *${premio} monedas*!` }, { quoted: msg });
    } else {
        usuarioBD.cartera -= apuesta;
        await usuarioBD.save();
        await sock.sendMessage(chatId, { text: `🏁 Ganó *${ganador}*. Perdiste tu apuesta de *${apuesta} monedas*.` }, { quoted: msg });
    }
}

async function comandoHackear(sock, chatId, msg, args, usuarioBD) {
    const objetivo = await obtenerObjetivo(sock, msg, args);
    if (!objetivo || (usuarioBD.cartera || 0) < 300) {
        await sock.sendMessage(chatId, { text: '⚠️ Etiqueta a alguien. Hackear requiere gastar 300 monedas en herramientas.' }, { quoted: msg });
        return;
    }
    let objetivoBD = await obtenerEconomia(chatId, objetivo);
    if (!objetivoBD || (objetivoBD.banco || 0) < 200) {
        await sock.sendMessage(chatId, { text: '❌ El objetivo no tiene suficientes fondos en el banco para hackear.' }, { quoted: msg });
        return;
    }
    usuarioBD.cartera -= 300;
    if (Math.random() < 0.25) {
        const botin = Math.floor(objetivoBD.banco * 0.2);
        objetivoBD.banco -= botin;
        usuarioBD.banco = (usuarioBD.banco || 0) + botin;
        await objetivoBD.save();
        await usuarioBD.save();
        await sock.sendMessage(chatId, { text: `💻 ¡Hackeo exitoso! Robaste *${botin} monedas* del banco de @${etiquetaUsuario(await resolverContactoWhatsApp(sock, objetivo, chatId))}.`, mentions: [objetivo] }, { quoted: msg });
    } else {
        await usuarioBD.save();
        await sock.sendMessage(chatId, { text: `🛡️ ¡El cortafuegos del objetivo te detectó! Perdiste tus 300 monedas de inversión.` }, { quoted: msg });
    }
}

// 🛒 Tienda, Inventario e Intercambio de Objetos
async function comandoShop(sock, chatId, msg) {
    let txt = `🛒 *TIENDA DE OBJETOS*\n\n` +
              `1. *Escudo Anti-Robos* (1000 mon.) - Protege tu cartera\n` +
              `2. *Llave Maestra* (2500 mon.) - Objeto misterioso\n\n` +
              `💡 Usa \`buy 1\` o \`buy 2\` para comprar.`;
    await sock.sendMessage(chatId, { text: txt }, { quoted: msg });
}

async function comandoBuy(sock, chatId, msg, args, usuarioBD) {
    const itemNum = args[0];
    const items = {
        '1': { nombre: 'Escudo Anti-Robos', precio: 1000 },
        '2': { nombre: 'Llave Maestra', precio: 2500 }
    };
    if (!items[itemNum]) {
        await sock.sendMessage(chatId, { text: '⚠️ Objeto inválido. Revisa el catálogo con `shop`.' }, { quoted: msg });
        return;
    }
    const producto = items[itemNum];
    if ((usuarioBD.cartera || 0) < producto.precio) {
        await sock.sendMessage(chatId, { text: `❌ No tienes suficiente dinero. Cuesta ${producto.precio} monedas.` }, { quoted: msg });
        return;
    }
    usuarioBD.cartera -= producto.precio;
    if (!usuarioBD.inventario) usuarioBD.inventario = [];
    const existe = usuarioBD.inventario.find(i => i.nombre === producto.nombre);
    if (existe) existe.cantidad += 1;
    else usuarioBD.inventario.push({ nombre: producto.nombre, cantidad: 1 });
    usuarioBD.markModified('inventario');
    await usuarioBD.save();
    await sock.sendMessage(chatId, { text: `✅ ¡Has comprado con éxito: *${producto.nombre}*!` }, { quoted: msg });
}

async function comandoInventario(sock, chatId, msg, usuarioBD) {
    const inv = usuarioBD.inventario || [];
    let txt = `🎒 *INVENTARIO*\n\n`;
    if (inv.length === 0) txt += `_Tu mochila está vacía._`;
    else inv.forEach((i, idx) => { txt += `${idx + 1}. ${i.nombre} (x${i.cantidad})\n`; });
    await sock.sendMessage(chatId, { text: txt }, { quoted: msg });
}

async function comandoVender(sock, chatId, msg, args, usuarioBD) {
    const nombreItem = args.join(' ').toLowerCase();
    const inv = usuarioBD.inventario || [];
    const index = inv.findIndex(i => i.nombre.toLowerCase().includes(nombreItem));
    if (!nombreItem || index === -1) {
        await sock.sendMessage(chatId, { text: '⚠️ No tienes ese objeto en tu inventario.' }, { quoted: msg });
        return;
    }
    const item = inv[index];
    const valorVenta = 500;
    usuarioBD.cartera += valorVenta;
    item.cantidad -= 1;
    if (item.cantidad <= 0) inv.splice(index, 1);
    usuarioBD.markModified('inventario');
    await usuarioBD.save();
    await sock.sendMessage(chatId, { text: `💰 Vendiste *${item.nombre}* por *${valorVenta} monedas*.` }, { quoted: msg });
}

async function comandoUse(sock, chatId, msg, args, usuarioBD) {
    const nombreItem = args.join(' ').toLowerCase();
    const inv = usuarioBD.inventario || [];
    const item = inv.find(i => i.nombre.toLowerCase().includes(nombreItem));
    if (!item || item.cantidad <= 0) {
        await sock.sendMessage(chatId, { text: '⚠️ No posees ese objeto.' }, { quoted: msg });
        return;
    }
    await sock.sendMessage(chatId, { text: `✨ Has activado / usado con éxito: *${item.nombre}*.` }, { quoted: msg });
}

async function comandoRegalarItem(sock, chatId, msg, args, usuarioBD) {
    const objetivo = await obtenerObjetivo(sock, msg, args);
    const nombreItem = args.slice(1).join(' ').toLowerCase();
    if (!objetivo || !nombreItem) {
        await sock.sendMessage(chatId, { text: '⚠️ Uso correcto: `regalar [objeto] @usuario`' }, { quoted: msg });
        return;
    }
    const inv = usuarioBD.inventario || [];
    const index = inv.findIndex(i => i.nombre.toLowerCase().includes(nombreItem));
    if (index === -1) {
        await sock.sendMessage(chatId, { text: '❌ No tienes ese objeto en tu inventario.' }, { quoted: msg });
        return;
    }
    let objetivoBD = await obtenerEconomia(chatId, objetivo);
    if (!objetivoBD.inventario) objetivoBD.inventario = [];

    const itemRemovido = inv[index];
    itemRemovido.cantidad -= 1;
    if (itemRemovido.cantidad <= 0) inv.splice(index, 1);
    
    const existeObj = objetivoBD.inventario.find(i => i.nombre === itemRemovido.nombre);
    if (existeObj) existeObj.cantidad += 1;
    else objetivoBD.inventario.push({ nombre: itemRemovido.nombre, cantidad: 1 });

    usuarioBD.markModified('inventario');
    objetivoBD.markModified('inventario');
    await usuarioBD.save();
    await objetivoBD.save();

    await sock.sendMessage(chatId, { text: `🎁 Le regalaste *${itemRemovido.nombre}* a @${etiquetaUsuario(await resolverContactoWhatsApp(sock, objetivo, chatId))}.`, mentions: [objetivo] }, { quoted: msg });
}

module.exports = {
    comandoCartera, comandoBanco, comandoPay, comandoTop, comandoDaily, comandoWeekly,
    ejecutarFarmeo, comandoRuleta, comandoCf, comandoSlots, comandoDados, comandoAdivina,
    comandoBuscaminas, comandoRob, comandoPpt, comandoPelea, comandoCarrera, comandoHackear,
    comandoShop, comandoBuy, comandoInventario, comandoVender, comandoUse, comandoRegalarItem,
    obtenerEconomia, limpiarEconomiaAlSalir
};