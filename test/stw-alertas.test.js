const test = require('node:test');
const assert = require('node:assert/strict');
const {
    parsearTablaSeeBotSTW,
    seleccionarAlertasSTWPorRareza,
    parsearVBucksDailySTW,
    parsearJSONSeeBotSTW
} = require('../webBridge');

const seeBotHTML = `
    <table id="miniRwdTbl">
      <tr id="miniRwdTbl-headRow" class="missionRow">
        <th>Zone</th><th>PL</th><th>Icon</th><th>Modifiers</th><th>Reward</th><th>Quest Req(s)</th>
      </tr>
      <tr class="missionRow">
        <td class="missionZone">Hexsylvania Venture Zone</td>
        <td class="missionPl">124</td>
        <td class="missionName"><img src="https://seebot.dev/images/missions/Trap the Storm.png" title="Trap the Storm" alt="Trap the Storm"></td>
        <td class="missionModifiers">
          <img src="https://seebot.dev/images/gameplaymodifiers/Short Range_sm.png" title="Short Range:
Enemies close to a player or defender suffer more damage.">
          <img src="https://seebot.dev/images/gameplaymodifiers/Smoke Screens_sm.png" title="Smoke Screens:
Enemies have a chance to create a smoke screen.">
          <img src="https://seebot.dev/images/gameplaymodifiers/Healing Deathburst_sm.png" title="Healing Deathburst:
Enemies heal nearby enemies when they die.">
          <img src="https://seebot.dev/images/gameplaymodifiers/Fire Storm_sm.png" title="Fire Storm:
Changes all elemental enemies to fire.">
          <img src="https://seebot.dev/images/gameplaymodifiers/Acid Pools_sm.png" title="Acid Pools:
Enemies leave damaging pools when they die.">
        </td>
        <td class="missionAlerts">
          <span class="epic"><img src="https://seebot.dev/images/heroes/Deadly Blade Crash_sm.png" title="Deadly Blade Crash (Epic)" alt="Deadly Blade Crash (Epic)"> Deadly Blade Crash (Epic), </span>
          <span class="black"><img src="https://seebot.dev/images/rewards/V-Bucks or X-Ray_sm.png" title="V-Bucks or X-Ray" alt="V-Bucks or X-Ray"> V-Bucks or X-Ray x50</span>
        </td>
        <td class="missionQuestReqs">None</td>
      </tr>
      <tr class="missionRow">
        <td class="missionZone">Canny Valley</td>
        <td class="missionPl">64</td>
        <td class="missionName"><img src="https://seebot.dev/images/missions/Resupply.png" title="Resupply" alt="Resupply"></td>
        <td class="missionModifiers">
          <img src="https://seebot.dev/images/gameplaymodifiers/Powerful Pistols_sm.png" title="Powerful Pistols:
Pistols do more damage.">
          <img src="https://seebot.dev/images/gameplaymodifiers/Smoke Screens_sm.png" title="Smoke Screens:
Enemies create a smoke screen when they die.">
        </td>
        <td class="missionAlerts">
          <span class="legendary"><img src="https://seebot.dev/images/workers/Training Team Lead Survivor_sm.png" title="Training Team Lead Survivor (Legendary)" alt="Training Team Lead Survivor (Legendary)"> Training Team Lead Survivor (Legendary), </span>
        </td>
        <td class="missionQuestReqs">None</td>
      </tr>
    </table>`;

test('SeeBot extrae zona, PL, misión, modificadores, recompensa épica y requisitos', () => {
    const misiones = parsearTablaSeeBotSTW(seeBotHTML);
    const mision = misiones.find(m => m.misionOriginal === 'Trap the Storm');
    assert.ok(mision, 'debe extraer Trap the Storm');
    assert.equal(mision.zona, 'Hexsylvania Venture Zone');
    assert.equal(mision.pl, 124);
    assert.ok(mision.modificadores.length >= 5);
    assert.ok(mision.modificadores.some(x => /alcance corto/i.test(x)));
    assert.equal(mision.questReqs, 'None');
    const recompensa = mision.recompensas.find(r => r.raw === 'Deadly Blade Crash');
    assert.ok(recompensa, 'debe conservar Deadly Blade Crash como recompensa');
    assert.equal(recompensa.tipo, 'hero');
    assert.equal(recompensa.rareza, 'epic');
});

test('los comandos por rareza conservan PaVos de la misma misión', () => {
    const mision = parsearTablaSeeBotSTW(seeBotHTML).find(m => m.misionOriginal === 'Trap the Storm');
    assert.ok(mision.recompensas.some(r => r.tipo === 'vbucks' && r.cantidad === 50));
    const alertaEpica = seleccionarAlertasSTWPorRareza([mision], 'epic')[0];
    assert.ok(alertaEpica, 'la misión debe aparecer en épicas');
    assert.ok(alertaEpica.recompensas.some(r => r.tipo === 'hero' && r.rareza === 'epic'));
    assert.ok(alertaEpica.recompensas.some(r => r.tipo === 'vbucks' && r.cantidad === 50));
    assert.match(alertaEpica.recompensa, /PaVos/);
});

test('SeeBot clasifica recompensas legendarias por su clase e icono', () => {
    const misiones = parsearTablaSeeBotSTW(seeBotHTML);
    const mision = misiones.find(m => m.misionOriginal === 'Resupply');
    assert.ok(mision);
    assert.equal(mision.pl, 64);
    assert.equal(mision.zona, 'Canny Valley');
    assert.ok(mision.recompensas.some(r =>
        r.tipo === 'survivor' && r.rareza === 'legendary' &&
        /Training Team Lead Survivor/i.test(r.raw) &&
        /Líder del equipo de entrenamiento/i.test(r.nombre)
    ));
    assert.ok(seleccionarAlertasSTWPorRareza(misiones, 'legendary').some(m =>
        m.misionOriginal === 'Resupply'
    ));
});

test('V-Bucks Daily acepta el formato de recompensa ×50', () => {
    const html = `
      <div class="mission-row">
        <div class="pl">124</div>
        <div class="mission-name"><strong>Trap the Storm</strong><small>Twine Peaks · Thunder Route 99</small></div>
        <div class="mission-reward vbucks"><strong>V-Bucks ×50</strong></div>
      </div>`;
    const misiones = parsearVBucksDailySTW(html);
    assert.ok(misiones.some(m => m.zona === 'Twine Peaks' && m.pl === 124 && m.vbucks && m.cantidadVbucks === 50));
});

test('SeeBot JSON mantiene PaVos, modificadores y requisitos para el comando pavos', () => {
    const data = [{
        zone: 'Hexsylvania Venture Zone',
        powerLevel: 124,
        name: 'Trap the Storm',
        alertRewards: [{
            itemType: 'currency_mtxswap',
            name: 'V-Bucks',
            quantity: 50
        }],
        modifiers: ['Short Range', 'Smoke Screens'],
        questReqs: 'None'
    }];
    const html = '<script>makeHtml(' + JSON.stringify(data) + ');</script>';
    const misiones = parsearJSONSeeBotSTW(html);
    const mision = misiones.find(m => m.misionOriginal === 'Trap the Storm');
    assert.ok(mision);
    assert.equal(mision.cantidadVbucks, 50);
    assert.ok(mision.modificadores.length >= 2);
    assert.equal(mision.questReqs, 'None');
});
