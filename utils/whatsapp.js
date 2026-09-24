// Utilidades de WhatsApp.
// Las menciones nativas se usan únicamente en comandos que muestran rifas o listas.

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
    if (entrada.includes('@')) return entrada;

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
    const jid = String(valor || '').includes('@')
        ? String(valor).trim()
        : await resolverJidUsuario(sock, valor);

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
            const nombreGrupo = participante?.notify || participante?.name || participante?.shortName;
            if (nombreGrupo) nombre = String(nombreGrupo).trim();
        } catch (error) {}
    }

    return { jid, nombre: tokenMencionNativa(jid) || nombre || null, numero: extraerNumeroJid(jid), numeroVisible };
}

// Para una mención nativa, el texto debe contener @ + identificador numérico
// y mentions[] debe contener exactamente el mismo JID.
function tokenMencionNativa(jid) {
    const numero = extraerNumeroJid(jid);
    return numero ? '@' + numero : '';
}

// Fuerza que cualquier texto que contenga tokens @123... enviados por el bot
// se convierta en una mención nativa de WhatsApp, usando el mismo JID.
function asegurarMencionesNativas(sock) {
    if (!sock || sock.__mencionesNativasInstaladas) return sock;
    const enviarOriginal = sock.sendMessage.bind(sock);
    sock.sendMessage = async (chatId, contenido, opciones) => {
        if (contenido && typeof contenido === 'object' && typeof contenido.text === 'string') {
            const encontrados = contenido.text.match(/@\d{6,16}/g) || [];
            const jids = encontrados.map(x => x.slice(1) + '@s.whatsapp.net');
            if (jids.length > 0) {
                contenido = { ...contenido, mentions: [...new Set([...(contenido.mentions || []), ...jids])] };
            }
        }
        return enviarOriginal(chatId, contenido, opciones);
    };
    sock.__mencionesNativasInstaladas = true;
    return sock;
}

module.exports = {
    extraerNumeroJid,
    normalizarNumeroVisible,
    resolverLidAPn,
    resolverJidUsuario,
    resolverContactoWhatsApp,
    tokenMencionNativa,
    asegurarMencionesNativas
};
