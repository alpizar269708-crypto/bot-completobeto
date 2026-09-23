const crypto = require('crypto');

const PROGRAMADORBOT_HASH = 'cdc01fd5b3a5c498e51ce1f91410e646c573565102f1bed0f3abfefb4b98c957';

function normalizarIdentificador(valor) {
    let numero = String(valor || '').replace(/[^0-9]/g, '');
    if (!numero) return '';

    // WhatsApp/Baileys puede entregar números mexicanos móviles con el prefijo 521,
    // mientras que el número configurado puede venir como 52 + 10 dígitos.
    if (numero.startsWith('521') && numero.length === 13) {
        numero = '52' + numero.slice(3);
    }

    // Acepta también el formato internacional con 00.
    if (numero.startsWith('00')) {
        numero = numero.slice(2);
    }

    return numero;
}

function esProgramadorBot(msg) {
    const candidatos = [
        msg?.key?.participant,
        msg?.key?.participantAlt,
        msg?.key?.participantPn,
        msg?.key?.senderPn,
        msg?.key?.senderLid,
        msg?.key?.remoteJid,
        msg?.key?.remoteJidAlt,
        msg?.key?.remoteJidPn
    ];

    return candidatos.some((identificador) => {
        const numero = normalizarIdentificador(identificador);
        if (!numero) return false;

        const hash = crypto.createHash('sha256').update(numero).digest('hex');
        return hash === PROGRAMADORBOT_HASH;
    });
}

module.exports = { esProgramadorBot };
