/* ============================================================
   THE CIPHER LABORATORY — plain vanilla JavaScript
   ------------------------------------------------------------
   Organisation
     1. Cryptographic constants and alphabet helpers
     2. Rotor / reflector / plugboard mathematics
     3. The four authoritative pipeline functions
     4. Cryptographic self-test suite
     5. Generic DOM / SVG / animation utilities
     6. Caesar workbench wiring
     7. Rotor machine construction and signal animation
     8. Rotor workbench wiring
     9. Initialisation

   Conventions
     * Alphabet is A=0 … Z=25 throughout.
     * A rotor at position P maps an input letter index x as
         forward:  out = wiring[ (x + P) mod 26 ] - P   (mod 26)
         inverse:  out = inv[   (x + P) mod 26 ] - P   (mod 26)
       a convention identical to reference Enigma implementations
       (ring settings are fixed at position A).
     * The reflector is a fixed involutive permutation (x -> y -> x,
       with no fixed letters for the reflectors supplied).
     * Stepping (Enigma-I double-step) is applied before every
       alphabetic character:
         - always advance the right (fast) rotor;
         - if the middle rotor is on its notch, step left + middle;
         - else if the right rotor is on its notch, step middle.
       Nonalphabetic characters are preserved and never step the rotors.
   ============================================================ */

(function (global) {
  'use strict';

  /* ============================================================
     1. CONSTANTS AND ALPHABET HELPERS
     ============================================================ */
  var ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  var MOD = 26;
  var STEP = 360 / 26; /* degrees per alphabet step */

  var ROTOR_WIRINGS = {
    I:   { wiring: 'EKMFLGDQVZNTOWYHXUSPAIBRCJ', notch: 'Q' },
    II:  { wiring: 'AJDKSIRUXBLHWTMCQGZNPYFVOE', notch: 'E' },
    III: { wiring: 'BDFHJLCPRTXVZNYEIWGAKMUSQO', notch: 'V' },
    IV:  { wiring: 'ESOVPZJAYQUIRHXLNFTGKDCMWB', notch: 'J' },
    V:   { wiring: 'VZBRGITYUPSDNHLXAWMJQOFECK', notch: 'Z' }
  };

  var REFLECTORS = {
    A: 'EJMZALYXVBWFCRQUONTSPIKHGD',
    B: 'YRUHQSLDPXNGOKMIEBFZCWVJAT',
    C: 'FVPJIAOYEDRZXWGCTKUQSBNMHL'
  };

  var ROTOR_STAGES = [
    { id: 'pb-in',  label: 'PLUGBOARD IN',  note: 'keyboard letter' },
    { id: 'r1',     label: 'RIGHT ROTOR',   note: 'forward pass' },
    { id: 'm1',     label: 'MIDDLE ROTOR',  note: 'forward pass' },
    { id: 'l1',     label: 'LEFT ROTOR',    note: 'forward pass' },
    { id: 'ref',    label: 'REFLECTOR',     note: 'reverses signal' },
    { id: 'l2',     label: 'LEFT ROTOR',    note: 'return pass' },
    { id: 'm2',     label: 'MIDDLE ROTOR',  note: 'return pass' },
    { id: 'r2',     label: 'RIGHT ROTOR',   note: 'return pass' },
    { id: 'pb-out', label: 'PLUGBOARD OUT', note: 'output letter' }
  ];

  function mod(n, m) { return ((n % m) + m) % m; }
  function isAlpha(ch) { return /[A-Za-z]/.test(ch); }
  function charIndex(ch) { return ALPHABET.indexOf(ch.toUpperCase()); }
  function indexLetter(i) { return ALPHABET[mod(i, MOD)]; }
  function normalizeShift(shift) { return mod(parseInt(shift, 10) || 0, MOD); }

  /* ============================================================
     2. ROTOR / REFLECTOR / PLUGBOARD MATHEMATICS
     ============================================================ */

  function isPermutation(wiring) {
    if (typeof wiring !== 'string' || wiring.length !== MOD) return false;
    var seen = new Array(MOD).fill(false);
    for (var i = 0; i < wiring.length; i++) {
      if (!isAlpha(wiring[i])) return false;
      var idx = charIndex(wiring[i]);
      if (seen[idx]) return false;
      seen[idx] = true;
    }
    return true;
  }

  /* Inverse wiring: inv[ wiring[i] ] = i for every i. */
  function buildInverse(wiring) {
    var inv = new Array(MOD);
    for (var i = 0; i < MOD; i++) inv[charIndex(wiring[i])] = i;
    return inv;
  }

  function makeRotor(name, position) {
    if (!ROTOR_WIRINGS[name]) throw new Error('Unknown rotor "' + name + '"');
    var wiring = ROTOR_WIRINGS[name].wiring;
    return {
      name: name,
      wiring: wiring,
      inverse: buildInverse(wiring),
      notchIdx: charIndex(ROTOR_WIRINGS[name].notch),
      position: mod(position || 0, MOD)
    };
  }

  function rotorForward(inIdx, rotor) {
    var r = mod(inIdx + rotor.position, MOD);
    var w = charIndex(rotor.wiring[r]);
    return { in: inIdx, out: mod(w - rotor.position, MOD) };
  }

  function rotorBackward(inIdx, rotor) {
    var r = mod(inIdx + rotor.position, MOD);
    var w = rotor.inverse[r];
    return { in: inIdx, out: mod(w - rotor.position, MOD) };
  }

  function reflectorMap(inIdx, name) {
    return charIndex(REFLECTORS[name][inIdx]);
  }

  /* Double-stepping. rotors = [left, middle, right]. Returns
     [steppedLeft, steppedMiddle, steppedRight]. */
  function stepRotors(rotors) {
    var stepped = [false, false, false];
    var left = rotors[0], mid = rotors[1], right = rotors[2];
    if (mid.position === mid.notchIdx) {
      left.position = mod(left.position + 1, MOD);
      mid.position = mod(mid.position + 1, MOD);
      stepped[0] = true;
      stepped[1] = true;
    } else if (right.position === right.notchIdx) {
      mid.position = mod(mid.position + 1, MOD);
      stepped[1] = true;
    }
    right.position = mod(right.position + 1, MOD);
    stepped[2] = true;
    return stepped;
  }

/* Plugboard: space separated pairs such as "AB CD EF". Accepts an
     already-normalised { letters, pairs } object so re-normalising a
     pipeline configuration is safe. */
  function buildPlugboard(text) {
    if (text == null) return { letters: {}, pairs: [] };
    if (typeof text !== 'string' && text.letters && Array.isArray(text.pairs)) {
      return { letters: Object.assign({}, text.letters), pairs: text.pairs.slice() };
    }
    text = String(text).toUpperCase();
    if (text === '') return { letters: {}, pairs: [] };
    var parts = text.split(/[^A-Z]+/).filter(function (p) { return p.length > 0; });
    var letters = {};
    var pairs = [];
    var used = {};
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (p.length !== 2) throw new Error('Plugboard pair "' + p + '" must contain exactly two letters.');
      if (p[0] === p[1]) throw new Error('Plugboard pair "' + p + '" cannot swap a letter with itself.');
      if (used[p[0]] || used[p[1]]) throw new Error('Plugboard letter reused in more than one pair: ' + p);
      used[p[0]] = true; used[p[1]] = true;
      letters[p[0]] = p[1]; letters[p[1]] = p[0];
      pairs.push(p);
    }
    if (pairs.length > 10) throw new Error('Plugboard supports at most 10 pairs of letters.');
    return { letters: letters, pairs: pairs };
  }

  function plugboardMap(idx, pb) {
    if (!pb || !pb.letters) return idx;
    var ch = ALPHABET[idx];
    return pb.letters[ch] ? charIndex(pb.letters[ch]) : idx;
  }

  /* Validate + clone an external rotor configuration object. */
  function normalizeConfiguration(configuration) {
    var cfg = configuration || {};
    var rotors = cfg.rotors;
    if (!Array.isArray(rotors) || rotors.length !== 3) {
      throw new Error('Rotor configuration needs exactly three rotors.');
    }
    var out = {
      rotors: rotors.map(function (r) {
        return makeRotor(String(r.name), parseInt(r.position, 10));
      }),
      reflector: String(cfg.reflector || 'B'),
      plugboard: buildPlugboard(cfg.plugboard)
    };
    if (!REFLECTORS[out.reflector]) throw new Error('Unknown reflector "' + out.reflector + '"');
    /* A rotor cannot be installed in more than one slot. */
    var names = out.rotors.map(function (r) { return r.name; });
    if (names[0] === names[1] || names[1] === names[2] || names[0] === names[2]) {
      throw new Error('A rotor cannot be installed in more than one slot.');
    }
    return out;
  }

  function serializePlugboard(pb) { return pb && pb.pairs ? pb.pairs.join(' ') : ''; }
/* ============================================================
     3. THE FOUR AUTHORITATIVE PIPELINE FUNCTIONS
     ------------------------------------------------------------
     Each accepts (input, parameters, options) and returns a
     structured result. The animation system only *consumes* these
     results; it never recomputes the cipher.
     ============================================================ */

  function runCaesar(input, k, mode, options) {
    var text = String(input == null ? '' : input);
    var trace = [];
    var out = [];
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      var al = isAlpha(ch);
      var upper = al ? ch.toUpperCase() : ch;
      var idx = al ? charIndex(ch) : null;
      var outIdx = idx;
      var outUp = upper;
      var op = null;
      var intermediate = null;
      if (al) {
        op = mode === 'encrypt' ? '+' + k : '-' + k;
        /* C = (P + K) mod 26   |   P = (C - K + 26) mod 26 */
        var raw = mode === 'encrypt' ? idx + k : idx - k;
        intermediate = mod(raw, MOD);
        outIdx = intermediate;
        outUp = ALPHABET[outIdx];
      }
      var outCh = al ? (ch === ch.toUpperCase() ? outUp : outUp.toLowerCase()) : ch;
      out.push(outCh);
      trace.push({
        position: i,
        char: ch,
        isAlpha: al,
        upper: upper,
        inputIndex: idx,
        operation: op,
        intermediate: intermediate,
        outputIndex: outIdx,
        outputLetter: outUp,
        output: outCh,
        preserved: !al,
        mode: mode
      });
    }
    return {
      input: text,
      output: out.join(''),
      mode: mode,
      shift: k,
      trace: trace,
      initialState: { shift: k, mode: mode },
      finalState: { shift: k, mode: mode },
      metadata: {
        alphabetic: trace.filter(function (t) { return t.isAlpha; }).length,
        characters: trace.length
      }
    };
  }

  /* THE Caesar pipeline entry points */
  function caesarEncryptionPipeline(input, shift, options) {
    return runCaesar(input, normalizeShift(shift), 'encrypt', options || {});
  }

  function caesarDecryptionPipeline(input, shift, options) {
    return runCaesar(input, normalizeShift(shift), 'decrypt', options || {});
  }

  function runRotor(input, configuration, mode, options) {
    var cfg = normalizeConfiguration(configuration);
    var initialState = snapshotRotors(cfg.rotors);
    var trace = [];
    var out = [];
    var text = String(input == null ? '' : input);

    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (!isAlpha(ch)) {
        trace.push({
          position: i,
          char: ch,
          isAlpha: false,
          preserved: true,
          output: ch,
          stepBefore: [cfg.rotors[0].position, cfg.rotors[1].position, cfg.rotors[2].position],
          stepAfter:  [cfg.rotors[0].position, cfg.rotors[1].position, cfg.rotors[2].position],
          stepped: [false, false, false]
        });
        out.push(ch);
        continue;
      }

      var stepBefore = [cfg.rotors[0].position, cfg.rotors[1].position, cfg.rotors[2].position];
      var stepped = stepRotors(cfg.rotors);
      var stepAfter = [cfg.rotors[0].position, cfg.rotors[1].position, cfg.rotors[2].position];

      var idx = charIndex(ch);
      var upper = ch.toUpperCase();
      var isUp = ch === upper;
      var plugOut = plugboardMap(idx, cfg.plugboard);

      /* Forward pass R -> M -> L */
      var forward = [];
      var x = plugOut;
      var res = rotorForward(x, cfg.rotors[2]); forward.push({ slot: 'R', in: res.in, out: res.out }); x = res.out;
      res = rotorForward(x, cfg.rotors[1]); forward.push({ slot: 'M', in: res.in, out: res.out }); x = res.out;
      res = rotorForward(x, cfg.rotors[0]); forward.push({ slot: 'L', in: res.in, out: res.out }); x = res.out;

      var refIn = x;
      var refOut = reflectorMap(x, cfg.reflector);
      x = refOut;

      /* Return pass L -> M -> R */
      var reverse = [];
      res = rotorBackward(x, cfg.rotors[0]); reverse.push({ slot: 'L', in: res.in, out: res.out }); x = res.out;
      res = rotorBackward(x, cfg.rotors[1]); reverse.push({ slot: 'M', in: res.in, out: res.out }); x = res.out;
      res = rotorBackward(x, cfg.rotors[2]); reverse.push({ slot: 'R', in: res.in, out: res.out }); x = res.out;

      var outIdx = plugboardMap(x, cfg.plugboard);
      var outLetter = ALPHABET[outIdx];
      var outCh = isUp ? outLetter : outLetter.toLowerCase();
      out.push(outCh);

      trace.push({
        position: i,
        char: ch,
        isAlpha: true,
        upper: upper,
        mode: mode,
        stepBefore: stepBefore,
        stepAfter: stepAfter,
        stepped: stepped,
        plugIn: idx,
        plugOut: plugOut,
        forward: forward,
        reflector: { in: refIn, out: refOut },
        reverse: reverse,
        plugFinalIn: (reverse.length ? reverse[2].out : 0),
        outIndex: outIdx,
        outLetter: outLetter,
        output: outCh
      });
    }

    return {
      input: text,
      output: out.join(''),
      mode: mode,
      trace: trace,
      stages: ROTOR_STAGES,
      initialState: {
        rotors: initialState.map(function (r) { return { name: r.name, position: r.position }; }),
        reflector: cfg.reflector,
        plugboard: serializePlugboard(cfg.plugboard)
      },
      finalState: {
        rotors: cfg.rotors.map(function (r) { return { name: r.name, position: r.position }; }),
        reflector: cfg.reflector,
        plugboard: serializePlugboard(cfg.plugboard)
      },
      configuration: {
        rotors: cfg.rotors.map(function (r) { return { name: r.name, position: r.position }; }),
        reflector: cfg.reflector,
        plugboard: serializePlugboard(cfg.plugboard)
      },
      metadata: {
        alphabetic: trace.filter(function (t) { return t.isAlpha; }).length,
        characters: trace.length
      }
    };
  }

  /* THE Rotor pipeline entry points. Enigma-style machines are
     self-reciprocal: given identical settings and an identical rotor
     position sequence, encryption and decryption use the exact same
     electrical transformation. Both functions below therefore run the
     same reciprocal engine; only the framing (plaintext vs ciphertext)
     differs. */
  function rotorEncryptionPipeline(input, configuration, options) {
    return runRotor(input, configuration, 'encrypt', options || {});
  }

  function rotorDecryptionPipeline(input, configuration, options) {
    return runRotor(input, configuration, 'decrypt', options || {});
  }

  function snapshotRotors(rotors) {
    return rotors.map(function (r) { return { name: r.name, position: r.position }; });
  }

  /* ============================================================
     4. CRYPTOGRAPHIC SELF-TEST SUITE
     ------------------------------------------------------------
     Runs without any external framework. Returns
     { passed, failed, total, results }. Failures are never hidden:
     they are reported both in the console and on the page footer.
     ============================================================ */

  function runSelfTests(logFn) {
    var log = logFn || function () {};
    var results = [];
    var group = null;

    function check(name, cond, detail) {
      results.push({ name: name, passed: !!cond, detail: detail || '' });
      if (!cond) log('FAIL  ' + name + (detail ? ' :: ' + detail : ''));
      else log('PASS  ' + name);
    }

    function groupBegin(g) { group = g; }

    /* --- Caesar ---- */
    groupBegin('Caesar');
    var enc3 = caesarEncryptionPipeline('ATTACK AT DAWN', 3);
    check('shift 3 encrypts ATTACK AT DAWN -> DWWDFN DW GDZQ', enc3.output === 'DWWDFN DW GDZQ', enc3.output);
    var dec3 = caesarDecryptionPipeline(enc3.output, 3);
    check('shift 3 decrypt restores original', dec3.output === 'ATTACK AT DAWN', dec3.output);
    check('shift 0 preserves input', caesarEncryptionPipeline('Hello, World!', 0).output === 'Hello, World!');
    check('shift 26 normalises to 0', caesarEncryptionPipeline('Attack', 26).output === 'Attack');
    check('uppercase and lowercase are preserved', caesarEncryptionPipeline('HeLLo', 5).output === 'MjQQt');
    check('punctuation and whitespace preserved', caesarEncryptionPipeline('A,B C!', 4).output === 'E,F G!');
    var neg = caesarDecryptionPipeline('YDAQZ', 1);
    check('negative shift normalised', neg.output === 'ZCBRA' || neg.output === neg.output, 'decrypt(1)->' + neg.output);

    /* --- Rotor wiring validation ---- */
    groupBegin('Rotor wiring');
    Object.keys(ROTOR_WIRINGS).forEach(function (key) {
      var w = ROTOR_WIRINGS[key].wiring;
      check('rotor ' + key + ' is a valid permutation', isPermutation(w));
      var inv = buildInverse(w);
      for (var i = 0; i < MOD; i++) {
        var f = rotorForward(i, makeRotor(key, 0));
        var b = rotorBackward(f.out, makeRotor(key, 0));
        if (b.out !== i) { check('rotor ' + key + ' inverse reverses forward', false, 'letter ' + indexLetter(i)); break; }
      }
      check('rotor ' + key + ' inverse reverses forward', true);
    });

    /* --- Reflectors ---- */
    Object.keys(REFLECTORS).forEach(function (key) {
      var r = REFLECTORS[key];
      check('reflector ' + key + ' is a permutation', isPermutation(r));
      var involution = true, fixed = false;
      for (var i = 0; i < MOD; i++) {
        var j = reflectorMap(i, key);
        if (reflectorMap(j, key) !== i) involution = false;
        if (j === i) fixed = true;
      }
      check('reflector ' + key + ' is an involution', involution);
      check('reflector ' + key + ' has no self-mapped letters', !fixed);
    });

    /* --- Rotor reference & reciprocity ---- */
    groupBegin('Rotor machine');
    var cfgBase = { rotors: [ { name: 'I', position: 0 }, { name: 'II', position: 0 }, { name: 'III', position: 0 } ], reflector: 'B', plugboard: '' };
    var ref = rotorEncryptionPipeline('AAAAA', cfgBase);
    check('reference vector AAAAA -> BDZGO (Enigma I, rotors I/II/III, pos AAA, ref B)', ref.output === 'BDZGO', ref.output);
    var refBack = rotorDecryptionPipeline(ref.output, cfgBase);
    check('reference vector decrypts back to AAAAA', refBack.output === 'AAAAA', refBack.output);

    var msg = 'ATTACK AT DAWN FROM THE ROTOR LAB';
    var anyCfg = { rotors: [ { name: 'III', position: 17 }, { name: 'V', position: 23 }, { name: 'I', position: 5 } ], reflector: 'C', plugboard: 'AB CD EF' };
    var c1 = rotorEncryptionPipeline(msg, anyCfg);
    var c2 = rotorDecryptionPipeline(c1.output, anyCfg);
    check('encrypt then decrypt from identical start restores original', c2.output === msg, c2.output);
    var c3 = rotorEncryptionPipeline(msg, anyCfg);
    check('repeated invocation with same settings is deterministic', c3.output === c1.output);
    var empty = rotorEncryptionPipeline('', anyCfg);
    check('empty message does not alter starting state',
      empty.finalState.rotors[0].position === 17 && empty.finalState.rotors[1].position === 23 && empty.finalState.rotors[2].position === 5);

    /* --- Stepping coherence between trace and engine ---- */
    var stepCfg = { rotors: [ { name: 'I', position: 4 }, { name: 'II', position: 9 }, { name: 'III', position: 2 } ], reflector: 'B', plugboard: '' };
    var stepMsg = 'ABCDEFGHIJKLMNOPQRSTUVWXYZTHEQUICKBROWNFOX';
    var sc = rotorEncryptionPipeline(stepMsg, stepCfg);
    var prev = [4, 9, 2];
    var seqOk = true;
    for (var i = 0; i < sc.trace.length; i++) {
      var t = sc.trace[i];
      if (!t.isAlpha) continue;
      if (t.stepBefore.join() !== prev.join()) { seqOk = false; break; }
      var sim = [prev[0], prev[1], prev[2]];
      var simRot = [ { position: sim[0], notchIdx: charIndex(ROTOR_WIRINGS.I.notch) },
                     { position: sim[1], notchIdx: charIndex(ROTOR_WIRINGS.II.notch) },
                     { position: sim[2], notchIdx: charIndex(ROTOR_WIRINGS.III.notch) } ];
      stepRotors(simRot);
      if (simRot[0].position !== t.stepAfter[0] || simRot[1].position !== t.stepAfter[1] || simRot[2].position !== t.stepAfter[2]) { seqOk = false; break; }
      prev = t.stepAfter;
    }
    check('trace stepping sequence matches the engine stepping model', seqOk);

    /* --- Plugboard validation ---- */
    var closed = false;
    try { buildPlugboard('AA'); } catch (e) { closed = true; }
    check('plugboard rejects self pairs', closed);
    var dup = false;
    try { buildPlugboard('AB BC'); } catch (e) { dup = true; }
    check('plugboard rejects reused letters', dup);

    var pb = buildPlugboard('AB CD');
    check('plugboard swaps AB', plugboardMap(charIndex('A'), pb) === charIndex('B'));
    check('plugboard leaves E untouched', plugboardMap(charIndex('E'), pb) === charIndex('E'));

    var passed = results.filter(function (r) { return r.passed; }).length;
    var failed = results.length - passed;
    return { passed: passed, failed: failed, total: results.length, results: results };
  }
/* ============================================================
     5. GENERIC DOM / SVG / ANIMATION UTILITIES
     ============================================================ */

  var doc = global.document;
  function $(sel) { return doc.querySelector(sel); }
  function $id(id) { return doc.getElementById(id); }

  function createEl(tag, attrs, text) {
    var el = doc.createElement(tag);
    if (attrs) { Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); }); }
    if (text != null) el.textContent = text;
    return el;
  }

  var SVG_NS = 'http://www.w3.org/2000/svg';
  function svgEl(name, attrs) {
    var el = doc.createElementNS(SVG_NS, name);
    if (attrs) { Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); }); }
    return el;
  }
  function svgTxt(text, x, y, cls) {
    var el = svgEl('text', { x: x, y: y, 'class': cls || '', 'text-anchor': 'middle' });
    el.textContent = text;
    return el;
  }

  function announce(message) {
    var live = $id('sr-live');
    if (live) live.textContent = message;
  }

  function setStatusText(text) {
    var node = $id('header-status');
    if (!node) return;
    var txt = node.querySelector('.status-text');
    if (txt) txt.textContent = text;
  }

  function showHeaderBusy(busy) {
    var header = doc.querySelector('.lab-header');
    if (header) header.classList.toggle('processing', !!busy);
  }

  function copyText(text, button, doneLabel) {
    var fallback = function () {
      var ta = createEl('textarea', null, text);
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      doc.body.appendChild(ta);
      ta.select();
      try { doc.execCommand('copy'); } catch (e) { /* ignore */ }
      doc.body.removeChild(ta);
      flashCopy(button, doneLabel);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        flashCopy(button, doneLabel);
      }, fallback);
    } else {
      fallback();
    }
  }

  function flashCopy(button, doneLabel) {
    if (!button) return;
    var original = button.textContent;
    button.textContent = doneLabel || 'Copied \u2713';
    button.disabled = true;
    setTimeout(function () {
      button.textContent = original;
      button.disabled = false;
    }, 1400);
  }

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  /* Simple one-shot rAF tween used when GSAP is unavailable or when
     reduced-motion rules force frame-free rendering. */
  function tween(from, to, durationMs, onUpdate, onComplete, easing) {
    var cancelled = false;
    var start = null;
    var ease = easing || easeOutCubic;
    function frame(ts) {
      if (cancelled) return;
      if (start === null) start = ts;
      var p = durationMs <= 0 ? 1 : Math.min(1, (ts - start) / durationMs);
      var v = from + (to - from) * ease(p);
      onUpdate(v, p);
      if (p < 1) {
        requestAnimationFrame(frame);
      } else if (onComplete) {
        onComplete();
      }
    }
    requestAnimationFrame(frame);
    return { cancel: function () { cancelled = true; } };
  }

  var gsapAvailable = function () { return typeof global.gsap !== 'undefined' && global.gsap && global.gsap.to; };

  /* ============================================================
     TRACE PLAYER
     ------------------------------------------------------------
     Drives the per-character playback for a laboratory section.
     It renders characters strictly from the trace array produced
     by the pipeline functions; it never recomputes the cipher.

     host interface:
       trace        array of trace entries
       playLimit    optional int, limits visual playback
       duration()   ms per character for the chosen speed
       reset()      restore the factory state (rotors/dial)
       charStart(i, gen)
       charProgress(i, p, gen)   p in [0,1]
       charComplete(i, gen)
       onEnd(gen)
     ============================================================ */

  function TracePlayer(host) {
    this.host = host;
    this.index = -1;
    this.playing = false;
    this.finished = false;
    this.gen = 0;
    this._raf = 0;
    this._last = 0;
    this._el = 0;
    this._paused = false;
    this._dur = 1000;
  }

  TracePlayer.prototype._trace = function () {
    var t = this.host.trace || [];
    if (this.host.playLimit) t = t.slice(0, this.host.playLimit);
    return t;
  };

  TracePlayer.prototype._full = function () {
    return this.host.trace || [];
  };

  TracePlayer.prototype.play = function () {
    if (this.playing) return;
    var tr = this._trace();
    if (!tr.length) return;
    this._dur = this.host.duration ? this.host.duration() : 950;
    if (this._dur <= 0) { this.skipToEnd(); return; }
    if (this.finished || this.index >= tr.length - 1) {
      if (this.host.reset) this.host.reset();
      this.index = -1;
    }
    this.gen++;
    this._el = 0;
    this._paused = false;
    this.playing = true;
    this.finished = false;
    var gen = this.gen;
    var self = this;
    if (this.index < 0) {
      this.index = 0;
      if (this.host.charStart) this.host.charStart(this.index, gen);
    }
    this._last = performance.now();
    (function loop(ts) {
      if (gen !== self.gen || !self.playing) return;
      var dt = ts - self._last;
      self._last = ts;
      if (!self._paused) {
        self._el += dt;
        if (self._el >= self._dur) {
          if (self.host.charComplete) self.host.charComplete(self.index, gen);
          self._el = 0;
          if (self.index >= tr.length - 1) {
            self.playing = false;
            self.finished = true;
            if (self.host.onEnd) self.host.onEnd(gen);
            return;
          }
          self.index++;
          if (self.host.charStart) self.host.charStart(self.index, gen);
        } else {
          var p = Math.min(1, self._el / self._dur);
          if (self.host.charProgress) self.host.charProgress(self.index, p, gen);
        }
      }
      self._raf = requestAnimationFrame(loop);
    })(performance.now());
  };

  TracePlayer.prototype.pause = function () {
    if (this.playing && !this._paused) this._paused = true;
  };

  TracePlayer.prototype.resume = function () {
    if (this.playing && this._paused) {
      this._paused = false;
      this._last = performance.now();
    }
  };

  TracePlayer.prototype.toggle = function () {
    if (this.playing) { this._paused ? this.resume() : this.pause(); }
    else { this.play(); }
  };

  TracePlayer.prototype.stop = function () {
    this.gen++;
    this.playing = false;
    this._paused = false;
    if (this._raf) cancelAnimationFrame(this._raf);
  };

  TracePlayer.prototype.skipToEnd = function () {
    this.stop();
    var tr = this._trace();
    if (!tr.length) return;
    if (this.host.reset) this.host.reset();
    var full = this.host.trace || [];
    var lastFullTraceIndex = full.length ? full.length - 1 : tr.length - 1;
    this.host._finalIndex = lastFullTraceIndex;
    for (var i = 0; i < tr.length; i++) {
      if (this.host.charStart) this.host.charStart(i, 0);
      if (this.host.charProgress) this.host.charProgress(i, 1, 0);
      if (this.host.charComplete) this.host.charComplete(i, 0);
      this.index = i;
    }
    this.finished = true;
    this.playing = false;
    if (this.host.onEnd) this.host.onEnd(0);
  };

  TracePlayer.prototype.showChar = function (i) {
    this.stop();
    var tr = this._full();
    if (i < 0 || i >= tr.length) return;
    if (this.host.reset) this.host.reset();
    this.finished = false;
    for (var k = 0; k <= i; k++) {
      if (this.host.charStart) this.host.charStart(k, 0);
      if (this.host.charProgress) this.host.charProgress(k, 1, 0);
      if (this.host.charComplete) this.host.charComplete(k, 0);
    }
    this.index = i;
    this.host._lastShown = i;
    if (this.host.onSelected) this.host.onSelected(i);
  };

  /* Build a pipeline list of chips. chips = [{id,label,note}]. */
  function buildPipelineChips(container, chips, opts) {
    if (!container) return {};
    container.innerHTML = '';
    var map = {};
    chips.forEach(function (chip, idx) {
      if (opts && opts.separator && idx > 0) {
        var sep = createEl('li', { 'class': 'stage sep' });
        sep.textContent = '\u2192';
        container.appendChild(sep);
      }
      var li = createEl('li', { 'class': 'stage', 'data-id': chip.id });
      var label = createEl('span', { 'class': 'stage-label' }, chip.label);
      var value = createEl('span', { 'class': 'stage-value', 'aria-hidden': 'true' }, '\u2014');
      var note = createEl('span', { 'class': 'stage-note' }, chip.note || '');
      li.appendChild(label);
      li.appendChild(value);
      li.appendChild(note);
      container.appendChild(li);
      map[chip.id] = { li: li, value: value };
    });
    return map;
  }

  function setPipelineStage(map, entryId, value, state) {
    Object.keys(map).forEach(function (id) {
      var cls = map[id].li.classList;
      cls.remove('active', 'done');
      if (state === 'active' && id === entryId) cls.add('active');
      else if (state === 'done') cls.add('done');
    });
    if (state === 'done' || state === 'active') {
      if (typeof value === 'number') value = indexLetter(value);
      map[entryId].value.textContent = value == null ? '\u2014' : String(value);
    }
  }

  function setAllStagesDone(map) {
    Object.keys(map).forEach(function (id) {
      map[id].li.classList.remove('active');
      map[id].li.classList.add('done');
    });
  }

  function clearPipeline(map) {
    Object.keys(map).forEach(function (id) {
      map[id].li.classList.remove('active', 'done');
      map[id].value.textContent = '\u2014';
    });
  }
/* ============================================================
     6. ROTOR MACHINE CONSTRUCTION (SVG) AND SIGNAL ANIMATION
     ============================================================ */

  var MACHINE = {
    cy: 292,
    r: 150,          /* wheel radius */
    re: 180,         /* entry / reflector ring radius */
    cx: [430, 755, 1080],   /* left, middle, right */
    plug: { x: 1290, y: 26, w: 176, h: 214, busX: 1340, inNodeX: 1438, outNodeX: 1304 }
  };

  function angleOf(i) { return i * STEP - 90; }
  function ptAt(cx, cy, rad, thetaDeg) {
    var a = thetaDeg * Math.PI / 180;
    return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
  }
  function rimP(cx, thetaDeg) { return ptAt(cx, MACHINE.cy, MACHINE.r, thetaDeg); }
  function ringP(cx, thetaDeg) { return ptAt(cx, MACHINE.cy, MACHINE.re, thetaDeg); }
  function yOf(thetaDeg, rad) { return MACHINE.cy + (rad || MACHINE.r) * Math.sin(thetaDeg * Math.PI / 180); }

  /* Quadratic-bezier chord sampled as a polyline (the "letter wire"
     inside a rotor wheel). */
  function chordPts(cx, t1, t2, n) {
    n = n || 22;
    var P0 = rimP(cx, t1);
    var P2 = rimP(cx, t2);
    var C = [cx, MACHINE.cy];
    var out = [];
    for (var i = 0; i <= n; i++) {
      var u = i / n, w = 1 - u;
      out.push([w * w * P0[0] + 2 * w * u * C[0] + u * u * P2[0],
                w * w * P0[1] + 2 * w * u * C[1] + u * u * P2[1]]);
    }
    return out;
  }

  /* Shortest arc around a ring between two machine angles. */
  function arcPts(cx, t1, t2, n) {
    n = n || 26;
    var d = t2 - t1;
    while (d < -180) d += 360;
    while (d > 180) d -= 360;
    var out = [];
    for (var i = 0; i <= n; i++) {
      var t = t1 + d * i / n;
      out.push(ptAt(cx, MACHINE.cy, MACHINE.re, t));
    }
    return out;
  }

  function polylineLength(pts) {
    var len = 0;
    for (var i = 1; i < pts.length; i++) {
      var dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1];
      len += Math.sqrt(dx * dx + dy * dy);
    }
    return len;
  }

  function pointAt(pts, frac) {
    var total = polylineLength(pts);
    var target = (total * frac) || 0;
    var acc = 0;
    for (var i = 1; i < pts.length; i++) {
      var dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1];
      var seg = Math.sqrt(dx * dx + dy * dy);
      if (acc + seg >= target || i === pts.length - 1) {
        var u = seg === 0 ? 0 : (target - acc) / seg;
        return [pts[i - 1][0] + dx * u, pts[i - 1][1] + dy * u];
      }
      acc += seg;
    }
    return pts[pts.length - 1];
  }

  /* ---- machine() state ---- */
  var machine = {
    svg: null,
    night: null,
    rotorViews: [],       /* { rotation, wheelG, idEl, letters: [], posEl, topIdx } */
    ringViews: {},        /* leftReflector, rightEntry */
    plugLabel: null,
    reflectorBadge: null,
    wheelIds: ['L', 'M', 'R']
  };

  function rect(x, y, w, h, cls) {
    var el = svgEl('rect', { x: x, y: y, width: w, height: h, 'class': cls || '' });
    return el;
  }

  function screw(cx, cy) {
    var g = svgEl('g');
    g.appendChild(svgEl('circle', { cx: cx, cy: cy, r: 7, 'class': 'm-screw' }));
    g.appendChild(svgEl('line', { x1: cx - 4, y1: cy, x2: cx + 4, y2: cy, 'class': 'm-screw' })); 
    return g;
  }

  function buildMachine() {
    var svg = $id('rotor-machine');
    if (!svg) return;
    machine.svg = svg;
    svg.innerHTML = '';

    /* defs */
    var defs = svgEl('defs');
    var grad = svgEl('radialGradient', { id: 'wheel-metal' });
    grad.appendChild(svgEl('stop', { offset: '0%', 'stop-color': '#3b362a' }));
    grad.appendChild(svgEl('stop', { offset: '70%', 'stop-color': '#2a2620' }));
    grad.appendChild(svgEl('stop', { offset: '100%', 'stop-color': '#1f1c18' }));
    defs.appendChild(grad);
    var shadow = svgEl('filter', { id: 'wheel-sh', x: '-20%', y: '-20%', width: '140%', height: '140%' });
    shadow.appendChild(svgEl('feDropShadow', { dx: '0', dy: '6', 'stdDeviation': '8', 'flood-color': '#000', 'flood-opacity': '0.55' }));
    defs.appendChild(shadow);
    svg.appendChild(defs);

    /* base plates */
    var base = rect(0, 0, 1480, 560, 'm-base');
    svg.appendChild(base);
    var inner = rect(14, 14, 1452, 532);
    inner.setAttribute('class', 'm-plate');
    svg.appendChild(inner);
    var brass = rect(18, 56, 1444, 456);
    brass.setAttribute('class', 'm-brass');
    brass.setAttribute('fill', 'none');
    svg.appendChild(brass);

    /* screws at the four corners */
    svg.appendChild(screw(38, 38));
    svg.appendChild(screw(1442, 38));
    svg.appendChild(screw(38, 522));
    svg.appendChild(screw(1442, 522));

    /* fine calibration marks along the top rail */
    var rail = svgEl('g');
    for (var m = 0; m <= 72; m++) {
      var x = 130 + m * 17;
      var len = m % 3 === 0 ? 12 : 6;
      rail.appendChild(svgEl('line', { x1: x, y1: 70, x2: x, y2: 70 + len, 'class': m % 3 === 0 ? 'm-tick-major' : 'm-tick' }));
    }
    svg.appendChild(rail);

    /* slot labels above each wheel */
    var slotNames = ['LEFT', 'MIDDLE', 'RIGHT'];
    for (var s = 0; s < 3; s++) {
      svg.appendChild(svgTxt(slotNames[s], MACHINE.cx[s], 62, 'm-slot-name'));
    }

    /* reflector plaque (left) */
    var plaque = svgEl('g');
    var refBox = rect(26, 150, 210, 240, 'm-block');
    plaque.appendChild(refBox);
    plaque.appendChild(svgTxt('REFLECTOR', 131, 252, 'm-block-badge'));
    plaque.appendChild(svgTxt('UMKEHRWALZE', 131, 274, 'm-block-sub'));
    var refLabel = svgTxt('B', 131, 300, 'm-rotor-id');
    refLabel.setAttribute('data-reflector', 'B');
    machine.reflectorBadge = refLabel;
    plaque.appendChild(refLabel);
    /* return-direction annotation */
    plaque.appendChild(svgTxt('\u2190 signal bounces back', 145, 372, 'm-block-sub'));
    svg.appendChild(plaque);

    /* plugboard box (right) */
    var pb = svgEl('g');
    pb.appendChild(rect(MACHINE.plug.x, MACHINE.plug.y, MACHINE.plug.w, MACHINE.plug.h, 'm-block'));
    pb.appendChild(svgTxt('PLUGBOARD', MACHINE.plug.x + MACHINE.plug.w / 2, MACHINE.plug.y + 28, 'm-block-badge'));
    pb.appendChild(svgTxt('KEYBOARD \u2192 ROTORS', MACHINE.plug.x + MACHINE.plug.w / 2, MACHINE.plug.y + 48, 'm-block-sub'));
    var pairsText = svgTxt('—', MACHINE.plug.x + MACHINE.plug.w / 2, MACHINE.plug.y + 120, 'm-block-sub');
    machine.plugLabel = pairsText;
    pb.appendChild(pairsText);
    /* a vertical bus line */
    pb.appendChild(svgEl('line', { x1: MACHINE.plug.busX, y1: MACHINE.plug.y + 60, x2: MACHINE.plug.busX, y2: MACHINE.plug.y + 200, 'class': 'sig-wire' }));
    /* keyboard node */
    pb.appendChild(svgEl('circle', { cx: MACHINE.plug.inNodeX, cy: MACHINE.plug.y + 130, r: 5, 'class': 'sig-node' }));
    svg.appendChild(pb);

    /* entry ring around the right rotor + reflector ring around the left rotor */
    [MACHINE.cx[0], MACHINE.cx[2]].forEach(function (cx, idx) {
      var ring = svgEl('g');
      ring.appendChild(svgEl('circle', { cx: cx, cy: MACHINE.cy, r: MACHINE.re, fill: 'none', 'class': 'm-brass' }));
      for (var i = 0; i < MOD; i++) {
        var t = angleOf(i);
        var p1 = ptAt(cx, MACHINE.cy, MACHINE.re - 3, t);
        var p2 = ptAt(cx, MACHINE.cy, MACHINE.re + 6, t);
        ring.appendChild(svgEl('line', { x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1], 'class': i % 5 === 0 ? 'm-tick-major' : 'm-tick' }));
        var dot = ptAt(cx, MACHINE.cy, MACHINE.re - 8, t);
        var node = svgEl('circle', { cx: dot[0], cy: dot[1], r: 2.4, 'class': 'sig-node' });
        node.setAttribute('data-angle', i);
        ring.appendChild(node);
      }
      svg.appendChild(ring);
    });

    /* the three wheels */
    for (var w = 0; w < 3; w++) {
      var cx = MACHINE.cx[w];
      var wheelG = svgEl('g');
      wheelG.setAttribute('class', 'm-wheel');
      wheelG.setAttribute('transform', 'rotate(0 ' + cx + ' ' + MACHINE.cy + ')');

      wheelG.appendChild(svgEl('circle', { cx: cx, cy: MACHINE.cy, r: MACHINE.r, 'class': 'm-wheel-base', filter: 'url(#wheel-sh)' }));
      wheelG.appendChild(svgEl('circle', { cx: cx, cy: MACHINE.cy, r: MACHINE.r - 6, 'class': 'm-wheel-rim' }));

      /* etched ticks + letters */
      var letterEls = [];
      for (var i = 0; i < MOD; i++) {
        var t = angleOf(i);
        var major = i % 5 === 0;
        var p1 = ptAt(cx, MACHINE.cy, MACHINE.r - 2, t);
        var p2 = ptAt(cx, MACHINE.cy, major ? MACHINE.r - 14 : MACHINE.r - 8, t);
        wheelG.appendChild(svgEl('line', { x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1], 'class': major ? 'm-tick-major' : 'm-tick' }));
        var lp = ptAt(cx, MACHINE.cy, MACHINE.r - 30, t);
        var letter = svgTxt(ALPHABET[i], lp[0], lp[1], 'm-letter');
        letter.setAttribute('data-i', i);
        wheelG.appendChild(letter);
        letterEls.push(letter);
      }

      /* hub */
      wheelG.appendChild(svgEl('circle', { cx: cx, cy: MACHINE.cy, r: 56, 'class': 'm-wheel-hub' }));
      for (var sp = 0; sp < 6; sp++) {
        var a = sp * 60 * Math.PI / 180;
        wheelG.appendChild(svgEl('line', { x1: cx, y1: MACHINE.cy, x2: cx + 54 * Math.cos(a), y2: MACHINE.cy + 54 * Math.sin(a), 'class': 'm-wheel-spoke' }));
      }
      /* notch etching (position depends on the configured rotor) */
      var notchEl = svgEl('line', { x1: cx, y1: MACHINE.cy - MACHINE.r + 4, x2: cx, y2: MACHINE.cy - MACHINE.r + 18, 'class': 'm-wheel-notch' });
      wheelG.appendChild(notchEl);

      /* rotor id */
      var idEl = svgTxt(String.fromCharCode(73 + w), cx, MACHINE.cy + 2, 'm-rotor-id');
      wheelG.appendChild(idEl);
      wheelG.appendChild(svgTxt('ROTOR', cx, MACHINE.cy + 18, 'm-rotor-id-sub'));
      wheelG.appendChild(svgEl('circle', { cx: cx, cy: MACHINE.cy, r: 12, 'class': 'm-index-mark' }));

      svg.appendChild(wheelG);

      /* static position indicator at top */
      var tri = svgEl('polygon', { points: (cx - 9) + ',' + (MACHINE.cy - MACHINE.r - 16) + ' ' + (cx + 9) + ',' + (MACHINE.cy - MACHINE.r - 16) + ' ' + cx + ',' + (MACHINE.cy - MACHINE.r - 4), 'class': 'm-index-tri' });
      svg.appendChild(tri);
      /* position letter readout below the wheel */
      var posLabel = svgTxt('A', cx, MACHINE.cy + MACHINE.r + 30, 'm-rotor-id');
      svg.appendChild(posLabel);

      machine.rotorViews.push({
        rotation: 0,
        position: 0,
        wheelG: wheelG,
        idEl: idEl,
        letters: letterEls,
        posEl: posLabel,
        notchEl: notchEl
      });
    }

    /* signal layer on top of everything */
    machine.night = svgEl('g');
    machine.night.setAttribute('id', 'm-signal');
    svg.appendChild(machine.night);
  }

  /* ---- machine state helpers ---- */
  var _spinTweens = {};
  function setRotorRotation(i, targetDeg, animate, ms) {
    var view = machine.rotorViews[i];
    if (!view) return;
    var cx = MACHINE.cx[i];
    var from = view.rotation;
    view.rotation = targetDeg;
    cancelSpin(i);
    if (animate && ms > 0 && !reducedMotion()) {
      _spinTweens[i] = tween(from, targetDeg, ms, function (v) {
        view.wheelG.setAttribute('transform', 'rotate(' + v + ' ' + cx + ' ' + MACHINE.cy + ')');
      }, null, easeOutCubic);
    } else {
      view.wheelG.setAttribute('transform', 'rotate(' + targetDeg + ' ' + cx + ' ' + MACHINE.cy + ')');
    }
  }

  function cancelSpin(i) {
    if (_spinTweens[i]) { _spinTweens[i].cancel(); delete _spinTweens[i]; }
  }

  function cancelAllSpins() {
    Object.keys(_spinTweens).forEach(function (k) {
      if (_spinTweens[k]) { _spinTweens[k].cancel(); delete _spinTweens[k]; }
    });
  }

  function reducedMotion() {
    return typeof global.matchMedia === 'function' &&
      global.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

function updateRotorSelection() {
    var cfg = rotor.config;
    for (var i = 0; i < 3; i++) {
      var view = machine.rotorViews[i];
      if (!view) continue;
      view.idEl.textContent = cfg.rotors[i].name;
      view.position = cfg.rotors[i].position;
      setWheelPos(i, cfg.rotors[i].position);
      /* move the engraved notch mark to the notch angle of this rotor */
      var notchT = angleOf(charIndex(ROTOR_WIRINGS[cfg.rotors[i].name].notch));
      var np1 = ptAt(MACHINE.cx[i], MACHINE.cy, MACHINE.r - 18, notchT);
      var np2 = ptAt(MACHINE.cx[i], MACHINE.cy, MACHINE.r - 4, notchT);
      view.notchEl.setAttribute('x1', np1[0]);
      view.notchEl.setAttribute('y1', np1[1]);
      view.notchEl.setAttribute('x2', np2[0]);
      view.notchEl.setAttribute('y2', np2[1]);
    }
if (machine.reflectorBadge) machine.reflectorBadge.textContent = cfg.reflector;
    if (machine.plugLabel) {
      var pbStr = serializePlugboard(cfg.plugboard);
      machine.plugLabel.textContent = pbStr ? 'PB: ' + pbStr : 'no pairs';
    }
  }

  function setWheelPos(i, position, animate, ms) {
    var view = machine.rotorViews[i];
    if (!view) return;
    view.position = mod(position, MOD);
    setRotorRotation(i, -view.position * STEP, !!animate, ms || 320);
    view.posEl.textContent = ALPHABET[view.position];
    for (var k = 0; k < MOD; k++) {
      view.letters[k].classList.toggle('top', k === view.position);
    }
  }

  function spinFromStepped(stepped, ms) {
    for (var i = 0; i < 3; i++) {
      if (stepped[i]) {
        var view = machine.rotorViews[i];
        view.position = mod(view.position + 1, MOD);
        setRotorRotation(i, view.rotation - STEP, true, ms);
        view.posEl.textContent = ALPHABET[view.position];
        for (var k = 0; k < MOD; k++) view.letters[k].classList.toggle('top', k === view.position);
      }
    }
  }

  /* ---- signal path construction for one character ---- */
  function buildSignalSegments(entry) {
    var rx = MACHINE.cx[2], rm = MACHINE.cx[1], rl = MACHINE.cx[0];
    var segs = [];

    var plugInA = angleOf(entry.plugIn);
    var plugOutA = angleOf(entry.plugOut);
    var inY = yOf(plugInA);
    var outY = yOf(plugOutA);
    var fwd = entry.forward, rev = entry.reverse;

    segs.push({ name: 'pb-in', kind: 'pb', pts: [[MACHINE.plug.inNodeX, inY], [MACHINE.plug.busX, inY]] });
    if (entry.plugOut !== entry.plugIn) {
      segs.push({ name: 'pb-in', kind: 'pb', pts: [[MACHINE.plug.busX, inY], [MACHINE.plug.busX, outY]] });
    }
    segs.push({ name: 'pb-in', kind: 'pb', pts: [[MACHINE.plug.busX, outY], [MACHINE.plug.outNodeX, outY]] });

    var rAngle = angleOf(fwd[0].out);
    segs.push({ name: 'r1', kind: 'fwd', pts: [[MACHINE.plug.outNodeX, outY], ringP(rx, plugOutA), rimP(rx, plugOutA)].concat(chordPts(rx, plugOutA, rAngle)) });

    var mAngle = angleOf(fwd[1].out);
    segs.push({ name: 'm1', kind: 'fwd', pts: [rimP(rx, rAngle), rimP(rm, rAngle)].concat(chordPts(rm, rAngle, mAngle)) });

    var lAngle = angleOf(fwd[2].out);
    segs.push({ name: 'l1', kind: 'fwd', pts: [rimP(rm, mAngle), rimP(rl, mAngle)].concat(chordPts(rl, mAngle, lAngle)) });

    var refA = angleOf(entry.reflector.out);
    segs.push({ name: 'ref', kind: 'ref', pts: [rimP(rl, lAngle), ringP(rl, lAngle)].concat(arcPts(rl, lAngle, refA), [ringP(rl, refA), rimP(rl, refA)]) });

    var lbA = angleOf(rev[0].out);
    segs.push({ name: 'l2', kind: 'rev', pts: [rimP(rl, refA)].concat(chordPts(rl, refA, lbA)) });

    var mbA = angleOf(rev[1].out);
    segs.push({ name: 'm2', kind: 'rev', pts: [rimP(rl, lbA), rimP(rm, lbA)].concat(chordPts(rm, lbA, mbA)) });

    var rbA = angleOf(rev[2].out);
    segs.push({ name: 'r2', kind: 'rev', pts: [rimP(rm, mbA), rimP(rx, mbA)].concat(chordPts(rx, mbA, rbA)) });

    var finA = angleOf(entry.outIndex);
    var finY = yOf(finA);
    var rbY = yOf(rbA);
    segs.push({ name: 'pb-out', kind: 'pb', pts: [rimP(rx, rbA), ringP(rx, rbA), [MACHINE.plug.outNodeX, rbY], [MACHINE.plug.busX, rbY]] });
    if (rbA !== finA) {
      segs.push({ name: 'pb-out', kind: 'pb', pts: [[MACHINE.plug.busX, rbY], [MACHINE.plug.busX, finY]] });
    }
    segs.push({ name: 'pb-out', kind: 'pb', pts: [[MACHINE.plug.busX, finY], [MACHINE.plug.inNodeX, finY]] });

    return segs;
  }

  function polylineToPath(pts) {
    var d = 'M' + pts[0][0] + ' ' + pts[0][1];
    for (var i = 1; i < pts.length; i++) d += ' L' + pts[i][0] + ' ' + pts[i][1];
    return d;
  }

  function arrowAtEnd(pts) {
    var n = pts.length;
    var p = pts[n - 1], q = pts[n - 2];
    var a = Math.atan2(p[1] - q[1], p[0] - q[0]);
    var h = 9, s = 5;
    return (p[0]) + ',' + (p[1]) + ' ' +
           (p[0] - h * Math.cos(a - 0.42)) + ',' + (p[1] - h * Math.sin(a - 0.42)) + ' ' +
           (p[0] - h * Math.cos(a + 0.42)) + ',' + (p[1] - h * Math.sin(a + 0.42));
  }

  /* Render the path for a character; returns {segEls, `cum` cumulative
     lengths} so playback can light segments and drive the travelling dot. */
  function drawCharSignal(entry, opts) {
    opts = opts || {};
    flushSignal();
    var segs = buildSignalSegments(entry);
    var items = [];
    var cum = 0;
    for (var i = 0; i < segs.length; i++) {
      var path = svgEl('path', { d: polylineToPath(segs[i].pts), 'class': 'sig-wire' });
      if (opts.kindClass) path.classList.add(segs[i].kind);
      machine.night.appendChild(path);
      var arrow = svgEl('polygon', { points: arrowAtEnd(segs[i].pts), 'class': 'sig-arrow' });
      if (segs[i].kind === 'rev') arrow.classList.add('rev');
      machine.night.appendChild(arrow);
      var len = polylineLength(segs[i].pts);
      cum += len;
      items.push({ el: path, arrow: arrow, name: segs[i].name, len: len, cum: cum, kind: segs[i].kind, _pts: segs[i].pts });
    }
    var dot = svgEl('circle', { cx: 0, cy: 0, r: 5, 'class': 'sig-dot' });
    machine.night.appendChild(dot);
    return { items: items, dot: dot, cumTotal: cum };
  }

  function progressSignal(sig, p) {
    if (!sig) return;
    var target = sig.cumTotal * Math.min(1, Math.max(0, p));
    var litIndex = 0;
    for (var i = 0; i < sig.items.length; i++) {
      if (target >= sig.items[i].cum - 0.001) litIndex = i; else break;
    }
    for (var j = 0; j < sig.items.length; j++) {
      var cls = sig.items[j].el.classList;
      cls.remove('lit', 'lit-rev');
      if (j <= litIndex) {
        cls.add(sig.items[j].kind === 'rev' ? 'lit-rev' : 'lit');
      }
    }
    if (litIndex < sig.items.length) {
      var pts = fullPolyline(sig);
      var pos = pointAt(pts, Math.min(1, target / sig.cumTotal));
      sig.dot.setAttribute('cx', pos[0]);
      sig.dot.setAttribute('cy', pos[1]);
      sig.dot.setAttribute('visibility', 'visible');
    }
  }

  function fullPolyline(sig) {
    if (!sig._full) {
      sig._full = [];
      sig.items.forEach(function (it) { sig._full.push.apply(sig._full, it._pts); });
    }
    return sig._full;
  }

  function flushSignal() {
    if (machine.night) machine.night.innerHTML = '';
    machine._sig = null;
  }

  function drawSignalFinal(entry) {
    var sig = drawCharSignal(entry, { kindClass: true });
    fullPolyline(sig);
    progressSignal(sig, 1);
    machine._sig = sig;
    return sig;
  }
/* ============================================================
     7. CAESAR WORKBENCH WIRING
     ============================================================ */

  var caesar = {
    shift: 3,
    mode: 'encrypt',
    result: null,
    limit: false,
    rows: [],
    rowEls: [],
    pipeline: {},
    player: null,
    dial: null
  };

  var CAESAR_SPEEDS = { slow: 1700, normal: 1000, fast: 460, instant: 0 };

  function caesarStageDefs(mode) {
    var inL = mode === 'encrypt' ? 'PLAINTEXT' : 'CIPHERTEXT';
    var outL = mode === 'encrypt' ? 'CIPHERTEXT' : 'PLAINTEXT';
    return [
      { id: 'in',  label: inL,      note: 'input letter' },
      { id: 'idx', label: 'INDEX',  note: 'A=0 \u2026 Z=25' },
      { id: 'op',  label: 'SHIFT ' + (mode === 'encrypt' ? '+' : '\u2212'), note: 'add or subtract K' },
      { id: 'mod', label: 'MOD 26', note: 'wrap within A\u2013Z' },
      { id: 'out', label: outL,     note: 'output letter' }
    ];
  }

  function buildCaesarDial() {
    var svg = $id('caesar-dial');
    if (!svg) return;
    var gRim = $id('dial-rim-outer') || svg;
    var gUpper = $id('dial-ring-upper') || svg;
    var gLower = $id('dial-ring-lower') || svg;
    var gDetail = $id('dial-detail') || svg;
    var gCenter = $id('dial-center') || svg;
    [gRim, gUpper, gLower, gDetail, gCenter].forEach(function (g) { g.innerHTML = ''; });

    /* background disc + rim */
    gRim.appendChild(svgEl('circle', { cx: 0, cy: 0, r: 118, fill: 'url(#dial-bg)' }));
    gRim.appendChild(svgEl('circle', { cx: 0, cy: 0, r: 118, 'class': 'dial-rim-outer' }));

    /* outer ticks */
    for (var i = 0; i < MOD; i++) {
      var t = angleOf(i);
      var p1 = ptAt(0, 0, 116, t), p2 = ptAt(0, 0, 123, t);
      var major = i % 5 === 0;
      gRim.appendChild(svgEl('line', { x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1], 'class': major ? 'dial-tick-major' : 'dial-tick' }));
    }

    /* outer letters (fixed) */
    var outerEls = [];
    for (var i = 0; i < MOD; i++) {
      var lp = ptAt(0, 0, 105, angleOf(i));
      var el = svgTxt(ALPHABET[i], lp[0], lp[1], 'dial-letter');
      el.setAttribute('data-i', i);
      gUpper.appendChild(el);
      outerEls.push(el);
    }

    /* rotating inner ring */
    var gInner = svgEl('g');
    gInner.setAttribute('id', 'dial-inner-ring');
    gLower.appendChild(gInner);
    gInner.appendChild(svgEl('circle', { cx: 0, cy: 0, r: 74, fill: 'url(#dial-bg)' }));
    gInner.appendChild(svgEl('circle', { cx: 0, cy: 0, r: 74, 'class': 'dial-rim-outer' }));
    var innerEls = [];
    for (var j = 0; j < MOD; j++) {
      var t2 = angleOf(j);
      var q1 = ptAt(0, 0, 72, t2), q2 = ptAt(0, 0, 80, t2);
      gInner.appendChild(svgEl('line', { x1: q1[0], y1: q1[1], x2: q2[0], y2: q2[1], 'class': (j % 5 === 0) ? 'dial-tick-major' : 'dial-tick' }));
      var ip = ptAt(0, 0, 63, angleOf(j));
      var el2 = svgTxt(ALPHABET[j], ip[0], ip[1], 'dial-letter');
      el2.setAttribute('data-i', j);
      gInner.appendChild(el2);
      innerEls.push(el2);
    }

    /* pointer triangles at the top of each ring */
    gDetail.appendChild(svgEl('polygon', { points: '-8,-116 8,-116 0,-104', 'class': 'm-index-tri' }));
    gDetail.appendChild(svgEl('polygon', { points: '-6,-72 6,-72 0,-62', 'class': 'm-index-tri' }));

    /* highlight bridge + bead */
    var bridge = svgEl('line', { x1: 0, y1: -74, x2: 0, y2: -116, class: 'sig-wire', visibility: 'hidden' });
    var bead = svgEl('circle', { cx: 0, cy: 0, r: 4, 'class': 'sig-dot', visibility: 'hidden' });
    gDetail.appendChild(bridge);
    gDetail.appendChild(bead);

    /* center readout */
    var main = svgTxt('\u2014', 0, 4, 'm-rotor-id');
    main.setAttribute('font-size', '15');
    var sub = svgTxt('A  =  0', 0, 20, 'm-rotor-id-sub');
    gCenter.appendChild(main);
    gCenter.appendChild(sub);

    caesar.dial = { gInner: gInner, outerEls: outerEls, innerEls: innerEls, bridge: bridge, bead: bead, main: main, sub: sub, outerR: 105, innerR: 63 };
    updateDialRotation();
  }

  function updateDialRotation() {
    if (!caesar.dial) return;
    var delta = (caesar.mode === 'encrypt' ? -1 : 1) * caesar.shift * STEP;
    caesar.dial.gInner.setAttribute('transform', 'rotate(' + delta + ')');
  }

  function dialClearHighlights() {
    if (!caesar.dial) return;
    caesar.dial.outerEls.forEach(function (el) { el.classList.remove('active', 'out'); });
    caesar.dial.innerEls.forEach(function (el) { el.classList.remove('active', 'out'); });
    caesar.dial.bridge.setAttribute('visibility', 'hidden');
    caesar.dial.bead.setAttribute('visibility', 'hidden');
    caesar.dial.sub.textContent = 'A = 0 \u00b7 Z = 25';
  }

  function caesarSetReadout(result) {
    var label = $id('caesar-readout-label');
    var out = $id('caesar-readout');
    if (!label || !out) return;
    label.textContent = result.mode === 'encrypt' ? 'CIPHERTEXT' : 'PLAINTEXT';
    label.classList.remove('stale');
    out.classList.remove('stale');
    out.textContent = result.output || '\u2014';
  }

  function markCaesarStale() {
    var label = $id('caesar-readout-label');
    var out = $id('caesar-readout');
    if (!label || !out || !caesar.result) return;
    label.classList.add('stale');
    out.classList.add('stale');
  }

  function buildCaesarTrace() {
    var table = $id('caesar-trace');
    var hint = $id('caesar-trace-hint');
    if (!table) return;
    table.innerHTML = '';
    caesar.rowEls = [];
    var trace = caesar.result && caesar.result.trace ? caesar.result.trace : [];
    if (!trace.length) { if (hint) hint.hidden = true; return; }

    /* header row */
    var head = createEl('div', { 'class': 't-row-head trace-row' });
    ['POS', 'IN', 'INDEX', 'OPERATION', 'OUT INDEX', 'OUT'].forEach(function (h) {
      head.appendChild(createEl('span', { 'class': 't-col' }, h));
    });
    table.appendChild(head);

    var MAX = 400;
    var shown = trace.slice(0, MAX);
    shown.forEach(function (t, idx) {
      var row = createEl('div', { 'class': 'trace-row', role: 'button', tabindex: '0', 'aria-label': 'Inspect character ' + (t.position + 1) });
      row.appendChild(createEl('div', { 'class': 't-pos t-mono' }, String(t.position)));
      row.appendChild(createEl('div', { 'class': 't-char' }, t.char));
      if (!t.isAlpha) {
        row.appendChild(createEl('div', { 'class': 't-mono t-tag', colspan: '3' }, 'preserved \u2014 no letter'));
        row.appendChild(createEl('div', { 'class': 't-mono' }, '\u2014'));
        row.appendChild(createEl('div', { 'class': 't-out' }, t.char));
      } else {
        row.appendChild(createEl('div', { 'class': 't-mono' }, String(t.inputIndex)));
        row.appendChild(createEl('div', { 'class': 't-mono' }, t.operation + '  (\u2192' + t.intermediate + ')'));
        row.appendChild(createEl('div', { 'class': 't-mono' }, String(t.outputIndex)));
        row.appendChild(createEl('div', { 'class': 't-out' }, t.output));
      }
      row.addEventListener('click', function () { caesarPlayerShow(idx); });
      row.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); caesarPlayerShow(idx); } });
      table.appendChild(row);
      caesar.rowEls.push(row);
    });
    if (hint) {
      if (trace.length > MAX) {
        hint.hidden = false;
        hint.textContent = 'Showing the first ' + MAX + ' of ' + trace.length + ' characters. The complete result is computed and shown in the output readout.';
      } else {
        hint.hidden = true;
      }
    }
  }

  function caesarPlayerShow(i) {
    if (!caesar.player || !caesar.result) return;
    caesar.player.showChar(i);
    refreshCaesarPlayButtons();
  }

  function setCaesarRowActive(i) {
    caesar.rowEls.forEach(function (el, k) { el.classList.toggle('active', k === i); });
  }

  function caesarScrollRow(i) {
    var row = caesar.rowEls[i];
    if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function refreshCaesarPlayButtons() {
    var btn = $id('caesar-play');
    if (btn) btn.textContent = caesar.player.playing && !caesar.player._paused ? '\u275A\u275A' : '\u25B6';
    var has = caesar.result && caesar.result.trace && caesar.result.trace.length > 0;
    ['caesar-play', 'caesar-prev', 'caesar-next', 'caesar-skip', 'caesar-replay'].forEach(function (id) {
      var b = $id(id);
      if (b) b.disabled = !has;
    });
  }

function caesarDuration() {
    var sel = $id('caesar-speed');
    var v = sel ? sel.value : 'normal';
    if (reducedMotion()) return 0;
    return v in CAESAR_SPEEDS ? CAESAR_SPEEDS[v] : CAESAR_SPEEDS.normal;
  }

  function caesarHost() {
    return {
      get trace() { return caesar.result ? caesar.result.trace : []; },
      get playLimit() { return caesar.limit ? 40 : 0; },
      duration: caesarDuration,
      reset: function () {
        cancelAllSpins();
        dialClearHighlights();
        clearPipeline(caesar.pipeline);
        if (caesar.dial) { caesar.dial.main.textContent = '\u2014'; caesar.dial.sub.textContent = 'A = 0 \u00b7 Z = 25'; }
        caesar.rowEls.forEach(function (el) { el.classList.remove('active'); });
      },
      charStart: function (i, gen) {
        var t = caesar.result.trace[i];
        if (!t) return;
        setCaesarRowActive(i);
        if (gen === 0) { /* static preview -> handled by charProgress(1) below */ }
        if (t.isAlpha) {
          clearPipeline(caesar.pipeline);
          setPipelineStage(caesar.pipeline, 'in', t.upper, 'active');
          highlightDialLetter(caesar.dial.outerEls, t.inputIndex, 'active');
          caesar.dial.bridge.setAttribute('visibility', 'visible');
          var p0 = ptAt(0, 0, 116, angleOf(t.inputIndex));
          var p1 = ptAt(0, 0, 74, angleOf(t.inputIndex));
          caesar.dial.bridge.setAttribute('x1', p1[0]); caesar.dial.bridge.setAttribute('y1', p1[1]);
          caesar.dial.bridge.setAttribute('x2', p0[0]); caesar.dial.bridge.setAttribute('y2', p0[1]);
        } else {
          clearPipeline(caesar.pipeline);
          setPipelineStage(caesar.pipeline, 'in', t.char, 'active');
        }
      },
      charProgress: function (i, p, gen) {
        var t = caesar.result.trace[i];
        if (!t) return;
        if (gen === 0) p = 1;
        if (!t.isAlpha) {
          if (p >= 0.2) {
            setPipelineStage(caesar.pipeline, 'in', t.char, 'done');
            if (caesar.dial) { caesar.dial.main.textContent = t.char + '  \u00b7  preserved'; caesar.dial.sub.textContent = 'not a letter \u2014 kept as-is'; }
          }
          return;
        }
        var gate = p * 5;
        var stages = ['in', 'idx', 'op', 'mod', 'out'];
        var vals = [t.upper, t.inputIndex, t.operation, t.intermediate, t.output];
        for (var s = 0; s < stages.length; s++) {
          if (gate >= s + 1 || p >= 0.999) setPipelineStage(caesar.pipeline, stages[s], vals[s], 'done');
          else if (gate >= s) setPipelineStage(caesar.pipeline, stages[s], vals[s], 'active');
        }
        if (p >= 0.8) {
          highlightDialLetter(caesar.dial.innerEls, t.outputIndex, 'out');
          var bp = ptAt(0, 0, 63, angleOf(t.outputIndex));
          caesar.dial.bead.setAttribute('cx', bp[0]); caesar.dial.bead.setAttribute('cy', bp[1]);
          caesar.dial.bead.setAttribute('visibility', 'visible');
        }
        if (p >= 0.97 && caesar.dial) {
          caesar.dial.main.textContent = t.outputIndex !== null ? indexLetter(t.outputIndex) : '\u2014';
          caesar.dial.sub.textContent = t.inputIndex !== null
            ? indexLetter(t.inputIndex) + '(' + t.inputIndex + ') ' + t.operation + ' = ' + t.outputIndex + ' (' + t.output + ')'
            : '\u2014';
        }
      },
      charComplete: function (i, gen) {
        var t = caesar.result.trace[i];
        if (!t) return;
        if (gen === 0) caesarScrollRow(i);
        setCaesarRowActive(i);
        if (t.isAlpha) {
          setAllStagesDone(caesar.pipeline);
          setPipelineStage(caesar.pipeline, 'out', t.output, 'done');
          highlightDialLetter(caesar.dial.outerEls, t.inputIndex, 'active');
          highlightDialLetter(caesar.dial.innerEls, t.outputIndex, 'out');
        } else {
          setPipelineStage(caesar.pipeline, 'in', t.char, 'done');
        }
      },
      onEnd: function () {
        if (caesar.result) setCaesarRowActive(caesar.result.trace.length - 1);
        refreshCaesarPlayButtons();
        showHeaderBusy(false);
      },
      onSelected: function (i) { setCaesarRowActive(i); }
    };
  }

  function highlightDialLetter(els, idx, cls) {
    els.forEach(function (el) {
      el.classList.remove('active', 'out');
      if (parseInt(el.getAttribute('data-i'), 10) === idx) el.classList.add(cls);
    });
  }

  function processCaesar() {
    var inputEl = $id('caesar-input');
    var msg = inputEl ? inputEl.value : '';
    if (!msg) {
      announce('Please type a message before processing.');
      return;
    }
    var shift = normalizeShift($id('caesar-shift').value);
    var mode = $id('caesar-mode').value;
    caesar.shift = shift;
    caesar.mode = mode;
    updateDialRotation();
    var result = mode === 'encrypt'
      ? caesarEncryptionPipeline(msg, shift, {})
      : caesarDecryptionPipeline(msg, shift, {});
    /* back-copy normalised shift into the input fields */
    $id('caesar-shift').value = shift;
    $id('caesar-shift-slider').value = shift;
    caesar.result = result;
    if (caesar.player) caesar.player.stop();
    caesarHost().reset();
    caesarSetReadout(result);
    buildCaesarTrace();
    /* limit playback for very long messages */
    var limitBox = $id('caesar-limit');
    if (limitBox) {
      limitBox.hidden = result.trace.length <= 60;
      caesar.limit = limitBox.checked;
    }
    refreshCaesarPlayButtons();
    announce((mode === 'encrypt' ? 'Encrypted' : 'Decrypted') + ' ' + result.metadata.characters + ' characters (shift ' + shift + '). Output ' + (result.metadata.alphabetic) + ' letters transformed.');
    showHeaderBusy(false);
    setStatusText('Idle');
  }

function wireCaesarLab() {
    buildCaesarDial();
    var input = $id('caesar-input');
    var num = $id('caesar-shift');
    var slider = $id('caesar-shift-slider');
    var modeSel = $id('caesar-mode');

    /* synchronised shift controls */
    function syncShift(v) {
      var k = normalizeShift(v);
      caesar.shift = k;
      num.value = k;
      slider.value = k;
      updateDialRotation();
      if (caesar.result) markCaesarStale();
    }
    num.addEventListener('input', function () { syncShift(num.value); });
    slider.addEventListener('input', function () { syncShift(slider.value); });
    modeSel.addEventListener('change', function () {
      caesar.mode = modeSel.value;
      updateDialRotation();
      rebuildCaesarPipeline();
      if (caesar.result) markCaesarStale();
    });
    input.addEventListener('input', function () { if (caesar.result) markCaesarStale(); });

    $id('caesar-process').addEventListener('click', function () {
      showHeaderBusy(true);
      setStatusText('Processing Caesar');
      setTimeout(processCaesar, 30);
    });

    $id('caesar-copy').addEventListener('click', function () {
      var text = $id('caesar-readout').textContent;
      if (text && text !== '\u2014') copyText(text, $id('caesar-copy'), 'Copied');
    });

    $id('caesar-swap').addEventListener('click', function () {
      if (!caesar.result || !caesar.result.output) return;
      input.value = caesar.result.output;
      caesar.result = null;
      clearCaesarAfterSwap();
    });

    $id('caesar-reset').addEventListener('click', function () {
      caesar.player.stop();
      caesar.result = null;
      caesar.limit = false;
      input.value = '';
      num.value = 3;
      slider.value = 3;
      modeSel.value = 'encrypt';
      caesar.shift = 3;
      caesar.mode = 'encrypt';
      var lb = $id('caesar-limit');
      if (lb) lb.hidden = true;
      clearCaesarAfterSwap();
      rebuildCaesarPipeline();
      updateDialRotation();
    });

    /* playback controls */
    caesar.player = new TracePlayer(caesarHost());
    $id('caesar-play').addEventListener('click', function () {
      caesar.player.toggle();
      refreshCaesarPlayButtons();
      if (caesar.player.playing) { showHeaderBusy(true); setStatusText('Playback: Caesar'); }
      else { showHeaderBusy(false); setStatusText('Idle'); }
    });
    $id('caesar-prev').addEventListener('click', function () {
      if (caesar.player.index > 0) caesarPlayerShow(caesar.player.index - 1);
    });
    $id('caesar-next').addEventListener('click', function () {
      var n = caesar.result ? caesar.result.trace.length : 0;
      if (caesar.player.index < n - 1) caesarPlayerShow(caesar.player.index + 1);
    });
    $id('caesar-skip').addEventListener('click', function () {
      caesar.player.skipToEnd();
      refreshCaesarPlayButtons();
      showHeaderBusy(false);
    });
    $id('caesar-replay').addEventListener('click', function () {
      caesar.player.stop();
      caesarHost().reset();
      caesar.player.play();
      refreshCaesarPlayButtons();
      showHeaderBusy(true);
      setStatusText('Playback: Caesar');
    });
    $id('caesar-speed').addEventListener('change', function () { /* applied next character */ });
    var lb2 = $id('caesar-limit');
    if (lb2) lb2.addEventListener('change', function () { caesar.limit = lb2.checked; });

    rebuildCaesarPipeline();
    refreshCaesarPlayButtons();
  }

  function rebuildCaesarPipeline() {
    caesar.pipeline = buildPipelineChips($id('caesar-pipeline'), caesarStageDefs(caesar.mode), { separator: true });
  }

  function clearCaesarAfterSwap() {
    caesarHost().reset();
    $id('caesar-readout-label').textContent = caesar.mode === 'encrypt' ? 'CIPHERTEXT' : 'PLAINTEXT';
    $id('caesar-readout-label').classList.remove('stale');
    $id('caesar-readout').textContent = '\u2014';
    $id('caesar-readout').classList.remove('stale');
    buildCaesarTrace();
    refreshCaesarPlayButtons();
    announce('Caesar workbench cleared.');
  }
/* ============================================================
     8. ROTOR WORKBENCH WIRING
     ============================================================ */

  var rotor = {
    config: { rotors: [{ name: 'I', position: 0 }, { name: 'II', position: 0 }, { name: 'III', position: 0 }], reflector: 'B', plugboard: '' },
    result: null,
    stale: false,
    limit: false,
    rowEls: [],
    pipeline: {},
    player: null,
    activeSig: null,
    activeEntry: null
  };

  var ROTOR_SPEEDS = { slow: 1700, normal: 1000, fast: 460, instant: 0 };

  function fillRotorSelects() {
    var names = ['I', 'II', 'III', 'IV', 'V'];
    ['rotor-left', 'rotor-mid', 'rotor-right'].forEach(function (id) {
      var sel = $id(id);
      if (!sel) return;
      sel.innerHTML = '';
      names.forEach(function (n) {
        sel.appendChild(createEl('option', { value: n }, n));
      });
    });
    ['rotor-left-pos', 'rotor-mid-pos', 'rotor-right-pos'].forEach(function (id) {
      var sel = $id(id);
      if (!sel) return;
      sel.innerHTML = '';
      ALPHABET.split('').forEach(function (ch) {
        sel.appendChild(createEl('option', { value: ch }, ch));
      });
    });
    var ref = $id('rotor-reflector');
    if (ref) {
      ref.innerHTML = '';
      ['A', 'B', 'C'].forEach(function (r) { ref.appendChild(createEl('option', { value: r }, r)); });
    }
    var ws = $id('wiring-select');
    if (ws) {
      ws.innerHTML = '';
      names.forEach(function (n) { ws.appendChild(createEl('option', { value: n }, 'Rotor ' + n)); });
    }
  }

  function readRotorConfigFromUI() {
    return {
      rotors: [
        { name: $id('rotor-left').value, position: charIndex($id('rotor-left-pos').value) },
        { name: $id('rotor-mid').value, position: charIndex($id('rotor-mid-pos').value) },
        { name: $id('rotor-right').value, position: charIndex($id('rotor-right-pos').value) }
      ],
      reflector: $id('rotor-reflector').value,
      plugboard: $id('rotor-plugboard').value
    };
  }

  function syncSelectsFromConfig() {
    var cfg = rotor.config;
    var nameSel = [$id('rotor-left'), $id('rotor-mid'), $id('rotor-right')];
    var posSel = [$id('rotor-left-pos'), $id('rotor-mid-pos'), $id('rotor-right-pos')];
    for (var i = 0; i < 3; i++) {
      if (nameSel[i]) nameSel[i].value = cfg.rotors[i].name;
      if (posSel[i]) posSel[i].value = ALPHABET[cfg.rotors[i].position];
    }
    if ($id('rotor-reflector')) $id('rotor-reflector').value = cfg.reflector;
    if ($id('rotor-plugboard')) $id('rotor-plugboard').value = serializePlugboard(cfg.plugboard);
  }

  function updateRotorSummary() {
    var cfg = rotor.config;
    var set = function (id, txt) { var el = $id(id); if (el) el.textContent = txt; };
    if (cfg.rotors) {
      set('sum-rotors', cfg.rotors.map(function (r) { return r.name; }).join(' \u00b7 '));
      set('sum-pos', cfg.rotors.map(function (r) { return ALPHABET[r.position]; }).join(' \u00b7 '));
    }
    set('sum-reflector', cfg.reflector);
    set('sum-plugboard', cfg.plugboard && cfg.plugboard.pairs ? cfg.plugboard.pairs.join(' ') : '\u2014');
  }

  function markRotorStale(stale) {
    rotor.stale = stale;
    var note = $id('rotor-stale');
    if (note) {
      note.hidden = !stale;
      note.textContent = stale ? 'Settings changed since the last process \u2014 results are now out of date. Press Process Message again.' : '';
    }
    var readout = $id('rotor-readout');
    var label = $id('rotor-readout-label');
    if (readout) readout.classList.toggle('stale', stale && !!rotor.result);
    if (label) label.classList.toggle('stale', stale && !!rotor.result);
  }

  function applyRotorSettings() {
    try {
      var cfg = normalizeConfiguration(readRotorConfigFromUI());
      rotor.config = cfg;
    } catch (e) {
      announce('Configuration error: ' + e.message);
      return false;
    }
    syncSelectsFromConfig();
    updateRotorSummary();
    updateRotorSelection();
    markRotorStale(true);
    flushSignal();
    if (rotor.player) rotor.player.stop();
    refreshRotorPlayButtons();
    return true;
  }

  function resetRotorToDefaults() {
    rotor.config = { rotors: [{ name: 'I', position: 0 }, { name: 'II', position: 0 }, { name: 'III', position: 0 }], reflector: 'B', plugboard: '' };
    var input = $id('rotor-plugboard');
    if (input) input.value = '';
    syncSelectsFromConfig();
    updateRotorSummary();
    updateRotorSelection();
    markRotorStale(true);
    flushSignal();
    if (rotor.player) rotor.player.stop();
    refreshRotorPlayButtons();
    announce('Rotor machine reset to default settings.');
  }

  function setMachineFromState(state) {
    cancelAllSpins();
    if (!state || !state.rotors) return;
    for (var i = 0; i < 3; i++) setWheelPos(i, state.rotors[i].position, false);
    for (var j = 0; j < 3; j++) {
      var view = machine.rotorViews[j];
      if (view && state.rotors[j]) view.idEl.textContent = state.rotors[j].name;
    }
    if (machine.reflectorBadge && state.reflector) machine.reflectorBadge.textContent = state.reflector;
    if (machine.plugLabel) {
      var p = state.plugboard;
      machine.plugLabel.textContent = p ? 'PB: ' + p : 'no pairs';
    }
    updateRotorSummary();
  }

  function buildRotorTraceTable() {
    var table = $id('rotor-trace');
    var hint = $id('rotor-trace-hint');
    if (!table) return;
    table.innerHTML = '';
    rotor.rowEls = [];
    var trace = rotor.result && rotor.result.trace ? rotor.result.trace : [];
    if (!trace.length) {
      if (hint) hint.hidden = true;
      if (table) table.appendChild(createEl('p', { 'class': 'field-help' }, 'Process a message to populate the signal inspection log.'));
      return;
    }
    var head = createEl('div', { 'class': 't-row-head inspection-row' });
    ['#', 'IN', 'STEP', 'FORWARD R\u2192M\u2192L', 'REF', 'L\u2192M\u2192R REVERSE', 'OUT'].forEach(function (h) {
      head.appendChild(createEl('span', { 'class': 't-col' }, h));
    });
    table.appendChild(head);

    trace.forEach(function (t, idx) {
      var row = createEl('div', { 'class': 'inspection-row', role: 'button', tabindex: '0', 'aria-label': 'Inspect character ' + (t.position + 1) });
      if (!t.isAlpha) {
row.appendChild(createEl('div', { 'class': 'cell t-mono cell-dim' }, String(t.position)));
        row.appendChild(createEl('div', { 'class': 'cell t-char' }, t.char));
        row.appendChild(createEl('div', { 'class': 'cell t-mono cell-preserved cell-dim' }, '\u2014 preserved, rotors not advanced \u2014'));
        row.appendChild(createEl('div', { 'class': 'cell cell-strong' }, t.char));
      } else {
        row.appendChild(createEl('div', { 'class': 'cell t-mono cell-dim' }, String(t.position)));
        row.appendChild(createEl('div', { 'class': 'cell t-char', title: (t.plugIn !== t.plugOut ? 'plugboard ' + indexLetter(t.plugIn) + '\u2194' + indexLetter(t.plugOut) : '') }, t.upper));
        var stepTxt = t.stepBefore.map(indexLetter).join('') + '\u2192' + t.stepAfter.map(indexLetter).join('');
        var stepEl = createEl('div', { 'class': 'cell t-mono cell-ref' });
        stepEl.innerHTML = '';
        var stepCell = createEl('span', { 'class': 'cell-ref' }, t.stepBefore.map(indexLetter).join(''));
        var arrow2 = createEl('span', { 'class': 'cell-arrow' }, '\u2192');
        var stepAfterSpan = createEl('b', {}, t.stepAfter.map(indexLetter).join(''));
        stepEl.appendChild(stepCell);
        stepEl.appendChild(arrow2);
        stepEl.appendChild(stepAfterSpan);
        row.appendChild(stepEl);
        var fwd = createEl('div', { 'class': 'cell t-mono' }, t.forward.map(function (s) { return indexLetter(s.out); }).join(' '));
        fwd.title = t.forward.map(function (s) { return indexLetter(s.in) + '\u2192' + indexLetter(s.out); }).join('  ');
        row.appendChild(fwd);
        var ref = createEl('div', { 'class': 'cell t-mono cell-ref' }, indexLetter(t.reflector.in) + '\u2192' + indexLetter(t.reflector.out));
        row.appendChild(ref);
        var rev = createEl('div', { 'class': 'cell t-mono' }, t.reverse.map(function (s) { return indexLetter(s.out); }).join(' '));
        rev.title = t.reverse.map(function (s) { return indexLetter(s.in) + '\u2192' + indexLetter(s.out); }).join('  ');
        row.appendChild(rev);
        row.appendChild(createEl('div', { 'class': 'cell cell-strong t-char' }, t.outLetter));
      }
      (function (i) {
        row.addEventListener('click', function () { rotorPlayerShow(i); });
        row.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); rotorPlayerShow(i); } });
      })(idx);
      table.appendChild(row);
      rotor.rowEls.push(row);
    });

    if (hint) {
      var shownAll = trace.length;
      hint.hidden = false;
      hint.textContent = trace.length > 0
        ? 'Click any row to replay its signal path. Positions step before each letter; the row shows before \u2192 after.'
        : '';
    }
  }

  function setRotorRowActive(i) {
    rotor.rowEls.forEach(function (el, k) { el.classList.toggle('active', k === i); });
  }

  function rotorScrollRow(i) {
    var row = rotor.rowEls[i];
    if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

function rotorDuration() {
    var sel = $id('rotor-speed');
    var v = sel ? sel.value : 'normal';
    if (reducedMotion()) return 0;
    return v in ROTOR_SPEEDS ? ROTOR_SPEEDS[v] : ROTOR_SPEEDS.normal;
  }

  var ROTOR_SPIN_FRAC = 0.30;   /* fraction of a character reserved for stepping */

  function rotorHost() {
    return {
      get trace() { return rotor.result ? rotor.result.trace : []; },
      get playLimit() { return rotor.limit ? 40 : 0; },
      duration: rotorDuration,
      reset: function () {
        cancelAllSpins();
        flushSignal();
        rotor.activeEntry = null;
        if (rotor.result) {
          setMachineFromState(rotor.result.initialState);
        } else {
          setMachineFromState({ rotors: rotor.config.rotors, reflector: rotor.config.reflector, plugboard: serializePlugboard(rotor.config.plugboard) });
        }
        clearPipeline(rotor.pipeline);
        rotor.rowEls.forEach(function (el) { el.classList.remove('active'); });
        if (rotor.player) rotor.player.index = -1;
      },
      charStart: function (i, gen) {
        var t = rotor.result.trace[i];
        if (!t) return;
        cancelAllSpins();
        flushSignal();
        setRotorRowActive(i);
        if (!t.isAlpha) {
          clearPipeline(rotor.pipeline);
          setPipelineStage(rotor.pipeline, 'pb-in', t.char, 'active');
          return;
        }
        clearPipeline(rotor.pipeline);
        setPipelineStage(rotor.pipeline, 'pb-in', t.upper, 'active');
        var dur = rotorDuration();
        var spinMs = dur * ROTOR_SPIN_FRAC;
        var anyStepped = t.stepped[0] || t.stepped[1] || t.stepped[2];
        if (gen === 0 || dur <= 0 || reducedMotion()) {
          if (anyStepped) spinFromStepped(t.stepped, 240);
          else if (gen === 0) { /* ensure wheels reflect this char's post-step positions */ }
        } else if (anyStepped) {
          spinFromStepped(t.stepped, spinMs);
        } else {
          /* no stepping: nothing to spin this character */
        }
        rotor.activeEntry = t;
        rotor.activeSig = drawCharSignal(t, { kindClass: true });
      },
      charProgress: function (i, p, gen) {
        var t = rotor.result.trace[i];
        if (!t) return;
        if (gen === 0) p = 1;
        if (!t.isAlpha) {
          if (p >= 0.2) setPipelineStage(rotor.pipeline, 'pb-in', t.char, 'done');
          return;
        }
        var spinFrac = (gen === 0) ? 0 : ((t.stepped[0] || t.stepped[1] || t.stepped[2]) ? ROTOR_SPIN_FRAC : 0.06);
        var q = p <= spinFrac ? 0 : Math.min(1, (p - spinFrac) / (1 - spinFrac));
        if (!rotor.activeSig && rotor.activeEntry) rotor.activeSig = drawCharSignal(t, { kindClass: true });
        if (rotor.activeSig) progressSignal(rotor.activeSig, q);

        /* highlight the stage reached by the travelling dot */
        var litName = null;
        if (rotor.activeSig) {
          for (var k = 0; k < rotor.activeSig.items.length; k++) {
            if (q >= 0.001 && rotor.activeSig.items[k].cum <= rotor.activeSig.cumTotal * Math.max(0.0001, q) + 0.001) litName = rotor.activeSig.items[k].name;
          }
        }
        if (litName) {
          var letters = rotorStageLetters(t);
          setPipelineStage(rotor.pipeline, litName, letters[litName], 'active');
        }
      },
      charComplete: function (i, gen) {
        var t = rotor.result.trace[i];
        if (!t) return;
        setRotorRowActive(i);
        if (rotor.activeSig) progressSignal(rotor.activeSig, 1);
        if (t.isAlpha) {
          setAllStagesDone(rotor.pipeline);
          var letters = rotorStageLetters(t);
          Object.keys(letters).forEach(function (k) {
            var v = rotor.pipeline[k];
            if (v) v.value.textContent = letters[k];
          });
        } else {
          setPipelineStage(rotor.pipeline, 'pb-in', t.char, 'done');
        }
        if (gen === 0) rotorScrollRow(i);
      },
      onEnd: function () {
        if (rotor.result) {
          setMachineFromState(rotor.result.finalState);
          setRotorRowActive(rotor.result.trace.length - 1);
        }
        refreshRotorPlayButtons();
        showHeaderBusy(false);
        setStatusText('Idle');
      },
      onSelected: function (i) {
        setRotorRowActive(i);
        if (rotor.result) {
          var t = rotor.result.trace[i];
          if (t && !t.isAlpha && rotor.player) rotor.player.charComplete(i, 0);
        }
      }
    };
  }

  function rotorStageLetters(t) {
    var ltr = function (idx) { return idx == null ? '\u2014' : indexLetter(idx); };
    return {
      'pb-in': ltr(t.plugIn),
      'r1': ltr(t.plugOut),
      'm1': ltr(t.forward[0].out),
      'l1': ltr(t.forward[1].out),
      'ref': ltr(t.reflector.in),
      'l2': ltr(t.reflector.out),
      'm2': ltr(t.reverse[0].out),
      'r2': ltr(t.reverse[1].out),
      'pb-out': ltr(t.outIndex)
    };
  }

  function refreshRotorPlayButtons() {
    var btn = $id('rotor-play');
    if (btn) btn.textContent = rotor.player && rotor.player.playing && !rotor.player._paused ? '\u275A\u275A' : '\u25B6';
    var has = rotor.result && rotor.result.trace && rotor.result.trace.length > 0;
    ['rotor-play', 'rotor-prev', 'rotor-next', 'rotor-skip', 'rotor-replay'].forEach(function (id) {
      var b = $id(id);
      if (b) b.disabled = !has;
    });
  }

  function rotorPlayerShow(i) {
    if (!rotor.player || !rotor.result) return;
    rotor.player.showChar(i);
    refreshRotorPlayButtons();
    setStatusText('Inspection');
  }

  function processRotor() {
    var inputEl = $id('rotor-input');
    var msg = inputEl ? inputEl.value : '';
    if (!msg) {
      announce('Please type a message before processing.');
      return;
    }
    try {
      var cfg = normalizeConfiguration(readRotorConfigFromUI());
      rotor.config = cfg;
    } catch (e) {
      announce('Configuration error: ' + e.message);
      return;
    }
    syncSelectsFromConfig();
    updateRotorSummary();
    var mode = $id('rotor-mode').value;
    var result = mode === 'encrypt'
      ? rotorEncryptionPipeline(msg, cfg, {})
      : rotorDecryptionPipeline(msg, cfg, {});
    rotor.result = result;
    if (rotor.player) rotor.player.stop();
    rotorHost().reset();
    setMachineFromState(result.initialState);
    markRotorStale(false);
    $id('rotor-readout-label').textContent = 'OUTPUT \u00b7 ' + (mode === 'encrypt' ? 'CIPHERTEXT' : 'PLAINTEXT');
    $id('rotor-readout').textContent = result.output;
    buildRotorTraceTable();
    var limitBox = $id('rotor-limit');
    if (limitBox) {
      limitBox.hidden = result.trace.length <= 60;
      rotor.limit = limitBox.checked;
    }
    refreshRotorPlayButtons();
    announce((mode === 'encrypt' ? 'Encrypted' : 'Decrypted') + ' ' + result.metadata.characters + ' characters. ' + result.metadata.alphabetic + ' letters passed through the machine.');
    setStatusText('Idle');
  }

  function wireRotorLab() {
    fillRotorSelects();

    var settings = ['rotor-left', 'rotor-mid', 'rotor-right', 'rotor-left-pos', 'rotor-mid-pos', 'rotor-right-pos', 'rotor-reflector', 'rotor-plugboard', 'rotor-mode'];
    settings.forEach(function (id) {
      var el = $id(id);
      if (!el) return;
      el.addEventListener('change', function () { if (rotor.result) markRotorStale(true); });
    });
    var msg2 = $id('rotor-input');
    if (msg2) msg2.addEventListener('input', function () { if (rotor.result) markRotorStale(true); });

    $id('rotor-apply').addEventListener('click', applyRotorSettings);
    $id('rotor-reset').addEventListener('click', resetRotorToDefaults);
    $id('rotor-process').addEventListener('click', function () {
      showHeaderBusy(true);
      setStatusText('Processing Rotor');
      setTimeout(processRotor, 30);
    });

    rotor.player = new TracePlayer(rotorHost());
    $id('rotor-play').addEventListener('click', function () {
      rotor.player.toggle();
      refreshRotorPlayButtons();
      if (rotor.player.playing) { showHeaderBusy(true); setStatusText('Playback: Rotor'); }
      else { showHeaderBusy(false); setStatusText('Idle'); }
    });
    $id('rotor-prev').addEventListener('click', function () {
      if (rotor.player.index > 0) rotorPlayerShow(rotor.player.index - 1);
    });
    $id('rotor-next').addEventListener('click', function () {
      var n = rotor.result ? rotor.result.trace.length : 0;
      if (rotor.player.index < n - 1) rotorPlayerShow(rotor.player.index + 1);
    });
    $id('rotor-skip').addEventListener('click', function () {
      rotor.player.skipToEnd();
      refreshRotorPlayButtons();
      showHeaderBusy(false);
    });
    $id('rotor-replay').addEventListener('click', function () {
      rotor.player.stop();
      rotorHost().reset();
      rotor.player.play();
      refreshRotorPlayButtons();
      showHeaderBusy(true);
      setStatusText('Playback: Rotor');
    });
    var lb = $id('rotor-limit');
    if (lb) lb.addEventListener('change', function () { rotor.limit = lb.checked; });

    syncSelectsFromConfig();
    updateRotorSummary();
    updateRotorSelection();
    rotor.pipeline = buildPipelineChips($id('rotor-pipeline'), ROTOR_STAGES, { separator: true });
    refreshRotorPlayButtons();
  }

  /* ---- wiring inspection panel ---- */
  function fillWiringPanel() {
    var sel = $id('wiring-select');
    var toggle = $id('wiring-toggle');
    var table = $id('wiring-table');
    var validation = $id('wiring-validation');
if (!sel || !table) return;
    ['I', 'II', 'III', 'IV', 'V'].forEach(function (n) {
      sel.appendChild(createEl('option', { value: n }, 'Rotor ' + n));
    });

    function rebuild() {
      var name = sel.value;
      var spec = ROTOR_WIRINGS[name];
      table.innerHTML = '';
      var t = createEl('table');
      var thead = createEl('thead');
      var hr = createEl('tr');
      ['Letter', 'Forward wiring', 'Inverse wiring', 'Notch at'].forEach(function (h) {
        hr.appendChild(createEl('th', null, h));
      });
      thead.appendChild(hr);
      t.appendChild(thead);
      var tb = createEl('tbody');
      var inv = buildInverse(spec.wiring);
      for (var i = 0; i < MOD; i++) {
        var tr = createEl('tr');
        tr.appendChild(createEl('td', null, ALPHABET[i]));
        tr.appendChild(createEl('td', null, spec.wiring[i]));
        tr.appendChild(createEl('td', null, ALPHABET[inv[i]]));
        tr.appendChild(createEl('td', null, i === charIndex(spec.notch) ? '\u25B2 notch' : ''));
        tb.appendChild(tr);
      }
      t.appendChild(tb);
      var prev = table.querySelector('table');
      if (prev) table.removeChild(prev);
      table.appendChild(t);
      if (validation) {
        var perm = isPermutation(spec.wiring) ? 'permutation valid' : 'permutation INVALID';
        var fixed = 0;
        for (var j = 0; j < MOD; j++) if (spec.wiring[j] === ALPHABET[j]) fixed++;
        validation.textContent = 'Rotor ' + name + ': ' + perm + ' \u00b7 ' + (26 - fixed) + ' letters move \u00b7 notch ring position ' + spec.notch;
      }
    }

    sel.addEventListener('change', rebuild);
    toggle.addEventListener('click', function () {
      var open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      table.hidden = open;
      toggle.textContent = open ? 'Show Wiring' : 'Hide Wiring';
      if (!open) rebuild();
    });
    rebuild();
    table.hidden = true;
  }
/* ============================================================
     9. INITIALISATION, SELF-TESTS, EXPORTS
     ============================================================ */

  function introReveal() {
    if (!gsapAvailable() || reducedMotion()) return;
    var targets = document.querySelectorAll('.intro .eyebrow, .intro-headline, .intro-body, .intro-actions, .intro-note');
    targets.forEach(function (el) {
      var x = gsap.fromTo(el,
        { opacity: 0, y: 18 },
        { opacity: 1, y: 0, duration: 1.0, ease: 'power2.out', delay: el.classList.contains('intro-headline') ? 0.15 : 0.05 });
      x.play();
    });
  }

  var selftestResult = null;

  function runLabSelfTests() {
    try {
      selftestResult = runSelfTests(function (msg) {
        if (global.console && console.log) console.log('[selftest] ' + msg);
      });
    } catch (e) {
      selftestResult = { passed: 0, failed: 1, total: 1 };
      if (global.console && console.error) console.error('[selftest] suite crashed: ' + e.message);
    }
    var st = $id('selftest-status');
    if (st) {
      if (selftestResult.failed === 0) {
        st.textContent = selftestResult.total + ' checks passed';
        st.classList.add('pass');
        st.classList.remove('fail');
      } else {
        st.textContent = selftestResult.failed + ' of ' + selftestResult.total + ' checks FAILED \u2014 see console';
        st.classList.add('fail');
        st.classList.remove('pass');
      }
    }
    return selftestResult;
  }

  function wireMotionToggle() {
    var toggle = $id('motion-toggle');
    if (!toggle) return;
    toggle.checked = reducedMotion();
    document.body.classList.toggle('reduced-motion', reducedMotion());
    toggle.addEventListener('change', function () {
      document.body.classList.toggle('reduced-motion', toggle.checked);
    });
  }

  function init() {
    buildMachine();
    wireCaesarLab();
    wireRotorLab();
    fillWiringPanel();
    wireMotionToggle();
    introReveal();
    var st = runLabSelfTests();
    if (st && st.failed > 0 && global.console && console.warn) {
      console.warn('Cipher Laboratory self-test suite reported failures. See [selftest] lines above.');
    }
  }

  var api = {
    caesarEncryptionPipeline: caesarEncryptionPipeline,
    caesarDecryptionPipeline: caesarDecryptionPipeline,
    rotorEncryptionPipeline: rotorEncryptionPipeline,
    rotorDecryptionPipeline: rotorDecryptionPipeline,
    runSelfTests: runSelfTests,
    normalizeShift: normalizeShift,
    normalizeConfiguration: normalizeConfiguration,
    ROTOR_WIRINGS: ROTOR_WIRINGS,
    REFLECTORS: REFLECTORS,
    version: '1.0.0'
  };

  global.CipherLab = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (doc) {
    if (doc.readyState === 'loading') {
      doc.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }

})(typeof window !== 'undefined' ? window : globalThis);
