const fs = require('node:fs');
const path = require('node:path');
const { looks } = require('../../client/js/pig-looks');
const template = fs.readFileSync(path.join(__dirname, '../../client/assets/peach-pig.svg'), 'utf8');
const hex = color => '#' + color.toString(16).padStart(6, '0');

function illustration(look) {
  const headpiece = look.parts.map(([x,y,,rx,ry,,color,roll = 0]) => {
    const cx = 120 + 86*x, cy = 126 - 87*y;
    return `<ellipse transform="translate(${cx} ${cy}) rotate(${-roll * 180/Math.PI})" rx="${86*rx}" ry="${87*ry}" fill="${hex(color)}" stroke="none"/>`;
  }).join('');
  return template.replace('aria-label="桃桃猪"', `aria-label="${look.name}"`)
    .replace(/<g transform="translate\(104 12\)[^\n]*?<\/g>/, headpiece)
    .replace('#63b6a6', hex(look.coat)).replace('#297772', hex((look.coat & 0xfefefe) >>> 1));
}
const portraits = new Map(looks.map(look => [look.id, illustration(look)]));
module.exports = (req, res) => {
  const svg = portraits.get(req.params.look);
  if (!svg) return res.sendStatus(404);
  res.type('image/svg+xml').send(svg);
};
