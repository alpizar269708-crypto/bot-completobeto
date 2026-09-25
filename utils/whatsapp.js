// Utilidades centralizadas para identificar, mencionar y mostrar usuarios de WhatsApp.
// IMPORTANTE: el JID real se conserva para que Baileys pueda crear menciones clicables.

function extraerNumeroJid(jid) {
    return String(jid || '').split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
}

function normalizarNumeroVisible(valor) {
    const limpio = extraerNumeroJid(valor) || String(valor || '').replace(/[^0-9]/g, '');
    if (!limpio) return 'Desconocido';

    // México: WhatsApp puede conservar 521 + 10 dígitos en el JID histórico,
    // pero para mostrar el número internacional actual usamos +52 + 10 dígitos.
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
    } catch (error) {
        console.error('⚠️ No se pudo resolver LID a teléfono:', error.message);
    }
    return jid;
}

async function resolverJidUsuario(sock, valor) {
    if (!valor) return null;
    let entrada = String(valor).trim();
    if (entrada.includes('@')) return await resolverLidAPn(sock, entrada);

    let numero = entrada.replace(/[^0-9]/g, '');
    if (numero.startsWith('00')) numero = numero.slice(2);
    if (!numero || numero.length < 6) return null;

    // Primero dejamos que WhatsApp resuelva el número. Esto evita inventar JIDs
    // y además encuentra la variante 521/52 de números mexicanos cuando existe.
    if (typeof sock?.onWhatsApp === 'function') {
        const candidatos = [numero];
        if (numero.startsWith('52') && numero.length === 12) candidatos.push('521' + numero.slice(2));
        if (numero.startsWith('521') && numero.length === 13) candidatos.push('52' + numero.slice(3));
        for (const candidato of [...new Set(candidatos)]) {
            try {
                const resultados = await sock.onWhatsApp(candidato);
                const encontrado = Array.isArray(resultados) ? resultados.find(x => x?.exists && x?.jid) : null;
                if (encontrado?.jid) return await resolverLidAPn(sock, encontrado.jid);
            } catch (error) {}
        }
    }

    // Fallback: conserva la representación recibida, sin asumir país alguno.
    return numero + '@s.whatsapp.net';
}

async function resolverContactoWhatsApp(sock, valor) {
    const mentionJid = await resolverJidUsuario(sock, valor);
    const numeroVisible = normalizarNumeroVisible(mentionJid || valor);
    const mentionNumber = extraerNumeroJid(mentionJid);
    return { mentionJid, mentionNumber, numeroVisible };
}

function textoMencion(mentionJid, fallback = 'Usuario') {
    const numero = extraerNumeroJid(mentionJid);
    return numero ? '@' + numero : fallback;
}

module.exports = {
    extraerNumeroJid,
    normalizarNumeroVisible,
    resolverLidAPn,
    resolverJidUsuario,
    resolverContactoWhatsApp,
    textoMencion
};
