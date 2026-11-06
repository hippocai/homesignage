/* Headpieces are ellipsoids shared by the WebGL model and the SVG illustration. */
(function (root) {
  'use strict';
  const cream = 0xffefd2, gold = 0xefbd56, leaf = 0x79ab78;
  const part = (x,y,z,rx,ry,rz,color,roll=0) => [x,y,z,rx,ry,rz,color,roll];
  const ball = (x,y,r,color) => part(x,y,.20,r,r,r,color);
  const cap = (color) => part(0,1.00,.02,.48,.20,.41,color);
  const brim = (color) => part(0,.99,.12,.57,.052,.49,color);
  function petals(x,y,color) {
    return Array.from({length:5}, (_,i) => {
      const a = i * Math.PI * 2 / 5;
      return part(x+.095*Math.sin(a),y+.095*Math.cos(a),.20,.068,.115,.060,color,-a);
    }).concat([ball(x,y,.066,gold)]);
  }
  const entries = [
    ['peach','桃桃猪',0x4fae9e,[
      part(-.055,1.064,.025,.127,.125,.117,0xffab8a,-.25),
      part(.045,1.079,.027,.118,.130,.114,0xffb596,.25),
      part(.066,1.216,.03,.118,.042,.055,leaf,.48)]],
    ['sprout','豆芽猪',0x749348,[part(0,1.10,0,.025,.14,.025,leaf),
      part(-.11,1.21,.04,.15,.064,.08,0x97bc69,-.42),part(.11,1.23,.04,.15,.064,.08,leaf,.42)]],
    ['daisy','雏菊猪',0xd49048,petals(-.35,1.00,cream)],
    ['ribbon','蝴蝶结猪',0xb96783,[part(-.44,1.06,.16,.15,.102,.08,0xe7759f,-.52),part(-.21,1.07,.17,.15,.102,.08,0xef8dac,.48),ball(-.33,1.055,.073,0xc45479)]],
    ['pudding','布丁猪',0xb9804c,[brim(0xe8b86e),part(0,1.10,.02,.31,.17,.31,0xe9b862),part(0,1.22,.03,.255,.065,.26,0xac6c48),ball(.10,1.30,.069,0xc95551)]],
    ['mushroom','蘑菇猪',0xb95549,[brim(cream),cap(0xd15351),ball(-.17,1.12,.064,cream),ball(.12,1.15,.055,cream),ball(.32,1.07,.053,cream)]],
    ['beret','画家猪',0x56689e,[part(-.05,1.04,.07,.48,.166,.36,0x6879ad,.18),part(-.13,1.211,.06,.045,.074,.04,0x4c5780,-.35)]],
    ['chef','厨师猪',0xbc6a5a,[part(0,1.035,.02,.35,.10,.30,cream),ball(-.22,1.17,.17,0xfff8e8),ball(.22,1.17,.17,0xfff8e8),ball(0,1.22,.17,0xfff8e8)]],
    ['crown','小王子猪',0x8878a9,[part(0,1.05,.02,.34,.095,.29,gold),...[-1,0,1].map(i=>part(i*.22,1.15,.05,.074,.13,.075,gold,-i*.24)),ball(0,1.24,.061,0xcc6472)]],
    ['bunny','兔耳猪',0xb597b7,[-1,1].flatMap(i=>[part(i*.16,1.15,.03,.098,.232,.084,cream,-i*.22),part(i*.16,1.16,.093,.051,.161,.041,0xdfa1ae,-i*.22)])],
    ['bear','小熊猪',0x996e55,[-1,1].flatMap(i=>[ball(i*.40,1.08,.16,0xa37a59),part(i*.40,1.08,.32,.087,.087,.048,0xe3b188)])],
    ['sailor','水手猪',0x54849d,[cap(cream),part(0,1.003,.18,.46,.063,.34,0x5885ac),part(.27,1.04,.37,.085,.045,.045,0xe39a83,-.35)]],
    ['winter','绒球猪',0x689bab,[cap(0x7db7bd),brim(0xa0ceca),ball(0,1.27,.102,cream)]],
    ['straw','草帽猪',0xa59659,[brim(0xe3bf79),part(0,1.08,.02,.33,.17,.31,0xe8cb87),part(0,1.04,.05,.34,.044,.31,0x9a7955)]],
    ['berry','莓莓猪',0xb6536d,[part(0,1.095,.04,.217,.177,.19,0xe16776),...[-1,0,1].map(i=>part(i*.075,1.23,.07,.048,.09,.046,leaf,i*.74)),ball(-.065,1.09,.022,cream),ball(.06,1.14,.021,cream)]],
    ['cloud','云朵猪',0x748db3,[ball(-.21,1.09,.13,cream),ball(0,1.16,.17,0xfff7eb),ball(.19,1.09,.135,cream),part(.10,.96,.20,.033,.067,.036,0x84b7ca)]]
  ];
  const looks = entries.map(([id,name,coat,parts]) => ({id,name,coat,parts}));
  const catalog = { looks, get: id => looks.find(look => look.id === id) || looks[0] };
  if (typeof module === 'object' && module.exports) module.exports = catalog;
  else root.HomePigLooks = catalog;
})(typeof window === 'undefined' ? globalThis : window);
