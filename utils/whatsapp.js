// Utilidades de WhatsApp.
// Las menciones nativas se aplican de forma uniforme cuando un comando identifica a un usuario.

function extraerNumeroJid(jid) {
    return String(jid || '').split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
}

function normalizarNumeroVisible(valor) {
    const limpio = extraerNumeroJid(valor) || String(valor || '').replace(/[^0-9]/g, '');
    if (!limpio) return 'Desconocido';
    if (limpio.startsWith('521') && limpio.length === 13) return '+52' + limpio.slice(3);
    if (limpio.startsWith('00')) return '+' + limpio.slice(2);
    return '+' + limpio;
}

async function resolverLidAPn(sock, jid) {
    if (!jid || !String(jid).endsWith('@lid')) return jid;
    try {
        const mapping = sock?.signalRepository?.lidMapping;
        if (mapping?.getPNForLID) {
            const pn = await mapping.getPNForLID(jid);
            if (pn) return pn;
        }
    } catch (error) {}
    return jid;
}

async function resolverJidUsuario(sock, valor) {
    if (!valor) return null;
    const entrada = String(valor).trim();
    if (entrada.includes('@')) {
        const jidEntrada = entrada;
        // WhatsApp puede entregar participantes/menciones como @lid.
        // Para una mención nativa estable usamos siempre el JID PN base.
        if (jidEntrada.endsWith('@lid')) return await resolverLidAPn(sock, jidEntrada);
        if (jidEntrada.endsWith('@s.whatsapp.net')) {
            return extraerNumeroJid(jidEntrada) + '@s.whatsapp.net';
        }
        return jidEntrada;
    }

    let numero = entrada.replace(/[^0-9]/g, '');
    if (numero.startsWith('00')) numero = numero.slice(2);
    if (!numero || numero.length < 6) return null;

    if (typeof sock?.onWhatsApp === 'function') {
        const candidatos = [numero];
        if (numero.startsWith('52') && numero.length === 12) candidatos.push('521' + numero.slice(2));
        if (numero.startsWith('521') && numero.length === 13) candidatos.push('52' + numero.slice(3));
        for (const candidato of [...new Set(candidatos)]) {
            try {
                const resultados = await sock.onWhatsApp(candidato);
                const encontrado = Array.isArray(resultados)
                    ? resultados.find(x => x?.exists && x?.jid)
                    : null;
                if (encontrado?.jid) return encontrado.jid;
            } catch (error) {}
        }
    }
    return numero + '@s.whatsapp.net';
}

async function resolverContactoWhatsApp(sock, valor, chatId = null) {
    let jid = await resolverJidUsuario(sock, valor);

    const numeroVisible = normalizarNumeroVisible(jid || valor);
    const candidatos = [jid, valor].filter(Boolean).map(String);
    let nombre = null;

    const pushCache = sock?.jasc13PushNameCache;
    if (pushCache?.get) {
        for (const candidato of candidatos) {
            const encontrado = pushCache.get(candidato);
            if (encontrado) {
                nombre = String(encontrado).trim();
                if (nombre) break;
            }
        }
    }

    const usernameCache = sock?.jasc13UsernameCache;
    if (!nombre && usernameCache?.get) {
        for (const candidato of candidatos) {
            const encontrado = usernameCache.get(candidato);
            if (encontrado) {
                nombre = String(encontrado).replace(/^@/, '').trim();
                if (nombre) break;
            }
        }
    }

    if (!nombre && chatId?.endsWith('@g.us') && typeof sock?.groupMetadata === 'function') {
        try {
            const metadata = await sock.groupMetadata(chatId);
            const participante = (metadata?.participants || []).find(p => {
                const ids = [p?.id, p?.lid, p?.phoneNumber].filter(Boolean).map(String);
                return ids.includes(String(jid)) || ids.includes(String(valor));
            });

            // Si recibimos un @lid y el grupo conoce su equivalente PN,
            // usamos el PN real para que la etiqueta y mentions[] coincidan.
            const participantePn = participante?.phoneNumber || (
                String(participante?.id || '').endsWith('@s.whatsapp.net')
                    ? participante.id
                    : null
            );
            if (participantePn) jid = await resolverJidUsuario(sock, participantePn);

            const nombreGrupo = participante?.notify || participante?.name || participante?.shortName;
            if (nombreGrupo) nombre = String(nombreGrupo).trim();
        } catch (error) {}
    }

    // Cuando un comando trabaja con una persona, usamos el mismo formato nativo
    // que WhatsApp reconoce como mención: @ + número y mentions[] con el JID.
    return { jid, nombre: tokenMencionNativa(jid) || nombre || null, numero: extraerNumeroJid(jid), numeroVisible };
}

// Para una mención nativa, el texto debe contener @ + identificador numérico
// y mentions[] debe contener exactamente el mismo JID.
function tokenMencionNativa(jid) {
    const numero = extraerNumeroJid(jid);
    return numero ? '@' + numero : '';
}

// Etiqueta uniforme: primero intenta el número de WhatsApp.
// Si no existe un JID telefónico usable, usa el nombre/usuario reservado.
function etiquetaContactoWhatsApp(contacto, jidFallback = null) {
    const jid = contacto?.jid || jidFallback;
    const numero = extraerNumeroJid(jid);
    if (String(jid || '').endsWith('@s.whatsapp.net') && numero) return '@' + numero;

    const nombre = String(contacto?.nombre || contacto?.username || '').replace(/^@/, '').trim();
    return nombre ? '@' + nombre : (numero ? '@' + numero : 'Usuario');
}

module.exports = {
    extraerNumeroJid,
    normalizarNumeroVisible,
    resolverLidAPn,
    resolverJidUsuario,
    resolverContactoWhatsApp,
    tokenMencionNativa,
    etiquetaContactoWhatsApp
};
