// Utilidades de WhatsApp.

// 1. EL FILTRO MAESTRO: Mata dominios, mata :0 y mata espacios
function extraerNumeroJid(jid) {
    return String(jid || '').split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
}

function normalizarNumeroVisible(valor) {
    const limpio = extraerNumeroJid(valor);
    if (!limpio) return 'Desconocido';
    if (limpio.startsWith('521') && limpio.length === 13) return '+52 ' + limpio.slice(3);
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

// 2. EL CONSTRUCTOR DE JID: Garantiza que TODO el bot use IDs puros
async function resolverJidUsuario(sock, valor) {
    if (!valor) return null;
    const entrada = String(valor).trim();
    
    if (entrada.endsWith('@lid')) {
        const pn = await resolverLidAPn(sock, entrada);
        return extraerNumeroJid(pn) + '@s.whatsapp.net';
    }

    const numero = extraerNumeroJid(entrada);
    if (!numero || numero.length < 6) return null;
    
    return numero + '@s.whatsapp.net';
}

async function resolverContactoWhatsApp(sock, valor, chatId = null) {
    let jid = await resolverJidUsuario(sock, valor);
    const numeroVisible = normalizarNumeroVisible(jid || valor);
    const numeroContacto = extraerNumeroJid(jid || valor);
    
    let nombre = null;
    const candidatos = [jid, valor, numeroContacto].filter(Boolean).map(String);

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
                const ids = [p?.id, p?.lid, p?.phoneNumber].map(extraerNumeroJid);
                return ids.includes(numeroContacto);
            });
            
            const nombreGrupo = participante?.notify || participante?.name || participante?.shortName;
            if (nombreGrupo) nombre = String(nombreGrupo).trim();
        } catch (error) {}
    }

    let numeroVerificado = true; 
    const etiquetaNumero = numeroContacto ? '@' + numeroContacto : '';
    return { jid, nombre: etiquetaNumero || nombre || null, username: nombre || null, numero: numeroContacto, numeroVisible, numeroVerificado };
}

function tokenMencionNativa(jid) {
    const numero = extraerNumeroJid(jid);
    return numero ? '@' + numero : '';
}

// 3. LA ETIQUETA VISUAL: Siempre retorna el @ limpio sin excepciones
function etiquetaContactoWhatsApp(contacto, jid) {
    const idCrudo = jid || (contacto && (contacto.jid || contacto.id)) || '';
    if (!idCrudo) return '@usuario';
    
    const numeroPuro = String(idCrudo).split('@')[0].split(':')[0];
    
    // Si el ID tiene más de 13 dígitos (es un LID de WhatsApp) y conocemos su nombre
    if (numeroPuro.length > 13 && contacto && contacto.username) {
        // Eliminamos los espacios para que luzca como un @nombre_de_usuario real
        const nombreTag = contacto.username.replace(/\s+/g, '');
        return '@' + nombreTag;
    }
    
    return '@' + numeroPuro;
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
