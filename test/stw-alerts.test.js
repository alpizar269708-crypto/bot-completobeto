'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parsearTablaSeeBotSTW, parsearJSONSeeBotSTW, parsearVBucksDailySTW, seleccionarAlertasSTWPorRareza, traducirNombreMisionSTW, traducirZonaSTW, traducirBiomaSTW, traducirModificadorSTW } = require('../webBridge');

const htmlSeeBot = [
'<table id="miniRwdTbl">',
'<tr id="miniRwdTbl-headRow" class="missionRow"><th>Zone</th><th>PL</th><th>Icon</th><th>Modifiers</th><th>Reward</th><th>Quest Req(s)</th></tr>',
'<tr class="missionRow">',
'<td class="missionZone">Hexsylvania Venture Zone</td><td class="missionPl">124</td>',
'<td class="missionName"><img src="https://seebot.dev/images/missions/Trap the Storm.png" title="Trap the Storm" alt="Trap the Storm"></td>',
'<td class="missionModifiers">',
'<img src="/images/gameplaymodifiers/Short Range_sm.png" title="Short Range: Enemies close to a player or defender suffer more damage.">',
'<img src="/images/gameplaymodifiers/Smoke Screens_sm.png" title="Smoke Screens: Enemies can create a smoke screen.">',
'<img src="/images/gameplaymodifiers/Healing Deathburst_sm.png" title="Healing Deathburst: Enemies heal nearby enemies when they die.">',
'<img src="/images/gameplaymodifiers/Fire Storm_sm.png" title="Fire Storm: Changes elemental enemies to fire.">',
'<img src="/images/gameplaymodifiers/Acid Pools_sm.png" title="Acid Pools: Enemies can leave a damaging pool.">',
'</td>',
'<td class="missionAlerts"><span class="epic"><img src="https://seebot.dev/images/heroes/Deadly Blade Crash_sm.png" title="Deadly Blade Crash (Epic)" alt="Deadly Blade Crash (Epic)"> Deadly Blade Crash (Epic), </span></td>',
'<td class="missionQuestReqs">None</td></tr>',
'<tr class="missionRow"><td class="missionZone">Canny Valley</td><td class="missionPl">64</td>',
'<td class="missionName"><img src="/images/missions/Resupply.png" title="Resupply" alt="Resupply"></td>',
'<td class="missionModifiers"></td>',
'<td class="missionAlerts"><span class="legendary"><img src="/images/workers/Training Team Lead Survivor_sm.png" title="Training Team Lead Survivor (Legendary)" alt="Training Team Lead Survivor (Legendary)"> Training Team Lead Survivor (Legendary), </span></td>',
'<td class="missionQuestReqs">None</td></tr>',
'<tr class="missionRow"><td class="missionZone">Twine Peaks</td><td class="missionPl">94</td>',
'<td class="missionName"><img src="/images/missions/Retrieve the Data.png" title="Retrieve the Data" alt="Retrieve the Data"></td>',
'<td class="missionModifiers"></td>',
'<td class="missionAlerts"><span class="black"><img src="/images/rewards/V-Bucks or X-Ray_sm.png" title="V-Bucks or X-Ray" alt="V-Bucks or X-Ray"> V-Bucks or X-Ray x50</span></td>',
'<td class="missionQuestReqs">None</td></tr>',
'</table>'
].join('');

test('SeeBot #miniRwdTbl extrae zona, PL, misión, modificadores, rareza y requisito', () => {
    const misiones = parsearTablaSeeBotSTW(htmlSeeBot);
    assert.equal(misiones.length, 3);

    const epica = misiones.find(m => m.misionOriginal === 'Trap the Storm');
    assert.ok(epica, 'debe localizar la misión de ejemplo');
    assert.equal(epica.zona, 'Hexsylvania Venture Zone');
    assert.equal(epica.pl, 124);
    assert.equal(epica.questReqs, 'None');
    assert.equal(epica.recompensas.length, 1);
    assert.equal(epica.recompensas[0].tipo, 'hero');
    assert.equal(epica.recompensas[0].rareza, 'epic');
    assert.match(epica.recompensas[0].nombre, /Deadly Blade Crash/);
    assert.equal(epica.modificadores.length, 5);
    assert.ok(epica.modificadores.includes('Alcance corto'));
    assert.ok(epica.modificadores.includes('Tormenta de fuego'));
    assert.ok(epica.modificadores.includes('Cortinas de humo'));
    assert.ok(epica.modificadores.includes('Estallido curativo al morir'));
    assert.equal(epica.mision, 'Atrapa la tormenta');
    assert.ok(epica.modificadores.includes('Charcos de ácido'));

    const legendaria = misiones.find(m => m.misionOriginal === 'Resupply');
    assert.ok(legendaria);
    assert.equal(legendaria.recompensas[0].rareza, 'legendary');
    assert.equal(legendaria.recompensas[0].tipo, 'survivor');
    assert.match(legendaria.recompensas[0].nombre, /Superviviente legendario/);
    assert.match(legendaria.recompensas[0].nombre, /equipo de entrenamiento/i);
    assert.doesNotMatch(legendaria.recompensas[0].nombre, /Training Team Lead Survivor/i);

    const pavos = misiones.find(m => m.misionOriginal === 'Retrieve the Data');
    assert.ok(pavos);
    assert.equal(pavos.vbucks, true);
    assert.equal(pavos.cantidadVbucks, 50);
    assert.equal(pavos.recompensas[0].tipo, 'vbucks');
});



test('SeeBot extrae las misiones del arreglo makeHtml cuando el HTML no incluye la tabla', () => {
    const datos = [
        {
            zone: 'Hexsylvania Venture Zone',
            powerLevel: 124,
            name: 'Trap the Storm',
            alertRewards: [{
                itemType: 'Hero',
                name: 'Deadly Blade Crash (Epic)',
                id: 'Hero_Deadly_Blade_Crash',
                rarity: 'Epic',
                quantity: 1
            }],
            modifiers: ['Short Range', 'Smoke Screens', 'Healing Deathburst', 'Fire Storm', 'Acid Pools'],
            missionQuestReqs: 'None'
        },
        {
            zone: 'Canny Valley',
            powerLevel: 64,
            name: 'Resupply',
            alertRewards: [{
                itemType: 'Survivor',
                name: 'Training Team Lead Survivor (Legendary)',
                id: 'Worker_TrainingTeamLead',
                rarity: 'Legendary',
                quantity: 1
            }],
            modifiers: [],
            missionQuestReqs: 'None'
        },
        {
            zone: 'Twine Peaks',
            powerLevel: 94,
            name: 'Retrieve the Data',
            alertRewards: [{
                itemType: 'currency_mtxswap',
                name: 'V-Bucks or X-Ray',
                id: 'V-Bucks',
                quantity: 50
            }],
            modifiers: [],
            missionQuestReqs: 'None'
        },
        {
            zone: 'Twine Peaks',
            powerLevel: 70,
            name: 'Repair the Shelter',
            alertRewards: [{
                itemType: 'Resource',
                name: 'Pure Drop of Rain (Epic)',
                id: 'Resource_PureDropOfRain',
                rarity: 'Epic',
                quantity: 5
            }],
            modifiers: [],
            missionQuestReqs: 'None'
        }
    ];
    const html = '<script>makeHtml(' + JSON.stringify(datos) + ');</script>';
    const misiones = parsearJSONSeeBotSTW(html);

    assert.equal(misiones.length, 4);
    const epica = misiones.find(m => m.misionOriginal === 'Trap the Storm');
    assert.ok(epica);
    assert.equal(epica.zona, 'Hexsylvania Venture Zone');
    assert.equal(epica.pl, 124);
    assert.equal(epica.recompensas[0].rareza, 'epic');
    assert.equal(epica.recompensas[0].tipo, 'hero');
    assert.equal(epica.modificadores.length, 5);
    assert.equal(epica.questReqs, 'None');
    assert.equal(epica.mision, 'Atrapa la tormenta');

    const epicasUtiles = seleccionarAlertasSTWPorRareza(misiones, 'epic');
    const legendariasUtiles = seleccionarAlertasSTWPorRareza(misiones, 'legendary');
    assert.equal(epicasUtiles.length, 1, 'una recompensa épica genérica no debe generar alerta útil');
    assert.equal(epicasUtiles[0].misionOriginal, 'Trap the Storm');
    assert.equal(epicasUtiles[0].recompensas[0].tipo, 'hero');
    assert.equal(legendariasUtiles.length, 1);
    assert.equal(legendariasUtiles[0].recompensas[0].tipo, 'survivor');

    const legendaria = misiones.find(m => m.misionOriginal === 'Resupply');
    assert.equal(legendaria.recompensas[0].rareza, 'legendary');
    assert.equal(legendaria.recompensas[0].tipo, 'survivor');

    const pavos = misiones.find(m => m.misionOriginal === 'Retrieve the Data');
    assert.equal(pavos.vbucks, true);
    assert.equal(pavos.cantidadVbucks, 50);
    assert.equal(pavos.recompensas[0].tipo, 'vbucks');
});

test('V-Bucks Daily extrae alertas de PaVos como respaldo', () => {
    const html = [
        '<div class="mission-row">',
        '<div class="pl">94</div>',
        '<div class="mission-name"><strong>Retrieve the Data</strong><small>Twine Peaks</small></div>',
        '<div class="mission-reward vbucks"><strong>V-Bucks x50</strong></div>',
        '</div>'
    ].join('');
    const alertas = parsearVBucksDailySTW(html);
    assert.equal(alertas.length, 1);
    assert.equal(alertas[0].zona, 'Twine Peaks');
    assert.equal(alertas[0].pl, 94);
    assert.equal(alertas[0].cantidadVbucks, 50);
});



test('los textos de alerta de STW se traducen al español', () => {
    assert.equal(traducirNombreMisionSTW('Category 3 Fight the Storm'), 'Lucha contra una tormenta de categoría 3');
    assert.equal(traducirNombreMisionSTW('Ride the Lightning'), 'Monta el rayo');
    assert.equal(traducirZonaSTW('Stonewood'), 'Bosque Pedregoso');
    assert.equal(traducirZonaSTW('Hexsylvania Venture Zone'), 'Zona de Aventuras de Hexsylvania');
    assert.equal(traducirBiomaSTW('Industrial Park (Arid)'), 'Parque industrial (árido)');
    assert.equal(traducirModificadorSTW('Healing Deathburst: Enemies heal nearby enemies when they die.'), 'Estallido curativo al morir');
});

test('los comandos STW están registrados en el manejador', () => {
    const handler = fs.readFileSync(path.join(__dirname, '..', 'messageHandler.js'), 'utf8');
    for (const comando of ['pavos', 'rpavos', 'destacadasstw', 'legendariasstw', 'epicasstw', 'alertasstw', 'stw', 'alerta', 'alertanob', 'setgrupostw', 'unsetgrupostw']) {
        assert.ok(handler.includes("'" + comando + "'"), 'falta registrar ' + comando);
        assert.ok(handler.includes("case '" + comando + "'"), 'falta ejecutar ' + comando);
    }
});


test('V-Bucks Daily agrupa recompensas épicas y legendarias en una sola misión traducida', () => {
    const html = [
        '<div class="mission-row ">',
        '<span class="pl">88</span>',
        '<button class="mission-name"><img class="fortnite-icon mission-type-icon" alt="" aria-hidden="true" src="/assets/fortnite/ride-the-lightning.png"><span><strong>Ride the Lightning</strong><small>Twine Peaks · Thunder Route 99</small></span></button>',
        '<div class="mission-rewards">',
        '<div class="mission-reward perks"><img class="fortnite-icon" src="/assets/fortnite/epic-perk-up.png"><div><strong>Epic PERK-UP! <span>×80</span></strong><small>Epic · Alert reward</small></div></div>',
        '<div class="mission-reward perks"><img class="fortnite-icon" src="/assets/fortnite/legendary-perk-up.png"><div><strong>Legendary PERK-UP! <span>×80</span></strong><small>Legendary · Alert reward</small></div></div>',
        '</div></div>'
    ].join('');

    const misiones = parsearVBucksDailySTW(html);
    assert.equal(misiones.length, 1, 'debe generar una misión, no una alerta separada por premio');
    assert.equal(misiones[0].pl, 88);
    assert.equal(misiones[0].zona, 'Twine Peaks');
    assert.equal(misiones[0].misionOriginal, 'Ride the Lightning');
    assert.equal(misiones[0].mision, 'Monta el rayo - Ruta Trueno 99');
    assert.equal(misiones[0].recompensas.length, 2);
    assert.ok(misiones[0].recompensas.some(r => r.rareza === 'epic' && r.tipo === 'perkup' && /épico.*80/i.test(r.nombre)));
    assert.ok(misiones[0].recompensas.some(r => r.rareza === 'legendary' && r.tipo === 'perkup' && /legendario.*80/i.test(r.nombre)));

    const epicas = seleccionarAlertasSTWPorRareza(misiones, 'epic');
    const legendarias = seleccionarAlertasSTWPorRareza(misiones, 'legendary');
    assert.equal(epicas.length, 1);
    assert.equal(legendarias.length, 1);
    for (const lista of [epicas, legendarias]) {
        assert.equal(lista[0].recompensas.length, 2, 'ambas categorías conservan las recompensas épica y legendaria');
        assert.match(lista[0].recompensa, /Perk-Up épico/);
        assert.match(lista[0].recompensa, /Perk-Up legendario/);
    }
});

test('una recompensa Perk-Up solo incrementa el conteo si su misión tiene ambas rarezas', () => {
    const doble = {
        zona: 'Twine Peaks', pl: 88, mision: 'Monta el rayo', misionOriginal: 'Ride the Lightning',
        recompensas: [
            { nombre: 'Perk-Up épico ×80', raw: 'Epic PERK-UP!', rareza: 'epic', tipo: 'perkup', cantidad: 80 },
            { nombre: 'Perk-Up legendario ×80', raw: 'Legendary PERK-UP!', rareza: 'legendary', tipo: 'perkup', cantidad: 80 }
        ]
    };
    const soloEpica = {
        zona: 'Twine Peaks', pl: 70, mision: 'Recupera los datos', misionOriginal: 'Retrieve the Data',
        recompensas: [{ nombre: 'Perk-Up épico ×80', raw: 'Epic PERK-UP!', rareza: 'epic', tipo: 'perkup', cantidad: 80 }]
    };
    assert.equal(seleccionarAlertasSTWPorRareza([doble, soloEpica], 'epic').length, 1);
    assert.equal(seleccionarAlertasSTWPorRareza([doble, soloEpica], 'legendary').length, 1);
});
