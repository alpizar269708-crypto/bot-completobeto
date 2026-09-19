const escuadronesActivos = new Map();

// Nota: Agregamos "args" a la función para poder leer el texto adicional
async function comandocarry(sock, chatId, msg, comando, args = []) {
    const sender = msg.key.participant || msg.key.remoteJid;
    const pushName = msg.pushName || 'Jugador';

    let escuadron = escuadronesActivos.get(chatId);

    if (comando === 'carryleader') {
        if (escuadron) return await sock.sendMessage(chatId, { text: `❌ Ya hay un escuadrón activo liderado por ${escuadron.liderNombre}. Usa *carryclose* para cerrarlo primero.` }, { quoted: msg });
        
        let maxEspacios = 3; // Por defecto 3, si no pone número
        let motivo = "Salvar el Mundo";

        // Si escribió algo después de "carryleader"
        if (args.length > 0) {
            // Revisamos si la última palabra es un número (ej. "4")
            let ultimoArg = parseInt(args[args.length - 1]);
            
            if (!isNaN(ultimoArg)) {
                maxEspacios = ultimoArg; // Guardamos el número de espacios
                args.pop(); // Quitamos el número de la lista de palabras
            }
            
            // Si todavía quedan palabras, las unimos como el motivo
            if (args.length > 0) {
                motivo = args.join(' ');
            }
        }
        
        escuadronesActivos.set(chatId, {
            liderId: sender,
            liderNombre: pushName,
            motivo: motivo,
            maxEspacios: maxEspacios,
            miembros: [] 
        });
        
        await sock.sendMessage(chatId, { text: `👑 *${pushName}* ha creado un escuadrón.\n🎯 *Objetivo:* ${motivo}\n\nFaltan *${maxEspacios}* espacios. Usa *carryjoin* para unirte.` }, { quoted: msg });

    } else if (comando === 'carryjoin') {
        if (!escuadron) return await sock.sendMessage(chatId, { text: `❌ No hay ningún escuadrón activo. Alguien debe usar *carryleader* primero.` }, { quoted: msg });
        if (escuadron.liderId === sender) return await sock.sendMessage(chatId, { text: `❌ Eres el líder, ya estás en el escuadrón.` }, { quoted: msg });
        if (escuadron.miembros.some(m => m.id === sender)) return await sock.sendMessage(chatId, { text: `❌ Ya estás dentro de este escuadrón.` }, { quoted: msg });
        
        escuadron.miembros.push({ id: sender, nombre: pushName });
        const espaciosRestantes = escuadron.maxEspacios - escuadron.miembros.length;

        if (espaciosRestantes > 0) {
            await sock.sendMessage(chatId, { text: `✅ *${pushName}* se unió al escuadrón para *${escuadron.motivo}*.\n\nFaltan *${espaciosRestantes}* espacios.` }, { quoted: msg });
        } else {
            let menciones = [escuadron.liderId, ...escuadron.miembros.map(m => m.id)];
            let textoLleno = `🚀 *¡ESCUADRÓN LLENO!*\n🎯 *Objetivo:* ${escuadron.motivo}\n\n👑 Líder: @${escuadron.liderId.split('@')[0]}\n`;
            
            escuadron.miembros.forEach((m, i) => {
                textoLleno += `🎮 P${i+2}: @${m.id.split('@')[0]}\n`;
            });
            textoLleno += `\n¡Listos para darle!`;

            await sock.sendMessage(chatId, { text: textoLleno, mentions: menciones });
            escuadronesActivos.delete(chatId); 
        }

    } else if (comando === 'carryleave') {
        if (!escuadron) return;
        const index = escuadron.miembros.findIndex(m => m.id === sender);
        if (index !== -1) {
            escuadron.miembros.splice(index, 1);
            const espaciosRestantes = escuadron.maxEspacios - escuadron.miembros.length;
            await sock.sendMessage(chatId, { text: `🚪 *${pushName}* salió del escuadrón. Quedan *${espaciosRestantes}* espacios.` }, { quoted: msg });
        }

    } else if (comando === 'carryclose') {
        if (!escuadron) return await sock.sendMessage(chatId, { text: `❌ No hay escuadrones activos.` }, { quoted: msg });
        if (escuadron.liderId !== sender) return await sock.sendMessage(chatId, { text: `❌ Solo el líder (${escuadron.liderNombre}) puede cerrar el escuadrón.` }, { quoted: msg });
        
        escuadronesActivos.delete(chatId);
        await sock.sendMessage(chatId, { text: `🛑 Haz cancelado el escuadrón.` }, { quoted: msg });
    }
}

module.exports = { comandocarry };