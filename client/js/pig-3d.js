/* On-demand WebGL portrait. All scenes share one mesh, program and drawing surface. */
(function (root) {
  'use strict';
  const width = 448, height = 512;
  let renderer;
  const vertexShader = `
    attribute vec3 sphere;
    uniform vec3 center, radius;
    uniform float roll, tilt, yaw, bend;
    varying vec3 normal;
    mat2 turn(float angle) {
      float c = cos(angle), s = sin(angle);
      return mat2(c, s, -s, c);
    }
    void main() {
      vec3 p = sphere * radius, n = sphere / radius;
      p.y += bend * sphere.x * sphere.x;
      n.x -= n.y * 2. * bend * sphere.x / radius.x;
      p.xy = turn(roll) * p.xy;
      n.xy = turn(roll) * n.xy;
      p += center;
      p.xy = turn(tilt) * (p.xy - vec2(0., .42)) + vec2(0., .42);
      n.xy = turn(tilt) * n.xy;
      p.xz = turn(yaw) * p.xz;
      n.xz = turn(yaw) * n.xz;
      p.yz = turn(.075) * p.yz;
      n.yz = turn(.075) * n.yz;
      normal = n;
      gl_Position = vec4(p.x / 1.23, (p.y - .03) / 1.406, -p.z * .4, 1.);
    }`;
  const fragmentShader = `
    precision mediump float;
    uniform vec3 pigment;
    varying vec3 normal;
    void main() {
      vec3 n = normalize(normal), light = normalize(vec3(-.6,.85,1.));
      float diffuse = max(dot(n, light), 0.);
      float shine = pow(max(dot(n, normalize(light + vec3(0.,0.,1.))), 0.), 28.);
      vec3 fill = mix(vec3(.72,.61,.65), vec3(1.,.99,.97), diffuse);
      gl_FragColor = vec4(pigment * fill + .10 * shine, 1.);
    }`;

  function makeRenderer() {
    const surface = document.createElement('canvas');
    surface.width = width;
    surface.height = height;
    const gl = surface.getContext('webgl', { alpha: true, antialias: true, depth: true });
    if (!gl) return null;
    const program = gl.createProgram();
    function attach(type, source) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      gl.attachShader(program, shader);
      gl.deleteShader(shader);
    }
    attach(gl.VERTEX_SHADER, vertexShader);
    attach(gl.FRAGMENT_SHADER, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      return null;
    }
    gl.useProgram(program);
    const vertices = [], indices = [];
    const rings = 20, sides = 32;
    for (let i = 0; i <= rings; i++) {
      const latitude = i * Math.PI / rings;
      for (let j = 0; j <= sides; j++) {
        const angle = j * 2 * Math.PI / sides;
        vertices.push(Math.sin(latitude) * Math.cos(angle), Math.cos(latitude), Math.sin(latitude) * Math.sin(angle));
        if (i < rings && j < sides) {
          const a = i * (sides + 1) + j, b = a + sides + 1;
          indices.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
    }
    function buffer(target, data) {
      gl.bindBuffer(target, gl.createBuffer());
      gl.bufferData(target, data, gl.STATIC_DRAW);
    }
    buffer(gl.ARRAY_BUFFER, new Float32Array(vertices));
    buffer(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices));
    const position = gl.getAttribLocation(program, 'sphere');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 0, 0);
    const u = {};
    for (const name of ['center', 'radius', 'roll', 'tilt', 'yaw', 'pigment', 'bend'])
      u[name] = gl.getUniformLocation(program, name);
    gl.enable(gl.DEPTH_TEST);
    function part(x, y, z, rx, ry, rz, color, roll = 0, bend = 0) {
      gl.uniform3f(u.center, x, y, z);
      gl.uniform3f(u.radius, rx, ry, rz);
      gl.uniform1f(u.roll, roll);
      gl.uniform1f(u.bend, bend);
      gl.uniform3f(u.pigment, (color >> 16) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255);
      gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
    }
    let restingPortrait, restingLook;
    return function draw(ctx, pose, yaw, wave, look) {
      if (gl.isContextLost()) return false;
      const resting = pose === 'idle' && yaw === .22;
      if (resting && restingPortrait && restingLook === look.id) {
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(restingPortrait, 0, 0);
        return true;
      }
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniform1f(u.yaw, yaw);
      gl.uniform1f(u.tilt, 0);
      drawBody(part, pose, wave, look.coat);
      gl.uniform1f(u.tilt, pose === 'wave' ? -.08 : pose === 'scarf' ? .08 : .025);
      drawHead(part, pose);
      for (const piece of look.parts) part(...piece);
      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.translate(width * .50, height * .95);
      ctx.scale(width * .26, height * .025);
      const shadow = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      shadow.addColorStop(0, 'rgba(79,52,61,.22)');
      shadow.addColorStop(1, 'rgba(79,52,61,0)');
      ctx.fillStyle = shadow;
      ctx.fillRect(-1,-1,2,2);
      ctx.restore();
      ctx.drawImage(surface, 0, 0);
      if (resting) {
        restingLook = look.id;
        restingPortrait = document.createElement('canvas');
        restingPortrait.width = width;
        restingPortrait.height = height;
        restingPortrait.getContext('2d').drawImage(ctx.canvas, 0, 0);
      }
      return !gl.isContextLost();
    };
  }

  const skin = 0xffc7bb, rose = 0xf5999b, cocoa = 0x482e36;
  function drawBody(part, pose, wave, coat) {
    for (const side of [-1, 1]) {
      part(side * .27,-1.01,.01, .18,.21,.19, skin);
      part(side * .28,-1.12,.07, .19,.12,.22, 0x995e59);
    }
    part(0,-.54,0, .57,.55,.45, coat);
    part(0,-.37,.02, .52,.39,.43, skin);
    part(0,-.65,.25, .51,.40,.25, coat);
    for (const side of [-1, 1]) {
      part(side * .30,-.39,.35, .073,.22,.056, coat, side * -.20);
      part(side * .29,-.50,.411, .043,.043,.027, 0xffce79);
    }
    part(0,-.72,.485, .16,.105,.027, 0x89c9b5);
    part(-.016,-.72,.51, .031,.035,.009, 0xffb195,-.24);
    part(.013,-.72,.51, .027,.036,.009, 0xffbb9b,.22);
    part(.017,-.679,.51, .025,.010,.010, 0x638976,.42);
    part(-.54,-.53,.02, .14,.24,.15, skin, -.33);
    const angle = pose === 'wave' ? 2.40 + wave * .34 : pose === 'point' ? 1.64 : .36;
    part(.48 + .20 * Math.sin(angle),-.35 - .20 * Math.cos(angle),.14,
      .14,.27,.15,skin,angle);
    if (pose === 'scarf') {
      part(.30,-.50,.432, .10,.25,.055, 0xedaa4b,.29);
      part(0,-.30,.05, .56,.14,.47, 0xffc267);
    }
  }
  function drawHead(part, pose) {
    for (const side of [-1, 1]) {
      part(side * .60,.86,-.04, .225,.34,.16, skin, -side * .60);
      part(side * .63,.91,.076, .133,.217,.080, rose, -side * .60);
    }
    part(0,.37,0, .81,.68,.62, skin);
    for (const side of [-1, 1]) {
      part(side * .346,.45,.545, .071,.093,.062, cocoa);
      part(side * .346-.018,.484,.593, .021,.024,.016, 0xfff8e5);
      part(side * .35,.63,.499, .069,.022,.028, 0x9d645e, side * (pose === 'serious' ? .43 : -.18));
      part(side * .492,.25,.483, .109,.054,.038, 0xf6a3a1, side * .12);
    }
    // A curved smile sits below the protruding snout.
    part(0,.065,.563, .098,.015,.015, 0x845255,0,.042);
    part(0,.261,.603, .235,.155,.12, 0xf5a09e);
    for (const side of [-1, 1])
      part(side * .085,.272,.713, .030,.049,.018, 0x9e5b64, -side * .10);
  }

  function mount(canvas, onFailure, look) {
    let ctx;
    try {
      if (renderer === undefined) renderer = makeRenderer();
      if (renderer) ctx = canvas.getContext('2d');
    } catch (_) { return null; }
    if (!ctx) return null;
    canvas.width = width;
    canvas.height = height;
    let frame = 0, yaw = .22, pose = 'idle';
    function paint(wave = 0) {
      if (renderer(ctx, pose, yaw, wave, look)) return true;
      onFailure();
      return false;
    }
    function setPose(next) {
      cancelAnimationFrame(frame);
      pose = next;
      canvas.dataset.pose = pose;
      if (!paint() || pose !== 'wave' || root.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const start = performance.now();
      let last = start;
      function tick(time) {
        if (!canvas.isConnected || document.hidden || time - start >= 1200) return;
        if (time - last >= 65) {
          last = time;
          if (!paint(Math.sin((time - start) * .016))) return;
        }
        frame = requestAnimationFrame(tick);
      }
      frame = requestAnimationFrame(tick);
    }
    canvas.onpointermove = function (event) {
      if (event.pointerType !== 'mouse' || root.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const rect = canvas.getBoundingClientRect();
      const angle = Math.round(((event.clientX - rect.left) / rect.width - .5) * 12) / 12;
      if (yaw !== angle) { yaw = angle; paint(); }
    };
    canvas.onpointerleave = function () {
      if (yaw !== .22) { yaw = .22; paint(); }
    };
    return { setPose: setPose };
  }
  root.HomePig3D = { mount: mount };
})(window);
