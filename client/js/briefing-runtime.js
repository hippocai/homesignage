/* One subscription per display. Only the active scene can claim a task. */
var briefingRuntime = (function () {
  var components = [],
    data = null,
    playing = null,
    poll = null,
    greetingTimer = null,
    expiry = null,
    session = 0,
    sequence = 0,
    claiming = false;
  function req(path, body) {
    return fetch(CONFIG.SERVER_URL + '/api/v1/devices/' + encodeURIComponent(deviceId) + path, {
      method: body ? 'POST' : 'GET',
      cache: 'no-store',
      headers: { 'X-Device-Key': deviceKey, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    })
      .then(function (r) {
        if (!r.ok) throw Error(String(r.status));
        return r.json();
      })
      .then(function (r) {
        return r.data;
      });
  }
  function receipt(task, status) {
    return req('/deliveries/' + task.id + '/result', { edition: task.edition, componentId:task.componentId, occurrence:task.occurrence || 1, result: status }).catch(
      function () {}
    );
  }
  function idle(comp) {
    HomeBriefing.pig(comp.el, comp.cfg);
  }
  function scheduleGreetings() {
    const interval = 5 * 60000;
    const now = getServerNow().getTime();
    greetingTimer = setTimeout(function () {
      components.forEach(function (comp) {
        if (comp.type !== 'companion') return;
        const bubble = comp.el.querySelector('.pig-greeting');
        if (bubble) bubble.textContent = HomePigGreetings.greeting(comp.cfg);
      });
      scheduleGreetings();
    }, interval - now % interval);
  }
  function finish(status) {
    if (!playing) return;
    var current = playing;
    playing = null;
    clearTimeout(current.timer);
    if (current.voice && window.speechSynthesis) window.speechSynthesis.cancel();
    idle(current.comp);
    receipt(current.task, status);
    if (status !== 'interrupted') setTimeout(attempt, 0);
  }
  function currentPig() {
    var layer = sceneLayers[currentSceneIndex];
    return components.find(function (c) {
      return (
        c.type === 'companion' && layer && layer.contains(c.el) && layer.classList.contains('active')
      );
    });
  }
  function busy() {
    return !!activeEmergency || state === 'EMERGENCY' || Object.keys(reminderPool).length > 0;
  }
  function priority(task) {
    if (task.payload.urgent) return 2;
    return task.payload.important ? 1 : 0;
  }
  function attempt() {
    if (!data || claiming || busy() || document.hidden) return;
    var comp = currentPig();
    const ready = data.tasks.filter(t => t.payload.speakUntil > Date.now() && t.expires > Date.now());
    const task = ready.find(t => t.payload.urgent) || ready.find(t => t.payload.important) || ready[0];
    if (!comp || !task || (playing && priority(task) <= priority(playing.task))) return;
    claiming = true;
    var token = session;
    req('/deliveries/' + task.id + '/claim', { edition: task.edition, componentId:comp.el.dataset?.componentId, occurrence:task.occurrence || 1 })
      .then(function (job) {
        if (
          token !== session ||
          comp !== currentPig() ||
          busy() ||
          !data ||
          !data.active.some(function (x) {
            return x.id === job.id && x.edition === job.edition;
          })
        ) {
          receipt(job, 'interrupted');
          return;
        }
        // Keep the current reminder on screen until the higher priority claim succeeds.
        if (playing) finish('interrupted');
        data.tasks = data.tasks.filter(function (x) {
          return x.id !== job.id;
        });
        var line = job.payload.speech;
        HomeBriefing.pig(comp.el, comp.cfg, line, job.payload.action);
        var duration = Math.min(25000, Math.max(10000, line.length * 300));
        var current = (playing = {
          comp: comp,
          task: job,
          voice: null,
          timer: setTimeout(
            function () {
              finish('subtitle');
            },
            Math.min(duration, job.expires - Date.now(), job.payload.speakUntil - Date.now())
          )
        });
        if (
          data.preferences.sound &&
          window.speechSynthesis &&
          window.SpeechSynthesisUtterance &&
          audioUnlocked
        ) {
          var voice = new SpeechSynthesisUtterance(line);
          voice.lang = 'zh-CN';
          voice.volume = data.preferences.volume;
          current.voice = voice;
          voice.onend = function () {
            if (playing === current) finish('spoken');
          };
          voice.onerror = function () {
            current.voice = null;
          };
          window.speechSynthesis.speak(voice);
        }
      })
      .catch(function () {})
      .finally(function () {
        claiming = false;
      });
  }
  function render() {
    if (!data) return;
    clearTimeout(expiry);
    components
      .filter(function (c) {
        return c.type === 'headlines';
      })
      .forEach(function (c) {
        HomeBriefing.cards(c.el, c.cfg, data.cards, Date.now());
      });
    var next = data.cards.reduce(function (t, e) {
      return e.expires > Date.now() ? Math.min(t, e.expires) : t;
    }, Infinity);
    if (isFinite(next)) expiry = setTimeout(render, Math.min(next - Date.now() + 5, 2147483647));
    if (playing) {
      var active = data.active.find(function (x) {
        return x.id === playing.task.id && x.edition === playing.task.edition;
      });
      if (!active || !data.preferences.enabled || active.speech !== playing.task.payload.speech)
        finish('interrupted');
    }
    attempt();
  }
  function sync() {
    if (!components.length || !deviceKey) return;
    var token = ++sequence;
    var pig=currentPig(), hasPig=!!pig, id=pig && pig.el.dataset?.componentId;
    req(hasPig ? '/briefing'+(id?'?componentId='+encodeURIComponent(id):'') : '/news')
      .then(function (d) {
        if (token === sequence && pig===currentPig()) {
          data = hasPig ? d : { cards: d.cards, tasks: [], active: [] };
          render();
        }
      })
      .catch(function () {});
  }
  function reset() {
    session++;
    sequence++;
    finish('interrupted');
    clearInterval(poll);
    clearTimeout(greetingTimer);
    greetingTimer = null;
    clearTimeout(expiry);
    poll = null;
    data = null;
    components.filter(c => c.type === 'headlines').forEach(c => HomeBriefing.disposeCards(c.el));
    components = [];
  }
  function mount(el, cfg, type) {
    var comp = { el: el, cfg: cfg, type: type };
    components.push(comp);
    if (type === 'companion') {
      idle(comp);
      if (greetingTimer === null) scheduleGreetings();
    }
    else HomeBriefing.cards(el, cfg, [], Date.now());
    if (!poll) {
      poll = setInterval(sync, 60000);
      setTimeout(sync, 0);
    }
  }
  function scene() {
    if (playing && playing.comp !== currentPig()) finish('interrupted');
    data=null;sync();
  }
  return {
    reset: reset,
    mount: mount,
    sync: sync,
    scene: scene,
    interrupt: function () {
      finish('interrupted');
    }
  };
})();
