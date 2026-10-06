function comandoTiendaVb(sock, chatId, msg, argsOriginales = []) {
    const texto = Array.isArray(argsOriginales) ? argsOriginales.join(' ') : String(argsOriginales || '');
    const limpio = texto.replace(/\s+/g, '').replace(/,/g, '').replace(/\$/g, '');

    if (!/^\d+(?:\.\d+)?$/.test(limpio)) {
        return sock.sendMessage(chatId, {
            text: '❌ Indica la cantidad de paVos.\n\nEjemplo: *tiendaVb 1,500*'
        }, { quoted: msg });
    }

    const pavos = Number(limpio);
    if (!Number.isFinite(pavos) || pavos <= 0) {
        return sock.sendMessage(chatId, {
            text: '❌ La cantidad de paVos debe ser mayor a 0.'
        }, { quoted: msg });
    }

    const mxn = pavos * 0.09;
    const usd = pavos * 0.006;

    const formatearPavos = Number.isInteger(pavos)
        ? pavos.toLocaleString('en-US')
        : pavos.toLocaleString('en-US', { maximumFractionDigits: 2 });

    const formatearDinero = (cantidad, moneda) => {
        const decimales = moneda === 'USD' ? 2 : 2;
        return cantidad.toLocaleString('en-US', {
            minimumFractionDigits: decimales,
            maximumFractionDigits: decimales
        });
    };

    const respuesta = [
        '🛍️ *CONVERSOR DE paVOS*',
        '',
        `🎮 *${formatearPavos} paVos*`,
        '',
        `🇲🇽 *$${formatearDinero(mxn, 'MXN')} MXN*`,
        `🇺🇸 *$${formatearDinero(usd, 'USD')} USD*`,
        '',
        'Apoya a un creador: *JASC13*'
    ].join('\n');

    return sock.sendMessage(chatId, { text: respuesta }, { quoted: msg });
}

module.exports = { comandoTiendaVb };
