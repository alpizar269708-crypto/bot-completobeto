const test = require('node:test');
const assert = require('node:assert/strict');
const { extraerDetalle } = require('../comandos/tiendagg');

const fichaCancion = [
  '<div class="modal-r">',
  '<div class="fn-detail-name">PROVENZA (REMIX)</div>',
  '<div class="fn-detail-type"><span>Uncommon</span> Jamtrack</div>',
  '<div class="fn-item-price"><img src="/img/vbucks.png" alt="V-Bucks"> 500</div>',
  '<div class="fn-detail-desc grey">Karol G ft. Tiësto | 2023 | 3:07</div>',
  '<div class="jam-bars">',
  '<div class="jam-bar"><div class="jam-bar-left">4</div><div class="jam-bar-right">Vocal<div><div class="jam-d" style="background:#fff"></div><div class="jam-d"></div></div></div></div>',
  '<div class="jam-bar"><div class="jam-bar-left">3</div><div class="jam-bar-right">Bass<div><div class="jam-d" style="background:#fff"></div><div class="jam-d"></div></div></div></div>',
  '<div class="jam-bar"><div class="jam-bar-left">4</div><div class="jam-bar-right">Pro Vocals<div><div class="jam-d" style="background:#fff"></div><div class="jam-d"></div></div></div></div>',
  '</div>',
  '<div class="fn-detail-details"><table class="fn-detail-table"><tbody>',
  '<tr><th scope="row">Source:</th><td>Shop</td></tr>',
  '<tr><th scope="row">Introduced in:</th><td>Chapter 5, Season 2</td></tr>',
  '<tr><th scope="row">Release date:</th><td>Aug 23, 2024</td></tr>',
  '<tr><th scope="row">Last seen:</th><td>Aug 31, 2026 (44 days ago)</td></tr>',
  '<tr class="fn-assets-header"><th scope="row">Occurrences:</th><td>295</td></tr>',
  '</tbody></table></div></div>'
].join('');

test('lee una ficha de canción sin extraer las barras de instrumentos', () => {
    const detalle = extraerDetalle(fichaCancion, {
        id: '14680',
        nombre: 'PROVENZA (REMIX)',
        url: 'https://fortnite.gg/cosmetics?id=14680',
        precio: '500',
        tipo: 'Canción'
    });

    assert.equal(detalle.nombre, 'PROVENZA (REMIX)');
    assert.equal(detalle.tipo, 'Canción');
    assert.equal(detalle.rareza, 'Poco común');
    assert.equal(detalle.precio, '500');
    assert.equal(detalle.descripcion, 'Karol G ft. Tiësto | 2023 | 3:07');
    assert.equal(detalle.fuente, 'Shop');
    assert.equal(detalle.temporada, 'Chapter 5, Season 2');
    assert.equal(detalle.lanzamiento, 'Aug 23, 2024');
    assert.equal(detalle.ultimaVez, 'Aug 31, 2026 (44 days ago)');
    assert.equal(detalle.apariciones, '295');

    const camposExtraidos = JSON.stringify(detalle);
    assert.doesNotMatch(camposExtraidos, /jam-bars|jam-bar-left|jam-bar-right|jam-d|Pro Vocals|Vocal|Bass|Lead|Drums/i);
});
