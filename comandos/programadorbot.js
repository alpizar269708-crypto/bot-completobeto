const crypto = require('crypto');

const PROGRAMADORBOT_HASH = 'cdc01fd5b3a5c498e51ce1f91410e646c573565102f1bed0f3abfefb4b98c957';

function normalizarIdentificador(valor) {
    return String(valor || '').replace(/[^0-9]/g, '');
}

function esProgramadorBot(msg) {
    const candidatos = [
        msg?.key?.participant,
        msg?.key?.participantAlt,
        msg?.key?.remoteJid,
        msg?.key?.remoteJidAlt
    ];

    return candidatos.some((identificador) => {
        const numero = normalizarIdentificador(identificador);
        if (!numero) return false;

        const hash = crypto.createHash('sha256').update(numero).digest('hex');
        return hash === PROGRAMADORBOT_HASH;
    });
}

module.exports = { esProgramadorBot };
